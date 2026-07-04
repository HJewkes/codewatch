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
  "file_fingerprint",
];

describe("runMigrations", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dbDir = path.join(tmpdir(), `codewatch-graph-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dbDir, { recursive: true });
    dbPath = path.join(dbDir, "graph.db");
  });

  afterEach(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it("creates all expected tables on a fresh DB", () => {
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

  it("records every applied migration in the _migration table", () => {
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const rows = db
        .prepare("SELECT version FROM _migration ORDER BY version")
        .all() as Array<{ version: number }>;
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
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
      const before = (
        db2.prepare("SELECT COUNT(*) AS n FROM _migration").get() as { n: number }
      ).n;
      expect(() => runMigrations(db2)).not.toThrow();
      const after = (
        db2.prepare("SELECT COUNT(*) AS n FROM _migration").get() as { n: number }
      ).n;
      expect(after).toBe(before);
    } finally {
      db2.close();
    }
  });

  it("v2 adds a `role` column when upgrading a pre-role database", () => {
    const db = new Database(dbPath);
    try {
      // Simulate v1 with the OLD schema (no role column).
      db.exec(`
        CREATE TABLE _migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO _migration (version, applied_at) VALUES (1, '2020-01-01');
        CREATE TABLE snapshot (
          id INTEGER PRIMARY KEY, ref TEXT NOT NULL, commit_hash TEXT,
          taken_at TEXT NOT NULL, index_version TEXT NOT NULL,
          attrs JSON NOT NULL DEFAULT '{}'
        );
        CREATE TABLE node (
          snapshot_id INTEGER NOT NULL REFERENCES snapshot(id),
          id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
          parent_id TEXT, language TEXT, attrs JSON NOT NULL DEFAULT '{}',
          PRIMARY KEY (snapshot_id, id)
        );
      `);
      const before = db
        .prepare("PRAGMA table_info(node)")
        .all() as Array<{ name: string }>;
      expect(before.some((c) => c.name === "role")).toBe(false);

      runMigrations(db);

      const after = db
        .prepare("PRAGMA table_info(node)")
        .all() as Array<{ name: string }>;
      expect(after.some((c) => c.name === "role")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("v3 adds the file_fingerprint table when upgrading a pre-fingerprint database", () => {
    const db = new Database(dbPath);
    try {
      // Simulate a v2 database (no file_fingerprint table).
      db.exec(`
        CREATE TABLE _migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO _migration (version, applied_at) VALUES (1, '2020-01-01'), (2, '2020-01-02');
      `);
      const hasTable = (): boolean =>
        (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='file_fingerprint'",
            )
            .get() as { n: number }
        ).n > 0;
      expect(hasTable()).toBe(false);

      runMigrations(db);

      expect(hasTable()).toBe(true);
    } finally {
      db.close();
    }
  });
});
