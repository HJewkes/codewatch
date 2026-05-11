import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@code-style/graph";
import {
  runGraphRelevantCommand,
  formatGraphRelevantText,
  formatGraphRelevantJson,
} from "../commands/graph-relevant.js";

interface Fixture {
  dir: string;
  dbPath: string;
  snapshotId: number;
}

async function createFixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-relevant-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({
    ref: "main",
    indexVersion: "0.1.0",
  });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath, snapshotId };
}

describe("runGraphRelevantCommand", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("returns ranked rows sorted descending by score (uniform teleport, no seed)", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
        { id: "hub.ts", kind: "file", name: "hub.ts" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "a.ts", dstId: "hub.ts", kind: "imports" },
        { srcId: "b.ts", dstId: "hub.ts", kind: "imports" },
      ]);
    });

    const result = runGraphRelevantCommand({ db: fixture.dbPath });
    expect(result.rows[0]!.nodeId).toBe("hub.ts");
    expect(result.rows[0]!.rank).toBe(1);
    expect(result.converged).toBe(true);
  });

  it("seed concentrates score near reachable nodes and excludes seed itself", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/index.ts", kind: "file", name: "index.ts" },
        { id: "src/helper.ts", kind: "file", name: "helper.ts" },
        { id: "src/types.ts", kind: "file", name: "types.ts" },
        { id: "src/disjoint.ts", kind: "file", name: "disjoint.ts" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "src/index.ts", dstId: "src/helper.ts", kind: "imports" },
        { srcId: "src/helper.ts", dstId: "src/types.ts", kind: "imports" },
      ]);
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      seed: ["src/index.ts"],
    });

    expect(result.seeds).toEqual(["src/index.ts"]);
    expect(result.rows.map((r) => r.nodeId)).not.toContain("src/index.ts");

    const helperRank = result.rows.find((r) => r.nodeId === "src/helper.ts")!;
    const disjointRank = result.rows.find((r) => r.nodeId === "src/disjoint.ts")!;
    expect(helperRank.score).toBeGreaterThan(disjointRank.score);
  });

  it("seed accepts glob patterns matching multiple nodes", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/cmds/a.ts", kind: "file", name: "a.ts" },
        { id: "src/cmds/b.ts", kind: "file", name: "b.ts" },
        { id: "src/lib.ts", kind: "file", name: "lib.ts" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "src/cmds/a.ts", dstId: "src/lib.ts", kind: "imports" },
      ]);
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      seed: ["src/cmds/*.ts"],
    });
    expect(result.seeds.sort()).toEqual(["src/cmds/a.ts", "src/cmds/b.ts"]);
  });

  it("throws a helpful error when seed matches no nodes", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "a.ts", kind: "file", name: "a.ts" });
    });

    expect(() =>
      runGraphRelevantCommand({ db: fixture.dbPath, seed: ["does/not/exist"] }),
    ).toThrow(/No nodes matched seed patterns/);
  });

  it("respects --limit", async () => {
    fixture = await createFixture((db, snapshotId) => {
      for (let i = 0; i < 5; i++) {
        db.insertNode(snapshotId, { id: `f${i}.ts`, kind: "file", name: "" });
      }
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      limit: 3,
    });
    expect(result.rows).toHaveLength(3);
  });

  it("filters by --kind", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "f.ts", kind: "file", name: "f.ts" },
        { id: "m", kind: "module", name: "m" },
      ]);
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      kind: "file",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.kind).toBe("file");
  });

  it("excludes by glob pattern", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/a.ts", kind: "file", name: "a" },
        { id: "src/a.test.ts", kind: "file", name: "a.test" },
      ]);
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      exclude: ["**/*.test.ts"],
    });
    expect(result.rows.map((r) => r.nodeId)).toEqual(["src/a.ts"]);
  });

  it("excludes by role", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/index.ts", kind: "file", name: "index.ts", role: "barrel" },
        { id: "src/lib.ts", kind: "file", name: "lib.ts", role: "source" },
      ]);
    });

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      excludeRole: ["barrel"],
    });
    expect(result.rows.map((r) => r.nodeId)).toEqual(["src/lib.ts"]);
  });

  it("--max-tokens caps output and emits tree format with budget header", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "@pkg/foo", kind: "package", name: "@pkg/foo" },
        { id: "foo/a.ts", kind: "file", name: "a.ts", parentId: "@pkg/foo" },
        { id: "foo/b.ts", kind: "file", name: "b.ts", parentId: "@pkg/foo" },
        { id: "foo/c.ts", kind: "file", name: "c.ts", parentId: "@pkg/foo" },
      ]);
    });

    const small = runGraphRelevantCommand({
      db: fixture.dbPath,
      maxTokens: 10,
    });
    expect(small.tokenBudget).toBe(10);
    expect(small.rows.length).toBeLessThan(4);
    const text = formatGraphRelevantText(small);
    expect(text).toContain("# Repo map");
    expect(text).toContain("budget=10");
  });

  it("text output includes title and ranked list", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "a.ts", dstId: "b.ts", kind: "imports" },
      ]);
    });

    const result = runGraphRelevantCommand({ db: fixture.dbPath });
    const text = formatGraphRelevantText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("Most central nodes");
    expect(text).toContain("rank");
    expect(text).toContain("score");
    expect(text).toContain("a.ts");
    expect(text).toContain("b.ts");
  });

  it("emits JSON when requested", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
      ]);
    });

    const result = runGraphRelevantCommand({ db: fixture.dbPath });
    const json = JSON.parse(formatGraphRelevantJson(result));
    expect(json.rows).toHaveLength(2);
    expect(json.snapshot.id).toBe(fixture.snapshotId);
    expect(json.iterations).toBeGreaterThan(0);
  });

  it("uses specified snapshot when --snapshot given", async () => {
    fixture = await createFixture((_db, _snapshotId) => {});
    const db = openDatabase(fixture.dbPath);
    const secondId = db.createSnapshot({ ref: "feature", indexVersion: "0.1.0" });
    db.insertNode(secondId, { id: "x.ts", kind: "file", name: "x.ts" });
    db.close();

    const result = runGraphRelevantCommand({
      db: fixture.dbPath,
      snapshot: secondId,
    });
    expect(result.snapshot.id).toBe(secondId);
    expect(result.rows.map((r) => r.nodeId)).toEqual(["x.ts"]);
  });
});
