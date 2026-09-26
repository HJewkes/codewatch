import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteGateStore, gateMigration } from "@titan-design/hitl/sqlite";
import { openDatabase, runMigrations } from "@titan-design/store-sqlite";
import {
  WorkflowRuntime,
  mapItems,
  workflowMigration,
  workflowOwnershipMigration,
  type MapResult,
  type StepRunner,
  type WorkflowEvent,
} from "@titan-design/workflow";
import type { TriageItem } from "./triage-items.js";
import { renderPrompt } from "./triage-prompt.js";

const WORKFLOW = "codewatch-triage";
export const READ_STEP = "read";

export interface FanOutOptions {
  dbPath: string;
  runner: StepRunner;
  model: string;
  concurrency: number;
  budgetUsd: number;
  /** Retryable reader failures tolerated before launches stop. */
  maxFailures?: number;
  onProgress?: (line: string) => void;
}

function progress(options: FanOutOptions, total: number): (event: WorkflowEvent) => void {
  let done = 0;
  return (event) => {
    if (event.type === "step_complete") options.onProgress?.(`[${++done}/${total}] ${event.stepId}`);
    if (event.type === "step_failed") options.onProgress?.(`failed ${event.stepId}: ${event.error}`);
  };
}

/** One durable workflow run that sends every item to the reader under the concurrency and budget caps. */
export async function fanOutReads(items: readonly TriageItem[], options: FanOutOptions): Promise<MapResult<TriageItem>> {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  const db = openDatabase(options.dbPath);
  try {
    runMigrations(db, [gateMigration(1), workflowMigration(2), workflowOwnershipMigration(3)]);
    const gates = new SqliteGateStore(db, { migrate: false });
    // Excerpts are code, so the prompt must not go through `{{NAME}}` substitution.
    const runtime = new WorkflowRuntime({ db, gates, runner: options.runner, render: (t) => t, onEvent: progress(options, items.length) });
    let mapped: MapResult<TriageItem> | undefined;
    runtime.register(WORKFLOW, async (ctx) => {
      const read = (item: TriageItem, stepId: string) => ctx.dispatch(stepId, renderPrompt(item), { model: options.model });
      mapped = await mapItems(ctx, READ_STEP, items, read, { key: (item) => item.id, concurrency: options.concurrency, budgetUsd: options.budgetUsd, maxFailures: options.maxFailures });
    });
    const run = await runtime.wait(runtime.start(WORKFLOW));
    runtime.shutdown();
    if (!mapped) throw new Error(`triage workflow ended ${run.status}: ${run.error ?? "no result"}`);
    return mapped;
  } finally {
    db.close();
  }
}
