# Task 18: update + compare + hook + export Commands

## Architectural Context

This task adds the remaining four CLI commands that complete the user-facing interface. `update` re-runs the analysis pipeline on an existing profile and merges new observations. `compare` diffs two profiles side-by-side. `hook` installs/uninstalls git pre-commit hooks that run `code-style check`. `export` provides CLI access to all exporters from Tasks 15 and 16. These are all relatively thin command wrappers that compose existing pipeline and exporter functionality from the analyzer, profile, and checker packages.

## File Ownership

**May modify:**
- `/packages/cli/src/commands/update.ts`
- `/packages/cli/src/commands/compare.ts`
- `/packages/cli/src/commands/hook.ts`
- `/packages/cli/src/commands/export.ts`
- `/packages/cli/src/commands/index.ts` (register new commands)
- `/packages/cli/src/index.ts` (register new commands with commander)
- `/packages/cli/src/__tests__/update.test.ts`
- `/packages/cli/src/__tests__/compare.test.ts`
- `/packages/cli/src/__tests__/hook.test.ts`
- `/packages/cli/src/__tests__/export.test.ts`

**Must not touch:**
- `/packages/profile/src/schema/**`
- `/packages/profile/src/exporters/**`
- `/packages/analyzer/src/**`
- `/packages/checker/src/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/index.ts` (readProfile, writeProfile, exportProfile, SUPPORTED_FORMATS)
- `/packages/profile/src/exporters/export-index.ts` (exportProfile dispatch, ExportFormat)
- `/packages/profile/src/exporters/hooks.ts` (generateHooksConfig)
- `/packages/analyzer/src/index.ts` (ingest, extract, aggregate, enrich pipeline functions)
- `/packages/cli/src/commands/init.ts` (runInitPipeline pattern)
- `/packages/cli/src/utils/config.ts` (getDefaultProfilePath, loadConfig)
- `/packages/cli/src/utils/output.ts` (formatSuccess, formatError, formatStep)
- `/docs/plans/2026-02-27-code-style-design.md` (CLI design section: update, compare, hook, export)

## Steps

### Step 1: Write failing tests for update command

Create `/packages/cli/src/__tests__/update.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { Profile } from "@code-style/profile";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: ["owner/repo-a"],
  naming: {
    variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
  },
  structure: {},
  documentation: {},
  errorHandling: {},
  formatting: {},
  patterns: {},
  idioms: { detected: [] },
  antiPatterns: { acknowledged: [] },
  overrides: [],
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
  ...overrides,
});

describe("mergeProfiles", () => {
  it("keeps existing rules when new analysis has no data", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile();
    const incoming = makeProfile({
      naming: {},
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: true });
    expect(merged.naming.variables?.convention).toBe("camelCase");
  });

  it("updates rules when incoming has higher confidence", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.80 },
      },
    });
    const incoming = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.95 },
      },
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.naming.variables?.confidence).toBe(0.95);
  });

  it("adds new rules from incoming profile", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const incoming = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
        functions: { convention: "camelCase", confidence: 0.97 },
      },
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.naming.functions?.convention).toBe("camelCase");
    expect(merged.naming.variables?.convention).toBe("camelCase");
  });

  it("preserves overrides when keepOverrides is true", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      overrides: [
        {
          files: ["**/*.test.ts"],
          naming: {
            functions: { convention: "any", confidence: 1.0 },
          },
        },
      ],
    });
    const incoming = makeProfile({ overrides: [] });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: true });
    expect(merged.overrides).toHaveLength(1);
    expect(merged.overrides[0].files).toContain("**/*.test.ts");
  });

  it("merges sources from both profiles without duplicates", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({ sources: ["owner/repo-a"] });
    const incoming = makeProfile({ sources: ["owner/repo-a", "owner/repo-b"] });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.sources).toEqual(["owner/repo-a", "owner/repo-b"]);
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 2: Implement update command

Create `/packages/cli/src/commands/update.ts`:

```ts
import type { Profile, StyleRule } from "@code-style/profile";

export interface MergeOptions {
  keepOverrides: boolean;
}

function mergeCategory(
  existing: Record<string, StyleRule>,
  incoming: Record<string, StyleRule>,
): Record<string, StyleRule> {
  const merged = { ...existing };

  for (const [key, incomingRule] of Object.entries(incoming)) {
    if (!incomingRule) continue;
    const existingRule = merged[key];
    if (!existingRule) {
      merged[key] = incomingRule;
    } else if (incomingRule.confidence > existingRule.confidence) {
      merged[key] = incomingRule;
    }
  }

  return merged;
}

