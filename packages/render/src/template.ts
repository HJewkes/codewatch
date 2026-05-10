import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { computeLayout } from "./layout.js";
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

function inlineStyles(): string {
  return `
:root {
  --bg: #0f1419;
  --bg-elev: #161c24;
  --bg-elev-2: #1f2730;
  --border: #2a333f;
  --text: #d7dee8;
  --text-dim: #8a96a6;
  --text-faint: #5a6573;
  --accent: #5eead4;
  --accent-soft: rgba(94,234,212,0.18);
  --kind-file: #4a6da7;
  --kind-module: #6b5b95;
  --kind-package: #b58860;
  --kind-symbol: #87a96b;
  --kind-external: #d97757;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100vh;
}
header {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  display: flex;
  align-items: baseline;
  gap: 16px;
}
header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.2px; }
header .subtitle { color: var(--text-dim); font-size: 13px; }
header .search {
  margin-left: auto;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text);
  font-size: 13px;
  width: 260px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
header .search:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.toolbar .group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.toolbar .group-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-faint);
  margin-right: 2px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease;
}
.chip i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
  background: var(--accent);
}
.chip.edge-chip i {
  width: 14px;
  height: 2px;
  border-radius: 0;
}
.chip .count {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.chip.active {
  background: var(--bg-elev);
}
.chip.active[data-accent] {
  border-color: var(--chip-accent, var(--accent));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chip-accent, var(--accent)) 22%, transparent);
}
.chip.inactive {
  opacity: 0.45;
  color: var(--text-dim);
}
.toolbar .spacer { flex: 1; }
.toolbar button.btn {
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.toolbar button.btn:hover { border-color: var(--accent); }
main {
  display: grid;
  grid-template-columns: 1fr 320px;
  min-height: 0;
}
#cy {
  width: 100%;
  height: 100%;
  background:
    radial-gradient(1200px 600px at 50% -20%, rgba(94,234,212,0.04), transparent 60%),
    var(--bg);
}
aside {
  border-left: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
}
aside h2 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-dim);
  font-weight: 600;
}
aside .empty { color: var(--text-faint); font-style: italic; }
aside .node-id {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
  margin-bottom: 6px;
}
aside .row { display: flex; gap: 6px; margin: 2px 0; }
aside .row .k { color: var(--text-dim); min-width: 72px; }
aside .row .v { color: var(--text); }
aside .row .v.num { font-variant-numeric: tabular-nums; }
aside .actions {
  margin-top: 6px;
  display: flex;
  gap: 10px;
}
aside .actions a {
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px dotted var(--accent);
}
aside .actions a:hover { color: var(--text); border-bottom-color: var(--text); }
aside ul.neighbors {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
aside ul.neighbors li {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  padding: 2px 0;
  color: var(--text);
  cursor: pointer;
  word-break: break-all;
}
aside ul.neighbors li:hover { color: var(--accent); }
aside pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11.5px;
  color: var(--text);
  overflow-x: auto;
  margin: 8px 0 0;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
footer {
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 8px 24px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}
`;
}

interface CytoscapeNodeData {
  id: string;
  label: string;
  kind: string;
  tooltip: string;
  raw: unknown;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  kind: string;
}

function baseFilename(id: string): string {
  const last = id.split("/").pop() ?? id;
  return last;
}

function labelForNode(
  node: { id: string; kind: string; name: string },
): string {
  if (node.kind === "external") return node.name || node.id;
  if (node.kind === "file") return baseFilename(node.id);
  return node.name || baseFilename(node.id);
}

