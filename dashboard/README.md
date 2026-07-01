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

| View | Answers | Key widgets |
|---|---|---|
| **Overview** | where to look first | 6 KPI tiles, ranked "where to look" list w/ reason badges, hotspot **treemap**, "what changed vs baseline" |
| **Hotspots** | which files are risky | package filter, treemap, sortable table (churn/complexity/score) |
| **Fitness** | are the rules holding | new/carry/fixed tallies, violations grouped by rule, empty-state when clean |
| **Ownership** | who's the bus factor | single-owner list; explicit **N/A** on single-author repos |

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
