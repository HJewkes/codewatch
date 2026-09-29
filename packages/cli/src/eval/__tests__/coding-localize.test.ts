import { describe, it, expect } from "vitest";
import { parseDiffLocations, scoreLocalization, type SpansFor } from "../coding-localize.js";
import type { SymbolSpan } from "../../commands/audit-score.js";

const SPANS: readonly SymbolSpan[] = [
  { path: "src/math.ts", symbol: "add", lineStart: 3, lineEnd: 8 },
  { path: "src/math.ts", symbol: "helper", lineStart: 10, lineEnd: 14 },
  { path: "src/old.ts", symbol: "run", lineStart: 1, lineEnd: 6 },
  { path: "pkg/model.py", symbol: "Model", lineStart: 1, lineEnd: 20 },
  { path: "pkg/model.py", symbol: "Model.fit", lineStart: 3, lineEnd: 8 },
];
const spansFor: SpansFor = (path) => SPANS.filter((s) => s.path === path);

function modify(path: string, line: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${line},1 +${line},1 @@`,
    `-old`,
    `+new`,
    ``,
  ].join("\n");
}

describe("scoreLocalization", () => {
  it("credits a symbol hit when the agent edits a different line inside the gold function", () => {
    const score = scoreLocalization(modify("src/math.ts", 4), modify("src/math.ts", 7), spansFor);

    expect(score.symbol.f1).toBe(1);
    expect(score.file.f1).toBe(1);
    expect(score.line.f1).toBe(0);
  });

  it("keys a line outside every symbol to the file's module key", () => {
    const score = scoreLocalization(modify("src/math.ts", 1), modify("src/math.ts", 2), spansFor);

    expect(score.symbol.f1).toBe(1);
    expect(score.symbol.expected).toBe(1);
  });

  it("maps a line to the innermost enclosing symbol in a Python file", () => {
    const score = scoreLocalization(modify("pkg/model.py", 5), modify("pkg/model.py", 15), spansFor);

    expect(score.file.f1).toBe(1);
    expect(score.symbol.f1).toBe(0);
  });

  it("lowers file precision when the agent adds a new file the gold patch does not touch", () => {
    const newFile = [
      "diff --git a/src/extra.ts b/src/extra.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/extra.ts",
      "@@ -0,0 +1,2 @@",
      "+export const a = 1;",
      "+export const b = 2;",
      "",
    ].join("\n");

    const score = scoreLocalization(modify("src/math.ts", 4), modify("src/math.ts", 4) + newFile, spansFor);

    expect(score.file.recall).toBe(1);
    expect(score.file.precision).toBe(0.5);
    expect(score.symbol.precision).toBe(0.5);
  });

  it("credits the deleted function when the agent edits a line of it the gold patch removed", () => {
    const deleteHelper = [
      "diff --git a/src/math.ts b/src/math.ts",
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -9,6 +9,1 @@",
      " ",
      "-function helper() {",
      "-  const x = 1;",
      "-  const y = 2;",
      "-  return x + y;",
      "-}",
      "",
    ].join("\n");

    const score = scoreLocalization(deleteHelper, modify("src/math.ts", 12), spansFor);

    expect(score.symbol.f1).toBe(1);
    expect(score.line.precision).toBe(1);
    expect(score.line.expected).toBe(5);
  });

  it("scores a renamed file under its parent-side path", () => {
    const rename = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 90%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -3,1 +3,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    const score = scoreLocalization(modify("src/old.ts", 2), rename, spansFor);

    expect(score.file.f1).toBe(1);
    expect(score.symbol.f1).toBe(1);
  });

  it("scores an empty agent diff as zero without dividing by zero", () => {
    const score = scoreLocalization(modify("src/math.ts", 4), "", spansFor);

    for (const s of [score.file, score.symbol, score.line]) {
      expect(s.f1).toBe(0);
      expect(s.precision).toBe(0);
      expect(s.recall).toBe(0);
    }
  });
});

describe("parseDiffLocations", () => {
  it("keys a pure insertion to its parent-side anchor line", () => {
    const insert = [
      "diff --git a/src/math.ts b/src/math.ts",
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -4,2 +4,3 @@",
      " const a = 1;",
      "+const b = 2;",
      " const c = 3;",
      "",
    ].join("\n");

    expect(parseDiffLocations(insert)).toEqual([{ file: "src/math.ts", parentLines: [4] }]);
  });

  it("keeps a pure rename with no hunks as a file location with no lines", () => {
    const rename = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");

    expect(parseDiffLocations(rename)).toEqual([{ file: "src/old.ts", parentLines: [] }]);
  });

  it("reads a deleted line that starts with dashes as a hunk line, not a file header", () => {
    const diff = [
      "diff --git a/src/math.ts b/src/math.ts",
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -2,2 +2,1 @@",
      " const a = 1;",
      "--- a SQL comment",
      "",
    ].join("\n");

    expect(parseDiffLocations(diff)).toEqual([{ file: "src/math.ts", parentLines: [3] }]);
  });

  it("keys a deleted file to its parent-side path", () => {
    const deleted = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-a",
      "-b",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    expect(parseDiffLocations(deleted)).toEqual([{ file: "src/gone.ts", parentLines: [1, 2] }]);
  });
});
