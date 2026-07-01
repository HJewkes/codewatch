# Dashboard value critique — per-view end-user vetting (C-29)

**Date:** 2026-07-01
**Method:** One skeptical end-user critique agent per view (7 views), each given the
rendered full-height screenshot, the underlying `graph dashboard` JSON payload, and the
view source. Data = **codewatch running on itself**, snapshot 120, 30-day churn window,
drift baseline = snapshot 97 (start of the prior session). Single-author repo.
All concrete claims below were independently re-verified against `data.json` and source.

## The question this answers

The owner's stated fear: *"the things it is surfacing are pretty trivial and meaningless."*
This vet was designed to test that hypothesis hard, not rubber-stamp it.

**Verdict: the fear is substantially justified, but not fatal.** Every view has a real
kernel of signal; most views bury that kernel under (a) metrics that are *degenerate on a
single-author repo* and rendered anyway, (b) *tautologies* presented as findings, and
(c) *arbitrary composite scores*. The tool's best idea (drift / "what changed") and its
most literature-backed idea (churn×complexity hotspots) are also its most diluted in
presentation. Average per-view value ≈ **2.0 / 5**.

| View | Value | One-line verdict |
|---|---|---|
| Hotspots | **3.0** | Real thesis (Tornhill hotspots); top-2 crossing the 3000 line are genuinely actionable, but trend/threshold data it already has is buried. |
| Fitness | **2.5** | Honest and correct; under-communicates the one thing that matters (0 new = guardrail held); 95% dead space. |
| Overview | **2.0** | Two good widgets (where-to-look, what-changed) diluted by redundancy, single-author noise, and an arbitrary radar. |
| Architecture | **2.0** | Instability + layer + cross-edges are real; main-sequence framing adds a dead abstractness axis and a ranking that's tautological with the layer pill. |
| Drift | **2.0** | Best *idea* in the tool; execution mostly restates `git log --stat` and buries the one real regression under expected-growth noise. |
| Coupling | **1.5** | The flagship "hidden coupling" signal never fires (0 hidden); the list is dominated by test↔source / generator↔artifact tautologies. |
| Ownership | **1.0** | Degenerate by construction on a solo repo; the honest guard is *dead code*, so it renders 10 red "silos" that mean nothing. |

## Root-cause themes (cross-cutting — fix once, help many views)

### T1 — The single-author honesty guard is DEAD CODE. *(confirmed bug, highest leverage)*
`OwnershipView.tsx:9` and `OverviewView.tsx:19` both gate their honest single-author
empty-states on `data.meta.authorCount === 1`. **`graph dashboard` never emits
`authorCount`** (confirmed: not present anywhere in `packages/`; absent from the emitted
`meta`). So `undefined === 1` → `false` on every real dashboard, and the misleading
degenerate rendering *always* shows: Ownership renders 10 identical red "100% / bus
factor 1" rows under the header "Knowledge silos"; Overview shows a red "knowledge silos:
10" KPI and a "bus factor 1" pill on nearly every hotspot; Drift shows 5 "new knowledge
silos". The author *built* the honesty and it silently doesn't run. This one contract gap
is the single biggest source of "meaningless" surface in the whole dashboard.
- **Fix:** emit `authorCount` from the CLI (derivable from the same blame/log pass that
  produces `topAuthorShare`). Stopgap that works on today's data with zero CLI change:
  `const singleAuthor = data.busFactorRisks.every(b => b.topAuthorShare === 1)`.
- **And:** when single-author, don't just banner it — *replace* the degenerate payload.
  Ownership should render the **C-4 test-coverage bus factor** (still meaningful on a solo
  repo: which sources are one-test-file from untested) instead of the authorship table.

### T2 — churn×complexity conflates "new/active" with "structurally risky"; the trend + threshold data it already has is buried.
`score = churn × complexity` is dominated by churn (churn range 44–284 = 6.5×; complexity
range 9–23 = 2.6×), so on an actively-developed repo the hotspot list mostly reads as
"files I edited this month" — which the maintainer already knows. The genuinely
non-obvious facts sit unused *in the same payload*:
- `partition-quality.ts` has **complexity 23 (repo max)** but ranks #7 because it doesn't
  churn — the one structurally-hard file is demoted and never flagged as the complexity peak.
- `indexer.ts` **worsened 4693→5035 (+342)** vs baseline and trips the `scary-hotspots`
  violation — the actual regression — but Hotspots is snapshot-only and Drift ranks it
  *below* a wall of benign new files.
