import type { LaidOutNode, LayoutResult, RenderInput } from "./types.js";
import type { DiffSummary, ViolationsByNode } from "./template-violations.js";
import {
  edgeRoutingFor,
  elkPresetCenters,
  type EdgeRouting,
  type Pt,
} from "./edge-routing.js";

interface CytoscapeNodeData {
  id: string;
  label: string;
  kind: string;
  role?: string;
  parent?: string;
  tooltip: string;
  status: string;
  violation_severity?: "error" | "warning";
  violation_origin?: "new" | "carryover";
  violation_trend?: "worsened" | "improved";
  resolved_count?: number;
  width: number;
  height: number;
  overlay_fill?: string;
  raw: unknown;
}

export const EXTERNAL_PARENT_ID = "pkg:external";

// The package a file belongs to. In a `packages/<name>/…` monorepo the package
// is the second segment (every file's first segment is just `packages`), so nest
// files into per-package boxes rather than one giant `packages` box. Mirrors the
// client's `pkgOfId` so compound parents and package colors agree.
function packageFromInternalId(id: string): string | undefined {
  const monorepo = /^packages\/([^/]+)/.exec(id);
  const seg = monorepo ? monorepo[1] : id.split("/")[0];
  return seg ? `pkg:${seg}` : undefined;
}

export function packageIdFor(node: { id: string; kind: string }): string | undefined {
  if (node.kind === "external") return EXTERNAL_PARENT_ID;
  if (node.kind === "package") return undefined;
  return packageFromInternalId(node.id);
}

function packageLabelFor(pkgId: string): string {
  if (pkgId === EXTERNAL_PARENT_ID) return "external deps";
  return pkgId.replace(/^pkg:/, "");
}

function packageEntry(pkg: string): { data: CytoscapeNodeData } {
  // Width/height are hints for non-compound layout; cytoscape sizes compound
  // parents by their children's bounding box regardless.
  return {
    data: {
      id: pkg,
      label: packageLabelFor(pkg),
      kind: "package",
      tooltip: pkg,
      status: "unchanged",
      width: 180,
      height: 48,
      raw: { id: pkg, kind: "package", name: packageLabelFor(pkg) },
    },
  };
}

function synthesizePackageEntries(
  layout: LayoutResult,
): Array<{ data: CytoscapeNodeData }> {
  const seen = new Set<string>();
  const out: Array<{ data: CytoscapeNodeData }> = [];
  layout.nodes.forEach((n) => {
    const pkg = packageIdFor(n);
    if (!pkg || seen.has(pkg)) return;
    seen.add(pkg);
    out.push(packageEntry(pkg));
  });
  return out;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  kind: string;
  status: string;
  weight?: number;
  width: number;
  label: string;
  routing?: EdgeRouting;
}

const BASE_EDGE_WIDTH = 1.2;
const MAX_EDGE_WIDTH = 8;

function edgeWeightOf(e: { attrs?: Record<string, unknown> }): number | undefined {
  const w = e.attrs?.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : undefined;
}

// Perceptual (sqrt) scale: a 15×-heavier package dependency reads as ~5× thicker,
// not 15×. Weightless edges (the file-level graph, where attrs.weight is absent)
// keep the base hairline.
function edgeWidthFor(weight: number | undefined): number {
  if (weight === undefined || weight <= 1) return BASE_EDGE_WIDTH;
  return Math.min(BASE_EDGE_WIDTH + 1.5 * Math.sqrt(weight - 1), MAX_EDGE_WIDTH);
}

interface NodeAssemblyContext {
  diff: RenderInput["diff"];
  fills: Map<string, string> | null;
  metricsByNode: Map<string, Record<string, number>>;
  metricsBeforeByNode: Map<string, Record<string, number>>;
  violationsByNode: ViolationsByNode;
  diffSummary: DiffSummary;
  /** Skip compound package parents (within-package focus view). */
  flat?: boolean;
}

type Violation = ReturnType<ViolationsByNode["get"]>;
type ResolvedList = Array<{ ruleId: string; message: string }>;
type TrendList = Array<{ ruleId: string; before: number; after: number; delta: number }>;

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function baseFilename(id: string): string {
  return id.split("/").pop() ?? id;
}

function externalLabel(node: { id: string; name: string }): string {
  return node.name || node.id;
}

function symbolLabel(node: { id: string; name: string }): string {
  return node.name || baseFilename(node.id);
}

function labelForNode(
  node: { id: string; kind: string; name: string },
): string {
  if (node.kind === "file") return baseFilename(node.id);
  if (node.kind === "external") return externalLabel(node);
  return symbolLabel(node);
}

function isValidMetric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function recordMetric(
  out: Map<string, Record<string, number>>,
  m: { nodeId: string; name: string; value: number | null },
): void {
  if (!isValidMetric(m.value)) return;
  let inner = out.get(m.nodeId);
  if (!inner) {
    inner = {};
    out.set(m.nodeId, inner);
  }
  inner[m.name] = m.value;
}

export function metricMapFromList(
  metrics: readonly { nodeId: string; name: string; value: number | null }[] | undefined,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!metrics) return out;
  metrics.forEach((m) => recordMetric(out, m));
  return out;
}

function severityOf(v: Violation): "error" | "warning" | undefined {
  if (!v) return undefined;
  return v.error > 0 ? "error" : "warning";
}

function originOf(v: Violation): "new" | "carryover" | undefined {
  if (!v) return undefined;
  return v.isCarryover ? "carryover" : "new";
}

