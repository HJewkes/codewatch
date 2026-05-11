import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { computeLayout } from "./layout.js";
import { computeOverlays, type OverlayResult } from "./overlay.js";
import { inlineStyles } from "./template-styles.js";
import { clientScript } from "./template-script.js";
import type { LayoutResult, RenderInput, RenderOptions } from "./types.js";

const require = createRequire(import.meta.url);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeForScript(s: string): string {
  // Prevent </script> sequences in embedded JSON from terminating the script tag.
  return s.replace(/</g, "\\u003c");
}

async function loadCytoscapeBundle(): Promise<string> {
  const path = require.resolve("cytoscape/dist/cytoscape.min.js");
  return readFile(path, "utf8");
}

const KIND_COLORS: Record<string, string> = {
  file: "#4a6da7",
  module: "#6b5b95",
  package: "#b58860",
  symbol: "#87a96b",
  external: "#d97757",
};

const KIND_LABELS: Record<string, string> = {
  file: "File",
  module: "Module",
  package: "Package",
  symbol: "Symbol",
  external: "External",
};

const STATUS_COLORS: Record<string, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  renamed: "#06b6d4",
  unchanged: "#5a6573",
};

const STATUS_LABELS: Record<string, string> = {
  added: "Added",
  removed: "Removed",
  renamed: "Renamed",
  unchanged: "Unchanged",
};

const ROLE_COLORS: Record<string, string> = {
  test: "#7e76c2",
  fixture: "#9077a8",
  barrel: "#7c8794",
  types: "#3a8794",
  config: "#a08660",
  source: "#4a6da7",
};

const ROLE_LABELS: Record<string, string> = {
  test: "Test",
  fixture: "Fixture",
  barrel: "Barrel",
  types: "Types",
  config: "Config",
  source: "Source",
};

interface CytoscapeNodeData {
  id: string;
  label: string;
  kind: string;
  role?: string;
  tooltip: string;
  status: string;
  violation_severity?: "error" | "warning";
  violation_origin?: "new" | "carryover";
  width: number;
  height: number;
  overlay_fill?: string;
  raw: unknown;
}

type ViolationsByNode = Map<
  string,
  {
    error: number;
    warning: number;
    isCarryover: boolean;
    items: Array<{
      ruleId: string;
      severity: string;
      message: string;
      isCarryover: boolean;
    }>;
  }
>;

function buildViolationsMap(
  checkResult: RenderInput["checkResult"],
): ViolationsByNode {
  const out: ViolationsByNode = new Map();
  if (!checkResult) return out;
  for (const v of checkResult.violations) {
    let entry = out.get(v.nodeId);
    if (!entry) {
      entry = { error: 0, warning: 0, isCarryover: true, items: [] };
      out.set(v.nodeId, entry);
    }
    if (v.severity === "error") entry.error++;
    else entry.warning++;
    if (!v.isCarryover) entry.isCarryover = false;
    entry.items.push({
      ruleId: v.ruleId,
      severity: v.severity,
      message: v.message,
      isCarryover: v.isCarryover ?? false,
    });
  }
  return out;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  kind: string;
  status: string;
}

function baseFilename(id: string): string {
  return id.split("/").pop() ?? id;
}

function labelForNode(
  node: { id: string; kind: string; name: string },
): string {
  if (node.kind === "external") return node.name || node.id;
  if (node.kind === "file") return baseFilename(node.id);
  return node.name || baseFilename(node.id);
}

