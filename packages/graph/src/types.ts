export type NodeKind =
  | "package"
  | "module"
  | "file"
  | "symbol"
  | "external";

export type EdgeKind =
  | "imports"
  | "re-exports"
  | "calls"
  | "extends"
  | "implements"
  | "references"
  | "depends-on";

export type IdAliasReason = "rename" | "move" | "merge";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId?: string;
  language?: string;
  attrs?: Record<string, unknown>;
}

export interface GraphEdge {
  srcId: string;
  dstId: string;
  kind: EdgeKind;
  attrs?: Record<string, unknown>;
}

export interface GraphMetric {
  nodeId: string;
  name: string;
  value: number | null;
  unit?: string;
}

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SnapshotRow {
  id: number;
  ref: string;
  commitHash: string | null;
  takenAt: string;
  indexVersion: string;
  attrs: Record<string, unknown>;
}

export interface EntryPoint {
  nodeId: string;
  kind: string;
  attrs?: Record<string, unknown>;
}
