import { describe, it, expect } from "vitest";
import {
  classifyEditFile,
  darkHunkKind,
  distinctiveSeeds,
  documentFrequency,
  isDistinctive,
  isSecondOrderDark,
  seedIdentifiers,
  testImportedFiles,
  type DocumentFrequency,
  type TestContext,
} from "../coding-hardness.js";

const dfOf = (fileCount: number, counts: Record<string, number>): DocumentFrequency => ({
  fileCount,
  counts: new Map(Object.entries(counts)),
});

const TEST_FILE = "src/config.test.ts";
const TEST_SOURCE = [
  'import { resolveAgentSlots } from "./config.js";',
  'it("caps slots", () => expect(resolveAgentSlots({})).toBe(4));',
].join("\n");

const ctxFor = (seeds: string[], testImported: string[] = []): TestContext => ({
  testFiles: [TEST_FILE],
  distinctiveSeeds: new Set(seeds),
  testImported: new Set(testImported),
});

describe("seed identifiers and document frequency", () => {
  it("collects identifiers of four or more characters from every test file", () => {
    const seeds = seedIdentifiers(["const abc = makeWidget(x);", "wireDaemon();"]);

    expect([...seeds].sort()).toEqual(["const", "makeWidget", "wireDaemon"]);
  });

  it("counts each identifier once per file that contains it", () => {
    const df = documentFrequency(["foo(fooBar); fooBar()", "fooBar", "other"]);

    expect(df.fileCount).toBe(3);
    expect(df.counts.get("fooBar")).toBe(2);
    expect(df.counts.get("other")).toBe(1);
  });

  it("treats four files as distinctive in a small repo but not five", () => {
    const df = dfOf(100, { rare: 4, common: 5 });

    expect(isDistinctive("rare", df)).toBe(true);
    expect(isDistinctive("common", df)).toBe(false);
  });

  it("scales the distinctive limit to two percent of a large repo", () => {
    const df = dfOf(500, { atLimit: 10, overLimit: 11, unseen: 0 });

    expect([...distinctiveSeeds(["atLimit", "overLimit", "unseen"], df)]).toEqual([
      "atLimit",
      "unseen",
    ]);
  });
});

describe("classifyEditFile", () => {
  it("marks a modified file with no clue from the tests as dark", () => {
    const edit = {
      path: "src/broker/daemon.ts",
      added: false,
      parentContent: "export function startDaemon() { return new SocketServer(); }",
    };

    expect(classifyEditFile(edit, ctxFor(["resolveAgentSlots"]))).toBe("dark");
  });

  it("lights a file whose parent content names a distinctive seed", () => {
    const edit = {
      path: "src/settings.ts",
      added: false,
      parentContent: "export const resolveAgentSlots = () => 4;",
    };

    expect(classifyEditFile(edit, ctxFor(["resolveAgentSlots"]))).toBe("shares-identifier");
  });

  it("lights a file whose basename shares a token with a test file", () => {
    const edit = { path: "src/load-config.ts", added: false, parentContent: "" };

    expect(classifyEditFile(edit, ctxFor([]))).toBe("shares-basename");
  });

  it("ignores the shared file extension when comparing basenames", () => {
    const edit = { path: "src/daemon.ts", added: false, parentContent: "" };

    expect(classifyEditFile(edit, ctxFor([]))).toBe("dark");
  });

  it("lights a file a test imports directly", () => {
    const repo = new Set([TEST_FILE, "src/broker.ts"]);
    const imported = testImportedFiles(
      new Map([[TEST_FILE, 'import { x } from "./broker.js";']]),
      repo,
    );
    const edit = { path: "src/broker.ts", added: false, parentContent: "" };

    expect(classifyEditFile(edit, ctxFor([], [...imported]))).toBe("test-imported");
  });

  it("never marks an added file dark", () => {
    const edit = { path: "src/new-thing.ts", added: true, parentContent: "" };

    expect(classifyEditFile(edit, ctxFor([]))).toBe("added");
  });
});

describe("isSecondOrderDark", () => {
  const df = dfOf(100, { SocketServer: 2, return: 90 });

  it("holds when the other edits name nothing distinctive in the dark file", () => {
    const changed = ["+  return resolveAgentSlots(env);"];

    expect(isSecondOrderDark("function wire() { return new SocketServer(); }", changed, df)).toBe(
      true,
    );
  });

  it("fails when another edit's changed lines name the dark file's symbol", () => {
    const changed = ["  const server = new SocketServer(slots);"];

    expect(isSecondOrderDark("export class SocketServer {}", changed, df)).toBe(false);
  });
});

describe("darkHunkKind", () => {
  it("calls a change of comments and blank lines comment-only", () => {
    const hunk = { added: ["// Explain the cap.", "", " * more detail"], removed: ["// old"] };

    expect(darkHunkKind(hunk)).toBe("comment-only");
  });

  it("calls adding export to an existing declaration export-only", () => {
    const hunk = {
      added: ["export function buildArgs(opts: Opts) {"],
      removed: ["function buildArgs(opts: Opts) {"],
    };

    expect(darkHunkKind(hunk)).toBe("export-only");
  });

  it("calls a new barrel re-export line export-only", () => {
    const hunk = { added: ['export { buildArgs } from "./args.js";'], removed: [] };

    expect(darkHunkKind(hunk)).toBe("export-only");
  });

  it("calls an added interface member type-only", () => {
    const hunk = { added: ["  agentSlots?: number;", "  onExit: () => void;"], removed: [] };

    expect(darkHunkKind(hunk)).toBe("type-only");
  });

  it("calls a changed statement logic even when a comment rides along", () => {
    const hunk = {
      added: ["  // pass the cap", "  const sup = new Supervisor(opts, sem);"],
      removed: ["  const sup = new Supervisor(opts);"],
    };

    expect(darkHunkKind(hunk)).toBe("logic");
  });

  it("calls an object literal property logic, not a type member", () => {
    const hunk = { added: ["  agentSlots: resolveAgentSlots(env),"], removed: [] };

    expect(darkHunkKind(hunk)).toBe("logic");
  });
});