function buildCyData(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  fills: Map<string, string> | null,
  metricsByNode: Map<string, Record<string, number>>,
  metricsBeforeByNode: Map<string, Record<string, number>>,
  violationsByNode: ViolationsByNode,
): {
  nodes: Array<{ data: CytoscapeNodeData; position: { x: number; y: number } }>;
  edges: Array<{ data: CytoscapeEdgeData }>;
} {
  const nodes = layout.nodes.map((n) => {
    const status = diff?.nodeStatus[n.id] ?? "unchanged";
    const oldId = diff?.renames[n.id];
    const overlayFill = fills?.get(n.id);
    const metrics = metricsByNode.get(n.id) ?? {};
    const metricsBefore = metricsBeforeByNode.get(oldId ?? n.id) ?? {};
    const violation = violationsByNode.get(n.id);
    const violationSeverity: "error" | "warning" | undefined = violation
      ? violation.error > 0
        ? "error"
        : "warning"
      : undefined;
    const violationOrigin: "new" | "carryover" | undefined = violation
      ? violation.isCarryover
        ? "carryover"
        : "new"
      : undefined;
    return {
      data: {
        id: n.id,
        label: labelForNode(n),
        kind: n.kind,
        ...(n.role ? { role: n.role } : {}),
        tooltip: oldId ? `${oldId} → ${n.id}` : n.id,
        status,
        ...(violationSeverity ? { violation_severity: violationSeverity } : {}),
        ...(violationOrigin ? { violation_origin: violationOrigin } : {}),
        width: n.width,
        height: n.height,
        ...(overlayFill ? { overlay_fill: overlayFill } : {}),
        raw: {
          ...n,
          status,
          ...(oldId ? { oldId } : {}),
          metrics,
          ...(Object.keys(metricsBefore).length > 0
            ? { metricsBefore }
            : {}),
          ...(violation ? { violations: violation.items } : {}),
          width: n.width,
          height: n.height,
        },
      },
      position: { x: n.x, y: n.y },
    };
  });
  const edges = layout.edges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.srcId,
      target: e.dstId,
      kind: e.kind,
      status:
        diff?.edgeStatus[`${e.srcId} ${e.dstId} ${e.kind}`] ?? "unchanged",
    },
  }));
  return { nodes, edges };
}

function metricMapFromList(
  metrics: readonly { nodeId: string; name: string; value: number | null }[] | undefined,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!metrics) return out;
  for (const m of metrics) {
    if (m.value === null || !Number.isFinite(m.value)) continue;
    let inner = out.get(m.nodeId);
    if (!inner) {
      inner = {};
      out.set(m.nodeId, inner);
    }
    inner[m.name] = m.value;
  }
  return out;
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function chipButton(opts: {
  cls: string;
  attr: string;
  attrValue: string;
  swatchHtml: string;
  accent: string;
  label: string;
  count: number;
}): string {
  return (
    `<button type="button" class="chip ${opts.cls} active" ` +
    `${opts.attr}="${escapeHtml(opts.attrValue)}" data-accent ` +
    `style="--chip-accent:${opts.accent}">` +
    opts.swatchHtml +
    `<span class="name">${escapeHtml(opts.label)}</span>` +
    `<span class="count">${opts.count}</span>` +
    `</button>`
  );
}

function nodeKindChip(kind: string, count: number): string {
  const color = KIND_COLORS[kind] ?? "#5eead4";
  return chipButton({
    cls: "node-chip",
    attr: "data-kind",
    attrValue: kind,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: KIND_LABELS[kind] ?? kind,
    count,
  });
}

function edgeKindChip(kind: string, count: number): string {
  const swatchHtml =
    kind === "re-exports"
      ? `<i style="background:repeating-linear-gradient(90deg,#8a96a6 0 3px,transparent 3px 6px)"></i>`
      : `<i style="background:#8a96a6"></i>`;
  return chipButton({
    cls: "edge-chip",
    attr: "data-edge-kind",
    attrValue: kind,
    swatchHtml,
    accent: "#8a96a6",
    label: kind,
    count,
  });
}

function statusChip(status: string, count: number): string {
  const color = STATUS_COLORS[status] ?? "#5eead4";
  return chipButton({
    cls: "status-chip",
    attr: "data-status",
    attrValue: status,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: STATUS_LABELS[status] ?? status,
    count,
  });
}

function roleChip(role: string, count: number): string {
  const color = ROLE_COLORS[role] ?? "#5eead4";
  return chipButton({
    cls: "role-chip",
    attr: "data-role",
    attrValue: role,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: ROLE_LABELS[role] ?? role,
    count,
  });
}

