# Task 09: Aggregator

## Architectural Context

The aggregator is the statistical core of the pipeline. It receives raw `Observation[]` from all extractors (tasks 05-08), groups them by feature type, computes frequency distributions, identifies the dominant pattern per feature, calculates confidence scores using the formula `confidence = consistency_ratio * stability_weight`, maps confidence to severity levels, and outputs an `AggregatorResult` ready for AI enrichment and interactive review. This is a pure programmatic stage (zero tokens) that transforms raw observations into structured conventions.

The aggregator consists of four files matching the manifest: `index.ts` (orchestration and barrel export), `frequency.ts` (grouping and distribution computation), `confidence.ts` (stability weights and confidence formula), and `stability.ts` (RoPGen stability lookup table for all 85 features).

## File Ownership

**May modify:**
- `/packages/analyzer/src/aggregator/index.ts` (NEW)
- `/packages/analyzer/src/aggregator/frequency.ts` (NEW)
- `/packages/analyzer/src/aggregator/confidence.ts` (NEW)
- `/packages/analyzer/src/aggregator/stability.ts` (NEW)
- `/packages/analyzer/tests/aggregator/index.test.ts` (NEW)
- `/packages/analyzer/tests/aggregator/confidence.test.ts` (NEW)

**Must not touch:**
- `/packages/profile/**` (profile schema -- read only)
- `/packages/cli/**`
- `/packages/checker/**`
- `/packages/analyzer/src/extractors/**` (extractors are upstream, do not modify)
- `/docs/**`
- `/.claude/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/extractors/types.ts` (Observation type)
- `/packages/profile/src/schema/profile.ts` (ProfileSchema -- the aggregator output must map to this shape)
- `/packages/profile/src/schema/style-rule.ts` (StyleRule shape -- each aggregated feature maps to one)
- `/docs/research/07-unified-feature-taxonomy.md` (stability ratings per feature, all 85 features)
- `/docs/plans/2026-02-27-code-style-design.md` (aggregation stage description, confidence formula, severity thresholds)

## Steps

### Step 1: Create the stability lookup table

This is the data file -- derived directly from the unified feature taxonomy. Each observation type maps to a stability rating from RoPGen research.

**`/packages/analyzer/src/aggregator/stability.ts`**:

