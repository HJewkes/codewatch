import type { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  compilePatterns,
  matchesAny,
  openDatabase,
  type GraphDatabase,
  type GraphEdge,
  type GraphNode,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";
import {
  bucketFilesByPackage,
  detectPackages,
  type PackageRoot,
} from "./graph-wiki-packages.js";

export interface GraphArchCommandOptions {
  db: string;
  repoRoot: string;
  snapshot?: number;
  out?: string;
  exclude?: string[];
  excludeRole?: string[];
  includeExternal?: boolean;
  minEdges?: number;
}

export interface ArchPackage {
  id: string;
  name: string;
  files: number;
}

export interface ArchEdge {
  from: string;
  to: string;
  count: number;
}

export interface ArchResult {
  snapshot: SnapshotRow;
  packages: ArchPackage[];
  edges: ArchEdge[];
  includesExternal: boolean;
}

const EXTERNAL_BUCKET = "(external)";

export interface ComputeArchInput {
  snapshot: SnapshotRow;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  packages: readonly PackageRoot[];
  exclude?: string[];
  excludeRole?: string[];
  includeExternal?: boolean;
  minEdges?: number;
}

export function computeArch(input: ComputeArchInput): ArchResult {
  const excluders = compilePatterns(input.exclude);
  const excludedRoles = new Set(input.excludeRole ?? []);
  const fileIds = input.nodes
    .filter((n) => n.kind === "file")
    .filter((n) => !excludedRoles.has(n.role ?? ""))
    .filter((n) => !matchesAny(n.id, excluders))
    .map((n) => n.id);

  const fileByPackage = bucketFilesByPackage(fileIds, input.packages);
  const pkgByFile = invertBuckets(fileByPackage);
  const externalIds = new Set(
    input.nodes.filter((n) => n.kind === "external").map((n) => n.id),
  );

  const counts = aggregateEdges(
    input.edges,
    pkgByFile,
    externalIds,
    Boolean(input.includeExternal),
  );

  const minEdges = Math.max(1, input.minEdges ?? 1);
  return {
    snapshot: input.snapshot,
    packages: activePackages(
      input.packages,
      fileByPackage,
      Boolean(input.includeExternal),
      counts,
    ),
    edges: toSortedEdges(counts, minEdges),
    includesExternal: Boolean(input.includeExternal),
  };
}

export function runGraphArchCommand(
  options: GraphArchCommandOptions,
): ArchResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot);
    return computeArch({
      snapshot,
      nodes: db.listNodes(snapshot.id),
      edges: db.listEdges(snapshot.id),
      packages: detectPackages(options.repoRoot),
      exclude: options.exclude,
      excludeRole: options.excludeRole,
      includeExternal: options.includeExternal,
      minEdges: options.minEdges,
    });
  } finally {
    db.close();
  }
}

function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  const snapshot =
    id !== undefined
      ? db.getSnapshot(id)
      : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snapshot) throw new Error("No snapshot found");
  return snapshot;
}

function invertBuckets(
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pkgId, files] of fileByPackage) {
    if (pkgId === "") continue;
    for (const f of files) out.set(f, pkgId);
  }
  return out;
}

function aggregateEdges(
  edges: ReadonlyArray<{ srcId: string; dstId: string }>,
  pkgByFile: ReadonlyMap<string, string>,
  externalIds: ReadonlySet<string>,
  includeExternal: boolean,
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const fromPkg = pkgByFile.get(e.srcId);
    if (!fromPkg) continue;
    const toPkg = resolveDestinationBucket(
      e.dstId,
      pkgByFile,
      externalIds,
      includeExternal,
    );
    if (!toPkg || toPkg === fromPkg) continue;
    bump(counts, fromPkg, toPkg);
  }
  return counts;
}

function resolveDestinationBucket(
  dstId: string,
  pkgByFile: ReadonlyMap<string, string>,
  externalIds: ReadonlySet<string>,
  includeExternal: boolean,
): string | null {
  const pkg = pkgByFile.get(dstId);
  if (pkg !== undefined) return pkg;
  if (externalIds.has(dstId) && includeExternal) return EXTERNAL_BUCKET;
  return null;
}