- 8 of the top-10 hotspots are **new since baseline 97** (mostly newborn files); Drift
  paints all 8 alarm-red without distinguishing "born this session" from "existing file
  crossed the line."
- **Fix:** badge rows that are `drift.worsened` / `drift.newHotspots` (▲+342, NEW), draw
  the 3000 "scary" iso-line on the score bar/treemap, show the churn×complexity
  decomposition per row, and let the user sort by complexity. Split Drift's "new hotspots"
  into "newly created (neutral)" vs "existing crossed threshold (alarm)."

### T3 — Coupling & Drift present tautological couplings as findings; the real thesis never fires.
On this data **0 of 10 coupling pairs are `hidden:true`**, so the hidden-coupling
`Alert` — described in its own copy as "the most actionable coupling signal" — is invisible.
What renders instead, ranked by raw co-edit count, leads with `dashboard-template.ts ↔
graph-dashboard.ts` (generated asset ↔ its generator) and includes `graph-report.test.ts
↔ graph-report.ts` (test ↔ its own source). codewatch *models* `test-of` edges (it has a
test-linker) yet surfaces them as discoveries. Co-edit counts are 2–4 from a single
author — no support threshold. Drift's "new coupling" has the same problem.
- **Fix:** invert the default from "top co-changed pairs" to "co-change **not** explained
  by a known `imports`/`test-of`/`emits` edge." Add a support/confidence floor (e.g.
  coEdits ≥ 3 and a lift metric) to survive single-author noise. Show an explicit
  "0 hidden couplings — all co-change is import-backed" state so the reader knows the
  check ran. Cluster transitively-coupled files (the data key is literally
  `couplingClusters`, yet nothing is clustered).

### T4 — Composite / derived scores are arbitrary or degenerate.
- **Health = `100 − scary×6 − (new+carry)×5`** (confirmed at `graph-dashboard.ts:58`).
  On this data `100 − 2×6 − 2×5 = 78`. It depends only on the scary-hotspot count and the
  violation count — and here the **2 carry violations *are* the 2 scary hotspots**, so the
  same two files are penalized twice. The 10 "knowledge silos," max complexity 23, all
  coupling, and PageRank do **not** feed health at all. The number is then rendered *twice*
  (KPI tile + hero gauge).
- **Risk radar:** two of six axes are pinned. `coupling = couplingClusters.length / 10`
  and the array is a top-10 slice → **always ≈1.0**; `hotspots = hotspots[0].score / 5000`
  clamps → **1.0** here. Denominators (5000/15/10/30/8) are magic numbers unrelated to the
  fitness thresholds. The shape is dominated by artifacts, not risk.
- **Architecture main sequence:** the abstractness axis is a `role=types` file-share proxy
  pinned to **0.014–0.167** across all 7 packages, so the 2-D scatter collapses to 1-D and
  "distance from main sequence" ≈ `|1 − instability|`, which reproduces the `layer` pill
  ordering exactly. It then flags the *healthiest* packages (concrete+stable foundation:
  core/profile/graph) as orange "rigid" problems. Meanwhile **cohesion** (real range
  0.60–1.0; `cli` at **0.60 / 58 cross-edges** is a genuine "doing too much" outlier) is
  computed and thrown away.
- **"boundary Q 0.63":** modularity Q rendered as a cryptic KPI with no direction,
  threshold, or verdict (0.63 is actually good).
