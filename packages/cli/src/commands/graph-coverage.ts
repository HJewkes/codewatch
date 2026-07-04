import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  attributeCoverage,
  COVERAGE_METRIC_NAME,
  detectGitToplevel,
  fileId,
  openDatabase,
  type GraphDatabase,
  type GraphNode,
  type IstanbulCoverage,
  type SnapshotRow,
  type SymbolSpan,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";

export interface GraphCoverageOptions {
  db: string;
  root: string;
  snapshot?: string;
}

export interface GraphCoverageResult {
  snapshotId: number;
  files: number;
  symbols: number;
}

/**
 * Ingest an Istanbul `coverage-final.json` as a `coverage_pct` overlay on an
 * existing snapshot (default: latest). Coverage is a whole-suite dynamic artifact
 * kept OUT of the content-hash reuse gate (C-63): it's written wholesale here,
 * never carried forward by an incremental index. Re-running replaces the prior
 * coverage for the snapshot rather than accumulating stale rows.
 */
export function runGraphCoverageCommand(
  coverageFile: string,
  options: GraphCoverageOptions,
): GraphCoverageResult {
  const db = openDatabase(options.db);
  try {
    const snapshot = pickSnapshot(db, options.snapshot ? Number(options.snapshot) : undefined);
    const coverage = JSON.parse(readFileSync(coverageFile, "utf8")) as IstanbulCoverage;
    const { symbolsByFile, knownFiles } = indexNodes(
      db.listNodes(snapshot.id, { includeSymbols: true }),
    );
    const idRoot = detectGitToplevel(options.root) ?? options.root;
    const fileIdOf = (abs: string): string | null => {
      const id = fileId(idRoot, abs);
      return knownFiles.has(id) ? id : null;
    };
    const metrics = attributeCoverage(coverage, fileIdOf, symbolsByFile);
    db.replaceMetricsByName(snapshot.id, COVERAGE_METRIC_NAME, metrics);
    const symbols = metrics.filter((m) => m.nodeId.includes("#")).length;
    return { snapshotId: snapshot.id, files: metrics.length - symbols, symbols };
  } finally {
    db.close();
  }
}

/** File node ids (for path validation) + symbol spans grouped by declaring file. */
function indexNodes(nodes: readonly GraphNode[]): {
  symbolsByFile: Map<string, SymbolSpan[]>;
  knownFiles: Set<string>;
} {
  const symbolsByFile = new Map<string, SymbolSpan[]>();
  const knownFiles = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "file") {
      knownFiles.add(n.id);
      continue;
    }
    const start = n.attrs?.startLine;
    const end = n.attrs?.endLine;
    if (n.kind !== "symbol" || !n.parentId || typeof start !== "number" || typeof end !== "number") {
      continue;
    }
    const bucket = symbolsByFile.get(n.parentId) ?? [];
    bucket.push({ id: n.id, startLine: start, endLine: end });
    symbolsByFile.set(n.parentId, bucket);
  }
  return { symbolsByFile, knownFiles };
}

function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  if (id !== undefined) {
    const snap = db.getSnapshot(id);
    if (!snap) throw new Error(`No snapshot with id ${id}`);
    return snap;
  }
  const [snap] = db.listSnapshots({ limit: 1 });
  if (!snap) throw new Error("No snapshots in the database — run `graph index` first");
  return snap;
}

export function registerGraphCoverage(graphCmd: Command): void {
  graphCmd
    .command("coverage")
    .description(
      "Ingest an Istanbul coverage-final.json as a per-file/symbol coverage_pct overlay (C-63)",
    )
    .argument("<coverage-file>", "Path to coverage-final.json")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--root <path>", "Repo root for path mapping (default: cwd)", ".")
    .option("--snapshot <id>", "Snapshot id to attach coverage to (default: latest)")
    .action((coverageFile: string, options: GraphCoverageOptions) => {
      try {
        const r = runGraphCoverageCommand(coverageFile, options);
        console.log(
          `Coverage ingested into snapshot ${r.snapshotId}: ${r.files} files, ${r.symbols} symbols.`,
        );
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
