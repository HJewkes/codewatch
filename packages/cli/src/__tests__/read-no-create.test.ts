import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createReadApi } from "../read-api/reader.js";
import { runGraphTopCommand } from "../commands/graph-top.js";
import { openGraphStore } from "../utils/graph-store.js";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codewatch-read-no-create-"));
  dbPath = path.join(dir, ".codewatch", "graph.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function expectNothingCreated(): void {
  expect(existsSync(dbPath)).toBe(false);
  expect(existsSync(path.dirname(dbPath))).toBe(false);
}

describe("read paths on a missing graph.db", () => {
  it("createReadApi throws and creates nothing", () => {
    expect(() => createReadApi({ db: dbPath })).toThrow(
      `no graph.db at ${dbPath}; run codewatch graph index`,
    );
    expectNothingCreated();
  });

  it("a read command throws and creates nothing", () => {
    expect(() => runGraphTopCommand({ db: dbPath } as never)).toThrow(
      "run codewatch graph index",
    );
    expectNothingCreated();
  });

  it("openGraphStore still opens an in-memory store", () => {
    openGraphStore(":memory:").close();
  });
});
