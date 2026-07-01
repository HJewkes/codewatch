# codewatch dashboard

A static, single-file **project-status dashboard** for a codewatch graph snapshot.
It answers *"where do I look, and why"* at a glance — the same question the CLI
report answers, in a coordinated, navigable surface.

> Status: **prototype** (v0). Built to validate the approach with real data and
> pathological repos. Not yet wired into a `graph dashboard` CLI command.

## What it is

- **React + [`@titan-design/react-ui`](https://github.com/HJewkes/titan-design)**, bundled by Vite +
  `vite-plugin-singlefile` into **one self-contained `index.html`** — the same
  distribution model as the `render` package's Cytoscape graph (open the file,
  no server). Renders via `react-native-web` (NativeWind).
- Consumes a single JSON payload (`CodewatchData`, see `src/types.ts`) injected
  as `window.__CODEWATCH__`, produced from `graph report --json` + `graph check`
  by `scripts/build-data.mjs`. Falls back to a bundled sample.

## Views

Seven views, each a lens on the same object model (click any file → shared Dossier drawer):

| View | Answers | Key widgets |
|---|---|---|
| **Overview** | where to look first | 6 KPI tiles, health **Gauge**, **Risk radar** (6 axes), **Reading order** (smallest set to grok the repo), ranked "where to look" list, hotspot **treemap**, "what changed" |
| **Hotspots** | which files are risky | package filter, treemap, sortable table (churn/complexity/score) |
| **Architecture** | which packages are structurally off | package **main-sequence** scatter (instability I × abstractness A) with the zone-of-pain/uselessness diagonal; packages ranked by distance |
| **Coupling** | what changes together | co-edit pairs ranked; **hidden-coupling** highlighter (co-changed, no import edge) |
| **Ownership** | who's the bus factor | single-owner list; explicit **N/A** on single-author repos |
| **Fitness** | are the rules holding | new/carry/fixed tallies, violations grouped by rule, empty-state when clean |
| **Drift** | what moved since baseline | new/worsened/improved/resolved hotspots, new silos, new coupling |

Global: **file-filter search** (`/`), **keyboard nav** (1–7 switch views, Esc clears), **URL deep-linking** (`#view?node=…&q=…`), **window switcher** (30/90/180d, pre-computed), and **Copy JSON** for agents.

The Architecture chart primitives (Treemap, Scatter, Gauge) live in `@titan-design/react-ui` (contributed upstream). Abstractness is a proxy — the share of `role=types` files per package — since codewatch has no symbol-level abstract/concrete counts.

A shared **Dossier drawer** (click any file, anywhere) is the "one object, many
lenses" spine: churn×complexity, bus factor, centrality, change-coupled
partners (incl. *hidden* coupling), and violations for that node. Selection
persists across views. A **Copy JSON** button hands the whole payload to an
agent.

## Degenerate-data resilience

Screenshotted against real codewatch data **and** four synthesized pathologies
(`scripts/edge-fixtures.mjs`), because first-impression trust dies on messy
repos:

- **Dormant** (no churn in window) → warning banner with a "widen the window"
  hint instead of blank panes (mirrors the CLI's C-23 fix).
- **Outlier** (one file 285× the next) → treemap uses a **sqrt area scale** so a
  single mega-file can't annihilate every other tile.
- **Huge** (10k+ files) → treemap folds to "top-N + `+M more`"; truncation is
  always labeled.
- **Single-author** → ownership widgets say *N/A* rather than a meaningless 100%.

## Develop

```sh
npm install
npm run dev            # vite dev server (uses the bundled sample)
npm run build          # → dist/index.html (single file)
npm run typecheck

# generate data from a real snapshot and screenshot it
node scripts/build-data.mjs --report report.json --check check.txt --out data/real.json
node scripts/inject.mjs dist/index.html data/real.json data/real.html
```

This app is intentionally **outside** the pnpm workspace (`packages/*`) so its
React / react-native-web dependency tree stays out of the core lib monorepo. It
couples to codewatch only through the exported JSON — the loose "viz reads the
data" boundary from `docs/vision.md`.
