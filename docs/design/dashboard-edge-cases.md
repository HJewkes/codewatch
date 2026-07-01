# Codewatch Dashboard — Messy/Pathological Repo Edge-Case Catalog

Goal: make the project-status dashboard **degrade gracefully and stay trustworthy** on real, poorly-structured repos. This catalog maps each pathology to the view/widget it breaks, *how* it breaks, and the concrete UX/data handling that fixes it — written to be turned into acceptance criteria and test fixtures.

## Grounding in the actual data model (verified against the codebase)
- **Node kinds** (`schema.sql`): `package | module | file | symbol | external`. `external` = out-of-repo deps.
- **Roles** (`types.ts` `NodeRole`): `test | fixture | barrel | types | config | script | source`.
  - **GAP FOUND:** `classifyRole()` in `packages/graph/src/roles.ts` has regexes for test/fixture/barrel/types/config only — there is **no `script`/`archive` regex**, and `ALL_ROLES` omits `script`. So `scripts/*.ts` and `archive/**` currently fall through to `source` and will pollute src-scoped views (directly relevant to Category 2). The role exists in the type but is never assigned.
- **Metrics** (actual `name` values): `loc`, `cognitive_sum`, `cognitive_max`, `cyclomatic`, `nesting_depth`, `comment`, `fan_in`, `fan_out`, `instability`, `lcom4`, `churn_7d|churn_30d|churn_90d` (+ `_commits`, `_authors` variants), `bus_factor`, `pagerank`. `metric.value` is `REAL` and **nullable** — undefined/NaN is a first-class state, not a bug.
- **Churn** (`churn.ts`): git `log --since=<N>.days.ago --numstat`, default window **30d**, keyed off `%ae` (author email). `runGitLog()` returns **`null`** when git is absent/fails/shallow — so churn-null is an expected, common state (dormant repos, tarball checkouts, CI shallow clones).
- **Index version** (`indexer.ts`): `INDEX_VERSION = "0.2.0"`, stored per snapshot. `snapshotVersionMismatchWarning()` already emits a text warning on mismatch — today it's only advisory text; the dashboard must surface it visually and gate comparisons.
- **Analysis is TypeScript-only** (`walkTypeScriptFiles`, `TS_LANGUAGES=["typescript"]`): non-TS files are invisible to structure/metrics but still exist in git churn. This creates churn-without-node mismatches (Category 7/8).

---

## Priority ranking (likelihood × first-impression damage)

| # | Pathology | Likelihood | Damage to trust | Priority |
|---|-----------|-----------|-----------------|----------|
| 1 | Dormant repo (empty churn window) | High | High (looks broken — confirmed real) | **P0** |
| 5 | Outlier/skew destroys scales & treemap | High | High | **P0** |
| 2 | Script/archive noise buries src signal | High | High | **P0** |
| 4 | Single-author → bus-factor saturates | Very High | Medium-High (view says nothing) | **P0** |
| 3b | Huge repo → hairball graph / unpaginated tables | Medium | High (perf + unreadable) | **P1** |
| 6 | Missing structure (no tests, cycles, flat src) | High | Medium | **P1** |
| 8 | Data-quality gaps (NaN, window drift, version) | Medium | High (silent wrong numbers) | **P1** |
| 3a | Tiny repo → degenerate/empty charts | Medium | Medium | **P2** |
| 7 | Weird identity/paths (vendored, monorepo, no-ext) | Medium | Medium | **P2** |
| 9 | History gaps (1 snapshot, version boundary) | High | Medium | **P2** |

Cross-cutting principle: **every widget needs an explicit empty state and an explicit "not applicable" state, distinct from each other and distinct from "loading" and "zero".** The confirmed dormant-repo failure was 4 blank sections that read as *broken* rather than *nothing to show*.

---

## 1. Dormant repo (P0) — zero commits in the churn window

**(a) Pathological input:** No commits in the last 30d (or `runGitLog` returns null: no git, shallow clone, tarball). All `churn_*` metrics null/0. One snapshot only.

