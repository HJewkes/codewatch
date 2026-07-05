import {
  computePageRank,
  computeSymbolConsumers,
  parseSymbolId,
  type GraphDatabase,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
  type ReferenceEdgeLite,
  type SnapshotRow,
} from "@codewatch/graph";
import {
  buildContextDossier,
  type ContextBuildInput,
  type Provenance,
} from "../commands/graph-context-build.js";
import { collectNodeMetrics } from "../commands/dashboard-node-metrics.js";
import {
  classifyReferenceEdge,
  dominantStratum,
  type RefEdge,
} from "./stratify.js";
import type { OracleSuite, OracleTask, Stratum, TaskType } from "./types.js";
import { ALL_STRATA, ALL_TASK_TYPES } from "./types.js";

/**
 * C-82 comprehension oracle generator. Given a resolved `graph.db` snapshot it
 * emits a deterministic suite of graph-derived comprehension tasks. Ground truth
 * is computed the SAME way the product does: file-level answers come straight
 * from `buildContextDossier` (the `graph context` projection), symbol consumers
 * from `computeSymbolConsumers`. Same graph in → byte-identical suite out.
 */

const DEFAULT_PER_TYPE_CAP = 12;
const DEFAULT_WINDOW_DAYS = 30;

export interface GenerateOptions {
  snapshotId?: number;
  perTypeCap?: number;
}

/** Everything the dossier builder needs, assembled once and shared per target. */
interface Assembled {
  snap: SnapshotRow;
  provenance: Provenance;
  nodes: GraphNode[];
  fileIds: Set<string>;
  refEdges: RefEdge[];
  shared: Omit<ContextBuildInput, "target" | "kind">;
  refBySrc: Map<string, RefEdge[]>;
  refByOrigin: Map<string, RefEdge[]>;
  refByDst: Map<string, RefEdge[]>;
  importBySrc: Map<string, string[]>;
  centrality: Map<string, number>;
  consumersBySymbol: Map<string, string[]>;
}

function pickSnapshot(db: GraphDatabase, id: number | undefined): SnapshotRow {
  const snap =
    id !== undefined ? db.getSnapshot(id) : (db.listSnapshots({ limit: 1 })[0] ?? null);
  if (!snap) throw new Error("No snapshot found");
  return snap;
}

function resolveWindow(metrics: readonly GraphMetric[]): number {
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

function refEdgeOf(e: GraphEdge): RefEdge {
  return {
    srcId: e.srcId,
    dstId: e.dstId,
    specifier: typeof e.attrs?.specifier === "string" ? e.attrs.specifier : "",
  };
}

function groupBy<T>(items: readonly T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null) continue;
    let bucket = out.get(k);
    if (!bucket) out.set(k, (bucket = []));
    bucket.push(it);
  }
  return out;
}

