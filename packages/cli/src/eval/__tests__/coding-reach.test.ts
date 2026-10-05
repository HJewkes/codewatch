import { describe, it, expect } from "vitest";
import { editFileHops, importHops, type SourceReader } from "../coding-reach.js";
import { parseWorkspace } from "../coding-workspace.js";

const SOURCES = new Map([
  ["test/api.test.ts", 'import { api } from "../src/api.js";'],
  ["src/api.ts", 'import { wire } from "./wiring";\nexport * from "./index.js";'],
  ["src/index.ts", 'export { wire } from "./wiring.js";'],
  ["src/wiring.ts", 'import { join } from "node:path";'],
  ["src/orphan.ts", 'import { wire } from "./wiring";'],
]);
const FILE_IDS = new Set(SOURCES.keys());

function mapReader(reads: string[][] = []): SourceReader {
  return (paths) => {
    reads.push([...paths]);
    return new Map(paths.map((p) => [p, SOURCES.get(p) ?? ""]));
  };
}

describe("importHops", () => {
  it("gives the shortest import depth from the test files", () => {
    const hops = importHops(["test/api.test.ts"], FILE_IDS, mapReader());

    expect(Object.fromEntries(hops)).toEqual({
      "test/api.test.ts": 0,
      "src/api.ts": 1,
      "src/wiring.ts": 2,
      "src/index.ts": 2,
    });
  });

  it("reads each reached file once, one batch per hop level", () => {
    const reads: string[][] = [];

    importHops(["test/api.test.ts"], FILE_IDS, mapReader(reads));

    expect(reads).toEqual([
      ["test/api.test.ts"],
      ["src/api.ts"],
      ["src/wiring.ts", "src/index.ts"],
    ]);
  });

  it("terminates on an import cycle and keeps the first depth", () => {
    const sources = new Map([
      ["t.test.ts", 'import "./a";'],
      ["a.ts", 'import "./b";'],
      ["b.ts", 'import "./a";\nimport "./t.test";'],
    ]);

    const hops = importHops(["t.test.ts"], new Set(sources.keys()), () => sources);

    expect(Object.fromEntries(hops)).toEqual({ "t.test.ts": 0, "a.ts": 1, "b.ts": 2 });
  });

  it("resolves a directory import to its index file", () => {
    const sources = new Map([
      ["src/x.test.ts", 'import { cmd } from "./commands";'],
      ["src/commands/index.ts", 'export * from "./run.js";'],
      ["src/commands/run.ts", ""],
    ]);

    const hops = importHops(["src/x.test.ts"], new Set(sources.keys()), () => sources);

    expect(hops.get("src/commands/index.ts")).toBe(1);
    expect(hops.get("src/commands/run.ts")).toBe(2);
  });

  it("follows a scoped workspace import into the package's source", () => {
    const sources = new Map([
      ["packages/app/test/run.test.ts", 'import { run } from "../src/run";'],
      ["packages/app/src/run.ts", 'import { scale } from "@acme/lib";'],
      ["packages/lib/src/engine.ts", 'import { join } from "node:path";'],
    ]);
    const workspace = parseWorkspace(
      new Map([["packages/lib/package.json", '{"name":"@acme/lib","main":"dist/engine.js"}']]),
    );

    const hops = importHops(
      ["packages/app/test/run.test.ts"],
      new Set(sources.keys()),
      () => sources,
      workspace,
    );

    expect(hops.get("packages/lib/src/engine.ts")).toBe(2);
  });
});

describe("editFileHops", () => {
  it("reports null for an edit file no test reaches", () => {
    const hops = importHops(["test/api.test.ts"], FILE_IDS, mapReader());

    expect(editFileHops(["src/api.ts", "src/wiring.ts", "src/orphan.ts"], hops)).toEqual({
      "src/api.ts": 1,
      "src/wiring.ts": 2,
      "src/orphan.ts": null,
    });
  });
});
