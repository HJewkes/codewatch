import * as fs from "node:fs";
import * as path from "node:path";
import type { HealthComponent } from "./dashboard-health.js";

/** One `graph score` run, one line of the history file. */
export interface ScoreRun {
  formulaVersion: number;
  score: number;
  components: HealthComponent[];
  commit: string | null;
  snapshotId: number;
  /** ISO timestamp of the run. */
  at: string;
}

export interface ScoreHistory {
  runs: ScoreRun[];
  /** Lines that did not parse as a run. */
  skipped: number;
}

export interface ScoreDelta {
  score: number;
  /** Current minus previous penalty, per component label. */
  components: Record<string, number>;
}

function isScoreRun(v: unknown): v is ScoreRun {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<ScoreRun>;
  return (
    typeof r.formulaVersion === "number" &&
    typeof r.score === "number" &&
    Array.isArray(r.components) &&
    typeof r.at === "string"
  );
}

function parseLine(line: string): ScoreRun | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isScoreRun(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Runs in file order, oldest first. A missing file is an empty history. */
export function readScoreHistory(file: string): ScoreHistory {
  if (!fs.existsSync(file)) return { runs: [], skipped: 0 };
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim() !== "");
  const runs: ScoreRun[] = [];
  for (const line of lines) {
    const run = parseLine(line);
    if (run) runs.push(run);
  }
  return { runs, skipped: lines.length - runs.length };
}

export function appendScoreRun(file: string, run: ScoreRun): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(run) + "\n", "utf-8");
}

/** The most recent run scored under `formulaVersion`, if any. */
export function previousComparable(
  runs: readonly ScoreRun[],
  formulaVersion: number,
): ScoreRun | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]!.formulaVersion === formulaVersion) return runs[i];
  }
  return undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreDelta(current: ScoreRun, previous: ScoreRun): ScoreDelta {
  const before = new Map(previous.components.map((c) => [c.label, c.penalty]));
  const components: Record<string, number> = {};
  for (const c of current.components) {
    components[c.label] = round1(c.penalty - (before.get(c.label) ?? 0));
  }
  return { score: round1(current.score - previous.score), components };
}
