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

/**
 * Fitness budgets that anchor Dossier metric heat, mirroring `.codewatch/check.json`
 * (and `computeHealth`'s complexity budget of 30). Heating a file's metric against
 * the same threshold the checker uses means the Dossier predicts which files trip a
 * rule — the color IS the fitness verdict, not an arbitrary gradient.
 */
export const METRIC_BUDGET: Record<string, number> = {
  loc: 350,
  cognitive_max: 30,
  cyclomatic_max: 30,
  max_nesting_depth: 5,
  fan_out: 15,
};

/**
 * Heat a metric value against its budget: over budget → error (will/does trip the
 * rule), within 75% → warning (approaching), else calm. Quiet-when-fine keeps the
 * panel from lighting up every small file — only genuine pressure draws the eye.
 */
export function metricHeat(value: number, budget: number | undefined): string {
  if (budget === undefined) return cw.text; // no budget (e.g. fan_in) — never a risk on its own
  if (value >= budget) return cw.error;
  if (value >= budget * 0.75) return cw.warning;
  return cw.text;
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
 * Trim a repo-rooted id to its package + leaf for compact display. Prefixing the
 * package (not the immediate parent dir) is what disambiguates a monorepo: many
 * packages have a src/indexer.ts, so "…/src/indexer.ts" collapses them, whereas
 * "graph/…/indexer.ts" stays distinct. Barrels keep the same package prefix.
 */
export function shortId(id: string): string {
  const parts = id.split("/");
  const leaf = parts[parts.length - 1] ?? id;
  if (parts.length <= 2) return id;
  const pkg = pkgOf(id);
  if (/^index\.[a-z]+$/i.test(leaf)) {
    return `${pkg}/${leaf}`;
  }
  return `${pkg}/…/${leaf}`;
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
