import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MapResult } from "@titan-design/workflow";
import type { TriageItem } from "./triage-items.js";
import type { ReusedVerdict } from "./triage-persist.js";
import type { VerdictRow } from "./triage-prompt.js";
import type { Verdict } from "./triage-questions.js";
import type { CallTrace, TriageHarness } from "./triage-runner.js";
import type { ControlReport, ControlRun } from "./triage-score.js";
import type { DroppedRow } from "./triage-verify.js";

/** A verified verdict as written to verdicts.jsonl. */
export interface VerdictRecord extends VerdictRow {
  path: string;
  signal: string;
  tool: string;
  symbol?: string;
  excerptHash: string;
  model: string;
  /** This verdict's share of its call's reported cost. */
  costUsd: number;
  runId: string;
  /** "model" when this run asked the reader; "carried" when carry-forward copied it from an earlier snapshot. */
  provenance: "model" | "carried";
  carriedFrom?: number;
  controlRun: ControlRun;
}

export interface TriageReport {
  runId: string;
  snapshotId: number;
  model: string;
  harness: TriageHarness;
  settings: { minRank: number; includeTests: boolean; budgetUsd: number; concurrency: number };
  wallMs: number;
  cost: { spentUsd: number; estimateUsd: number };
  calls: { planned: number; succeeded: number; failed: { id: string; error: string }[] };
  stoppedBy: MapResult<TriageItem>["stoppedBy"];
  skipped: { id: string; path: string; control: boolean }[];
  /** Questions sent in real bundles that returned, and the verified verdicts written for them. */
  verdicts: { asked: number; written: number; byLabel: Record<Verdict, number> };
  dropped: { total: number; byReason: Record<string, number>; rows: DroppedRow[] };
  /** Verdicts in graph.db: carried from an earlier snapshot, fresh from this run, and questions skipped because one existed. */
  verdictStore: { carriedFrom: number | null; carried: number; fresh: number; skippedByVerdict: number; reused: ReusedVerdict[] };
  controls: ControlReport;
  observedModels: string[];
  traces: CallTrace[];
  warnings: string[];
}

export function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

export function verdictCounts(records: readonly VerdictRecord[]): Record<Verdict, number> {
  return { confirmed: 0, justified: 0, unclear: 0, ...countBy(records, (r) => r.verdict) };
}

export function skippedOf(mapped: MapResult<TriageItem>): TriageReport["skipped"] {
  return mapped.skipped.map(({ item }) => ({ id: item.id, path: item.path, control: item.control !== undefined }));
}

export function writeTriageOutputs(outDir: string, records: readonly VerdictRecord[], report: TriageReport): void {
  mkdirSync(outDir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(path.join(outDir, "verdicts.jsonl"), lines === "" ? "" : `${lines}\n`);
  writeFileSync(path.join(outDir, "triage.json"), `${JSON.stringify(report, null, 2)}\n`);
}

function controlAccuracy(controls: TriageReport["controls"]): string {
  if (controls.status !== "run") return "not run";
  const notRun = controls.controls.filter((c) => !c.reached).length;
  return `${controls.score.correct}/${controls.score.total} correct, run ${controls.controlRun}${notRun > 0 ? `, ${notRun} not run` : ""}`;
}

export function formatTriageSummary(report: TriageReport, outDir: string): string[] {
  const { verdicts, dropped, controls, cost } = report;
  const accuracy = controlAccuracy(controls);
  const lines = [
    `codewatch triage: ${verdicts.written} verdicts (${verdicts.byLabel.confirmed} confirmed, ${verdicts.byLabel.justified} justified, ${verdicts.byLabel.unclear} unclear), ${dropped.total} dropped, of ${verdicts.asked} questions asked`,
    `  controls ${accuracy}; cost $${cost.spentUsd.toFixed(2)} (estimate $${cost.estimateUsd.toFixed(2)}); ${report.calls.succeeded}/${report.calls.planned} calls in ${(report.wallMs / 1000).toFixed(0)}s`,
  ];
  const store = report.verdictStore;
  if (store.skippedByVerdict > 0) lines.push(`  ${store.skippedByVerdict} questions skipped for an existing verdict (${store.carried} carried from snapshot ${store.carriedFrom ?? "none"})`);
  if (report.stoppedBy) lines.push(`  stopped by ${report.stoppedBy}: ${report.skipped.length} bundles skipped`);
  lines.push(`  wrote ${path.join(outDir, "verdicts.jsonl")} and triage.json`);
  return lines;
}
