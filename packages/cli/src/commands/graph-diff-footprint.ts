import * as fs from "node:fs/promises";
import chalk from "chalk";
import {
  computeFootprints,
  diffFootprints,
  gateUnits,
  parseSymbolId,
  unitProvenance,
  type CodeGraphStore,
  type FootprintChange,
  type FootprintUnit,
  type GateResult,
  type SnapshotRow,
  type SymbolFootprint,
  type UnitProvenance,
} from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { resolveSnapshotRef } from "../utils/snapshot-ref.js";

export interface GraphDiffFootprintOptions {
  db: string;
  from: string;
  to: string;
  /** JSON array of `{unitId, symbolIds}`; default is one unit per file. */
  units?: string;
  /** Prior provenance: a JSON array of records, or a previous `--json` output. */
  provenance?: string;
}

export interface GraphDiffFootprintResult {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  changes: FootprintChange[];
  files: string[];
  gate: GateResult;
  /** False when no unit needs regenerating, so a doc generator can skip its model call. */
  llmCallNeeded: boolean;
  /** Fresh records at the to-snapshot; `model` is null until a generator fills it. */
  provenance: UnitProvenance[];
  durationMs: number;
}

interface SnapshotFootprints {
  units: FootprintUnit[];
  footprints: Map<string, SymbolFootprint>;
}

export async function runGraphDiffFootprintCommand(
  options: GraphDiffFootprintOptions,
): Promise<GraphDiffFootprintResult> {
  const start = performance.now();
  const customUnits = options.units ? await readUnits(options.units) : undefined;
  const priorFile = options.provenance ? await readProvenance(options.provenance) : undefined;
  const db = openGraphStore(options.db);
  try {
    const toSnapshot = resolveSnapshotRef(db, options.to, { flag: "--to" });
    const fromSnapshot = resolveSnapshotRef(db, options.from, {
      flag: "--from",
      currentId: toSnapshot.id,
    });
    const diff = diffFootprints(db, { fromSnapshotId: fromSnapshot.id, toSnapshotId: toSnapshot.id });
    const current = loadFootprints(db, toSnapshot.id, customUnits);
    const prior = priorFile ?? provenanceAt(loadFootprints(db, fromSnapshot.id, customUnits), fromSnapshot);
    const gate = gateUnits({ prior, ...current });
    return {
      fromSnapshot,
      toSnapshot,
      changes: diff.changes,
      files: diff.files,
      gate,
      llmCallNeeded: gate.regenerate.length > 0,
      provenance: provenanceAt(current, toSnapshot),
      durationMs: performance.now() - start,
    };
  } finally {
    db.close();
  }
}

function loadFootprints(
  db: CodeGraphStore,
  snapshotId: number,
  customUnits: FootprintUnit[] | undefined,
): SnapshotFootprints {
  const nodes = db.listNodes(snapshotId, { includeSymbols: true }).filter((n) => n.kind === "symbol");
  const edges = db.listEdges(snapshotId, { includeReferences: true });
  const footprints = computeFootprints({ nodes, edges });
  return { units: customUnits ?? fileUnits([...footprints.keys()]), footprints };
}

function fileUnits(symbolIds: readonly string[]): FootprintUnit[] {
  const byFile = new Map<string, string[]>();
  for (const id of symbolIds) {
    const file = parseSymbolId(id)?.fileId ?? id;
    byFile.set(file, [...(byFile.get(file) ?? []), id]);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([unitId, ids]) => ({ unitId, symbolIds: ids }));
}

function provenanceAt(state: SnapshotFootprints, snapshot: SnapshotRow): UnitProvenance[] {
  return state.units.map((unit) =>
    unitProvenance({ unit, footprints: state.footprints, snapshot }),
  );
}

async function readJson(file: string, flag: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`${flag}: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readUnits(file: string): Promise<FootprintUnit[]> {
  const raw = await readJson(file, "--units");
  const valid =
    Array.isArray(raw) &&
    raw.every((u) => typeof u?.unitId === "string" && Array.isArray(u?.symbolIds));
  if (!valid) throw new Error(`--units: ${file} must be a JSON array of {unitId, symbolIds}`);
  return raw as FootprintUnit[];
}

async function readProvenance(file: string): Promise<UnitProvenance[]> {
  const raw = await readJson(file, "--provenance");
  const records = Array.isArray(raw) ? raw : (raw as { provenance?: unknown })?.provenance;
  const valid =
    Array.isArray(records) &&
    records.every((r) => typeof r?.unitId === "string" && typeof r?.symbolSetHash === "string");
  if (!valid) {
    throw new Error(
      `--provenance: ${file} must be a JSON array of {unitId, symbolSetHash} or a prior --json output`,
    );
  }
  return records as UnitProvenance[];
}

function snapshotLabel(snap: SnapshotRow): string {
  return `snap ${snap.id} (${snap.ref}@${snap.commitHash ? snap.commitHash.slice(0, 7) : "—"})`;
}

function formatChanges(changes: readonly FootprintChange[], max = 20): string[] {
  const lines = [chalk.bold(`Changed symbols (${changes.length})`)];
  for (const c of changes.slice(0, max)) {
    const reasons = c.reasons.length > 0 ? chalk.dim(` [${c.reasons.join(", ")}]`) : "";
    lines.push(`  ${c.status.padEnd(7)}  ${c.symbolId}${reasons}`);
  }
  if (changes.length > max) lines.push(chalk.dim(`  … and ${changes.length - max} more`));
  return [...lines, ""];
}

function formatGate(gate: GateResult, max = 20): string[] {
  const lines = [
    chalk.bold("Gate"),
    `  ${gate.regenerate.length} regenerate, ${gate.skip.length} skip, ${gate.orphaned.length} orphaned`,
  ];
  for (const r of gate.regenerate.slice(0, max)) lines.push(`  ${chalk.yellow(r.reason.padEnd(7))}  ${r.unitId}`);
  if (gate.regenerate.length > max) lines.push(chalk.dim(`  … and ${gate.regenerate.length - max} more`));
  return [...lines, ""];
}

export function formatGraphDiffFootprintText(result: GraphDiffFootprintResult): string {
  return [
    chalk.bold.underline(
      `Footprint diff: ${snapshotLabel(result.fromSnapshot)} → ${snapshotLabel(result.toSnapshot)}`,
    ),
    "",
    ...formatChanges(result.changes),
    ...formatGate(result.gate),
    `LLM call needed: ${result.llmCallNeeded ? chalk.yellow("yes") : chalk.green("no")}`,
    chalk.dim(`${result.provenance.length} provenance records (--json to save them)`),
    chalk.dim(`diff ${result.durationMs.toFixed(0)}ms`),
  ].join("\n");
}

export function formatGraphDiffFootprintJson(result: GraphDiffFootprintResult): string {
  const { fromSnapshot, toSnapshot, ...rest } = result;
  return JSON.stringify({ from: fromSnapshot, to: toSnapshot, ...rest }, null, 2);
}
