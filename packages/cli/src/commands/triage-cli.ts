import { InvalidArgumentError, Option, type Command } from "commander";
import { formatError } from "../utils/output.js";
import { DEFAULT_HARNESS, TRIAGE_HARNESSES, type TriageHarness } from "./triage-runner.js";
import { DEFAULT_MIN_RANK } from "./triage-select.js";

interface TriageCliOptions {
  minRank: number;
  budgetUsd: number;
  concurrency: number;
  maxFailures: number;
  model: string;
  harness: TriageHarness;
  dryRun?: boolean;
  includeTests?: boolean;
  out?: string;
  db?: string;
  audit?: string;
}

function nonNegative(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("expected a number >= 0");
  return n;
}

function nonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("expected a whole number >= 0");
  return n;
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("expected a whole number >= 1");
  return n;
}

async function runDryRun(target: string, options: TriageCliOptions): Promise<void> {
  const { planTriage } = await import("./triage-plan.js");
  const { formatTriagePlan } = await import("./triage-format.js");
  const includeTests = options.includeTests ?? false;
  const plan = planTriage({ path: target, db: options.db, auditDir: options.audit, minRank: options.minRank, includeTests });
  for (const warning of plan.warnings) console.error(`codewatch triage: ${warning}`);
  console.log(formatTriagePlan(plan, { ...options, includeTests }));
}

async function runModelTriage(target: string, options: TriageCliOptions): Promise<void> {
  const { runTriage } = await import("./triage.js");
  const { formatTriageSummary } = await import("./triage-output.js");
  const { report, outDir } = await runTriage({
    ...options,
    path: target,
    auditDir: options.audit,
    includeTests: options.includeTests ?? false,
    onProgress: (line) => console.error(`codewatch triage: ${line}`),
  });
  for (const warning of report.warnings) console.error(`codewatch triage: ${warning}`);
  if (report.controls.controlRun === "provisional") {
    console.error(`codewatch triage: controls failed (${report.controls.failed.join(", ")}); every verdict in this run is marked provisional`);
  }
  console.log(formatTriageSummary(report, outDir).join("\n"));
}

export function registerTriageCommand(program: Command): void {
  program
    .command("triage <path>")
    .description("Ask a model to judge an existing audit's findings, file by file (reads .codewatch/audit)")
    .option("--min-rank <n>", "Only files whose score rank is at least this (0-100)", nonNegative, DEFAULT_MIN_RANK)
    .option("--budget-usd <usd>", "Stop launching model calls past this spend", nonNegative, 5)
    .option("--concurrency <n>", "Model calls in flight at once", positiveInt, 4)
    .option("--max-failures <n>", "Failed reader calls tolerated before launching stops", nonNegativeInt, 3)
    .option("--model <name>", "Model for the triage reader", "sonnet")
    .addOption(new Option("--harness <name>", "How the reader reaches the model: the logged-in claude CLI, or the Agent SDK on CLAUDE_CODE_OAUTH_TOKEN").choices(TRIAGE_HARNESSES).default(DEFAULT_HARNESS))
    .option("--dry-run", "Print the files, questions, and a token and cost estimate; call no model, but still carry earlier verdicts forward into graph.db")
    .option("--include-tests", "Also triage test and fixture files")
    .option("--out <dir>", "Output directory for verdicts (default: <path>/.codewatch/audit)")
    .option("--db <path>", "Graph database (default: <path>/.codewatch/graph.db)")
    .option("--audit <dir>", "Audit output to read (default: <path>/.codewatch/audit)")
    .action(async (target: string, options: TriageCliOptions) => {
      try {
        await (options.dryRun ? runDryRun(target, options) : runModelTriage(target, options));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
