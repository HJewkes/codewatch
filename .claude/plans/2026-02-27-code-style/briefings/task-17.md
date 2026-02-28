# Task 17: check Command

## Architectural Context

The `check` command is the primary enforcement CLI command. It loads the user's profile, invokes the checker orchestrator (Task 14), and displays results with colored terminal output. It supports `--fix` for auto-fixing safe violations, `--format` for output format selection (text, json, reviewdog), and sets the process exit code based on violation severity. This command bridges the checker package into the CLI, making `code-style check [path]` the main way users lint code against their personal style profile.

## File Ownership

**May modify:**
- `/packages/cli/src/commands/check.ts`
- `/packages/cli/src/commands/index.ts` (register check command)
- `/packages/cli/src/__tests__/check.test.ts`

**Must not touch:**
- `/packages/checker/src/**`
- `/packages/profile/src/schema/**`
- `/packages/analyzer/src/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/checker/src/index.ts` (orchestrate API, CheckDiagnostic, OrchestratorResult)
- `/packages/checker/src/formatters/unified.ts` (formatDiagnostic)
- `/packages/checker/src/orchestrator/types.ts` (OrchestratorOptions, Severity)
- `/packages/profile/src/index.ts` (readProfile, Profile)
- `/packages/cli/src/index.ts` (commander setup)
- `/packages/cli/src/commands/init.ts` (pattern for command registration)
- `/packages/cli/src/utils/output.ts` (formatError, formatSuccess, formatSeverity)
- `/packages/cli/src/utils/config.ts` (getDefaultProfilePath)
- `/docs/plans/2026-02-27-code-style-design.md` (CLI design, check command flags)

## Steps

### Step 1: Write failing tests for check command

Create `/packages/cli/src/__tests__/check.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorResult, CheckDiagnostic } from "@code-style/checker";

describe("formatCheckOutput", () => {
  it("formats text output with colored severity and unified format", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "src/app.ts",
          line: 10,
          column: 7,
          severity: "error",
          message: "Variable name must match camelCase",
          category: "naming",
          rule: "@typescript-eslint/naming-convention",
          fixable: false,
        },
        {
          file: "src/utils.ts",
          line: 5,
          column: 1,
          severity: "warn",
          message: "Function has too many lines (45). Maximum is 28.",
          category: "structure",
          rule: "max-lines-per-function",
          fixable: false,
        },
      ],
      summary: { total: 2, errors: 1, warnings: 1, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "text");
    expect(output).toContain("src/app.ts:10:7");
    expect(output).toContain("naming");
    expect(output).toContain("src/utils.ts:5:1");
    expect(output).toContain("structure");
  });

  it("formats JSON output as parseable JSON array", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "src/app.ts",
          line: 10,
          column: 7,
          severity: "error",
          message: "Variable name must match camelCase",
          category: "naming",
          rule: "naming-convention",
          fixable: false,
        },
      ],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "json");
    const parsed = JSON.parse(output);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0].file).toBe("src/app.ts");
    expect(parsed.summary.errors).toBe(1);
  });

  it("formats reviewdog output with one diagnostic per line", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "src/app.ts",
          line: 10,
          column: 7,
          severity: "error",
          message: "Variable name must match camelCase",
          category: "naming",
          rule: "naming-convention",
          fixable: false,
        },
      ],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "reviewdog");
    // reviewdog format: file:line:col: severity: message
    expect(output).toContain("src/app.ts:10:7:");
  });

  it("shows summary line at end of text output", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "a.ts",
          line: 1,
          column: 1,
          severity: "error",
          message: "test",
          category: "naming",
          rule: "rule",
          fixable: false,
        },
        {
          file: "b.ts",
          line: 2,
          column: 1,
          severity: "warn",
          message: "test2",
          category: "structure",
          rule: "rule2",
          fixable: false,
        },
      ],
      summary: { total: 2, errors: 1, warnings: 1, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "text");
    expect(output).toContain("1 error");
    expect(output).toContain("1 warning");
  });

  it("returns success message when no violations", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [],
      summary: { total: 0, errors: 0, warnings: 0, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "text");
    expect(output).toMatch(/no (violations|issues)/i);
  });
});

describe("determineExitCode", () => {
  it("returns 0 when no diagnostics", async () => {
    const { determineExitCode } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [],
      summary: { total: 0, errors: 0, warnings: 0, infos: 0, fixed: 0 },
    };
    expect(determineExitCode(result)).toBe(0);
  });

  it("returns 1 when errors are present", async () => {
    const { determineExitCode } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "a.ts",
          line: 1,
          column: 1,
          severity: "error",
          message: "test",
          category: "naming",
          rule: "rule",
          fixable: false,
        },
      ],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0, fixed: 0 },
    };
    expect(determineExitCode(result)).toBe(1);
  });

  it("returns 0 when only warnings and infos", async () => {
    const { determineExitCode } = await import("../commands/check.js");
    const result: OrchestratorResult = {
      diagnostics: [
        {
          file: "a.ts",
          line: 1,
          column: 1,
          severity: "warn",
          message: "test",
          category: "naming",
          rule: "rule",
          fixable: false,
        },
      ],
      summary: { total: 1, errors: 0, warnings: 1, infos: 0, fixed: 0 },
    };
    expect(determineExitCode(result)).toBe(0);
  });
});

describe("resolveFilePaths", () => {
  it("returns provided paths when given", async () => {
    const { resolveFilePaths } = await import("../commands/check.js");
    const paths = resolveFilePaths(["src/app.ts", "src/utils.ts"]);
    expect(paths).toEqual(["src/app.ts", "src/utils.ts"]);
  });

  it("defaults to current directory when no paths provided", async () => {
    const { resolveFilePaths } = await import("../commands/check.js");
    const paths = resolveFilePaths([]);
    expect(paths).toEqual(["."]);
  });
});
```

