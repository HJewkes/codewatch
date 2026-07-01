# Codewatch Dashboard — Information Architecture & Concept

**Status:** design proposal (v1 scope + later)
**Audience:** repo maintainer + LLM agent answering "where do I look, and why" without re-reading the repo
**Component lib:** @titan-design/react-ui (dark-first, Tailwind/NativeWind + Gluestack)
**Existing surface:** one Cytoscape.js dep-graph HTML file. This dashboard is the coordinated "front door" that *contains and links to* that graph, not a replacement.

---

## 0. Design thesis (the opinionated core)

Three principles drive every decision below:

1. **One object model, many lenses.** Every view is a projection of the same node (file/module/package). The unit of navigation is the **node dossier** (a Drawer). Any metric, any table row, any graph node opens the *same* dossier. This is what makes it "coordinated" — you never lose the thing you were looking at when you switch lenses.

2. **Answer "where do I look" in one screen, "why" in one click.** The Overview must rank-order attention. Everything else is drill-down. If the maintainer only ever opens the Overview, it should still be worth it.

3. **Deltas over absolutes.** A raw complexity number is noise; "this file crossed the hotspot threshold since last snapshot" is signal. The dashboard is snapshot-aware everywhere — every KPI carries a trend, every list is filterable to "new since baseline."

---

## 1. Overall Information Architecture

### 1.1 Navigation model

A persistent left **Sidebar** (Titan Sidebar) with 7 destinations, a global top bar (search + global filters + snapshot selector), and a right-side **Node Dossier Drawer** that is shared across all views.

```
┌───────────────────────────────────────────────────────────────────────┐
│ TOPBAR:  [repo ▾]   🔍 search   | filters: pkg▾ role▾ window▾ sev▾ |  snapshot: [main@a1b2 ▾] vs [baseline ▾]  ⌘K │
├──────────┬────────────────────────────────────────────────┬───────────┤
│ SIDEBAR  │  MAIN VIEW (routed)                             │ DOSSIER   │
│ ▸Overview│                                                 │ (Drawer,  │
│ ▸Hotspots│                                                 │  opens on │
│ ▸Arch    │                                                 │  node     │
│ ▸Ownership                                                 │  select)  │
│ ▸Coupling│                                                 │           │
│ ▸Fitness │                                                 │           │
│ ▸Drift   │                                                 │           │
│ ──────── │                                                 │           │
│ Saved ▾  │                                                 │           │
│ Explain⌘E│                                                 │           │
└──────────┴────────────────────────────────────────────────┴───────────┘
```

### 1.2 The seven top-level views

| # | View | Answers | Primary canvas | Canonical from vision doc |
|---|------|---------|----------------|---------------------------|
| 1 | **Overview** | "What's the health, what changed, where do I look first?" | KPI band + hero widgets | strategic report / debt index |
| 2 | **Hotspots** | "Which files are risky (churn × complexity)?" | Treemap (LoC × churn, color=complexity) | hotspot treemap |
| 3 | **Architecture** | "How is the system layered / are boundaries clean?" | Sugiyama-layered dep graph + main-sequence scatter (tab) | Sugiyama graph + main-sequence plot |
| 4 | **Ownership** | "Where is knowledge siloed (bus-factor=1)?" | Ownership table + bus-factor heat treemap | knowledge-silo risks |
| 5 | **Coupling** | "What changes together but isn't structurally linked?" | Chord/matrix of change-coupling clusters | tight coupling clusters |
| 6 | **Fitness** | "What rules are violated vs baseline (new vs carryover)?" | Violations table grouped by rule | fitness checks |
| 7 | **Drift** | "What changed over time / vs a baseline?" | Timeline scrubber + delta report | history / report --vs |

### 1.3 Cross-linking (the coordination layer)

Every view emits and consumes a **selected node** and a **filter set**. Key journeys:

- **Hotspot treemap tile → dossier → "View in graph"** button → Architecture view with that node focused + neighbors expanded.
- **Dossier "Coupled files" chip → Coupling view** filtered to that node's cluster.
- **Ownership row (bus-factor=1) → dossier → "Show churn trend"** sparkline → Drift view scrubbed to when it spiked.
- **Fitness violation row → dossier** anchored to the offending metric, with the pinned baseline value shown inline.
- **Any node → breadcrumb** `pkg › module › file` (Titan breadcrumbs); clicking a crumb re-scopes all views to that container.

The invariant: **selection + filters live in the URL** (`?node=src/foo.ts&pkg=core&window=30d&vs=v1.4.0`). Deep-linkable, agent-addressable, back-button-correct.

### 1.4 The shared Node Dossier (single most reused component)

Opens as a right Drawer from *any* node reference. Structure:

```
┌─ src/graph/indexer.ts ─────────────── [role: source] [◎ in graph] ─┐
│ Health 62 ▁▂▃▅▇ (▲ +8 since v1.4)          [Explain ⧉] [Copy JSON] │
├────────────────────────────────────────────────────────────────────┤
│ Metric      value   trend    vs-baseline   percentile-in-repo      │
│ LOC          412    ▂▃▅       +30          p88 ▓▓▓▓▓▓▓▓░░           │
│ Cognitive    340    ▁▃▇       +52 ⚠        p97 ▓▓▓▓▓▓▓▓▓▓ (scary)   │
│ Cyclomatic    88    ▂▄▆       +11          p91                     │
│ Fan-out       23    ▃▃▃       +2           p84                     │
│ Instability  0.79   ──        ±0           p72                     │
│ Churn 30d     41    ▁▇▇       +28 ⚠        p95                     │
│ Bus factor     1    ──        ±0  🔴       — (siloed: @hjewkes 94%)│
│ Test cover    1 test, test-bus-factor 1  🟠                        │
├────────────────────────────────────────────────────────────────────┤
│ ▸ Coupled with (change-coupling):  parser.ts .82 · db.ts .61  →Coupling│
│ ▸ Imports (fan-out): 23   ▸ Imported by (fan-in): 4   →Graph        │
│ ▸ Violations: max-cyclomatic (88 > 60, NEW) · scary-hotspot (NEW)  │
│ ▸ Owners: @hjewkes 94% · @dep 6%   ▸ Last touched 2d ago           │
└────────────────────────────────────────────────────────────────────┘
```

Every list of related nodes is a set of clickable Chips that swap the dossier or jump to a view. This is the connective tissue.

---

## 2. The Front Door — Overview

The most useful at-a-glance screen. Job: rank attention and surface deltas.

### 2.1 KPI band (Titan Metric tiles, 6 across, each with trend arrow vs last snapshot)

| Tile | Value | Trend basis | Drill target |
|------|-------|-------------|--------------|
| **Debt Index** | 0–100 composite (weighted: scary-hotspots, violation count, silo count, modularity penalty) | vs baseline snapshot | Overview → expands methodology tooltip |
| **New Hotspots** | count churn×complexity crossings | since baseline | Hotspots (filtered new) |
| **Knowledge Silos** | count bus_factor=1 on high-centrality files | vs baseline | Ownership |
| **Boundary Health** | modularity Q + layering violations count | vs baseline | Architecture |
| **Open Violations** | total (▲ new / ▼ fixed split as sub-text) | carryover vs new | Fitness |
| **Instability Drift** | Δ mean instability | over window | Architecture main-seq |

Rule: each Metric shows value + directional arrow + semantic color (status-success/warning/error). Down-is-good metrics invert arrow coloring.

### 2.2 Hero widgets (2×2)

1. **Risk Radar** (top-left, novel): a small radial/spider surface over 5–6 axes (Complexity, Churn, Coupling, Silo risk, Boundary, Test-gap). Two overlaid polygons: current vs baseline. Instantly shows *which dimension* of health regressed. Click an axis → that view.
2. **Top 8 Attention list** (top-right): ranked DataRows, each = filename + a **health sparkline** + top-reason badge ("scary-hotspot", "silo", "new violation") + mini metric. This is the literal "where do I look" answer. Click → dossier.
3. **"What changed since &lt;baseline&gt;"** (bottom-left): a compact changelog-style feed — "3 files crossed hotspot threshold", "indexer.ts cognitive +52", "2 violations fixed", "1 file moved src/a→src/b". Each line links to Drift or dossier.
4. **Hotspot mini-treemap** (bottom-right): dense preview of the full Hotspots treemap; click → Hotspots view. Gives spatial "shape of the debt" at a glance.

