# Interactive HTML Visualization for the codewatch Graph

Background research for a planning-workflow enhancement: codewatch already emits a SQLite graph (nodes = files/modules/symbols, edges = imports/calls/refs) plus per-node metrics. We want a beautiful, clickable HTML view that color-codes by metric, supports a "flow" panel that highlights a subgraph for a use case, exposes annotations on click, and can overlay two states (current vs. planned, or branch A vs. B).

This report surveys the relevant stacks and ends with an opinionated recommendation.

---

## 1. Graph rendering libraries

The honest tradeoff is **rendering tech** (SVG → Canvas → WebGL) versus **API surface and ecosystem**. For code graphs at the scale codewatch will produce (a few hundred to ~30k nodes for a large monorepo at file granularity, more if symbols are exposed), Canvas is the sweet spot.

- **Cytoscape.js** — full graph-theory library (BFS/DFS, centrality, k-shortest paths) plus rich CSS-style selectors, ~30+ layout extensions (`cytoscape-dagre`, `cytoscape-elk`, `cytoscape-cola`, `cytoscape-fcose`). Canvas renderer is comfortable up to ~3–5k nodes; the new WebGL renderer (preview, Jan 2025) lifts the ceiling sharply via texture-atlas batching of nodes/labels. Strongest event model and selector engine in this group; popper/tippy extensions give clean tooltips and side-panel pinning.
- **Sigma.js** — WebGL-native, designed to push 100k+ nodes. Lean rendering API, weaker analysis layer, smaller layout ecosystem (relies on graphology + graphology-layout-forceatlas2). Best when scale is the dominant constraint; overkill for a per-project code graph.
- **vis-network** — easiest physics/drag-drop demo, but Canvas-only and the slowest of the trio in benchmarks. Fine for ≤1k nodes; clustering API is nice but the styling layer is dated.
- **D3-force** — primitive, not a library. You build everything (zoom, hit-testing, labels). Rewards investment with maximum control; punishes you when you need quick iteration. Use d3 for bespoke layouts on top of another renderer, not as the renderer itself.
- **react-flow / xyflow** — node-based editor, not a graph viz tool. Each node is a React component, which is fantastic for custom UI inside nodes (badges, sparklines, expand/collapse) but the viewport rendering ceiling is around 1–2k visible nodes before React reconciliation hurts. Pairs well with `elkjs` or `dagre` for layout.
- **ngraph** (`ngraph.graph` + `ngraph.pixel` / `ngraph.forcelayout`) — very fast force layout, WebGL renderer; sparse documentation and a more academic vibe.
- **G6 (AntV)** — feature-rich, batteries-included (built-in mini-map, edge bundling, hierarchical layouts, behaviors). v5 ported some layouts to Rust/WASM and added optional WebGPU acceleration. The China-first community and English doc gaps are real friction.

**Scale ceilings (rule of thumb, default settings):** vis-network ~1k, react-flow ~1–2k visible, Cytoscape canvas ~5k, Cytoscape WebGL / G6 ~30–50k, Sigma ~100–500k, ngraph WebGL similar. Codewatch lives comfortably in the 3–10k band.

## 2. Layout engines

For code dependency graphs you almost always want **layered/hierarchical** (Sugiyama-style) layouts; force-directed produces hairballs once edge density rises.

- **dagre** — JS implementation of a simplified Sugiyama. Drop-in, fast, minimal config. No subgraph/compound support, no port-aware routing, occasionally ugly edge crossings. Default in Mermaid flowcharts and used everywhere because it's simple.
- **ELKjs** — Eclipse Layout Kernel compiled to JS via GWT. Supports compound nodes (subgraphs), port constraints, multiple layered algorithms. Higher quality output than dagre, ~5–20× slower, ~1MB extra bundle. Best fit for hierarchical code dep graphs once you have packages-containing-files-containing-symbols.
- **graphviz-wasm / @hpcc-js/wasm / d3-graphviz** — full Graphviz `dot` engine in WASM (Sugiyama, but the canonical implementation). Highest quality layered output, can read DOT directly. Trade-off: layout returns SVG positions; you lose Cytoscape's interaction layer unless you re-import positions.
- **klay** — predecessor to ELK, deprecated; use ELK.
- **cola.js** — constraint-based force layout, good for "force layout but with horizontal alignment hints"; useful as a fallback when groupings break dagre.