function statusGroupHtml(diff: RenderInput["diff"], layout: LayoutResult): string {
  if (!diff) return "";
  const counts: Record<string, number> = {
    added: 0,
    removed: 0,
    renamed: 0,
    unchanged: 0,
  };
  for (const n of layout.nodes) {
    const s = diff.nodeStatus[n.id] ?? "unchanged";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const chips = ["added", "removed", "renamed", "unchanged"]
    .filter((s) => counts[s]! > 0)
    .map((s) => statusChip(s, counts[s]!))
    .join("");
  return `<div class="group" aria-label="Diff status"><span class="group-label">Status</span>${chips}</div>`;
}

function violationGroupHtml(checkResult: RenderInput["checkResult"]): string {
  if (!checkResult || checkResult.violations.length === 0) return "";
  const counts = new Map<string, number>();
  for (const v of checkResult.violations) {
    counts.set(v.ruleId, (counts.get(v.ruleId) ?? 0) + 1);
  }
  const items = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, count]) =>
      chipButton({
        cls: "violation-chip",
        attr: "data-rule",
        attrValue: ruleId,
        swatchHtml: `<i style="background:#ef4444"></i>`,
        accent: "#ef4444",
        label: ruleId,
        count,
      }),
    )
    .join("");
  return `<div class="group" aria-label="Violations"><span class="group-label">Violations</span>${items}</div>`;
}

function roleGroupHtml(layout: LayoutResult): string {
  const counts = new Map<string, number>();
  for (const n of layout.nodes) {
    if (!n.role) continue;
    counts.set(n.role, (counts.get(n.role) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  const items = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => roleChip(role, count))
    .join("");
  return `<div class="group" aria-label="Role"><span class="group-label">Role</span>${items}</div>`;
}

function toolbarHtml(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  checkResult: RenderInput["checkResult"],
): string {
  const groupHtml = (
    label: string,
    counts: Map<string, number>,
    chip: (k: string, c: number) => string,
  ): string => {
    const items = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => chip(k, c))
      .join("");
    return `<div class="group" aria-label="${label} kinds"><span class="group-label">${label}</span>${items}</div>`;
  };
  const nodeGroup = groupHtml(
    "Node",
    countBy(layout.nodes, (n) => n.kind),
    nodeKindChip,
  );
  const edgeGroup = groupHtml(
    "Edge",
    countBy(layout.edges, (e) => e.kind),
    edgeKindChip,
  );
  return `<div class="toolbar" role="toolbar" aria-label="Graph filters">
  ${nodeGroup}
  ${roleGroupHtml(layout)}
  ${edgeGroup}
  ${statusGroupHtml(diff, layout)}
  ${violationGroupHtml(checkResult)}
  <div class="spacer"></div>
  <button type="button" class="btn" id="reset-view" title="Fit graph to viewport (Esc)">Reset view</button>
</div>`;
}

function checkBadgeHtml(checkResult: RenderInput["checkResult"]): string {
  if (!checkResult) return "";
  const errors =
    checkResult.newErrors + checkResult.carryoverErrors;
  const warnings =
    checkResult.newWarnings + checkResult.carryoverWarnings;
  if (errors === 0 && warnings === 0) {
    return `<span class="overlay-badge" style="background:#26543e;color:#86efac">✓ rules pass</span>`;
  }
  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`<span class="overlay-badge" style="background:#5a2a2a;color:#fca5a5">${errors} error(s)</span>`);
  }
  if (warnings > 0) {
    parts.push(`<span class="overlay-badge" style="background:#5a4a2a;color:#fcd34d">${warnings} warning(s)</span>`);
  }
  return parts.join(" ");
}

interface HtmlContext {
  bundle: string;
  graphJson: string;
  title: string;
  subtitle: string;
  overlayBadge: string;
  diffSummary: string;
  toolbar: string;
  nodeCount: number;
  edgeCount: number;
}

