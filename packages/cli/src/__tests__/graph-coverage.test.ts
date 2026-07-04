import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase, type GraphNode } from "@codewatch/graph";
import { runGraphCoverageCommand } from "../commands/graph-coverage.js";

interface Fixture {
  dir: string;
  dbPath: string;
  snapshotId: number;
}

const fileNode = (id: string): GraphNode => ({ id, kind: "file", name: id });
const symNode = (file: string, name: string, startLine: number, endLine: number): GraphNode => ({
  id: `${file}#${name}`,
  kind: "symbol",
  name,
  parentId: file,
  attrs: { exported: true, startLine, endLine },
});

async function fixture(populate: (db: GraphDatabase, snapshotId: number) => void): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-coverage-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.9.0" });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath, snapshotId };
}

async function writeCoverage(dir: string, body: unknown): Promise<string> {
  const p = path.join(dir, "coverage-final.json");
  await fs.writeFile(p, JSON.stringify(body));
  return p;
}

describe("runGraphCoverageCommand (C-63)", () => {
  let fx: Fixture;
  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("ingests coverage as per-file and per-symbol coverage_pct on the snapshot", async () => {
    fx = await fixture((db, snap) => {
      db.insertNodes(snap, [
        fileNode("src/a.ts"),
        symNode("src/a.ts", "foo", 1, 6),
        symNode("src/a.ts", "bar", 7, 12),
      ]);
    });
    // dir is not a git repo → idRoot === root, so <dir>/src/a.ts maps to "src/a.ts".
    const cov = await writeCoverage(fx.dir, {
      [path.join(fx.dir, "src/a.ts")]: {
        fnMap: { "0": fn(3), "1": fn(9) },
        f: { "0": 4, "1": 0 },
      },
    });

    const result = runGraphCoverageCommand(cov, { db: fx.dbPath, root: fx.dir });
    expect(result).toMatchObject({ files: 1, symbols: 2 });

    const db = openDatabase(fx.dbPath);
    try {
      const pct = (id: string) =>
        db.listMetrics(fx.snapshotId).find((m) => m.nodeId === id && m.name === "coverage_pct")?.value;
      expect(pct("src/a.ts")).toBe(50); // foo hit, bar not → 1/2
      expect(pct("src/a.ts#foo")).toBe(100);
      expect(pct("src/a.ts#bar")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("replaces prior coverage on re-ingest (no stale accumulation)", async () => {
    fx = await fixture((db, snap) => {
      db.insertNodes(snap, [fileNode("src/a.ts"), symNode("src/a.ts", "foo", 1, 6)]);
    });
    const covPath = path.join(fx.dir, "src/a.ts");
    const first = await writeCoverage(fx.dir, { [covPath]: { fnMap: { "0": fn(3) }, f: { "0": 0 } } });
    runGraphCoverageCommand(first, { db: fx.dbPath, root: fx.dir });
    // Re-ingest with the function now covered.
    const second = await writeCoverage(fx.dir, { [covPath]: { fnMap: { "0": fn(3) }, f: { "0": 9 } } });
    runGraphCoverageCommand(second, { db: fx.dbPath, root: fx.dir });

    const db = openDatabase(fx.dbPath);
    try {
      const rows = db.listMetrics(fx.snapshotId).filter((m) => m.name === "coverage_pct" && m.nodeId === "src/a.ts#foo");
      expect(rows).toHaveLength(1); // replaced, not duplicated
      expect(rows[0]!.value).toBe(100);
    } finally {
      db.close();
    }
  });
});

const fn = (line: number) => ({ loc: { start: { line }, end: { line: line + 1 } } });
