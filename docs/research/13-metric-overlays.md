# 13 - Metric Overlays on Architecture Diagrams

How mature code-analysis tools render quantitative metrics on top of structural views — and what works for codewatch.

## 1. CodeScene — Hotspots, Biomarkers, Knowledge Maps

CodeScene's signature canvas is the **enclosure (circle-pack) hotspot map**: nested circles where the hierarchy is the directory tree, **size encodes complexity** (LOC as a proxy), and **color saturation encodes change frequency** from VCS history. Hotspots are the high-saturation circles inside large enclosures — files that are both complex and frequently changed. The visual is a deliberate restatement of the "complexity x change" matrix Tornhill argues is the strongest empirical predictor of defect risk.

On top of the same circle-pack canvas CodeScene layers:

- **Code Health / biomarkers**: a 1-10 aggregate score with ~25-30 sub-signals (brain method, nested complexity, primitive obsession, DRY violations). Color shifts from green to red as health degrades — diverging palette, with the implicit reference point being "healthy".
- **Knowledge maps**: same hierarchy, but each region is colored by **dominant author** (categorical hue), with desaturation indicating shared ownership. "Knowledge loss" is a separate overlay (departed authors).
- **X-Ray**: zooms one hotspot to the function level, with the same complexity-vs-change matrix applied inside the file.
- **Temporal / change coupling**: a chord diagram or arc graph between files that change together — overlaid on the dependency view, not the treemap.

Key takeaway: CodeScene reuses **one hierarchical canvas** and swaps overlays. Reviewers learn the canvas once, then read multiple metrics through it.

## 2. SonarQube / SonarCloud — Treemaps + Bubble Charts

Sonar's Measures tab exposes two canonical visualizations:

- **Treemap** (rectangular, slice-and-dice): rectangle area = lines of code; rectangle color = a rating metric (Maintainability A-E, Reliability, Security, Coverage %). Color is a sequential or rating-scale palette, not rainbow.
- **Bubble chart**: x = LOC, y = technical debt (or complexity), bubble size = duplicated lines, bubble color = coverage rating. Four metrics on one canvas, but only one is positional (the most accurate channel per Cleveland-McGill).

Sonar pre-defines six bubble configurations (Risk, Reliability, Security, Maintainability, Coverage, Duplications). Each picks the axis pair that most correlates within that domain. The DRY constraint they implicitly follow: **never duplicate a metric across two channels in the same chart** — color and size encode different things.

## 3. NDepend — DSM, Treemap, Main-Sequence Plot

Three complementary views, each with a fixed encoding contract:

- **Dependency Structure Matrix (DSM)**: square matrix; **blue = column-uses-row, green = row-uses-column, black = mutual cycle**. Numeric cell value = coupling strength (members involved). Pattern reading is the point — triangular = layered, off-diagonal black = cycle, dense diagonal = high cohesion.
- **Treemap**: size = LOC (or any chosen metric: cyclomatic complexity, parameter count, popularity rank); color = a second metric (coverage %, complexity, or custom CQLinq query). The dual-metric encoding is what makes "large red rectangle = big untested method" instantly readable.
- **Abstractness vs Instability ("Main Sequence") plot**: 2D scatter, x = Instability I in [0,1], y = Abstractness A in [0,1], with the diagonal `A + I = 1` drawn. Distance D from that line is the third metric. Two corners are named anti-zones: "Zone of Pain" (concrete + stable, low I + low A) and "Zone of Uselessness" (abstract + unstable). This is the best example I know of an architecture chart where the **interpretation is baked into the canvas geometry**, not the encoding.

## 4. Code Climate / CodeFactor

Code Climate's UI is more list-driven. Its strongest visual is a **quality-vs-churn scatter** (y = maintainability rating, x = change frequency) — same axes as Tornhill's hotspot matrix, but as Cartesian scatter rather than enclosure. It also overlays coverage hits inline in GitHub PR diffs, which is a different overlay strategy entirely: **overlay metrics on the source itself, not on a canvas**. CodeFactor uses gutter ratings (A-F) per file in tree views — categorical color on a list view.

## 5. Code City and Voronoi Treemaps

**Code City** (Wettel & Lanza) maps packages -> districts, classes -> buildings. Three encodings on each building: **width and length = number of attributes (NOA), height = number of methods (NOM)**. Color is reserved for a categorical or evolution overlay (e.g., commit author, age, test smell). The 3D metaphor is intentionally heavyweight — it's a presentation tool for whole-system review, not a daily IDE overlay.