Run: `pnpm --filter @code-style/cli test` -- expect failures.

### Step 2: Implement check command

Create `/packages/cli/src/commands/check.ts`:

```ts
import chalk from "chalk";
import type { OrchestratorResult, CheckDiagnostic } from "@code-style/checker";

export type OutputFormat = "text" | "json" | "reviewdog";

export function resolveFilePaths(paths: string[]): string[] {
  return paths.length > 0 ? paths : ["."];
}

export function determineExitCode(result: OrchestratorResult): number {
  return result.summary.errors > 0 ? 1 : 0;
}

function formatDiagnosticText(d: CheckDiagnostic): string {
  const severityStr =
    d.severity === "error"
      ? chalk.red("error")
      : d.severity === "warn"
        ? chalk.yellow("warn")
        : chalk.blue("info");
  const fixableTag = d.fixable ? chalk.dim(" [fixable]") : "";
  return `${chalk.dim(`${d.file}:${d.line}:${d.column}`)} ${severityStr} ${d.message} ${chalk.dim(`[${d.category}.${d.rule}]`)}${fixableTag}`;
}

function formatDiagnosticReviewdog(d: CheckDiagnostic): string {
  const severity = d.severity === "error" ? "e" : d.severity === "warn" ? "w" : "i";
  return `${d.file}:${d.line}:${d.column}: ${severity}: ${d.message} [${d.category}.${d.rule}]`;
}

function formatSummary(summary: OrchestratorResult["summary"]): string {
  const parts: string[] = [];
  if (summary.errors > 0) {
    parts.push(chalk.red(`${summary.errors} error${summary.errors !== 1 ? "s" : ""}`));
  }
  if (summary.warnings > 0) {
    parts.push(chalk.yellow(`${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""}`));
  }
  if (summary.infos > 0) {
    parts.push(chalk.blue(`${summary.infos} info`));
  }
  if (summary.fixed > 0) {
    parts.push(chalk.green(`${summary.fixed} fixed`));
  }
  return `\n${parts.join(", ")} (${summary.total} total)`;
}

export function formatCheckOutput(
  result: OrchestratorResult,
  format: OutputFormat,
): string {
  if (format === "json") {
    return JSON.stringify(
      { diagnostics: result.diagnostics, summary: result.summary },
      null,
      2,
    );
  }

  if (format === "reviewdog") {
    return result.diagnostics.map(formatDiagnosticReviewdog).join("\n");
  }

  // text format
  if (result.diagnostics.length === 0) {
    return chalk.green("No violations found.");
  }

  const lines = result.diagnostics.map(formatDiagnosticText);
  lines.push(formatSummary(result.summary));
  return lines.join("\n");
}

export interface CheckCommandOptions {
  fix?: boolean;
  format?: OutputFormat;
  profile?: string;
  language?: "typescript" | "python";
}

export async function runCheck(
  paths: string[],
  options: CheckCommandOptions,
): Promise<{ output: string; exitCode: number }> {
  const { readProfile } = await import("@code-style/profile");
  const { orchestrate } = await import("@code-style/checker");
  const { getDefaultProfilePath } = await import("../utils/config.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const profile = await readProfile(profilePath);
  const filePaths = resolveFilePaths(paths);

  const result = await orchestrate({
    profile,
    files: filePaths,
    fix: options.fix,
    language: options.language,
  });

  const format = options.format ?? "text";
  const output = formatCheckOutput(result, format);
  const exitCode = determineExitCode(result);

  return { output, exitCode };
}
```

