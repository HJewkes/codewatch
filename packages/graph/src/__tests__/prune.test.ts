import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "../database.js";
import { planPrune, runPrune } from "../prune.js";

interface Fixture {
  dir: string;
  dbPath: string;
}

async function createFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-prune-"));
  return { dir, dbPath: path.join(dir, "graph.db") };
}

async function populate(
  fixture: Fixture,
  populator: (db: GraphDatabase) => void,
): Promise<void> {
  const db = openDatabase(fixture.dbPath);
  try {
    populator(db);
  } finally {
    db.close();
  }
}

function createN(
  db: GraphDatabase,
  refs: readonly string[],
): number[] {
  const ids: number[] = [];
  for (const ref of refs) {
    const id = db.createSnapshot({ ref, indexVersion: "0.1.0" });
    db.insertNode(id, { id: `f-${id}.ts`, kind: "file", name: "f" });
    ids.push(id);
  }
  return ids;
}

describe("planPrune", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await createFixture();
  });
  afterEach(async () => {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("keeps the most recent N by default", async () => {
    await populate(fixture, (db) => createN(db, ["a", "b", "c", "d", "e"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const plan = planPrune(db, { keep: 2 });
      expect(plan.keep.map((s) => s.ref)).toEqual(["e", "d"]);
      expect(plan.remove.map((s) => s.ref).sort()).toEqual(["a", "b", "c"]);
    } finally {
      db.close();
    }
  });

  it("always keeps snapshots whose ref is in keepRefs, even if older than keep limit", async () => {
    await populate(fixture, (db) => createN(db, ["main", "a", "b", "c", "d"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const plan = planPrune(db, { keep: 2, keepRefs: ["main"] });
      const keptRefs = new Set(plan.keep.map((s) => s.ref));
      expect(keptRefs.has("main")).toBe(true);
      expect(keptRefs.has("d")).toBe(true);
      expect(keptRefs.has("c")).toBe(true);
      const removedRefs = plan.remove.map((s) => s.ref).sort();
      expect(removedRefs).toEqual(["a", "b"]);
    } finally {
      db.close();
    }
  });

  it("returns empty remove list when total snapshots <= keep", async () => {
    await populate(fixture, (db) => createN(db, ["a", "b"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const plan = planPrune(db, { keep: 10 });
      expect(plan.remove).toEqual([]);
      expect(plan.keep).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("runPrune", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await createFixture();
  });
  afterEach(async () => {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("deletes the planned snapshots and cascades to nodes", async () => {
    await populate(fixture, (db) => createN(db, ["a", "b", "c"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const before = db.listSnapshots({ limit: 100 }).length;
      expect(before).toBe(3);
      const result = runPrune(db, { keep: 1 });
      expect(result.plan.remove).toHaveLength(2);
      expect(db.listSnapshots({ limit: 100 })).toHaveLength(1);
      expect(result.rowsBefore.snapshot).toBe(3);
      expect(result.rowsAfter.snapshot).toBe(1);
      expect(result.rowsBefore.node).toBe(3);
      expect(result.rowsAfter.node).toBe(1);
    } finally {
      db.close();
    }
  });

  it("is a no-op when nothing is over the keep limit", async () => {
    await populate(fixture, (db) => createN(db, ["a", "b"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runPrune(db, { keep: 5 });
      expect(result.plan.remove).toEqual([]);
      expect(result.rowsBefore.snapshot).toBe(result.rowsAfter.snapshot);
    } finally {
      db.close();
    }
  });

  it("vacuums when requested", async () => {
    await populate(fixture, (db) => createN(db, ["a", "b", "c"]));
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runPrune(db, { keep: 1, vacuum: true });
      expect(result.vacuumed).toBe(true);
    } finally {
      db.close();
    }
  });
});
