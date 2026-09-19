import { describe, it, expect } from "vitest";
import type { OrchestratorResult } from "@titan-design/style-checker";

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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0, fixed: 0 },
    };

    const output = formatCheckOutput(result, "reviewdog");
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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
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
      failures: [],
      skippedRules: [],
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

describe("tool failures and skipped rules", () => {
  const skippedOnly: OrchestratorResult = {
    diagnostics: [],
    failures: [],
    skippedRules: [
      {
        tool: "eslint",
        rule: "unicorn/filename-case",
        plugin: "unicorn",
        reason: "eslint-plugin-unicorn is not installed in /project",
      },
    ],
    summary: { total: 0, errors: 0, warnings: 0, infos: 0, fixed: 0 },
  };

  async function checkPythonFileWithoutRuff(format: "text" | "reviewdog") {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { runCheck } = await import("../commands/check.js");
    const dir = await mkdtemp(join(tmpdir(), "codewatch-check-"));
    const profilePath = join(dir, "profile.json");
    await writeFile(profilePath, JSON.stringify(pythonNamingProfile));
    await writeFile(join(dir, "app.py"), "userName = 1\n");
    const originalPath = process.env.PATH;
    process.env.PATH = dir;
    try {
      return await runCheck([join(dir, "app.py")], { profile: profilePath, format });
    } finally {
      process.env.PATH = originalPath;
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("reports a missing ruff as a failure and exits 1 instead of claiming no violations", async () => {
    const { output, exitCode } = await checkPythonFileWithoutRuff("text");

    expect(output).toContain("Failed to spawn ruff");
    expect(output).toContain("[ruff.spawn-failed]");
    expect(output).not.toMatch(/no violations/i);
    expect(exitCode).toBe(1);
  });

  it("keeps reviewdog stdout parseable and sends a missing ruff to stderr", async () => {
    const { output, stderr, exitCode } = await checkPythonFileWithoutRuff("reviewdog");

    expect(output).toBe("");
    expect(stderr).toContain("Failed to spawn ruff");
    expect(exitCode).toBe(1);
  });

  it("prints a skipped rule as a warning without failing the run", async () => {
    const { formatCheckOutput, determineExitCode } = await import("../commands/check.js");

    const output = formatCheckOutput(skippedOnly, "text");

    expect(output).toContain("skipped unicorn/filename-case");
    expect(output).toContain("eslint-plugin-unicorn is not installed");
    expect(output).toMatch(/no violations/i);
    expect(determineExitCode(skippedOnly)).toBe(0);
  });

  it("includes failures and skipped rules in JSON output", async () => {
    const { formatCheckOutput } = await import("../commands/check.js");
    const failure = { tool: "ruff" as const, kind: "spawn-failed" as const, message: "Failed to spawn ruff" };

    const parsed = JSON.parse(formatCheckOutput({ ...skippedOnly, failures: [failure] }, "json"));

    expect(parsed.failures).toEqual([failure]);
    expect(parsed.skippedRules).toEqual(skippedOnly.skippedRules);
  });
});

const pythonNamingProfile = {
  schemaVersion: "1.0.0",
  author: "test",
  generated: "2026-09-18",
  sources: [],
  naming: {
    variables: { convention: "snake_case", confidence: 0.95, stability: "high" },
  },
  structure: {},
  documentation: {},
  errorHandling: {},
  formatting: {},
  patterns: {},
  idioms: { detected: [] },
  antiPatterns: { acknowledged: [] },
  overrides: [],
  severityThresholds: { error: 0.85, warn: 0.6, info: 0.4 },
};