### 2.3 Overview wireframe

```
┌ OVERVIEW · main@a1b2  vs  v1.4.0 ─────────────────────────────────────────┐
│ ┌Debt Index┐┌New Hotspot┐┌Knowledge┐┌Boundary┐┌Violations┐┌Instab.Drift┐ │
│ │   68  ▲7 ││   3   ▲3  ││ Silos 5 ││  Q .41 ││ 24       ││   +0.04 ▲   │ │
│ │ (worse) ││ status-err││  ▲1 🔴  ││  ▼ 🟠  ││+6 new/-2 ││  (worse)    │ │
│ └──────────┘└───────────┘└─────────┘└────────┘└──────────┘└─────────────┘ │
│ ┌── RISK RADAR (curr vs base) ──┐ ┌── TOP 8: WHERE TO LOOK ───────────┐  │
│ │        Complexity              │ │ indexer.ts   ▁▃▇  [scary ·NEW]  ⚠ │  │
│ │      ◹        ◸                 │ │ parser.ts    ▂▅▇  [coupling .82] │  │
│ │  Test◁   ╳base  ╳curr  ▷Churn  │ │ auth.ts      ▇▇▇  [silo bf=1] 🔴 │  │
│ │      ◺        ◹                 │ │ db/pool.ts   ▁▂▇  [new viol]     │  │
│ │  Boundary   Silo  Coupling     │ │ … (click → dossier)              │  │
│ └────────────────────────────────┘ └───────────────────────────────────┘  │
│ ┌── WHAT CHANGED SINCE v1.4.0 ──┐ ┌── HOTSPOT MAP (preview) ──────────┐  │
│ │ • 3 files crossed hotspot thr. │ │ ┌───┬──┬─┐ ┌────┐  (size=LoC×chn │  │
│ │ • indexer.ts cognitive +52 ⚠  │ │ │███│░░│▓│ │▒▒▒▒│   color=cmplx)  │  │
│ │ • 2 violations fixed ✓         │ │ ├───┴┬─┴─┤ ├──┬─┤   →Hotspots     │  │
│ │ • auth.ts moved core→security  │ │ │▓▓▓▓│░░░│ │██│░│                 │  │
│ └────────────────────────────────┘ └───────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Per-view designs

### 3.1 Hotspots  ★ (wireframe below)

- **Primary canvas:** treemap. Rect **size = LoC × churn**, **fill = complexity** (data-1..data-10 ramp), **border = red** if crosses scary-hotspot threshold. Nested by package → module → file.
- **Secondary:** ranked Table (toggle via Tabs: "Map" / "Table") with columns LoC, churn_30d, cognitive, cyclomatic, scary-score, Δ-vs-baseline, health sparkline. Sortable all columns.
- **Filters:** package, role (default: source+test only, hide fixtures/config), window (7/30/90d), "new since baseline" toggle, min-score slider.
- **Interactivity:** hover tile → tooltip mini-metrics; click tile → dossier; "View in graph" from dossier; treemap zoom (click package to descend, breadcrumb to ascend). Chip to switch color encoding (complexity ↔ bus-factor ↔ Δchurn).

```
┌ HOTSPOTS · window 30d · [✓ source] [✓ test] [ ] new-only ── Map|Table ─┐
│ pkg: core › (click to zoom out)         color: [complexity ▾]  min:▓░░ │
│ ┌────────────────────┬───────────┬──────────────┐                     │
│ │ indexer.ts         │ parser.ts │ walker.ts    │  ← size = LoC×churn │
│ │ ███████ scary ⚠    │ ▓▓▓▓      │ ▒▒▒          │    fill = complexity │
│ │ cog340 chn41       │ cog120    │ cog60        │    red border=scary  │
│ ├──────────┬─────────┼─────┬─────┴──────────────┤                     │
│ │ db.ts    │ pool.ts │ x.ts│  emit.ts           │                     │
│ │ ▓▓▓▓▓    │ ░░       │ ░   │  ▒▒▒               │                     │
│ └──────────┴─────────┴─────┴────────────────────┘                     │
│ Legend: fill 1▁──10▇  · ⚠=crossed threshold this snapshot             │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Architecture  ★ (wireframe below)

