import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@code-style/graph";
import {
  runGraphWikiCommand,
  writeWikiFiles,
  pageFilename,
} from "../commands/graph-wiki.js";
import {
  bucketFilesByPackage,
  detectPackages,
} from "../commands/graph-wiki-packages.js";
import { formatWiki } from "../commands/graph-wiki-format.js";

interface Fixture {
  dir: string;
  dbPath: string;
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-wiki-"));
  await fs.mkdir(path.join(dir, "packages", "cli"), { recursive: true });
  await fs.mkdir(path.join(dir, "packages", "graph"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "root" }),
  );
  await fs.writeFile(
    path.join(dir, "packages", "cli", "package.json"),
    JSON.stringify({ name: "@x/cli" }),
  );
  await fs.writeFile(
    path.join(dir, "packages", "graph", "package.json"),
    JSON.stringify({ name: "@x/graph" }),
  );
  return dir;
}

async function fixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
): Promise<Fixture> {
  const dir = await makeRepo();
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath };
}

function fileNode(id: string) {
  return { id, kind: "file" as const, name: id };
}

describe("detectPackages", () => {
  it("finds package.json files in subdirectories and skips the root", async () => {
    const dir = await makeRepo();
    try {
      const pkgs = detectPackages(dir);
      expect(pkgs.map((p) => p.id)).toEqual(["packages/cli", "packages/graph"]);
      expect(pkgs.map((p) => p.name)).toEqual(["@x/cli", "@x/graph"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to top-level directories when no package.json found", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-wiki-bare-"));
    try {
      await fs.mkdir(path.join(dir, "src"));
      await fs.mkdir(path.join(dir, "tests"));
      const pkgs = detectPackages(dir);
      expect(pkgs.map((p) => p.id).sort()).toEqual(["src", "tests"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("bucketFilesByPackage", () => {
  it("assigns files by longest-prefix match", () => {
    const buckets = bucketFilesByPackage(
      [
        "packages/cli/src/a.ts",
        "packages/graph/src/b.ts",
        "scripts/run.ts",
      ],
      [
        { id: "packages/cli", name: "@x/cli" },
        { id: "packages/graph", name: "@x/graph" },
      ],
    );
    expect(buckets.get("packages/cli")).toEqual(["packages/cli/src/a.ts"]);
    expect(buckets.get("packages/graph")).toEqual(["packages/graph/src/b.ts"]);
    expect(buckets.get("")).toEqual(["scripts/run.ts"]);
  });
});

describe("pageFilename", () => {
  it("replaces slashes with dashes", () => {
    expect(pageFilename("packages/cli")).toBe("packages-cli.md");
    expect(pageFilename("src")).toBe("src.md");
  });
});

describe("runGraphWikiCommand", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("produces a wiki entry per non-empty package with hotspots populated", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/cli/src/b.ts"),
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "packages/cli/src/a.ts", name: "churn_30d", value: 100 },
        { nodeId: "packages/cli/src/a.ts", name: "cognitive_max", value: 20 },
        { nodeId: "packages/cli/src/b.ts", name: "churn_30d", value: 50 },
        { nodeId: "packages/cli/src/b.ts", name: "cognitive_max", value: 8 },
        { nodeId: "packages/graph/src/x.ts", name: "churn_30d", value: 30 },
        { nodeId: "packages/graph/src/x.ts", name: "cognitive_max", value: 5 },
      ]);
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      limit: 5,
    });
    expect(result.packages).toHaveLength(2);
    const cli = result.packages.find((p) => p.pkg.id === "packages/cli")!;
    expect(cli.summary.files).toBe(2);
    expect(cli.hotspots.map((h) => h.nodeId)).toEqual([
      "packages/cli/src/a.ts",
      "packages/cli/src/b.ts",
    ]);
  });

  it("computes cross-package inbound and outbound deps with examples", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/main.ts"),
        fileNode("packages/cli/src/util.ts"),
        fileNode("packages/graph/src/api.ts"),
      ]);
      db.insertEdges(snapshotId, [
        // cli → graph (outbound from cli, inbound to graph)
        { srcId: "packages/cli/src/main.ts", dstId: "packages/graph/src/api.ts", kind: "imports" },
        // intra-cli (should be ignored)
        { srcId: "packages/cli/src/main.ts", dstId: "packages/cli/src/util.ts", kind: "imports" },
      ]);
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const cli = result.packages.find((p) => p.pkg.id === "packages/cli")!;
    expect(cli.outbound).toEqual([
      {
        pkg: "packages/graph",
        count: 1,
        examples: ["packages/cli/src/main.ts → packages/graph/src/api.ts"],
      },
    ]);
    expect(cli.inbound).toEqual([]);
    const graph = result.packages.find((p) => p.pkg.id === "packages/graph")!;
    expect(graph.inbound[0]!.pkg).toBe("packages/cli");
    expect(graph.outbound).toEqual([]);
  });

  it("filters by --package pattern", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/b.ts"),
      ]);
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      package: ["packages/cli"],
    });
    expect(result.packages.map((p) => p.pkg.id)).toEqual(["packages/cli"]);
  });

  it("omits empty packages (no files indexed)", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("packages/cli/src/a.ts"));
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(result.packages.map((p) => p.pkg.id)).toEqual(["packages/cli"]);
  });
});

describe("formatWiki + writeWikiFiles", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("emits README.md plus one file per package", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/b.ts"),
      ]);
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const files = formatWiki(result);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "README.md",
      "packages-cli.md",
      "packages-graph.md",
    ]);
    const readme = files.find((f) => f.path === "README.md")!.content;
    expect(readme).toContain("Codebase wiki");
    expect(readme).toContain("[packages/cli](./packages-cli.md)");
  });

  it("README.md includes a Mermaid architecture diagram when packages have edges", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/b.ts"),
      ]);
      db.insertEdges(snapshotId, [
        {
          srcId: "packages/cli/src/a.ts",
          dstId: "packages/graph/src/b.ts",
          kind: "imports",
        },
      ]);
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const readme = formatWiki(result).find((f) => f.path === "README.md")!.content;
    expect(readme).toContain("## Architecture");
    expect(readme).toContain("```mermaid");
    expect(readme).toContain("flowchart LR");
    expect(readme).toContain("P_packages_cli --> P_packages_graph");
  });

  it("writeWikiFiles creates the directory and writes each file", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("packages/cli/src/a.ts"));
    });
    const result = runGraphWikiCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const outDir = path.join(fx.dir, "docs/wiki");
    const written = await writeWikiFiles(outDir, result);
    expect(written).toContain(path.join(outDir, "README.md"));
    expect(written).toContain(path.join(outDir, "packages-cli.md"));
    const readme = await fs.readFile(path.join(outDir, "README.md"), "utf-8");
    expect(readme).toContain("Codebase wiki");
  });
});