**(b) What breaks / how:**
- **Overview "what changed"** — nothing to diff against; renders blank or "0 changes" that reads as an error.
- **Hotspots (churn×complexity)** — churn axis is all-zero → every point collapses onto the y-axis; the table sorts by churn and shows an all-zero column; treemap has **no size signal** if sized by churn (all tiles equal or zero-area).
- **Ownership/bus-factor** — no commits ⇒ no authorship ⇒ bus_factor null everywhere.
- **Change-coupling** — needs co-change; zero co-change ⇒ empty cluster view.
- **Drift/history** — one snapshot ⇒ no trend lines.
- Confirmed real: this produced **4 empty sections that looked broken.**

**(c) Fix / UX:**
- Detect dormancy centrally: `commits_in_window == 0 || churn_source == null`. Set a dashboard-level flag `churnAvailable=false`.
- **Global banner** (info, not error): "No commits in the last 30 days — churn-based views are unavailable. Showing structural metrics only." Include a control to **widen the window** (7d→30d→90d→all-time) inline; if all-time is also zero, say "This repository appears dormant."
- Distinguish churn-null (no git) from churn-zero (git present, no commits in window) in the banner copy — different remedies.
- **Hotspots**: fall back to sizing treemap by `loc` and coloring by `cognitive_sum` (structural hotspots) with a caption "Sized by LOC · churn unavailable." Do **not** render an all-zero scatter — swap to a "complexity-only" ranked table.
- **Empty-state cards** with an icon + one sentence + a "why" tooltip, never a blank pane. Ownership/coupling/drift each render their own tailored empty state, not the generic one.
- **Acceptance criteria:** dormant fixture renders zero blank panes; every churn widget shows an explicit "churn unavailable" state; treemap still shows tiles sized by LOC; no console errors; banner offers window widening.

## 2. Script/archive noise (P0) — huge one-off files dominate hotspots

**(a) Pathological input:** `scripts/migrate-everything.ts` and `archive/2019/**` with `cognitive_sum` 200+, `loc` 3–8k. Real src files are <50 complexity.

**(b) What breaks / how:**
- **Because `classifyRole` never assigns `script`**, these files are `role=source` today. Every "top hotspots" list, treemap, and complexity KPI is **topped by throwaway code**, burying real `src/` signal. First impression: "the codebase is a disaster" when the disaster is one migration script.
- **Treemap** area dominated by a handful of giant archive tiles; real structure is a thin margin.
- **Architecture graph** — archive files with many imports inflate fan-out and PageRank of dead code.

**(c) Fix / UX:**
- **Fix the classifier first** (data layer): add `SCRIPT_RE` (e.g. `(?:^|\/)scripts?\/`, `\.script\.`, bin entrypoints) and an `archive`/`generated` signal (`(?:^|\/)(?:archive|generated|__generated__|\.gen)\/`). Add `script` to `ALL_ROLES`. This is a prerequisite; without a role tag the dashboard can't filter.
- **Default role filter**: dashboard defaults to `role IN (source, barrel, types)` for Hotspots/Overview KPIs, with a visible, one-click **"including scripts/archive: off"** toggle and a chip showing what's excluded ("Hiding 2 scripts, 14 archive files").
- **Treemap**: group non-source roles into a collapsed "non-product code" super-tile users can expand, rather than interleaving them.
- **Never silently drop** — always show the count of hidden nodes so users trust the filter isn't hiding real problems.
- **Acceptance criteria:** a fixture with one 8k-LOC/300-complexity script file must NOT appear in the default top-10 hotspots; toggling the filter brings it back; KPI tiles (avg/max complexity) computed over source-role only by default and labeled as such.

## 3. Scale extremes

