import ElkBundled from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ELK } from "elkjs/lib/elk-api.js";

// elk.bundled exposes the constructor as its default export, but the bundled
// .js has no companion .d.ts. Re-cast through the typed constructor from elk-api.
const ELKCtor = ElkBundled as unknown as new () => ELK;
import type { LaidOutNode, LayoutResult, RenderInput } from "./types.js";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;

const ELK_LAYOUT_OPTIONS = {
  algorithm: "layered",
  "elk.direction": "DOWN",
  // Generous inter-layer channels so fan-out/skip edges have room to route
  // between layers instead of grazing the boxes.
  "elk.layered.spacing.nodeNodeBetweenLayers": "110",
  "elk.spacing.nodeNode": "55",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "16",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

function dimsFor(
  nodeId: string,
  sizing: Map<string, { width: number; height: number }> | null,
): { width: number; height: number } {
  return sizing?.get(nodeId) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
}

function toElkNodes(
  input: RenderInput,
  sizing: Map<string, { width: number; height: number }> | null,
): ElkNode[] {
  return input.nodes.map((n) => ({ id: n.id, ...dimsFor(n.id, sizing) }));
}

function toElkEdges(input: RenderInput, nodeIds: Set<string>): ElkExtendedEdge[] {
  return input.edges
    .filter((e) => nodeIds.has(e.srcId) && nodeIds.has(e.dstId))
    .map((e, i) => ({
      id: `e${i}`,
      sources: [e.srcId],
      targets: [e.dstId],
    }));
}

function applyLayout(
  input: RenderInput,
  positions: Map<string, { x: number; y: number }>,
  sizing: Map<string, { width: number; height: number }> | null,
): LaidOutNode[] {
  return input.nodes.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    const d = dimsFor(n.id, sizing);
    return { ...n, x: p.x, y: p.y, width: d.width, height: d.height };
  });
}

function gridFallback(
  input: RenderInput,
  sizing: Map<string, { width: number; height: number }> | null,
): LaidOutNode[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(input.nodes.length)));
  const gapX = NODE_WIDTH + 40;
  const gapY = NODE_HEIGHT + 40;
  return input.nodes.map((n, i) => {
    const d = dimsFor(n.id, sizing);
    return {
      ...n,
      x: (i % cols) * gapX,
      y: Math.floor(i / cols) * gapY,
      width: d.width,
      height: d.height,
    };
  });
}

// ELK reports node positions as top-left corners; Cytoscape positions are node
// centers. Return centers so edge-section coordinates (also ELK-absolute) share
// one frame with the node positions the client renders.
function readPositions(root: ElkNode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const c of root.children ?? []) {
    const x = c.x ?? 0;
    const y = c.y ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.set(c.id, { x: x + (c.width ?? NODE_WIDTH) / 2, y: y + (c.height ?? NODE_HEIGHT) / 2 });
  }
  return out;
}

// ELK's orthogonal edge routing — the obstacle-avoiding bend points. Keyed by
// the src/dst pair (a flat graph declares every edge at the root, so the section
// coordinates are already in the root/ELK-absolute frame).
function readEdgeRoutes(root: ElkNode): Map<string, Array<{ x: number; y: number }>> {
  const out = new Map<string, Array<{ x: number; y: number }>>();
  for (const e of root.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    out.set(routeKey(e.sources[0], e.targets[0]), pts);
  }
  return out;
}

function routeKey(srcId: string, dstId: string): string {
  return JSON.stringify([srcId, dstId]);
}

function attachRoutes(
  edges: RenderInput["edges"],
  routes: Map<string, Array<{ x: number; y: number }>>,
): RenderInput["edges"] {
  if (routes.size === 0) return edges;
  return edges.map((e) => {
    const route = routes.get(routeKey(e.srcId, e.dstId));
    return route ? { ...e, attrs: { ...e.attrs, route } } : e;
  });
}

export async function computeLayout(
  input: RenderInput,
  sizing: Map<string, { width: number; height: number }> | null = null,
): Promise<LayoutResult> {
  if (input.nodes.length === 0) return { nodes: [], edges: input.edges };
  const ids = new Set(input.nodes.map((n) => n.id));
  const root: ElkNode = {
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: toElkNodes(input, sizing),
    edges: toElkEdges(input, ids),
  };
  try {
    const elk = new ELKCtor();
    const laid = await elk.layout(root);
    const positions = readPositions(laid);
    if (positions.size === 0)
      return { nodes: gridFallback(input, sizing), edges: input.edges };
    return {
      nodes: applyLayout(input, positions, sizing),
      edges: attachRoutes(input.edges, readEdgeRoutes(laid)),
    };
  } catch {
    return { nodes: gridFallback(input, sizing), edges: input.edges };
  }
}
