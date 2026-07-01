# Architecture View — End-User Critique

## 1. Verdict + Value Score

The Architecture view takes one genuinely real number (instability) and one dead number (a type-file-share "abstractness" proxy that never exceeds 0.17 across all 7 packages) and stages them as a 2D "main sequence" scatter. Because the Y-axis is effectively pinned to zero, the whole plot collapses to a 1-D instability line, and the headline "distance from main sequence" ranking is mathematically just **inverted instability** — which is *identical* to the layer column sitting right next to it (foundation → middle → top sorts perfectly monotonically with D 0.97 → 0.01). Worse, it points the maintainer's eye at the *healthiest* packages: it flags `core`/`profile`/`graph` — small, stable, concrete foundation packages (types, schema, db) — as the top-ranked "rigid" problems in warning-orange, when concrete+stable is exactly what an internal foundation *should* be. The dependency-graph tab is a 561-node / 927-edge hairball (double-counting File+Module nodes) split into three disconnected blobs plus a grid of orphan nodes — decorative, not readable. Meanwhile two genuinely actionable numbers the view already has in-hand — **cohesion** (cli 0.60 is a real outlier) and **crossEdges** — are computed and thrown away.

**Value score: 2 / 5.** There is a kernel of real signal (instability, layer, cross-edges), but the main-sequence framing adds a bogus second dimension, the flagship ranking is tautological with the layer pill, and the color coding mildly misdirects. A maintainer acting on this view would "fix" the wrong packages.

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| Main-sequence scatter (I×A) | 7 points, all crammed into the bottom 17% of the Y range (A ∈ [0.013, 0.167]) | **misleading** | Abstractness proxy never rises off the floor, so the 2D plot is really 1D. The diagonal I+A=1 is compared against instability alone. 83% of the chart is empty. |
| Diagonal "balanced" line | Corner-to-corner (0,1)→(1,0) | marginal | Prescribes "stable packages should be abstract" — valid for published libraries, wrong for an app's concrete internal foundation. No point can reach the top-left ideal because A is capped near 0. |
| "Packages ranked by distance from main sequence" | profile 0.97, core 0.83, graph 0.76, render 0.32, analyzer 0.18, checker 0.08, cli 0.01 | **misleading / trivial** | D ≈ \|1 − I\| here (A is ~0), so this ranking is instability inverted — it reproduces the layer ordering exactly (foundation top, top-layer bottom). The `layer` pill in the same row already says it. |
| `layer` pill (foundation/middle/top) | Correct, per package | actionable | The one honest, legible classifier — and it makes the D ranking redundant. |
| Zone pill ("rigid (stable + concrete)" / "balanced") | 3 rigid, 4 balanced | marginal → misleading | "Rigid" lands on the 3 foundation packages, i.e. the correctly-designed ones. Warning-orange implies "act here." |
| `I x.xx · A x.xx` numbers | e.g. cli I 1.00 · A 0.01 | marginal | I is real but obvious from the names (cli depends on all → 1.0; profile/core → 0.0). A is untrustworthy. |
| Legend (teal "balanced" / orange "far from sequence") | 2 swatches | trivial | Uses different words ("far from sequence") than the pills ("rigid"/"unstable+abstract") for the same colors — vocabulary drift. |
| Bubble size (√fileCount) | cli/graph large, checker small | marginal | Encodes file count, but it's a third variable stacked on an already-degenerate plot; adds density, not insight. |
| Point labels | "che…", "analy…" truncated and overlapping near cli | trivial (broken) | Labels collide in the bottom-right cluster; unreadable. |
| Dependency-graph tab (Cytoscape) | 561 nodes / 927 edges, 3 disconnected blobs + orphan grid | **decorative** | Double-counts File(267)+Module(267)+External(27). Hairball at this zoom, no visible labels, "click a node" required — useless on load. |
| Graph filter chips (File/Module/External, Source/Test/…) | Counts per role | marginal | The counts (Test 206, Source 264) are a mildly interesting inventory, but unrelated to "where do I look." |
| **cohesion** (in data, NOT shown) | cli 0.60, render 0.84, checker 0.77 … core/profile 1.0 | (missing) | The single most actionable package number in the payload — cli's 0.60 is a real "doing too much" signal — is discarded. |
| **crossEdges** (in data, NOT shown) | cli 58, graph 50, core 25 … | (missing) | A direct boundary-leak measure, unused. |
| centralFiles (passed to view) | 10 files | (missing) | Payload includes it; the view never renders it. Dead prop. |

## 3. Findings

