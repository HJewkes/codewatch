import type {
  GraphDiffSummary,
  GraphEdge,
  GraphNode,
  SnapshotRow,
} from "@code-style/graph";

export type NodeStatus = "unchanged" | "added" | "removed" | "renamed";
export type EdgeStatus = "unchanged" | "added" | "removed";

export interface RenderDiffMeta {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  nodeStatus: Record<string, NodeStatus>;
  edgeStatus: Record<string, EdgeStatus>;
  renames: Record<string, string>;
  summary: GraphDiffSummary;
}

export interface RenderInput {
  snapshotId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  diff?: RenderDiffMeta;
}

export interface RenderOptions {
  title?: string;
  subtitle?: string;
}

export type LaidOutNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface LayoutResult {
  nodes: LaidOutNode[];
  edges: GraphEdge[];
}
