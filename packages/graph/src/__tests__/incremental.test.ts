import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { parseFile } from "@codewatch/core";
import { openDatabase, GraphDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";
import { computeSourceMetrics, SOURCE_METRIC_NAMES } from "../source-metrics.js";

interface Project {
  rootDir: string;
  dbPath: string;
}

const A_TS = "export const A = 1;\n";
// A function with branching + nesting and an external import — exercises
// cyclomatic/cognitive/nesting metrics and an external node + edge.
const B_TS = `import { A } from "./a.js";
import * as path from "node:path";

export function classify(n: number): string {
  if (n > A) {
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) return path.sep;
    }
  }
  return "none";
}
`;
// A class with two methods sharing a field — exercises lcom4 + class_count.
const C_TS = `export class Counter {
  private value = 0;
  inc(): void {
    this.value += 1;
  }
  read(): number {
    return this.value;
  }
}
`;

async function writeBaseFiles(rootDir: string): Promise<void> {
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "src", "a.ts"), A_TS);
  await fs.writeFile(path.join(rootDir, "src", "b.ts"), B_TS);
  await fs.writeFile(path.join(rootDir, "src", "c.ts"), C_TS);
}

async function createProject(): Promise<Project> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-incr-"));
  await writeBaseFiles(rootDir);
  return { rootDir, dbPath: path.join(rootDir, ".codewatch", "graph.db") };
}

interface Snapshot {
  nodes: string[];
  edges: string[];
  metrics: string[];
}

function readSnapshot(db: GraphDatabase, snapshotId: number): Snapshot {
  const nodes = db
    .listNodes(snapshotId)
    .map((n) =>
      JSON.stringify({
        id: n.id,
        kind: n.kind,
        name: n.name,
        parentId: n.parentId ?? null,
        language: n.language ?? null,
        role: n.role ?? null,
        attrs: n.attrs ?? {},
      }),
    )
    .sort();
  const edges = db
    .listEdges(snapshotId)
    .map((e) =>
      JSON.stringify({
        srcId: e.srcId,
        dstId: e.dstId,
        kind: e.kind,
        attrs: e.attrs ?? {},
      }),
    )
    .sort();
  const metrics = db
    .listMetrics(snapshotId)
    .map((m) =>
      JSON.stringify({
        nodeId: m.nodeId,
        name: m.name,
        value: m.value,
        unit: m.unit ?? null,
      }),
    )
    .sort();
  return { nodes, edges, metrics };
}

/** Index `rootDir` from scratch into a throwaway db and return its snapshot. */
async function fullIndexSnapshot(rootDir: string): Promise<Snapshot> {
  const dbPath = path.join(
    await fs.mkdtemp(path.join(tmpdir(), "codewatch-truth-")),
    "graph.db",
  );
  const result = await runGraphIndex({ rootDir, dbPath });
  const db = openDatabase(dbPath);
  try {
    return readSnapshot(db, result.snapshotId);
  } finally {
    db.close();
  }
}

