import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";
import type {
  GraphEdge,
  GraphMetric,
  GraphNode,
  SnapshotRow,
} from "./types.js";

interface SnapshotInsert {
  ref: string;
  commitHash?: string;
  indexVersion: string;
  attrs?: Record<string, unknown>;
}

interface SnapshotDbRow {
  id: number;
  ref: string;
  commit_hash: string | null;
  taken_at: string;
  index_version: string;
  attrs: string;
}

interface NodeDbRow {
  id: string;
  kind: string;
  name: string;
  parent_id: string | null;
  language: string | null;
  attrs: string;
}

interface EdgeDbRow {
  src_id: string;
  dst_id: string;
  kind: string;
  attrs: string;
}

function rowToSnapshot(row: SnapshotDbRow): SnapshotRow {
  return {
    id: row.id,
    ref: row.ref,
    commitHash: row.commit_hash,
    takenAt: row.taken_at,
    indexVersion: row.index_version,
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
  };
}

function rowToNode(row: NodeDbRow): GraphNode {
  return {
    id: row.id,
    kind: row.kind as GraphNode["kind"],
    name: row.name,
    parentId: row.parent_id ?? undefined,
    language: row.language ?? undefined,
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
  };
}

function rowToEdge(row: EdgeDbRow): GraphEdge {
  return {
    srcId: row.src_id,
    dstId: row.dst_id,
    kind: row.kind as GraphEdge["kind"],
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
  };
}

export class GraphDatabase {
  private readonly insertSnapshotStmt;
  private readonly insertNodeStmt;
  private readonly insertEdgeStmt;
  private readonly insertMetricStmt;
  private readonly getSnapshotStmt;
  private readonly listSnapshotsAllStmt;
  private readonly listSnapshotsByRefStmt;
  private readonly getNodeStmt;
  private readonly listNodesStmt;
  private readonly listEdgesStmt;

  constructor(private readonly db: Database.Database) {
    this.insertSnapshotStmt = db.prepare(
      `INSERT INTO snapshot (ref, commit_hash, taken_at, index_version, attrs)
       VALUES (@ref, @commitHash, @takenAt, @indexVersion, @attrs)`,
    );
    this.insertNodeStmt = db.prepare(
      `INSERT INTO node (snapshot_id, id, kind, name, parent_id, language, attrs)
       VALUES (@snapshotId, @id, @kind, @name, @parentId, @language, @attrs)`,
    );
    this.insertEdgeStmt = db.prepare(
      `INSERT INTO edge (snapshot_id, src_id, dst_id, kind, attrs)
       VALUES (@snapshotId, @srcId, @dstId, @kind, @attrs)`,
    );
    this.insertMetricStmt = db.prepare(
      `INSERT INTO metric (snapshot_id, node_id, name, value, unit)
       VALUES (@snapshotId, @nodeId, @name, @value, @unit)`,
    );
    this.getSnapshotStmt = db.prepare(
      "SELECT * FROM snapshot WHERE id = ?",
    );
    this.listSnapshotsAllStmt = db.prepare(
      "SELECT * FROM snapshot ORDER BY taken_at DESC LIMIT ?",
    );
    this.listSnapshotsByRefStmt = db.prepare(
      "SELECT * FROM snapshot WHERE ref = ? ORDER BY taken_at DESC LIMIT ?",
    );
    this.getNodeStmt = db.prepare(
      "SELECT id, kind, name, parent_id, language, attrs FROM node WHERE snapshot_id = ? AND id = ?",
    );
    this.listNodesStmt = db.prepare(
      "SELECT id, kind, name, parent_id, language, attrs FROM node WHERE snapshot_id = ?",
    );
    this.listEdgesStmt = db.prepare(
      "SELECT src_id, dst_id, kind, attrs FROM edge WHERE snapshot_id = ?",
    );
  }

  createSnapshot(input: SnapshotInsert): number {
    const result = this.insertSnapshotStmt.run({
      ref: input.ref,
      commitHash: input.commitHash ?? null,
      takenAt: new Date().toISOString(),
      indexVersion: input.indexVersion,
      attrs: JSON.stringify(input.attrs ?? {}),
    });
    return Number(result.lastInsertRowid);
  }

  insertNode(snapshotId: number, node: GraphNode): void {
    this.insertNodeStmt.run({
      snapshotId,
      id: node.id,
      kind: node.kind,
      name: node.name,
      parentId: node.parentId ?? null,
      language: node.language ?? null,
      attrs: JSON.stringify(node.attrs ?? {}),
    });
  }

  insertEdge(snapshotId: number, edge: GraphEdge): void {
    this.insertEdgeStmt.run({
      snapshotId,
      srcId: edge.srcId,
      dstId: edge.dstId,
      kind: edge.kind,
      attrs: JSON.stringify(edge.attrs ?? {}),
    });
  }

  insertMetric(snapshotId: number, metric: GraphMetric): void {
    this.insertMetricStmt.run({
      snapshotId,
      nodeId: metric.nodeId,
      name: metric.name,
      value: metric.value,
      unit: metric.unit ?? null,
    });
  }

  insertNodes(snapshotId: number, nodes: readonly GraphNode[]): void {
    const tx = this.db.transaction((rows: readonly GraphNode[]) => {
      for (const n of rows) this.insertNode(snapshotId, n);
    });
    tx(nodes);
  }

  insertEdges(snapshotId: number, edges: readonly GraphEdge[]): void {
    const tx = this.db.transaction((rows: readonly GraphEdge[]) => {
      for (const e of rows) this.insertEdge(snapshotId, e);
    });
    tx(edges);
  }

  insertMetrics(snapshotId: number, metrics: readonly GraphMetric[]): void {
    const tx = this.db.transaction((rows: readonly GraphMetric[]) => {
      for (const m of rows) this.insertMetric(snapshotId, m);
    });
    tx(metrics);
  }

  getSnapshot(id: number): SnapshotRow | null {
    const row = this.getSnapshotStmt.get(id) as SnapshotDbRow | undefined;
    return row ? rowToSnapshot(row) : null;
  }

  listSnapshots(opts: { ref?: string; limit?: number } = {}): SnapshotRow[] {
    const limit = opts.limit ?? 50;
    const rows = (
      opts.ref
        ? this.listSnapshotsByRefStmt.all(opts.ref, limit)
        : this.listSnapshotsAllStmt.all(limit)
    ) as SnapshotDbRow[];
    return rows.map(rowToSnapshot);
  }

  getNode(snapshotId: number, id: string): GraphNode | null {
    const row = this.getNodeStmt.get(snapshotId, id) as NodeDbRow | undefined;
    return row ? rowToNode(row) : null;
  }

  listNodes(snapshotId: number): GraphNode[] {
    const rows = this.listNodesStmt.all(snapshotId) as NodeDbRow[];
    return rows.map(rowToNode);
  }

  listEdges(snapshotId: number): GraphEdge[] {
    const rows = this.listEdgesStmt.all(snapshotId) as EdgeDbRow[];
    return rows.map(rowToEdge);
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(path: string): GraphDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return new GraphDatabase(db);
}
