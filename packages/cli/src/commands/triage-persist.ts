import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  carryForwardVerdicts,
  listFindings,
  listVerdicts,
  saveVerdicts,
  type CodeGraphStore,
  type Finding,
  type StoredFinding,
  type StoredVerdict,
  type VerdictLabel,
} from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { keyWithExcerpts } from "./triage-keys.js";
import type { VerdictRecord } from "./triage-output.js";
import type { TriageSelection } from "./triage-select.js";
import type { BundleSource } from "./triage-source.js";

/** A question left unasked because its finding already holds a verdict in this snapshot. */
export interface ReusedVerdict {
  key: string;
  path: string;
  signal: string;
  verdict: VerdictLabel;
  /** Set when carry-forward copied the verdict from an earlier snapshot. */
  carriedFrom?: number;
  /** Set when the verdict came from the committed verdict files. */
  fromFiles?: true;
}

export interface VerdictCarry {
  /** The latest earlier snapshot holding verdicts, if any. */
  from?: number;
  /** Verdicts this run copied into the current snapshot. */
  carried: number;
}

export interface JudgedSplit {
  selection: TriageSelection;
  keys: Map<Finding, string>;
  reused: ReusedVerdict[];
  /** Committed verdicts reused for a finding graph.db held no verdict for; the run saves them into the snapshot. */
  fromFiles: VerdictRecord[];
}

const HEAD_FILE = "verdicts.jsonl";
export const FRAGMENT_DIR = "verdicts.d";

function isVerdictRecord(value: unknown): value is VerdictRecord {
  const r = value as Partial<VerdictRecord> | null;
  return typeof r?.key === "string" && typeof r.verdict === "string" && typeof r.excerptHash === "string" && typeof r.path === "string";
}

function parseVerdict(line: string): VerdictRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isVerdictRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readVerdictLines(file: string, warnings: string[]): VerdictRecord[] {
  return readFileSync(file, "utf8").split("\n").flatMap((line, i) => {
    if (line.trim() === "") return [];
    const record = parseVerdict(line);
    if (!record) warnings.push(`${file}:${i + 1} is not a verdict row; skipped`);
    return record ? [record] : [];
  });
}

/** The head file, then each fragment in id order; a later row replaces an earlier one with the same key. */
export function readVerdictFiles(dir: string, warnings: string[]): Map<string, VerdictRecord> {
  const fragmentDir = path.join(dir, FRAGMENT_DIR);
  const fragments = existsSync(fragmentDir) ? readdirSync(fragmentDir).filter((n) => n.endsWith(".jsonl")) : [];
  fragments.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const files = [path.join(dir, HEAD_FILE), ...fragments.map((n) => path.join(fragmentDir, n))].filter((f) => existsSync(f));
  const byKey = new Map<string, VerdictRecord>();
  for (const file of files) for (const record of readVerdictLines(file, warnings)) byKey.set(record.key, record);
  return byKey;
}

/**
 * Writes this run's verdicts as one fragment beside the head file, which is never touched; none is written when the run judged nothing.
 * A rerun under the same run id merges into its fragment, newer rows winning by key, so a retry never drops what the first attempt judged.
 */
export function writeVerdictFragment(dir: string, runId: string, records: readonly VerdictRecord[]): string | undefined {
  if (records.length === 0) return undefined;
  const fragmentDir = path.join(dir, FRAGMENT_DIR);
  mkdirSync(fragmentDir, { recursive: true });
  const file = path.join(fragmentDir, `${runId}.jsonl`);
  const unreadable: string[] = [];
  const earlier = existsSync(file) ? readVerdictLines(file, unreadable) : [];
  if (unreadable.length > 0) throw new Error(`${unreadable.join("; ")}; refusing to rewrite ${file} (this run's verdicts are saved in graph.db)`);
  const merged = new Map(earlier.map((r) => [r.key, r]));
  for (const record of records) merged.set(record.key, record);
  const sorted = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path) || a.key.localeCompare(b.key));
  writeFileSync(file, sorted.map((r) => `${JSON.stringify(r)}\n`).join(""));
  return file;
}

function priorJudgedSnapshot(store: CodeGraphStore, snapshotId: number): number | undefined {
  const earlier = store
    .listSnapshots()
    .map((s) => s.id)
    .filter((id) => id < snapshotId)
    .sort((a, b) => b - a);
  return earlier.find((id) => listVerdicts(store, id).length > 0);
}

/** Copies verdicts whose finding and excerpt are unchanged from the latest judged snapshot into this one. */
export function carryPriorVerdicts(store: CodeGraphStore, snapshotId: number): VerdictCarry {
  const from = priorJudgedSnapshot(store, snapshotId);
  return from === undefined ? { carried: 0 } : { from, carried: carryForwardVerdicts(store, from, snapshotId) };
}

