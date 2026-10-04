import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { openCodeGraph } from "@titan-design/code-graph";
import { runGraphIndex } from "../commands/graph-index-run.js";

describe("graph index on a tree with no git history", () => {
  let tree: string;

  beforeEach(async () => {
    tree = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-no-git-")));
    await fs.mkdir(path.join(tree, "src"), { recursive: true });
    await fs.writeFile(path.join(tree, "src", "a.ts"), "export const A = 1;\n");
  });

  afterEach(() => rmSync(tree, { recursive: true, force: true }));

  it("marks churn unavailable and stores no churn or ownership metrics", async () => {
    const result = await runGraphIndex({ rootDir: tree });

    expect(result.churn).toBe("unavailable");
    const store = openCodeGraph(result.dbPath);
    try {
      const names = store
        .listMetrics(result.snapshotId)
        .map((m) => m.name)
        .filter((n) => /churn|bus_factor|ownership|owner/.test(n));
      expect(names).toEqual([]);
    } finally {
      store.close();
    }
  });
});
