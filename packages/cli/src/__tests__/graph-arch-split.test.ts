import { describe, it, expect } from "vitest";
import type { CoEditPair, GraphEdge, GraphNode, SnapshotRow } from "@codewatch/graph";
import {
  computeArchSplit,
  type ArchSplitInput,
  type PackageSplitEvidence,
} from "../commands/graph-arch-split.js";
import { formatArchSplit } from "../commands/graph-arch-split-format.js";

const snapshot = { id: 1, ref: "main" } as SnapshotRow;

const file = (id: string): GraphNode => ({ id, kind: "file", name: id });
const imp = (srcId: string, dstId: string): GraphEdge =>
  ({ srcId, dstId, kind: "imports" });

const packages = [
  { id: "pkg/app", name: "app" },
  { id: "pkg/x", name: "x" },
  { id: "pkg/y", name: "y" },
];

function run(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: Partial<ArchSplitInput> = {},
): PackageSplitEvidence {
  const result = computeArchSplit({
    snapshot,
    nodes,
    edges,
    packages,
    minFiles: 6,
    ...opts,
  });
  return result.packages.find((p) => p.pkgId === "pkg/app")!;
}

function clusterOf(pkg: PackageSplitEvidence): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of pkg.clusters) for (const f of c.files) out.set(f, c.id);
  return out;
}

// A barbell: two dense triangles joined by one thin bridge — a real split
// shape. Cluster A imports pkg/x, cluster B imports pkg/y (divergent).
const barbellNodes = [
  file("pkg/app/a0.ts"),
  file("pkg/app/a1.ts"),
  file("pkg/app/a2.ts"),
  file("pkg/app/b0.ts"),
  file("pkg/app/b1.ts"),
  file("pkg/app/b2.ts"),
  file("pkg/x/z.ts"),
  file("pkg/y/w.ts"),
];
const barbellEdges = [
  imp("pkg/app/a0.ts", "pkg/app/a1.ts"),
  imp("pkg/app/a1.ts", "pkg/app/a2.ts"),
  imp("pkg/app/a2.ts", "pkg/app/a0.ts"),
  imp("pkg/app/b0.ts", "pkg/app/b1.ts"),
  imp("pkg/app/b1.ts", "pkg/app/b2.ts"),
  imp("pkg/app/b2.ts", "pkg/app/b0.ts"),
  imp("pkg/app/a0.ts", "pkg/app/b0.ts"), // the thin bridge
  imp("pkg/app/a0.ts", "pkg/x/z.ts"),
  imp("pkg/app/a1.ts", "pkg/x/z.ts"),
  imp("pkg/app/b0.ts", "pkg/y/w.ts"),
  imp("pkg/app/b1.ts", "pkg/y/w.ts"),
];

describe("computeArchSplit — barbell (real split shape)", () => {
  it("separates the two triangles into distinct communities", () => {
    const pkg = run(barbellNodes, barbellEdges);
    const cluster = clusterOf(pkg);
    expect(cluster.get("pkg/app/a0.ts")).toBe(cluster.get("pkg/app/a1.ts"));
    expect(cluster.get("pkg/app/b0.ts")).toBe(cluster.get("pkg/app/b1.ts"));
    expect(cluster.get("pkg/app/a0.ts")).not.toBe(cluster.get("pkg/app/b0.ts"));
  });

  it("reports a high sub-modularity Q", () => {
    const pkg = run(barbellNodes, barbellEdges);
    expect(pkg.subModularityQ).toBeGreaterThan(0.3);
  });

  it("extracts exactly the thin connector as a bridge edge", () => {
    const pkg = run(barbellNodes, barbellEdges);
    const bridges = pkg.bridges.filter(
      (b) => b.from.startsWith("pkg/app/a") && b.to.startsWith("pkg/app/b"),
    );
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({
      from: "pkg/app/a0.ts",
      to: "pkg/app/b0.ts",
      count: 1,
    });
  });

  it("reads divergent external coupling as a low cosine", () => {
    const pkg = run(barbellNodes, barbellEdges);
    expect(pkg.minExternalCosine).toBe(0);
  });
});

