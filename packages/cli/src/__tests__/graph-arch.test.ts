import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@codewatch/graph";
import {
  formatArchMermaid,
  runGraphArchCommand,
} from "../commands/graph-arch.js";

interface Fixture {
  dir: string;
  dbPath: string;
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-arch-"));
  await fs.mkdir(path.join(dir, "packages", "cli"), { recursive: true });
  await fs.mkdir(path.join(dir, "packages", "graph"), { recursive: true });
  await fs.mkdir(path.join(dir, "packages", "core"), { recursive: true });
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
  await fs.writeFile(
    path.join(dir, "packages", "core", "package.json"),
    JSON.stringify({ name: "@x/core" }),
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

const fileNode = (id: string) =>
  ({ id, kind: "file" as const, name: id });

describe("runGraphArchCommand", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("aggregates cross-package edges into package-pair counts", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/cli/src/b.ts"),
        fileNode("packages/graph/src/api.ts"),
        fileNode("packages/core/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/api.ts", kind: "imports" },
        { srcId: "packages/cli/src/b.ts", dstId: "packages/graph/src/api.ts", kind: "imports" },
        { srcId: "packages/cli/src/a.ts", dstId: "packages/core/src/x.ts", kind: "imports" },
        // intra-pkg, must be ignored
        { srcId: "packages/cli/src/a.ts", dstId: "packages/cli/src/b.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(result.edges).toEqual([
      { from: "packages/cli", to: "packages/core", count: 1 },
      { from: "packages/cli", to: "packages/graph", count: 2 },
    ]);
    expect(result.packages.map((p) => p.id).sort()).toEqual([
      "packages/cli",
      "packages/core",
      "packages/graph",
    ]);
  });

  it("excludes external nodes by default and includes them under --include-external", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        { id: "ext:chalk", kind: "external", name: "chalk" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/a.ts", dstId: "ext:chalk", kind: "imports" },
      ]);
    });
    const without = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(without.edges).toEqual([]);
    expect(without.packages.find((p) => p.id === "(external)")).toBeUndefined();

    const withExt = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      includeExternal: true,
    });
    expect(withExt.edges).toEqual([
      { from: "packages/cli", to: "(external)", count: 1 },
    ]);
    expect(withExt.packages.map((p) => p.id)).toContain("(external)");
  });

  it("applies --min-edges to suppress weak couplings", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/x.ts"),
        fileNode("packages/core/src/y.ts"),
      ]);
      db.insertEdges(snapshotId, [
        // 1 edge to core (weak)
        { srcId: "packages/cli/src/a.ts", dstId: "packages/core/src/y.ts", kind: "imports" },
        // 2 edges to graph (above threshold of 2)
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "re-exports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      minEdges: 2,
    });
    expect(result.edges).toEqual([
      { from: "packages/cli", to: "packages/graph", count: 2 },
    ]);
  });

  it("excludes files matching --exclude and --exclude-role", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        {
          id: "packages/cli/src/a.test.ts",
          kind: "file",
          name: "a.test.ts",
          role: "test",
        },
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        // edge from a test file — should drop with --exclude-role test
        { srcId: "packages/cli/src/a.test.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        // edge from a fixture-named file — should drop with --exclude **/*.fixture.ts (no fixture here)
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      excludeRole: ["test"],
    });
    expect(result.edges).toEqual([
      { from: "packages/cli", to: "packages/graph", count: 1 },
    ]);
  });

  it("omits packages with zero indexed files and no edges", async () => {
    fx = await fixture((db, snapshotId) => {
      // Only put files in cli and graph; core is empty
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(result.packages.map((p) => p.id).sort()).toEqual([
      "packages/cli",
      "packages/graph",
    ]);
  });

  it("sorts edges deterministically by (from, to)", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/x.ts"),
        fileNode("packages/core/src/y.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/graph/src/x.ts", dstId: "packages/core/src/y.ts", kind: "imports" },
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        { srcId: "packages/cli/src/a.ts", dstId: "packages/core/src/y.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(result.edges).toEqual([
      { from: "packages/cli", to: "packages/core", count: 1 },
      { from: "packages/cli", to: "packages/graph", count: 1 },
      { from: "packages/graph", to: "packages/core", count: 1 },
    ]);
  });
});

describe("formatArchMermaid", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("emits a flowchart LR with sanitized ids and edge counts", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/cli/src/b.ts"),
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        { srcId: "packages/cli/src/b.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const mermaid = formatArchMermaid(result);
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('P_packages_cli["@x/cli<br/>2 files"]');
    expect(mermaid).toContain('P_packages_graph["@x/graph<br/>1 files"]');
    expect(mermaid).toContain("P_packages_cli -- 2 --> P_packages_graph");
  });

  it("emits an empty flowchart marker when there are no packages", async () => {
    fx = await fixture((_db, _snapshotId) => {});
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    const mermaid = formatArchMermaid(result);
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain("(no packages with indexed files)");
  });
});

