/**
 * Shared visual helpers. Colors reference Titan's semantic CSS variables
 * (defined by `@titan-design/react-ui/theme/global.css`) so the dashboard
 * tracks the design system rather than hard-coding hex.
 */

export const cw = {
  bg: "var(--color-surface-base, #101010)",
  surface: "var(--color-surface-elevated, #161616)",
  raised: "var(--color-surface-raised, #1e1e1e)",
  border: "var(--color-border-subtle, #2a2a2a)",
  text: "var(--color-text-primary, #f2f2f2)",
  textDim: "var(--color-text-secondary, #9aa0a6)",
  textFaint: "var(--color-text-tertiary, #6b7280)",
  brand: "var(--color-brand-primary, #FF7900)",
  success: "var(--color-status-success, #14B8A6)",
  error: "var(--color-status-error, #D14343)",
  warning: "var(--color-status-warning, #FFB020)",
  info: "var(--color-status-info, #2196F3)",
} as const;

/** Health band → semantic color. Higher score = healthier. */
export function healthColor(score: number): string {
  if (score >= 80) return cw.success;
  if (score >= 60) return cw.warning;
  return cw.error;
}

/** Severity heat for a hotspot score (churn × complexity). */
export function hotspotColor(score: number): string {
  if (score >= 3000) return cw.error;
  if (score >= 1000) return cw.warning;
  return cw.info;
}

export function severityColor(sev: "error" | "warning"): string {
  return sev === "error" ? cw.error : cw.warning;
}

/** Trim a repo-rooted id to its leaf + one parent for compact display. */
export function shortId(id: string): string {
  const parts = id.split("/");
  if (parts.length <= 2) return id;
  return "…/" + parts.slice(-2).join("/");
}

export function pkgOf(id: string): string {
  const m = id.match(/^packages\/([^/]+)/);
  if (m) return m[1];
  const first = id.split("/")[0];
  return first || "(root)";
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
