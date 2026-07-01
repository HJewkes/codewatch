import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@codewatch/graph";

interface Project {
  rootDir: string;
  dbPath: string;
  outPath: string;
}

async function createFixtureProject(): Promise<Project> {
  const rootDir = await fs.mkdtemp(
    path.join(tmpdir(), "codewatch-graph-render-"),
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
  return {
    rootDir,
    dbPath: path.join(rootDir, ".codewatch", "graph.db"),
    outPath: path.join(rootDir, "graph.html"),
  };
}

describe("runGraphRenderCommand", () => {
  let project: Project;

  beforeAll(async () => {
    project = await createFixtureProject();
    const { runGraphIndexCommand } = await import(
      "../commands/graph-index.js"
    );
    await runGraphIndexCommand({ rootDir: project.rootDir });
  });

  afterAll(async () => {
    await fs.rm(project.rootDir, { recursive: true, force: true });
  });

  it("renders a graph snapshot to a non-empty HTML file containing node ids", async () => {
    const { runGraphRenderCommand } = await import(
      "../commands/graph-render.js"
    );
    const result = await runGraphRenderCommand({
      db: project.dbPath,
      snapshot: 1,
      out: project.outPath,
      title: "fixture",
      subtitle: "test",
    });

    expect(result.outPath).toBe(path.resolve(project.outPath));
    expect(result.snapshotId).toBe(1);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(0);
    expect(result.sizeBytes).toBeGreaterThan(1024);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const buf = await fs.readFile(project.outPath);
    expect(buf.byteLength).toBe(result.sizeBytes);
    const html = buf.toString("utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("fixture");
    expect(html).toContain("src/a.ts");
    expect(html).toContain("src/b.ts");
    expect(html).toContain("node:fs/promises");
  });

  it("renders the latest snapshot when --snapshot is omitted", async () => {
    const db = openDatabase(project.dbPath);
    const newerId = db.createSnapshot({
      ref: "newer",
      indexVersion: "0.1.0",
    });
    db.insertNode(newerId, {
      id: "lonely-node-id",
      kind: "file",
      name: "lonely.ts",
    });
    db.close();

    const outPath = path.join(project.rootDir, "latest.html");
    const { runGraphRenderCommand } = await import(
      "../commands/graph-render.js"
    );
    const result = await runGraphRenderCommand({
      db: project.dbPath,
      out: outPath,
    });

    expect(result.snapshotId).toBe(newerId);
    expect(result.nodes).toBe(1);
    const html = await fs.readFile(outPath, "utf8");
    expect(html).toContain("lonely-node-id");
    expect(html).not.toContain("src/a.ts");
  });
});
