# Project-status dashboard — design & v0 prototype

_2026-06-30. Synthesis doc. Companion artifacts: [`dashboard-ia.md`](./dashboard-ia.md)
(information architecture), [`dashboard-edge-cases.md`](./dashboard-edge-cases.md)
(degenerate-data catalog), and [`../research/12-interactive-html-viz.md`](../research/12-interactive-html-viz.md)
(stack选型). Prototype lives in [`/dashboard`](../../dashboard)._

## Why

codewatch answers "where do I look, and why" in the CLI report. The vision doc
(Move 1 `render`, Move 7 strategic report) always intended a **visual** surface
too. This is that surface: a coordinated, navigable **project-status dashboard**
— not a second graph viewer, but the higher-level "front door" that
rank-orders attention and drills into the existing lenses.

## Thesis (3 principles)

1. **One object model, many lenses.** Every row, tile, and node is a projection
   of the same file, and they all open the *same* Dossier drawer. Switching
   views never loses your object. That's what makes it "coordinated."
2. **"Where to look" in one screen, "why" in one click.** The Overview
   rank-orders; everything else is drill-down.
3. **Deltas over absolutes.** Snapshot/baseline-aware everywhere: every KPI
   carries a trend, every list can filter to "new since baseline."

## Architecture decision

Build as **React + `@titan-design/react-ui`**, bundled by Vite +
`vite-plugin-singlefile` to **one self-contained HTML** via `react-native-web`.
This was the crux question — Titan is a React-Native/NativeWind library and
codewatch ships static single-file artifacts. A spike proved the combination
works (NativeWind's babel preset + Titan's exported tailwind config +
`viteSingleFile`), so we get Titan's component system **and** codewatch's
"open the file, no server" distribution model. The dashboard couples to the
core only through exported JSON (`graph report --json` + `graph check`), keeping
its heavy dependency tree out of the pnpm lib monorepo.

## Information architecture

Left **Sidebar** (Titan) · top bar (window / version / baseline pills, file
count, **Copy JSON** for agents) · content · shared right **Dossier drawer**.

Seven views were designed; **four shipped in v0**: Overview, Hotspots, Fitness,
Ownership. (Architecture graph — reuse the existing Cytoscape render; Coupling
and Drift — v1.1.) Each view maps to a CLI report section and a canonical
canvas. Cross-links are concrete: hotspot tile → dossier → coupled partner →
Ownership; violation → the offending file's dossier.

See `dashboard-ia.md` for full wireframes and the seven-view plan.

## v0 prototype — what's built

- **Overview**: 6 KPI tiles (Titan `Metric`), a ranked **"where to look first"**
  list with reason badges (scary hotspot / bus factor 1 / violation), a hotspot
  **treemap**, and a "what changed vs baseline" strip.
- **Hotspots**: package filter, treemap, sortable Titan `Table`.
- **Fitness**: new/carry/fixed tallies, violations grouped by rule, Titan
  `EmptyState` when clean.
- **Ownership**: single-owner list with explicit **single-author N/A** handling.
- **Dossier drawer**: churn×complexity, bus factor, centrality, change-coupled
  partners (incl. *hidden* coupling — change-coupled but no import edge), and
  per-node violations. Persists across views.
- **Copy JSON**: hands the whole payload to an agent (the LLM audience).

Validated with **playwright screenshots** against real codewatch data and four
synthesized pathologies (below). One real bug caught by the screenshot loop: an
extreme-outlier file annihilated the treemap under a linear area scale → fixed
with a **sqrt area scale**.

## Degenerate-data resilience (the messy-repo mandate)

First-impression trust dies on real, poorly-structured repos. Every widget has
four distinct states — loading / empty / **N/A** / populated — never a blank
pane; every truncation is labeled "top N of M"; heavy-tailed metrics use
compressive scales. P0 cases handled (see `dashboard-edge-cases.md` for all 9
categories + acceptance criteria):

| Pathology | Failure it would cause | Handling |
|---|---|---|
| Dormant (no churn in window) | 4 blank sections read as "broken" | warning banner + "widen `--window-days`" hint (the CLI's C-23 fix, mirrored) |
| Outlier (one file 285× the next) | treemap collapses to a sliver | **sqrt** area scale |
| Huge (10k+ files) | hairball / unbounded table | treemap "top-N + `+M more`"; labeled truncation |
| Single-author | ownership saturates at 100% | explicit **N/A** message |
| Script/archive noise | one-off scripts swamp hotspots | upstream `script` role default-excluded (C-23) |

## Titan contributions surfaced

Titan has chart color tokens (`data-1..10`) but few chart primitives. Gaps, in
priority order: **Treemap** (built here, to upstream), Scatter/bubble
(main-sequence: instability × abstractness), Radial gauge, Timeline
range-scrubber, Radar/spider, DSM/chord. `Sparkline` already exists in Titan and
should be reused for per-file health trends.

## Roadmap (status as of 2026-06-30)

- **v0 ✅ shipped:** static single-file app; Overview/Hotspots/Fitness/Ownership;
  Dossier; Copy-JSON; treemap + edge-case resilience.
- **v1 ✅ shipped:** `graph dashboard --out report.html` inlines the built bundle
  + data (gzip+base64 asset); Treemap upstreamed to Titan (#41).
- **v1.1 ✅ shipped:** Coupling (hidden-coupling highlighter) + Drift views;
  global search + keyboard + URL routing; `--vs previous` fix.
- **v1.2 ✅ shipped:** **Architecture** main-sequence scatter (I×A + zone
  diagonal, Titan Scatter #44); **Risk Radar** + **Reading Order** + health
  **Gauge** on Overview; window switcher (30/90/180, content-deduped);
  abstractness proxy (type-file share). All 7 designed views live.
- **Still open (follow-ups):** real multi-window churn at index time (the
  switcher is built + honest but only lights up when `churn_{90,180}d` exist —
  today only `churn_30d` is stored); a real symbol-level abstractness (the A
  proxy is coarse); embedding the existing Cytoscape dependency graph as an
  Architecture sub-tab; Coupling DSM/chord; Drift timeline scrubber.
