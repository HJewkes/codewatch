import type {
  CheckResult,
  CheckViolation,
  GraphDiffSummary,
  GraphEdge,
  GraphMetric,
  GraphNode,
  SnapshotRow,
} from "@codewatch/graph";

export type NodeStatus = "unchanged" | "added" | "removed" | "renamed";
export type EdgeStatus = "unchanged" | "added" | "removed";

export interface RenderDiffMeta {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  nodeStatus: Record<string, NodeStatus>;
  edgeStatus: Record<string, EdgeStatus>;
  renames: Record<string, string>;
  summary: GraphDiffSummary;
  metricsBefore?: GraphMetric[];
}

export interface CheckDiffOverlay {
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
  resolved: CheckViolation[];
  worsened: Array<{ violation: CheckViolation; before: number; after: number }>;
  improved: Array<{ violation: CheckViolation; before: number; after: number }>;
  newCount: number;
  resolvedCount: number;
}

export interface RenderInput {
  snapshotId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics?: GraphMetric[];
  diff?: RenderDiffMeta;
  checkResult?: CheckResult;
  checkDiff?: CheckDiffOverlay;
}

export interface RenderOptions {
  title?: string;
  subtitle?: string;
  sizeBy?: string;
  colorBy?: string;
  /** Render as a flat DAG without compound package parents (focus view). */
  flat?: boolean;
  /**
   * Lay the file-level graph out as an ELK compound hierarchy (files nested in
   * package boxes) with orthogonal routing, instead of client-side cose-bilkent.
   */
  compound?: boolean;
  /**
   * Drill the compound view one level deeper: nest files inside a box for their
   * directory, nested in turn inside their package box (`package → subdir →
   * file`). Only meaningful together with `compound`.
   */
  nested?: boolean;
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
