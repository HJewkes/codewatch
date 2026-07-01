import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@codewatch/graph";
import { loadSnapshot } from "../snapshot.js";

describe("loadSnapshot", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dbDir = path.join(
      tmpdir(),
      `codewatch-render-${Date.now()}-${Math.random()}`,
    );
    await fs.mkdir(dbDir, { recursive: true });
    dbPath = path.join(dbDir, "graph.db");
  });

  afterEach(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it("loads nodes and edges for an explicit snapshot id", async () => {
    const db = openDatabase(dbPath);
    const snapshotId = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    db.insertNode(snapshotId, { id: "a", kind: "file", name: "a.ts" });
    db.insertNode(snapshotId, { id: "b", kind: "file", name: "b.ts" });
    db.insertEdge(snapshotId, { srcId: "a", dstId: "b", kind: "imports" });
    db.close();

    const result = await loadSnapshot(dbPath, snapshotId);
    expect(result.snapshotId).toBe(snapshotId);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.kind).toBe("imports");
  });

  it("picks the latest snapshot when no id is given", async () => {
    const db = openDatabase(dbPath);
    const older = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
    // Force a distinct taken_at by inserting a small delay's worth of work.
    await new Promise((r) => setTimeout(r, 5));
    const newer = db.createSnapshot({ ref: "wd", indexVersion: "0.1.0" });
    db.insertNode(older, { id: "old", kind: "file", name: "old.ts" });
    db.insertNode(newer, { id: "new", kind: "file", name: "new.ts" });
    db.close();

    const result = await loadSnapshot(dbPath);
    expect(result.snapshotId).toBe(newer);
    expect(result.nodes.map((n) => n.id)).toEqual(["new"]);
  });

  it("throws when the DB has no snapshots", async () => {
    const db = openDatabase(dbPath);
    db.close();
    await expect(loadSnapshot(dbPath)).rejects.toThrow(/No snapshots/);
  });
});