function bump(
  counts: Map<string, Map<string, number>>,
  from: string,
  to: string,
): void {
  let row = counts.get(from);
  if (!row) {
    row = new Map();
    counts.set(from, row);
  }
  row.set(to, (row.get(to) ?? 0) + 1);
}

function toSortedEdges(
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
  minEdges: number,
): ArchEdge[] {
  const out: ArchEdge[] = [];
  for (const [from, row] of counts) {
    for (const [to, count] of row) {
      if (count < minEdges) continue;
      out.push({ from, to, count });
    }
  }
  out.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.to < b.to ? -1 : 1;
  });
  return out;
}

function activePackages(
  all: readonly PackageRoot[],
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>,
  includeExternal: boolean,
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ArchPackage[] {
  const referenced = packagesReferencedByEdges(counts);
  const out: ArchPackage[] = [];
  for (const p of all) {
    const files = fileByPackage.get(p.id)?.length ?? 0;
    if (files === 0 && !referenced.has(p.id)) continue;
    out.push({ id: p.id, name: p.name, files });
  }
  if (includeExternal && referenced.has(EXTERNAL_BUCKET)) {
    out.push({ id: EXTERNAL_BUCKET, name: EXTERNAL_BUCKET, files: 0 });
  }
  return out;
}

function packagesReferencedByEdges(
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Set<string> {
  const referenced = new Set<string>();
  for (const [from, row] of counts) {
    referenced.add(from);
    for (const to of row.keys()) referenced.add(to);
  }
  return referenced;
}

export function formatArchMermaid(result: ArchResult): string {
  const lines: string[] = [];
  lines.push(
    `%% Architecture — snap ${result.snapshot.id} (${result.snapshot.ref})`,
  );
  lines.push("flowchart LR");
  if (result.packages.length === 0) {
    lines.push("  %% (no packages with indexed files)");
    return lines.join("\n");
  }
  for (const p of result.packages) {
    const label =
      p.files > 0 ? `${escapeLabel(p.name)}<br/>${p.files} files` : escapeLabel(p.name);
    lines.push(`  ${sanitizeId(p.id)}["${label}"]`);
  }
  for (const e of result.edges) {
    const arrow = e.count > 1 ? ` -- ${e.count} --> ` : ` --> `;
    lines.push(`  ${sanitizeId(e.from)}${arrow}${sanitizeId(e.to)}`);
  }
  return lines.join("\n");
}

function sanitizeId(id: string): string {
  return "P_" + id.replace(/[^a-zA-Z0-9]/g, "_");
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/\|/g, "&#124;");
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphArch(graphCmd: Command): void {
  graphCmd
    .command("arch")
    .description(
      "Emit a deterministic package-level architecture diagram (Mermaid flowchart) aggregated from cross-package edges.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root for package detection", ".")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option(
      "--out <path>",
      "Write Mermaid to this file (.md wraps in a fenced block; default: stdout)",
    )
    .option(
      "--exclude <pattern...>",
      "Exclude file ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude files with this role (test, fixture, ...; repeatable)",
    )
    .option(
      "--include-external",
      "Include npm/external packages as an aggregate (external) node",
    )
    .option(
      "--min-edges <n>",
      "Hide edges with fewer than n underlying file deps (default 1)",
    )
    .action(
      async (options: {
        db: string;
        repoRoot: string;
        snapshot?: string;
        out?: string;
        exclude?: string[];
        excludeRole?: string[];
        includeExternal?: boolean;
        minEdges?: string;
      }) => {
        try {
          const result = runGraphArchCommand({
            db: options.db,
            repoRoot: options.repoRoot,
            snapshot: asNumber(options.snapshot),
            out: options.out,
            exclude: options.exclude,
            excludeRole: options.excludeRole,
            includeExternal: options.includeExternal,
            minEdges: asNumber(options.minEdges),
          });
          const mermaid = formatArchMermaid(result);
          if (options.out) {
            const content = options.out.endsWith(".md")
              ? "```mermaid\n" + mermaid + "\n```\n"
              : mermaid + "\n";
            await fs.writeFile(options.out, content, "utf-8");
            console.log(
              `Wrote ${result.packages.length} package(s), ${result.edges.length} edge(s) to ${options.out}.`,
            );
          } else {
            console.log(mermaid);
          }
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
