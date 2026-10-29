import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  runChecks,
  runExtremeMutation,
  type ExtremeMutationOptions,
  type ExtremeMutationResult,
  type ExtremeSummary,
  type Finding,
} from "@titan-design/code-graph";
import { defaultGraphDbPath, openGraphStore } from "../utils/graph-store.js";
import { persistFindings } from "./audit-persist.js";
import { changedLinesSince, type ChangedLines } from "./audit-changed.js";
import { auditFindings } from "./audit-cycles.js";
import { collectSnapshotStats, indexMetrics, type SnapshotStats } from "./audit-collect.js";
import { contractAudit, indexAuditSnapshots, type ContractBase } from "./audit-contract-base.js";
import { AUDIT_RULES } from "./audit-rules.js";
import { PYTHON_TOOLS, runPythonTools, type PythonRunners, type PythonTool } from "./audit-runners.js";
import { buildScoreTable, type ScoreTable } from "./audit-score.js";
import { censusJson, entryAudit, type InputClassCensus } from "./audit-input-classes.js";
import { testKindFindings } from "./audit-test-kinds.js";
import { runTsSlopRules, type TsSlopRunner } from "./audit-ts-slop.js";

export interface AuditCommandOptions {
  path: string;
  db?: string;
  out?: string;
  noRuff?: boolean;
  /** Git ref the PR branches from; entry points changed since it are checked for missing test kinds even when untested, and contract changes against it are reported. */
  changedFrom?: string;
  /** Replaces the real tool runs; tests inject them so the Python tools need not be installed. */
  runners?: PythonRunners;
  noTsSlop?: boolean;
  /** Replaces the ast-grep run of the TS slop rules. */
  tsSlop?: TsSlopRunner;
  /** A whole-suite Istanbul coverage-final.json measured at the committed HEAD; body-deletes the changed, covered functions. Needs `changedFrom`. */
  extremeCoverage?: string;
  /** Replaces the extreme-mutation run, which builds and tests a throwaway worktree. */
  extremeMutation?: (options: ExtremeMutationOptions) => Promise<ExtremeMutationResult>;
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
  /** Per Python entry point, the input classes its tests feed (input-classes.json). */
  inputClasses: InputClassCensus;
  warnings: string[];
  /** Absent when the TS slop rules were skipped or ast-grep could not run. */
  tsVerbosity?: TsVerbosity;
  /** Present only with `extremeCoverage`; also written to extreme.json. */
  extreme?: ExtremeSummary;
  durationMs: number;
}

/** Its rows share the entry's span and arrive ranked; the solve brief reads them in that order. */
const RANKED_SIGNAL = "entry-input-class";

const bothRanked = (a: Finding, b: Finding): boolean => a.signal === RANKED_SIGNAL && b.signal === RANKED_SIGNAL;

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0) ||
      (bothRanked(a, b) ? 0 : a.id.localeCompare(b.id)),
  );
}

function selectedTools(options: AuditCommandOptions, warnings: string[]): PythonTool[] {
  if (!options.noRuff) return [...PYTHON_TOOLS];
  warnings.push("ruff skipped (--no-ruff)");
  return PYTHON_TOOLS.filter((tool) => tool !== "ruff");
}

interface GraphOutcome {
  findings: Finding[];
  stats: SnapshotStats;
  census: InputClassCensus;
}

function readGraph(dbPath: string, snapshotId: number) {
  const store = openGraphStore(dbPath);
  try {
    const result = runChecks(store, { snapshotId, rules: AUDIT_RULES });
    const nodes = store.listNodes(snapshotId, { includeSymbols: true });
    const metrics = indexMetrics(store.listMetrics(snapshotId));
    const edges = store.listEdges(snapshotId, { includeReferences: true });
    return { checks: auditFindings(result), nodes, metrics, edges };
  } finally {
    store.close();
  }
}

