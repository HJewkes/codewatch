import {
  carryForwardVerdicts,
  listVerdicts,
  saveVerdicts,
  type CodeGraphStore,
  type Finding,
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

/** Keys the whole selection, then drops every finding that already holds a verdict in this snapshot. */
export function skipJudged(selection: TriageSelection, source: BundleSource, judged: readonly StoredVerdict[], cap: number): JudgedSplit {
  const byKey = new Map(judged.map((v) => [v.key, v]));
  const keyed = keyWithExcerpts(selection.files.flatMap((f) => f.findings), source, cap);
  const keys = new Map(keyed.map((k) => [k.finding, k.key]));
  const reused: ReusedVerdict[] = [];
  const open = (f: Finding): boolean => {
    const verdict = byKey.get(keys.get(f)!);
    if (verdict) reused.push(reusedOf(f, verdict));
    return !verdict;
  };
  const files = selection.files.map((file) => ({ ...file, findings: file.findings.filter(open) })).filter((file) => file.findings.length > 0);
  return { selection: { ...selection, files }, keys, reused };
}

function toStored(r: VerdictRecord): StoredVerdict {
  const { key, verdict, rationale, citations, excerptHash, model, costUsd, runId, provenance, controlRun } = r;
  return { key, verdict, rationale, citations, excerptHash, model, costUsd, runId, provenance, controlRun };
}

export function persistVerdicts(dbPath: string, snapshotId: number, records: readonly VerdictRecord[]): void {
  const store = openGraphStore(dbPath);
  try {
    saveVerdicts(store, snapshotId, records.map(toStored));
  } finally {
    store.close();
  }
}
