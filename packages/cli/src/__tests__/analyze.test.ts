import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("analyze command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(tmpdir(), "code-style-analyze-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("walkSourceFiles", () => {
    it("returns matching source files for the requested languages", async () => {
      await fs.writeFile(path.join(testDir, "a.ts"), "export const x = 1;\n");
      await fs.writeFile(path.join(testDir, "b.py"), "x = 1\n");
      await fs.writeFile(path.join(testDir, "readme.md"), "# nope\n");

      const { walkSourceFiles } = await import("../commands/analyze.js");
      const files = await walkSourceFiles(testDir, ["typescript", "python"]);
      const names = files.map((f) => path.basename(f)).sort();
      expect(names).toEqual(["a.ts", "b.py"]);
    });

    it("filters by language", async () => {
      await fs.writeFile(path.join(testDir, "a.ts"), "export const x = 1;\n");
      await fs.writeFile(path.join(testDir, "b.py"), "x = 1\n");

      const { walkSourceFiles } = await import("../commands/analyze.js");
      const files = await walkSourceFiles(testDir, ["typescript"]);
      const names = files.map((f) => path.basename(f));
      expect(names).toEqual(["a.ts"]);
    });

    it("recurses into subdirectories", async () => {
      const nested = path.join(testDir, "src", "deep");
      await fs.mkdir(nested, { recursive: true });
      await fs.writeFile(path.join(nested, "deep.ts"), "export const y = 2;\n");

      const { walkSourceFiles } = await import("../commands/analyze.js");
      const files = await walkSourceFiles(testDir, ["typescript"]);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(path.join("src", "deep", "deep.ts"));
    });

    it("excludes node_modules and dist", async () => {
      await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(testDir, "node_modules", "vendored.ts"),
        "export const v = 0;\n",
      );
      await fs.mkdir(path.join(testDir, "dist"), { recursive: true });
      await fs.writeFile(
        path.join(testDir, "dist", "built.ts"),
        "export const b = 0;\n",
      );
      await fs.writeFile(path.join(testDir, "real.ts"), "export const r = 1;\n");

      const { walkSourceFiles } = await import("../commands/analyze.js");
      const files = await walkSourceFiles(testDir, ["typescript"]);
      expect(files.map((f) => path.basename(f))).toEqual(["real.ts"]);
    });

    it("excludes .d.ts files", async () => {
      await fs.writeFile(path.join(testDir, "a.ts"), "export const x = 1;\n");
      await fs.writeFile(path.join(testDir, "a.d.ts"), "export const x: number;\n");

      const { walkSourceFiles } = await import("../commands/analyze.js");
      const files = await walkSourceFiles(testDir, ["typescript"]);
      expect(files.map((f) => path.basename(f))).toEqual(["a.ts"]);
    });
  });

  describe("runAnalyze", () => {
    it("returns features and summary for a small TypeScript project", async () => {
      await fs.writeFile(
        path.join(testDir, "user.ts"),
        [
          "export interface User {",
          "  id: number;",
          "  name: string;",
          "}",
          "",
          "export function getUser(id: number): User {",
          '  return { id, name: "alice" };',
          "}",
          "",
        ].join("\n"),
      );

      const { runAnalyze } = await import("../commands/analyze.js");
      const result = await runAnalyze({
        rootDir: testDir,
        languages: ["typescript"],
      });

      expect(result.files.total).toBe(1);
      expect(result.files.byLanguage).toEqual({ typescript: 1 });
      expect(result.observations).toBeGreaterThan(0);
      expect(result.summary.totalFeatures).toBeGreaterThan(0);
      expect(result.features.length).toBe(result.summary.totalFeatures);
    });

    it("returns an empty result when no source files are found", async () => {
      await fs.writeFile(path.join(testDir, "readme.md"), "# nothing\n");

      const { runAnalyze } = await import("../commands/analyze.js");
      const result = await runAnalyze({
        rootDir: testDir,
        languages: ["typescript", "python"],
      });

      expect(result.files.total).toBe(0);
      expect(result.observations).toBe(0);
      expect(result.summary.totalFeatures).toBe(0);
    });
  });

  describe("formatters", () => {
    it("formatAnalyzeJson returns parseable JSON with feature shape", async () => {
      await fs.writeFile(path.join(testDir, "a.ts"), "export const x = 1;\n");

      const { runAnalyze, formatAnalyzeJson } = await import(
        "../commands/analyze.js"
      );
      const result = await runAnalyze({
        rootDir: testDir,
        languages: ["typescript"],
      });

      const parsed = JSON.parse(formatAnalyzeJson(result));
      expect(parsed.rootDir).toContain("code-style-analyze-");
      expect(parsed.files.total).toBe(1);
      expect(parsed.summary.totalFeatures).toBeGreaterThan(0);
      expect(Array.isArray(parsed.features)).toBe(true);
      expect(parsed.features[0]).toHaveProperty("type");
      expect(parsed.features[0]).toHaveProperty("convention");
      expect(parsed.features[0]).toHaveProperty("confidence");
      expect(parsed.features[0]).toHaveProperty("severity");
    });

    it("formatAnalyzeText includes header, file count, and feature summary", async () => {
      await fs.writeFile(path.join(testDir, "a.ts"), "export const x = 1;\n");

      const { runAnalyze, formatAnalyzeText } = await import(
        "../commands/analyze.js"
      );
      const result = await runAnalyze({
        rootDir: testDir,
        languages: ["typescript"],
      });

      const text = formatAnalyzeText(result);
      expect(text).toContain("Analysis:");
      expect(text).toContain("1 files");
      expect(text).toContain("Top conventions");
      expect(text).toContain("Total features");
    });
  });
});
