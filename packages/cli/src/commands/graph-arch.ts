import type { Command } from "commander";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
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
import {
  computeArchDomains,
  parseDomainConfig,
  type DomainValidation,
  type PartitionFit,
} from "./graph-arch-domains.js";
import {
  loadCoEditPairs,
  runArchSplit,
  type ArchSplitResult,
} from "./graph-arch-split.js";

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
  /** Path to a JSON domains config; aggregates the diagram at domain level. */
  domains?: string;
  /** Emit the per-package split diagnostic (internal clusters + bridge edges). */
  split?: boolean;
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
  /** Present when options.domains is set: config validation warnings. */
  domainValidation?: DomainValidation;
  /** Present when options.domains is set: domain vs package vs detected Q. */
  partitionFit?: PartitionFit;
  /** Present when options.split is set: per-package cluster evidence. */
  split?: ArchSplitResult;
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
    if (options.split) {
      return runArchSplit({
        snapshot,
        nodes,
        edges,
        packages,
        exclude: options.exclude,
        excludeRole: options.excludeRole,
        coEditPairs: loadCoEditPairs(options.repoRoot, nodes),
      });
    }
    if (options.domains) {
      return computeArchDomains(
        {
          snapshot,
          nodes,
          edges,
          packages,
          exclude: options.exclude,
          excludeRole: options.excludeRole,
          minEdges: options.minEdges,
        },
        parseDomainConfig(readFileSync(options.domains, "utf-8")),
      );
    }
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
  domains?: string;
  split?: boolean;
  json?: boolean;
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
      domains: options.domains,
      split: options.split,
    });
    const output = await renderArchOutput(result, options);
    const rich = Boolean(
      options.health || options.domains || options.split || options.json,
    );
    await emitArchOutput(output, options.out, result, rich);
  } catch (err) {
    console.error(
      formatError(err instanceof Error ? err.message : String(err)),
    );
    process.exitCode = 1;
  }
}

async function renderArchOutput(
  result: ArchResult,
  options: ArchCliOptions,
): Promise<string> {
  if (options.split && result.split) {
    const splitFmt = await import("./graph-arch-split-format.js");
    return options.json
      ? splitFmt.formatArchSplitJson(result.split)
      : splitFmt.formatArchSplit(result.split);
  }
  const fmt = await import("./graph-arch-format.js");
  if (options.json) return fmt.formatArchJson(result);
  if (options.domains) return fmt.formatArchDomains(result);
  if (options.health) return fmt.formatArchHealth(result);
  return formatArchMermaid(result);
}

async function emitArchOutput(
  content: string,
  out: string | undefined,
  result: ArchResult,
  isMarkdown: boolean,
): Promise<void> {
  if (!out) {
    console.log(content);
    return;
  }
  const fenced =
    !isMarkdown && out.endsWith(".md")
      ? "```mermaid\n" + content + "\n```\n"
      : content + "\n";
  await fs.writeFile(out, fenced, "utf-8");
  console.log(`Wrote ${archSummary(result)} to ${out}.`);
}

function archSummary(result: ArchResult): string {
  if (result.split) {
    return `split diagnostic (${result.split.packages.length} package(s))`;
  }
  if (result.partitionFit) {
    return `domain partition-fit analysis (Q ${result.partitionFit.domainQ.toFixed(3)})`;
  }
  if (result.quality) {
    return `partition-quality analysis (${result.quality.flagsCount} flag(s))`;
  }
  return `${result.packages.length} package(s), ${result.edges.length} edge(s)`;
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
    .option(
      "--domains <config>",
      "Path to a JSON config mapping path globs to domain names; aggregates the diagram at domain level and compares partition fit (domain vs package vs detected Q)",
    )
    .option(
      "--split",
      "Split diagnostic: per package (≥15 files), report internal clusters, bridge edges, sub-modularity Q, and per-cluster coupling as evidence (no verdict)",
    )
    .option("--json", "Output structured JSON")
    .action(runArchAction);
}
