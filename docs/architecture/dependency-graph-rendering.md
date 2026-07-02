# Dependency-graph rendering (dashboard Architecture view)

How the dashboard's embedded **package dependency graph** is built and drawn — the
layered ELK layout, the orthogonal edge routing, the coloring, and the on-click
interaction. This is the graph on the Architecture → *Dependency graph* tab, not
the standalone `graph render` file maps documented in [`README.md`](README.md).

The two share the `@codewatch/render` package but answer different questions:

| | `graph render` file map | Dashboard dependency graph |
|---|---|---|
| Scope | every file/module/external node | one node per **package** (collapsed) |
| Layout | ELK layered, drawn as-is | ELK layered, **routed** (see below) |
| Question | "where is the worst file?" | "how do the packages depend on each other?" |
| Default in | `docs/architecture/*.html` | `graph dashboard` Architecture view |

---

## Pipeline

```
snapshot (.codewatch/graph.db)
  → collapseToPackages()        one node/package, one weighted edge/ordered pair
  → computeLayout()             ELK "layered" DOWN → node centers + edge routes
  → buildCyData()               project routes → Cytoscape segments; assign colors
  → clientScript()              Cytoscape reads it: preset layout, segment edges
```

Source files, in pipeline order:

- **`collapse-packages.ts`** — file graph → package graph. Only `file` nodes
  contribute; intra-package edges are dropped; parallel cross-package edges fold
  into one edge carrying `attrs.weight` = the import count.
- **`layout.ts`** — runs ELK (`algorithm: layered`, `direction: DOWN`,
  `edgeRouting: ORTHOGONAL`) server-side. Returns node **centers** (not ELK's
  top-left corners — they must share one coordinate frame with the edge routes)
  and attaches each edge's orthogonal **section** (start / bend / end points) as
  `attrs.route`.
- **`edge-routing.ts`** — `projectRoute()` turns an absolute ELK route into
  Cytoscape's `segments` model. `packageGraphCenters()` gates routing to the
  package graph (see *Limitations*).
- **`template-cy-data.ts`** — assembles the Cytoscape `data` payload: edge
  `width` (√-scaled from weight), `×N` label, and the projected `routing`.
- **`template-cy-styles.ts`** — the stylesheet (colors, labels, fan-in/out glow).
- **`template-script.ts`** — the client: chooses the layout, applies routing,
  assigns colors into data, and wires selection.

`graph dashboard` calls `renderHtml(collapseToPackages(snapshot))`, base64s the
result, and embeds it as a data-URI iframe in the Architecture view.

---

## Layout: ELK server-side, `preset` client-side

ELK computes a layered top-down DAG **once, server-side**. The client renders it
with Cytoscape's `preset` layout so those positions survive to the screen.

This matters because the obvious client-side choice — `cose-bilkent` with
`randomize: true` — *re-lays-out* the graph and throws ELK's positions (and all
its edge routing) away. The package graph therefore uses `preset`; only the
file-level graph (which has no ELK hierarchy layout yet) falls back to
cose-bilkent. The client picks the path by inspecting the data:

```
useElkPreset = every node is positioned  AND  no node has a `parent`
```

The `window.__layoutMode` hook reports which path ran (`"elk-preset"` vs
`"cose-bilkent"`).

---

## Orthogonal edge routing — the load-bearing part

Cytoscape's built-in `taxi` routing is **obstacle-blind**: a layer-skipping edge
(`cli → graph`) cuts straight through whatever boxes lie between. ELK already
computes routes that go *around* nodes; we render those instead.

`projectRoute()` maps an absolute ELK route (`start`, `…bends`, `end`) into
Cytoscape's `segments`:

- **Endpoints** are pinned as px offsets from each node center
  (`source-endpoint` / `target-endpoint`).
- **Bends** are projected onto the source→target *center* axis as
  `segment-weights` (fractional position along) + `segment-distances` (signed
  perpendicular). Paired with `edge-distances: node-position`, a segment point
  reconstructs as `Cs + w·(Ct−Cs) + d·n` — which equals the original bend exactly
  (the invariant the unit test asserts).
- Sign convention: **positive distance = LEFT of travel**, `n = (−uy, ux)` in
  y-down screen space. This is the single easiest thing to invert; a flipped sign
  mirrors every bend and still looks plausible, so it's verified numerically, not
  by eye.

Weights are kept at **full precision** (they're a 0–1 fraction scaled back up by
the axis length — hundreds of px — so even 2-decimal rounding drifts a bend by
pixels). Perpendicular distances round to 2 decimals.

Verification is by the numbers via `window.__cy`: Cytoscape's rendered
`segmentPoints()` are compared against ELK's raw sections. On `cli → graph` they
agree to sub-pixel.

---

## Coloring (data-driven)

Each package gets a stable color from a **CVD-safe categorical palette** (the
validated dark palette from the `dataviz` skill; fixed order so adjacent hues stay
distinguishable for colorblind viewers). Assignment is by sorted package id, so
it's deterministic.

Colors are written onto node/edge **data** (`pkgColor` / `edgeColor`) *before*
Cytoscape reads them and mapped in the stylesheet (`data(pkgColor)` for borders,
`data(edgeColor)` for lines). This is deliberate: an earlier version applied
colors with an imperative post-hoc `.style()` bypass, which got stripped the
moment a node was selected and deselected. Baking them into the base stylesheet
makes them **survive every class toggle**.

