import { randomUUID } from "node:crypto";
import path from "node:path";
import { pickControls, placeControls } from "@titan-design/evidence";
import type { MapResult, StepRunner } from "@titan-design/workflow";
import { loadControls } from "./triage-controls/controls.js";
import type { Control } from "./triage-controls/types.js";
import { bundleItems, controlItem, type TriageItem } from "./triage-items.js";
import { planTriage, type TriagePlan, type TriagePlanOptions } from "./triage-plan.js";
import { preflightAuth, readerRunner, type CallTrace } from "./triage-runner.js";
import { countBy, skippedOf, verdictCounts, writeTriageOutputs, type TriageReport, type VerdictRecord } from "./triage-output.js";
import { persistVerdicts } from "./triage-persist.js";
import { scoreControlItems, type ControlReport } from "./triage-score.js";
import { verifyItemOutput, type DroppedRow, type VerifiedRow } from "./triage-verify.js";
import { fanOutReads, READ_STEP } from "./triage-workflow.js";

export const DEFAULT_CONTROL_COUNT = 4;
/** Ceiling on any single reader call, so one runaway call cannot eat the run's budget. */
const MAX_CALL_USD = 1;

export interface TriageRunOptions extends TriagePlanOptions {
  model: string;
  concurrency: number;
  budgetUsd: number;
  out?: string;
  /** The control pool; defaults to the planted corpus. */
  controls?: readonly Control[];
  controlCount?: number;
  /** Seeds control picks and positions; defaults to a fresh run id. */
  seed?: string;
  /** Replaces the model reader (tests); auth preflight is skipped when set. */
  runner?: StepRunner;
  onProgress?: (line: string) => void;
}

export interface TriageRunResult {
  outDir: string;
  report: TriageReport;
  verdicts: VerdictRecord[];
}

interface Verified {
  kept: Map<string, VerifiedRow[]>;
  dropped: DroppedRow[];
  costShare: Map<string, number>;
}

/** Half the picks from each label, so every run plants both clean and slop controls. */
function pickBalanced(pool: readonly Control[], seed: string, n: number): Control[] {
  const clean = pool.filter((c) => c.label === "clean");
  const slop = pool.filter((c) => c.label === "slop");
  return [...pickControls(clean, seed, Math.floor(n / 2)), ...pickControls(slop, seed, Math.ceil(n / 2))];
}

/** Controls only measure a run that reads real bundles, so a fully judged plan makes no calls at all. */
function workItems(plan: TriagePlan, options: TriageRunOptions, runId: string): TriageItem[] {
  if (plan.bundles.length === 0) return [];
  const pool = options.controls ?? loadControls();
  const controls = pickBalanced(pool, runId, options.controlCount ?? DEFAULT_CONTROL_COUNT).map(controlItem);
  const { sequence } = placeControls(bundleItems(plan.bundles, plan.keys, plan.source), controls, runId);
  return sequence.map((entry) => entry.value);
}

function verifyAll(mapped: MapResult<TriageItem>): Verified {
  const out: Verified = { kept: new Map(), dropped: [], costShare: new Map() };
  for (const { item, result } of mapped.results) {
    const verification = verifyItemOutput(item, result.output);
    out.kept.set(item.id, verification.kept);
    out.dropped.push(...verification.dropped);
    const cost = result.usage?.costUsd ?? 0;
    out.costShare.set(item.id, verification.returned > 0 ? cost / verification.returned : 0);
  }
  return out;
}

function modelByItem(traces: readonly CallTrace[], fallback: string): (id: string) => string {
  const byStep = new Map(traces.map((t) => [t.stepId, t.model]));
  return (id) => byStep.get(`${READ_STEP}/${id}`) ?? fallback;
}