**Voronoi treemaps** (Balzer et al. 2005) replace rectangles with weighted polygons. Software-vis-specific advantage: organic boundaries make package edges legible at any zoom, and weights can encode an additional metric. Stable-layout variants (Hahn et al. 2014) preserve user spatial memory across snapshots — important when overlays animate over time.

Caveat: Code City's 3D buildings break Cleveland-McGill's accuracy ranking (volume is rank ~5-6). It's good for impression, bad for measurement. Most modern tools have backed off 3D.

## 6. Hotspot / Temporal Overlays (Tornhill)

From *Software Design X-Rays* and *Your Code as a Crime Scene*:

- **Hotspot map** = circle-pack with complexity x change frequency (above).
- **Change coupling network**: nodes are files, edges weighted by number of co-commits. Layout is force-directed; thick edges between files in different modules signal hidden coupling that the static dep graph misses.
- **Knowledge map**: ownership colored, plus a derived "main developer left" overlay that flags risk.
- **Sum of coupling**: an overlay on the dep graph where node size scales with how many other files this file changes together with — orthogonal to fan-in/fan-out.

The pattern across all of these: **temporal data fuses with structural data on the same canvas**. The static canvas without churn loses ~50% of the diagnostic signal.

## 7. Visual Encoding Theory (Cleveland-McGill, Munzner)

Cleveland-McGill rank perceptual tasks by accuracy:

1. Position on a common scale
2. Position on non-aligned scales
3. Length, direction, angle
4. Area
5. Volume, curvature
6. Shading, color saturation
7. Color hue, density

Munzner reframes this as **channel-by-data-type**: magnitude channels (position, length, size, luminance, saturation) for ordered data; identity channels (hue, shape, motion) for categorical. The implication for code metrics:

- Cyclomatic complexity, instability, debt score -> **ordered**, so use position or area or luminance.
- Module / package / language / owner -> **categorical**, so use hue or shape.
- Pairing them — e.g., size = complexity, hue = module — works because the channels target different data types.

Munzner also warns about **separability vs integrality**: size and color are largely separable (read independently), but two color channels (hue + saturation) are not. Don't stack two color encodings.

## 8. Anti-Patterns

- **Rainbow / jet palette for ordinal data** — non-monotonic luminance creates fake banding (yellow-red kink). Use viridis / magma / cividis or a single-hue sequential ramp; use a diverging ramp only when there is a meaningful zero.
- **3D bars / 3D pies** — perspective distortion violates area/volume rankings; Tableau and PowerBI deliberately don't ship 3D for this reason.
- **Too many encodings at once** — bubble charts past 4 channels (x, y, size, color) become unreadable; add a 5th and it's noise.
- **Redundant encoding without legend** — using both size and color for LOC tells the viewer nothing new while consuming a free channel.
- **Categorical hue on an ordinal metric** — common with "module color" applied to debt score; the brain treats hue as identity, not magnitude.
- **No reference line on a 2D metric scatter** — NDepend's main sequence works because the diagonal is drawn; a raw I-A scatter is unreadable without it.
- **Animated transitions without stable layout** — refreshing a Voronoi treemap with a fresh layout each tick destroys spatial memory.

## Codewatch Overlay Spec

Mapping codewatch metrics -> recommended encoding -> recommended view.

| Metric | Data type | Encoding | Primary view | Secondary view |
|---|---|---|---|---|
| File / class / function size (LOC) | Ordered | Area (rectangle/circle) | Treemap | Code City height |
| Cyclomatic complexity | Ordered | Luminance (sequential, viridis) | Treemap color | Dep-graph node halo |
| Depth (nesting) | Ordered | Saturation step (3-4 bins) | Treemap border | Function-level X-ray |
| Fan-in | Ordered | Node radius | Dep graph | DSM column density |
| Fan-out | Ordered | Out-edge weight (line width) | Dep graph | DSM row density |
| Martin Instability (I) | Ordered, [0,1] | x-axis position | Main-sequence plot | — |
| Martin Abstractness (A) | Ordered, [0,1] | y-axis position | Main-sequence plot | — |
| Distance D from main sequence | Ordered | Point luminance, with `A+I=1` reference line drawn | Main-sequence plot | Treemap color overlay |
| Cohesion (LCOM-style) | Ordered | Node fill saturation | Dep graph | DSM diagonal density |
| Coupling strength | Ordered | Edge thickness; DSM cell numeric value | Dep graph + DSM | — |
| Doc coverage % | Ordered, [0,1] | Diverging color (red=0, neutral=target, green=1) | Treemap overlay | File list rating |
| Duplication / large-class / long-function smells | Categorical (typed) + ordered (severity) | Hue = smell type, saturation = severity, glyph icon | Treemap badge | Source-line gutter |
| Boundary cohesion (Louvain/Leiden Q) | Ordered, per-community | Hue per community + edge bundling by community | Dep graph | Voronoi treemap region |
| Churn (commits / time) | Ordered | Sequential luminance ramp | Hotspot circle-pack | Animated overlay on dep graph |
| Hotspot (complexity x churn) | Derived ordered | Size = complexity, color = churn (sequential) | Circle-pack / treemap | — |
| Author / owner | Categorical | Hue (one per developer, palette-limited) | Knowledge map (treemap) | Dep-graph node fill |
| Knowledge loss (departed author) | Boolean overlay | Hatched fill or icon badge | Knowledge map | — |
| Change coupling (temporal) | Ordered edge weight | Curved overlay edge between hotspots, separate from static deps | Dep graph (toggleable layer) | Chord diagram |

