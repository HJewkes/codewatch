import { describe, it, expect } from "vitest";
import type { OrchestratorResult } from "@code-style/checker";

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
