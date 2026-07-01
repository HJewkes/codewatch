import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, GraphDatabase } from "../database.js";

describe("GraphDatabase", () => {
  let dbDir: string;
  let dbPath: string;
  let db: GraphDatabase;

  beforeEach(async () => {
    dbDir = path.join(tmpdir(), `codewatch-graph-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dbDir, { recursive: true });
    dbPath = path.join(dbDir, "graph.db");
    db = openDatabase(dbPath);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it("creates a snapshot and round-trips it", () => {
    const id = db.createSnapshot({
      ref: "main",
      commitHash: "abc123",
      indexVersion: "0.1.0",
      attrs: { language: "typescript" },
    });
    expect(id).toBeGreaterThan(0);

    const snapshot = db.getSnapshot(id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ref).toBe("main");
    expect(snapshot!.commitHash).toBe("abc123");
    expect(snapshot!.indexVersion).toBe("0.1.0");
    expect(snapshot!.attrs).toEqual({ language: "typescript" });
  });

  it("inserts and retrieves a node", () => {
    const snapshotId = db.createSnapshot({
      ref: "wd",
      indexVersion: "0.1.0",
    });
    db.insertNode(snapshotId, {
      id: "packages/graph/src/database",
      kind: "module",
      name: "database",
      parentId: "@codewatch/graph",
      language: "typescript",
      attrs: { loc: 120 },
    });

    const node = db.getNode(snapshotId, "packages/graph/src/database");
    expect(node).not.toBeNull();
    expect(node!.kind).toBe("module");
    expect(node!.name).toBe("database");
    expect(node!.parentId).toBe("@codewatch/graph");
    expect(node!.language).toBe("typescript");
    expect(node!.attrs).toEqual({ loc: 120 });
  });

  it("inserts an edge between two nodes", () => {
    const snapshotId = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    db.insertNode(snapshotId, { id: "a", kind: "file", name: "a.ts" });
    db.insertNode(snapshotId, { id: "b", kind: "file", name: "b.ts" });
    expect(() =>
      db.insertEdge(snapshotId, {
        srcId: "a",
        dstId: "b",
        kind: "imports",
        attrs: { count: 3 },
      }),
    ).not.toThrow();
  });

  it("inserts a metric", () => {
    const snapshotId = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    db.insertNode(snapshotId, { id: "a", kind: "file", name: "a.ts" });
    expect(() =>
      db.insertMetric(snapshotId, {
        nodeId: "a",
        name: "loc",
        value: 42,
        unit: "lines",
      }),
    ).not.toThrow();
  });

  it("lists snapshots, optionally filtered by ref", () => {
    const a = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
    const b = db.createSnapshot({ ref: "feature/x", indexVersion: "0.1.0" });

    const all = db.listSnapshots();
    expect(all.map((s) => s.id).sort()).toEqual([a, b].sort());

    const main = db.listSnapshots({ ref: "main" });
    expect(main).toHaveLength(1);
    expect(main[0]!.id).toBe(a);
  });

  it("returns null for missing nodes and snapshots", () => {
    const snapshotId = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    expect(db.getNode(snapshotId, "does-not-exist")).toBeNull();
    expect(db.getSnapshot(99999)).toBeNull();
  });

  it("round-trips the role column on a node", () => {
    const snapshotId = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    db.insertNode(snapshotId, {
      id: "src/foo.test.ts",
      kind: "file",
      name: "foo.test",
      role: "test",
    });
    db.insertNode(snapshotId, {
      id: "src/index.ts",
      kind: "file",
      name: "index",
      role: "barrel",
    });
    db.insertNode(snapshotId, {
      id: "src/no-role.ts",
      kind: "file",
      name: "no-role",
    });

    const fetched = db.listNodes(snapshotId);
    const byId = new Map(fetched.map((n) => [n.id, n]));
    expect(byId.get("src/foo.test.ts")!.role).toBe("test");
    expect(byId.get("src/index.ts")!.role).toBe("barrel");
    expect(byId.get("src/no-role.ts")!.role).toBeUndefined();
  });
});
