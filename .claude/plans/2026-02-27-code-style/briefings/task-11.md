# Task 11: CLI Framework + Init Command

## Architectural Context

This task creates the CLI entry point and the `init` command -- the primary user-facing flow that orchestrates the entire analysis pipeline. The CLI uses `commander` for command registration, `@inquirer/prompts` for interactive input, and `chalk` for styled output. The `init` command runs the full pipeline: prompt for GitHub token, select repositories, ingest code, extract features, aggregate observations, enrich with AI, run interactive review, and save the resulting profile. Utility modules for config persistence (`~/.code-style/config.json`) and consistent output formatting are established here and reused by all subsequent CLI commands.

## File Ownership

**May modify:**
- `/packages/cli/package.json` (add commander, chalk, @inquirer/prompts dependencies)
- `/packages/cli/src/index.ts`
- `/packages/cli/src/commands/init.ts`
- `/packages/cli/src/commands/index.ts` (NEW -- barrel for command registration)
- `/packages/cli/src/utils/config.ts`
- `/packages/cli/src/utils/output.ts`
- `/packages/cli/src/__tests__/init.test.ts`

**Must not touch:**
- `/packages/profile/src/schema/**`
- `/packages/analyzer/src/extractors/**`
- `/packages/analyzer/src/aggregator/**`
- `/packages/analyzer/src/enricher/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/index.ts` (profile I/O API: `writeProfile`, `ProfileSchema`)
- `/packages/analyzer/src/index.ts` (pipeline API: ingest, extract, aggregate, enrich)
- `/packages/analyzer/src/ingest/types.ts` (IngestOptions type)
- `/packages/analyzer/src/enricher/index.ts` (enricher API)
- `/docs/plans/2026-02-27-code-style-design.md` (CLI design, pipeline stages, storage layout)

## Steps

### Step 1: Add CLI dependencies

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm --filter @code-style/cli add commander chalk @inquirer/prompts
```

### Step 2: Write failing tests for config utilities

Create `/packages/cli/src/__tests__/init.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Config utilities", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-cli-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("loadConfig returns defaults when no config file exists", async () => {
    const { loadConfig } = await import("../utils/config.js");
    const config = await loadConfig(path.join(testDir, "config.json"));
    expect(config).toEqual({ githubToken: undefined, defaultRepos: [] });
  });

  it("saveConfig writes and loadConfig reads back", async () => {
    const { loadConfig, saveConfig } = await import("../utils/config.js");
    const configPath = path.join(testDir, "config.json");
    await saveConfig(configPath, {
      githubToken: "ghp_test123",
      defaultRepos: ["owner/repo-a"],
    });
    const loaded = await loadConfig(configPath);
    expect(loaded.githubToken).toBe("ghp_test123");
    expect(loaded.defaultRepos).toEqual(["owner/repo-a"]);
  });

  it("saveConfig creates parent directories if needed", async () => {
    const { saveConfig, loadConfig } = await import("../utils/config.js");
    const nested = path.join(testDir, "nested", "dir", "config.json");
    await saveConfig(nested, { githubToken: "ghp_abc", defaultRepos: [] });
    const loaded = await loadConfig(nested);
    expect(loaded.githubToken).toBe("ghp_abc");
  });
});

describe("Output utilities", () => {
  it("formatSuccess returns a styled success message", async () => {
    const { formatSuccess } = await import("../utils/output.js");
    const msg = formatSuccess("Profile saved");
    expect(msg).toContain("Profile saved");
  });

  it("formatError returns a styled error message", async () => {
    const { formatError } = await import("../utils/output.js");
    const msg = formatError("Something failed");
    expect(msg).toContain("Something failed");
  });

  it("formatStep returns a numbered step indicator", async () => {
    const { formatStep } = await import("../utils/output.js");
    const msg = formatStep(1, 5, "Ingesting repositories");
    expect(msg).toContain("1");
    expect(msg).toContain("5");
    expect(msg).toContain("Ingesting repositories");
  });

  it("formatConfidence returns color-coded confidence", async () => {
    const { formatConfidence } = await import("../utils/output.js");
    const high = formatConfidence(0.95);
    const low = formatConfidence(0.35);
    expect(high).toContain("95");
    expect(low).toContain("35");
  });
});