export function mergeProfiles(
  existing: Profile,
  incoming: Profile,
  options: MergeOptions,
): Profile {
  const uniqueSources = [...new Set([...existing.sources, ...incoming.sources])];

  return {
    ...existing,
    generated: new Date().toISOString().split("T")[0],
    sources: uniqueSources,
    naming: mergeCategory(
      existing.naming as Record<string, StyleRule>,
      incoming.naming as Record<string, StyleRule>,
    ),
    structure: mergeCategory(
      existing.structure as Record<string, StyleRule>,
      incoming.structure as Record<string, StyleRule>,
    ),
    documentation: mergeCategory(
      existing.documentation as Record<string, StyleRule>,
      incoming.documentation as Record<string, StyleRule>,
    ),
    errorHandling: mergeCategory(
      existing.errorHandling as Record<string, StyleRule>,
      incoming.errorHandling as Record<string, StyleRule>,
    ),
    formatting: mergeCategory(
      existing.formatting as Record<string, StyleRule>,
      incoming.formatting as Record<string, StyleRule>,
    ),
    patterns: mergeCategory(
      existing.patterns as Record<string, StyleRule>,
      incoming.patterns as Record<string, StyleRule>,
    ),
    overrides: options.keepOverrides ? existing.overrides : incoming.overrides,
  };
}

export interface UpdateCommandOptions {
  repos?: string[];
  keepOverrides?: boolean;
  profile?: string;
  githubToken?: string;
}

export async function runUpdate(options: UpdateCommandOptions): Promise<void> {
  const { readProfile, writeProfile } = await import("@code-style/profile");
  const { ingest, extract, aggregate, enrich } = await import("@code-style/analyzer");
  const { getDefaultProfilePath, loadConfig, getDefaultConfigPath } = await import("../utils/config.js");
  const { formatStep, formatSuccess, formatError } = await import("../utils/output.js");
  const { runReviewSession } = await import("../interactive/review.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const existing = await readProfile(profilePath);
  const config = await loadConfig(getDefaultConfigPath());
  const token = options.githubToken ?? config.githubToken;

  if (!token) {
    throw new Error("GitHub token required. Set via --github-token or run code-style init.");
  }

  const repos = options.repos ?? existing.sources;

  console.log(formatStep(1, 5, "Ingesting repositories..."));
  const corpus = await ingest({ token, repos });

  console.log(formatStep(2, 5, "Extracting style features..."));
  const observations = await extract(corpus);

  console.log(formatStep(3, 5, "Aggregating patterns..."));
  const aggregated = await aggregate(observations);

  console.log(formatStep(4, 5, "Enriching with AI..."));
  const enriched = await enrich(aggregated);

  console.log(formatStep(5, 5, "Reviewing changes..."));
  const reviewed = await runReviewSession(enriched);
  const incoming = reviewed as Profile;

  const merged = mergeProfiles(existing, incoming, {
    keepOverrides: options.keepOverrides ?? true,
  });

  await writeProfile(profilePath, merged);
  console.log(formatSuccess(`Profile updated at ${profilePath}`));
}
```

### Step 3: Write failing tests for compare command

Create `/packages/cli/src/__tests__/compare.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Profile } from "@code-style/profile";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {},
  structure: {},
  documentation: {},
  errorHandling: {},
  formatting: {},
  patterns: {},
  idioms: { detected: [] },
  antiPatterns: { acknowledged: [] },
  overrides: [],
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
  ...overrides,
});

describe("compareProfiles", () => {
  it("detects added rules in right profile", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({ naming: {} });
    const right = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });

    const diffs = compareProfiles(left, right);
    const added = diffs.filter((d) => d.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].path).toBe("naming.variables");
  });

  it("detects removed rules in right profile", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const right = makeProfile({ naming: {} });

    const diffs = compareProfiles(left, right);
    const removed = diffs.filter((d) => d.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe("naming.variables");
  });

  it("detects changed conventions", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const right = makeProfile({
      naming: {
        variables: { convention: "snake_case", confidence: 0.88 },
      },
    });

    const diffs = compareProfiles(left, right);
    const changed = diffs.filter((d) => d.type === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].left).toContain("camelCase");
    expect(changed[0].right).toContain("snake_case");
  });

  it("detects confidence changes", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.80 },
      },
    });
    const right = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.95 },
      },
    });

    const diffs = compareProfiles(left, right);
    const changed = diffs.filter((d) => d.type === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].path).toBe("naming.variables");
  });

  it("returns empty array when profiles are identical", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const profile = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });

    const diffs = compareProfiles(profile, profile);
    expect(diffs).toHaveLength(0);
  });
});