### Three default canvases for codewatch

1. **Hotspot circle-pack** — directory enclosure; size = LOC; color = complexity (sequential viridis); animated overlay = churn. This is the daily-driver view.
2. **Architecture dep graph** — module nodes; node size = fan-in; node color = instability (diverging around `I=0.5`); edge thickness = coupling; community-based edge bundling for boundary cohesion. Toggle layers: temporal coupling, ownership, smell badges.
3. **Main-sequence plot** — per-package I vs A scatter with `A+I=1` reference, "Pain" and "Uselessness" zones shaded; point size = LOC; point luminance = D.

Treemap (size=LOC, color=any chosen metric) and DSM (for cycle hunting) are secondary, opened on demand.

### Encoding rules to bake in

- One sequential palette (viridis-family) and one diverging palette (red-white-green or BrBG) shipped; rainbow disabled.
- Categorical channels reserved for module / owner / smell-type; cap at ~8 hues, fall back to shape or pattern beyond that.
- Every chart with a metric scale ships a legend and a reference value where one exists (target coverage, `A+I=1`, healthy code-health threshold).
- Layer toggles, never stacked-by-default — reviewers add overlays one at a time so each one teaches a question.
- Stable layout across refreshes (deterministic seed for force-directed; stable Voronoi for treemaps) so visual diff between snapshots reads as change, not relayout.

## Sources

- [CodeScene Hotspots documentation](https://codescene.io/docs/guides/technical/hotspots.html)
- [CodeScene Code Biomarkers](https://docs.enterprise.codescene.io/versions/3.6.0/guides/technical/biomarkers.html)
- [CodeScene Knowledge Distribution](https://codescene.io/docs/guides/social/knowledge-distribution.html)
- [CodeScene X-Ray](https://codescene.io/docs/guides/technical/xray.html)
- [SonarQube Visualizations](https://docs.sonarsource.com/sonarqube-server/8.9/user-guide/visualizations)
- [NDepend Dependency Structure Matrix](https://www.ndepend.com/docs/dependency-structure-matrix-dsm)
- [NDepend Treemap of Code Metrics](https://www.ndepend.com/docs/treemap-visualization-of-code-metrics)
- [NDepend 100+ Code Metrics (Abstractness, Instability, D)](https://www.ndepend.com/docs/code-metrics)
- [Wettel & Lanza, CodeCity: 3D Visualization of Large-Scale Software (ICSE 2008)](https://wettel.github.io/download/Wettel08a-icse-tooldemo.pdf)
- [Balzer et al., Voronoi Treemaps for the Visualization of Software Metrics](https://graphics.uni-konstanz.de/publikationen/Balzer2005VoronoiTreemapsVisualization/index.html)
- [Hahn et al., Stable Voronoi Treemaps for Software Quality Monitoring](https://www.sciencedirect.com/science/article/abs/pii/S0950584916302828)
- [Tornhill, Software Design X-Rays (Pragmatic Bookshelf)](https://pragprog.com/titles/atevol/software-design-x-rays/)
- [Tornhill, Code Maat (behavioral analysis tool)](https://github.com/adamtornhill/code-maat)
- [Cleveland & McGill 1984, Graphical Perception](http://euclid.psych.yorku.ca/www/psy6135/papers/ClevelandMcGill1984.pdf)
- [Munzner, Visualization Analysis and Design — Marks and Channels](https://www.cs.ubc.ca/~tmm/vadbook/)
- [Moreland, Color Map Advice for Scientific Visualization](https://www.kennethmoreland.com/color-advice/)
- [CET Perceptually Uniform Colour Maps](https://colorcet.com/)
- [Wilke, Fundamentals of Data Visualization — No 3D](https://clauswilke.com/dataviz/no-3d.html)
- [Code Climate 10-Point Technical Debt Assessment](https://codeclimate.com/blog/10-point-technical-debt-assessment)
