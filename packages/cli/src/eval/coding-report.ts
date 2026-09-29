import type { Ledger, TokenCounts } from "./coding-ledger.js";
import type { LocalizationScore } from "./coding-localize.js";
import type { SetScore } from "./types.js";

/**
 * C-93 S3: per-arm coding-bench report. The headline pairs resolve rate with the main-ledger
 * token delta against the baseline arm; helper tokens and the session total print separately.
 * Localization-F1 is reported, never optimised: it never ranks arms. Pure: no I/O.
 */

/** One arm's attempt at one coding task, as the arm runner records it. */
export interface ArmRun {
  taskId: string;
  arm: string;
  stratum: string;
  resolved: boolean;
  runError: boolean;
  failToPassPassed: number;
  failToPassTotal: number;
  passToPassRegressed: number;
  main: Ledger;
  helper: Ledger;
  sessionTotal: TokenCounts;
  ledgerGap: TokenCounts;
  costUsd: number;
  numTurns: number;
  toolCalls: Record<string, number>;
  editedFiles: string[];
  /** Null when the run could not be scored (no agent diff captured). */
  localization: LocalizationScore | null;
  /** Null means the agent never edited. */
  preEditTurns: number | null;
  readLocalization: SetScore | null;
}

/** Mean per-task main-ledger input delta of an arm against the baseline, over tasks both ran. */
export interface PairedDelta {
  pairedTasks: number;
  meanDelta: number;
  baselineMean: number;
}

export interface LocalizationMeans {
  file: number;
  symbol: number;
  line: number;
  scoredRuns: number;
}

export interface ArmSummary {
  arm: string;
  runs: number;
  resolved: number;
  resolveRate: number;
  meanMainInput: number;
  /** Absent for the baseline itself and for arms sharing no task with it. */
  mainDelta?: PairedDelta;
  meanHelperInput: number;
  meanHelperCalls: number;
  meanSessionInput: number;
  localization?: LocalizationMeans;
  meanPreEditTurns?: number;
  noEditRuns: number;
  meanReadFileF1?: number;
}

export interface ArmReportSummary {
  baselineArm: string;
  baselinePresent: boolean;
  arms: ArmSummary[];
}

export const GOLD_PATCH_CAVEAT =
  "Gold patches under-credit the callers, tests and coupled neighbours that are codewatch's " +
  "differentiator. A good agent that also fixes a coupled caller loses precision for it. F1 is " +
  "therefore reported, never optimised: it never ranks arms, never gates a run, and never feeds " +
  "back into bundle tuning. Test-pass (`gradeCoding`) stays the only headline outcome, and it is " +
  "independent of codewatch.";

/** All input the model read: fresh, cache-write and cache-read tokens. */
function inputOf(counts: TokenCounts): number {
  return counts.inputTokens + counts.cacheCreateTokens + counts.cacheReadTokens;
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function mainInputByTask(runs: readonly ArmRun[]): Map<string, number> {
  const byTask = new Map<string, number>();
  for (const [taskId, taskRuns] of groupBy(runs, (r) => r.taskId)) {
    byTask.set(taskId, mean(taskRuns.map((r) => inputOf(r.main))) ?? 0);
  }
  return byTask;
}

function pairedDelta(arm: readonly ArmRun[], baseline: Map<string, number>): PairedDelta | undefined {
  const pairs = [...mainInputByTask(arm)].flatMap(([taskId, value]) => {
    const base = baseline.get(taskId);
    return base === undefined ? [] : [{ value, base }];
  });
  if (pairs.length === 0) return undefined;
  return {
    pairedTasks: pairs.length,
    meanDelta: mean(pairs.map((p) => p.value - p.base)) ?? 0,
    baselineMean: mean(pairs.map((p) => p.base)) ?? 0,
  };
}

function localizationMeans(runs: readonly ArmRun[]): LocalizationMeans | undefined {
  const scored = runs.flatMap((r) => (r.localization ? [r.localization] : []));
  if (scored.length === 0) return undefined;
  const f1 = (pick: (s: LocalizationScore) => SetScore): number => mean(scored.map((s) => pick(s).f1)) ?? 0;
  return { file: f1((s) => s.file), symbol: f1((s) => s.symbol), line: f1((s) => s.line), scoredRuns: scored.length };
}

function summarizeArm(arm: string, runs: readonly ArmRun[], baseline?: Map<string, number>): ArmSummary {
  const resolved = runs.filter((r) => r.resolved).length;
  const editTurns = runs.flatMap((r) => (r.preEditTurns === null ? [] : [r.preEditTurns]));
  const readF1 = runs.flatMap((r) => (r.readLocalization ? [r.readLocalization.f1] : []));
  return {
    arm,
    runs: runs.length,
    resolved,
    resolveRate: resolved / runs.length,
    meanMainInput: mean(runs.map((r) => inputOf(r.main))) ?? 0,
    mainDelta: baseline ? pairedDelta(runs, baseline) : undefined,
    meanHelperInput: mean(runs.map((r) => inputOf(r.helper))) ?? 0,
    meanHelperCalls: mean(runs.map((r) => r.helper.calls)) ?? 0,
    meanSessionInput: mean(runs.map((r) => inputOf(r.sessionTotal))) ?? 0,
    localization: localizationMeans(runs),
    meanPreEditTurns: mean(editTurns),
    noEditRuns: runs.length - editTurns.length,
    meanReadFileF1: mean(readF1),
  };
}

/** Ranks by resolve rate, then fewer main-ledger tokens; localization-F1 never enters the order. */
function byOutcomeThenTokens(a: ArmSummary, b: ArmSummary): number {
  return b.resolveRate - a.resolveRate || a.meanMainInput - b.meanMainInput || a.arm.localeCompare(b.arm);
}

/** Per-arm outcome, token ledgers and reported localization, ordered for the report. */
export function summarizeArms(runs: readonly ArmRun[], baselineArm = "A0"): ArmReportSummary {
  const byArm = groupBy(runs, (r) => r.arm);
  const baselineRuns = byArm.get(baselineArm);
  const baseline = baselineRuns ? mainInputByTask(baselineRuns) : undefined;
  const arms = [...byArm].map(([arm, armRuns]) =>
    summarizeArm(arm, armRuns, arm === baselineArm ? undefined : baseline),
  );
  return { baselineArm, baselinePresent: baseline !== undefined, arms: arms.sort(byOutcomeThenTokens) };
}

const tokens = (n: number): string => Math.round(n).toLocaleString("en-US");
const f1 = (n: number | undefined): string => (n === undefined ? "n/a" : n.toFixed(2));

function signedTokens(n: number): string {
  return `${n > 0 ? "+" : ""}${tokens(n)}`;
}

function deltaCell(arm: ArmSummary, summary: ArmReportSummary): string {
  if (arm.arm === summary.baselineArm) return "baseline";
  if (!summary.baselinePresent) return "n/a (no baseline)";
  const d = arm.mainDelta;
  if (!d) return "n/a (no shared tasks)";
  const pct = d.baselineMean === 0 ? "" : `${((100 * d.meanDelta) / d.baselineMean).toFixed(1)}%, `;
  return `${signedTokens(d.meanDelta)} (${pct}n=${d.pairedTasks})`;
}

function table(header: readonly string[], rows: readonly string[][]): string[] {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)];
}