Every edge is colored by its **source** package, so a fan-out reads as one
traceable colored bundle. Edge *labels* (`×N`) are decoupled from the line color —
they render bright (`#eef2f8`, weight 700) with a 3.5px near-black outline so
they're legible over any line.

---

## Interaction

- **Select a node** → its edges are tinted by direction while the source colors
  and the node glow are kept: **outgoing** edges (its dependencies / fan-out) get
  a teal halo, **incoming** edges (its dependents / fan-in) an amber halo.
  Everything outside the closed neighborhood fades. Implemented with
  `fanout`/`fanin` classes via `node.outgoers`/`incomers` — the lines keep their
  `data(edgeColor)` and weighted width.
- **Endpoints land on the outline.** Leaf package nodes carry **no padding** —
  padding would make the rendered box larger than the size ELK laid out, so edge
  endpoints (on ELK's boundary) would sit *inside* the visible border. Compound
  parents (file graph) keep their padding via the `:childless` selector split.
- **Diagnostic hooks.** `window.__cy` and `window.__layoutMode` exist so tests and
  Playwright can assert geometry, layout mode, edge classes, and colors by the
  numbers rather than by screenshot.

---

## Capabilities

Stress-tested across DAG shapes (`straight-line`, `fan-out`, `fan-in`, `cycle`,
`diamond`, `spaghetti`, `self-loop`, `disconnected`) — all render `elk-preset`
with orthogonal routing and zero console errors:

- **Layered DAGs** read cleanly: foundations at the bottom, entry points at the
  top, dependencies flowing down.
- **Cycles** are handled — ELK linearizes them and routes the cycle-closing edge
  around the side; it does not hang or overlap.
- **Dense graphs** ("spaghetti") stay traceable because every edge is colored by
  source and routed in its own orthogonal lane — the color-coding is what carries
  it, not the geometry alone.
- **Disconnected components** lay out side by side.
- **Self-loops** degrade gracefully (they can't actually occur here —
  `collapseToPackages` drops intra-package edges — but they don't break routing).
- **Weighted edges** encode import count as √-scaled thickness + an `×N` label.

---

## Limitations

Known and deliberate — worth understanding before relying on the view:

1. **The file-level graph is not routed.** `--graph-scope file` still uses
   `cose-bilkent` (obstacle-blind, force-directed). ELK's orthogonal routing is
   gated to the flat package graph because the compound file graph needs
   `hierarchyHandling: INCLUDE_CHILDREN` plus a per-edge LCA offset (ELK reports a
   nested edge's section in its lowest-common-ancestor's local frame). This is the
   next routing frontier (see *Future directions*).
2. **The package view hides all intra-package structure.** That's the point — it
   answers the package-dependency question — but it says nothing about *how big or
   tangled a package is inside*. On this repo some packages are large (`cli` ~77
   files, `graph` ~60), and a single box gives no sense of that. The file-level
   modes below are how we'd surface it.
3. **Edges are import-count only.** A package edge's weight is the number of
   cross-package `import`/`re-export` edges. Test-of, calls, and change-coupling
   relationships are not folded into the package graph.
4. **Palette CVD-safety is guaranteed for ≤ 8 packages.** The categorical palette
   has 8 slots; a 9th package wraps and reuses a hue. This repo has 7, so it's
   fine, but a larger monorepo would need the "fold into Other / small-multiples"
   treatment the dataviz skill prescribes.
5. **Very wide graphs zoom small.** A big single-layer fan-out (many siblings in
   one row) fits-to-width and shrinks; there's no vertical-centering or
   multi-row wrap tuning yet.
6. **Layout is snapshot-static.** The graph reflects the generated snapshot; the
   window switcher and baseline controls don't re-run ELK.

---

## Future directions — the file-level graph

The unsolved-and-interesting frontier, especially because this repo's packages are
large enough that "expand everything" is not viable. Several modes worth
prototyping (not yet built):

- **Files-within-packages** (the pr-viz reference model): file nodes nested inside
  package compound boxes, cross-package edges aggregated to the package boundary,
  intra-package edges shown inside. Needs the compound ELK routing from
  Limitation #1.
- **Toggleable per-package expansion**: keep the package graph as the default and
  let a click *expand one package* into its files in place, re-running layout on
  the mixed collapsed/expanded set. Progressive disclosure without drowning in a
  500-node hairball.
- **Within-package (focus) view**: pick one package, show its files in full, and
  either **hide** the other packages or **stub** them as single boundary nodes
  (so cross-package edges still have a target). Scales to large packages because
  only one is ever exploded.

The design tension throughout is **scale**: `cli` and `graph` are big enough that
any mode which expands more than one at a time risks the hairball the package
collapse was built to avoid. Nailing the interaction (what expands, when, and how
the layout reflows) is the real work.

---

## Regenerating the dashboard graph

```bash
pnpm -r build
node packages/cli/dist/index.js graph dashboard \
  --db .codewatch/graph.db --config .codewatch/check.json \
  --repo codewatch --out codewatch-dashboard.html
# --graph-scope file  opts into the (unrouted) file-level graph
# --no-graph          omits the embedded graph for a smaller file
```