For codewatch I'd reach for **ELKjs** with `algorithm: "layered"` and compound nodes for module containment. Use dagre as the fast-path default and ELK for "polish mode."

## 3. Diagramming DSLs

These are output formats, not viz frameworks — useful as a fallback for printable/static views and for embedding in Markdown PRs.

- **Mermaid.js** — runs in-browser, broad GitHub/Markdown integration, dagre by default, optional ELK. Click handlers (`click NodeId callback`) and CSS classes (`classDef`) give you basic interactivity, but the JS hooks are awkward and SVG output is shallow on annotations.
- **D2 (Terrastruct)** — Go binary that emits SVG/PNG/PDF. Best-looking diagrams in this category, supports embedded icons, animations, syntax-highlighted code blocks. Not a renderer you ship to the browser; you generate SVG ahead of time. SVG can include `<a>` and `data-` attributes for click-through.
- **PlantUML** — JVM-based, mature, ugly defaults; mostly UML-flavored.
- **Structurizr Lite** — model-driven (C4), lovely for architectural narrative but too high-level for a node-per-file graph.
- **Excalidraw programmatic** — hand-drawn aesthetic, fully interactive, but no graph layout engine; you'd be feeding it positions from elsewhere.

Verdict: DSLs are a good **secondary surface** (export to PDF/PNG for review docs), not the primary interactive view.

## 4. Existing code-viz tools — what works, what's clunky

- **GitHub Stack Graphs** — name resolution at scale via incremental graph fragments per file, glued at query time. Conceptually closest to what codewatch should query against. Backbone for GitHub's Code Navigation. Inspect the data model, not the UI.
- **CodeSee Maps** — closed-source, but the UX is worth studying: zoom collapses files into directories with a filled-icon cluster, "tour" overlays a path through the graph as a numbered walkthrough, change PRs paint affected nodes. Clunky parts: opaque indexing, no offline view, slow on >5k files.
- **Sourcegraph** — text-first, code-graph is mostly LSIF/SCIP under the hood; viz is secondary.
- **dependency-cruiser HTML reporter** — produces a single self-contained HTML with per-module rollover, generated through Graphviz dot under the hood. Good baseline for "static SSG that emits one HTML"; the UI is utilitarian.
- **Madge** — JS/TS specific, fast, simple SVG graphs, no annotations. Fine for tiny projects, breaks visually past ~200 nodes.
- **Skott** — modern Madge replacement with a built-in webapp viewer; uses D3-force, no edge bundling.
- **dep-tree** — Go CLI for multi-language dep graphs; outputs ASCII or SVG. Good for terminal previews.
- **Arkit** — generates SVG component diagrams from JS/TS. Nice illustrations, no interactivity.
- **GitHub repo-visualizer (githubocto)** — circle-pack treemap, beautiful, **non-interactive**. Worth borrowing the visual language for a "directory landscape" mode.
- **DependenTree (Square)** — D3 tidy-tree for dependencies; collapse/expand pattern is good UX inspiration.
- **NDepend** — closed-source, .NET, but the dependency-matrix view (DSM) and the "before/after on the same canvas" diff are the gold standard for change-impact UX. Worth copying.
- **Gource** — animated history, not architecture; orthogonal but worth knowing.

Patterns that work: **collapse-by-folder**, **rollover incoming/outgoing**, **highlight a path through the graph**, **dual-pane diff with shared layout**.
Patterns that feel clunky: free-floating force layouts on >500 nodes; tooltip-only annotations with no pinning; modal dialogs that break the canvas context.

## 5. Patterns we want — canonical references