describe("formatComparison", () => {
  it("formats added rules with + prefix", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "added" as const, path: "naming.variables", left: "", right: "camelCase (94%)" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("+");
    expect(output).toContain("naming.variables");
  });

  it("formats removed rules with - prefix", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "removed" as const, path: "naming.variables", left: "camelCase (94%)", right: "" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("-");
    expect(output).toContain("naming.variables");
  });

  it("formats changed rules showing both values", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "changed" as const, path: "naming.variables", left: "camelCase (80%)", right: "camelCase (95%)" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("naming.variables");
    expect(output).toContain("80%");
    expect(output).toContain("95%");
  });

  it("returns no-differences message for empty diffs", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const output = formatComparison([]);
    expect(output).toMatch(/no differences|identical/i);
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 4: Implement compare command

Create `/packages/cli/src/commands/compare.ts`:

```ts
import chalk from "chalk";
import type { Profile, StyleRule } from "@code-style/profile";

export interface ProfileDiff {
  type: "added" | "removed" | "changed";
  path: string;
  left: string;
  right: string;
}

const COMPARABLE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
] as const;

function ruleToString(rule: StyleRule): string {
  const convention =
    typeof rule.convention === "string"
      ? rule.convention
      : JSON.stringify(rule.convention);
  return `${convention} (${Math.round(rule.confidence * 100)}%)`;
}

export function compareProfiles(left: Profile, right: Profile): ProfileDiff[] {
  const diffs: ProfileDiff[] = [];

  for (const category of COMPARABLE_CATEGORIES) {
    const leftSection = (left[category] ?? {}) as Record<string, StyleRule>;
    const rightSection = (right[category] ?? {}) as Record<string, StyleRule>;

    const allKeys = new Set([
      ...Object.keys(leftSection),
      ...Object.keys(rightSection),
    ]);

    for (const key of allKeys) {
      const leftRule = leftSection[key];
      const rightRule = rightSection[key];
      const path = `${category}.${key}`;

      if (!leftRule && rightRule) {
        diffs.push({
          type: "added",
          path,
          left: "",
          right: ruleToString(rightRule),
        });
      } else if (leftRule && !rightRule) {
        diffs.push({
          type: "removed",
          path,
          left: ruleToString(leftRule),
          right: "",
        });
      } else if (leftRule && rightRule) {
        const leftStr = ruleToString(leftRule);
        const rightStr = ruleToString(rightRule);
        if (leftStr !== rightStr) {
          diffs.push({
            type: "changed",
            path,
            left: leftStr,
            right: rightStr,
          });
        }
      }
    }
  }

  return diffs;
}

export function formatComparison(diffs: ProfileDiff[]): string {
  if (diffs.length === 0) {
    return chalk.green("Profiles are identical. No differences found.");
  }

  const lines: string[] = [];
  lines.push(chalk.bold.underline("Profile Comparison"));
  lines.push("");

  for (const diff of diffs) {
    switch (diff.type) {
      case "added":
        lines.push(
          chalk.green(`  + ${diff.path}: ${diff.right}`),
        );
        break;
      case "removed":
        lines.push(
          chalk.red(`  - ${diff.path}: ${diff.left}`),
        );
        break;
      case "changed":
        lines.push(
          chalk.yellow(`  ~ ${diff.path}`),
        );
        lines.push(
          chalk.red(`    - ${diff.left}`),
        );
        lines.push(
          chalk.green(`    + ${diff.right}`),
        );
        break;
    }
  }

  const added = diffs.filter((d) => d.type === "added").length;
  const removed = diffs.filter((d) => d.type === "removed").length;
  const changed = diffs.filter((d) => d.type === "changed").length;
  lines.push("");
  lines.push(
    chalk.dim(
      `${added} added, ${removed} removed, ${changed} changed`,
    ),
  );

  return lines.join("\n");
}
```

### Step 5: Write failing tests for hook command

Create `/packages/cli/src/__tests__/hook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("installHook", () => {
  let testDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-hook-test-${Date.now()}`);
    hooksDir = path.join(testDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates a pre-commit hook file", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("code-style");
    expect(content).toContain("check");
  });

  it("makes the hook file executable", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const stat = await fs.stat(hookPath);
    // Check executable bit (owner)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("appends to existing pre-commit hook", async () => {
    const { installHook } = await import("../commands/hook.js");
    const hookPath = path.join(hooksDir, "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho existing\n");
    await installHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo existing");
    expect(content).toContain("code-style");
  });

  it("does not duplicate if hook already contains code-style", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    const matches = content.match(/code-style/g);
    expect(matches).toHaveLength(1);
  });
});

