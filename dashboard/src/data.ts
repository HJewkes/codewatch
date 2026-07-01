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