Two tabs sharing filters and selection:

- **Tab A — Layered dep graph (Sugiyama):** package/module DAG, layered top-down. This *embeds/links the existing Cytoscape surface* but adds layered layout + violation overlay. Back-edges (layering violations) drawn red. Node fill = PageRank centrality. Filter chips reuse the existing ones (kind/edge/role/violation). Click node → dossier.
- **Tab B — Main-sequence plot (NDepend-style):** scatter, x = instability (I), y = abstractness (A), diagonal = "main sequence." Distance from diagonal = "zone of pain / zone of uselessness." Point size = LoC, color = churn. Package-level by default, drill to module. This is the pure-scatter primitive.

```
┌ ARCHITECTURE ·  [ Layered Graph ] [ Main Sequence ] ──────────────────┐
│ MAIN SEQUENCE            A (abstractness)                              │
│ 1 ┤ zone of            ·                                              │
│   │ uselessness    · ·        ╲ main sequence                        │
│   │            ·          ╲                                          │
│   │        ·         ╲                                               │
│   │    ● core     ╲          ● utils                                 │
│   │ ╲          ● parser                                              │
│ 0 ┤────────────────────●db────────── zone of pain →                  │
│   └────────────────────────────────────────────  I (instability) 1  │
│   size=LoC · color=churn · click pkg → drill to modules → dossier    │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Ownership / Bus-factor

- **Primary:** Table sorted by risk = centrality × (bus_factor==1). Columns: file, top-author, top-author-share %, bus_factor_Nd, linked_test_count, test_bus_factor, PageRank. Rows with bus_factor=1 AND high PageRank badged 🔴.
- **Secondary widget:** bus-factor heat treemap (fill = top-author share, so deep-red = one person owns it all).
- **Filters:** package, min-centrality, author (spotlight one person → "the bus-factor map for @X").
- **Interactivity:** click author chip → filter everything to their surface (great for offboarding risk). Cross-link: "this silo is also a hotspot" badge → Hotspots.

### 3.4 Coupling

- **Primary:** dependency matrix (DSM) or chord diagram of change-coupling clusters — co-edited file pairs with support/confidence. Highlight pairs with **high change-coupling but no structural import edge** ("hidden coupling" — the most actionable signal).
- **Table fallback:** ranked file-pairs (fileA, fileB, co-change count, confidence, structural? yes/no).
- **Filters:** min support, min confidence, "hidden only" toggle, package.
- **Interactivity:** click a pair → both dossiers side-by-side; "explain why coupled" → shows shared commits (from churn data).

### 3.5 Fitness / Violations

- **Primary:** Table grouped by rule (max-file-loc, max-cyclomatic, max-nesting, max-fan-out, layered-deps, scary-hotspots, no-internal-only-barrels). Each group header = rule + baseline value + count (new vs carryover as Badges).
- **Prominent split:** **NEW** violations (status-error) vs **carryover** (status-warning) vs **fixed** (status-success, collapsible). New is what a maintainer acts on.
- **Filters:** rule, severity, new-only, package. Alert banner if any *new* violation breaks a pinned baseline.
- **Interactivity:** row → dossier anchored to offending metric with baseline inline. "Suppress/annotate" affordance (later). Copy-as-JSON for agent.

### 3.6 Drift / History  ★

- **Primary:** **timeline scrubber** across snapshots. Drag handle → all KPIs and lists reflect that point; drag a *range* → diff mode (this reuses `report --vs`). Trend lines for Debt Index, mean complexity, modularity Q, violation count.
- **Below:** the reconstructed delta report — new hotspots, complexity deltas (top movers ± ), moved/renamed files, resolved silos.
- **Interactivity:** click any point on a trend line → that snapshot becomes the comparison baseline everywhere (sets `?vs=`). "Top movers" table sortable by |Δ|.

```
┌ DRIFT · scrub or select range to diff ────────────────────────────────┐
│ Debt ▁▂▃▄▅▆▇█  ●───────●═══════●─────◆  (◆=HEAD, ●=snapshot)          │
│ v1.2   v1.3      v1.4        v1.5  now                                 │
│      [◀ handleA ]        [ handleB ▶]   comparing v1.4 → now          │
│ ┌ TOP MOVERS (Δ cognitive) ─────────┐ ┌ EVENTS ───────────────────┐   │
│ │ indexer.ts   +52 ▁▃▇  →dossier    │ │ +3 hotspots  -2 violations │   │
│ │ parser.ts    +18 ▂▅▇              │ │ auth.ts moved  1 silo new  │   │
│ │ util.ts      -9  ▇▅▂ (improved ✓) │ │                            │   │
│ └────────────────────────────────────┘ └────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Novel status-communication ideas (ranked by value / effort)

