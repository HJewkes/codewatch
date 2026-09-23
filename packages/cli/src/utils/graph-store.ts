import { existsSync, renameSync } from "node:fs";
import { openCodeGraph, type CodeGraphStore } from "@titan-design/code-graph";
import { hasTable, openDatabase } from "@titan-design/store-sqlite";

export const LEGACY_DB_MESSAGE =
  "this database predates codewatch 0.2; run `codewatch graph index`";

/**
 * Pre-swap `@codewatch/graph` files carry a `boundary` table the code-graph schema never
 * creates. Returns the newest snapshot's index version, "unknown" when it has none, or
 * null for a current or absent file.
 */
export function legacyGraphDbVersion(dbPath: string): string | null {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return null;
  const db = openDatabase(dbPath, { readonly: true });
  try {
    if (!hasTable(db, "boundary")) return null;
    const row = db
      .prepare("SELECT index_version FROM snapshot ORDER BY id DESC LIMIT 1")
      .get() as { index_version: string } | undefined;
    return row?.index_version ?? "unknown";
  } finally {
    db.close();
  }
}

/** Open the graph for reading; a legacy file is an error the user fixes by reindexing. */
export function openGraphStore(dbPath: string): CodeGraphStore {
  if (legacyGraphDbVersion(dbPath) !== null) {
    throw new Error(`${dbPath}: ${LEGACY_DB_MESSAGE}`);
  }
  return openCodeGraph(dbPath);
}

/** Never overwrite an earlier aside file: append -2, -3, ... until the name is free. */
function freeAsidePath(base: string): string {
  let candidate = base;
  for (let n = 2; existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** Rename a legacy file aside so `graph index` starts a fresh store; returns the new path. */
export function moveLegacyGraphDbAside(dbPath: string): string | null {
  const version = legacyGraphDbVersion(dbPath);
  if (version === null) return null;
  const aside = freeAsidePath(`${dbPath}.legacy-${version}`);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, aside + suffix);
  }
  return aside;
}