const dirFiles = (pkg: string, dir: string, n: number) =>
  Array.from({ length: n }, (_, i) => fileNode(`${pkg}/src/${dir}/f${i}.ts`));

describe("graph arch --depth modules (C-10)", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("keeps every package a plain node when all are under the threshold", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("packages/cli/src/a.ts"),
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      depth: "modules",
    });
    expect(result.packages.every((p) => p.subNodes === undefined)).toBe(true);
    expect(result.edges).toEqual([
      { from: "packages/cli", to: "packages/graph", count: 1 },
    ]);
  });

  it("drills a single oversized package into its top-level directories", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        ...dirFiles("packages/cli", "commands", 3),
        ...dirFiles("packages/cli", "utils", 2),
        fileNode("packages/graph/src/x.ts"),
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      maxPackageSize: 4,
    });
    const cli = result.packages.find((p) => p.id === "packages/cli");
    const graph = result.packages.find((p) => p.id === "packages/graph");
    expect(graph?.subNodes).toBeUndefined();
    expect(cli?.subNodes).toEqual([
      { id: "packages/cli/src/commands", label: "commands", files: 3 },
      { id: "packages/cli/src/utils", label: "utils", files: 2 },
    ]);
  });

  it("re-points a cross-package edge to the specific sub-directory of the file", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        ...dirFiles("packages/cli", "commands", 3),
        ...dirFiles("packages/cli", "utils", 2),
        fileNode("packages/graph/src/x.ts"),
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "packages/cli/src/commands/f0.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        { srcId: "packages/cli/src/utils/f0.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
        { srcId: "packages/graph/src/x.ts", dstId: "packages/cli/src/utils/f1.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      maxPackageSize: 4,
    });
    expect(result.edges).toEqual([
      { from: "packages/cli/src/commands", to: "packages/graph", count: 1 },
      { from: "packages/cli/src/utils", to: "packages/graph", count: 1 },
      { from: "packages/graph", to: "packages/cli/src/utils", count: 1 },
    ]);
  });

  it("drills multiple oversized packages and aggregates sub-dir to sub-dir edges", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        ...dirFiles("packages/cli", "commands", 3),
        ...dirFiles("packages/cli", "utils", 2),
        ...dirFiles("packages/graph", "db", 3),
        ...dirFiles("packages/graph", "api", 2),
      ]);
      db.insertEdges(snapshotId, [
        // two files in cli/commands both import graph/db -> aggregated count 2
        { srcId: "packages/cli/src/commands/f0.ts", dstId: "packages/graph/src/db/f0.ts", kind: "imports" },
        { srcId: "packages/cli/src/commands/f1.ts", dstId: "packages/graph/src/db/f1.ts", kind: "imports" },
        { srcId: "packages/cli/src/utils/f0.ts", dstId: "packages/graph/src/api/f0.ts", kind: "imports" },
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      maxPackageSize: 4,
    });
    expect(result.packages.find((p) => p.id === "packages/cli")?.subNodes).toBeDefined();
    expect(result.packages.find((p) => p.id === "packages/graph")?.subNodes).toBeDefined();
    expect(result.edges).toEqual([
      { from: "packages/cli/src/commands", to: "packages/graph/src/db", count: 2 },
      { from: "packages/cli/src/utils", to: "packages/graph/src/api", count: 1 },
    ]);
  });

  it("renders drilled packages as mermaid subgraphs", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        ...dirFiles("packages/cli", "commands", 3),
        ...dirFiles("packages/cli", "utils", 2),
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      maxPackageSize: 4,
    });
    const mermaid = formatArchMermaid(result);
    expect(mermaid).toContain('subgraph P_packages_cli ["@x/cli"]');
    expect(mermaid).toContain('P_packages_cli_src_commands["commands<br/>3 files"]');
    expect(mermaid).toContain('P_packages_cli_src_utils["utils<br/>2 files"]');
    expect(mermaid).toContain("  end");
  });

  it("buckets files sitting directly in the common root under (root)", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        ...dirFiles("packages/cli", "commands", 3),
        fileNode("packages/cli/src/index.ts"),
        fileNode("packages/cli/src/main.ts"),
      ]);
    });
    const result = runGraphArchCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      maxPackageSize: 4,
    });
    const cli = result.packages.find((p) => p.id === "packages/cli");
    expect(cli?.subNodes).toEqual([
      { id: "packages/cli/src", label: "(root)", files: 2 },
      { id: "packages/cli/src/commands", label: "commands", files: 3 },
    ]);
  });
});
