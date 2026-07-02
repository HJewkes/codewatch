import type { LayoutResult } from "./types.js";

export interface EdgeRouting {
  se: string;
  te: string;
  w: number[];
  d: number[];
}

export interface Pt {
  x: number;
  y: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function edgeRouteOf(e: { attrs?: Record<string, unknown> }): Pt[] | undefined {
  const r = e.attrs?.route;
  if (!Array.isArray(r) || r.length < 2) return undefined;
  const pts = r.filter(
    (p): p is Pt =>
      !!p && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y),
  );
  return pts.length >= 2 ? pts : undefined;
}

/**
 * Project ELK's absolute orthogonal route (start, …bends, end) into Cytoscape's
 * `segments` model: endpoints pinned as px offsets from each node center, and
 * each bend as a (weight-along, signed-distance-perpendicular) pair relative to
 * the source→target *center* axis. Pairs with `edge-distances: node-position`
 * (so the axis is measured center-to-center) — then a segment point reconstructs
 * as `Cs + w·(Ct−Cs) + d·n`, which equals the original bend exactly. Sign
 * convention: positive distance = LEFT of travel, `n = (−uy, ux)` in y-down
 * screen space (the piece pr-viz flags as the easy one to invert).
 */
export function projectRoute(pts: Pt[], cs: Pt, ct: Pt): EdgeRouting | undefined {
  if (pts.length < 2) return undefined;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const bends = pts.slice(1, -1);
  const ax = ct.x - cs.x;
  const ay = ct.y - cs.y;
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L;
  const uy = ay / L;
  const nx = -uy;
  const ny = ux;
  const w: number[] = [];
  const d: number[] = [];
  for (const b of bends) {
    const dx = b.x - cs.x;
    const dy = b.y - cs.y;
    // Keep the along-axis weight at full precision: it's a 0–1 fraction scaled
    // back up by the axis length (hundreds of px), so even 2-decimal rounding
    // would drift the bend by multiple pixels. The perpendicular is already in px.
    w.push((dx * ux + dy * uy) / L);
    d.push(round2(dx * nx + dy * ny));
  }
  return {
    se: `${round2(start.x - cs.x)}px ${round2(start.y - cs.y)}px`,
    te: `${round2(end.x - ct.x)}px ${round2(end.y - ct.y)}px`,
    w,
    d,
  };
}

export function edgeRoutingFor(
  e: LayoutResult["edges"][number],
  centers: Map<string, Pt> | null,
): EdgeRouting | undefined {
  if (!centers) return undefined;
  const route = edgeRouteOf(e);
  const cs = centers.get(e.srcId);
  const ct = centers.get(e.dstId);
  if (!route || !cs || !ct) return undefined;
  return projectRoute(route, cs, ct);
}

// Routing is only meaningful for the collapsed package graph, which the client
// lays out from ELK's precomputed positions (a `preset`). The file-level graph
// is re-laid-out by cose-bilkent, so ELK's route coordinates wouldn't align —
// return null there and let the client's taxi/bezier fallback handle it.
export function packageGraphCenters(layout: LayoutResult): Map<string, Pt> | null {
  if (layout.nodes.length === 0) return null;
  if (!layout.nodes.every((n) => n.kind === "package")) return null;
  const centers = new Map<string, Pt>();
  for (const n of layout.nodes) centers.set(n.id, { x: n.x, y: n.y });
  return centers;
}