```ts
export type Stability = "high" | "medium" | "low";

/**
 * Stability lookup table derived from RoPGen research and the unified
 * feature taxonomy (docs/research/07-unified-feature-taxonomy.md).
 *
 * Key: observation type (e.g., "naming.variables").
 * Value: stability rating.
 *
 * High = persists even when developer tries to write differently (weight 1.0)
 * Medium = consistent under normal conditions (weight 0.85)
 * Low = varies by project/language/intent (weight 0.7)
 */
export const STABILITY_MAP: Record<string, Stability> = {
  // Category 1: Naming Conventions
  "naming.variables": "high",
  "naming.functions": "high",
  "naming.types": "high",
  "naming.constants": "high",
  "naming.files": "high",
  "naming.booleans": "medium",
  "naming.abbreviations": "medium",
  "naming.parameters": "medium",
  "naming.enums": "high",
  "naming.privateMembers": "high",

  // Category 2: Code Structure
  "structure.importGrouping": "high",
  "structure.importPathStyle": "medium",
  "structure.typeImportSeparation": "medium",
  "structure.exportStyle": "high",
  "structure.barrelFiles": "medium",
  "structure.exportProximity": "medium",
  "structure.functionLength": "high",
  "structure.nestingDepth": "high",
  "structure.fileLength": "medium",
  "structure.moduleTopology": "low",
  "structure.fileOrganization": "low",

  // Category 3: Control Flow Patterns
  "controlFlow.guardClauses": "high",
  "controlFlow.earlyReturn": "high",
  "controlFlow.ternaryPreference": "medium",
  "controlFlow.arrayMethods": "high",
  "controlFlow.forStyle": "medium",
  "controlFlow.asyncAwait": "high",
  "controlFlow.switchVsIf": "medium",
  "controlFlow.optionalChaining": "medium",
  "controlFlow.nullishCoalescing": "low",

  // Category 4: Error Handling
  "errorHandling.tryCatchFrequency": "high",
  "errorHandling.catchSpecificity": "medium",
  "errorHandling.resultType": "high",
  "errorHandling.errorReturnTuples": "medium",
  "errorHandling.customErrorClasses": "medium",
  "errorHandling.exhaustiveSwitch": "high",
  "errorHandling.assertNever": "high",
  "errorHandling.floatingPromises": "medium",
  "errorHandling.errorBoundary": "low",

  // Category 5: Documentation
  "documentation.jsdocPresence": "high",
  "documentation.publicPrivateCoverage": "medium",
  "documentation.inlineCommentDensity": "medium",
  "documentation.commentPlacement": "medium",
  "documentation.sectionComments": "low",
  "documentation.moduleHeaders": "medium",
  "documentation.jsdocTags": "medium",
  "documentation.voice": "low",
  "documentation.whyVsWhat": "low",
  "documentation.redundancy": "low",

  // Category 6: Type System Usage
  "typeSystem.annotationDensity": "high",
  "typeSystem.explicitReturn": "high",
  "typeSystem.moduleBoundaryTypes": "medium",
  "typeSystem.inferrableTypes": "medium",
  "typeSystem.interfaceVsType": "medium",
  "typeSystem.genericUsage": "low",
  "typeSystem.readonlyUsage": "medium",
  "typeSystem.discriminatedUnions": "medium",
  "typeSystem.utilityTypes": "low",

  // Category 7: Formatting & Layout
  "formatting.indentStyle": "high",
  "formatting.indentSize": "high",
  "formatting.semicolons": "high",
  "formatting.quoteStyle": "high",
  "formatting.trailingCommas": "high",
  "formatting.braceStyle": "high",
  "formatting.lineLength": "medium",
  "formatting.blankLines": "medium",
  "formatting.destructuring": "medium",
  "formatting.defaultParams": "low",
  "formatting.arrowVsFunction": "medium",
  "formatting.trailingNewline": "high",

  // Category 8: Higher-Level Patterns
  "patterns.compositionVsInheritance": "medium",
  "patterns.classVsFunctional": "high",
  "patterns.pureFunctions": "low",
  "patterns.immutability": "medium",
  "patterns.explicitVsImplicit": "medium",
  "patterns.dryAdherence": "medium",

  // Category 9: Habitual Idioms
  "idiom.clone": "high",
  "idiom.errorHandlingShape": "medium",
  "idiom.dataTransformation": "medium",
  "idiom.apiCallPattern": "medium",
  "idiom.testStructure": "medium",

  // Category 10: Review Voice
  "reviewVoice.topicFrequency": "medium",
  "reviewVoice.keyword": "medium",
  "reviewVoice.tone": "low",
  "reviewVoice.themes": "low",
  "reviewVoice.values": "low",

  // Complexity (from task-07)
  "complexity.functionLength": "high",
  "complexity.nestingDepth": "high",
  "complexity.cyclomatic": "high",
  "complexity.fileLength": "medium",
};

export function lookupStability(type: string): Stability {
  if (STABILITY_MAP[type]) return STABILITY_MAP[type];

  // Fall back to category-level default
  const category = type.indexOf(".") > 0 ? type.substring(0, type.indexOf(".")) : type;
  if (STABILITY_MAP[category]) return STABILITY_MAP[category];

  // Default to medium for unknown types
  return "medium";
}
```

### Step 2: Implement confidence computation

**`/packages/analyzer/src/aggregator/confidence.ts`**:

```ts
import type { Stability } from "./stability.js";

export type Severity = "error" | "warn" | "info" | "off";

export interface StabilityWeights {
  high: number;
  medium: number;
  low: number;
}

export interface SeverityThresholds {
  error: number;
  warn: number;
  info: number;
}

export const DEFAULT_STABILITY_WEIGHTS: StabilityWeights = {
  high: 1.0,
  medium: 0.85,
  low: 0.7,
};

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  error: 0.85,
  warn: 0.60,
  info: 0.40,
};

export function computeConfidence(
  consistency: number,
  stability: Stability,
  weights: StabilityWeights = DEFAULT_STABILITY_WEIGHTS,
): number {
  return Math.min(1.0, consistency * weights[stability]);
}

export function mapSeverity(
  confidence: number,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): Severity {
  if (confidence >= thresholds.error) return "error";
  if (confidence >= thresholds.warn) return "warn";
  if (confidence >= thresholds.info) return "info";
  return "off";
}
```

