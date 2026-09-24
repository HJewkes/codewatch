import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  runChecks,
  toFindings,
  type Finding,
} from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { persistFindings } from "./audit-persist.js";
import { collectSnapshotStats, type SnapshotStats } from "./audit-collect.js";
import { AUDIT_RULES } from "./audit-rules.js";
import { PYTHON_TOOLS, runPythonTools, type PythonRunners, type PythonTool } from "./audit-runners.js";
import { buildScoreTable, type ScoreTable } from "./audit-score.js";
import { runGraphIndex } from "./graph-index-run.js";

export interface AuditCommandOptions {
  path: string;
  db?: string;
  out?: string;
  noRuff?: boolean;
  /** Replaces the real tool runs; tests inject them so the Python tools need not be installed. */
  runners?: PythonRunners;
}

export interface AuditCommandResult {
  root: string;
  dbPath: string;
  outDir: string;
  snapshotId: number;
  findings: Finding[];
  scores: ScoreTable;
  warnings: string[];
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

function graphFindings(dbPath: string, snapshotId: number): { findings: Finding[]; stats: SnapshotStats } {
  const store = openGraphStore(dbPath);
  try {
    const result = runChecks(store, { snapshotId, rules: AUDIT_RULES });
    return { findings: toFindings(result), stats: collectSnapshotStats(store, snapshotId) };
  } finally {
    store.close();
  }
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
  const dbPath = path.resolve(options.db ?? path.join(root, ".codewatch", "graph.db"));
  const outDir = path.resolve(options.out ?? path.join(root, ".codewatch", "audit"));
  const warnings: string[] = [];
  const index = await runGraphIndex({ rootDir: root, dbPath, onNotice: (line) => warnings.push(line) });
  const graph = graphFindings(dbPath, index.snapshotId);
  const tools = selectedTools(options, warnings);
  const external = await runPythonTools(tools, graph.stats.pythonFiles, idRoot, options.runners);
  warnings.push(...external.warnings);
  const findings = sortFindings([...graph.findings, ...external.findings]);
  const scores = buildScoreTable(graph.stats.files, graph.stats.symbols, findings);
  writeOutputs(outDir, findings, scores);
  persistFindings(dbPath, index.snapshotId, idRoot, findings);
  const durationMs = performance.now() - started;
  return { root, dbPath, outDir, snapshotId: index.snapshotId, findings, scores, warnings, durationMs };
}
