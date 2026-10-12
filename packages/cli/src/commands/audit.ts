import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  runChecks,
  toFindings,
  type Finding,
} from "@titan-design/code-graph";
import { defaultGraphDbPath, openGraphStore } from "../utils/graph-store.js";
import { persistFindings } from "./audit-persist.js";
import { changedLinesSince, type ChangedLines } from "./audit-changed.js";
import { collectSnapshotStats, indexMetrics, type SnapshotStats } from "./audit-collect.js";
import { AUDIT_RULES } from "./audit-rules.js";
import { PYTHON_TOOLS, runPythonTools, type PythonRunners, type PythonTool } from "./audit-runners.js";
import { buildScoreTable, type ScoreTable } from "./audit-score.js";
import { testKindFindings } from "./audit-test-kinds.js";
import { runTsSlopRules, type TsSlopRunner } from "./audit-ts-slop.js";
import { runGraphIndex } from "./graph-index-run.js";

export interface AuditCommandOptions {
  path: string;
  db?: string;
  out?: string;
  noRuff?: boolean;
  /** Git ref the PR branches from; symbols changed since it are checked for missing test kinds even when untested. */
  changedFrom?: string;
  /** Replaces the real tool runs; tests inject them so the Python tools need not be installed. */
  runners?: PythonRunners;
  noTsSlop?: boolean;
  /** Replaces the ast-grep run of the TS slop rules. */
  tsSlop?: TsSlopRunner;
}

/** SCBench verbosity over the TS files, from the slop rules alone; scb-check adds clone lines on top. */
export interface TsVerbosity {
  verbosity_flagged_loc: number;
  total_loc: number;
  verbosity: number;
}

export interface AuditCommandResult {
  root: string;
  dbPath: string;
  outDir: string;
  snapshotId: number;
  findings: Finding[];
  scores: ScoreTable;
  warnings: string[];
  /** Absent when the TS slop rules were skipped or ast-grep could not run. */
  tsVerbosity?: TsVerbosity;
  durationMs: number;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

function selectedTools(options: AuditCommandOptions, warnings: string[]): PythonTool[] {
  if (!options.noRuff) return [...PYTHON_TOOLS];
  warnings.push("ruff skipped (--no-ruff)");
  return PYTHON_TOOLS.filter((tool) => tool !== "ruff");
}

function graphFindings(dbPath: string, snapshotId: number, changed?: ChangedLines): { findings: Finding[]; stats: SnapshotStats } {
  const store = openGraphStore(dbPath);
  try {
    const result = runChecks(store, { snapshotId, rules: AUDIT_RULES });
    const nodes = store.listNodes(snapshotId, { includeSymbols: true });
    const metrics = indexMetrics(store.listMetrics(snapshotId));
    const edges = store.listEdges(snapshotId, { includeReferences: true });
    const testKinds = testKindFindings({ nodes, metrics, edges, changed });
    return { findings: [...toFindings(result), ...testKinds], stats: collectSnapshotStats(nodes, metrics) };
  } finally {
    store.close();
  }
}

interface TsSlopOutcome {
  findings: Finding[];
  verbosity?: TsVerbosity;
}

async function runTsSlop(options: AuditCommandOptions, stats: SnapshotStats, cwd: string, warnings: string[]): Promise<TsSlopOutcome> {
  if (options.noTsSlop) {
    warnings.push("ts-slop skipped (--no-ts-slop)");
    return { findings: [] };
  }
  if (stats.tsFiles.length === 0) return { findings: [] };
  const run = await (options.tsSlop ?? runTsSlopRules)(stats.tsFiles, { cwd });
  warnings.push(...run.warnings);
  if (run.flaggedLoc === null) return { findings: run.findings };
  const tsFiles = new Set(stats.tsFiles);
  const totalLoc = stats.files.filter((f) => tsFiles.has(f.path)).reduce((sum, f) => sum + f.loc, 0);
  const verbosity = totalLoc > 0 ? run.flaggedLoc / totalLoc : 0;
  return { findings: run.findings, verbosity: { verbosity_flagged_loc: run.flaggedLoc, total_loc: totalLoc, verbosity } };
}

function writeOutputs(outDir: string, findings: readonly Finding[], scores: ScoreTable): void {
  mkdirSync(outDir, { recursive: true });
  const lines = findings.map((f) => JSON.stringify(f)).join("\n");
  writeFileSync(path.join(outDir, "findings.jsonl"), lines.length > 0 ? `${lines}\n` : "");
  writeFileSync(path.join(outDir, "scores.json"), `${JSON.stringify(scores, null, 2)}\n`);
}

export async function runAuditCommand(options: AuditCommandOptions): Promise<AuditCommandResult> {
  const started = performance.now();
  const root = path.resolve(options.path);
  const idRoot = detectGitToplevel(root) ?? root;
  const dbPath = path.resolve(options.db ?? defaultGraphDbPath(root));
  const outDir = path.resolve(options.out ?? path.join(idRoot, ".codewatch", "audit"));
  const warnings: string[] = [];
  const index = await runGraphIndex({ rootDir: root, dbPath, onNotice: (line) => warnings.push(line) });
  const changed = options.changedFrom === undefined ? undefined : changedLinesSince(options.changedFrom, idRoot);
  const graph = graphFindings(dbPath, index.snapshotId, changed);
  const tools = selectedTools(options, warnings);
  const external = await runPythonTools(tools, graph.stats.pythonFiles, idRoot, options.runners);
  warnings.push(...external.warnings);
  const tsSlop = await runTsSlop(options, graph.stats, idRoot, warnings);
  const findings = sortFindings([...graph.findings, ...external.findings, ...tsSlop.findings]);
  const scores = buildScoreTable(graph.stats.files, graph.stats.symbols, findings);
  writeOutputs(outDir, findings, scores);
  persistFindings(dbPath, index.snapshotId, idRoot, findings);
  const durationMs = performance.now() - started;
  return { root, dbPath, outDir, snapshotId: index.snapshotId, findings, scores, warnings, tsVerbosity: tsSlop.verbosity, durationMs };
}