// A star: one hub importing independent spokes, every spoke sharing the SAME
// external dependency — codewatch's own `cli` shape, the canonical FALSE
// positive. We emit evidence, never a verdict, precisely because no structural
// signal distinguishes this from a genuine fracture.
const starNodes = [
  file("pkg/app/hub.ts"),
  file("pkg/app/s0.ts"),
  file("pkg/app/s1.ts"),
  file("pkg/app/s2.ts"),
  file("pkg/app/s3.ts"),
  file("pkg/app/s4.ts"),
  file("pkg/x/z.ts"),
];
const starEdges = [
  imp("pkg/app/hub.ts", "pkg/app/s0.ts"),
  imp("pkg/app/hub.ts", "pkg/app/s1.ts"),
  imp("pkg/app/hub.ts", "pkg/app/s2.ts"),
  imp("pkg/app/hub.ts", "pkg/app/s3.ts"),
  imp("pkg/app/hub.ts", "pkg/app/s4.ts"),
  imp("pkg/app/s0.ts", "pkg/x/z.ts"),
  imp("pkg/app/s1.ts", "pkg/x/z.ts"),
  imp("pkg/app/s2.ts", "pkg/x/z.ts"),
  imp("pkg/app/s3.ts", "pkg/x/z.ts"),
  imp("pkg/app/s4.ts", "pkg/x/z.ts"),
];

describe("computeArchSplit — star (cli-like false positive)", () => {
  it("produces evidence but carries NO verdict field", () => {
    const pkg = run(starNodes, starEdges);
    // The evidence bundle deliberately has no boolean split decision — this is
    // why the diagnostic emits evidence, not a verdict: the star and the
    // barbell are not separable by any structural field here.
    const keys = Object.keys(pkg);
    expect(keys).not.toContain("verdict");
    expect(keys).not.toContain("isSplitCandidate");
    expect(keys).not.toContain("confidence");
    expect(pkg.clusters.length).toBeGreaterThan(0);
  });

  it("does not read a shared dominant dependency as a divergent seam", () => {
    const pkg = run(starNodes, starEdges);
    // Either the spokes collapse into the hub (one ext-dep cluster → null) or,
    // if split, they all import pkg/x so cosine is 1 — never the 0 of a seam.
    expect(pkg.minExternalCosine === null || pkg.minExternalCosine > 0.99).toBe(
      true,
    );
  });
});

describe("computeArchSplit — external-coupling cosine guard", () => {
  it("returns null when fewer than two clusters have external deps", () => {
    // Cluster A imports pkg/x; cluster B imports nothing external. Only one
    // cluster has external deps → no seam can be read, not cosine 0.
    const nodes = [...barbellNodes];
    const edges = [
      imp("pkg/app/a0.ts", "pkg/app/a1.ts"),
      imp("pkg/app/a1.ts", "pkg/app/a2.ts"),
      imp("pkg/app/a2.ts", "pkg/app/a0.ts"),
      imp("pkg/app/b0.ts", "pkg/app/b1.ts"),
      imp("pkg/app/b1.ts", "pkg/app/b2.ts"),
      imp("pkg/app/b2.ts", "pkg/app/b0.ts"),
      imp("pkg/app/a0.ts", "pkg/app/b0.ts"),
      imp("pkg/app/a0.ts", "pkg/x/z.ts"),
      imp("pkg/app/a1.ts", "pkg/x/z.ts"),
    ];
    const pkg = run(nodes, edges);
    expect(pkg.minExternalCosine).toBeNull();
  });
});

