import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@codewatch/graph";

interface Project {
  rootDir: string;
  dbPath: string;
}

async function createFixtureProject(): Promise<Project> {
  const rootDir = await fs.mkdtemp(
    path.join(tmpdir(), "codewatch-graph-index-"),
  );
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "src", "a.ts"),
    'import { readFile } from "node:fs/promises";\n' +
      "export const A = readFile ? 1 : 0;\n",
  );
  await fs.writeFile(
    path.join(rootDir, "src", "b.ts"),
    'import { A } from "./a.js";\nexport const B = A + 1;\n',
  );
  return { rootDir, dbPath: path.join(rootDir, ".codewatch", "graph.db") };
}

describe("runGraphIndexCommand", () => {
  let project: Project;

  beforeAll(async () => {
    project = await createFixtureProject();
  });

  afterAll(async () => {
    await fs.rm(project.rootDir, { recursive: true, force: true });
  });

  it("indexes a small TypeScript project end-to-end", async () => {
    const { runGraphIndexCommand } = await import(
      "../commands/graph-index.js"
    );
    const { result } = await runGraphIndexCommand({
      rootDir: project.rootDir,
    });

    expect(result.files).toBe(2);
    expect(result.snapshotId).toBeGreaterThan(0);
    expect(result.dbPath).toBe(project.dbPath);
    expect(result.durationMs.total).toBeGreaterThan(0);

    const db = openDatabase(project.dbPath);
    try {
      const snapshots = db.listSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.ref).toBe("wd");
      expect(snapshots[0]!.indexVersion).toBe("0.3.0");

      const aFile = db.getNode(result.snapshotId, "src/a.ts");
      const bFile = db.getNode(result.snapshotId, "src/b.ts");
      expect(aFile?.kind).toBe("file");
      expect(bFile?.kind).toBe("file");

      const aModule = db.getNode(result.snapshotId, "src/a");
      expect(aModule?.kind).toBe("module");
      expect(aModule?.parentId).toBe("src");

      const nodeFs = db.getNode(result.snapshotId, "node:fs/promises");
      expect(nodeFs?.kind).toBe("external");

      const edges = db.listEdges(result.snapshotId);
      const internalImport = edges.find(
        (e) =>
          e.kind === "imports" &&
          e.srcId === "src/b.ts" &&
          e.dstId === "src/a.ts",
      );
      expect(internalImport).toBeDefined();

      const externalImport = edges.find(
        (e) =>
          e.kind === "imports" &&
          e.srcId === "src/a.ts" &&
          e.dstId === "node:fs/promises",
      );
      expect(externalImport).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("creates a second distinct snapshot on a re-index", async () => {
    const { runGraphIndexCommand } = await import(
      "../commands/graph-index.js"
    );
    const { result } = await runGraphIndexCommand({
      rootDir: project.rootDir,
      ref: "HEAD",
    });

    const db = openDatabase(project.dbPath);
    try {
      const snapshots = db.listSnapshots();
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      const ids = new Set(snapshots.map((s) => s.id));
      expect(ids.size).toBe(snapshots.length);
      expect(ids.has(result.snapshotId)).toBe(true);
      const refs = snapshots.map((s) => s.ref).sort();
      expect(refs).toEqual(["HEAD", "wd"]);
    } finally {
      db.close();
    }
  });

  it("reuses byte-identical files by default on re-index (incremental on)", async () => {
    const { runGraphIndexCommand } = await import(
      "../commands/graph-index.js"
    );
    const tmpRoot = await fs.mkdtemp(
      path.join(tmpdir(), "codewatch-graph-index-reuse-"),
    );
    try {
      await fs.writeFile(
        path.join(tmpRoot, "only.ts"),
        "export const x = 1;\n",
      );
      const { result: first } = await runGraphIndexCommand({ rootDir: tmpRoot });
      const { result: second } = await runGraphIndexCommand({ rootDir: tmpRoot });
      expect(second.reusedFiles).toBe(first.files);
      expect(second.reparsedFiles).toBe(0);

      const { result: forced } = await runGraphIndexCommand({
        rootDir: tmpRoot,
        incremental: false,
      });
      expect(forced.reusedFiles).toBe(0);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("emits JSON output when --json is set", async () => {
    const { runGraphIndexCommand } = await import(
      "../commands/graph-index.js"
    );
    const tmpRoot = await fs.mkdtemp(
      path.join(tmpdir(), "codewatch-graph-index-json-"),
    );
    try {
      await fs.writeFile(
        path.join(tmpRoot, "only.ts"),
        "export const x = 1;\n",
      );
      const { output, result } = await runGraphIndexCommand({
        rootDir: tmpRoot,
        json: true,
      });
      const parsed = JSON.parse(output);
      expect(parsed.snapshotId).toBe(result.snapshotId);
      expect(parsed.files).toBe(1);
      expect(parsed.nodesByKind.file).toBe(1);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
