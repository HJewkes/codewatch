import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@codewatch/graph";
import {
  formatArchMermaid,
  runGraphArchCommand,
} from "../commands/graph-arch.js";
import { parseDomainConfig } from "../commands/graph-arch-domains.js";
import { formatArchDomains } from "../commands/graph-arch-format.js";

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

const multiPkgNodes = [
  fileNode("packages/cli/src/a.ts"),
  fileNode("packages/cli/src/b.ts"),
  fileNode("packages/graph/src/x.ts"),
  fileNode("packages/core/src/z.ts"),
];

const multiPkgEdges = [
  { srcId: "packages/cli/src/a.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
  { srcId: "packages/cli/src/b.ts", dstId: "packages/graph/src/x.ts", kind: "imports" },
  { srcId: "packages/graph/src/x.ts", dstId: "packages/core/src/z.ts", kind: "imports" },
] as const;

describe("graph arch --domains (C-11)", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  async function withDomains(config: unknown): Promise<string> {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, multiPkgNodes);
      db.insertEdges(snapshotId, [...multiPkgEdges]);
    });
    const cfgPath = path.join(fx.dir, "domains.json");
    await fs.writeFile(cfgPath, JSON.stringify(config));
    return cfgPath;
  }

  it("aggregates every file into one node for a single all-covering domain", async () => {
    const cfg = await withDomains({ domains: { app: "packages/**" } });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    expect(result.packages).toEqual([{ id: "app", name: "app", files: 4 }]);
    expect(result.edges).toEqual([]);
    expect(result.domainValidation?.unassignedFiles).toBe(0);
  });

  it("aggregates cross-domain edges and reports partition fit for multiple domains", async () => {
    const cfg = await withDomains({
      domains: { front: "packages/cli/**", back: ["packages/graph/**", "packages/core/**"] },
    });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    expect(result.packages.map((p) => p.id)).toEqual(["back", "front"]);
    expect(result.edges).toEqual([{ from: "front", to: "back", count: 2 }]);
    const fit = result.partitionFit!;
    expect(Number.isFinite(fit.domainQ)).toBe(true);
    expect(Number.isFinite(fit.packageQ)).toBe(true);
    expect(Number.isFinite(fit.detectedQ)).toBe(true);
    expect(fit.detectedCommunities).toBeGreaterThanOrEqual(1);
  });

  it("flags files matched by no domain as unassigned and drops their edges", async () => {
    const cfg = await withDomains({ domains: { front: "packages/cli/**" } });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    expect(result.domainValidation?.unassignedFiles).toBe(2);
    expect(result.edges).toEqual([]);
    expect(result.packages.map((p) => p.id)).toEqual(["front"]);
  });

  it("flags overlap conflicts and assigns the file to the first domain in config order", async () => {
    const cfg = await withDomains({
      domains: { a: "packages/cli/**", b: "packages/cli/src/a.ts" },
    });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    const v = result.domainValidation!;
    expect(v.overlaps).toEqual([
      { file: "packages/cli/src/a.ts", domains: ["a", "b"] },
    ]);
    expect(v.emptyDomains).toContain("b");
    expect(result.packages.find((p) => p.id === "a")?.files).toBe(2);
  });

  it("warns about globs that match no files", async () => {
    const cfg = await withDomains({
      domains: { front: "packages/cli/**", ghost: "packages/nope/**" },
    });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    expect(result.domainValidation?.emptyPatterns).toContain("ghost: packages/nope/**");
    expect(result.domainValidation?.emptyDomains).toContain("ghost");
  });

  it("renders a domain diagram with a partition-fit table and validation section", async () => {
    const cfg = await withDomains({
      domains: { front: "packages/cli/**", back: ["packages/graph/**", "packages/core/**"] },
    });
    const result = runGraphArchCommand({ db: fx.dbPath, repoRoot: fx.dir, domains: cfg });
    const md = formatArchDomains(result);
    expect(md).toContain("# Architecture by domain");
    expect(md).toContain("## Partition fit");
    expect(md).toContain("| Domains (config, 2) |");
    expect(md).toContain("## Config validation");
  });
});

describe("parseDomainConfig", () => {
  it("accepts a string glob and an array of globs", () => {
    const defs = parseDomainConfig(
      JSON.stringify({ domains: { a: "src/**", b: ["x/**", "y/**"] } }),
    );
    expect(defs).toEqual([
      { name: "a", patterns: ["src/**"] },
      { name: "b", patterns: ["x/**", "y/**"] },
    ]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseDomainConfig("{ not json")).toThrow(/Invalid domains config JSON/);
  });

  it("rejects a config without a domains object", () => {
    expect(() => parseDomainConfig(JSON.stringify({ foo: 1 }))).toThrow(/must have a "domains" object/);
  });

  it("rejects a domain mapped to an empty pattern list", () => {
    expect(() => parseDomainConfig(JSON.stringify({ domains: { a: [] } }))).toThrow(
      /Domain "a" must map to/,
    );
  });
});
