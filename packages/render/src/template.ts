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
  grid-template-rows: auto 1fr auto;
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
  display: flex;
  gap: 18px;
  align-items: center;
  font-size: 12px;
  color: var(--text-dim);
}
footer .swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
footer .swatch i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
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

function clientScript(): string {
  // The client-side runtime. Kept in a string so the build emits a single HTML.
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
    style: [
      { selector: "node", style: {
        "background-color": "data(fill)",
        "shape": "round-rectangle",
        "width": 180, "height": 48,
        "label": "data(label)",
        "color": "#d7dee8",
        "font-family": "-apple-system, system-ui, sans-serif",
        "font-size": 12,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "ellipsis",
        "text-max-width": 160,
        "border-width": 1,
        "border-color": "#2a333f",
        "transition-property": "opacity, border-color, border-width",
        "transition-duration": "120ms",
        "transition-timing-function": "ease-in-out"
      } },
      { selector: "node[kind = 'module']", style: {
        "width": 150, "height": 40, "opacity": 0.85,
        "font-size": 11
      } },
      { selector: "node[kind = 'external']", style: {
        "shape": "octagon",
        "background-color": "#d97757",
        "color": "#1a1410"
      } },
      { selector: "node[kind = 'package']", style: {
        "shape": "round-tag"
      } },
      { selector: "node:selected", style: {
        "border-color": "#5eead4",
        "border-width": 2
      } },
      { selector: ".faded", style: { "opacity": 0.15 } },
      { selector: ".highlight", style: {
        "border-color": "#5eead4",
        "border-width": 2
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
      { selector: "edge.highlight", style: {
        "line-color": "#5eead4",
        "target-arrow-color": "#5eead4",
        "width": 2.2,
        "opacity": 1
      } }
    ]
  });
  // Assign fills client-side so the stylesheet can reference data(fill).
  const KIND_FILL = {
    file: "#4a6da7",
    module: "#6b5b95",
    package: "#b58860",
    symbol: "#87a96b",
    external: "#d97757"
  };
  cy.nodes().forEach(function (n) {
    n.data("fill", KIND_FILL[n.data("kind")] || "#4a6da7");
  });
  cy.fit(undefined, 32);

  const panel = document.getElementById("panel");
  function showEmpty() {
    panel.innerHTML = '<h2>Selection</h2><div class="empty">Click a node to see details.</div>';
  }
  function renderRow(k, v) {
    return '<div class="row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function showNode(raw) {
    const attrs = raw.attrs && Object.keys(raw.attrs).length
      ? '<pre>' + escapeHtml(JSON.stringify(raw.attrs, null, 2)) + '</pre>' : '';
    panel.innerHTML =
      '<h2>Node</h2>' +
      '<div class="node-id">' + escapeHtml(raw.id) + '</div>' +
      renderRow("kind", escapeHtml(raw.kind)) +
      (raw.language ? renderRow("language", escapeHtml(raw.language)) : "") +
      (raw.name ? renderRow("name", escapeHtml(raw.name)) : "") +
      (raw.parentId ? renderRow("parent", escapeHtml(raw.parentId)) : "") +
      (attrs ? '<h2 style="margin-top:14px">Attributes</h2>' + attrs : "");
  }
  showEmpty();

  function clearHighlights() {
    cy.elements().removeClass("highlight").removeClass("faded");
  }
  function highlightNeighborhood(node) {
    const neighborhood = node.closedNeighborhood();
    cy.elements().not(neighborhood).addClass("faded");
    neighborhood.addClass("highlight");
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

  // Search filter — fade non-matching nodes; empty value resets.
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

function legendHtml(): string {
  const items = [
    ["File", "var(--kind-file)"],
    ["Module", "var(--kind-module)"],
    ["Package", "var(--kind-package)"],
    ["Symbol", "var(--kind-symbol)"],
    ["External", "var(--kind-external)"],
  ];
  return items
    .map(
      ([label, color]) =>
        `<span class="swatch"><i style="background:${color}"></i>${label}</span>`,
    )
    .join("");
}

interface HtmlContext {
  bundle: string;
  graphJson: string;
  title: string;
  subtitle: string;
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
<main>
  <div id="cy" role="img" aria-label="Dependency graph"></div>
  <aside id="panel" aria-live="polite"></aside>
</main>
<footer>
  <span>Legend:</span>
  ${legendHtml()}
  <span style="margin-left:auto">imports = solid, re-exports = dashed</span>
</footer>
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
  });
}
