import type { GraphScoreResult } from "./graph-score.js";
import type { ScoreRun } from "./score-history.js";

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

function runRef(run: ScoreRun): string {
  const ref = run.commit ? run.commit.slice(0, 7) : `snapshot ${run.snapshotId}`;
  return `${ref} ${run.at.slice(0, 10)}`;
}

function headline(result: GraphScoreResult): string {
  const score = `score ${result.run.score.toFixed(1)}`;
  if (!result.previous || !result.delta) return `${score} (no previous run)`;
  return `${score} (Δ ${signed(result.delta.score)} vs ${runRef(result.previous)})`;
}

function componentLines(result: GraphScoreResult): string[] {
  const width = Math.max(...result.run.components.map((c) => c.label.length));
  return result.run.components.map((c) => {
    const change = result.delta ? `  ${signed(result.delta.components[c.label] ?? 0).padStart(6)}` : "";
    return `  ${c.label.padEnd(width)}  ${`-${c.penalty.toFixed(1)}`.padStart(5)}${change}  ${c.detail}`;
  });
}

function trendLines(result: GraphScoreResult): string[] {
  if (result.trend.length < 2) return [];
  const rows = result.trend.map(({ run, delta }) => {
    const change = delta === undefined ? "" : `  ${signed(delta)}`;
    return `  ${runRef(run)}  ${run.score.toFixed(1).padStart(5)}${change}`;
  });
  return ["", `Trend (last ${result.trend.length}, formula v${result.run.formulaVersion}, newest first)`, ...rows];
}

export function formatGraphScoreText(result: GraphScoreResult): string {
  return [headline(result), ...componentLines(result), ...trendLines(result)].join("\n");
}

export function formatGraphScoreJson(result: GraphScoreResult): string {
  const { run, previous, delta, trend } = result;
  return JSON.stringify({ ...run, previous, delta, trend }, null, 2);
}