function reusedOf(finding: Finding, v: StoredVerdict): ReusedVerdict {
  const row: ReusedVerdict = { key: v.key, path: finding.path, signal: finding.signal, verdict: v.verdict };
  return v.carriedFrom === undefined ? row : { ...row, carriedFrom: v.carriedFrom };
}

/** A committed verdict carries only onto the same key with the excerpt it judged, as carry-forward in graph.db does. */
function fileVerdictFor(stored: StoredFinding, files: ReadonlyMap<string, VerdictRecord>): VerdictRecord | undefined {
  const record = files.get(stored.key);
  if (!record || record.excerptHash !== stored.excerptHash) return undefined;
  const { carriedFrom: _snapshotOfAnotherDb, ...rest } = record;
  const f = stored.finding;
  return { ...rest, path: f.path, signal: f.signal, tool: f.tool, provenance: "file" };
}

/** Keys the whole selection, then drops every finding that already holds a verdict in this snapshot or, failing that, in the committed verdict files. */
export function skipJudged(
  selection: TriageSelection,
  source: BundleSource,
  judged: readonly StoredVerdict[],
  cap: number,
  files: ReadonlyMap<string, VerdictRecord> = new Map(),
): JudgedSplit {
  const byKey = new Map(judged.map((v) => [v.key, v]));
  const keyed = new Map(keyWithExcerpts(selection.files.flatMap((f) => f.findings), source, cap).map((k) => [k.finding, k]));
  const reused: ReusedVerdict[] = [];
  const fromFiles: VerdictRecord[] = [];
  const open = (f: Finding): boolean => {
    const stored = keyed.get(f)!;
    const verdict = byKey.get(stored.key);
    const filed = verdict ? undefined : fileVerdictFor(stored, files);
    if (verdict) reused.push(reusedOf(f, verdict));
    if (filed) reused.push({ key: filed.key, path: f.path, signal: f.signal, verdict: filed.verdict, fromFiles: true });
    if (filed) fromFiles.push(filed);
    return !verdict && !filed;
  };
  const kept = selection.files.map((file) => ({ ...file, findings: file.findings.filter(open) })).filter((file) => file.findings.length > 0);
  const keys = new Map([...keyed].map(([f, k]) => [f, k.key]));
  return { selection: { ...selection, files: kept }, keys, reused, fromFiles };
}

function toStored(r: VerdictRecord): StoredVerdict {
  const { key, verdict, rationale, citations, excerptHash, model, costUsd, runId, provenance, controlRun } = r;
  return { key, verdict, rationale, citations, excerptHash, model, costUsd, runId, provenance, controlRun };
}

function recordOf(v: StoredVerdict, finding: Finding): VerdictRecord {
  const { key, verdict, rationale, citations, excerptHash, carriedFrom } = v;
  const where = { path: finding.path, signal: finding.signal, tool: finding.tool, ...(finding.symbol ? { symbol: finding.symbol } : {}) };
  const origin = { model: v.model ?? "unknown", costUsd: v.costUsd ?? 0, runId: v.runId ?? "", controlRun: v.controlRun ?? "provisional" };
  const firstSeen = v.provenance === "file" ? ("file" as const) : ("model" as const);
  const provenance = carriedFrom === undefined ? { provenance: firstSeen } : { provenance: "carried" as const, carriedFrom };
  return { key, verdict, rationale, citations, ...where, excerptHash, ...origin, ...provenance };
}

/** Every verdict the snapshot holds after this run: the fresh ones as given, the rest read back from graph.db. */
function snapshotView(store: CodeGraphStore, snapshotId: number, fresh: readonly VerdictRecord[], known: ReadonlyMap<string, Finding>): VerdictRecord[] {
  const freshKeys = new Set(fresh.map((r) => r.key));
  const findings = new Map([...known, ...listFindings(store, snapshotId).map((f) => [f.key, f.finding] as const)]);
  const earlier = listVerdicts(store, snapshotId).flatMap((v) => {
    const finding = findings.get(v.key);
    return !freshKeys.has(v.key) && finding ? [recordOf(v, finding)] : [];
  });
  return [...fresh, ...earlier].sort((a, b) => a.path.localeCompare(b.path) || a.key.localeCompare(b.key));
}

/** Saves this run's verdicts and returns the snapshot's full verdict view for verdicts.jsonl. */
export function persistVerdicts(dbPath: string, snapshotId: number, fresh: readonly VerdictRecord[], known: ReadonlyMap<string, Finding>): VerdictRecord[] {
  const store = openGraphStore(dbPath);
  try {
    saveVerdicts(store, snapshotId, fresh.map(toStored));
    return snapshotView(store, snapshotId, fresh, known);
  } finally {
    store.close();
  }
}
