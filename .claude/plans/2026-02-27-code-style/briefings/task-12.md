# Task 12: Interactive Review Session

## Architectural Context

After the aggregator and AI enricher produce a draft profile, the interactive review session walks the user through every detected pattern for confirmation. This is pipeline stage 5 from the design doc. The user sees each category, rule, convention, confidence, and example code, then chooses to confirm, reject, or adjust each item. Adjustments include changing the confidence level, modifying the convention value, or adding a description. The module uses `@inquirer/prompts` for all interactive input and produces a finalized `Profile` ready for saving. Presenters handle the formatting of each rule type into human-readable terminal output using chalk.

## File Ownership

**May modify:**
- `/packages/cli/src/interactive/review.ts`
- `/packages/cli/src/interactive/presenters.ts`
- `/packages/cli/src/interactive/types.ts`
- `/packages/cli/src/__tests__/review.test.ts`

**Must not touch:**
- `/packages/profile/src/schema/**`
- `/packages/analyzer/src/**`
- `/packages/cli/src/commands/init.ts`
- `/packages/cli/src/utils/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/schema/profile.ts` (Profile type, category structure)
- `/packages/profile/src/schema/style-rule.ts` (StyleRule, Stability, Fixability)
- `/packages/cli/src/utils/output.ts` (formatConfidence, formatSeverity helpers)
- `/packages/cli/src/commands/init.ts` (how review is called from pipeline)
- `/docs/plans/2026-02-27-code-style-design.md` (Stage 5: Interactive Review section)

## Steps

### Step 1: Write review types

Create `/packages/cli/src/interactive/types.ts`:

```ts
import type { StyleRule } from "@code-style/profile";

export type ReviewAction = "confirm" | "reject" | "adjust";

export interface ReviewDecision {
  action: ReviewAction;
  rule: StyleRule;
  category: string;
  ruleName: string;
}

export interface AdjustedRule extends StyleRule {
  userModified: boolean;
}

export interface ReviewSessionOptions {
  skipConfirmed?: boolean;
  autoConfirmAbove?: number;
}

export interface ReviewPromptDeps {
  selectAction: (rule: StyleRule, category: string, ruleName: string) => Promise<ReviewAction>;
  adjustRule: (rule: StyleRule) => Promise<StyleRule>;
}
```

### Step 2: Write failing tests

Create `/packages/cli/src/__tests__/review.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { StyleRule, Profile } from "@code-style/profile";
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
    expect(output).toContain("camelCase");
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
      importOrder: { convention: ["builtin", "external", "internal", "relative"], confidence: 0.91 },
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
        // Reject the first rule (naming.variables), confirm the rest
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

  it("auto-confirms rules above threshold when skipConfirmed is set", async () => {
    const { reviewProfile } = await import("../interactive/review.js");
    const profile = makeProfile();
    const deps: ReviewPromptDeps = {
      selectAction: vi.fn().mockResolvedValue("confirm"),
      adjustRule: vi.fn(),
    };

    const result = await reviewProfile(profile, deps, { autoConfirmAbove: 0.95 });

    // Rules with confidence > 0.95 are auto-confirmed (functions: 0.97, semicolons: 0.99)
    // Rules <= 0.95 still get prompted (variables: 0.94, importOrder: 0.91)
    const totalRules = 4; // variables, functions, importOrder, semicolons
    const autoConfirmed = 2; // functions (0.97), semicolons (0.99)
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
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 3: Implement presenters

Create `/packages/cli/src/interactive/presenters.ts`:

```ts
import chalk from "chalk";
import type { StyleRule } from "@code-style/profile";

export function presentRule(
  category: string,
  ruleName: string,
  rule: StyleRule,
): string {
  const lines: string[] = [];
  const pct = Math.round(rule.confidence * 100);
  const confidenceColor =
    pct >= 85 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.blue;

  lines.push("");
  lines.push(
    chalk.bold.cyan(`[${category}]`) +
      " " +
      chalk.bold(ruleName) +
      "  " +
      confidenceColor(`${pct}%`) +
      (rule.stability ? chalk.dim(` (${rule.stability} stability)`) : ""),
  );

  const conventionStr =
    typeof rule.convention === "object"
      ? JSON.stringify(rule.convention)
      : String(rule.convention);
  lines.push(`  Convention: ${chalk.white.bold(conventionStr)}`);

  if (rule.fixability) {
    lines.push(`  Fixability: ${chalk.dim(rule.fixability)}`);
  }

  if (rule.description) {
    lines.push(`  ${chalk.italic(rule.description)}`);
  }

  if (rule.examples && rule.examples.length > 0) {
    lines.push("  Examples:");
    for (const ex of rule.examples) {
      if (ex.good) {
        lines.push(chalk.green(`    + ${ex.good}`));
        if (ex.source) {
          lines.push(chalk.dim(`      from ${ex.source}`));
        }
      }
      if (ex.bad) {
        lines.push(chalk.red(`    - ${ex.bad}`));
      }
    }
  }

  return lines.join("\n");
}

export function presentCategoryHeader(category: string, ruleCount: number): string {
  return (
    "\n" +
    chalk.bold.underline(`Category: ${category}`) +
    chalk.dim(` (${ruleCount} rule${ruleCount !== 1 ? "s" : ""})`) +
    "\n"
  );
}

