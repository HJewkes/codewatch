/**
 * The churn-window vocabulary, split out of the churn-hot `churn.ts` so the
 * lifetime type + suffix helper add no lines to that file (C-71).
 *
 * A churn window is either a rolling N-day window or `"lifetime"` = all of git
 * history (no `--since` bound). Lifetime mode lets codewatch audit an unfamiliar
 * repo cold, where any recent rolling slice is thin relative to the repo's whole
 * life, so a windowed view reads an established repo as nearly churn-free.
 */
export type ChurnWindow = number | "lifetime";

/** Metric-name suffix for a window: `30d`, `180d`, … or `lifetime`. */
export function windowSuffix(window: ChurnWindow): string {
  return window === "lifetime" ? "lifetime" : `${window}d`;
}
