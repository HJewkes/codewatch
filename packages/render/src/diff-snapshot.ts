import {
  diffSnapshots,
  openDatabase,
  type GraphDatabase,
  type GraphEdge,
  type GraphNode,
  type SnapshotRow,
} from "@code-style/graph";
import type {
  EdgeStatus,
  NodeStatus,
  RenderDiffMeta,
  RenderInput,
} from "./types.js";

export interface LoadDiffOptions {
  dbPath: string;
  from: string;
  to: string;
}

export async function loadDiff(
  options: LoadDiffOptions,
): Promise<RenderInput> {
  const db = openDatabase(options.dbPath);
  try {
    const fromSnapshot = resolveSnapshot(db, options.from, "from");
    const toSnapshot = resolveSnapshot(db, options.to, "to");
    const diff = diffSnapshots(db, {
      fromSnapshotId: fromSnapshot.id,
      toSnapshotId: toSnapshot.id,
    });

    const fromNodes = db.listNodes(fromSnapshot.id);
    const toNodes = db.listNodes(toSnapshot.id);
    const fromEdges = db.listEdges(fromSnapshot.id);
    const toEdges = db.listEdges(toSnapshot.id);

    const renames = renamesByOldId(diff.renamedNodes.map((r) => r));
    const renamesNewToOld = invert(renames);

    const nodes = unionNodes(fromNodes, toNodes, renames);
    const nodeStatus = classifyNodes(diff, renames);
    const edges = unionEdges(fromEdges, toEdges, renames);
    const edgeStatus = classifyEdges(diff, fromEdges, toEdges, renames);

    const meta: RenderDiffMeta = {
      fromSnapshot,
      toSnapshot,
      nodeStatus,
      edgeStatus,
      renames: renamesNewToOld,
      summary: diff.summary,
    };

    return {
      snapshotId: toSnapshot.id,
      nodes,
      edges,
      diff: meta,
    };
  } finally {
    db.close();
  }
}

function resolveSnapshot(
  db: GraphDatabase,
  spec: string,
  flag: string,
): SnapshotRow {
  if (/^\d+$/.test(spec)) {
    const snap = db.getSnapshot(Number(spec));
    if (!snap) throw new Error(`${flag}: no snapshot with id ${spec}`);
    return snap;
  }
  const snap = db.getLatestSnapshotByRef(spec);
  if (!snap) throw new Error(`${flag}: no snapshot found for ref "${spec}"`);
  return snap;
}

function renamesByOldId(
  pairs: ReadonlyArray<{ oldId: string; newId: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of pairs) m.set(r.oldId, r.newId);
  return m;
}

function invert(m: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [oldId, newId] of m) out[newId] = oldId;
  return out;
}

function unionNodes(
  fromNodes: readonly GraphNode[],
  toNodes: readonly GraphNode[],
  renames: Map<string, string>,
): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const n of toNodes) byId.set(n.id, n);
  for (const n of fromNodes) {
    const newId = renames.get(n.id);
    if (newId && byId.has(newId)) continue;
    if (byId.has(n.id)) continue;
    byId.set(n.id, n);
  }
  return [...byId.values()];
}

function classifyNodes(
  diff: ReturnType<typeof diffSnapshots>,
  renames: Map<string, string>,
): Record<string, NodeStatus> {
  const status: Record<string, NodeStatus> = {};
  for (const n of diff.addedNodes) status[n.id] = "added";
  for (const n of diff.removedNodes) {
    if (!renames.has(n.id)) status[n.id] = "removed";
  }
  for (const r of diff.renamedNodes) status[r.newId] = "renamed";
  return status;
}

function edgeKey(srcId: string, dstId: string, kind: string): string {
  return `${srcId} ${dstId} ${kind}`;
}

function unionEdges(
  fromEdges: readonly GraphEdge[],
  toEdges: readonly GraphEdge[],
  renames: Map<string, string>,
): GraphEdge[] {
  const out: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of toEdges) {
    const k = edgeKey(e.srcId, e.dstId, e.kind);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  for (const e of fromEdges) {
    const remappedSrc = renames.get(e.srcId) ?? e.srcId;
    const remappedDst = renames.get(e.dstId) ?? e.dstId;
    const remappedKey = edgeKey(remappedSrc, remappedDst, e.kind);
    if (seen.has(remappedKey)) continue;
    const originalKey = edgeKey(e.srcId, e.dstId, e.kind);
    if (seen.has(originalKey)) continue;
    seen.add(originalKey);
    out.push(e);
  }
  return out;
}

function classifyEdges(
  diff: ReturnType<typeof diffSnapshots>,
  fromEdges: readonly GraphEdge[],
  toEdges: readonly GraphEdge[],
  renames: Map<string, string>,
): Record<string, EdgeStatus> {
  const status: Record<string, EdgeStatus> = {};
  const addedKeys = new Set(
    diff.addedEdges.map((e) => edgeKey(e.srcId, e.dstId, e.kind)),
  );
  for (const e of toEdges) {
    const k = edgeKey(e.srcId, e.dstId, e.kind);
    status[k] = addedKeys.has(k) ? "added" : "unchanged";
  }
  for (const e of fromEdges) {
    const remappedKey = edgeKey(
      renames.get(e.srcId) ?? e.srcId,
      renames.get(e.dstId) ?? e.dstId,
      e.kind,
    );
    if (status[remappedKey] !== undefined) continue;
    const k = edgeKey(e.srcId, e.dstId, e.kind);
    if (status[k] !== undefined) continue;
    status[k] = "removed";
  }
  return status;
}
