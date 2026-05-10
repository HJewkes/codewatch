import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";

const EXPECTED_TABLES = [
  "snapshot",
  "node",
  "edge",
  "metric",
  "id_alias",
  "boundary",
  "entry_point",
];

describe("runMigrations", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dbDir = path.join(tmpdir(), `code-style-graph-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dbDir, { recursive: true });
    dbPath = path.join(dbDir, "graph.db");
  });

  afterEach(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it("creates all seven tables on a fresh DB", () => {
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((t) => t.name));
      for (const expected of EXPECTED_TABLES) {
        expect(names.has(expected)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("records the migration in the _migration table", () => {
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const rows = db
        .prepare("SELECT version FROM _migration")
        .all() as Array<{ version: number }>;
      expect(rows).toEqual([{ version: 1 }]);
    } finally {
      db.close();
    }
  });

  it("is idempotent across re-opens", () => {
    const db1 = new Database(dbPath);
    runMigrations(db1);
    db1.close();

    const db2 = new Database(dbPath);
    try {
      expect(() => runMigrations(db2)).not.toThrow();
      const rows = db2
        .prepare("SELECT COUNT(*) AS n FROM _migration")
        .get() as { n: number };
      expect(rows.n).toBe(1);
    } finally {
      db2.close();
    }
  });
});
