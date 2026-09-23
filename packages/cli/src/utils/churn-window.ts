import type { ChurnWindow } from "@titan-design/code-graph/history";

/** Parse `--window-days`: a day count, or the literal `lifetime` for all-time. */
export function parseChurnWindow(s: string | undefined): ChurnWindow | undefined {
  if (s === undefined) return undefined;
  if (s.toLowerCase() === "lifetime") return "lifetime";
  const days = Number(s);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --window-days "${s}": expected a positive day count or "lifetime".`);
  }
  return days;
}

/** Human label for a window: `last 30d` or `all-time`. */
export function describeChurnWindow(window: ChurnWindow): string {
  return window === "lifetime" ? "all-time" : `last ${window}d`;
}
