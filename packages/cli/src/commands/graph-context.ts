import type { Command } from "commander";
import {
  computePageRank,
  openDatabase,
  parseSymbolId,
  type GraphDatabase,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
  type SnapshotRow,
} from "@codewatch/graph";
import { formatError } from "../utils/output.js";
import {
  buildContextDossier,
  type ContextDossier,
  type Provenance,
} from "./graph-context-build.js";
import { renderContextMarkdown } from "./graph-context-format.js";
import { collectNodeMetrics } from "./dashboard-node-metrics.js";

const DEFAULT_WINDOW_DAYS = 30;

export interface GraphContextCommandOptions {
  db: string;
  snapshot?: number;
  windowDays?: number;
}

/** Resolve a snapshot by id, else the latest. */
function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  const snapshot =
    id !== undefined ? db.getSnapshot(id) : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snapshot) throw new Error("No snapshot found");
  return snapshot;
}

/**
 * Resolve a target string to a graph node. A `<file>#<name>` string is an exact
 * symbol lookup; anything else matches a file node by exact id, then by unique
 * path suffix/substring — mirroring how the other query commands seed on a file.
 */
function resolveTarget(
  nodes: readonly GraphNode[],
  target: string,
): { node: GraphNode; kind: "file" | "symbol" } {
  if (parseSymbolId(target)) {
    const node = nodes.find((n) => n.id === target && n.kind === "symbol");
    if (!node) throw new Error(`No symbol node "${target}" in this snapshot.`);
    return { node, kind: "symbol" };
  }
  const files = nodes.filter((n) => n.kind === "file");
  const exact = files.find((n) => n.id === target);
  if (exact) return { node: exact, kind: "file" };
  const matches = files.filter((n) => n.id === target || n.id.endsWith(`/${target}`) || n.id.includes(target));
  if (matches.length === 1) return { node: matches[0]!, kind: "file" };
  if (matches.length === 0) throw new Error(`No file matching "${target}" in this snapshot.`);
  throw new Error(
    `Ambiguous target "${target}" — ${matches.length} matches:\n  ${matches.slice(0, 10).map((m) => m.id).join("\n  ")}`,
  );
}

/** Resolve the churn window to read: the requested one, else the smallest present. */
function resolveWindow(metrics: readonly GraphMetric[], requested: number | undefined): number {
  if (requested !== undefined) return requested;
  const windows = new Set<number>();
  for (const m of metrics) {
    const match = /^churn_(\d+)d$/.exec(m.name);
    if (match) windows.add(Number(match[1]));
  }
  return windows.size ? Math.min(...windows) : DEFAULT_WINDOW_DAYS;
}

function churnByFile(metrics: readonly GraphMetric[], windowDays: number): Map<string, number> {
  const name = `churn_${windowDays}d`;
  const out = new Map<string, number>();
  for (const m of metrics) if (m.name === name && m.value !== null) out.set(m.nodeId, m.value);
  return out;
}

function refEdgesOf(edges: readonly GraphEdge[]): { srcId: string; dstId: string }[] {
  return edges.filter((e) => e.kind === "references").map((e) => ({ srcId: e.srcId, dstId: e.dstId }));
}

export function runGraphContextCommand(
  target: string,
  options: GraphContextCommandOptions,
): ContextDossier {
  const db = openDatabase(options.db);
  try {
    const snap = pickSnapshot(db, options.snapshot);
    const nodes = db.listNodes(snap.id, { includeSymbols: true });
    const fileNodes = nodes.filter((n) => n.kind !== "symbol");
    const refEdges = refEdgesOf(db.listEdges(snap.id, { includeReferences: true }));
    const fileEdges = db.listEdges(snap.id);
    const metricRows = db.listMetrics(snap.id);
    const metrics = collectNodeMetrics(metricRows);
    const windowDays = resolveWindow(metricRows, options.windowDays);
    const centrality = new Map<string, number>();
    for (const r of computePageRank(fileNodes, fileEdges, {}).rows) centrality.set(r.nodeId, r.score);
    const roleByFile = new Map<string, string>();
    for (const n of fileNodes) if (n.role) roleByFile.set(n.id, n.role);
    const { node, kind } = resolveTarget(nodes, target);
    return buildContextDossier({
      target: node,
      kind,
      provenance: provenanceOf(snap),
      nodes,
      refEdges,
      importEdges: fileEdges.filter((e) => e.kind === "imports").map((e) => ({ srcId: e.srcId, dstId: e.dstId })),
      metrics,
      churnByFile: churnByFile(metricRows, windowDays),
      churnWindowDays: windowDays,
      centrality,
      ownership: null,
      roleByFile,
    });
  } finally {
    db.close();
  }
}

function provenanceOf(snap: SnapshotRow): Provenance {
  return {
    snapshotId: snap.id,
    ref: snap.ref,
    commitHash: snap.commitHash,
    takenAt: snap.takenAt,
    indexVersion: snap.indexVersion,
  };
}

export function registerGraphContext(graph: Command): void {
  graph
    .command("context <target>")
    .description(
      "Deterministic per-file/per-symbol context dossier (Class A artifact) for RAG/agent consumption.",
    )
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--window-days <n>", "Churn window to report (default: smallest indexed)")
    .option("--json", "Output the raw JSON dossier (default: markdown projection)")
    .action(
      (
        target: string,
        options: { db: string; snapshot?: string; windowDays?: string; json?: boolean },
      ) => {
        try {
          const dossier = runGraphContextCommand(target, {
            db: options.db,
            snapshot: options.snapshot ? Number(options.snapshot) : undefined,
            windowDays: options.windowDays ? Number(options.windowDays) : undefined,
          });
          console.log(options.json ? JSON.stringify(dossier, null, 2) : renderContextMarkdown(dossier));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
          process.exitCode = 1;
        }
      },
    );
}
