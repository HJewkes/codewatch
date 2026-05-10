import type { GraphEdge, GraphNode } from "@code-style/graph";

export interface RenderInput {
  snapshotId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
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
