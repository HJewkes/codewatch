import type { Command } from "commander";
import { formatError } from "../utils/output.js";

interface AuditCliOptions {
  db?: string;
  out?: string;
  json?: boolean;
  ruff: boolean;
  tsSlop: boolean;
  changedFrom?: string;
  extremeCoverage?: string;
}

export function registerAuditCommand(program: Command): void {
  program
    .command("audit <path>")
    .description("Index a repo and write findings.jsonl plus a per-file and per-function score table")
    .option("--db <path>", "Graph database (default: <path>/.codewatch/graph.db)")
    .option("--out <dir>", "Output directory (default: <path>/.codewatch/audit)")
    .option("--json", "Print the summary as JSON")
    .option("--no-ruff", "Skip the ruff audit rules")
    .option("--no-ts-slop", "Skip the TS slop rules (ast-grep)")
    .option("--changed-from <ref>", "Also check entry points changed since <ref> for missing test kinds, even when no test reaches them")
    .option(
      "--extreme-coverage <file>",
      "With --changed-from: body-delete each changed function this HEAD coverage-final.json marks covered, and report the ones no test notices (weight 0)",
    )
    .action(async (target: string, options: AuditCliOptions) => {
      try {
        const { runAuditCommand } = await import("./audit.js");
        const { formatAuditText, summarizeAudit } = await import("./audit-format.js");
        const result = await runAuditCommand({
          path: target,
          db: options.db,
          out: options.out,
          noRuff: !options.ruff,
          noTsSlop: !options.tsSlop,
          changedFrom: options.changedFrom,
          extremeCoverage: options.extremeCoverage,
        });
        for (const warning of result.warnings) console.error(`codewatch audit: ${warning}`);
        const summary = summarizeAudit(result);
        console.log(options.json ? JSON.stringify(summary, null, 2) : formatAuditText(summary));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