| Idea | What | Value | Effort | v1? |
|------|------|-------|--------|-----|
| **1. Health sparkline per file** | tiny inline trend of a file's health/churn across snapshots; used in every table & dossier | ★★★★★ | ★★ | **v1** |
| **2. "Where to look" Top-N attention list** | single ranked list with reason badges; the literal front-door answer | ★★★★★ | ★ | **v1** |
| **3. Debt Index composite + trend** | one number leaders track; must be transparent (tooltip shows the weighted breakdown) | ★★★★☆ | ★★ | **v1** |
| **4. Agent "Explain / Copy JSON" affordance** | every view + dossier emits a structured JSON summary ("this is why this file is flagged") for the LLM audience; ⌘E copies current view as agent-ready markdown+JSON | ★★★★★ | ★★ | **v1** |
| **5. Hotspot treemap** | spatial shape of debt, LoC×churn / complexity | ★★★★☆ | ★★★ | **v1** |
| **6. Risk Radar** | 5–6 axis current-vs-baseline polygon; which *dimension* regressed | ★★★★☆ | ★★★ | v1.1 |
| **7. Reading Order ("start here")** | computed minimal set of files to understand the repo — rank by PageRank centrality × coverage of import graph (greedy set-cover over reachable nodes); output an ordered guided list w/ "why this next." Killer for onboarding + agents | ★★★★★ | ★★★★ | v1.1 |
| **8. Drift timeline scrubber** | scrub/range-diff snapshots, reuses report --vs | ★★★★☆ | ★★★★ | v1.1 |
| **9. Main-sequence scatter** | I vs A, zone-of-pain | ★★★☆☆ | ★★★ | v1.1 |
| **10. Hidden-coupling highlighter** | change-coupled but no import edge | ★★★★☆ | ★★★ | v1.1 |
| **11. Bus-factor "offboarding sim"** | pick an author → what turns red if they leave | ★★★★☆ | ★★★ | later |
| **12. Health-score gauge** | radial gauge for Debt Index on Overview | ★★☆☆☆ | ★★ | optional |

**Reading Order** deserves emphasis: it directly serves the stated audience ("understand the repo without re-reading it"). Algorithm sketch: rank nodes by PageRank; greedily pick the node that maximizes newly-covered import-reachable surface; stop at ~80% coverage or N=12; annotate each with role + one-line "why." Present as a Stepper.

---

## 5. Interactivity & filtering as a workflow

**Global filters (top bar, persist in URL, apply to all views):**
- **Package** (Select, multi) — scope to a subtree.
- **Role** (Chips) — source / test / fixture / barrel / types / config / script. Default: source+test.
- **Window** (Select) — 7 / 30 / 90d for churn-based metrics.
- **Severity** (Chips) — for violations/hotspots.
- **Snapshot / baseline** (two Selects) — current + `vs` comparison. This is the spine of "deltas over absolutes."