function assemble(db: GraphDatabase, snap: SnapshotRow): Assembled {
  const nodes = db.listNodes(snap.id, { includeSymbols: true });
  const fileNodes = nodes.filter((n) => n.kind !== "symbol");
  const fileIds = new Set(fileNodes.filter((n) => n.kind === "file").map((n) => n.id));
  const edges = db.listEdges(snap.id, { includeReferences: true });
  const refEdges = edges.filter((e) => e.kind === "references").map(refEdgeOf);
  const importEdges = edges
    .filter((e) => e.kind === "imports")
    .map((e) => ({ srcId: e.srcId, dstId: e.dstId }));
  const metricRows = db.listMetrics(snap.id);
  const metrics = collectNodeMetrics(metricRows);
  const windowDays = resolveWindow(metricRows);
  const centrality = new Map<string, number>();
  for (const r of computePageRank(fileNodes, edges.filter((e) => e.kind !== "references"), {}).rows)
    centrality.set(r.nodeId, r.score);
  const roleByFile = new Map<string, string>();
  for (const n of fileNodes) if (n.role) roleByFile.set(n.id, n.role);
  const refLite: ReferenceEdgeLite[] = refEdges.map((e) => ({ srcId: e.srcId, dstId: e.dstId }));
  const consumersBySymbol = new Map<string, string[]>();
  for (const c of computeSymbolConsumers(refLite)) consumersBySymbol.set(c.symbolId, c.consumers);
  return {
    snap,
    provenance: provenanceOf(snap),
    nodes,
    fileIds,
    refEdges,
    shared: {
      provenance: provenanceOf(snap),
      nodes,
      refEdges: refLite,
      importEdges,
      metrics,
      churnByFile: churnByFile(metricRows, windowDays),
      churnWindowDays: windowDays,
      centrality,
      ownership: null,
      roleByFile,
    },
    refBySrc: groupBy(refEdges, (e) => e.srcId),
    refByOrigin: groupBy(refEdges, (e) => parseSymbolId(e.dstId)?.fileId ?? null),
    refByDst: groupBy(refEdges, (e) => e.dstId),
    importBySrc: new Map(
      [...groupBy(importEdges, (e) => e.srcId)].map(([k, v]) => [k, v.map((e) => e.dstId)]),
    ),
    centrality,
    consumersBySymbol,
  };
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

function fileDossier(a: Assembled, fileNode: GraphNode) {
  return buildContextDossier({ ...a.shared, target: fileNode, kind: "file" }).file!;
}

function strataOf(edges: readonly RefEdge[] | undefined, fileIds: ReadonlySet<string>): Stratum[] {
  return (edges ?? []).map((e) => classifyReferenceEdge(e, fileIds));
}

/** Task 1 — dependencies of a file (outbound). Ranked by centrality. */
function dependencyTasks(a: Assembled, cap: number): OracleTask[] {
  const rows: { node: GraphNode; items: string[]; rank: number }[] = [];
  for (const node of a.nodes) {
    if (node.kind !== "file") continue;
    const items = fileDossier(a, node).dependsOn;
    if (items.length === 0) continue;
    rows.push({ node, items, rank: a.centrality.get(node.id) ?? 0 });
  }
  rows.sort((x, y) => y.rank - x.rank || (x.node.id < y.node.id ? -1 : 1));
  return rows.slice(0, cap).map((r) => ({
    id: `dependencies::${r.node.id}`,
    type: "dependencies" as const,
    stratum: dominantStratum([
      ...strataOf(a.refBySrc.get(r.node.id), a.fileIds),
      ...(a.importBySrc.get(r.node.id) ?? []).map(() => "import-chain-reachable" as const),
    ]),
    targetId: r.node.id,
    targetKind: "file" as const,
    question: `What files or modules does \`${r.node.id}\` directly depend on?`,
    groundTruth: { kind: "list" as const, items: r.items },
  }));
}

/** Task 2 — reverse dependencies of a file (inbound consumers). */
function reverseDepTasks(a: Assembled, cap: number): OracleTask[] {
  const rows: { node: GraphNode; items: string[] }[] = [];
  for (const node of a.nodes) {
    if (node.kind !== "file") continue;
    const c = fileDossier(a, node).consumers;
    const items = [...c.source, ...c.test].sort();
    if (items.length === 0) continue;
    rows.push({ node, items });
  }
  rows.sort((x, y) => y.items.length - x.items.length || (x.node.id < y.node.id ? -1 : 1));
  return rows.slice(0, cap).map((r) => ({
    id: `reverse-deps::${r.node.id}`,
    type: "reverse-deps" as const,
    stratum: dominantStratum(strataOf(a.refByOrigin.get(r.node.id), a.fileIds)),
    targetId: r.node.id,
    targetKind: "file" as const,
    question: `Which files depend on (import from) \`${r.node.id}\`?`,
    groundTruth: { kind: "list" as const, items: r.items },
  }));
}

/** Task 3 — production vs test consumers of an exported symbol. */
function prodTestTasks(a: Assembled, cap: number): OracleTask[] {
  const rows = symbolConsumerRows(a);
  rows.sort(
    (x, y) =>
      Number(y.both) - Number(x.both) ||
      y.total - x.total ||
      (x.node.id < y.node.id ? -1 : 1),
  );
  return rows.slice(0, cap).map((r) => ({
    id: `prod-vs-test-consumers::${r.node.id}`,
    type: "prod-vs-test-consumers" as const,
    stratum: dominantStratum(strataOf(a.refByDst.get(r.node.id), a.fileIds)),
    targetId: r.node.id,
    targetKind: "symbol" as const,
    question: `Split the consumers of the exported symbol \`${r.node.name}\` (from \`${parseSymbolId(r.node.id)?.fileId}\`) into production vs test files.`,
    groundTruth: { kind: "role-split" as const, source: r.source, test: r.test },
  }));
}

function symbolConsumerRows(a: Assembled) {
  const roleOf = a.shared.roleByFile;
  const out: {
    node: GraphNode;
    source: string[];
    test: string[];
    total: number;
    both: boolean;
  }[] = [];
  for (const node of a.nodes) {
    if (node.kind !== "symbol" || node.attrs?.exported === false) continue;
    const consumers = a.consumersBySymbol.get(node.id) ?? [];
    if (consumers.length === 0) continue;
    const source: string[] = [];
    const test: string[] = [];
    for (const f of consumers) (roleOf.get(f) === "test" ? test : source).push(f);
    out.push({ node, source, test, total: consumers.length, both: source.length > 0 && test.length > 0 });
  }
  return out;
}

/**
 * Task 4 — blast radius: the riskiest symbols to change in a file, ranked by
 * utilization × complexity × churn (the product's `buildBlastRadius`). This is a
 * pure graph computation with no source-text discovery path, so every such task
 * is `structurally-hidden` by construction.
 */
function blastRadiusTasks(a: Assembled, cap: number): OracleTask[] {
  const rows: { node: GraphNode; items: string[]; top: number }[] = [];
  for (const node of a.nodes) {
    if (node.kind !== "file") continue;
    const br = fileDossier(a, node).blastRadius;
    if (br.length === 0) continue;
    rows.push({ node, items: br.map((e) => e.name), top: br[0]!.score });
  }
  rows.sort((x, y) => y.top - x.top || (x.node.id < y.node.id ? -1 : 1));
  return rows.slice(0, cap).map((r) => ({
    id: `blast-radius::${r.node.id}`,
    type: "blast-radius" as const,
    stratum: "structurally-hidden" as const,
    targetId: r.node.id,
    targetKind: "file" as const,
    question: `Rank the riskiest symbols to change in \`${r.node.id}\` (highest change-risk first).`,
    groundTruth: { kind: "ranked" as const, items: r.items },
  }));
}

function tally(tasks: readonly OracleTask[]): OracleSuite["counts"] {
  const byType = Object.fromEntries(ALL_TASK_TYPES.map((t) => [t, 0])) as Record<TaskType, number>;
  const byStratum = Object.fromEntries(ALL_STRATA.map((s) => [s, 0])) as Record<Stratum, number>;
  for (const t of tasks) {
    byType[t.type]++;
    byStratum[t.stratum]++;
  }
  return { total: tasks.length, byType, byStratum };
}

/** Generate the full deterministic comprehension suite for one snapshot. */
export function generateSuite(db: GraphDatabase, options: GenerateOptions = {}): OracleSuite {
  const cap = options.perTypeCap ?? DEFAULT_PER_TYPE_CAP;
  const a = assemble(db, pickSnapshot(db, options.snapshotId));
  const tasks = [
    ...dependencyTasks(a, cap),
    ...reverseDepTasks(a, cap),
    ...prodTestTasks(a, cap),
    ...blastRadiusTasks(a, cap),
  ].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return {
    source: {
      snapshotId: a.snap.id,
      ref: a.snap.ref,
      commitHash: a.snap.commitHash,
      indexVersion: a.snap.indexVersion,
    },
    params: { perTypeCap: cap },
    counts: tally(tasks),
    tasks,
  };
}
