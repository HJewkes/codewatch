import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";
import type {
  GraphEdge,
  GraphMetric,
  GraphNode,
  IdAlias,
  IdAliasReason,
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
  role: string | null;
  attrs: string;
}

interface EdgeDbRow {
  src_id: string;
  dst_id: string;
  kind: string;
  attrs: string;
}

interface MetricDbRow {
  node_id: string;
  name: string;
  value: number | null;
  unit: string | null;
}

interface AliasDbRow {
  old_id: string;
  new_id: string;
  reason: string;
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
    role: (row.role ?? undefined) as GraphNode["role"],
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

function rowToMetric(row: MetricDbRow): GraphMetric {
  return {
    nodeId: row.node_id,
    name: row.name,
    value: row.value,
    unit: row.unit ?? undefined,
  };
}

function rowToAlias(row: AliasDbRow): IdAlias {
  return {
    oldId: row.old_id,
    newId: row.new_id,
    reason: row.reason as IdAliasReason,
  };
}

export class GraphDatabase {
  private readonly insertSnapshotStmt;
  private readonly insertNodeStmt;
  private readonly insertEdgeStmt;
  private readonly insertMetricStmt;
  private readonly insertAliasStmt;
  private readonly getSnapshotStmt;
  private readonly listSnapshotsAllStmt;
  private readonly listSnapshotsByRefStmt;
  private readonly getNodeStmt;
  private readonly listNodesStmt;
  private readonly listEdgesStmt;
  private readonly listMetricsStmt;
  private readonly listAliasesStmt;

  constructor(private readonly db: Database.Database) {
    this.insertSnapshotStmt = db.prepare(
      `INSERT INTO snapshot (ref, commit_hash, taken_at, index_version, attrs)
       VALUES (@ref, @commitHash, @takenAt, @indexVersion, @attrs)`,
    );
    this.insertNodeStmt = db.prepare(
      `INSERT INTO node (snapshot_id, id, kind, name, parent_id, language, role, attrs)
       VALUES (@snapshotId, @id, @kind, @name, @parentId, @language, @role, @attrs)`,
    );
    this.insertEdgeStmt = db.prepare(
      `INSERT INTO edge (snapshot_id, src_id, dst_id, kind, attrs)
       VALUES (@snapshotId, @srcId, @dstId, @kind, @attrs)`,
    );
    this.insertMetricStmt = db.prepare(
      `INSERT INTO metric (snapshot_id, node_id, name, value, unit)
       VALUES (@snapshotId, @nodeId, @name, @value, @unit)`,
    );
    this.insertAliasStmt = db.prepare(
      `INSERT INTO id_alias (snapshot_id, old_id, new_id, reason)
       VALUES (@snapshotId, @oldId, @newId, @reason)`,
    );
    this.getSnapshotStmt = db.prepare(
      "SELECT * FROM snapshot WHERE id = ?",
    );
    this.listSnapshotsAllStmt = db.prepare(
      "SELECT * FROM snapshot ORDER BY taken_at DESC, id DESC LIMIT ?",
    );
    this.listSnapshotsByRefStmt = db.prepare(
      "SELECT * FROM snapshot WHERE ref = ? ORDER BY taken_at DESC, id DESC LIMIT ?",
    );
    this.getNodeStmt = db.prepare(
      "SELECT id, kind, name, parent_id, language, role, attrs FROM node WHERE snapshot_id = ? AND id = ?",
    );
    this.listNodesStmt = db.prepare(
      "SELECT id, kind, name, parent_id, language, role, attrs FROM node WHERE snapshot_id = ?",
    );
    this.listEdgesStmt = db.prepare(
      "SELECT src_id, dst_id, kind, attrs FROM edge WHERE snapshot_id = ?",
    );
    this.listMetricsStmt = db.prepare(
      "SELECT node_id, name, value, unit FROM metric WHERE snapshot_id = ?",
    );
    this.listAliasesStmt = db.prepare(
      "SELECT old_id, new_id, reason FROM id_alias WHERE snapshot_id = ?",
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
      role: node.role ?? null,
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

  insertAlias(snapshotId: number, alias: IdAlias): void {
    this.insertAliasStmt.run({
      snapshotId,
      oldId: alias.oldId,
      newId: alias.newId,
      reason: alias.reason,
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

  insertAliases(snapshotId: number, aliases: readonly IdAlias[]): void {
    const tx = this.db.transaction((rows: readonly IdAlias[]) => {
      for (const a of rows) this.insertAlias(snapshotId, a);
    });
    tx(aliases);
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

  listMetrics(snapshotId: number): GraphMetric[] {
    const rows = this.listMetricsStmt.all(snapshotId) as MetricDbRow[];
    return rows.map(rowToMetric);
  }

  listMetricNames(snapshotId: number): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT name FROM metric WHERE snapshot_id = ? ORDER BY name",
      )
      .all(snapshotId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  topByMetric(opts: {
    snapshotId: number;
    metric: string;
    limit?: number;
    kind?: string;
  }): Array<{
    nodeId: string;
    name: string;
    kind: string;
    role: string | null;
    value: number | null;
    unit: string | null;
  }> {
    const limit = opts.limit ?? 20;
    const sql =
      `SELECT m.node_id, m.value, m.unit, n.kind, n.name, n.role ` +
      `FROM metric m JOIN node n ` +
      `ON n.snapshot_id = m.snapshot_id AND n.id = m.node_id ` +
      `WHERE m.snapshot_id = ? AND m.name = ?` +
      (opts.kind ? ` AND n.kind = ?` : ``) +
      ` ORDER BY m.value DESC LIMIT ?`;
    const params = opts.kind
      ? [opts.snapshotId, opts.metric, opts.kind, limit]
      : [opts.snapshotId, opts.metric, limit];
    const rows = this.db.prepare(sql).all(...params) as Array<{
      node_id: string;
      value: number | null;
      unit: string | null;
      kind: string;
      name: string;
      role: string | null;
    }>;
    return rows.map((r) => ({
      nodeId: r.node_id,
      name: r.name,
      kind: r.kind,
      role: r.role,
      value: r.value,
      unit: r.unit,
    }));
  }

  listAliases(snapshotId: number): IdAlias[] {
    const rows = this.listAliasesStmt.all(snapshotId) as AliasDbRow[];
    return rows.map(rowToAlias);
  }

  getLatestSnapshotByRef(ref: string): SnapshotRow | null {
    const [row] = this.listSnapshots({ ref, limit: 1 });
    return row ?? null;
  }

  deleteSnapshots(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare("DELETE FROM snapshot WHERE id = ?");
    const tx = this.db.transaction((rows: readonly number[]) => {
      for (const id of rows) stmt.run(id);
    });
    tx(ids);
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  countRowsByTable(tables: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of tables) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      out[table] = row.n;
    }
    return out;
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