### 3a. Tiny repo (3 files) (P2)
**(a)** 3 source files, few edges, one author.
**(b)** Treemap with 3 tiles looks like a placeholder; scatter with 3 points looks degenerate; distribution/percentile KPIs ("p95 complexity") are meaningless with n=3; dependency graph is trivially readable but coupling clusters/community detection produce 1 trivial cluster.
**(c)**
- Below an `n < ~8` threshold, **suppress percentile/statistical widgets** and show a "Repository too small for distribution analysis (3 files)" note; show raw per-file values instead of aggregates.
- Treemap/graph still render (they're fine small) but hide the "top N of M" chrome.
- Don't run/community-detect below a min node count; show the raw graph.
- **Acceptance:** 3-file fixture shows no misleading percentiles; no empty-looking large canvases (size canvas to content).

### 3b. Huge repo (10k files / 50k edges) (P1)
**(a)** 10k+ nodes, 50k+ edges.
**(b)** **Architecture graph is an unrenderable hairball** — Cytoscape layout stalls, nothing legible. Hotspots table renders 10k rows (DOM death). Treemap has thousands of 1px tiles. Ownership list unbounded.
**(c)**
- **Graph**: never render file-level graph for the whole repo by default. Default to **package/module-level aggregation**; expand-on-demand into a package. Cap rendered nodes (e.g. top-N by PageRank/fan-in) with a "showing 200 of 10,340 nodes — filtered by importance" banner. Offer neighborhood/focus mode (pick a node, show k-hop).
- **Tables**: server/virtualized pagination; default sort by the view's primary signal; "showing top 50 of 10,340."
- **Treemap**: depth-limit + minimum-tile-area collapse ("+312 more" tile); drill down by clicking.
- **Perf budget**: dashboard must interactively load; do heavy layout in a worker; show skeleton not freeze.
- **Acceptance:** 10k-node fixture: graph renders <2s at package granularity; no view attempts to DOM-render >~500 rows/tiles at once; every truncation states "top N of M."

## 4. Single-author repo (P0) — bus-factor saturates

**(a) Pathological input:** every file has exactly one distinct `%ae` → `bus_factor = 1` everywhere, ownership 100% single-author. (Confirmed real on this repo.)

**(b) What breaks / how:** Ownership view, bus-factor heatmap, and any "knowledge risk" KPI are **uniformly maxed** → the widget is a flat red wall conveying zero information but looking alarming (or, if inverted, flat green looking falsely safe). Change-coupling "cross-team" signals are all null.

**(c) Fix / UX:**
- Detect `distinct_authors_in_repo == 1` centrally. Replace the ownership view body with an **explicit N/A state**: "Single-author repository — bus-factor and ownership-concentration analysis are not applicable."
- Still offer *what remains meaningful*: **commit recency / staleness per file** (last-touched), and **churn concentration** (which files this one author reworks most) — reframe "bus factor" as "attention concentration."
- Where 2–3 authors exist but most files are single-owner, keep the widget but add a banner "Low author diversity (3 authors) — bus-factor has limited signal."
- Don't paint a full-red heatmap that implies crisis; use a neutral palette in the N/A state.
- **Acceptance:** single-author fixture ownership view shows an N/A explanation, not a saturated heatmap; a "recency" fallback widget renders; KPI tile reads "N/A" with tooltip, not "1.0 (critical)."

## 5. Outlier / skew (P0) — one 20k-LOC / complexity-500 file

**(a) Pathological input:** one file `loc=20000` or `cognitive_sum=500`; everything else <50.

**(b) What breaks / how:**
- **Linear color scales** map the whole normal range into one indistinguishable color bucket because the outlier owns the top of the domain — every real file looks identically "low."
- **Treemap areas**: the outlier tile consumes ~all area; the rest are invisible slivers.
- **Scatter (churn×complexity)**: axes auto-scale to the outlier; the real cluster crushes into the origin corner.
- **KPI tiles**: `avg` and `max` complexity dominated/skewed by the one file.

**(c) Fix / UX:**
- **Color/size scales**: default to **log scale or quantile/rank-based binning** for LOC/complexity/PageRank (all heavy-tailed). Provide a linear/log toggle.
- **Outlier clamping**: clamp color domain to a percentile (e.g. p5–p95) with a distinct "off-scale / clamped" color + legend note "≥ p95 clamped"; keep the true value in tooltip.
- **Treemap**: cap max tile area (or log-area) so one file can't eat the canvas; annotate the capped tile "area clamped — 20,000 LOC."
- **Scatter**: log axes by default when max/median ratio exceeds a threshold; optionally isolate outliers into a separate "off-chart" strip with a count.
- **KPIs**: prefer **median + p90** over mean; label mean as "skewed by outliers" when max/median is extreme.
- **Acceptance:** fixture with one 20k-LOC file: treemap shows the other files with visible area; color scale differentiates the <50 cluster; scatter doesn't collapse the main cluster to a dot; outlier flagged in legend/tooltip with true value preserved.

## 6. Missing / degenerate structure (P1)

**(a) Pathological inputs:** (i) no tests at all; (ii) a package with zero internal edges; (iii) circular dependencies; (iv) one giant `everything.ts`; (v) flat `src/` with no package boundaries.

**(b) What breaks / how:**
- **No tests** → any test-coverage/test-role silo, "tested vs untested" split, and role breakdown show an empty test segment that can read as "data missing" rather than "no tests exist" (a finding!).
- **Zero-internal-edge package** → community detection / coupling produces a package node with no cohesion signal; LCOM/coupling widgets blank for it.
- **Cycles** → dependency graph has back-edges; naive layered/DAG layout or topological ordering breaks or renders confusingly; instability metric still computes but the "layers" fingerprint is meaningless.
- **One giant file** → the whole graph is one node with all fan-in; nothing to show architecturally.
- **Flat src/** → no package layer; package-level aggregation (needed for huge-repo graph) has nothing to aggregate into; treemap has one flat level.

**(c) Fix / UX:**
- **No tests**: turn it into a **headline finding**, not an empty widget: "0% of files are tests — no test coverage detected." Role donut explicitly shows a 0 test slice with label.
- **Cycles**: **detect and surface SCCs as a first-class feature** — badge "N circular dependency groups detected," highlight cycle edges in the graph (distinct color), and switch to a force layout when the DAG assumption fails (fall back gracefully instead of erroring). Fitness/violations view should list cycles as violations.
- **Zero-edge package / giant file**: empty-state per widget ("No internal dependencies — nothing to cluster"); giant-file case suggests "1 file holds X% of LOC" as a finding.
- **Flat src/**: detect absence of package layer; skip package-aggregation gracefully, default graph to file-level (safe because flat repos are usually small); note "No package structure detected."
- **Acceptance:** no-tests fixture shows a "0 tests" finding not a blank; cyclic fixture renders without layout error and badges the cycle; flat-src fixture doesn't show an empty package treemap level.

## 7. Weird identity / paths (P2)

**(a) Pathological inputs:** committed `vendor/`/`node_modules`-like dirs; generated `*.gen.ts`/`*.pb.ts`; monorepo with many packages; deeply nested paths (`a/b/c/d/e/f/g/x.ts`); files with no extension / exotic unicode names; minified `*.min.js` / binary-ish committed files.

**(b) What breaks / how:**
- **Vendored/committed deps** parsed as first-party → inflate node count, fan-in, PageRank; a vendored lib becomes a fake "most important file."
- **Generated files** dominate churn (regenerated en masse) and complexity, same as scripts.
- **Monorepo** → package layer explodes; graph legend/labels overlap; ownership spans teams.
- **Deep paths** → treemap deep nesting; labels truncate to uselessness; node IDs very long (graph labels overflow).
- **No-extension / exotic names** → `classifyRole` regexes (extension-based) misclassify; label rendering / URL-safe IDs may choke on unicode.
- **Minified/binary** → huge single-line LOC, absurd complexity, or parse failure. (Note: TS-only walker excludes most of these, but `.ts` minified bundles committed in-repo will be walked.)

**(c) Fix / UX:**
- **Default exclusion globs** for `node_modules/`, `vendor/`, `dist/`, `build/`, `*.min.*`, `*.gen.*`, `*.pb.ts`, `__generated__/` — surfaced as an editable, visible "excluded paths" chip so it's transparent.
- **Vendored code as `external` role** (or a `vendored` role) so it's excluded from first-party KPIs but visible on demand.
- **Labels**: truncate middle of long IDs (`pkg/…/x.ts`), full path in tooltip; treemap depth cap with breadcrumb drill-down.
- **Monorepo**: package selector / scope filter as a top-level control; per-package KPI tiles; default to a single package or an overview roll-up, not all packages at once.
- **Minified/parse-fail**: if a file's LOC-per-line or parse-failure heuristic trips, tag it `generated`/`unparseable`, exclude from complexity stats, and count it in a "N files skipped (minified/unparseable)" note.
- Guard rendering against unicode/empty names (never let a label crash the graph).
- **Acceptance:** committed-vendor fixture: vendored files not in default hotspots/graph; excluded-paths chip lists them; deep-path fixture: labels truncated with tooltips; minified fixture: file skipped and counted, no absurd complexity KPI.

## 8. Data-quality gaps (P1)

**(a) Pathological inputs:** (i) snapshot at an **old `INDEX_VERSION`** (metric definitions changed); (ii) a metric **absent for some nodes** (`metric.value` NULL → NaN/undefined); (iii) **churn window resolved differently than requested** (asked 30d, git returned shallow/partial, or default fell back).

**(b) What breaks / how:**
- **Version mismatch** → comparing 0.1.0 vs 0.2.0 metrics silently mixes incompatible definitions; "what changed" shows fake deltas from a definition change, not real change. `snapshotVersionMismatchWarning` exists but is only advisory text today.
- **NULL metric** → charts plot NaN (gaps, or JS `NaN` coerced to 0 → false "0 complexity"); sorts misplace nulls (JS sorts `undefined` last/inconsistently); treemap sizing by a null metric ⇒ zero/negative area.
- **Window drift** → dashboard labels "churn (30d)" but data is really 12d (shallow clone) → every churn number is quietly wrong/underreported.

**(c) Fix / UX:**
- **Version**: gate cross-snapshot diffs on `index_version` equality. If mismatched, **disable the delta/what-changed view** with an explicit banner ("Baseline indexed with 0.1.0, current 0.2.0 — metric definitions differ, comparison disabled") rather than showing misleading deltas. Elevate the existing warning util into a UI banner + per-metric asterisk.
- **NULL metrics**: never coerce null→0. Render as a distinct "no data" hatch/gray in heatmaps, drop from scatter (with a "N nodes lack metric X" footnote), sort nulls into an explicit "unknown" group. Treemap: fall back to LOC sizing for null-sized nodes and mark them.
- **Window drift**: carry `requested_window` vs `resolved_window` (and commit count / whether the clone was shallow) in snapshot attrs; **label widgets with the resolved window** and banner when they differ ("Requested 30d; git history only covers 12d"). This directly ties to churn.ts returning partial data on shallow clones.
- **Acceptance:** mismatched-version fixture disables diff view with banner; null-metric fixture shows gray "no data" cells not zeros and footnotes the count; shallow-clone fixture labels churn with the true resolved window.

## 9. History gaps (P2)

**(a) Pathological inputs:** (i) exactly **one snapshot** (no drift); (ii) snapshots straddling an **index-version boundary** (incomparable); (iii) **huge time gaps** between snapshots (e.g. 6-month jump).

**(b) What breaks / how:**
- **One snapshot** → Drift/history view has no line to draw; sparklines on KPI tiles have one point.
- **Version boundary** → trend line stitches incomparable metrics into a fake jump/cliff at the boundary.
- **Huge gaps** → equal-spaced x-axis implies steady cadence; a 6-month gap looks like a 1-step change; interpolation invents nonexistent intermediate trend.

**(c) Fix / UX:**
- **One snapshot**: Drift view shows "Only one snapshot — capture another to see trends," and KPI sparklines show a single marker with "no history yet," not a broken empty chart. Offer the command to capture the next snapshot.
- **Version boundary**: **break the trend line** at version transitions (gap in the series + a labeled vertical marker "indexer 0.1.0 → 0.2.0"); optionally show separate segments; never draw a continuous line across the boundary.
- **Huge gaps**: use a **time-proportional x-axis** (real dates, not evenly-spaced indices) so gaps are visible; mark large gaps; disable interpolation across gaps (show discrete markers).
- **Acceptance:** single-snapshot fixture shows drift empty state + capture hint; version-boundary fixture breaks the line with a marker; gap fixture uses date-proportional axis and doesn't interpolate across the gap.

---

## Cross-cutting acceptance criteria (apply to every view)
1. **Four distinct states** per widget: loading / empty (nothing to show) / N/A (not applicable to this repo) / populated. Empty ≠ N/A ≠ error ≠ zero.
2. **No blank panes, ever** — the confirmed failure mode. Blank canvas → empty-state card with icon + one sentence + "why" tooltip.
3. **All truncation is labeled**: "showing top N of M," with the filter/sort that produced it.
4. **All default filters/exclusions are visible and reversible** (chips showing hidden counts). Never silently drop data.
5. **Heavy-tailed metrics default to log/quantile scales** with a linear toggle; means labeled when skewed.
6. **All churn/history widgets are labeled with the resolved window/version**, and banner when it differs from requested.
7. **No NaN/undefined reaches a chart** — nulls are an explicit visual category.

---

## Proposed simulated fixture repos (cheap to synthesize)

A single generator script (`scripts/synth-fixtures.ts`) writes N `.ts` files with controlled `loc`/complexity (emit nested `if`/loops to hit target cognitive complexity), controlled import edges, and a scripted git history (loop of `git commit --date=... --author=...`) to control churn/authors/snapshots. Each fixture is a folder + a git history recipe.

| # | Fixture name | Pathology (one line) |
|---|--------------|----------------------|
| 1 | `fx-dormant` | 40 normal files, **last commit 200 days ago** → empty 30d churn window, one snapshot. (Category 1) |
| 2 | `fx-script-noise` | Clean `src/` (20 files, complexity <40) + `scripts/migrate.ts` and `archive/old.ts` at **cognitive_sum 300, 8k LOC**. (2) |
| 3 | `fx-tiny` | **3 files, 1 author, 4 edges** → degenerate charts / no percentiles. (3a) |
| 4 | `fx-huge` | **10,000 generated files, ~50k import edges** across 40 packages → hairball/pagination. (3b) |
| 5 | `fx-single-author` | 60 files, realistic churn, **exactly one author email** → bus_factor=1 everywhere. (4) |
| 6 | `fx-outlier` | 50 files <50 complexity + **one 20,000-LOC / complexity-500 `god.ts`**. (5) |
| 7 | `fx-no-tests` | 30 source files, **zero test-role files**, one flat `src/`. (6-i, 6-v) |
| 8 | `fx-cycles` | 6 files in **2 mutual import cycles (SCCs)** + a diamond → cycle detection/layout. (6-iii) |
| 9 | `fx-god-file` | **One 5k-LOC file** importing everything; rest trivial → single-node graph. (6-iv) |
| 10 | `fx-vendored` | Real `src/` + committed **`vendor/lib/**` and `node_modules-copy/**`** TS + `*.min.ts` + `*.gen.ts`. (7) |
| 11 | `fx-monorepo-deep` | **12 packages**, paths nested 7 levels, a few **unicode/no-clear-extension** names. (7) |
| 12 | `fx-version-drift` | Same repo captured at **INDEX_VERSION 0.1.0 then 0.2.0**, plus a **6-month snapshot gap** and a **shallow-clone churn** (resolved 12d vs requested 30d) + a NULL metric on 10% of nodes. (8, 9) |

Fixtures 1–6 are the P0 screenshot set (dormant, script-noise, tiny, huge, single-author, outlier) — generate these first; they cover the highest likelihood×damage cells and the two confirmed real failures (dormant, single-author).