- **Focus + context / fisheye lens** — Sarkar & Brown, "Graphical Fisheye Views of Graphs" (CHI '92); Tominski et al., "Fisheye Tree Views and Lenses for Graph Visualization" (2006); Wang et al., "Structure-aware Fisheye Views" (TVCG 2019). Cytoscape has community fisheye extensions; D3 has `d3-fisheye` (legacy).
- **Brushing & linking** — Becker & Cleveland, "Brushing Scatterplots" (Technometrics 1987). In our context: select nodes in the flow panel → highlight in the graph and in a side list.
- **Level of detail (semantic zoom)** — Compound-Fisheye / Treemap hybrids (Schaffer et al., "Continuous Zoom"; Frishman & Tal). Implemented in Cytoscape via compound parents + `cytoscape.js-expand-collapse`.
- **Edge bundling** — Holten, "Hierarchical Edge Bundles" (TVCG 2006); Holten & van Wijk, "Force-Directed Edge Bundling" (EuroVis 2009). Available as `d3-hierarchical-edge-bundling` and built into G6.
- **Mini-map / overview+detail** — covered well by Cytoscape's `cytoscape-navigator`, react-flow's `<MiniMap />`, G6's built-in.
- **Search / filter** — straightforward via the underlying graph model (Cytoscape selectors, graphology queries).
- **Time slider for diff playback** — borrow the Gource scrub bar; pair with two snapshots laid out on the same coordinates so the slider crossfades node colors and edge presence rather than re-laying out (a "shared layout, two stylesheets" pattern).

## 6. Static vs. server tradeoff

The choice is between (a) a **pure static HTML+JS bundle** generated per project, and (b) a **small server** (Vite dev / Express prod) that proxies SQL queries.

Codewatch is already a CLI that emits a SQLite file. Two compelling options:

- **Static SSG**: one HTML per project, with the SQLite graph embedded as JSON (or fetched alongside via `sql.js-httpvfs` so the browser pages-in only needed pages over HTTP Range requests). No server, trivial to share, works in CI artifact viewers, drops into GitHub Pages. The agent UX is "run `codewatch viz`, open the HTML" — perfect parity with how codewatch is used.
- **Local server**: needed only if the graph won't fit (>100k nodes) or if you want write-back features (annotate from the UI, persist plans). Adds install and port friction.

`sql.js-httpvfs` (phiresky) gives us the **best of both**: ship a static HTML + the original `.sqlite`, the browser issues HTTP Range requests against the SQLite pages, and a 1KB key lookup transfers ~1KB rather than the whole DB. It works on GitHub Pages, S3, Cloudflare Pages, Netlify with no server config. For codewatch this means the planning workflow can hand a single URL to a reviewer and they get full interactive query.

For the "two-state diff" feature, a local server is *not* required — generate two layouts in the SSG, store both in the JSON payload, and let the client crossfade. A server only earns its keep when annotations need to write back to source.

---

## Recommended stack for codewatch

**Renderer:** Cytoscape.js (Canvas default, opt-in WebGL renderer once it's GA). Mature event model, the best selector engine of the bunch, broad layout-extension ecosystem, and a culture of long-term API stability. Bundle size ~250KB gz with extensions — acceptable for a static HTML.

**Layout:** ELKjs (`algorithm: "layered"`) as the polish default, with **dagre** wired in as a fast-path for graphs above 5k nodes (ELK gets slow). Compound nodes for module/package containment; ports for "imports vs. calls" edge classes.

**DSL fallback:** D2 for printable architecture diagrams in PR descriptions. Generate alongside the HTML; do not try to make D2 the interactive surface.

**Data layer:** Embed the graph as JSON for graphs <2MB; switch to **`sql.js-httpvfs`** above that. Either way, no server.

**Distribution:** A ~50–150 line static SSG inside codewatch. `codewatch viz --out report.html` reads the SQLite, runs the layout, inlines a Cytoscape bundle + stylesheet + JSON, and writes a single HTML file. Optional `--two-state plan.json` flag overlays a planned graph on the current layout, color-coding adds/removes/changes — the "shared layout, two stylesheets" pattern.

**Interactivity baseline (ship in v1):**
1. Color-by-metric dropdown (size / complexity / fan-in / fan-out / churn) — recompute Cytoscape style on selection.
2. Flow panel: list of entry points / use cases (derived from codewatch's call-graph or supplied in YAML); selecting one runs a BFS in Cytoscape, fades non-reachable nodes (`opacity: 0.1`), and highlights edges along the path.
3. Click handler on node → side panel with the codewatch annotations (description, planned change, pseudocode diff). Keep the panel pinned; don't use floating tooltips for primary content.
4. Mini-map via `cytoscape-navigator`. Search box that runs Cytoscape selectors. `cytoscape.js-expand-collapse` for compound subgraph collapse.
5. Two-state mode: time slider crossfades node fill color (current → planned). Edges added/removed get green/red strokes.

**Patterns to defer:** edge bundling (only meaningful past ~2k edges, and adds layout cost), fisheye lens (good demo, low real value next to focus+fade), force-layout fallback (we're explicitly betting on layered).

### Risks

- **WebGL renderer is preview**, not GA. Plan for canvas as the shipped default; add a feature flag for WebGL.
- **ELKjs layout time** scales superlinearly. Above ~5k nodes, layout in a Web Worker and cache the resulting positions in the SQLite alongside the graph.
- **Compound layouts in Cytoscape** are a known sharp edge — Cytoscape's built-in `fcose` or `cose-bilkent` handle them better than dagre/ELK when you have many nested groups; reserve a fallback.
- **Two-state shared layout** needs deterministic node IDs across snapshots — guarantee codewatch emits stable IDs (path + symbol fully-qualified name, not row IDs).
- **`sql.js-httpvfs` requires HTTP Range support** on the host. GitHub Pages and Cloudflare Pages are fine; some corporate proxies aren't. Provide a `--inline` fallback that embeds JSON.
- **Don't ship react-flow** even though it looks tempting. Per-node React components break down past a few hundred visible nodes and the layout story is weaker.

---

## Sources

- [Cytoscape.js WebGL Renderer Preview (Jan 2025)](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)
- [Cytoscape.js performance discussion #3088](https://github.com/cytoscape/cytoscape.js/discussions/3088)
- [Cytoscape.js performance test page](https://cytoscape.org/js-perf/)
- [Cytoscape vs vis-network vs Sigma (PkgPulse, 2026)](https://www.pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma-graph-visualization-2026)
- [Memgraph: graph viz tool tradeoffs](https://memgraph.com/blog/you-want-a-fast-easy-to-use-and-popular-graph-visualization-tool)
- [Cylynx: JS graph viz comparison](https://www.cylynx.io/blog/a-comparison-of-javascript-graph-network-visualisation-libraries/)
- [Best libraries for large network graphs (Weber, Medium)](https://weber-stephen.medium.com/the-best-libraries-and-methods-to-render-large-network-graphs-on-the-web-d122ece2f4dc)
- [G6 (AntV) framework](https://github.com/antvis/G6)
- [G6: a web-based library for graph visualization (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2468502X21000619)
- [react-force-graph](https://github.com/vasturiano/react-force-graph)
- [ELKjs](https://github.com/kieler/elkjs)
- [Dagre](https://github.com/dagrejs/dagre)
- [React Flow ELK example](https://reactflow.dev/examples/layout/elkjs)
- [React Flow Dagre example](https://reactflow.dev/examples/layout/dagre)
- [Mermaid layout engines](https://deepwiki.com/mermaid-js/mermaid/2.3-layout-engines)
- [Sugiyama Method explainer (Disy blog)](https://blog.disy.net/sugiyama-method/)
- [d3-graphviz](https://github.com/magjac/d3-graphviz)
- [hpcc-js/wasm (Graphviz WASM)](https://github.com/hpcc-systems/hpcc-js-wasm)
- [graphviz-wasm (Cyberhaven)](https://github.com/CyberhavenInc/graphviz-wasm)
- [SpiderMonkey: building a Sugiyama layout in 1000 lines](https://spidermonkey.dev/blog/2025/10/28/iongraph-web.html)
- [Text-to-Diagram comparison: D2 vs Mermaid vs PlantUML vs Graphviz](https://text-to-diagram.com/?example=text)
- [D2 FAQ](https://d2lang.com/tour/faq/)
- [D2 Dagre layout](https://d2lang.com/tour/dagre/)
- [Mermaid vs D2 comparison (Becker)](https://aaronjbecker.com/posts/mermaid-vs-d2-comparing-text-to-diagram-tools/)
- [GitHub: Introducing stack graphs](https://github.blog/open-source/introducing-stack-graphs/)
- [CodeSee learning center: code visualization](https://www.codesee.io/learning-center/code-visualization)
- [GitHub Next: Visualizing a Codebase (repo-visualizer)](https://githubnext.com/projects/repo-visualization/)
- [githubocto/repo-visualizer](https://github.com/githubocto/repo-visualizer)
- [Square: DependenTree](https://developer.squareup.com/blog/dependentree-graph-visualization-library/)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
- [dependency-cruiser vs Madge (issue #203)](https://github.com/sverweij/dependency-cruiser/issues/203)
- [Madge](https://github.com/pahen/madge)
- [Skott: introducing the new Madge (DEV)](https://dev.to/antoinecoulon/introducing-skott-the-new-madge-1bfl)
- [Arkit](https://arkit.pro/)
- [RepoGraph (paper / repo)](https://github.com/ozyyshr/repograph)
- [UpgradeJS: application architecture visualization](https://www.upgradejs.com/blog/application-architecture-visualization.html)
- [Sarkar & Brown, "Graphical Fisheye Views of Graphs" (CHI '92)](https://www.cs.montana.edu/courses/spring2005/430/pg/ft_gateway.cfm.pdf)
- [Tominski, "Fisheye Tree Views and Lenses for Graph Visualization"](https://vca.informatik.uni-rostock.de/~ct/publications/Tominski06GraphLenses.pdf)
- [Compound-Fisheye Views and Treemaps (Kobourov, GD '04)](https://www2.cs.arizona.edu/~kobourov/cfv-gd04.pdf)
- [Approaches for visualizing large graphs (Matuschak notes)](https://notes.andymatuschak.org/Approaches_for_visualizing_large_graphs)
- [iSphere: Focus+Context Sphere Visualization (Semantic Scholar)](https://www.semanticscholar.org/paper/iSphere:-Focus+Context-Sphere-Visualization-for-Du-Cao/5c134dc5772975e97ddb73fb2e40bbd5b2a0a189)
- [Fisheye View — InfoVis Wiki](https://infovis-wiki.net/wiki/Fisheye_View)
- [phiresky: Hosting SQLite databases on GitHub Pages](https://phiresky.github.io/blog/2021/hosting-sqlite-databases-on-github-pages/)
- [sql.js-httpvfs](https://github.com/phiresky/sql.js-httpvfs)
- [sql.js](https://github.com/sql-js/sql.js/)
- [Hackaday: SQLite on the Web (absurd-sql)](https://hackaday.com/2021/08/24/sqlite-on-the-web-absurd-sql/)
- [Statically hosted SQLite with range queries (llimllib)](https://notes.billmill.org/databases/sqlite/Statically_hosted_sqlite_with_range_queries.html)
- [DiffViz paper](https://www.xifiggam.eu/wp-content/uploads/2018/08/DiffViz.pdf)
- [Pilz, "A graph-based source code multi-diff visualization" (TU Wien diploma)](https://repositum.tuwien.at/bitstream/20.500.12708/203444/1/Pilz%20Mario%20-%202024%20-%20A%20graph-based%20source%20code%20multi-diff%20visualization.pdf)
- [Softagram visual model comparison](https://softagram.com/en/blog/oppaat-4/visual-comparison-for-architecture-models-softagram-desktop-39)
- [LLM CodeMap (DEV)](https://dev.to/mk668a/llm-code-map-visualize-typescriptjavascript-dependencies-empower-ai-agents-4bng)
- [CodeTour VS Code extension](https://marketplace.visualstudio.com/items?itemName=vsls-contrib.codetour)
