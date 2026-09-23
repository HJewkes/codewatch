import { describe, it, expect } from "vitest";
import type {
  AggregatedFeature,
  AggregatorResult,
} from "@titan-design/style-analyzer";
import { ProfileSchema } from "@titan-design/style-profile";
import { profileFromAggregation } from "../commands/profile-from-aggregation.js";

function feature(
  type: string,
  category: AggregatedFeature["category"],
  overrides: Partial<AggregatedFeature> = {},
): AggregatedFeature {
  return {
    type,
    category,
    convention: "camelCase",
    distribution: { total: 10, counts: { camelCase: 9, snake_case: 1 } },
    confidence: 0.9,
    stability: "high",
    severity: "error",
    needsReview: false,
    examples: [
      { type, category, value: "fooBar", file: "src/a.ts", line: 3 },
    ],
    ...overrides,
  } as AggregatedFeature;
}

function aggregation(features: AggregatedFeature[]): AggregatorResult {
  return {
    features: new Map(features.map((f) => [f.type, f])),
    reviewQueue: [],
    summary: {
      totalObservations: 0,
      totalFeatures: features.length,
      avgConfidence: 0.9,
      featuresNeedingReview: 0,
    },
  };
}

const META = { author: "octo", sources: ["octo/repo"], generated: "2026-09-22" };

describe("profileFromAggregation", () => {
  it("produces a profile that passes schema validation", () => {
    const profile = profileFromAggregation(
      aggregation([feature("naming.variable", "naming")]),
      META,
    );
    const parsed = ProfileSchema.safeParse(profile);
    expect(parsed.success).toBe(true);
    expect(profile.author).toBe("octo");
    expect(profile.sources).toEqual(["octo/repo"]);
    expect(profile.generated).toBe("2026-09-22");
  });

  it("places each category in its profile section under the unprefixed rule name", () => {
    const profile = profileFromAggregation(
      aggregation([
        feature("naming.variable", "naming"),
        feature("structure.import-order", "structure", { convention: "grouped" }),
        feature("documentation.jsdoc", "documentation", { convention: true }),
        feature("error-handling.try-catch", "error-handling", { convention: 0.4 }),
        feature("formatting.quotes", "formatting", { convention: "double" }),
        feature("control-flow.guard-clause", "control-flow", { convention: true }),
        feature("complexity.fileLength", "complexity", { convention: 120 }),
        feature("idiom.clone", "idioms", { convention: "spread" }),
      ]),
      META,
    );
    expect(profile.naming.variable?.convention).toBe("camelCase");
    expect(profile.structure["import-order"]?.convention).toBe("grouped");
    expect(profile.documentation.jsdoc?.convention).toBe(true);
    expect(profile.errorHandling["try-catch"]?.convention).toBe(0.4);
    expect(profile.formatting.quotes?.convention).toBe("double");
    expect(profile.patterns["guard-clause"]?.convention).toBe(true);
    expect(profile.patterns.fileLength?.convention).toBe(120);
    expect(profile.patterns.clone?.convention).toBe("spread");
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("drops review-voice features, which are not code conventions", () => {
    const profile = profileFromAggregation(
      aggregation([feature("reviewVoice.keyword", "reviewVoice", { convention: "nit" })]),
      META,
    );
    const rules = [
      profile.naming, profile.structure, profile.documentation,
      profile.errorHandling, profile.formatting, profile.patterns,
    ].flatMap((section) => Object.keys(section));
    expect(rules).toEqual([]);
  });

  it("carries confidence, stability, and up to three examples onto the rule", () => {
    const examples = Array.from({ length: 5 }, (_, i) => ({
      type: "naming.variable", category: "naming" as const,
      value: `v${i}`, file: "src/a.ts", line: i + 1,
    }));
    const profile = profileFromAggregation(
      aggregation([feature("naming.variable", "naming", { confidence: 0.72, stability: "medium", examples })]),
      META,
    );
    const rule = profile.naming.variable!;
    expect(rule.confidence).toBe(0.72);
    expect(rule.stability).toBe("medium");
    expect(rule.examples).toHaveLength(3);
    expect(rule.examples?.[0]).toEqual({ good: "v0", source: "src/a.ts:1" });
  });
});
