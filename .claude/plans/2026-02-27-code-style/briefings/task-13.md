# Task 13: show + diff Commands

## Architectural Context

The `show` and `diff` commands are read-only CLI commands in the `cli` package. `show` pretty-prints the loaded profile using chalk, with optional category filtering and JSON output. `diff` runs extractors on staged/changed git files only, compares observations against the existing profile, and reports deviations -- optionally auto-fixing via the checker. Both commands depend on the CLI framework from Task 11 and the profile I/O from Task 2.

## File Ownership

**May modify:**
- `/packages/cli/src/commands/show.ts`
- `/packages/cli/src/commands/diff.ts`
- `/packages/cli/src/commands/index.ts` (register new commands)
- `/packages/cli/src/__tests__/show.test.ts`
- `/packages/cli/src/__tests__/diff.test.ts`

**Must not touch:**
- `/packages/profile/src/schema/**`
- `/packages/analyzer/src/extractors/**`
- `/packages/checker/src/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/index.ts` (profile loading API)
- `/packages/profile/src/schema/profile.ts` (profile schema + types)
- `/packages/cli/src/index.ts` (CLI entry point and commander setup)
- `/packages/cli/src/commands/init.ts` (pattern for how commands are registered)
- `/docs/plans/2026-02-27-code-style-design.md` (CLI design section)

## Steps

### Step 1: Write failing tests for `show` command

Create `/packages/cli/src/__tests__/show.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { formatProfileText, formatProfileJson } from "../commands/show.js";
import type { StyleProfile } from "@code-style/profile";

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: ["testuser/repo-a"],
  naming: {
    variables: {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      fixability: "maybe-incorrect",
      description: "Use camelCase for all local variables.",
      examples: [],
    },
    functions: {
      convention: "camelCase",
      confidence: 0.97,
      stability: "high",
    },
    types: {
      convention: "PascalCase",
      confidence: 0.99,
      stability: "high",
    },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
      fixability: "safe",
    },
  },
  formatting: {
    semicolons: {
      convention: true,
      confidence: 0.99,
      stability: "high",
      fixability: "safe",
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("formatProfileText", () => {
  it("includes author and generation date", () => {
    const output = formatProfileText(sampleProfile);
    expect(output).toContain("testuser");
    expect(output).toContain("2026-02-27");
  });

  it("displays all categories when no filter is provided", () => {
    const output = formatProfileText(sampleProfile);
    expect(output).toContain("naming");
    expect(output).toContain("structure");
    expect(output).toContain("formatting");
  });

  it("filters to a single category when --category is provided", () => {
    const output = formatProfileText(sampleProfile, "naming");
    expect(output).toContain("naming");
    expect(output).not.toContain("structure");
    expect(output).not.toContain("formatting");
  });

  it("shows confidence as a severity indicator", () => {
    const output = formatProfileText(sampleProfile);
    // 0.94 confidence with 0.85 error threshold should show error severity
    expect(output).toMatch(/error|ERR/i);
  });

  it("throws for an unknown category filter", () => {
    expect(() => formatProfileText(sampleProfile, "nonexistent")).toThrow(
      /unknown category/i,
    );
  });
});

describe("formatProfileJson", () => {
  it("returns valid JSON string of entire profile", () => {
    const json = formatProfileJson(sampleProfile);
    const parsed = JSON.parse(json);
    expect(parsed.author).toBe("testuser");
  });

  it("returns only the requested category when filtered", () => {
    const json = formatProfileJson(sampleProfile, "naming");
    const parsed = JSON.parse(json);
    expect(parsed.variables).toBeDefined();
    expect(parsed.importOrder).toBeUndefined();
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 2: Implement `show` command

Create `/packages/cli/src/commands/show.ts`:

```ts
import chalk from "chalk";
import type { StyleProfile } from "@code-style/profile";

const PROFILE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
  "idioms",
  "antiPatterns",
] as const;

type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

function severityLabel(
  confidence: number,
  thresholds: StyleProfile["severityThresholds"],
): string {
  if (confidence >= thresholds.error) return chalk.red("error");
  if (confidence >= thresholds.warn) return chalk.yellow("warn");
  if (confidence >= thresholds.info) return chalk.blue("info");
  return chalk.dim("skip");
}

function formatRule(
  name: string,
  rule: { convention?: unknown; confidence?: number; stability?: string },
  thresholds: StyleProfile["severityThresholds"],
): string {
  const conf = rule.confidence ?? 0;
  const severity = severityLabel(conf, thresholds);
  const stability = rule.stability ? chalk.dim(`[${rule.stability}]`) : "";
  const value =
    typeof rule.convention === "object"
      ? JSON.stringify(rule.convention)
      : String(rule.convention);
  return `  ${severity} ${chalk.bold(name)}: ${value}  ${chalk.dim(`(${(conf * 100).toFixed(0)}%)`)} ${stability}`;
}