- **Fix:** make health a transparent breakdown of components (and stop double-counting the
  carry/scary overlap); either tie radar axes to the fitness thresholds ("1.0 = at failing
  line") or drop the radar; replace Architecture's dead abstractness axis with cohesion and
  rank by lowest cohesion; rename "boundary Q" → "modularity" with a band color + verdict.

### T5 — Data-contract / self-consistency bugs (erode trust on sight).
- `kpis.newHotspots = 2` but `drift.newHotspots` has **8** entries — same label, two
  definitions, on the same screen.
- `meta.baseline.snapshotId = 0` while `drift.baselineSnapshotId = 97` → Overview subtitle
  renders **"vs 97 (snap 0)"** and looks broken.
- Dossier "Centrality (PageRank)" shows **"—" for the #1 hotspot** because `centralFiles`
  is truncated to top-10; a hotspot absent from that list reads as "not central," which is
  false.
- **Fix:** one definition of "new hotspot" shared by KPI and drift; resolve the baseline
  snapshot id; carry PageRank for all shown nodes.

### T6 — Presentation / UX (aesthetics + legibility).
- **Confirmed rendering bug:** in Hotspots the filename overruns the right-aligned churn
  value — `…/commands/graph-dashboard.ts` renders as "graph-dashboard.ts**84**" (the "2" of
  284 hidden); same for graph-auto-update. `numberOfLines={1}` doesn't truncate because the
  File cell has no `flex:1/minWidth:0`.
- **Redundancy:** health gauge duplicates the health KPI; the "Hotspot map" treemap is the
  exact same 10 rows as "Where to look first" (double-encodes one variable).
- **Color semantics wrong:** Fitness renders "**0 new**" — the best possible outcome — in
  alarm red (`cw.error`, unconditional); Ownership/Coupling bars encode constants;
  Drift/others hardcode red and ignore the `hotspotColor` gradient. Fitness `error` severity
  badge contradicts `carry` (parked) status.
- **Dead vertical space:** Fitness, Ownership, Coupling, Architecture, Drift all use the
  top ~15–25% of a tall canvas; the rest is empty black, making working views look broken.
- **Jargon without explanation:** `scary-hotspots`, "boundary Q", and detail strings like
  `churn_30d=199 * cognitive_max=22 = 4378 > 3000` show arithmetic but no meaning, units,
  or next step. No rule descriptions/tooltips.
- **Weak affordances:** row→dossier target is the filename text only (no chevron/cursor);
  `shortId` truncation drops the disambiguating `packages/<pkg>/` prefix exactly where two
  files share a leaf.

## What genuinely works (keep / lead with)
- **Hotspots' top-2 crossing the 3000 line** — real, literature-backed, actionable.
- **Fitness ratchet delta** (0 new / 2 carry / 0 fixed) — the guardrail-held signal is the
  actual value; it just needs to be the headline, not a red zero.
- **Drift as a concept** — "what changed since baseline" is the tool's most defensible idea;
  it serves the *cold/returning reader* far better than the author who just did the work.
- **Change-coupled-with in the Dossier** ("editing indexer drags graph-cli, graph-auto-update
  along") — the best single line in the dossier.
- **`layer` classification** and **cohesion / cross-edges** (currently under-used) in
  Architecture.

## Prioritized backlog (seeds C-30…)

**P0 — trust & degeneracy (kills the most "meaningless" surface):**
1. **[metric/bug]** Emit `authorCount`; make the single-author guard fire; replace the
   degenerate Ownership table with C-4 test-coverage bus factor. *(T1)*
2. **[metric]** Filter coupling/drift pairs by known `imports`/`test-of`/`emits` edges +
   support threshold; lead with hidden couplings (explicit "0 found" state). *(T3)*
3. **[bug]** Reconcile `newHotspots` KPI vs drift definition; fix `baseline.snapshotId=0`
   "snap 0"; carry PageRank for shown nodes. *(T5)*

**P1 — make the real signal legible:**
4. **[dashboard]** Badge new/worsened rows + draw the 3000 iso-line in Hotspots/Overview;
   split Drift "new hotspots" into created-vs-crossed; lead Drift with the regression tied
   to its open violation. *(T2)*
5. **[dashboard]** Fitness positive ratchet banner ("Guardrail holding — 0 new vs baseline
   97; 2 parked, not blocking"); fix red-zero + error/carry badge contradiction. *(Fitness)*
6. **[metric]** Replace Architecture abstractness axis with cohesion; rank by lowest
   cohesion (surfaces `cli` 0.60/58); stop flagging foundation packages as "rigid". *(T4)*

**P2 — composites & polish:**
7. **[metric]** Make Health a transparent component breakdown (stop double-counting
   carry/scary); fix or drop the Risk radar's pinned axes; rename "boundary Q" → modularity
   with a verdict. *(T4)*
8. **[dashboard]** Fix the Hotspots filename/number text collision; de-duplicate health
   gauge and treemap; value-derive KPI accent colors; add rule descriptions/tooltips;
   reclaim dead vertical space; widen dossier press target + fix `shortId` truncation. *(T6)*
9. **[dashboard]** Collapse the dependency graph to a package-level (7-node) default with
   cross-edge weights; file-level as opt-in drill-down. *(Architecture)*

## Caveats on this vet
- Single dataset (codewatch-on-itself, single author). Several "degenerate" findings (silos,
  bus factor, single-author coupling) would partly resolve on a **multi-author** repo — the
  still-open validation gap. But T1 (dead guard) and the tautology/threshold gaps are
  data-independent bugs.
- The degenerate empty `dashboard` package is *correctly* filtered
  (`ArchitectureView.tsx:32`), so it does not pollute the plot — one worry that did **not**
  pan out.