### Step 3: Implement frequency distribution computation

**`/packages/analyzer/src/aggregator/frequency.ts`**:

```ts
import type { Observation } from "../extractors/types.js";

export interface FrequencyDistribution {
  values: Map<string | number | boolean, number>;
  total: number;
  dominant: string | number | boolean;
  consistency: number;
}

export function groupByType(
  observations: Observation[],
): Map<string, Observation[]> {
  const groups = new Map<string, Observation[]>();

  for (const obs of observations) {
    const existing = groups.get(obs.type) ?? [];
    existing.push(obs);
    groups.set(obs.type, existing);
  }

  return groups;
}

export function computeDistribution(
  observations: Observation[],
): FrequencyDistribution {
  const valueCounts = new Map<string | number | boolean, number>();

  for (const obs of observations) {
    const key = normalizeValue(obs.value);
    valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
  }

  const total = observations.length;

  let dominant: string | number | boolean = "";
  let maxCount = 0;

  for (const [value, count] of valueCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = value;
    }
  }

  return {
    values: valueCounts,
    total,
    dominant,
    consistency: total > 0 ? maxCount / total : 0,
  };
}

function normalizeValue(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function selectExamples(
  observations: Observation[],
  maxExamples: number,
): Observation[] {
  if (observations.length <= maxExamples) {
    return [...observations];
  }

  const step = Math.floor(observations.length / maxExamples);
  const examples: Observation[] = [];

  for (
    let i = 0;
    i < observations.length && examples.length < maxExamples;
    i += step
  ) {
    examples.push(observations[i]);
  }

  return examples;
}
```

### Step 4: Write confidence-specific tests

**`/packages/analyzer/tests/aggregator/confidence.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import {
  computeConfidence,
  mapSeverity,
  DEFAULT_STABILITY_WEIGHTS,
  DEFAULT_SEVERITY_THRESHOLDS,
} from "../../src/aggregator/confidence.js";

describe("computeConfidence", () => {
  const weights = DEFAULT_STABILITY_WEIGHTS;

  it("returns consistency * 1.0 for high stability", () => {
    expect(computeConfidence(0.9, "high", weights)).toBeCloseTo(0.9, 2);
  });

  it("returns consistency * 0.85 for medium stability", () => {
    expect(computeConfidence(0.9, "medium", weights)).toBeCloseTo(0.765, 2);
  });

  it("returns consistency * 0.7 for low stability", () => {
    expect(computeConfidence(0.9, "low", weights)).toBeCloseTo(0.63, 2);
  });

  it("returns 0 for zero consistency", () => {
    expect(computeConfidence(0, "high", weights)).toBe(0);
  });

  it("clamps to 1.0 maximum", () => {
    expect(computeConfidence(1.0, "high", weights)).toBe(1.0);
  });

  it("handles perfect consistency with low stability", () => {
    expect(computeConfidence(1.0, "low", weights)).toBeCloseTo(0.7, 2);
  });

  it("handles partial consistency with medium stability", () => {
    expect(computeConfidence(0.5, "medium", weights)).toBeCloseTo(0.425, 2);
  });
});

describe("mapSeverity", () => {
  const thresholds = DEFAULT_SEVERITY_THRESHOLDS;

  it("maps >= 0.85 to error", () => {
    expect(mapSeverity(0.85, thresholds)).toBe("error");
    expect(mapSeverity(0.95, thresholds)).toBe("error");
    expect(mapSeverity(1.0, thresholds)).toBe("error");
  });

  it("maps >= 0.60 to warn", () => {
    expect(mapSeverity(0.60, thresholds)).toBe("warn");
    expect(mapSeverity(0.70, thresholds)).toBe("warn");
    expect(mapSeverity(0.84, thresholds)).toBe("warn");
  });

  it("maps >= 0.40 to info", () => {
    expect(mapSeverity(0.40, thresholds)).toBe("info");
    expect(mapSeverity(0.50, thresholds)).toBe("info");
    expect(mapSeverity(0.59, thresholds)).toBe("info");
  });

  it("maps < 0.40 to off", () => {
    expect(mapSeverity(0.39, thresholds)).toBe("off");
    expect(mapSeverity(0.1, thresholds)).toBe("off");
    expect(mapSeverity(0, thresholds)).toBe("off");
  });

  it("respects custom thresholds", () => {
    const strict = { error: 0.95, warn: 0.80, info: 0.60 };
    expect(mapSeverity(0.90, strict)).toBe("warn");
    expect(mapSeverity(0.75, strict)).toBe("info");
    expect(mapSeverity(0.55, strict)).toBe("off");
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/aggregator/confidence` -- expect failures.