describe("computeArchSplit — co-edit density", () => {
  it("concentrates co-edits within clusters (ratio below 1)", () => {
    const coEditPairs: CoEditPair[] = [
      { fileA: "pkg/app/a0.ts", fileB: "pkg/app/a1.ts", count: 10, commits: [] },
      { fileA: "pkg/app/a1.ts", fileB: "pkg/app/a2.ts", count: 10, commits: [] },
      { fileA: "pkg/app/b0.ts", fileB: "pkg/app/b1.ts", count: 10, commits: [] },
      { fileA: "pkg/app/a0.ts", fileB: "pkg/app/b0.ts", count: 1, commits: [] },
    ];
    const pkg = run(barbellNodes, barbellEdges, { coEditPairs });
    expect(pkg.coEdit).toBeDefined();
    expect(pkg.coEdit!.within).toBeGreaterThan(pkg.coEdit!.cross);
    expect(pkg.coEdit!.ratio).not.toBeNull();
    expect(pkg.coEdit!.ratio!).toBeLessThan(1);
  });

  it("omits the co-edit read-out when git history is unavailable", () => {
    const pkg = run(barbellNodes, barbellEdges, { coEditPairs: null });
    expect(pkg.coEdit).toBeUndefined();
  });
});

describe("computeArchSplit — excludes non-source and fragmented packages", () => {
  // A real multi-file package (barbell shape), an examples dir with the same
  // structure, and a docs-like package whose files have no intra-package edges
  // (every file its own singleton cluster). Only the real package survives.
  const realPkg = { id: "packages/server", name: "@scope/server" };
  const examplesPkg = { id: "examples/next-app", name: "next-app" };
  const singletonPkg = { id: "packages/docsite", name: "docsite" };

  const barbell = (prefix: string): { nodes: GraphNode[]; edges: GraphEdge[] } => ({
    nodes: ["a0", "a1", "a2", "b0", "b1", "b2"].map((f) => file(`${prefix}/${f}.ts`)),
    edges: [
      imp(`${prefix}/a0.ts`, `${prefix}/a1.ts`),
      imp(`${prefix}/a1.ts`, `${prefix}/a2.ts`),
      imp(`${prefix}/a2.ts`, `${prefix}/a0.ts`),
      imp(`${prefix}/b0.ts`, `${prefix}/b1.ts`),
      imp(`${prefix}/b1.ts`, `${prefix}/b2.ts`),
      imp(`${prefix}/b2.ts`, `${prefix}/b0.ts`),
      imp(`${prefix}/a0.ts`, `${prefix}/b0.ts`),
    ],
  });

  const real = barbell(realPkg.id);
  const example = barbell(examplesPkg.id);
  // docsite: six files, zero edges between them → all singletons.
  const singletonNodes = ["d0", "d1", "d2", "d3", "d4", "d5"].map((f) =>
    file(`${singletonPkg.id}/${f}.ts`),
  );

  it("keeps the real package, drops the examples dir and the all-singleton package", () => {
    const result = computeArchSplit({
      snapshot,
      nodes: [...real.nodes, ...example.nodes, ...singletonNodes],
      edges: [...real.edges, ...example.edges],
      packages: [realPkg, examplesPkg, singletonPkg],
      minFiles: 6,
    });
    const ids = result.packages.map((p) => p.pkgId);
    expect(ids).toEqual([realPkg.id]);
  });
});

describe("computeArchSplit — thresholds and rendering", () => {
  it("only analyzes packages meeting the file-count floor", () => {
    const result = computeArchSplit({
      snapshot,
      nodes: barbellNodes,
      edges: barbellEdges,
      packages,
      minFiles: 15,
    });
    expect(result.packages).toEqual([]);
  });

  it("leads the rendered evidence with bridge edges and states no verdict", () => {
    const result = computeArchSplit({
      snapshot,
      nodes: barbellNodes,
      edges: barbellEdges,
      packages,
      minFiles: 6,
    });
    const md = formatArchSplit(result);
    expect(md).toContain("no split verdict");
    const bridgesIdx = md.indexOf("### Bridge edges");
    const clustersIdx = md.indexOf("### Clusters");
    expect(bridgesIdx).toBeGreaterThan(-1);
    expect(bridgesIdx).toBeLessThan(clustersIdx);
  });
});