describe("removeHook", () => {
  let testDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-hook-test-${Date.now()}`);
    hooksDir = path.join(testDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("removes the code-style line from the pre-commit hook", async () => {
    const { installHook, removeHook } = await import("../commands/hook.js");
    await installHook(testDir);
    await removeHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).not.toContain("code-style");
  });

  it("preserves other hook content when removing", async () => {
    const hookPath = path.join(hooksDir, "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho existing\ncode-style diff\n");
    const { removeHook } = await import("../commands/hook.js");
    await removeHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo existing");
    expect(content).not.toContain("code-style");
  });

  it("handles missing hook file gracefully", async () => {
    const { removeHook } = await import("../commands/hook.js");
    await expect(removeHook(testDir)).resolves.not.toThrow();
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 6: Implement hook command

Create `/packages/cli/src/commands/hook.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";

const HOOK_LINE = "code-style diff --fix";
const HOOK_MARKER = "# code-style pre-commit hook";
const HOOK_BLOCK = `\n${HOOK_MARKER}\n${HOOK_LINE}\n`;

export async function installHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");

  let existing = "";
  try {
    existing = await fs.readFile(hookPath, "utf-8");
  } catch {
    existing = "#!/bin/sh\n";
  }

  if (existing.includes("code-style")) {
    return;
  }

  const content = existing.trimEnd() + HOOK_BLOCK;
  await fs.writeFile(hookPath, content);
  await fs.chmod(hookPath, 0o755);
}

export async function removeHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");

  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n").filter(
    (line) => !line.includes("code-style") && line !== HOOK_MARKER.trim(),
  );

  await fs.writeFile(hookPath, lines.join("\n"));
}
```

### Step 7: Write tests for export command and implement

Create `/packages/cli/src/__tests__/export.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

vi.mock("@code-style/profile", async () => {
  const actual = await vi.importActual("@code-style/profile");
  return {
    ...actual,
    readProfile: vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0",
      author: "testuser",
      generated: "2026-02-27",
      sources: [],
      naming: {
        variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
      },
      structure: {},
      documentation: {},
      errorHandling: {},
      formatting: {},
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
      severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
    }),
    exportProfile: vi.fn().mockReturnValue([
      { path: "eslint.config.js", content: "// eslint config" },
    ]),
  };
});

describe("runExport", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-export-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("writes generated files to the output directory", async () => {
    const { runExport } = await import("../commands/export.js");
    await runExport({
      format: "eslint",
      outputDir: testDir,
    });

    const files = await fs.readdir(testDir);
    expect(files).toContain("eslint.config.js");
  });

  it("creates nested directories for file paths with subdirs", async () => {
    const { exportProfile } = await import("@code-style/profile");
    vi.mocked(exportProfile).mockReturnValue([
      { path: ".claude/rules/typescript.md", content: "# rules" },
    ]);

    const { runExport } = await import("../commands/export.js");
    await runExport({
      format: "claude-rules",
      outputDir: testDir,
    });

    const content = await fs.readFile(
      path.join(testDir, ".claude", "rules", "typescript.md"),
      "utf-8",
    );
    expect(content).toContain("# rules");
  });
});
```

Create `/packages/cli/src/commands/export.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExportFormat } from "@code-style/profile";
import { formatSuccess, formatError } from "../utils/output.js";

export interface ExportCommandOptions {
  format: ExportFormat;
  outputDir?: string;
  profile?: string;
}