### Step 5: Write aggregator integration tests

**`/packages/analyzer/tests/aggregator/index.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { Aggregator } from "../../src/aggregator/index.js";
import type { Observation } from "../../src/extractors/types.js";

function makeObservation(
  overrides: Partial<Observation> & Pick<Observation, "type" | "value">,
): Observation {
  return {
    file: "test.ts",
    line: 1,
    ...overrides,
  };
}

describe("Aggregator", () => {
  const aggregator = new Aggregator();

  describe("frequency distribution", () => {
    it("computes dominant value from observations", () => {
      const observations: Observation[] = [
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "snake_case" }),
        makeObservation({ type: "naming.variables", value: "snake_case" }),
      ];

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      expect(feature).toBeDefined();
      expect(feature!.convention).toBe("camelCase");
      expect(feature!.distribution.consistency).toBeCloseTo(0.6, 1);
    });

    it("computes distribution percentages correctly", () => {
      const observations: Observation[] = [
        makeObservation({ type: "formatting.quoteStyle", value: "single" }),
        makeObservation({ type: "formatting.quoteStyle", value: "single" }),
        makeObservation({ type: "formatting.quoteStyle", value: "single" }),
        makeObservation({ type: "formatting.quoteStyle", value: "double" }),
      ];

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("formatting.quoteStyle");

      expect(feature!.distribution.values.get("single")).toBe(3);
      expect(feature!.distribution.values.get("double")).toBe(1);
      expect(feature!.distribution.total).toBe(4);
      expect(feature!.distribution.consistency).toBeCloseTo(0.75, 2);
    });
  });

  describe("confidence scoring", () => {
    it("applies high stability weight (1.0) for naming.variables", () => {
      const observations: Observation[] = Array.from({ length: 10 }, () =>
        makeObservation({ type: "naming.variables", value: "camelCase" }),
      );

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      expect(feature!.confidence).toBeCloseTo(1.0, 2);
      expect(feature!.stability).toBe("high");
    });

    it("applies medium stability weight (0.85) for naming.booleans", () => {
      const observations: Observation[] = Array.from({ length: 10 }, () =>
        makeObservation({ type: "naming.booleans", value: "is-prefix" }),
      );

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.booleans");

      expect(feature!.confidence).toBeCloseTo(0.85, 2);
      expect(feature!.stability).toBe("medium");
    });

    it("applies low stability weight (0.7) for formatting.defaultParams", () => {
      const observations: Observation[] = Array.from({ length: 10 }, () =>
        makeObservation({ type: "formatting.defaultParams", value: "default-syntax" }),
      );

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("formatting.defaultParams");

      expect(feature!.confidence).toBeCloseTo(0.7, 2);
      expect(feature!.stability).toBe("low");
    });

    it("reduces confidence when consistency is low", () => {
      const observations: Observation[] = [
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "snake_case" }),
        makeObservation({ type: "naming.variables", value: "PascalCase" }),
        makeObservation({ type: "naming.variables", value: "kebab-case" }),
      ];

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      // consistency = 2/5 = 0.4, stability_weight = 1.0
      expect(feature!.confidence).toBeCloseTo(0.4, 2);
    });
  });

  describe("severity mapping", () => {
    it("maps high confidence to error severity", () => {
      const observations: Observation[] = Array.from({ length: 20 }, () =>
        makeObservation({ type: "naming.variables", value: "camelCase" }),
      );

      const result = aggregator.aggregate(observations);
      expect(result.features.get("naming.variables")!.severity).toBe("error");
    });

    it("maps medium confidence to warn severity", () => {
      const observations: Observation[] = [
        ...Array.from({ length: 7 }, () =>
          makeObservation({ type: "naming.variables", value: "camelCase" }),
        ),
        ...Array.from({ length: 3 }, () =>
          makeObservation({ type: "naming.variables", value: "snake_case" }),
        ),
      ];

      const result = aggregator.aggregate(observations);
      // consistency = 0.7, stability = 1.0, confidence = 0.7
      expect(result.features.get("naming.variables")!.severity).toBe("warn");
    });

    it("maps low confidence to info severity", () => {
      const observations: Observation[] = [
        ...Array.from({ length: 5 }, () =>
          makeObservation({ type: "naming.variables", value: "camelCase" }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeObservation({ type: "naming.variables", value: "snake_case" }),
        ),
      ];

      const result = aggregator.aggregate(observations);
      // consistency = 0.5, stability = 1.0, confidence = 0.5
      expect(result.features.get("naming.variables")!.severity).toBe("info");
    });

    it("maps very low confidence to off severity", () => {
      const observations: Observation[] = [
        makeObservation({ type: "formatting.defaultParams", value: "a" }),
        makeObservation({ type: "formatting.defaultParams", value: "b" }),
        makeObservation({ type: "formatting.defaultParams", value: "c" }),
      ];

      const result = aggregator.aggregate(observations);
      // consistency = 1/3 = 0.33, stability = 0.7, confidence = 0.23
      expect(result.features.get("formatting.defaultParams")!.severity).toBe("off");
    });
  });

  describe("review flagging", () => {
    it("flags low-confidence features for review", () => {
      const observations: Observation[] = [
        ...Array.from({ length: 5 }, () =>
          makeObservation({ type: "naming.variables", value: "camelCase" }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeObservation({ type: "naming.variables", value: "snake_case" }),
        ),
      ];

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      expect(feature!.needsReview).toBe(true);
      expect(result.reviewQueue).toContainEqual(
        expect.objectContaining({ type: "naming.variables" }),
      );
    });

    it("does not flag high-confidence features for review", () => {
      const observations: Observation[] = Array.from({ length: 20 }, () =>
        makeObservation({ type: "naming.variables", value: "camelCase" }),
      );

      const result = aggregator.aggregate(observations);
      expect(result.features.get("naming.variables")!.needsReview).toBe(false);
    });

    it("sorts review queue by confidence ascending", () => {
      const observations: Observation[] = [
        ...Array.from({ length: 3 }, () =>
          makeObservation({ type: "naming.variables", value: "camelCase" }),
        ),
        ...Array.from({ length: 3 }, () =>
          makeObservation({ type: "naming.variables", value: "snake_case" }),
        ),
        ...Array.from({ length: 2 }, () =>
          makeObservation({ type: "formatting.defaultParams", value: "x" }),
        ),
        makeObservation({ type: "formatting.defaultParams", value: "y" }),
      ];

      const result = aggregator.aggregate(observations);

      if (result.reviewQueue.length >= 2) {
        for (let i = 1; i < result.reviewQueue.length; i++) {
          expect(result.reviewQueue[i].confidence).toBeGreaterThanOrEqual(
            result.reviewQueue[i - 1].confidence,
          );
        }
      }
    });
  });

  describe("grouping", () => {
    it("groups observations by type and extracts category", () => {
      const observations: Observation[] = [
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.functions", value: "camelCase" }),
        makeObservation({ type: "formatting.semicolons", value: true }),
      ];

      const result = aggregator.aggregate(observations);

      expect(result.features.size).toBe(3);
      expect(result.features.get("naming.variables")!.category).toBe("naming");
      expect(result.features.get("formatting.semicolons")!.category).toBe("formatting");
    });
  });

  describe("summary statistics", () => {
    it("computes correct totals", () => {
      const observations: Observation[] = [
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "naming.variables", value: "camelCase" }),
        makeObservation({ type: "formatting.semicolons", value: true }),
      ];

      const result = aggregator.aggregate(observations);

      expect(result.summary.totalObservations).toBe(3);
      expect(result.summary.totalFeatures).toBe(2);
      expect(result.summary.avgConfidence).toBeGreaterThan(0);
    });
  });

  describe("examples", () => {
    it("keeps representative observations as examples (max 5)", () => {
      const observations: Observation[] = Array.from(
        { length: 10 },
        (_, i) =>
          makeObservation({
            type: "naming.variables",
            value: "camelCase",
            file: `file${i}.ts`,
            line: i + 1,
          }),
      );

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      expect(feature!.examples.length).toBeLessThanOrEqual(5);
      expect(feature!.examples.length).toBeGreaterThan(0);
    });
  });

  describe("unknown types", () => {
    it("aggregates unknown observation types with medium stability", () => {
      const observations: Observation[] = Array.from({ length: 10 }, () =>
        makeObservation({ type: "future.newFeature", value: "something" }),
      );

      const result = aggregator.aggregate(observations);
      const feature = result.features.get("future.newFeature");

      expect(feature).toBeDefined();
      expect(feature!.stability).toBe("medium");
      expect(feature!.confidence).toBeCloseTo(0.85, 2);
    });
  });

  describe("custom config", () => {
    it("accepts custom severity thresholds", () => {
      const strictAggregator = new Aggregator({
        severityThresholds: {
          error: 0.95,
          warn: 0.80,
          info: 0.60,
        },
      });

      const observations: Observation[] = [
        ...Array.from({ length: 10 }, () =>
          makeObservation({ type: "naming.variables", value: "camelCase" }),
        ),
        makeObservation({ type: "naming.variables", value: "snake_case" }),
      ];

      const result = strictAggregator.aggregate(observations);
      const feature = result.features.get("naming.variables");

      // consistency = 10/11 = 0.91, confidence = 0.91
      // With strict thresholds: 0.91 < 0.95 => not error, >= 0.80 => warn
      expect(feature!.severity).toBe("warn");
    });

    it("accepts custom stability weights", () => {
      const customAggregator = new Aggregator({
        stabilityWeights: { high: 1.0, medium: 0.9, low: 0.8 },
      });

      const observations: Observation[] = Array.from({ length: 10 }, () =>
        makeObservation({ type: "naming.booleans", value: "is-prefix" }),
      );

      const result = customAggregator.aggregate(observations);
      // consistency = 1.0, custom medium weight = 0.9
      expect(result.features.get("naming.booleans")!.confidence).toBeCloseTo(0.9, 2);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/aggregator` -- expect failures.

