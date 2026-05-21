import type { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  compilePatterns,
  computePageRank,
  matchesAny,
  openDatabase,
  type GraphDatabase,
  type GraphMetric,
  type SnapshotRow,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";
import { buildReportContext } from "./graph-report-sections.js";
import {
  bucketFilesByPackage,
  detectPackages,
  type PackageRoot,
} from "./graph-wiki-packages.js";
import {
  buildWikiPackages,
  type PackageWiki,
  type WikiResult,
} from "./graph-wiki-sections.js";
import { formatWiki, pageFilename } from "./graph-wiki-format.js";

export type { PackageWiki, WikiResult };
export { pageFilename };

export interface GraphWikiCommandOptions {
  db: string;
  repoRoot: string;
  out?: string;
  snapshot?: number;
  windowDays?: number;
  limit?: number;
  package?: string[];
  exclude?: string[];
  excludeRole?: string[];
  json?: boolean;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 10;

export function runGraphWikiCommand(
  options: GraphWikiCommandOptions,
): WikiResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const excluders = compilePatterns(options.exclude);
    const excludedRoles = new Set(options.excludeRole ?? []);
    const nodes = db.listNodes(snapshot.id);
    const edges = db.listEdges(snapshot.id);
    const metrics = db.listMetrics(snapshot.id);
    const windowDays = resolveWindowDays(
      metrics,
      options.windowDays ?? DEFAULT_WINDOW_DAYS,
    );
    const globalCtx = buildReportContext({
      nodes,
      metrics,
      excluders,
      excludedRoles,
      windowDays,
    });
    const allPackages = detectPackages(options.repoRoot);
    const packages = filterPackages(allPackages, options.package);
    const fileIds = nodes
      .filter((n) => n.kind === "file")
      .map((n) => n.id)
      .filter((id) => !matchesAny(id, excluders));
    const fileByPackage = bucketFilesByPackage(fileIds, packages);
    const pageRank = computePageRank(nodes, edges, {}).rows;
    const pkgs = buildWikiPackages({
      globalCtx,
      nodes,
      edges,
      pageRank,
      packages,
      fileByPackage,
      repoRoot: options.repoRoot,
      windowDays,
      limit,
    });
    return { snapshot, windowDays, packages: pkgs };
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

function resolveWindowDays(
  metrics: readonly GraphMetric[],
  requested: number,
): number {
  const re = /^churn_(\d+)d$/;
  const available = new Set<number>();
  for (const m of metrics) {
    const match = re.exec(m.name);
    if (match) available.add(Number(match[1]));
  }
  if (available.has(requested) || available.size === 0) return requested;
  return [...available][0]!;
}

function filterPackages(
  packages: readonly PackageRoot[],
  patterns: readonly string[] | undefined,
): PackageRoot[] {
  if (!patterns || patterns.length === 0) return [...packages];
  const compiled = compilePatterns(patterns);
  return packages.filter((p) => matchesAny(p.id, compiled));
}

export async function writeWikiFiles(
  outDir: string,
  result: WikiResult,
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const files = formatWiki(result);
  const written: string[] = [];
  for (const f of files) {
    const target = path.join(outDir, f.path);
    await fs.writeFile(target, f.content + "\n", "utf-8");
    written.push(target);
  }
  return written;
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerGraphWiki(graphCmd: Command): void {
  graphCmd
    .command("wiki")
    .description(
      "Generate per-package markdown drill-in pages (hotspots, silos, coupling, deps) plus an index.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--repo-root <path>", "Repo root for package + git lookup", ".")
    .option("--out <dir>", "Output directory (default docs/wiki)", "docs/wiki")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--window-days <n>", "Window for churn/coupling (default 30)")
    .option("--limit <n>", "Rows per section (default 10)")
    .option(
      "--package <pattern...>",
      "Only generate for packages matching this glob/substring (repeatable)",
    )
    .option(
      "--exclude <pattern...>",
      "Exclude file ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude files with this role (test, fixture, …; repeatable)",
    )
    .option("--json", "Output structured JSON to stdout instead of writing files")
    .action(
      async (options: {
        db: string;
        repoRoot: string;
        out: string;
        snapshot?: string;
        windowDays?: string;
        limit?: string;
        package?: string[];
        exclude?: string[];
        excludeRole?: string[];
        json?: boolean;
      }) => {
        try {
          const result = runGraphWikiCommand({
            db: options.db,
            repoRoot: options.repoRoot,
            out: options.out,
            snapshot: asNumber(options.snapshot),
            windowDays: asNumber(options.windowDays),
            limit: asNumber(options.limit),
            package: options.package,
            exclude: options.exclude,
            excludeRole: options.excludeRole,
          });
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          const written = await writeWikiFiles(options.out, result);
          console.log(
            `Wrote ${written.length} file(s) to ${options.out} (${result.packages.length} package(s)).`,
          );
        } catch (err) {
          console.error(
            formatError(err instanceof Error ? err.message : String(err)),
          );
          process.exitCode = 1;
        }
      },
    );
}