function buildCyData(layout: LayoutResult): {
  nodes: Array<{ data: CytoscapeNodeData; position: { x: number; y: number } }>;
  edges: Array<{ data: CytoscapeEdgeData }>;
} {
  const nodes = layout.nodes.map((n) => ({
    data: {
      id: n.id,
      label: labelForNode(n),
      kind: n.kind,
      tooltip: n.id,
      raw: n,
    },
    position: { x: n.x, y: n.y },
  }));
  const edges = layout.edges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.srcId,
      target: e.dstId,
      kind: e.kind,
    },
  }));
  return { nodes, edges };
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function nodeKindChip(
  kind: string,
  count: number,
): string {
  const label = KIND_LABELS[kind] ?? kind;
  const color = KIND_COLORS[kind] ?? "#5eead4";
  return (
    `<button type="button" class="chip node-chip active" ` +
    `data-kind="${escapeHtml(kind)}" data-accent ` +
    `style="--chip-accent:${color}">` +
    `<i style="background:${color}"></i>` +
    `<span class="name">${escapeHtml(label)}</span>` +
    `<span class="count">${count}</span>` +
    `</button>`
  );
}

function edgeKindChip(kind: string, count: number): string {
  const dashed = kind === "re-exports";
  const swatch = dashed
    ? `<i style="background:repeating-linear-gradient(90deg,#8a96a6 0 3px,transparent 3px 6px)"></i>`
    : `<i style="background:#8a96a6"></i>`;
  return (
    `<button type="button" class="chip edge-chip active" ` +
    `data-edge-kind="${escapeHtml(kind)}" data-accent ` +
    `style="--chip-accent:#8a96a6">` +
    swatch +
    `<span class="name">${escapeHtml(kind)}</span>` +
    `<span class="count">${count}</span>` +
    `</button>`
  );
}

function toolbarHtml(layout: LayoutResult): string {
  const nodeCounts = countBy(layout.nodes, (n) => n.kind);
  const edgeCounts = countBy(layout.edges, (e) => e.kind);
  const nodeChips = Array.from(nodeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => nodeKindChip(k, c))
    .join("");
  const edgeChips = Array.from(edgeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => edgeKindChip(k, c))
    .join("");
  return `<div class="toolbar" role="toolbar" aria-label="Graph filters">
  <div class="group" aria-label="Node kinds"><span class="group-label">Nodes</span>${nodeChips}</div>
  <div class="group" aria-label="Edge kinds"><span class="group-label">Edges</span>${edgeChips}</div>
  <div class="spacer"></div>
  <button type="button" class="btn" id="reset-view" title="Fit graph to viewport (Esc)">Reset view</button>
</div>`;
}

function cyStyles(): string {
  return `[
    { selector: "node", style: {
      "background-color": "data(fill)",
      "shape": "round-rectangle",
      "width": 180, "height": 48,
      "label": "data(label)",
      "color": "#d7dee8",
      "font-family": "-apple-system, system-ui, sans-serif",
      "font-size": 13,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "ellipsis",
      "text-max-width": 160,
      "text-outline-color": "#0f1419",
      "text-outline-width": 1.5,
      "text-outline-opacity": 0.85,
      "border-width": 1,
      "border-color": "#2a333f",
      "transition-property": "opacity, border-color, overlay-opacity",
      "transition-duration": "120ms",
      "transition-timing-function": "ease-in-out"
    } },
    { selector: "node[kind = 'module']", style: {
      "width": 150, "height": 40, "opacity": 0.9,
      "font-size": 12
    } },
    { selector: "node[kind = 'external']", style: {
      "shape": "octagon",
      "background-color": "#d97757",
      "color": "#1a1410",
      "text-outline-color": "#1a1410",
      "text-outline-opacity": 0.4
    } },
    { selector: "node[kind = 'package']", style: {
      "shape": "round-tag"
    } },
    { selector: "node:selected", style: {
      "overlay-color": "#5eead4",
      "overlay-padding": 6,
      "overlay-opacity": 0.25
    } },
    { selector: ".faded", style: { "opacity": 0.15 } },
    { selector: ".kind-hidden", style: { "opacity": 0.05 } },
    { selector: ".highlight", style: {
      "overlay-color": "#5eead4",
      "overlay-padding": 5,
      "overlay-opacity": 0.18
    } },
    { selector: "edge", style: {
      "curve-style": "bezier",
      "width": 1.2,
      "line-color": "#3a4452",
      "target-arrow-color": "#3a4452",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "opacity": 0.7,
      "transition-property": "opacity, line-color, target-arrow-color, width",
      "transition-duration": "120ms"
    } },
    { selector: "edge[kind = 're-exports']", style: {
      "line-style": "dashed"
    } },
    { selector: "edge.faded", style: { "opacity": 0.05 } },
    { selector: "edge.kind-hidden", style: { "opacity": 0.05 } },
    { selector: "edge.highlight", style: {
      "line-color": "#5eead4",
      "target-arrow-color": "#5eead4",
      "width": 2.2,
      "opacity": 1
    } }
  ]`;
}