async function graphFindings(dbPath: string, snapshotId: number, root: string, changed?: ChangedLines, base?: ContractBase): Promise<GraphOutcome> {
  const { checks, nodes, metrics, edges } = readGraph(dbPath, snapshotId);
  const contract = changed && base ? await contractAudit(base, { nodes, edges, metrics }, changed, dbPath, root) : [];
  const testFunctions = metrics.get("test_kind_snapshot") ?? new Map<string, number>();
  const entries = await entryAudit(nodes, edges, (id) => testFunctions.has(id), root);
  const testKinds = testKindFindings({ nodes, metrics, edges, entries: entries.entries, changed });
  return { findings: [...checks, ...testKinds, ...entries.findings, ...contract], stats: collectSnapshotStats(nodes, metrics), census: entries.census };
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

interface ExtremeTarget {
  idRoot: string;
  dbPath: string;
  snapshotId: number;
  changed: ChangedLines;
}

/** The one call site of runExtremeMutation in the CLI: its findings join the audit's at weight 0 and nothing turns them into work. */
async function extremeRun(options: AuditCommandOptions, coverage: string, target: ExtremeTarget): Promise<ExtremeMutationResult> {
  const data = JSON.parse(readFileSync(path.resolve(coverage), "utf8")) as ExtremeMutationOptions["coverage"]["data"];
  const changed = new Map([...target.changed].map(([file, ranges]) => [file, ranges.map((r) => [r.start, r.end] as const)]));
  const store = openGraphStore(target.dbPath);
  try {
    const run = options.extremeMutation ?? runExtremeMutation;
    return await run({ repo: target.idRoot, head: "HEAD", changed, coverage: { head: "HEAD", data }, store, snapshotId: target.snapshotId });
  } finally {
    store.close();
  }
}

function extremeJson({ summary, report }: ExtremeMutationResult): string {
  const { baseline: _baseline, ...trimmed } = report;
  return `${JSON.stringify({ summary, report: trimmed }, null, 2)}\n`;
}

function writeOutputs(outDir: string, findings: readonly Finding[], scores: ScoreTable, census: InputClassCensus, extreme?: ExtremeMutationResult): void {
  mkdirSync(outDir, { recursive: true });
  if (extreme) writeFileSync(path.join(outDir, "extreme.json"), extremeJson(extreme));
  writeFileSync(path.join(outDir, "input-classes.json"), censusJson(census));
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
  const onNotice = (line: string): void => void warnings.push(line);
  const ref = options.changedFrom;
  if (options.extremeCoverage !== undefined && ref === undefined) throw new Error("--extreme-coverage needs --changed-from <ref>");
  const { head: index, base } = await indexAuditSnapshots({ root, idRoot, dbPath, ref, onNotice });
  const changed = ref === undefined ? undefined : changedLinesSince(ref, idRoot);
  const graph = await graphFindings(dbPath, index.snapshotId, idRoot, changed, base);
  const extreme =
    options.extremeCoverage === undefined || changed === undefined
      ? undefined
      : await extremeRun(options, options.extremeCoverage, { idRoot, dbPath, snapshotId: index.snapshotId, changed });
  const tools = selectedTools(options, warnings);
  const external = await runPythonTools(tools, graph.stats.pythonFiles, idRoot, options.runners);
  warnings.push(...external.warnings);
  const tsSlop = await runTsSlop(options, graph.stats, idRoot, warnings);
  const findings = sortFindings([...graph.findings, ...external.findings, ...tsSlop.findings, ...(extreme?.findings ?? [])]);
  const scores = buildScoreTable(graph.stats.files, graph.stats.symbols, findings);
  writeOutputs(outDir, findings, scores, graph.census, extreme);
  persistFindings(dbPath, index.snapshotId, idRoot, findings);
  const durationMs = performance.now() - started;
  return { root, dbPath, outDir, snapshotId: index.snapshotId, findings, scores, inputClasses: graph.census, warnings, tsVerbosity: tsSlop.verbosity, extreme: extreme?.summary, durationMs };
}
