import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { ExportFormat } from "@codewatch/profile";

vi.mock("@codewatch/profile", async () => {
  const actual = await vi.importActual("@codewatch/profile");
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
    testDir = path.join(tmpdir(), `codewatch-export-test-${Date.now()}`);
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
    const { exportProfile } = await import("@codewatch/profile");
    vi.mocked(exportProfile).mockReturnValue([
      { path: ".claude/rules/typescript.md", content: "# rules" },
    ]);

    const { runExport } = await import("../commands/export.js");
    await runExport({
      format: "claude-rules" as ExportFormat,
      outputDir: testDir,
    });

    const content = await fs.readFile(
      path.join(testDir, ".claude", "rules", "typescript.md"),
      "utf-8",
    );
    expect(content).toContain("# rules");
  });
});