function resolvedCountOf(r: ResolvedList | undefined): number | undefined {
  return r && r.length > 0 ? r.length : undefined;
}

function violationFields(
  v: Violation,
  trend: "worsened" | "improved" | undefined,
  resolved: ResolvedList | undefined,
): Partial<CytoscapeNodeData> {
  return compact({
    violation_severity: severityOf(v),
    violation_origin: originOf(v),
    violation_trend: trend,
    resolved_count: resolvedCountOf(resolved),
  });
}

function rawExtras(
  oldId: string | undefined,
  metricsBefore: Record<string, number>,
  violation: Violation,
  resolved: ResolvedList | undefined,
  trendDetails: TrendList | undefined,
): Record<string, unknown> {
  const hasBefore = Object.keys(metricsBefore).length > 0;
  return compact({
    oldId,
    metricsBefore: hasBefore ? metricsBefore : undefined,
    violations: violation?.items,
    resolvedViolations: resolved,
    violationTrends: trendDetails,
  });
}

function tooltipFor(nodeId: string, oldId: string | undefined): string {
  return oldId ? `${oldId} → ${nodeId}` : nodeId;
}

function roleField(role: string | undefined): { role?: string } {
  return role ? { role } : {};
}

function parentField(parentPkg: string | undefined): { parent?: string } {
  return parentPkg ? { parent: parentPkg } : {};
}

function overlayFillField(fill: string | undefined): { overlay_fill?: string } {
  return fill ? { overlay_fill: fill } : {};
}

function buildNodeEntry(
  n: LaidOutNode,
  ctx: NodeAssemblyContext,
): { data: CytoscapeNodeData; position: { x: number; y: number } } {
  const { diff, fills, metricsByNode, metricsBeforeByNode, violationsByNode, diffSummary } = ctx;
  const status = diff?.nodeStatus[n.id] ?? "unchanged";
  const oldId = diff?.renames[n.id];
  const metrics = metricsByNode.get(n.id) ?? {};
  const metricsBefore = metricsBeforeByNode.get(oldId ?? n.id) ?? {};
  const violation = violationsByNode.get(n.id);
  const trend = diffSummary.trendByNode.get(n.id);
  const resolved = diffSummary.resolvedByNode.get(n.id);
  const trendDetails = diffSummary.trendDetailsByNode.get(n.id);
  return {
    data: {
      id: n.id,
      label: labelForNode(n),
      kind: n.kind,
      ...roleField(n.role),
      ...parentField(ctx.flat ? undefined : packageIdFor(n)),
      tooltip: tooltipFor(n.id, oldId),
      status,
      ...violationFields(violation, trend, resolved),
      width: n.width,
      height: n.height,
      ...overlayFillField(fills?.get(n.id)),
      raw: {
        ...n,
        status,
        metrics,
        width: n.width,
        height: n.height,
        ...rawExtras(oldId, metricsBefore, violation, resolved, trendDetails),
      },
    },
    position: { x: n.x, y: n.y },
  };
}

function buildEdgeEntry(
  e: LayoutResult["edges"][number],
  i: number,
  diff: RenderInput["diff"],
  centers: Map<string, Pt> | null,
): { data: CytoscapeEdgeData } {
  const weight = edgeWeightOf(e);
  const data: CytoscapeEdgeData = {
    id: `e${i}`,
    source: e.srcId,
    target: e.dstId,
    kind: e.kind,
    status: diff?.edgeStatus[`${e.srcId} ${e.dstId} ${e.kind}`] ?? "unchanged",
    width: edgeWidthFor(weight),
    // Annotate any edge whose weight exceeds 1 — both the aggregated package
    // graph and, since C-51, file-level import edges carrying a reference count.
    // A ×1 (or weightless) edge stays unlabelled to avoid clutter.
    label: weight !== undefined && weight > 1 ? `×${weight}` : "",
  };
  if (weight !== undefined) data.weight = weight;
  const routing = edgeRoutingFor(e, centers);
  if (routing) data.routing = routing;
  return { data };
}

export function buildCyData(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  fills: Map<string, string> | null,
  metricsByNode: Map<string, Record<string, number>>,
  metricsBeforeByNode: Map<string, Record<string, number>>,
  violationsByNode: ViolationsByNode,
  diffSummary: DiffSummary,
  opts: { flat?: boolean; compound?: boolean } = {},
): {
  nodes: Array<{ data: CytoscapeNodeData; position?: { x: number; y: number } }>;
  edges: Array<{ data: CytoscapeEdgeData }>;
} {
  const ctx: NodeAssemblyContext = {
    diff, fills, metricsByNode, metricsBeforeByNode, violationsByNode, diffSummary,
    // Flat mode (the within-package focus view) skips compound package parents so
    // the graph stays a flat DAG the client renders with elk-preset + routing.
    flat: opts.flat,
  };
  const packageEntries = opts.flat ? [] : synthesizePackageEntries(layout);
  const nodeEntries = layout.nodes.map((n) => buildNodeEntry(n, ctx));
  // The compound file graph keeps its package parents but is still laid out by
  // ELK (INCLUDE_CHILDREN), so its absolute leaf centers drive route projection.
  const centers = elkPresetCenters(layout, Boolean(opts.flat), Boolean(opts.compound));
  return {
    nodes: [...packageEntries, ...nodeEntries],
    edges: layout.edges.map((e, i) => buildEdgeEntry(e, i, diff, centers)),
  };
}
