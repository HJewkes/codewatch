import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";

interface Workspace {
  root: string;
  tsConfigPath: string;
  dbPath: string;
}

async function createWorkspace(): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "code-style-dist-imports-"));

  await fs.mkdir(path.join(root, "pkg-a", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "pkg-b", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "pkg-b", "dist"), { recursive: true });

  await fs.writeFile(
    path.join(root, "pkg-b", "package.json"),
    JSON.stringify({
      name: "pkg-b",
      types: "./dist/index.d.ts",
      main: "./dist/index.js",
    }),
  );
  await fs.writeFile(
    path.join(root, "pkg-b", "src", "index.ts"),
    "export const b = 1;\n",
  );
  await fs.writeFile(
    path.join(root, "pkg-b", "dist", "index.d.ts"),
    "export declare const b: number;\n",
  );

  await fs.writeFile(
    path.join(root, "pkg-a", "src", "index.ts"),
    'import { b } from "pkg-b";\nexport const a = b + 1;\n',
  );

  const tsConfigPath = path.join(root, "tsconfig.json");
  await fs.writeFile(
    tsConfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        baseUrl: ".",
        paths: { "pkg-b": ["./pkg-b/dist/index.d.ts"] },
      },
      include: ["pkg-a/src/**/*", "pkg-b/src/**/*"],
    }),
  );

  return { root, tsConfigPath, dbPath: path.join(root, ".codewatch", "graph.db") };
}

describe("runGraphIndex with workspace dist imports", () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await createWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  it("produces no edges referencing nonexistent target nodes", async () => {
    const result = await runGraphIndex({
      rootDir: workspace.root,
      ref: "test",
      tsConfigPath: workspace.tsConfigPath,
      detectRenames: false,
    });

    const db = openDatabase(workspace.dbPath);
    try {
      const nodes = db.listNodes(result.snapshotId);
      const edges = db.listEdges(result.snapshotId);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const dangling = edges.filter(
        (e) => !nodeIds.has(e.srcId) || !nodeIds.has(e.dstId),
      );
      expect(dangling).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("remaps dist/*.d.ts imports to the matching src/*.ts node", async () => {
    const result = await runGraphIndex({
      rootDir: workspace.root,
      ref: "test",
      tsConfigPath: workspace.tsConfigPath,
      detectRenames: false,
    });

    const db = openDatabase(workspace.dbPath);
    try {
      const nodes = db.listNodes(result.snapshotId);
      const edges = db.listEdges(result.snapshotId);
      const fileIds = new Set(
        nodes.filter((n) => n.kind === "file").map((n) => n.id),
      );

      expect(fileIds.has("pkg-a/src/index.ts")).toBe(true);
      expect(fileIds.has("pkg-b/src/index.ts")).toBe(true);
      // dist file is excluded by the walker
      expect(fileIds.has("pkg-b/dist/index.d.ts")).toBe(false);

      const importEdge = edges.find(
        (e) =>
          e.srcId === "pkg-a/src/index.ts" && e.kind === "imports",
      );
      expect(importEdge).toBeDefined();
      // The fix: edge points to src/, not dist/
      expect(importEdge?.dstId).toBe("pkg-b/src/index.ts");
    } finally {
      db.close();
    }
  });
});
