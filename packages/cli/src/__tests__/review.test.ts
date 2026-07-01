import { describe, it, expect, vi } from "vitest";
import type { StyleRule, Profile } from "@codewatch/profile";
import type { ReviewPromptDeps } from "../interactive/types.js";

describe("presentRule", () => {
  it("formats a high-confidence rule with convention and examples", async () => {
    const { presentRule } = await import("../interactive/presenters.js");
    const rule: StyleRule = {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      fixability: "maybe-incorrect",
      description: "Use camelCase for all local variables.",
      examples: [
        { good: "const userProfile = fetchUser();", source: "repo/src/a.ts:42" },
        { bad: "const up = fetchUser();" },
      ],
    };
    const output = presentRule("naming", "variables", rule);
    expect(output).toContain("naming");
    expect(output).toContain("variables");
    expect(output).toContain("camelCase");
    expect(output).toContain("94%");
  });

  it("formats a rule with no examples", async () => {
    const { presentRule } = await import("../interactive/presenters.js");
    const rule: StyleRule = {
      convention: true,
      confidence: 0.99,
      stability: "high",
    };
    const output = presentRule("formatting", "semicolons", rule);
    expect(output).toContain("formatting");
    expect(output).toContain("semicolons");
    expect(output).toContain("true");
  });

  it("includes stability when present", async () => {
    const { presentRule } = await import("../interactive/presenters.js");
    const rule: StyleRule = {
      convention: "PascalCase",
      confidence: 0.88,
      stability: "low",
    };
    const output = presentRule("naming", "types", rule);
    expect(output).toContain("low");
  });
});

describe("reviewProfile", () => {
  const makeProfile = (): Profile => ({
    schemaVersion: "1.0.0",
    author: "testuser",
    generated: "2026-02-27",
    sources: ["owner/repo"],
    naming: {
      variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
      functions: { convention: "camelCase", confidence: 0.97, stability: "high" },
    },
    structure: {
      importOrder: {
        convention: ["builtin", "external", "internal", "relative"],
        confidence: 0.91,
      },
    },
    documentation: {},
    errorHandling: {},
    formatting: {
      semicolons: { convention: true, confidence: 0.99, stability: "high" },
    },
    patterns: {},
    idioms: { detected: [] },
    antiPatterns: { acknowledged: [] },
    overrides: [],
    severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
  });

  it("confirms all rules when user accepts everything", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockResolvedValue("confirm"),
      adjustRule: vi.fn(),
    };

    const result = await reviewProfile(profile, deps);

    expect(result.naming.variables?.convention).toBe("camelCase");
    expect(result.naming.functions?.convention).toBe("camelCase");
    expect(result.formatting.semicolons?.convention).toBe(true);
    expect(deps.selectAction).toHaveBeenCalled();
    expect(deps.adjustRule).not.toHaveBeenCalled();
  });

  it("removes rejected rules from the profile", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    let callCount = 0;
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? "reject" : "confirm");
      }),
      adjustRule: vi.fn(),
    };

    const result = await reviewProfile(profile, deps);

    expect(result.naming.variables).toBeUndefined();
    expect(result.naming.functions?.convention).toBe("camelCase");
  });

  it("calls adjustRule when user chooses adjust", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    let callCount = 0;
    const adjustedRule: StyleRule = {
      convention: "snake_case",
      confidence: 0.80,
      stability: "medium",
      description: "User prefers snake_case",
    };
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? "adjust" : "confirm");
      }),
      adjustRule: vi.fn().mockResolvedValue(adjustedRule),
    };

    const result = await reviewProfile(profile, deps);

    expect(deps.adjustRule).toHaveBeenCalledOnce();
    expect(result.naming.variables?.convention).toBe("snake_case");
    expect(result.naming.variables?.confidence).toBe(0.80);
  });

  it("auto-confirms rules above threshold when autoConfirmAbove is set", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockResolvedValue("confirm"),
      adjustRule: vi.fn(),
    };

    const result = await reviewProfile(profile, deps, { autoConfirmAbove: 0.95 });

    // Rules with confidence > 0.95 are auto-confirmed (functions: 0.97, semicolons: 0.99)
    // Rules <= 0.95 still get prompted (variables: 0.94, importOrder: 0.91)
    const totalRules = 4;
    const autoConfirmed = 2;
    const prompted = totalRules - autoConfirmed;
    expect(deps.selectAction).toHaveBeenCalledTimes(prompted);
    expect(result.naming.functions?.convention).toBe("camelCase");
  });

  it("preserves non-rule profile fields unchanged", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockResolvedValue("confirm"),
      adjustRule: vi.fn(),
    };

    const result = await reviewProfile(profile, deps);

    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.author).toBe("testuser");
    expect(result.sources).toEqual(["owner/repo"]);
    expect(result.severityThresholds).toEqual({ error: 0.85, warn: 0.60, info: 0.40 });
  });

  it("does not mutate the original profile", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    let callCount = 0;
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? "reject" : "confirm");
      }),
      adjustRule: vi.fn(),
    };

    await reviewProfile(profile, deps);

    expect(profile.naming.variables).toBeDefined();
    expect(profile.naming.variables?.convention).toBe("camelCase");
  });
});