### Step 3: Register check command in CLI entry point

Add to `/packages/cli/src/commands/index.ts`:

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
```

Register in `/packages/cli/src/index.ts` (add after the init command):

```ts
program
  .command("check [paths...]")
  .description("Lint files against your style profile")
  .option("--fix", "Auto-fix safe violations")
  .option("--format <format>", "Output format: text, json, reviewdog", "text")
  .option("--profile <path>", "Path to profile file")
  .option("--language <lang>", "Language to check: typescript, python")
  .action(async (paths: string[], options) => {
    try {
      const { runCheck } = await import("./commands/check.js");
      const { output, exitCode } = await runCheck(paths, {
        fix: options.fix,
        format: options.format,
        profile: options.profile,
        language: options.language,
      });
      console.log(output);
      process.exitCode = exitCode;
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });
```

### Step 4: Verify

```bash
pnpm --filter @code-style/cli test
pnpm --filter @code-style/cli typecheck
```

### Step 5: Commit

```bash
git add packages/cli/src/commands/check.ts packages/cli/src/commands/index.ts \
       packages/cli/src/index.ts packages/cli/src/__tests__/check.test.ts
git commit -m "Add check command with text, json, and reviewdog output formats"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/cli test` passes all check command tests
- [ ] `pnpm --filter @code-style/cli typecheck` exits 0
- [ ] `formatCheckOutput` with "text" format includes file:line:col, colored severity, message, and category.rule
- [ ] `formatCheckOutput` with "json" format produces valid JSON with diagnostics array and summary
- [ ] `formatCheckOutput` with "reviewdog" format produces one diagnostic per line in reviewdog format
- [ ] `formatCheckOutput` shows summary with error/warning/info counts
- [ ] `formatCheckOutput` shows success message when no violations
- [ ] `determineExitCode` returns 1 for errors, 0 otherwise
- [ ] `resolveFilePaths` defaults to `["."]` when no paths provided
- [ ] `runCheck` loads profile, calls orchestrator, formats output, and returns exit code

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not reimplement the checker logic** -- import and call `orchestrate` from `@code-style/checker`; this command is a thin CLI wrapper
5. **Do not use process.exit() directly** -- set `process.exitCode` so cleanup handlers and test harnesses work correctly
6. **Do not hardcode the profile path** -- use `getDefaultProfilePath()` as fallback, with `--profile` flag for override
7. **Do not swallow checker errors** -- if the orchestrator throws (e.g., tool not found), catch it and display with `formatError`, then set exit code 1
