import type { Command } from "commander";
import * as path from "node:path";
import { formatError } from "../utils/output.js";
import { defaultGraphDbPath } from "../utils/graph-store.js";
import { runGraphReportCommand } from "./graph-report.js";
import {
  NO_QUALITY_MESSAGE,
  countViolations,
  loadSnapshotQuality,
  scoreInputsFromReport,
} from "./graph-score-inputs.js";
import { formatGraphScoreJson, formatGraphScoreText } from "./graph-score-format.js";
import { computeScore } from "./score-formula.js";
import {
  appendScoreRun,
  previousComparable,
  readScoreHistory,
  scoreDelta,
  type ScoreDelta,
  type ScoreRun,
} from "./score-history.js";

/** Every hotspot row, so `scary` counts all files over the cutoff rather than the top ten. */
const ALL_ROWS = 100_000;

export interface GraphScoreCommandOptions {
  db: string;
  repoRoot: string;
  /** Rules file for the violations component; a missing file counts no violations. */
  config: string;
  /** The JSONL run history; appended to on every successful run. */
  history: string;
  /** Rows in the trend, newest first; the current run is the first. */
  last?: number;
  now?: () => Date;
}

export interface TrendRow {
  run: ScoreRun;
  /** Score change against the comparable run before it; absent for the oldest. */
  delta?: number;
}

export interface GraphScoreResult {
  run: ScoreRun;
  previous?: ScoreRun;
  delta?: ScoreDelta;
  trend: TrendRow[];
  /** History lines that did not parse and were ignored. */
  skipped: number;
}

async function scoreSnapshot(options: GraphScoreCommandOptions, at: string): Promise<ScoreRun> {
  const report = runGraphReportCommand({ db: options.db, repoRoot: options.repoRoot, limit: ALL_ROWS });
  const { quality, linkage } = loadSnapshotQuality(options.db, options.repoRoot, report);
  if (!quality) throw new Error(NO_QUALITY_MESSAGE);
  const violations = await countViolations(options.db, options.config, report.snapshot.id);
  const { score, formulaVersion, components } = computeScore(
    scoreInputsFromReport(report, quality, linkage, violations),
  );
  return {
    formulaVersion,
    score,
    components,
    commit: report.snapshot.commitHash,
    snapshotId: report.snapshot.id,
    at,
  };
}

function buildTrend(comparable: readonly ScoreRun[], last: number): TrendRow[] {
  const rows: TrendRow[] = [];
  for (let i = comparable.length - 1; i >= 0 && rows.length < last; i--) {
    const before = comparable[i - 1];
    const run = comparable[i]!;
    rows.push(before ? { run, delta: scoreDelta(run, before).score } : { run });
  }
  return rows;
}

/** Score the latest snapshot, append the run to the history, and compare it with the last comparable run. */
export async function runGraphScoreCommand(options: GraphScoreCommandOptions): Promise<GraphScoreResult> {
  const now = options.now ?? (() => new Date());
  const run = await scoreSnapshot(options, now().toISOString());
  const history = readScoreHistory(options.history);
  const previous = previousComparable(history.runs, run.formulaVersion);
  appendScoreRun(options.history, run);
  const comparable = [...history.runs.filter((r) => r.formulaVersion === run.formulaVersion), run];
  return {
    run,
    previous,
    delta: previous ? scoreDelta(run, previous) : undefined,
    trend: buildTrend(comparable, options.last ?? 1),
    skipped: history.skipped,
  };
}

interface GraphScoreCliOptions {
  db: string;
  repoRoot: string;
  config?: string;
  history?: string;
  last?: string;
  json?: boolean;
}

function resolveOptions(options: GraphScoreCliOptions): GraphScoreCommandOptions {
  const codewatchDir = path.join(options.repoRoot, ".codewatch");
  return {
    db: options.db,
    repoRoot: options.repoRoot,
    config: options.config ?? path.join(codewatchDir, "check.json"),
    history: options.history ?? path.join(codewatchDir, "score-history.jsonl"),
    last: options.last !== undefined ? Number(options.last) : undefined,
  };
}

export function registerGraphScore(graphCmd: Command): void {
  graphCmd
    .command("score")
    .description(
      "One 0-100 repo score (hotspots, fitness violations, complexity, hidden coupling, erosion, value cycles) and its change since the last run.",
    )
    .option("--db <path>", "Path to graph.db", defaultGraphDbPath())
    .option("--repo-root <path>", "Repo root (for git log and package detection)", ".")
    .option("--config <path>", "Rules file for the violations component (default <repo-root>/.codewatch/check.json)")
    .option("--history <path>", "Run history (default <repo-root>/.codewatch/score-history.jsonl)")
    .option("--last <n>", "Show a trend of the last n runs, newest first")
    .option("--json", "Output structured JSON")
    .action(async (options: GraphScoreCliOptions) => {
      try {
        const result = await runGraphScoreCommand(resolveOptions(options));
        if (result.skipped > 0) {
          process.stderr.write(`codewatch: skipped ${result.skipped} malformed score-history line(s)\n`);
        }
        console.log(options.json ? formatGraphScoreJson(result) : formatGraphScoreText(result));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
