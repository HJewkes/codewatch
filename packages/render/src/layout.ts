import ElkBundled from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ELK } from "elkjs/lib/elk-api.js";

// elk.bundled exposes the constructor as its default export, but the bundled
// .js has no companion .d.ts. Re-cast through the typed constructor from elk-api.
const ELKCtor = ElkBundled as unknown as new () => ELK;
import type { GraphNode } from "@code-style/graph";
import type { LaidOutNode, LayoutResult, RenderInput } from "./types.js";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;

const ELK_LAYOUT_OPTIONS = {
  algorithm: "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.nodeNode": "32",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

function toElkNode(n: GraphNode): ElkNode {
  return { id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT };
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
): LaidOutNode[] {
  return input.nodes.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    return { ...n, x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT };
  });
}

function gridFallback(input: RenderInput): LaidOutNode[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(input.nodes.length)));
  const gapX = NODE_WIDTH + 40;
  const gapY = NODE_HEIGHT + 40;
  return input.nodes.map((n, i) => ({
    ...n,
    x: (i % cols) * gapX,
    y: Math.floor(i / cols) * gapY,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
}

function readPositions(root: ElkNode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const c of root.children ?? []) {
    const x = c.x ?? 0;
    const y = c.y ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.set(c.id, { x, y });
  }
  return out;
}

export async function computeLayout(input: RenderInput): Promise<LayoutResult> {
  if (input.nodes.length === 0) return { nodes: [], edges: input.edges };
  const ids = new Set(input.nodes.map((n) => n.id));
  const root: ElkNode = {
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: input.nodes.map(toElkNode),
    edges: toElkEdges(input, ids),
  };
  try {
    const elk = new ELKCtor();
    const laid = await elk.layout(root);
    const positions = readPositions(laid);
    if (positions.size === 0) return { nodes: gridFallback(input), edges: input.edges };
    return { nodes: applyLayout(input, positions), edges: input.edges };
  } catch {
    return { nodes: gridFallback(input), edges: input.edges };
  }
}
