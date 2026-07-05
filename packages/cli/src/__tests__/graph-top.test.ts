import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@codewatch/graph";
import {
  runGraphTopCommand,
  formatGraphTopText,
  formatGraphTopJson,
} from "../commands/graph-top.js";

interface Fixture {
  dir: string;
  dbPath: string;
  snapshotId: number;
}

async function createFixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-graph-top-"));
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

describe("runGraphTopCommand", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("returns rows ranked descending by value", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
        { id: "c.ts", kind: "file", name: "c.ts" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "loc", value: 50 },
        { nodeId: "b.ts", name: "loc", value: 200 },
        { nodeId: "c.ts", name: "loc", value: 100 },
      ]);
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
    });

    expect(result.rows.map((r) => r.nodeId)).toEqual(["b.ts", "c.ts", "a.ts"]);
    expect(result.rows[0]!.rank).toBe(1);
    expect(result.rows[0]!.value).toBe(200);
  });

  it("respects --limit", async () => {
    fixture = await createFixture((db, snapshotId) => {
      for (let i = 0; i < 5; i++) {
        db.insertNode(snapshotId, { id: `f${i}.ts`, kind: "file", name: "" });
        db.insertMetric(snapshotId, {
          nodeId: `f${i}.ts`,
          name: "loc",
          value: i,
        });
      }
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
      limit: 2,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.value).toBe(4);
  });

  it("filters by --kind", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "f.ts", kind: "file", name: "f.ts" },
        { id: "m", kind: "module", name: "m" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "f.ts", name: "fan_in", value: 1 },
        { nodeId: "m", name: "fan_in", value: 99 },
      ]);
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "fan_in",
      kind: "file",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.nodeId).toBe("f.ts");
  });

  it("throws a helpful error listing available metrics when the name is unknown", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetric(snapshotId, {
        nodeId: "f.ts",
        name: "loc",
        value: 1,
      });
    });

    expect(() =>
      runGraphTopCommand({
        db: fixture.dbPath,
        metric: "no_such_metric",
      }),
    ).toThrow(/not found.*Available: loc/);
  });

  it("renders a text table with rank/value/kind/id columns", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetric(snapshotId, {
        nodeId: "f.ts",
        name: "loc",
        value: 42,
        unit: "lines",
      });
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
    });
    const text = formatGraphTopText(result).replace(/\[[0-9;]*m/g, "");

    expect(text).toContain("Top by loc");
    expect(text).toContain("rank");
    expect(text).toContain("value");
    expect(text).toContain("42");
    expect(text).toContain("file");
    expect(text).toContain("f.ts");
  });

  it("renders empty state when nothing matches", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetric(snapshotId, { nodeId: "f.ts", name: "loc", value: 1 });
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
      kind: "module",
    });
    const text = formatGraphTopText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("No nodes have this metric.");
  });

  it("excludes nodes matching a substring pattern", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/foo.ts", kind: "file", name: "foo.ts" },
        { id: "src/__tests__/foo.test.ts", kind: "file", name: "foo.test.ts" },
        { id: "src/bar.ts", kind: "file", name: "bar.ts" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/foo.ts", name: "loc", value: 10 },
        { nodeId: "src/__tests__/foo.test.ts", name: "loc", value: 100 },
        { nodeId: "src/bar.ts", name: "loc", value: 50 },
      ]);
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
      exclude: ["__tests__"],
    });

    expect(result.rows.map((r) => r.nodeId)).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("excludes nodes matching glob patterns", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/a.ts", kind: "file", name: "a" },
        { id: "src/a.test.ts", kind: "file", name: "a.test" },
        { id: "src/sub/b.test.ts", kind: "file", name: "b.test" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/a.ts", name: "loc", value: 10 },
        { nodeId: "src/a.test.ts", name: "loc", value: 20 },
        { nodeId: "src/sub/b.test.ts", name: "loc", value: 30 },
      ]);
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
      exclude: ["**/*.test.ts"],
    });

    expect(result.rows.map((r) => r.nodeId)).toEqual(["src/a.ts"]);
  });

  it("respects --limit even after excludes oversample", async () => {
    fixture = await createFixture((db, snapshotId) => {
      for (let i = 0; i < 10; i++) {
        const id = i % 2 === 0 ? `keep/f${i}.ts` : `drop/f${i}.ts`;
        db.insertNode(snapshotId, { id, kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: id, name: "loc", value: i });
      }
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
      limit: 3,
      exclude: ["drop/"],
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.nodeId.startsWith("keep/"))).toBe(true);
  });

  it("always excludes generated-role nodes from hotspots (C-73)", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/generate.ts", kind: "file", name: "generate.ts", role: "source" },
        { id: "src/client.gen.ts", kind: "file", name: "client.gen.ts", role: "generated" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/generate.ts", name: "churn_180d", value: 50 },
        { nodeId: "src/client.gen.ts", name: "churn_180d", value: 290 },
      ]);
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "churn_180d",
    });
    expect(result.rows.map((r) => r.nodeId)).toEqual(["src/generate.ts"]);
  });

  it("emits JSON when requested", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetric(snapshotId, { nodeId: "f.ts", name: "loc", value: 5 });
    });

    const result = runGraphTopCommand({
      db: fixture.dbPath,
      metric: "loc",
    });
    const json = JSON.parse(formatGraphTopJson(result));
    expect(json.metric).toBe("loc");
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0].value).toBe(5);
  });
});
