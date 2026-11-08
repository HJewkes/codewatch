import { computeHealth, type HealthComponent } from "./dashboard-health.js";

/**
 * The version of {@link computeScore}. Scores are only comparable within one version, so any
 * change to a weight, cap or component bumps it; v1 is never edited in place.
 */
export const SCORE_FORMULA_VERSION = 1;

export interface ScoreInputs {
  /** Files at or over the hotspot cutoff. */
  scary: number;
  /** Fitness violations, excluding the scary-hotspots rule the hotspot component already owns. */
  violations: number;
  maxComplexity: number;
  hiddenCoupling: number;
  /** Mass-weighted SCBench erosion, 0..1. */
  erosion: number;
  /** Mass-weighted share of import weight inside value-import cycles, 0..1. */
  cyclicMassValue: number;
}

export interface ScoreResult {
  score: number;
  formulaVersion: number;
  components: HealthComponent[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function scbenchComponents(x: ScoreInputs): HealthComponent[] {
  return [
    {
      label: "erosion",
      penalty: Math.min(15, round1(x.erosion * 50)),
      detail: `${round1(x.erosion * 100)}% of complexity mass in functions over CC 10`,
    },
    {
      label: "value cycles",
      penalty: Math.min(10, round1(x.cyclicMassValue * 40)),
      detail: `${round1(x.cyclicMassValue * 100)}% of import weight in value-import cycles`,
    },
  ];
}

/**
 * Formula v1: the dashboard's four health penalties plus SCBench erosion and value-cycle mass,
 * capped to 100 points in total. Violations all count as carried, so the score of a tree does not
 * depend on which run came before it.
 */
export function computeScore(x: ScoreInputs): ScoreResult {
  const { healthBreakdown } = computeHealth({
    scary: x.scary,
    newViolations: 0,
    carryViolations: x.violations,
    maxComplexity: x.maxComplexity,
    hiddenCoupling: x.hiddenCoupling,
  });
  const components = [...healthBreakdown, ...scbenchComponents(x)];
  const total = components.reduce((s, c) => s + c.penalty, 0);
  return {
    score: round1(Math.max(0, 100 - total)),
    formulaVersion: SCORE_FORMULA_VERSION,
    components,
  };
}
