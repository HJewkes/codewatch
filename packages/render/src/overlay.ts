import type { GraphMetric, GraphNode } from "@codewatch/graph";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;

export type MetricMap = Map<string, Map<string, number>>;

export interface NodeSize {
  width: number;
  height: number;
}

export interface OverlayResult {
  sizing: Map<string, NodeSize> | null;
  fills: Map<string, string> | null;
  sizeBy: string | null;
  colorBy: string | null;
}

export function buildMetricMap(metrics: readonly GraphMetric[]): MetricMap {
  const out: MetricMap = new Map();
  for (const m of metrics) {
    if (m.value === null) continue;
    let inner = out.get(m.nodeId);
    if (!inner) {
      inner = new Map();
      out.set(m.nodeId, inner);
    }
    inner.set(m.name, m.value);
  }
  return out;
}

function valuesFor(
  nodes: readonly GraphNode[],
  map: MetricMap,
  metric: string,
): { values: Array<number | undefined>; min: number; max: number } {
  const values = nodes.map((n) => map.get(n.id)?.get(metric));
  const present = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (present.length === 0) return { values, min: 0, max: 0 };
  return {
    values,
    min: Math.min(...present),
    max: Math.max(...present),
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const COLD: [number, number, number] = [38, 142, 105]; // #268e69 cool green
const MID: [number, number, number] = [220, 178, 86]; // #dcb256 amber
const HOT: [number, number, number] = [217, 87, 87]; // #d95757 red

function rampColor(t: number): string {
  // Two-segment ramp: cold→mid for [0, 0.5], mid→hot for [0.5, 1].
  if (t <= 0.5) return rgbToHex(lerpColor(COLD, MID, t * 2));
  return rgbToHex(lerpColor(MID, HOT, (t - 0.5) * 2));
}

function computeSizing(
  nodes: readonly GraphNode[],
  map: MetricMap,
  metric: string,
): Map<string, NodeSize> {
  const { values, min, max } = valuesFor(nodes, map, metric);
  const out = new Map<string, NodeSize>();
  nodes.forEach((n, i) => {
    const v = values[i];
    if (v === undefined) {
      out.set(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
      return;
    }
    const t = normalize(v, min, max);
    // Scale area linearly with value; width/height scale with sqrt to match.
    const scale = Math.sqrt(MIN_SCALE * MIN_SCALE + t * (MAX_SCALE * MAX_SCALE - MIN_SCALE * MIN_SCALE));
    out.set(n.id, {
      width: Math.round(NODE_WIDTH * scale),
      height: Math.round(NODE_HEIGHT * scale),
    });
  });
  return out;
}

function computeFills(
  nodes: readonly GraphNode[],
  map: MetricMap,
  metric: string,
): Map<string, string> {
  const { values, min, max } = valuesFor(nodes, map, metric);
  const out = new Map<string, string>();
  nodes.forEach((n, i) => {
    const v = values[i];
    if (v === undefined) return;
    const t = normalize(v, min, max);
    out.set(n.id, rampColor(t));
  });
  return out;
}

export function computeOverlays(
  nodes: readonly GraphNode[],
  metrics: readonly GraphMetric[] | undefined,
  options: { sizeBy?: string; colorBy?: string },
): OverlayResult {
  const result: OverlayResult = {
    sizing: null,
    fills: null,
    sizeBy: null,
    colorBy: null,
  };
  if (!metrics || metrics.length === 0) return result;
  const map = buildMetricMap(metrics);
  if (options.sizeBy) {
    result.sizing = computeSizing(nodes, map, options.sizeBy);
    result.sizeBy = options.sizeBy;
  }
  if (options.colorBy) {
    result.fills = computeFills(nodes, map, options.colorBy);
    result.colorBy = options.colorBy;
  }
  return result;
}

export { rampColor };
