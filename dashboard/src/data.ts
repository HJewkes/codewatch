import type { CodewatchData } from "./types";
import { SAMPLE_DATA } from "./sample-data";

/**
 * Resolve the dashboard payload. In a generated report, `graph dashboard`
 * injects `window.__CODEWATCH__`. Falling back to the bundled sample keeps
 * `vite dev` and the committed build meaningful.
 */
export function loadData(): CodewatchData {
  return window.__CODEWATCH__ ?? SAMPLE_DATA;
}

/**
 * Per-window payloads for client-side window switching. `graph dashboard`
 * pre-computes 30/90/180-day windows; null when only a single payload exists.
 */
export function loadWindows(): Record<string, CodewatchData> | null {
  return window.__CODEWATCH_WINDOWS__ ?? null;
}

/** Base64 of the embedded Cytoscape dependency graph (for a data-URI iframe). */
export function loadGraphHtml(): string | null {
  return window.__CODEWATCH_GRAPH__ ?? null;
}
