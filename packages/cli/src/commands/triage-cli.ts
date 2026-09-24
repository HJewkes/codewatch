import { InvalidArgumentError, type Command } from "commander";
import { formatError } from "../utils/output.js";
import { DEFAULT_MIN_RANK } from "./triage-select.js";

interface TriageCliOptions {
  minRank: number;
  budgetUsd: number;
  concurrency: number;
  model: string;
  dryRun?: boolean;
  includeTests?: boolean;
  out?: string;
  db?: string;
  audit?: string;
}

export const RUN_NOT_AVAILABLE = "triage run lands in a later release; use --dry-run to see what it would send";

function nonNegative(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("expected a number >= 0");
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

export function registerTriageCommand(program: Command): void {
  program
    .command("triage <path>")
    .description("Ask a model to judge an existing audit's findings, file by file (reads .codewatch/audit)")
    .option("--min-rank <n>", "Only files whose score rank is at least this (0-100)", nonNegative, DEFAULT_MIN_RANK)
    .option("--budget-usd <usd>", "Stop launching model calls past this spend", nonNegative, 5)
    .option("--concurrency <n>", "Model calls in flight at once", positiveInt, 4)
    .option("--model <name>", "Model for the triage reader", "sonnet")
    .option("--dry-run", "Print the files, questions, and a token and cost estimate; call no model")
    .option("--include-tests", "Also triage test and fixture files")
    .option("--out <dir>", "Output directory for verdicts (default: <path>/.codewatch/audit)")
    .option("--db <path>", "Graph database (default: <path>/.codewatch/graph.db)")
    .option("--audit <dir>", "Audit output to read (default: <path>/.codewatch/audit)")
    .action(async (target: string, options: TriageCliOptions) => {
      if (!options.dryRun) {
        console.error(`codewatch triage: ${RUN_NOT_AVAILABLE}`);
        process.exitCode = 2;
        return;
      }
      try {
        await runDryRun(target, options);
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
