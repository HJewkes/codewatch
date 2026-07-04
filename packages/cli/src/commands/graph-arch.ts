import type { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  computePartitionQuality,
  openDatabase,
  type GraphDatabase,
  type PartitionQualityResult,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";
import {
  bucketFilesByPackage,
  detectPackages,
} from "./graph-wiki-packages.js";
import {
  computeArch,
  filteredFileIds,
  type ComputeArchInput,
} from "./graph-arch-compute.js";

export type { ComputeArchInput };
export { computeArch };

export interface GraphArchCommandOptions {
  db: string;
  repoRoot: string;
  snapshot?: number;
  out?: string;
  exclude?: string[];
  excludeRole?: string[];
  includeExternal?: boolean;
  minEdges?: number;
  /** Compute partition quality (modularity Q + per-package + pair flags). */
  health?: boolean;
  /** When "modules", drill packages larger than maxPackageSize into sub-dir nodes. */
  depth?: "modules";
  /** File-count threshold above which a package is drilled (default 30). */
  maxPackageSize?: number;
}

/** A top-level sub-directory of a drilled package, rendered inside its cluster. */
export interface ArchSubNode {
  /** Full path id, e.g. "packages/cli/src/commands". */
  id: string;
  /** Directory name shown as the node label, e.g. "commands". */
  label: string;
  files: number;
}

export interface ArchPackage {
  id: string;
  name: string;
  files: number;
  /** Present when the package was drilled (--depth modules); renders as a subgraph. */
  subNodes?: ArchSubNode[];
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
  /** Present when options.health=true. */
  quality?: PartitionQualityResult;
}

export function runGraphArchCommand(
  options: GraphArchCommandOptions,
): ArchResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot);
    const nodes = db.listNodes(snapshot.id);
    const edges = db.listEdges(snapshot.id);
    const packages = detectPackages(options.repoRoot);
    const result = computeArch({
      snapshot,
      nodes,
      edges,
      packages,
      exclude: options.exclude,
      excludeRole: options.excludeRole,
      includeExternal: options.includeExternal,
      minEdges: options.minEdges,
      depth: options.depth,
      maxPackageSize: options.maxPackageSize,
    });
    if (options.health) {
      const fileIds = filteredFileIds(nodes, options);
      const fileByPackage = bucketFilesByPackage(fileIds, packages);
      result.quality = computePartitionQuality({
        packages,
        fileByPackage,
        nodes,
        edges,
      });
    }
    return result;
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
  for (const p of result.packages) pushPackageNode(lines, p);
  for (const e of result.edges) {
    const arrow = e.count > 1 ? ` -- ${e.count} --> ` : ` --> `;
    lines.push(`  ${sanitizeId(e.from)}${arrow}${sanitizeId(e.to)}`);
  }
  return lines.join("\n");
}

function pushPackageNode(lines: string[], p: ArchPackage): void {
  if (p.subNodes && p.subNodes.length > 0) {
    lines.push(`  subgraph ${sanitizeId(p.id)} ["${escapeLabel(p.name)}"]`);
    for (const s of p.subNodes) {
      lines.push(
        `    ${sanitizeId(s.id)}["${escapeLabel(s.label)}<br/>${s.files} files"]`,
      );
    }
    lines.push("  end");
    return;
  }
  const label =
    p.files > 0 ? `${escapeLabel(p.name)}<br/>${p.files} files` : escapeLabel(p.name);
  lines.push(`  ${sanitizeId(p.id)}["${label}"]`);
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

interface ArchCliOptions {
  db: string;
  repoRoot: string;
  snapshot?: string;
  out?: string;
  exclude?: string[];
  excludeRole?: string[];
  includeExternal?: boolean;
  minEdges?: string;
  health?: boolean;
  depth?: string;
  maxPackageSize?: string;
}

async function runArchAction(options: ArchCliOptions): Promise<void> {
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
      health: options.health,
      depth: options.depth === "modules" ? "modules" : undefined,
      maxPackageSize: asNumber(options.maxPackageSize),
    });
    const output = options.health
      ? (await import("./graph-arch-format.js")).formatArchHealth(result)
      : formatArchMermaid(result);
    await emitArchOutput(output, options.out, result, Boolean(options.health));
  } catch (err) {
    console.error(
      formatError(err instanceof Error ? err.message : String(err)),
    );
    process.exitCode = 1;
  }
}

async function emitArchOutput(
  content: string,
  out: string | undefined,
  result: ArchResult,
  isHealth: boolean,
): Promise<void> {
  if (!out) {
    console.log(content);
    return;
  }
  const fenced =
    !isHealth && out.endsWith(".md")
      ? "```mermaid\n" + content + "\n```\n"
      : content + "\n";
  await fs.writeFile(out, fenced, "utf-8");
  const summary = isHealth
    ? `partition-quality analysis (${result.quality?.flagsCount ?? 0} flag(s))`
    : `${result.packages.length} package(s), ${result.edges.length} edge(s)`;
  console.log(`Wrote ${summary} to ${out}.`);
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
    .option(
      "--health",
      "Augment output with partition-quality analysis (Newman-Girvan Q, per-package cohesion/instability/layer, pair coupling)",
    )
    .option(
      "--depth <level>",
      "Drill packages larger than --max-package-size into their top-level directories (only 'modules' supported)",
    )
    .option(
      "--max-package-size <n>",
      "File-count threshold above which a package is drilled into sub-directory nodes (default 30; implies --depth modules)",
    )
    .action(runArchAction);
}
