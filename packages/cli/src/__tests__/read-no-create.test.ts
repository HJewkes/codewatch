import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createReadApi } from "../read-api/reader.js";
import { runGraphTopCommand } from "../commands/graph-top.js";
import { runGraphRenderCommand } from "../commands/graph-render.js";
import { runGraphRenderDiffCommand } from "../commands/graph-render-diff.js";
import { runGraphDashboardCommand } from "../commands/graph-dashboard.js";
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

  it("graph render rejects and creates nothing", async () => {
    await expect(
      runGraphRenderCommand({ db: dbPath, out: path.join(dir, "out.html") }),
    ).rejects.toThrow(`no graph.db at ${dbPath}; run codewatch graph index`);
    expectNothingCreated();
  });

  it("graph render-diff rejects and creates nothing", async () => {
    const out = path.join(dir, "diff.html");
    await expect(
      runGraphRenderDiffCommand({ db: dbPath, from: "1", to: "2", out }),
    ).rejects.toThrow(`no graph.db at ${dbPath}; run codewatch graph index`);
    expectNothingCreated();
  });

  it("graph dashboard rejects and creates nothing", async () => {
    const out = path.join(dir, "dashboard.html");
    await expect(
      runGraphDashboardCommand({ db: dbPath, config: path.join(dir, "check.json"), out, repoRoot: dir }),
    ).rejects.toThrow("run codewatch graph index");
    expectNothingCreated();
    expect(existsSync(out)).toBe(false);
  });

  it("openGraphStore still opens an in-memory store", () => {
    openGraphStore(":memory:").close();
  });
});