export async function runExport(options: ExportCommandOptions): Promise<void> {
  const { readProfile, exportProfile } = await import("@code-style/profile");
  const { getDefaultProfilePath } = await import("../utils/config.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const profile = await readProfile(profilePath);
  const outputDir = options.outputDir ?? process.cwd();

  const files = exportProfile(profile, options.format);

  for (const file of files) {
    const outputPath = path.join(outputDir, file.path);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, file.content);
    console.log(formatSuccess(`Wrote ${file.path}`));
  }

  console.log(formatSuccess(`Exported ${files.length} file(s) in ${options.format} format`));
}
```

### Step 8: Register all commands in CLI entry point

Update `/packages/cli/src/commands/index.ts`:

```ts
export { runInitPipeline, promptForInitOptions } from "./init.js";
export {
  formatCheckOutput,
  determineExitCode,
  resolveFilePaths,
  runCheck,
  type CheckCommandOptions,
  type OutputFormat,
} from "./check.js";
export { mergeProfiles, runUpdate, type UpdateCommandOptions } from "./update.js";
export { compareProfiles, formatComparison, type ProfileDiff } from "./compare.js";
export { installHook, removeHook } from "./hook.js";
export { runExport, type ExportCommandOptions } from "./export.js";
```

Add the commands to `/packages/cli/src/index.ts`:

```ts
program
  .command("update")
  .description("Re-run analysis and merge with existing profile")
  .option("--repos <repos...>", "Repository slugs (owner/repo)")
  .option("--keep-overrides", "Preserve existing overrides", true)
  .option("--profile <path>", "Path to profile file")
  .option("--github-token <token>", "GitHub personal access token")
  .action(async (options) => {
    try {
      const { runUpdate } = await import("./commands/update.js");
      await runUpdate(options);
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

program
  .command("compare <profilePath>")
  .description("Compare current profile with another profile")
  .option("--profile <path>", "Path to your profile (default: ~/.code-style/profile.json)")
  .action(async (otherPath: string, options) => {
    try {
      const { readProfile } = await import("@code-style/profile");
      const { getDefaultProfilePath } = await import("./utils/config.js");
      const { compareProfiles, formatComparison } = await import("./commands/compare.js");

      const leftPath = options.profile ?? getDefaultProfilePath();
      const [left, right] = await Promise.all([
        readProfile(leftPath),
        readProfile(otherPath),
      ]);

      const diffs = compareProfiles(left, right);
      console.log(formatComparison(diffs));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

const hookCmd = program
  .command("hook")
  .description("Manage git pre-commit hooks");

hookCmd
  .command("install")
  .description("Install code-style pre-commit hook")
  .action(async () => {
    try {
      const { installHook } = await import("./commands/hook.js");
      await installHook(process.cwd());
      console.log(formatSuccess("Pre-commit hook installed."));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

hookCmd
  .command("remove")
  .description("Remove code-style pre-commit hook")
  .action(async () => {
    try {
      const { removeHook } = await import("./commands/hook.js");
      await removeHook(process.cwd());
      console.log(formatSuccess("Pre-commit hook removed."));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

program
  .command("export")
  .description("Export profile in different formats")
  .requiredOption("--format <format>", "Export format: skill, claude-rules, hooks, eslint, ruff, editorconfig, markdown")
  .option("--output <dir>", "Output directory (default: current directory)")
  .option("--profile <path>", "Path to profile file")
  .action(async (options) => {
    try {
      const { runExport } = await import("./commands/export.js");
      await runExport({
        format: options.format,
        outputDir: options.output,
        profile: options.profile,
      });
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });
```

### Step 9: Verify

```bash
pnpm --filter @code-style/cli test
pnpm --filter @code-style/cli typecheck
```

### Step 10: Commit

```bash
git add packages/cli/src/commands/update.ts packages/cli/src/commands/compare.ts \
       packages/cli/src/commands/hook.ts packages/cli/src/commands/export.ts \
       packages/cli/src/commands/index.ts packages/cli/src/index.ts \
       packages/cli/src/__tests__/update.test.ts packages/cli/src/__tests__/compare.test.ts \
       packages/cli/src/__tests__/hook.test.ts packages/cli/src/__tests__/export.test.ts
git commit -m "Add update, compare, hook, and export CLI commands"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/cli test` passes all new command tests
- [ ] `pnpm --filter @code-style/cli typecheck` exits 0
- [ ] `mergeProfiles` preserves existing rules when incoming is empty
- [ ] `mergeProfiles` updates rules when incoming has higher confidence
- [ ] `mergeProfiles` adds new rules from incoming
- [ ] `mergeProfiles` deduplicates sources
- [ ] `mergeProfiles` preserves overrides when `keepOverrides` is true
- [ ] `compareProfiles` detects added, removed, and changed rules
- [ ] `formatComparison` shows +/- prefixes and both values for changes
- [ ] `installHook` creates executable pre-commit hook
- [ ] `installHook` does not duplicate on repeated calls
- [ ] `removeHook` removes code-style lines while preserving other content
- [ ] `runExport` writes generated files to output directory with correct paths
- [ ] All four commands registered in commander with correct flags

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not silently overwrite the existing profile in update** -- always merge; the `mergeProfiles` function decides what wins based on confidence
5. **Do not compare profiles by stringifying the entire JSON** -- compare rule-by-rule within each category to produce meaningful semantic diffs
6. **Do not write hooks to arbitrary paths** -- always resolve from the project `.git/hooks/` directory; fail gracefully if `.git/` does not exist
7. **Do not require a specific export format** -- validate against `SUPPORTED_FORMATS` from `@code-style/profile` and show a helpful error for unknown formats
8. **Do not call pipeline functions directly in command handlers** -- follow the init command pattern of importing dynamically and using options objects for testability
