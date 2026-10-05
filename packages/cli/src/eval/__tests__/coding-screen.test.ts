import { describe, it, expect } from "vitest";
import { documentFrequency } from "../coding-hardness.js";
import {
  hardnessFeatures,
  parseDiffHunks,
  screenEditFiles,
  screenVerdict,
  stratumOf,
  type EditFileScreen,
  type ScreenInput,
} from "../coding-screen.js";

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " const keep = 1;",
  "-const old = 2;",
  "+const fresh = 3;",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -4 +4 @@",
  "-function helper() {",
  "+export function helper() {",
].join("\n");

function screened(path: string, over: Partial<EditFileScreen>): EditFileScreen {
  return { path, light: "dark", hop: null, hunkKind: "logic", secondOrderDark: false, ...over };
}

describe("parseDiffHunks", () => {
  it("collects added and removed lines per file", () => {
    const hunks = parseDiffHunks(DIFF);

    expect(Object.fromEntries(hunks)).toEqual({
      "src/a.ts": { added: ["const fresh = 3;"], removed: ["const old = 2;"] },
      "src/b.ts": { added: ["export function helper() {"], removed: ["function helper() {"] },
    });
  });
});

describe("screenEditFiles", () => {
  const input: ScreenInput = {
    edits: [
      { path: "src/a.ts", added: false, parentContent: "const keep = 1;\nconst old = 2;" },
      { path: "src/b.ts", added: false, parentContent: "function helper() {}" },
      { path: "src/api.ts", added: false, parentContent: "export const apiValue = 1;" },
    ],
    ctx: {
      testFiles: ["test/api.test.ts"],
      distinctiveSeeds: new Set(["apiValue"]),
      testImported: new Set(),
    },
    hunks: parseDiffHunks(DIFF),
    hops: { "src/a.ts": 2, "src/b.ts": null, "src/api.ts": 1 },
    df: documentFrequency([]),
  };

  it("classifies each edit file and judges the hunks of dark ones", () => {
    const files = screenEditFiles(input);

    expect(files.map((f) => [f.path, f.light, f.hop, f.hunkKind])).toEqual([
      ["src/a.ts", "dark", 2, "logic"],
      ["src/b.ts", "dark", null, "export-only"],
      ["src/api.ts", "shares-basename", 1, undefined],
    ]);
  });
});

describe("hardnessFeatures", () => {
  it("drops comment-only dark files and counts export-only ones as trivial", () => {
    const h = hardnessFeatures([
      screened("a.ts", { hop: 3, hunkKind: "logic", secondOrderDark: true }),
      screened("b.ts", { hop: 1, hunkKind: "export-only" }),
      screened("c.ts", { hop: 2, hunkKind: "comment-only" }),
      screened("d.ts", { light: "test-imported", hop: 1, hunkKind: undefined }),
    ]);

    expect(h).toMatchObject({
      darkFiles: 2,
      trivialDarkFiles: 1,
      darkReachable: 1,
      maxHop: 3,
      secondOrderDark: 1,
    });
  });
});

describe("screenVerdict", () => {
  const oneLogic = hardnessFeatures([screened("a.ts", { hunkKind: "logic" })]);
  const oneExport = hardnessFeatures([screened("a.ts", { hunkKind: "export-only" })]);
  const none = hardnessFeatures([screened("a.ts", { light: "test-imported" })]);

  it("keeps every candidate when minDark is 0", () => {
    expect([none, oneExport, oneLogic].map((h) => screenVerdict(h, 0))).toEqual([
      "pass",
      "pass",
      "pass",
    ]);
  });

  it("rejects too few dark files, then too few non-trivial ones", () => {
    expect(screenVerdict(none, 1)).toBe("dark-rejected");
    expect(screenVerdict(oneExport, 1)).toBe("trivial-rejected");
    expect(screenVerdict(oneLogic, 1)).toBe("pass");
  });
});

describe("stratumOf", () => {
  it("maps dark to structurally-hidden and a test import to import-chain-reachable", () => {
    expect(stratumOf([screened("a.ts", {})])).toBe("structurally-hidden");
    expect(stratumOf([screened("a.ts", { light: "test-imported" })])).toBe(
      "import-chain-reachable",
    );
    expect(stratumOf([screened("a.ts", { light: "shares-identifier" })])).toBe(
      "semantic-findable",
    );
  });
});
