import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openCodeGraph } from "@titan-design/code-graph";
import { openDatabase, SchemaTooNewError } from "@titan-design/store-sqlite";
import { runGraphIndex } from "../commands/graph-index-run.js";
import { runGraphTopCommand } from "../commands/graph-top.js";
import { LEGACY_DB_MESSAGE, legacyGraphDbVersion } from "../utils/graph-store.js";

const LEGACY_SCHEMA = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "legacy-graph-schema.sql"),
  "utf8",
);
const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");

/** A graph.db as `@codewatch/graph` 0.1 wrote it: schema.sql plus its five recorded migrations. */
function writeLegacyDb(dbPath: string, indexVersion = "0.12.0"): void {
  const db = openDatabase(dbPath);
  db.exec(LEGACY_SCHEMA);
  db.exec("CREATE TABLE _migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (let v = 1; v <= 5; v++) {
    db.prepare("INSERT INTO _migration (version, applied_at) VALUES (?, ?)").run(v, "2026-09-01T00:00:00Z");
  }
  db.prepare("INSERT INTO snapshot (ref, taken_at, index_version) VALUES (?, ?, ?)").run(
    "wd",
    "2026-09-01T00:00:00Z",
    indexVersion,
  );
  db.close();
}

describe("a graph.db written before the code-graph store", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-legacy-db-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const a = 1;\n");
    dbPath = path.join(dir, ".codewatch", "graph.db");
    await fs.mkdir(path.dirname(dbPath));
    writeLegacyDb(dbPath);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("cannot be opened by the package store directly, which is why the CLI guards it", () => {
    expect(() => openCodeGraph(dbPath)).toThrow(SchemaTooNewError);
  });

  it("is detected by its boundary table and reports its newest index version", () => {
    expect(legacyGraphDbVersion(dbPath)).toBe("0.12.0");
  });

  it("is renamed aside by graph index with one notice line, and a fresh store is built", async () => {
    const notices: string[] = [];

    const result = await runGraphIndex({ rootDir: dir, computeChurn: false, onNotice: (l) => notices.push(l) });

    const aside = `${dbPath}.legacy-0.12.0`;
    expect(notices).toEqual([
      `codewatch: ${dbPath} predates codewatch 0.2; renamed it to ${aside} and started a fresh index`,
    ]);
    expect(legacyGraphDbVersion(aside)).toBe("0.12.0");
    expect(legacyGraphDbVersion(dbPath)).toBeNull();
    const store = openCodeGraph(dbPath);
    try {
      expect(store.listSnapshots().map((s) => s.id)).toEqual([result.snapshotId]);
    } finally {
      store.close();
    }
  });

  it("is left alone on the second index, once the fresh store exists", async () => {
    await runGraphIndex({ rootDir: dir, computeChurn: false, onNotice: () => undefined });
    const notices: string[] = [];

    await runGraphIndex({ rootDir: dir, computeChurn: false, onNotice: (l) => notices.push(l) });

    expect(notices).toEqual([]);
    expect(existsSync(`${dbPath}.legacy-0.12.0`)).toBe(true);
  });

  it("makes a read command fail with the reindex instruction and leaves the file untouched", async () => {
    const before = await fs.readFile(dbPath);

    expect(() => runGraphTopCommand({ db: dbPath, metric: "loc" })).toThrow(`${dbPath}: ${LEGACY_DB_MESSAGE}`);
    expect(await fs.readFile(dbPath)).toEqual(before);
  });

  it("exits 1 from the built CLI on a read command", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [CLI_ENTRY, "graph", "top", "--db", dbPath, "--metric", "loc"], { stdio: "pipe" });
    } catch (err) {
      const e = err as { status: number; stderr: Buffer };
      status = e.status;
      stderr = e.stderr.toString();
    }
    expect(status).toBe(1);
    expect(stderr).toContain(LEGACY_DB_MESSAGE);
  });
});