export function presentAutoConfirm(
  category: string,
  ruleName: string,
  confidence: number,
): string {
  const pct = Math.round(confidence * 100);
  return chalk.dim(
    `  Auto-confirmed ${category}.${ruleName} (${pct}% confidence)`,
  );
}
```

### Step 4: Implement review session

Create `/packages/cli/src/interactive/review.ts`:

```ts
import { select, input, number } from "@inquirer/prompts";
import type { StyleRule, Profile } from "@code-style/profile";
import type {
  ReviewAction,
  ReviewPromptDeps,
  ReviewSessionOptions,
} from "./types.js";
import {
  presentRule,
  presentCategoryHeader,
  presentAutoConfirm,
} from "./presenters.js";

const REVIEWABLE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
] as const;

type ReviewableCategory = (typeof REVIEWABLE_CATEGORIES)[number];

function defaultPromptDeps(): ReviewPromptDeps {
  return {
    selectAction: async (rule, category, ruleName) => {
      console.log(presentRule(category, ruleName, rule));
      const action = await select<ReviewAction>({
        message: "Action:",
        choices: [
          { name: "Confirm", value: "confirm" },
          { name: "Reject (remove from profile)", value: "reject" },
          { name: "Adjust (modify convention/confidence)", value: "adjust" },
        ],
      });
      return action;
    },
    adjustRule: async (rule) => {
      const newConvention = await input({
        message: `Convention (current: ${String(rule.convention)}):`,
        default: String(rule.convention),
      });

      const newConfidence = await number({
        message: `Confidence 0-100 (current: ${Math.round(rule.confidence * 100)}):`,
        default: Math.round(rule.confidence * 100),
        min: 0,
        max: 100,
      });

      const newDescription = await input({
        message: `Description (current: ${rule.description ?? "none"}):`,
        default: rule.description ?? "",
      });

      return {
        ...rule,
        convention: newConvention || rule.convention,
        confidence: (newConfidence ?? Math.round(rule.confidence * 100)) / 100,
        description: newDescription || rule.description,
      };
    },
  };
}

export async function reviewProfile(
  profile: Profile,
  deps?: ReviewPromptDeps,
  options?: ReviewSessionOptions,
): Promise<Profile> {
  const prompts = deps ?? defaultPromptDeps();
  const autoThreshold = options?.autoConfirmAbove ?? Infinity;

  const result: Profile = {
    ...profile,
    naming: { ...profile.naming },
    structure: { ...profile.structure },
    documentation: { ...profile.documentation },
    errorHandling: { ...profile.errorHandling },
    formatting: { ...profile.formatting },
    patterns: { ...profile.patterns },
  };

  for (const category of REVIEWABLE_CATEGORIES) {
    const section = profile[category];
    if (!section || typeof section !== "object") continue;

    const entries = Object.entries(section as Record<string, StyleRule>);
    if (entries.length === 0) continue;

    for (const [ruleName, rule] of entries) {
      if (!rule || typeof rule !== "object" || !("confidence" in rule)) continue;

      if (rule.confidence > autoThreshold) {
        console.log(presentAutoConfirm(category, ruleName, rule.confidence));
        continue;
      }

      const action = await prompts.selectAction(rule, category, ruleName);

      switch (action) {
        case "confirm":
          break;
        case "reject": {
          const cat = result[category] as Record<string, StyleRule>;
          delete cat[ruleName];
          break;
        }
        case "adjust": {
          const adjusted = await prompts.adjustRule(rule);
          const cat = result[category] as Record<string, StyleRule>;
          cat[ruleName] = adjusted;
          break;
        }
      }
    }
  }

  return result;
}

export async function runReviewSession(enrichedProfile: unknown): Promise<Profile> {
  const profile = enrichedProfile as Profile;
  return reviewProfile(profile);
}
```

Run: `pnpm --filter @code-style/cli test` -- all review tests should pass.

### Step 5: Verify

```bash
pnpm --filter @code-style/cli test
pnpm --filter @code-style/cli typecheck
```

### Step 6: Commit

```bash
git add packages/cli/src/interactive/review.ts packages/cli/src/interactive/presenters.ts \
       packages/cli/src/interactive/types.ts packages/cli/src/__tests__/review.test.ts
git commit -m "Add interactive review session with confirm/reject/adjust per rule"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/cli test` passes all review tests
- [ ] `pnpm --filter @code-style/cli typecheck` exits 0
- [ ] `presentRule` formats rule with category, name, convention, confidence, stability, examples
- [ ] `reviewProfile` with all "confirm" actions preserves all rules unchanged
- [ ] `reviewProfile` with "reject" removes the rule from the output profile
- [ ] `reviewProfile` with "adjust" calls `adjustRule` and applies the returned rule
- [ ] `autoConfirmAbove` threshold skips prompts for high-confidence rules
- [ ] Non-rule profile fields (author, sources, severityThresholds) pass through unchanged
- [ ] Review session is fully testable via injected `ReviewPromptDeps`

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not call @inquirer/prompts directly in testable functions** -- inject prompt dependencies via `ReviewPromptDeps` so tests can mock user input without patching modules
5. **Do not mutate the input profile** -- create a shallow copy of each category section before modifying; the original profile must be unchanged after review
6. **Do not present idioms and antiPatterns through the same rule review flow** -- those have different shapes (array of objects vs record of rules); this task reviews only the category-based StyleRule sections
7. **Do not skip the presentation step** -- always call `presentRule` before asking for action so the user sees context before deciding
