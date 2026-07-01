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