function clientScript(): string {
  // The client-side runtime. Kept in a string so the build emits a single HTML.
  // Split into discrete IIFE-scoped helpers; cytoscape and DOM are globals here.
  return `
(function () {
  const data = window.__GRAPH__;
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: { nodes: data.nodes, edges: data.edges },
    layout: { name: "preset" },
    minZoom: 0.1,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    style: ${cyStyles()}
  });
  const KIND_FILL = ${JSON.stringify(KIND_COLORS)};
  cy.nodes().forEach(function (n) {
    n.data("fill", KIND_FILL[n.data("kind")] || "#4a6da7");
  });
  cy.ready(function () { cy.fit(undefined, 50); });

  const panel = document.getElementById("panel");
  const hiddenNodeKinds = new Set();
  const hiddenEdgeKinds = new Set();

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderRow(k, v, cls) {
    const vClass = cls ? ' class="v ' + cls + '"' : ' class="v"';
    return '<div class="row"><div class="k">' + k + '</div><div' + vClass + '>' + v + '</div></div>';
  }
  function showEmpty() {
    panel.innerHTML = '<h2>Selection</h2><div class="empty">Click a node to see details.</div>';
  }
  function neighborsOf(nodeId) {
    const inbound = [];
    const outbound = [];
    cy.edges().forEach(function (e) {
      if (e.data("target") === nodeId) inbound.push(e.data("source"));
      if (e.data("source") === nodeId) outbound.push(e.data("target"));
    });
    return { inbound: inbound, outbound: outbound };
  }
  function neighborListHtml(ids, dataAttr) {
    if (!ids.length) return '';
    const top = ids.slice(0, 5);
    return '<ul class="neighbors">' + top.map(function (id) {
      return '<li ' + dataAttr + '="' + escapeHtml(id) + '">' + escapeHtml(id) + '</li>';
    }).join('') + '</ul>';
  }
  function attrsBlock(attrs) {
    if (!attrs || !Object.keys(attrs).length) return '';
    return '<h2 style="margin-top:14px">Attributes</h2><pre>' +
      escapeHtml(JSON.stringify(attrs, null, 2)) + '</pre>';
  }
  function showNode(raw) {
    const nb = neighborsOf(raw.id);
    panel.innerHTML =
      '<h2>Node</h2>' +
      '<div class="node-id">' + escapeHtml(raw.id) + '</div>' +
      renderRow("kind", escapeHtml(raw.kind)) +
      (raw.language ? renderRow("language", escapeHtml(raw.language)) : "") +
      (raw.name ? renderRow("name", escapeHtml(raw.name)) : "") +
      (raw.parentId ? renderRow("parent", escapeHtml(raw.parentId)) : "") +
      renderRow("Fan-in", String(nb.inbound.length), "num") +
      renderRow("Fan-out", String(nb.outbound.length), "num") +
      '<div class="actions"><a data-action="show-neighbors">Show neighbors</a></div>' +
      (nb.inbound.length ? '<h2 style="margin-top:14px">Top inbound</h2>' +
        neighborListHtml(nb.inbound, 'data-neighbor') : '') +
      (nb.outbound.length ? '<h2 style="margin-top:14px">Top outbound</h2>' +
        neighborListHtml(nb.outbound, 'data-neighbor') : '') +
      attrsBlock(raw.attrs);
  }
  showEmpty();

  function clearHighlights() {
    cy.elements().removeClass("highlight").removeClass("faded");
  }
  function highlightNeighborhood(node) {
    const neighborhood = node.closedNeighborhood();
    cy.elements().not(neighborhood).addClass("faded");
    neighborhood.removeClass("faded");
    neighborhood.addClass("highlight");
  }
  function selectNodeById(id) {
    const n = cy.getElementById(id);
    if (!n || n.empty()) return;
    cy.elements().unselect();
    n.select();
    showNode(n.data("raw"));
    clearHighlights();
    highlightNeighborhood(n);
    cy.animate({ center: { eles: n }, duration: 220 });
  }

  cy.on("tap", "node", function (evt) {
    const n = evt.target;
    showNode(n.data("raw"));
    clearHighlights();
    highlightNeighborhood(n);
  });
  cy.on("tap", function (evt) {
    if (evt.target === cy) {
      cy.elements().unselect();
      clearHighlights();
      showEmpty();
    }
  });
  panel.addEventListener("click", function (evt) {
    const t = evt.target;
    if (t && t.getAttribute("data-action") === "show-neighbors") {
      const sel = cy.$("node:selected");
      if (sel.length) highlightNeighborhood(sel);
      return;
    }
    const nid = t && t.getAttribute && t.getAttribute("data-neighbor");
    if (nid) selectNodeById(nid);
  });

  function applyKindVisibility() {
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        if (hiddenNodeKinds.has(n.data("kind"))) n.addClass("kind-hidden");
        else n.removeClass("kind-hidden");
      });
      cy.edges().forEach(function (e) {
        if (hiddenEdgeKinds.has(e.data("kind"))) e.addClass("kind-hidden");
        else e.removeClass("kind-hidden");
      });
    });
  }
  function bindChips() {
    document.querySelectorAll(".chip.node-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const kind = chip.getAttribute("data-kind");
        if (hiddenNodeKinds.has(kind)) {
          hiddenNodeKinds.delete(kind); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenNodeKinds.add(kind); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
    document.querySelectorAll(".chip.edge-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const kind = chip.getAttribute("data-edge-kind");
        if (hiddenEdgeKinds.has(kind)) {
          hiddenEdgeKinds.delete(kind); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenEdgeKinds.add(kind); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
  }
  bindChips();

  const resetBtn = document.getElementById("reset-view");
  resetBtn.addEventListener("click", function () {
    cy.elements().unselect();
    clearHighlights();
    showEmpty();
    cy.fit(undefined, 50);
  });
  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape") {
      cy.elements().unselect();
      clearHighlights();
      showEmpty();
      cy.fit(undefined, 50);
    }
  });

  const search = document.getElementById("search");
  search.addEventListener("input", function () {
    const q = search.value.trim().toLowerCase();
    if (!q) { clearHighlights(); return; }
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        const matches = n.data("id").toLowerCase().indexOf(q) !== -1;
        if (matches) n.removeClass("faded"); else n.addClass("faded");
      });
      cy.edges().addClass("faded");
    });
  });
})();
`;
}

interface HtmlContext {
  bundle: string;
  graphJson: string;
  title: string;
  subtitle: string;
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
<script>${clientScript()}</script>
</body>
</html>`;
}

export async function renderHtml(
  input: RenderInput,
  options: RenderOptions = {},
): Promise<string> {
  const layout = await computeLayout(input);
  const bundle = await loadCytoscapeBundle();
  const cy = buildCyData(layout);
  const graphJson = JSON.stringify({
    snapshotId: input.snapshotId,
    nodes: cy.nodes,
    edges: cy.edges,
  });
  return buildHtml({
    bundle,
    graphJson,
    title: options.title ?? "codewatch graph",
    subtitle:
      options.subtitle ??
      `${input.nodes.length} nodes · ${input.edges.length} edges`,
    toolbar: toolbarHtml(layout),
    nodeCount: input.nodes.length,
    edgeCount: input.edges.length,
  });
}