describe("fingerprint-based incremental indexing", () => {
  let project: Project;

  beforeEach(async () => {
    project = await createProject();
  });

  afterEach(async () => {
    await fs.rm(project.rootDir, { recursive: true, force: true });
  });

  it("reuses every file on a no-change re-index", async () => {
    const first = await runGraphIndex({ rootDir: project.rootDir });
    const second = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: true,
    });

    expect(second.reusedFiles).toBe(first.files);
    expect(second.reparsedFiles).toBe(0);

    const db = openDatabase(project.dbPath);
    try {
      expect(readSnapshot(db, second.snapshotId)).toEqual(
        readSnapshot(db, first.snapshotId),
      );
    } finally {
      db.close();
    }
  });

  it("carries symbol nodes and references edges forward on reuse (C-53)", async () => {
    const first = await runGraphIndex({ rootDir: project.rootDir });
    const second = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: true,
    });
    expect(second.reparsedFiles).toBe(0);

    const db = openDatabase(project.dbPath);
    try {
      // The symbol layer is opt-in on reads (file-level graph is the default).
      const nodes = db.listNodes(second.snapshotId, { includeSymbols: true });
      // a.ts declares `A`; its symbol node must survive reuse (content-derived,
      // so it can't be rebuilt from path alone like the file/module nodes).
      expect(
        nodes.some((n) => n.kind === "symbol" && n.id === "src/a.ts#A"),
      ).toBe(true);
      // b.ts imports A → a forward reference edge to the origin symbol.
      const refs = db
        .listEdges(second.snapshotId, { includeReferences: true })
        .filter((e) => e.kind === "references");
      expect(
        refs.some((e) => e.srcId === "src/b.ts" && e.dstId === "src/a.ts#A"),
      ).toBe(true);
      // The reused snapshot equals the from-scratch one, symbols and all.
      expect(readSnapshot(db, second.snapshotId)).toEqual(
        readSnapshot(db, first.snapshotId),
      );
    } finally {
      db.close();
    }
  });

  it("produces a snapshot identical to a full index after one file changes", async () => {
    await runGraphIndex({ rootDir: project.rootDir });

    // Structural change to one file; the others stay byte-identical.
    await fs.writeFile(
      path.join(project.rootDir, "src", "a.ts"),
      "export const A = 42;\nexport const A2 = A + 1;\n",
    );

    const incremental = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: true,
    });
    expect(incremental.reparsedFiles).toBe(1);
    expect(incremental.reusedFiles).toBe(incremental.files - 1);

    const db = openDatabase(project.dbPath);
    try {
      const incrementalSnap = readSnapshot(db, incremental.snapshotId);
      const fullSnap = await fullIndexSnapshot(project.rootDir);
      expect(incrementalSnap).toEqual(fullSnap);
    } finally {
      db.close();
    }
  });

  it("falls back to a full index when a file is added (membership change)", async () => {
    await runGraphIndex({ rootDir: project.rootDir });

    await fs.writeFile(
      path.join(project.rootDir, "src", "d.ts"),
      'import { A } from "./a.js";\nexport const D = A;\n',
    );

    const incremental = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: true,
    });
    // Membership changed → nothing reused, every file re-parsed.
    expect(incremental.reusedFiles).toBe(0);
    expect(incremental.reparsedFiles).toBe(incremental.files);

    const db = openDatabase(project.dbPath);
    try {
      const incrementalSnap = readSnapshot(db, incremental.snapshotId);
      const fullSnap = await fullIndexSnapshot(project.rootDir);
      expect(incrementalSnap).toEqual(fullSnap);
    } finally {
      db.close();
    }
  });

  it("reuses byte-identical files by default (no flag)", async () => {
    const first = await runGraphIndex({ rootDir: project.rootDir });
    const second = await runGraphIndex({ rootDir: project.rootDir });
    expect(second.reusedFiles).toBe(first.files);
    expect(second.reparsedFiles).toBe(0);
  });

  it("does not reuse anything when incremental is disabled", async () => {
    await runGraphIndex({ rootDir: project.rootDir });
    const second = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: false,
    });
    expect(second.reusedFiles).toBe(0);
    expect(second.reparsedFiles).toBe(second.files);
  });

  it("writes fingerprints on every run, enabling later reuse", async () => {
    // First run is a plain full index (no flag) — must still persist fingerprints.
    await runGraphIndex({ rootDir: project.rootDir });
    const second = await runGraphIndex({
      rootDir: project.rootDir,
      incremental: true,
    });
    expect(second.reusedFiles).toBe(second.files);
  });

  it("keeps SOURCE_METRIC_NAMES in sync with what computeSourceMetrics emits", async () => {
    const files = await Promise.all(
      ["a.ts", "b.ts", "c.ts"].map(async (name) => {
        const filePath = path.join(project.rootDir, "src", name);
        const content = await fs.readFile(filePath, "utf-8");
        return parseFile(content, filePath, "typescript");
      }),
    );
    const emitted = new Set(
      computeSourceMetrics(files, (p) => p).map((m) => m.name),
    );
    for (const name of emitted) {
      expect(SOURCE_METRIC_NAMES.has(name)).toBe(true);
    }
  });
});