function buildHtml(ctx: HtmlContext): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(ctx.title)}</title>
<style>${inlineStyles()}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(ctx.title)}</h1>
  <span class="subtitle">${escapeHtml(ctx.subtitle)}</span>
  ${ctx.overlayBadge}
  ${ctx.diffSummary}
  <input id="search" class="search" type="search" placeholder="Filter by id substring..." />
</header>
${ctx.toolbar}
<main>
  <div id="cy" role="img" aria-label="Dependency graph"></div>
  <aside id="panel" aria-live="polite"></aside>
</main>
<footer>${ctx.nodeCount} nodes · ${ctx.edgeCount} edges · rendered with cytoscape.js</footer>
<script>${ctx.bundle}</script>
<script>window.__GRAPH__ = ${escapeForScript(ctx.graphJson)};</script>
<script>${clientScript(KIND_COLORS)}</script>
</body>
</html>`;
}

function shortSha(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 7) : "—";
}

function diffSubtitle(input: RenderInput): string {
  if (!input.diff) {
    return `${input.nodes.length} nodes · ${input.edges.length} edges`;
  }
  const { fromSnapshot, toSnapshot } = input.diff;
  return (
    `${fromSnapshot.ref}@${shortSha(fromSnapshot.commitHash)}` +
    ` → ${toSnapshot.ref}@${shortSha(toSnapshot.commitHash)}`
  );
}

function diffSummaryHtml(input: RenderInput): string {
  if (!input.diff) return "";
  const s = input.diff.summary;
  const parts: string[] = [];
  if (s.addedNodes) parts.push(`<span class="added">+${s.addedNodes}</span>`);
  if (s.removedNodes) parts.push(`<span class="removed">−${s.removedNodes}</span>`);
  if (s.renamedNodes) parts.push(`<span class="renamed">~${s.renamedNodes}</span>`);
  if (s.addedEdges || s.removedEdges) {
    parts.push(
      `<span class="dim">edges +${s.addedEdges} −${s.removedEdges}</span>`,
    );
  }
  if (parts.length === 0) return "";
  return `<span class="diff-summary">${parts.join(" ")}</span>`;
}

function overlayBadgeHtml(overlay: OverlayResult): string {
  const parts: string[] = [];
  if (overlay.sizeBy) {
    parts.push(`<span class="overlay-badge">size: ${escapeHtml(overlay.sizeBy)}</span>`);
  }
  if (overlay.colorBy) {
    parts.push(`<span class="overlay-badge">color: ${escapeHtml(overlay.colorBy)}</span>`);
  }
  return parts.join(" ");
}

export async function renderHtml(
  input: RenderInput,
  options: RenderOptions = {},
): Promise<string> {
  const overlay = computeOverlays(input.nodes, input.metrics, {
    sizeBy: options.sizeBy,
    colorBy: options.colorBy,
  });
  const layout = await computeLayout(input, overlay.sizing);
  const bundle = await loadCytoscapeBundle();
  const metricsByNode = metricMapFromList(input.metrics);
  const metricsBeforeByNode = metricMapFromList(input.diff?.metricsBefore);
  const violationsByNode = buildViolationsMap(input.checkResult);
  const cy = buildCyData(
    layout,
    input.diff,
    overlay.fills,
    metricsByNode,
    metricsBeforeByNode,
    violationsByNode,
  );
  const graphJson = JSON.stringify({
    snapshotId: input.snapshotId,
    nodes: cy.nodes,
    edges: cy.edges,
  });
  return buildHtml({
    bundle,
    graphJson,
    title: options.title ?? (input.diff ? "codewatch diff" : "codewatch graph"),
    subtitle: options.subtitle ?? diffSubtitle(input),
    overlayBadge:
      overlayBadgeHtml(overlay) + " " + checkBadgeHtml(input.checkResult),
    diffSummary: diffSummaryHtml(input),
    toolbar: toolbarHtml(layout, input.diff, input.checkResult),
    nodeCount: input.nodes.length,
    edgeCount: input.edges.length,
  });
}
