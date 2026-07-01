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

/** The "scary hotspot" fitness threshold (churn × complexity). Files at or above
 * trip the `scary-hotspots` rule; the dashboard draws this as an iso-line. */
export const SCARY_SCORE = 3000;

/** Severity heat for a hotspot score (churn × complexity). */
export function hotspotColor(score: number): string {
  if (score >= SCARY_SCORE) return cw.error;
  if (score >= 1000) return cw.warning;
  return cw.info;
}

export function severityColor(sev: "error" | "warning"): string {
  return sev === "error" ? cw.error : cw.warning;
}

/** Modularity Q band (0..1, higher = cleaner package boundaries). */
export function modularityColor(q: number): string {
  if (q >= 0.6) return cw.success;
  if (q >= 0.4) return cw.warning;
  return cw.error;
}

export function modularityVerdict(q: number): string {
  if (q >= 0.6) return "clean boundaries";
  if (q >= 0.4) return "some cross-package leakage";
  return "tangled boundaries";
}

/**
 * Translucent tint of a token color. react-native-web's color normalizer drops
 * `color-mix()` (→ transparent), so derive rgba from the token's fallback hex.
 */
export function tint(color: string, alpha: number): string {
  const m = color.match(/#([0-9a-fA-F]{6})/);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Trim a repo-rooted id to its leaf + one parent for compact display. Barrel
 * files (index.*) get their package prefixed so a monorepo's many index.ts
 * don't all collapse to the same label.
 */
export function shortId(id: string): string {
  const parts = id.split("/");
  const leaf = parts[parts.length - 1] ?? id;
  if (/^index\.[a-z]+$/i.test(leaf) && parts.length > 2) {
    return `${pkgOf(id)}/${leaf}`;
  }
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
