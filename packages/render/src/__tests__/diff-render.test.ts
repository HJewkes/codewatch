import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@codewatch/graph";
import { loadDiff } from "../diff-snapshot.js";
import { renderHtml } from "../template.js";

interface Fixture {
  dir: string;
  dbPath: string;
}

async function createFixture(
  populate: (db: GraphDatabase, fromId: number, toId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-render-diff-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const fromId = db.createSnapshot({
    ref: "main",
    commitHash: "deadbeef0000000000000000000000000000beef",
    indexVersion: "0.1.0",
  });
  const toId = db.createSnapshot({
    ref: "feat/x",
    commitHash: "cafebabe0000000000000000000000000000babe",
    indexVersion: "0.1.0",
  });
  populate(db, fromId, toId);
  db.close();
  return { dir, dbPath };
}

describe("loadDiff", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("classifies nodes by status and unions both snapshots", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [
        { id: "shared.ts", kind: "file", name: "shared.ts" },
        { id: "removed.ts", kind: "file", name: "removed.ts" },
      ]);
      db.insertNodes(toId, [
        { id: "shared.ts", kind: "file", name: "shared.ts" },
        { id: "added.ts", kind: "file", name: "added.ts" },
      ]);
    });

    const input = await loadDiff({
      dbPath: fixture.dbPath,
      from: "main",
      to: "feat/x",
    });

    const ids = new Set(input.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set(["shared.ts", "removed.ts", "added.ts"]));
    expect(input.diff!.nodeStatus["added.ts"]).toBe("added");
    expect(input.diff!.nodeStatus["removed.ts"]).toBe("removed");
    expect(input.diff!.nodeStatus["shared.ts"]).toBeUndefined();
  });

  it("substitutes aliases so renamed nodes get a single status='renamed'", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "old.ts", kind: "file", name: "old.ts" }]);
      db.insertNodes(toId, [{ id: "new.ts", kind: "file", name: "new.ts" }]);
      db.insertAliases(toId, [
        { oldId: "old.ts", newId: "new.ts", reason: "rename" },
      ]);
    });

    const input = await loadDiff({
      dbPath: fixture.dbPath,
      from: "main",
      to: "feat/x",
    });

    expect(input.diff!.nodeStatus["new.ts"]).toBe("renamed");
    expect(input.diff!.nodeStatus["old.ts"]).toBeUndefined();
    expect(input.diff!.renames["new.ts"]).toBe("old.ts");
    expect(input.nodes.map((n) => n.id)).toEqual(["new.ts"]);
  });

  it("classifies edges by status, including added and removed", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
        { id: "c.ts", kind: "file", name: "c.ts" },
      ]);
      db.insertNodes(toId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
        { id: "c.ts", kind: "file", name: "c.ts" },
      ]);
      db.insertEdges(fromId, [
        { srcId: "a.ts", dstId: "b.ts", kind: "imports" },
      ]);
      db.insertEdges(toId, [
        { srcId: "a.ts", dstId: "c.ts", kind: "imports" },
      ]);
    });

    const input = await loadDiff({
      dbPath: fixture.dbPath,
      from: "main",
      to: "feat/x",
    });

    expect(input.diff!.edgeStatus["a.ts c.ts imports"]).toBe("added");
    expect(input.diff!.edgeStatus["a.ts b.ts imports"]).toBe("removed");
    expect(input.edges).toHaveLength(2);
  });
});

describe("renderHtml with diff metadata", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("emits status chips and color rules when the input has diff metadata", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "removed.ts", kind: "file", name: "removed.ts" }]);
      db.insertNodes(toId, [{ id: "added.ts", kind: "file", name: "added.ts" }]);
    });

    const input = await loadDiff({
      dbPath: fixture.dbPath,
      from: "main",
      to: "feat/x",
    });
    const html = await renderHtml(input);

    expect(html).toContain('data-status="added"');
    expect(html).toContain('data-status="removed"');
    expect(html).toContain('"status":"added"');
    expect(html).toContain('"status":"removed"');
    expect(html).toContain("status = 'added'");
    expect(html).toContain("status = 'removed'");
  });

  it("does not emit a status group when input has no diff", async () => {
    const html = await renderHtml({
      snapshotId: 1,
      nodes: [{ id: "a.ts", kind: "file", name: "a.ts" }],
      edges: [],
    });
    expect(html).not.toContain('class="chip status-chip');
  });

  it("renders the diff summary in the header with from→to refs", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
      db.insertNodes(toId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
      ]);
    });

    const input = await loadDiff({
      dbPath: fixture.dbPath,
      from: "main",
      to: "feat/x",
    });
    const html = await renderHtml(input);

    expect(html).toContain("main@deadbee");
    expect(html).toContain("feat/x@cafebab");
    expect(html).toContain("+1");
  });
});