**Search (⌘K command palette):** fuzzy over files/packages/authors + actions ("go to Hotspots", "compare vs v1.4", "filter to @author"). Selecting a file opens its dossier from anywhere.

**Saved views:** name a filter+view+selection combo (e.g. "core hotspots, new-only, 30d"). Stored in localStorage + shareable via URL. Sidebar "Saved" section. Ships a few defaults: "New this week," "Silo risks," "Zone of pain."

**Keyboard affordances:**
- `⌘K` palette, `⌘E` explain/copy-JSON, `g h/a/o/c/f/d` go-to-view, `j/k` move selection in tables, `x` toggle dossier, `[`/`]` step snapshot, `/` focus search, `f` focus filters, `?` shortcut cheatsheet.

**Empty/loading states:** Titan Skeleton while indexing; EmptyState for "no violations 🎉 / no snapshots yet — run `codewatch snapshot`." Every view degrades gracefully on a single-snapshot repo (trends show "no baseline yet").

---

## 6. Missing Titan charting primitives (to build/contribute upstream)

Titan has color tokens (data-1..10) but no charts. Needed, in priority order:

| Primitive | Used by | Notes for upstream |
|-----------|---------|--------------------|
| **Sparkline** | dossier, every table, Top-N list, KPI tiles | tiny, no-axis line/bar; must accept data-token color + status color; SVG, ~small. Highest leverage — reused everywhere. |
| **Treemap** | Hotspots, bus-factor heat, Overview preview | squarified layout, nested (drill), size + fill encodings, hover tooltip, click select. |
| **Scatter / bubble plot** | Architecture main-sequence, coupling density | x/y/size/color encodings, diagonal reference line + shaded zones, quadrant labels, zoom/brush. |
| **Radial gauge** | Debt Index, health scores | 0–100 arc with threshold bands + trend delta. |
| **Timeline / range scrubber** | Drift | single-handle scrub + two-handle range select over discrete snapshots; emits selection. |
| **Radar / spider** | Risk Radar | N-axis polygon, 2 overlaid series (current vs baseline). |
| **DSM matrix / chord** (later) | Coupling | ordered adjacency matrix w/ cell heat, or chord; lower priority — table works for v1. |

All should: consume Titan semantic + data tokens, be dark-first, keyboard/tooltip-accessible, and render in react-native-web (SVG-based, avoid canvas-only libs for RN compat). Recommend building **Sparkline, Treemap, Scatter, Gauge** as the first upstream chart bundle since v1 depends on them.

---

## 7. Shippable v1 vs later

**v1 (front door that already earns its keep):**
- Sidebar + top-bar global filters + snapshot/baseline selector + URL state.
- **Overview** (KPI band, Top-N attention list, "what changed" feed, hotspot mini-treemap). Risk Radar can slip to 1.1 if radar primitive isn't ready — replace with a 3rd KPI row.
- **Hotspots** (treemap + table).
- **Fitness** (grouped violations, new vs carryover).
- **Node Dossier Drawer** with sparklines + metric table + cross-link chips.
- **Explain / Copy-JSON** affordance.
- Reuse existing Cytoscape graph, linked from dossier "View in graph" (iframe/embed) rather than rebuilding — defer the Sugiyama rebuild.
- Primitives needed: **Sparkline + Treemap** (+ Gauge optional).

**v1.1:**
- Architecture view (layered graph rebuild + main-sequence scatter), Ownership view, Risk Radar, Reading Order, Drift scrubber.
- Primitives: Scatter, Radar, Timeline.

**Later:**
- Coupling DSM/chord, offboarding simulation, saved-view sharing server-side, annotations/suppressions on violations.

**Sequencing rationale:** Overview + Hotspots + Fitness + Dossier answer "where do I look and why" for a maintainer *today* with only two new chart primitives. Architecture and Drift are higher-effort and can follow once the object-model/dossier plumbing is proven.