describe("Init command", () => {
  it("runInit orchestrates the full pipeline in correct order", async () => {
    const ingest = vi.fn().mockResolvedValue({ files: [], reviews: [] });
    const extract = vi.fn().mockResolvedValue([]);
    const aggregate = vi.fn().mockResolvedValue({});
    const enrich = vi.fn().mockResolvedValue({});
    const review = vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0",
      author: "testuser",
      generated: "2026-02-27",
      sources: ["owner/repo"],
      naming: {},
      structure: {},
      documentation: {},
      errorHandling: {},
      formatting: {},
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
    });
    const writeProfile = vi.fn().mockResolvedValue(undefined);

    const { runInitPipeline } = await import("../commands/init.js");

    await runInitPipeline({
      githubToken: "ghp_test",
      repos: ["owner/repo"],
      ingest,
      extract,
      aggregate,
      enrich,
      review,
      writeProfile,
      profilePath: "/tmp/test-profile.json",
    });

    expect(ingest).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    expect(aggregate).toHaveBeenCalledOnce();
    expect(enrich).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(writeProfile).toHaveBeenCalledOnce();

    // Verify ordering: ingest before extract before aggregate before enrich before review
    const ingestOrder = ingest.mock.invocationCallOrder[0];
    const extractOrder = extract.mock.invocationCallOrder[0];
    const aggregateOrder = aggregate.mock.invocationCallOrder[0];
    const enrichOrder = enrich.mock.invocationCallOrder[0];
    const reviewOrder = review.mock.invocationCallOrder[0];
    const writeOrder = writeProfile.mock.invocationCallOrder[0];

    expect(ingestOrder).toBeLessThan(extractOrder);
    expect(extractOrder).toBeLessThan(aggregateOrder);
    expect(aggregateOrder).toBeLessThan(enrichOrder);
    expect(enrichOrder).toBeLessThan(reviewOrder);
    expect(reviewOrder).toBeLessThan(writeOrder);
  });

  it("runInit passes ingest output to extract", async () => {
    const corpus = { files: [{ path: "a.ts", content: "const x = 1;" }], reviews: [] };
    const ingest = vi.fn().mockResolvedValue(corpus);
    const extract = vi.fn().mockResolvedValue([]);
    const aggregate = vi.fn().mockResolvedValue({});
    const enrich = vi.fn().mockResolvedValue({});
    const review = vi.fn().mockResolvedValue({
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
    });
    const writeProfile = vi.fn().mockResolvedValue(undefined);

    const { runInitPipeline } = await import("../commands/init.js");

    await runInitPipeline({
      githubToken: "ghp_test",
      repos: ["owner/repo"],
      ingest,
      extract,
      aggregate,
      enrich,
      review,
      writeProfile,
      profilePath: "/tmp/test-profile.json",
    });

    expect(extract).toHaveBeenCalledWith(corpus);
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 3: Implement config utilities

Create `/packages/cli/src/utils/config.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CliConfig {
  githubToken: string | undefined;
  defaultRepos: string[];
}

const DEFAULT_CONFIG: CliConfig = {
  githubToken: undefined,
  defaultRepos: [],
};

export async function loadConfig(configPath: string): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(
  configPath: string,
  config: CliConfig,
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function getDefaultConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return path.join(home, ".code-style");
}

export function getDefaultConfigPath(): string {
  return path.join(getDefaultConfigDir(), "config.json");
}

export function getDefaultProfilePath(): string {
  return path.join(getDefaultConfigDir(), "profile.json");
}
```

### Step 4: Implement output utilities

Create `/packages/cli/src/utils/output.ts`:

```ts
import chalk from "chalk";

export function formatSuccess(message: string): string {
  return chalk.green(`\u2714 ${message}`);
}

export function formatError(message: string): string {
  return chalk.red(`\u2716 ${message}`);
}

export function formatWarning(message: string): string {
  return chalk.yellow(`\u26A0 ${message}`);
}

export function formatStep(
  current: number,
  total: number,
  description: string,
): string {
  return chalk.cyan(`[${current}/${total}]`) + ` ${description}`;
}

export function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 85) return chalk.green(`${pct}%`);
  if (pct >= 60) return chalk.yellow(`${pct}%`);
  if (pct >= 40) return chalk.blue(`${pct}%`);
  return chalk.dim(`${pct}%`);
}

export function formatSeverity(severity: "error" | "warn" | "info"): string {
  switch (severity) {
    case "error":
      return chalk.red("error");
    case "warn":
      return chalk.yellow("warn");
    case "info":
      return chalk.blue("info");
  }
}

export function formatHeader(text: string): string {
  return chalk.bold.underline(text);
}

export function formatDim(text: string): string {
  return chalk.dim(text);
}
```

Run: `pnpm --filter @code-style/cli test` -- config and output tests should pass.

### Step 5: Implement init command with injectable pipeline

Create `/packages/cli/src/commands/init.ts`:

```ts
import * as path from "node:path";
import { input, confirm, checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  getDefaultConfigPath,
  getDefaultProfilePath,
  type CliConfig,
} from "../utils/config.js";
import { formatStep, formatSuccess, formatError } from "../utils/output.js";

export interface InitPipelineDeps {
  githubToken: string;
  repos: string[];
  ingest: (token: string, repos: string[]) => Promise<unknown>;
  extract: (corpus: unknown) => Promise<unknown[]>;
  aggregate: (observations: unknown[]) => Promise<unknown>;
  enrich: (aggregated: unknown) => Promise<unknown>;
  review: (enriched: unknown) => Promise<unknown>;
  writeProfile: (filePath: string, profile: unknown) => Promise<void>;
  profilePath: string;
}

export async function runInitPipeline(deps: InitPipelineDeps): Promise<void> {
  const { githubToken, repos, ingest, extract, aggregate, enrich, review, writeProfile, profilePath } = deps;

  console.log(formatStep(1, 6, "Ingesting repositories..."));
  const corpus = await ingest(githubToken, repos);

  console.log(formatStep(2, 6, "Extracting style features..."));
  const observations = await extract(corpus);

  console.log(formatStep(3, 6, "Aggregating patterns..."));
  const aggregated = await aggregate(observations);

  console.log(formatStep(4, 6, "Enriching with AI analysis..."));
  const enriched = await enrich(aggregated);

  console.log(formatStep(5, 6, "Interactive review..."));
  const reviewed = await review(enriched);

  console.log(formatStep(6, 6, "Saving profile..."));
  await writeProfile(profilePath, reviewed);

  console.log(formatSuccess(`Profile saved to ${profilePath}`));
}

export interface InitCommandOptions {
  githubToken?: string;
  repos?: string[];
  since?: string;
  until?: string;
  languages?: string[];
}

export async function promptForInitOptions(
  options: InitCommandOptions,
): Promise<{ token: string; repos: string[] }> {
  const configPath = getDefaultConfigPath();
  const existingConfig = await loadConfig(configPath);

  const token =
    options.githubToken ??
    existingConfig.githubToken ??
    (await input({
      message: "GitHub personal access token:",
      validate: (val) =>
        val.startsWith("ghp_") || val.startsWith("github_pat_")
          ? true
          : "Token must start with ghp_ or github_pat_",
    }));

  const repos =
    options.repos ??
    (existingConfig.defaultRepos.length > 0
      ? existingConfig.defaultRepos
      : (await input({
          message: "Repository slugs (comma-separated, e.g. owner/repo):",
          validate: (val) =>
            val.split(",").every((r) => r.trim().includes("/"))
              ? true
              : "Each repo must be in owner/repo format",
        }))
          .split(",")
          .map((r) => r.trim()));

  const shouldSaveToken = await confirm({
    message: "Save token to config for future use?",
    default: true,
  });

  if (shouldSaveToken) {
    await saveConfig(configPath, {
      githubToken: token,
      defaultRepos: repos,
    });
  }

  return { token, repos };
}
```

### Step 6: Set up CLI entry point with commander

Create `/packages/cli/src/commands/index.ts`:

```ts
export { runInitPipeline, promptForInitOptions } from "./init.js";
```

Update `/packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { writeProfile } from "@code-style/profile";
import { promptForInitOptions, runInitPipeline } from "./commands/init.js";
import { getDefaultProfilePath } from "./utils/config.js";
import { formatError } from "./utils/output.js";

const program = new Command();

program
  .name("code-style")
  .description("Analyze GitHub contributions to create a personal coding style profile")
  .version("0.0.1");

program
  .command("init")
  .description("Run full analysis pipeline and create your style profile")
  .option("--repos <repos...>", "Repository slugs (owner/repo)")
  .option("--github-token <token>", "GitHub personal access token")
  .option("--since <date>", "Analyze commits since this date")
  .option("--until <date>", "Analyze commits until this date")
  .option("--languages <langs...>", "Languages to analyze (ts, py)")
  .action(async (options) => {
    try {
      const { token, repos } = await promptForInitOptions({
        githubToken: options.githubToken,
        repos: options.repos,
        since: options.since,
        until: options.until,
        languages: options.languages,
      });

      // Import pipeline functions from analyzer package
      const { ingest, extract, aggregate, enrich } = await import(
        "@code-style/analyzer"
      );
      // Import interactive review from this package
      const { runReviewSession } = await import("./interactive/review.js");

      await runInitPipeline({
        githubToken: token,
        repos,
        ingest: (t, r) => ingest({ token: t, repos: r, since: options.since, until: options.until }),
        extract,
        aggregate,
        enrich,
        review: runReviewSession,
        writeProfile,
        profilePath: getDefaultProfilePath(),
      });
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

program.parse();
```

### Step 7: Update package.json bin entry

Add the `bin` field to `/packages/cli/package.json`:

```json
{
  "bin": {
    "code-style": "./dist/index.js"
  }
}
```

### Step 8: Verify

```bash
pnpm --filter @code-style/cli test
pnpm --filter @code-style/cli typecheck
pnpm build
```

### Step 9: Commit

```bash
git add packages/cli/src/index.ts packages/cli/src/commands/init.ts \
       packages/cli/src/commands/index.ts packages/cli/src/utils/config.ts \
       packages/cli/src/utils/output.ts packages/cli/src/__tests__/init.test.ts \
       packages/cli/package.json
git commit -m "Add CLI framework with commander, init command, config and output utilities"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/cli test` passes all tests
- [ ] `pnpm --filter @code-style/cli typecheck` exits 0
- [ ] `loadConfig` returns defaults for missing file and round-trips saved config
- [ ] `saveConfig` creates parent directories automatically
- [ ] `formatStep`, `formatSuccess`, `formatError`, `formatConfidence` produce styled strings
- [ ] `runInitPipeline` calls pipeline stages in correct order (ingest -> extract -> aggregate -> enrich -> review -> write)
- [ ] `runInitPipeline` passes output of each stage as input to the next
- [ ] Config stored at `~/.code-style/config.json` with token and repos
- [ ] `pnpm build` produces `dist/index.js` with shebang line

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not hardcode pipeline implementations in init** -- use dependency injection so tests can mock each stage; the real implementations are imported dynamically in the command action
5. **Do not store the GitHub token in the profile** -- tokens go in `config.json`, profiles go in `profile.json`; never mix auth credentials with style data
6. **Do not use synchronous I/O** -- all file operations use `node:fs/promises`
7. **Do not skip interactive prompts in the command** -- the init command prompts for missing options; tests mock at the pipeline level, not by skipping prompts
