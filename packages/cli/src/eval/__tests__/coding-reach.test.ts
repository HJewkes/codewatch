import { describe, it, expect } from "vitest";
import { editFileHops, importHops, type SourceReader } from "../coding-reach.js";

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