### Step 6: Implement the aggregator

**`/packages/analyzer/src/aggregator/index.ts`**:

```ts
import type { Observation } from "../extractors/types.js";
import {
  computeConfidence,
  mapSeverity,
  DEFAULT_STABILITY_WEIGHTS,
  DEFAULT_SEVERITY_THRESHOLDS,
  type StabilityWeights,
  type SeverityThresholds,
  type Severity,
} from "./confidence.js";
import {
  groupByType,
  computeDistribution,
  selectExamples,
  type FrequencyDistribution,
} from "./frequency.js";
import { lookupStability, type Stability } from "./stability.js";

export { computeConfidence, mapSeverity } from "./confidence.js";
export { lookupStability, type Stability } from "./stability.js";
export type { FrequencyDistribution } from "./frequency.js";
export type { Severity, StabilityWeights, SeverityThresholds } from "./confidence.js";

export interface AggregatedFeature {
  type: string;
  category: string;
  convention: string | number | boolean | string[];
  distribution: FrequencyDistribution;
  confidence: number;
  stability: Stability;
  severity: Severity;
  needsReview: boolean;
  examples: Observation[];
}

export interface AggregatorConfig {
  stabilityWeights?: StabilityWeights;
  severityThresholds?: SeverityThresholds;
  reviewThreshold?: number;
  maxExamples?: number;
}

export interface AggregatorResult {
  features: Map<string, AggregatedFeature>;
  reviewQueue: AggregatedFeature[];
  summary: {
    totalObservations: number;
    totalFeatures: number;
    avgConfidence: number;
    featuresNeedingReview: number;
  };
}

export class Aggregator {
  private stabilityWeights: StabilityWeights;
  private severityThresholds: SeverityThresholds;
  private reviewThreshold: number;
  private maxExamples: number;

  constructor(config?: AggregatorConfig) {
    this.stabilityWeights = config?.stabilityWeights ?? DEFAULT_STABILITY_WEIGHTS;
    this.severityThresholds = config?.severityThresholds ?? DEFAULT_SEVERITY_THRESHOLDS;
    this.reviewThreshold = config?.reviewThreshold ?? 0.60;
    this.maxExamples = config?.maxExamples ?? 5;
  }

  aggregate(observations: Observation[]): AggregatorResult {
    const grouped = groupByType(observations);
    const features = new Map<string, AggregatedFeature>();
    const reviewQueue: AggregatedFeature[] = [];

    for (const [type, typeObservations] of grouped) {
      const distribution = computeDistribution(typeObservations);
      const category = this.extractCategory(type);
      const stability = lookupStability(type);
      const confidence = computeConfidence(
        distribution.consistency,
        stability,
        this.stabilityWeights,
      );
      const severity = mapSeverity(confidence, this.severityThresholds);
      const needsReview = confidence < this.reviewThreshold;
      const examples = selectExamples(typeObservations, this.maxExamples);

      const feature: AggregatedFeature = {
        type,
        category,
        convention: distribution.dominant,
        distribution,
        confidence,
        stability,
        severity,
        needsReview,
        examples,
      };

      features.set(type, feature);

      if (needsReview) {
        reviewQueue.push(feature);
      }
    }

    reviewQueue.sort((a, b) => a.confidence - b.confidence);

    const confidences = Array.from(features.values()).map((f) => f.confidence);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

    return {
      features,
      reviewQueue,
      summary: {
        totalObservations: observations.length,
        totalFeatures: features.size,
        avgConfidence,
        featuresNeedingReview: reviewQueue.length,
      },
    };
  }

  private extractCategory(type: string): string {
    const dotIndex = type.indexOf(".");
    return dotIndex > 0 ? type.substring(0, dotIndex) : type;
  }
}
```