function toRecords(items: readonly TriageItem[], verified: Verified, controls: ControlReport, runId: string, modelOf: (id: string) => string): VerdictRecord[] {
  return items
    .filter((item) => !item.control)
    .flatMap((item) =>
      (verified.kept.get(item.id) ?? []).map(({ row, question }) => ({
        ...row,
        path: question.finding.path,
        signal: question.finding.signal,
        tool: question.finding.tool,
        ...(question.finding.symbol ? { symbol: question.finding.symbol } : {}),
        excerptHash: question.excerptHash,
        model: modelOf(item.id),
        costUsd: verified.costShare.get(item.id) ?? 0,
        runId,
        provenance: "model" as const,
        controlRun: controls.controlRun,
      })),
    );
}

interface ReportInput {
  plan: TriagePlan;
  options: TriageRunOptions;
  runId: string;
  startedAt: number;
  mapped: MapResult<TriageItem>;
  verified: Verified;
  controls: ControlReport;
  records: VerdictRecord[];
  traces: CallTrace[];
}

function verdictStoreOf(plan: TriagePlan, records: readonly VerdictRecord[]): TriageReport["verdictStore"] {
  const { from, carried, reused } = plan.verdicts;
  return { carriedFrom: from ?? null, carried, fresh: records.length, skippedByVerdict: reused.length, reused };
}

function buildReport(input: ReportInput): TriageReport {
  const { plan, options, mapped, verified, records } = input;
  const asked = mapped.results.filter((r) => !r.item.control).reduce((n, r) => n + r.item.questions.length, 0);
  const observed = input.traces.flatMap((t) => (t.model ? [t.model] : []));
  return {
    runId: input.runId,
    snapshotId: plan.snapshotId,
    model: options.model,
    settings: { minRank: options.minRank, includeTests: options.includeTests, budgetUsd: options.budgetUsd, concurrency: options.concurrency },
    wallMs: Date.now() - input.startedAt,
    cost: { spentUsd: mapped.spentUsd, estimateUsd: plan.estimate.costUsd },
    calls: { planned: mapped.results.length + mapped.failed.length + mapped.skipped.length, succeeded: mapped.results.length, failed: mapped.failed.map((f) => ({ id: f.key, error: f.error })) },
    stoppedBy: mapped.stoppedBy,
    skipped: skippedOf(mapped),
    verdicts: { asked, written: records.length, byLabel: verdictCounts(records) },
    dropped: { total: verified.dropped.length, byReason: countBy(verified.dropped, (d) => d.reason), rows: verified.dropped },
    verdictStore: verdictStoreOf(plan, records),
    controls: input.controls,
    observedModels: [...new Set(observed)],
    traces: input.traces,
    warnings: plan.warnings,
  };
}

/** Runs the reader over every selected bundle plus planted controls, verifies each verdict, and writes verdicts.jsonl and triage.json. */
export async function runTriage(options: TriageRunOptions): Promise<TriageRunResult> {
  const startedAt = Date.now();
  const root = path.resolve(options.path);
  const outDir = path.resolve(options.out ?? path.join(root, ".codewatch", "audit"));
  const traces: CallTrace[] = [];
  if (!options.runner) preflightAuth();
  const runner = options.runner ?? readerRunner({ cwd: root, maxCallUsd: Math.min(MAX_CALL_USD, options.budgetUsd || MAX_CALL_USD), traces });
  const plan = planTriage(options);
  const runId = options.seed ?? randomUUID();
  const items = workItems(plan, options, runId);
  const mapped = await fanOutReads(items, { ...options, runner, dbPath: path.join(outDir, "triage.sqlite3") });
  const verified = verifyAll(mapped);
  const controls = scoreControlItems(items, verified.kept);
  const records = toRecords(items, verified, controls, runId, modelByItem(traces, options.model));
  const known = new Map([...plan.keys].map(([finding, key]) => [key, finding]));
  const view = persistVerdicts(plan.dbPath, plan.snapshotId, records, known);
  const report = buildReport({ plan, options, runId, startedAt, mapped, verified, controls, records, traces });
  writeTriageOutputs(outDir, view, report);
  return { outDir, report, verdicts: records };
}