function validateCategory(category: string): asserts category is ProfileCategory {
  if (!PROFILE_CATEGORIES.includes(category as ProfileCategory)) {
    throw new Error(`Unknown category: "${category}". Valid categories: ${PROFILE_CATEGORIES.join(", ")}`);
  }
}

export function formatProfileText(
  profile: StyleProfile,
  category?: string,
): string {
  if (category) {
    validateCategory(category);
  }

  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Style Profile: ${profile.author}`));
  lines.push(
    chalk.dim(`Generated: ${profile.generated}  Sources: ${profile.sources.join(", ")}`),
  );
  lines.push("");

  const thresholds = profile.severityThresholds;
  const categoriesToShow = category
    ? [category as ProfileCategory]
    : PROFILE_CATEGORIES;

  for (const cat of categoriesToShow) {
    const section = profile[cat];
    if (!section || typeof section !== "object") continue;

    lines.push(chalk.bold.cyan(`[${cat}]`));
    const entries = Array.isArray(section)
      ? []
      : Object.entries(section as Record<string, unknown>);

    for (const [name, rule] of entries) {
      if (rule && typeof rule === "object" && "confidence" in (rule as Record<string, unknown>)) {
        lines.push(formatRule(name, rule as { convention?: unknown; confidence?: number; stability?: string }, thresholds));
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatProfileJson(
  profile: StyleProfile,
  category?: string,
): string {
  if (category) {
    validateCategory(category);
    const section = profile[category as ProfileCategory];
    return JSON.stringify(section, null, 2);
  }
  return JSON.stringify(profile, null, 2);
}
```

Register the command in `/packages/cli/src/commands/index.ts`:

```ts
import { Command } from "commander";
import { loadProfile } from "@code-style/profile";
import { formatProfileText, formatProfileJson } from "./show.js";

export function registerShowCommand(program: Command): void {
  program
    .command("show")
    .description("Pretty-print current style profile")
    .option("--category <name>", "Filter to a single category")
    .option("--json", "Output raw JSON")
    .option("--profile <path>", "Path to profile file")
    .action(async (options) => {
      const profile = await loadProfile(options.profile);
      if (options.json) {
        console.log(formatProfileJson(profile, options.category));
      } else {
        console.log(formatProfileText(profile, options.category));
      }
    });
}
```

Run: `pnpm --filter @code-style/cli test` -- show tests should pass.

### Step 3: Write failing tests for `diff` command

Create `/packages/cli/src/__tests__/diff.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { diffAgainstProfile } from "../commands/diff.js";
import type { StyleProfile } from "@code-style/profile";
import type { Observation } from "@code-style/analyzer";

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {
    variables: {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("diffAgainstProfile", () => {
  it("reports no deviations when code matches profile", () => {
    const observations: Observation[] = [
      { type: "naming.variables", value: "camelCase", file: "src/app.ts", line: 5 },
      { type: "naming.variables", value: "camelCase", file: "src/app.ts", line: 12 },
    ];
    const result = diffAgainstProfile(sampleProfile, observations);
    expect(result.deviations).toHaveLength(0);
    expect(result.summary.total).toBe(2);
    expect(result.summary.matching).toBe(2);
  });

  it("reports deviations when code diverges from profile", () => {
    const observations: Observation[] = [
      { type: "naming.variables", value: "snake_case", file: "src/app.ts", line: 3 },
      { type: "naming.variables", value: "camelCase", file: "src/app.ts", line: 10 },
    ];
    const result = diffAgainstProfile(sampleProfile, observations);
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0].file).toBe("src/app.ts");
    expect(result.deviations[0].line).toBe(3);
    expect(result.deviations[0].expected).toBe("camelCase");
    expect(result.deviations[0].found).toBe("snake_case");
  });

  it("includes severity based on confidence thresholds", () => {
    const observations: Observation[] = [
      { type: "naming.variables", value: "snake_case", file: "src/app.ts", line: 1 },
    ];
    const result = diffAgainstProfile(sampleProfile, observations);
    // 0.94 confidence with 0.85 error threshold = error
    expect(result.deviations[0].severity).toBe("error");
  });

  it("returns summary with deviation count", () => {
    const observations: Observation[] = [
      { type: "naming.variables", value: "snake_case", file: "a.ts", line: 1 },
      { type: "naming.variables", value: "PascalCase", file: "b.ts", line: 1 },
      { type: "naming.variables", value: "camelCase", file: "c.ts", line: 1 },
    ];
    const result = diffAgainstProfile(sampleProfile, observations);
    expect(result.summary.total).toBe(3);
    expect(result.summary.matching).toBe(1);
    expect(result.summary.deviating).toBe(2);
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 4: Implement `diff` command logic

Create `/packages/cli/src/commands/diff.ts`:

```ts
import { execSync } from "node:child_process";
import type { StyleProfile } from "@code-style/profile";
import type { Observation } from "@code-style/analyzer";

export interface Deviation {
  file: string;
  line: number;
  rule: string;
  expected: string;
  found: string;
  severity: "error" | "warn" | "info";
}

export interface DiffResult {
  deviations: Deviation[];
  summary: {
    total: number;
    matching: number;
    deviating: number;
  };
}

function getSeverity(
  confidence: number,
  thresholds: StyleProfile["severityThresholds"],
): "error" | "warn" | "info" {
  if (confidence >= thresholds.error) return "error";
  if (confidence >= thresholds.warn) return "warn";
  return "info";
}

function resolveProfileRule(
  profile: StyleProfile,
  observationType: string,
): { convention: unknown; confidence: number } | undefined {
  const [category, rule] = observationType.split(".");
  const section = profile[category as keyof StyleProfile];
  if (!section || typeof section !== "object") return undefined;
  const ruleObj = (section as Record<string, unknown>)[rule];
  if (!ruleObj || typeof ruleObj !== "object") return undefined;
  const typed = ruleObj as { convention?: unknown; confidence?: number };
  if (typed.convention === undefined || typed.confidence === undefined) return undefined;
  return { convention: typed.convention, confidence: typed.confidence };
}

export function diffAgainstProfile(
  profile: StyleProfile,
  observations: Observation[],
): DiffResult {
  const deviations: Deviation[] = [];
  let matching = 0;

  for (const obs of observations) {
    const profileRule = resolveProfileRule(profile, obs.type);
    if (!profileRule) continue;

    const expected = String(profileRule.convention);
    const found = String(obs.value);

    if (found === expected) {
      matching++;
    } else {
      deviations.push({
        file: obs.file,
        line: obs.line,
        rule: obs.type,
        expected,
        found,
        severity: getSeverity(profileRule.confidence, profile.severityThresholds),
      });
    }
  }

  return {
    deviations,
    summary: {
      total: observations.length,
      matching,
      deviating: deviations.length,
    },
  };
}

export function getStagedFiles(): string[] {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf-8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only --diff-filter=ACM", {
      encoding: "utf-8",
    });
    const staged = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf-8",
    });
    const all = new Set([
      ...output.trim().split("\n"),
      ...staged.trim().split("\n"),
    ]);
    all.delete("");
    return [...all];
  } catch {
    return [];
  }
}
```

Register the command in `/packages/cli/src/commands/index.ts`:

```ts
import { Command } from "commander";
import { loadProfile } from "@code-style/profile";
import { runExtractors } from "@code-style/analyzer";
import { diffAgainstProfile, getChangedFiles, formatDeviations } from "./diff.js";

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Check staged/changed files against profile")
    .option("--fix", "Auto-fix fixable deviations")
    .option("--profile <path>", "Path to profile file")
    .action(async (options) => {
      const profile = await loadProfile(options.profile);
      const files = getChangedFiles();
      if (files.length === 0) {
        console.log("No changed files to check.");
        return;
      }
      const observations = await runExtractors(files);
      const result = diffAgainstProfile(profile, observations);

      if (result.deviations.length === 0) {
        console.log(`All ${result.summary.total} observations match your profile.`);
        process.exitCode = 0;
        return;
      }

      for (const d of result.deviations) {
        const severity = d.severity.toUpperCase().padEnd(5);
        console.log(`${d.file}:${d.line} ${severity} expected ${d.expected}, found ${d.found} [${d.rule}]`);
      }

      console.log(`\n${result.summary.deviating} deviation(s) in ${result.summary.total} observations.`);
      process.exitCode = result.deviations.some((d) => d.severity === "error") ? 1 : 0;
    });
}
```

### Step 5: Verify all tests pass

```bash
pnpm --filter @code-style/cli test
pnpm --filter @code-style/cli typecheck
```

### Step 6: Commit

```bash
git add packages/cli/src/commands/show.ts packages/cli/src/commands/diff.ts \
       packages/cli/src/__tests__/show.test.ts packages/cli/src/__tests__/diff.test.ts \
       packages/cli/src/commands/index.ts
git commit -m "Add show and diff CLI commands with category filtering and deviation reporting"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/cli test` passes all show and diff tests
- [ ] `pnpm --filter @code-style/cli typecheck` exits 0
- [ ] `show --json` outputs valid JSON parseable by `JSON.parse`
- [ ] `show --category naming` excludes other categories from output
- [ ] `diffAgainstProfile` correctly identifies matching vs deviating observations
- [ ] Severity mapping respects `severityThresholds` from the profile

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use ANSI escape codes directly** -- use chalk for all terminal styling so tests can strip/inspect output cleanly
5. **Do not shell out to git in unit tests** -- the `getStagedFiles`/`getChangedFiles` helpers are integration-level; unit tests for `diffAgainstProfile` take observations as input
6. **Do not import from checker package** -- the diff command compares observations against profile; the `--fix` flag delegates to checker but that wiring comes in Task 17
7. **Do not parse profile fields dynamically without type guards** -- use the Zod-validated profile type from `@code-style/profile`