### Step 7: Run all tests and verify

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm test -- packages/analyzer/tests/aggregator/index.test.ts packages/analyzer/tests/aggregator/confidence.test.ts
pnpm typecheck
```

### Step 8: Commit

```bash
git add packages/analyzer/src/aggregator/ packages/analyzer/tests/aggregator/
git commit -m "Add aggregator with frequency analysis, stability-weighted confidence, and severity mapping"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer/tests/aggregator/index.test.ts` passes all tests
- [ ] `pnpm test -- packages/analyzer/tests/aggregator/confidence.test.ts` passes all tests
- [ ] `pnpm typecheck` exits 0 with no errors in modified files
- [ ] `Aggregator` groups observations by type
- [ ] `Aggregator` computes frequency distributions with dominant value and consistency ratio
- [ ] `computeConfidence` applies stability weights: high=1.0, medium=0.85, low=0.7
- [ ] `mapSeverity` maps confidence to error (>=0.85), warn (>=0.60), info (>=0.40), off (<0.40)
- [ ] Low-confidence features are flagged for interactive review (below 0.60 threshold)
- [ ] Review queue is sorted by confidence ascending (least confident first)
- [ ] `STABILITY_MAP` in stability.ts covers all 85 features from the unified taxonomy
- [ ] Unknown observation types default to medium stability (not dropped)
- [ ] Custom config overrides (thresholds, weights, reviewThreshold) work correctly
- [ ] Summary statistics (totalObservations, totalFeatures, avgConfidence, featuresNeedingReview) are accurate
- [ ] Representative examples are capped at maxExamples (default 5) per feature

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use AI/LLM in the aggregator** -- this is a pure statistical stage; all computation is arithmetic over observation counts
5. **Do not hard-code stability ratings inline in the aggregator** -- maintain a single `STABILITY_MAP` in `stability.ts` that matches the unified feature taxonomy; the aggregator references it via `lookupStability()`
6. **Do not drop observations with unknown types** -- aggregate them with default medium stability; unknown types may come from future extractors or plugins
7. **Do not mutate input observations** -- the aggregator must be a pure function; create new data structures for results
8. **Do not combine frequency.ts and confidence.ts into a single file** -- keep them separate per the manifest for clear responsibility boundaries
