import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@code-style/graph";
import {
  runGraphDiffCommand,
  formatGraphDiffText,
  formatGraphDiffJson,
} from "../commands/graph-diff.js";

interface Fixture {
  dir: string;
  dbPath: string;
  fromId: number;
  toId: number;
}

async function createFixture(
  populate: (db: GraphDatabase, fromId: number, toId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-graph-diff-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const fromId = db.createSnapshot({
    ref: "main",
    commitHash: "aaaaaaaa",
    indexVersion: "0.1.0",
  });
  const toId = db.createSnapshot({
    ref: "feat/foo",
    commitHash: "bbbbbbbb",
    indexVersion: "0.1.0",
  });
  populate(db, fromId, toId);
  db.close();
  return { dir, dbPath, fromId, toId };
}

describe("runGraphDiffCommand", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("resolves snapshots by numeric id and reports added/removed nodes", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "removed.ts", kind: "file", name: "removed.ts" },
      ]);
      db.insertNodes(toId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "added.ts", kind: "file", name: "added.ts" },
      ]);
    });

    const result = await runGraphDiffCommand({
      db: fixture.dbPath,
      from: String(fixture.fromId),
      to: String(fixture.toId),
    });

    expect(result.fromSnapshot.id).toBe(fixture.fromId);
    expect(result.toSnapshot.id).toBe(fixture.toId);
    expect(result.diff.summary.addedNodes).toBe(1);
    expect(result.diff.summary.removedNodes).toBe(1);
    expect(result.diff.addedNodes[0]!.id).toBe("added.ts");
    expect(result.diff.removedNodes[0]!.id).toBe("removed.ts");
  });

  it("resolves snapshots by ref name (latest snapshot for that ref)", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
      db.insertNodes(toId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
    });

    const result = await runGraphDiffCommand({
      db: fixture.dbPath,
      from: "main",
      to: "feat/foo",
    });

    expect(result.fromSnapshot.ref).toBe("main");
    expect(result.toSnapshot.ref).toBe("feat/foo");
    expect(result.diff.summary.unchangedNodes).toBe(1);
  });

  it("throws a helpful error when the ref has no snapshots", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
      db.insertNodes(toId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
    });

    await expect(
      runGraphDiffCommand({
        db: fixture.dbPath,
        from: "no-such-ref",
        to: "feat/foo",
      }),
    ).rejects.toThrow(/no snapshot found for ref "no-such-ref"/);
  });

  it("throws when the numeric id does not exist", async () => {
    fixture = await createFixture(() => {});

    await expect(
      runGraphDiffCommand({
        db: fixture.dbPath,
        from: "9999",
        to: String(fixture.toId),
      }),
    ).rejects.toThrow(/no snapshot with id 9999/);
  });

  it("renders a text summary with snapshot labels and counts", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "old.ts", kind: "file", name: "old.ts" }]);
      db.insertNodes(toId, [{ id: "new.ts", kind: "file", name: "new.ts" }]);
    });

    const result = await runGraphDiffCommand({
      db: fixture.dbPath,
      from: "main",
      to: "feat/foo",
    });
    const text = stripAnsi(formatGraphDiffText(result));

    expect(text).toContain("Graph diff:");
    expect(text).toContain("main@aaaaaaa");
    expect(text).toContain("feat/foo@bbbbbbb");
    expect(text).toContain("Nodes");
    expect(text).toContain("+1 added");
    expect(text).toContain("-1 removed");
  });

  it("emits machine-readable JSON when requested", async () => {
    fixture = await createFixture((db, fromId, toId) => {
      db.insertNodes(fromId, [{ id: "a.ts", kind: "file", name: "a.ts" }]);
      db.insertNodes(toId, [
        { id: "a.ts", kind: "file", name: "a.ts" },
        { id: "b.ts", kind: "file", name: "b.ts" },
      ]);
    });

    const result = await runGraphDiffCommand({
      db: fixture.dbPath,
      from: "main",
      to: "feat/foo",
    });
    const json = JSON.parse(formatGraphDiffJson(result));

    expect(json.from.ref).toBe("main");
    expect(json.to.ref).toBe("feat/foo");
    expect(json.diff.summary.addedNodes).toBe(1);
    expect(json.diff.addedNodes[0].id).toBe("b.ts");
  });
});

function stripAnsi(s: string): string {
  return s.replace(/\[[0-9;]*m/g, "");
}
