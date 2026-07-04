import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      const schema = readFileSync(schemaPath, "utf8");
      db.exec(schema);
    },
  },
  {
    version: 2,
    up: (db) => {
      const cols = db
        .prepare("PRAGMA table_info(node)")
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "role")) {
        db.exec("ALTER TABLE node ADD COLUMN role TEXT");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_node_role ON node (snapshot_id, role)",
        );
      }
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_fingerprint (
          snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
          file_id       TEXT NOT NULL,
          content_hash  TEXT NOT NULL,
          PRIMARY KEY (snapshot_id, file_id)
        );
      `);
    },
  },
  {
    // C-18: structural (comment/whitespace-insensitive) hash for the COSMETIC
    // reuse tier. Nullable, so pre-existing fingerprint rows stay valid.
    version: 4,
    up: (db) => {
      const cols = db
        .prepare("PRAGMA table_info(file_fingerprint)")
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "structural_hash")) {
        db.exec("ALTER TABLE file_fingerprint ADD COLUMN structural_hash TEXT");
      }
    },
  },
];

function ensureMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migration (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedVersions(db: Database.Database): Set<number> {
  const rows = db
    .prepare("SELECT version FROM _migration")
    .all() as Array<{ version: number }>;
  return new Set(rows.map((r) => r.version));
}

export function runMigrations(db: Database.Database): void {
  ensureMigrationTable(db);
  const applied = appliedVersions(db);
  const recordStmt = db.prepare(
    "INSERT INTO _migration (version, applied_at) VALUES (?, ?)",
  );
  const apply = db.transaction((m: Migration) => {
    m.up(db);
    recordStmt.run(m.version, new Date().toISOString());
  });
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    apply(migration);
  }
}
