import chalk from "chalk";
import type { AuditCommandResult } from "./audit.js";
import { QUALITATIVE_FLAG_HINTS, QUALITATIVE_SIGNALS } from "./audit-rules.js";
import { countSignals, type FileScore, type SignalCounts } from "./audit-score.js";

const TOP_FILES = 15;

export interface AuditSummary {
  root: string;
  outDir: string;
  snapshotId: number;
  findings: number;
  bySignal: SignalCounts;
  byTool: SignalCounts;
  topFiles: Array<Pick<FileScore, "path" | "rank" | "loc" | "cognitiveMax" | "total">>;
  warnings: string[];
  durationMs: number;
}

function sortedEntries(counts: SignalCounts): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeAudit(result: AuditCommandResult): AuditSummary {
  const byTool: SignalCounts = {};
  for (const f of result.findings) byTool[f.tool] = (byTool[f.tool] ?? 0) + 1;
  return {
    root: result.root,
    outDir: result.outDir,
    snapshotId: result.snapshotId,
    findings: result.findings.length,
    bySignal: Object.fromEntries(sortedEntries(countSignals(result.findings))),
    byTool,
    topFiles: result.scores.files.slice(0, TOP_FILES).map(({ path, rank, loc, cognitiveMax, total }) => ({
      path,
      rank,
      loc,
      cognitiveMax,
      total,
    })),
    warnings: result.warnings,
    durationMs: Math.round(result.durationMs),
  };
}

function formatTopFiles(files: AuditSummary["topFiles"]): string[] {
  const header = `${"rank".padStart(6)}  ${"loc".padStart(6)}  ${"cog".padStart(4)}  ${"findings".padStart(8)}  path`;
  const rows = files.map(
    (f) =>
      `${f.rank.toFixed(1).padStart(6)}  ${String(f.loc).padStart(6)}  ${String(f.cognitiveMax).padStart(4)}  ${String(f.total).padStart(8)}  ${f.path}`,
  );
  return [chalk.bold(`Top ${files.length} files by rank`), chalk.dim(header), ...rows];
}

function formatQualitativeFlags(flags: Array<[string, number]>): string[] {
  if (flags.length === 0) return [];
  const rows = flags.map(([s, n]) => `${String(n).padStart(6)}  ${s}  ${chalk.dim(QUALITATIVE_FLAG_HINTS[s] ?? "")}`);
  return [chalk.bold("Qualitative flags (not scored)"), ...rows, ""];
}

export function formatAuditText(summary: AuditSummary): string {
  const entries = sortedEntries(summary.bySignal);
  const flags = entries.filter(([s]) => QUALITATIVE_SIGNALS.has(s));
  const scored = entries.filter(([s]) => !QUALITATIVE_SIGNALS.has(s));
  const flagCount = flags.reduce((sum, [, n]) => sum + n, 0);
  const flagNote = flagCount > 0 ? ` and ${flagCount} qualitative flags` : "";
  return [
    chalk.bold(`codewatch audit: ${summary.findings - flagCount} findings${flagNote} in ${summary.root}`),
    "",
    ...formatTopFiles(summary.topFiles),
    "",
    chalk.bold("Findings by signal"),
    ...scored.map(([s, n]) => `${String(n).padStart(6)}  ${s}`),
    "",
    ...formatQualitativeFlags(flags),
    chalk.dim(`Wrote findings.jsonl and scores.json to ${summary.outDir} (${summary.durationMs} ms)`),
  ].join("\n");
}