function headlineSection(summary: ArmReportSummary): string[] {
  const rows = summary.arms.map((a) => [
    a.arm,
    `${a.resolved}/${a.runs}`,
    `${Math.round(100 * a.resolveRate)}%`,
    tokens(a.meanMainInput),
    deltaCell(a, summary),
  ]);
  const deltaHeader = `main delta vs ${summary.baselineArm} (paired)`;
  return [
    "## Outcome and main-ledger tokens",
    "",
    ...table(["arm", "resolved", "resolve rate", "main input tokens (mean)", deltaHeader], rows),
  ];
}

function helperSection(summary: ArmReportSummary): string[] {
  const rows = summary.arms.map((a) => [a.arm, tokens(a.meanHelperInput), a.meanHelperCalls.toFixed(1)]);
  return [
    "## Helper overhead",
    "",
    "Subagent and helper-model tokens, kept out of the headline.",
    "",
    ...table(["arm", "helper input tokens (mean)", "helper calls (mean)"], rows),
  ];
}

function sessionSection(summary: ArmReportSummary): string[] {
  const rows = summary.arms.map((a) => [a.arm, tokens(a.meanSessionInput)]);
  return ["## Session total (reference only)", "", ...table(["arm", "session input tokens (mean)"], rows)];
}

function localizationSection(summary: ArmReportSummary): string[] {
  const rows = summary.arms.map((a) => {
    const loc = a.localization;
    return [a.arm, f1(loc?.file), f1(loc?.symbol), f1(loc?.line), String(loc?.scoredRuns ?? 0)];
  });
  return [
    "## Localization-F1 (reported, not optimised)",
    "",
    GOLD_PATCH_CAVEAT,
    "",
    ...table(["arm", "file F1", "symbol F1", "line F1", "scored runs"], rows),
  ];
}

function diagnosticsSection(summary: ArmReportSummary): string[] {
  const rows = summary.arms.map((a) => [
    a.arm,
    a.meanPreEditTurns === undefined ? "n/a" : a.meanPreEditTurns.toFixed(1),
    String(a.noEditRuns),
    f1(a.meanReadFileF1),
  ]);
  return [
    "## Diagnostics",
    "",
    "Read-localization is file-F1 of files read before the first edit and carries the same gold-patch caveat.",
    "",
    ...table(["arm", "pre-edit turns (mean)", "runs with no edit", "read-localization file F1"], rows),
  ];
}

function preamble(summary: ArmReportSummary): string[] {
  const baseline = summary.baselinePresent
    ? `Baseline: ${summary.baselineArm}.`
    : `Baseline: none (baseline arm ${summary.baselineArm} has no runs), so no deltas are reported.`;
  return [
    "# Coding-bench arm report",
    "",
    `${baseline} Arms rank by resolve rate, then main-ledger input tokens. Helper tokens print separately.`,
  ];
}

/** Markdown report: resolve rate beside the paired main-ledger delta, then helper, session, F1 and diagnostics. */
export function renderArmReport(summary: ArmReportSummary): string {
  const sections = [
    preamble(summary),
    headlineSection(summary),
    helperSection(summary),
    sessionSection(summary),
    localizationSection(summary),
    diagnosticsSection(summary),
  ];
  return `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
}
