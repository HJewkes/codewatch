import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  detectGitToplevel,
  externalToFinding,
  runChecks,
  toFindings,
  type Finding,
} from "@titan-design/code-graph";
import { runRuffAudit, type CheckDiagnostic, type RunnerResult } from "@titan-design/style-checker";
import { openGraphStore } from "../utils/graph-store.js";
import { collectSnapshotStats, type SnapshotStats } from "./audit-collect.js";
import { AUDIT_RULES } from "./audit-rules.js";
import { buildScoreTable, type ScoreTable } from "./audit-score.js";
import { runGraphIndex } from "./graph-index-run.js";

export type RuffRunner = (files: string[], options: { cwd: string }) => Promise<RunnerResult>;

export interface AuditCommandOptions {
  path: string;
  db?: string;
  out?: string;
  noRuff?: boolean;
  /** Replaces the real ruff run; tests inject one so ruff need not be installed. */
  runRuff?: RuffRunner;
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

/** The ruff side of the merge: one finding per diagnostic, error stays error, everything else is a warning. */
export function ruffToFinding(d: CheckDiagnostic): Finding {
  return externalToFinding({
    tool: "ruff",
    rule: d.rule,
    file: d.file,
    line: d.line,
    endLine: d.endLine,
    message: d.message,
    severity: d.severity === "error" ? "error" : "warning",
  });
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

async function ruffFindings(
  options: AuditCommandOptions,
  pythonFiles: string[],
  idRoot: string,
  warnings: string[],
): Promise<Finding[]> {
  if (options.noRuff) {
    warnings.push("ruff skipped (--no-ruff)");
    return [];
  }
  if (pythonFiles.length === 0) return [];
  const run = options.runRuff ?? runRuffAudit;
  const result = await run(pythonFiles, { cwd: idRoot });
  for (const failure of result.failures) {
    warnings.push(failure.kind === "spawn-failed" ? "ruff not found on PATH; ruff findings skipped" : `ruff: ${failure.message}`);
  }
  return result.diagnostics.map(ruffToFinding);
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
  const ruff = await ruffFindings(options, graph.stats.pythonFiles, idRoot, warnings);
  const findings = sortFindings([...graph.findings, ...ruff]);
  const scores = buildScoreTable(graph.stats.files, graph.stats.symbols, findings);
  writeOutputs(outDir, findings, scores);
  const durationMs = performance.now() - started;
  return { root, dbPath, outDir, snapshotId: index.snapshotId, findings, scores, warnings, durationMs };
}