1. **[METRIC] — high — The abstractness axis is dead; the scatter is 1-D theater.** Every package sits at A ∈ [0.013, 0.167], so 83% of the vertical plot is empty and the second dimension carries no information. **Fix:** either drop the Y-axis entirely and render a 1-D instability strip, or replace Y with a metric that actually varies across these packages — **cohesion** (range 0.60–1.0) is already computed and would make the plot two genuinely independent axes.

2. **[METRIC] — high — "Distance from main sequence" is tautological with the layer pill.** Because A≈0, D ≈ \|1 − I\|, and the resulting order (foundation 0.97/0.83/0.76 → middle 0.32/0.18/0.08 → top 0.01) *is* the layer ordering shown one pill to the left. The flagship ranking tells the user nothing the `layer` badge didn't. **Fix:** rank by a non-derivable signal — lowest **cohesion** first (surfaces cli 0.60) — and label it "least internally focused," which points at a real refactor.

3. **[METRIC] — high — The view flags the healthiest packages as problems.** `core`, `profile`, `graph` (concrete, stable foundation: types/schema/db/indexer) top the ranked list in warning-orange as "rigid." For internal app foundation, stable+concrete is *correct*; there is nothing to fix. Acting on this misdirects effort. **Fix:** suppress the "rigid" flag for `layer: foundation`, or gate the main-sequence critique behind a "this is a published library" mode; foundation concreteness is by design.

4. **[DASHBOARD] — med — Point labels truncate and overlap.** "che…" and "analy…" collide over the cli bubble in the bottom-right cluster (checker I 0.80, analyzer I 0.77, cli I 1.00 all pack into x∈[0.77,1.0], y≈0). **Fix:** leader lines, collision-aware label placement, or move labels into a hover/side legend keyed by color.

5. **[DASHBOARD] — med — Massive dead vertical space.** Both tabs use only the top ~25% of the page; the remaining ~75% is empty black. The two panels don't grow, and the scatter fills barely half its own panel. **Fix:** let panels flex to fill, enlarge the plot, or bring the hidden cohesion/crossEdges ranking below the fold to use the space.

6. **[DASHBOARD] — med — Dependency graph is an unreadable hairball and double-counts nodes.** 561 nodes for a ~130-file repo because it renders File(267)+Module(267)+External(27) as separate nodes; it displays as three disconnected clusters plus a grid of ~100 orphan nodes with no visible labels. On load it answers no question. **Fix:** default to a **package-level** (7-node) collapsed graph with cross-edge weights; make the file-level graph an opt-in drill-down. Drop or merge the redundant Module layer.

7. **[DASHBOARD] — low — Legend vs. pill vocabulary drift.** The scatter legend says "far from sequence"; the pills say "rigid (stable + concrete)" / "unstable + abstract" for the same orange. **Fix:** one vocabulary.

8. **[DASHBOARD] — low — Warning-orange on D values that aren't warnings.** Foundation packages get orange D (0.97/0.83/0.76) purely because they're stable; orange reads as "alarm." **Fix:** decouple D color from severity, or don't color-alarm foundation rows.

9. **[DASHBOARD] — low — `centralFiles` and `cohesion`/`crossEdges` are passed in but never rendered.** Dead data flowing into a view that instead shows a degenerate proxy. **Fix:** render them (see #2) and drop the unused prop.

10. **[METRIC] — low — 7 real points is below the threshold where a scatter earns its keep.** Martin's main sequence is a fleet metric (dozens of packages); at n=7 a sorted table is strictly more legible than a chart. **Fix:** demote the scatter to a compact sparkline/strip and lead with the ranked table.

*(Note: the degenerate `dashboard` package (0 files) is correctly filtered at ArchitectureView.tsx:32 — it does NOT pollute the plot or ranking. And there are no on-chart "zone of pain / zone of uselessness" quadrant labels or a health gauge rendered in this view, despite the framing — so those specific worries don't apply; the real problem is the axis and the ranking, not the empty node.)*

## 4. Single Highest-Leverage Improvement

**Kill the "distance from main sequence" ranking and replace the abstractness axis with cohesion.** The distance ranking is provably just inverted instability (= the layer column), and the abstractness axis is a coarse proxy pinned to zero — together they produce a chart that restates the package layering while mislabeling healthy foundation packages as "rigid." Swap in **cohesion** (already in the payload, real range 0.60–1.0): plot instability × cohesion, and rank packages by lowest cohesion. That immediately surfaces the one non-obvious, actionable finding hiding in this exact dataset — `packages/cli` at cohesion 0.60 with 58 cross-edges is a genuinely under-focused boundary worth splitting — instead of telling the user that their foundation packages are stable, which they already knew.
