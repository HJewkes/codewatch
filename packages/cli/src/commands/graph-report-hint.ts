import { windowSuffix, type GraphMetric } from "@titan-design/code-graph";
import type { ChurnWindow } from "@titan-design/code-graph/history";

export function hasChurnSignal(
  metrics: readonly GraphMetric[],
  windowDays: ChurnWindow,
): boolean {
  const name = `churn_${windowSuffix(windowDays)}`;
  return metrics.some((m) => m.name === name && (m.value ?? 0) > 0);
}

function suggestWiderWindow(windowDays: number): number {
  if (windowDays < 90) return 90;
  if (windowDays < 180) return 180;
  return windowDays * 2;
}

export const CHURN_UNAVAILABLE_HINT =
  "Churn and ownership are unavailable: this snapshot has no git history " +
  "(not a git tree, or indexed with --no-churn), so churn-based sections are empty.";

/** `graph index` stores no churn_* metric at all when it had no git history to read. */
export function hasNoChurnMetrics(metrics: readonly GraphMetric[]): boolean {
  return !metrics.some((m) => m.name.startsWith("churn_"));
}

export function emptyWindowHint(windowDays: ChurnWindow): string {
  // Lifetime already spans all of history — a wider window can't help; the repo
  // simply has no git churn (shallow clone, or non-git tree).
  if (windowDays === "lifetime") {
    return (
      "No churn over the repo's full git history — churn-based sections are " +
      "empty. Check that this is a full (non-shallow) git clone."
    );
  }
  const wider = suggestWiderWindow(windowDays);
  return (
    `No commits in the last ${windowDays}d — churn-based sections are ` +
    `empty. Try a wider window (\`--window-days ${wider}\`) or all-time ` +
    "(`--window-days lifetime`, if the snapshot was indexed with `--lifetime`)."
  );
}
