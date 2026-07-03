import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { computeLayout, FOCUS_LAYOUT_OPTIONS } from "./layout.js";
import { computeOverlays, type OverlayResult } from "./overlay.js";
import { inlineStyles } from "./template-styles.js";
import { clientScript } from "./template-script.js";
import { loadLayoutBundles, type LayoutBundles } from "./template-layout-bundles.js";
import {
  KIND_COLORS,
  KIND_LABELS,
  ROLE_COLORS,
  ROLE_LABELS,
  escapeHtml,
  toolbarHtml,
} from "./template-toolbar.js";
import {
  buildCheckDiffSummary,
  buildViolationsMap,
  checkBadgeHtml,
} from "./template-violations.js";
import { buildCyData, metricMapFromList } from "./template-cy-data.js";
import type { RenderInput, RenderOptions } from "./types.js";

const require = createRequire(import.meta.url);

function escapeForScript(s: string): string {
  // Prevent </script> sequences in embedded JSON from terminating the script tag.
  return s.replace(/</g, "\\u003c");
}

async function loadCytoscapeBundle(): Promise<string> {
  const path = require.resolve("cytoscape/dist/cytoscape.min.js");
  return readFile(path, "utf8");
}

interface HtmlContext {
  bundle: string;
  layoutBundles: LayoutBundles;
  graphJson: string;
  /** JSON of the baked view list (multi-view graphs only). */
  viewsJson?: string;
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
<script>${ctx.layoutBundles.layoutBase}</script>
<script>${ctx.layoutBundles.coseBase}</script>
<script>${ctx.layoutBundles.coseBilkent}</script>
<script>window.__GRAPH__ = ${escapeForScript(ctx.graphJson)};</script>
${ctx.viewsJson ? `<script>window.__GRAPH_VIEWS__ = ${escapeForScript(ctx.viewsJson)};</script>` : ""}
<script>${clientScript({ kindColors: KIND_COLORS, kindLabels: KIND_LABELS, roleColors: ROLE_COLORS, roleLabels: ROLE_LABELS })}</script>
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
  const layout = await computeLayout(
    input,
    overlay.sizing,
    options.flat ? FOCUS_LAYOUT_OPTIONS : undefined,
  );
  const [bundle, layoutBundles] = await Promise.all([
    loadCytoscapeBundle(),
    loadLayoutBundles(),
  ]);
  const metricsByNode = metricMapFromList(input.metrics);
  const metricsBeforeByNode = metricMapFromList(input.diff?.metricsBefore);
  const violationsByNode = buildViolationsMap(input.checkResult);
  const diffSummary = buildCheckDiffSummary(input.checkDiff);
  const cy = buildCyData(
    layout,
    input.diff,
    overlay.fills,
    metricsByNode,
    metricsBeforeByNode,
    violationsByNode,
    diffSummary,
    { flat: options.flat },
  );
  const graphJson = JSON.stringify({
    snapshotId: input.snapshotId,
    nodes: cy.nodes,
    edges: cy.edges,
  });
  return buildHtml({
    bundle,
    layoutBundles,
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

export interface GraphView {
  id: string;
  label: string;
  input: RenderInput;
  /** Flat (focus) view — no compound package parents, uses the focus layout. */
  flat?: boolean;
}

/**
 * Render a single self-contained graph HTML that bakes several views (e.g. a
 * package overview + one within-package focus view per package) and lets a
 * toolbar picker switch between them client-side. One Cytoscape bundle is shared
 * across all views — far smaller than one full HTML per view — and each view's
 * ELK layout + orthogonal routing is precomputed here, so switching is instant.
 * The first view is the default shown on load.
 */
export async function renderMultiViewHtml(
  views: GraphView[],
  options: RenderOptions = {},
): Promise<string> {
  if (views.length === 0) throw new Error("renderMultiViewHtml: no views");
  const [bundle, layoutBundles] = await Promise.all([
    loadCytoscapeBundle(),
    loadLayoutBundles(),
  ]);
  const built = [];
  for (const v of views) {
    const overlay = computeOverlays(v.input.nodes, v.input.metrics, {
      sizeBy: options.sizeBy,
      colorBy: options.colorBy,
    });
    const layout = await computeLayout(
      v.input,
      overlay.sizing,
      v.flat ? FOCUS_LAYOUT_OPTIONS : undefined,
    );
    const cy = buildCyData(
      layout,
      undefined,
      overlay.fills,
      metricMapFromList(v.input.metrics),
      new Map(),
      buildViolationsMap(undefined),
      buildCheckDiffSummary(undefined),
      { flat: v.flat },
    );
    built.push({
      id: v.id,
      label: v.label,
      layout,
      graph: { snapshotId: v.input.snapshotId, nodes: cy.nodes, edges: cy.edges },
    });
  }
  const primary = built[0];
  const viewMeta = built.map((b) => ({ id: b.id, label: b.label }));
  return buildHtml({
    bundle,
    layoutBundles,
    graphJson: JSON.stringify(primary.graph),
    viewsJson: JSON.stringify(built.map((b) => ({ id: b.id, label: b.label, graph: b.graph }))),
    title: options.title ?? "codewatch graph",
    subtitle: options.subtitle ?? `${primary.layout.nodes.length} nodes · ${primary.layout.edges.length} edges`,
    overlayBadge: "",
    diffSummary: "",
    toolbar: toolbarHtml(primary.layout, undefined, undefined, viewMeta),
    nodeCount: primary.layout.nodes.length,
    edgeCount: primary.layout.edges.length,
  });
}
