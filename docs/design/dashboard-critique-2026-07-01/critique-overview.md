# OVERVIEW — End-User Critique

## 1. Verdict + Value Score

**Value: 2 / 5.** The Overview is built on a defensible idea ("where do I look + why"), and two elements genuinely serve it: the **"Where to look first"** hotspot ranking and the **"What changed since baseline"** delta. But the signal is heavily diluted. On this single-author, self-hosted dataset the view is dominated by (a) **redundancy** — the health number appears twice (KPI tile *and* a hero gauge), and the "Hotspot map" treemap is the exact same 10 rows as "Where to look first"; (b) **single-author-meaningless metrics** — "knowledge silos 10" and the "bus factor 1" pillet that decorates *every* hot file are pure artifacts of one author, not insights; (c) **trivial derivations** — "Reading order" is PageRank, which on any module graph just surfaces `types.ts` and the `index.ts` barrels (a maintainer knows those already); and (d) an **arbitrary Risk radar** whose axes use magic-number denominators, two of which are effectively pinned at max. A competent maintainer would learn almost nothing here they didn't already know from having just written the code. The bones for a 4/5 view exist, but right now the page mostly restates "the files you edited most this month are the churny ones."

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| KPI: health 78/100 | Composite score, orange (warning band) | marginal | Defensible number but **zero explanation** of what feeds it; and it's duplicated by the gauge below. |
| KPI: new hotspots 2 | 2, warning accent | misleading | Conflicts with `drift.newHotspots` which lists **8** files. Same name, two definitions. |
| KPI: knowledge silos 10 | 10, red accent | trivial | Single-author repo → every file is a "silo." Red implies alarm for a non-signal. |
| KPI: boundary Q 0.63 | 0.63, blue accent | trivial | "Q" (modularity) is undecipherable to a user; no good/bad direction, no threshold. 0.63 is actually good, but nothing says so. |
| KPI: open violations 2 | 2, red | actionable | Real, concrete, matches the 2 `scary-hotspots` violations. The one honest alarm. |
| KPI: max complexity 23 | 23, brand orange | marginal | No threshold shown; is 23 bad? Redundant with the violation detail (`cognitive_max`). |
| Health gauge (hero) | Big dial = 78 | trivial | **Exact duplicate** of the health KPI tile; consumes prime hero real estate to restate one number. |
| Risk radar (6 axes) | Spiky toward hotspots/coupling/silos | marginal | "Normalized" is overclaimed — arbitrary denominators; **coupling axis is pinned at 1.0** (array capped at 10 ÷ 10), silos axis inflated by single-author. Shape not comparable across repos. |
| Reading order (PageRank) | types.ts, graph/index.ts, profile/index.ts, schema/profile.ts, style-rule.ts, core/index.ts | trivial | 4 of 6 are type/barrel files. "Read the index and type files first" is a structural artifact of PageRank, not insight. |
| Where to look first | indexer.ts (5035), incremental.ts (4378), graph-dashboard.ts (2840)… | **actionable** | The strongest widget — churn×complexity ranking with reasons. But "bus factor 1" pillet is on nearly every row (noise), and "scary hotspot"+"violation" are the same fact twice. |
| Hotspot map (treemap) | Same 10 files as list, as rectangles | trivial | **Redundant** with "Where to look first" — identical ranking, no new information, just a second encoding. |
| What changed since baseline | 0 fixed / 0 new / 2 carryover | marginal | The concept is the real value (per your own dogfood notes), but it shows **only violation deltas** and hides the richer drift: `indexer.ts worsened 4693→5035 (+342)`, 8 new hotspots, new coupling. Also subtitle reads "**snap 0**" (baseline `snapshotId:0`) — looks like a bug. |

## 3. Findings

1. **[METRIC] — high — "knowledge silos 10" and "bus factor 1" are noise on a single-author repo.** `busFactorRisks` is entirely `topAuthorShare: 1`; `knowledgeSilos: 10` just counts files. The code already knows this (`meta.authorCount === 1` → `singleAuthor`), yet the KPI tile still shows a red "10" and the "bus factor 1" pillet decorates indexer/incremental/graph-dashboard/etc. **Fix:** when `singleAuthor`, suppress the silos KPI and the "bus factor 1" pillet (or replace with a single "single-author repo" note, which the code already computes but only shows in a footnote).

2. **[METRIC] — high — Risk radar normalization is arbitrary and partly degenerate.** Denominators are magic numbers (5000, 15, 10, 30, 8). The coupling axis = `couplingClusters.length / 10`, but that array is a top-10 slice → **always ≈1.0**. The hotspots axis = `hotspots[0].score / 5000` and clamps (indexer 5035 → 1.0). Two of six axes are effectively pinned, so the shape is dominated by artifacts, not risk. **Fix:** either derive axes from the same thresholds the fitness checks use (so "1.0" means "at the failing threshold") or drop the radar — a 6-axis toy where 2 axes are constant is decorative.

3. **[DASHBOARD] — high — Reading-order bars float far from their rows.** In the render, the blue centrality bars are pushed to the far-right panel edge, leaving a large empty gutter between each filename and its bar, so they read as a detached stacked cluster rather than per-row values. **Fix:** cap the panel/row content width or move the bar adjacent to the score; don't let `flex:1` on the label stretch the row across the full wide panel.

4. **[DASHBOARD] — med — The Health gauge duplicates the Health KPI tile.** Same "78/100" twice, and the gauge panel is mostly empty padding. **Fix:** replace the gauge with a health **breakdown** (what components drive 78 — complexity, violations, coupling, churn) so the hero explains the number instead of restating it. This directly answers "is 78 defensible?"

5. **[DASHBOARD] — med — "Hotspot map" treemap is redundant with "Where to look first."** Identical 10 files, identical ranking. Two side-by-side widgets, one insight. **Fix:** either merge (inline sparkline/heat in the list) or repurpose the treemap to a *different* dimension (e.g., churn×complexity grouped by package, exposing which subsystem is hot).

6. **[METRIC] — med — "new hotspots" KPI (2) contradicts the drift payload (8).** `kpis.newHotspots = 2` but `drift.newHotspots` has 8 entries. Same label, two meanings, on one screen. **Fix:** reconcile the definition and make the KPI's tooltip/subtitle state it ("newly crossed scary threshold" vs "newly entered top-N").

7. **[DASHBOARD] — med — "boundary Q 0.63" is undecipherable and unjudged.** No expansion of "Q" (modularity), no direction, no threshold, neutral blue accent. A user cannot tell if 0.63 is good (it is). **Fix:** rename to "modularity" with a band color and a one-word verdict ("good ≥0.4"), like the health tile has.

8. **[DASHBOARD] — med — KPI accent bars encode nothing for 5 of 6 tiles.** Only `health` uses `healthColor(value)`; silos is *always* red, boundary Q *always* blue, complexity *always* brand-orange regardless of value. The red on "silos" reads as a permanent false alarm. **Fix:** make every accent a value→band color, or drop the bars and stop implying severity.

9. **[DASHBOARD] — low — "What changed since baseline" subtitle shows "snap 0".** `meta.baseline.snapshotId` is 0 while `ref` is 97 → "vs 97 (snap 0)" looks broken. **Fix:** resolve the baseline snapshot id, or show only the ref.

10. **[DASHBOARD] — low — "Where to look first" reason pillets double-count.** For indexer.ts: "scary hotspot" + "violation" are the same underlying fact (score ≥ 3000 is the violation rule). **Fix:** collapse to one pillet ("violation: scary hotspot") so three chips don't imply three independent risks.

## 4. Single highest-leverage improvement

**Turn "What changed since baseline" into the hero, and demote the duplicated gauge + redundant treemap.** Your own dogfood notes say the drift/delta is where the value is — yet this view spends its two largest tiles (gauge, treemap) restating numbers already on the page, while the actual drift story is compressed into three violation counts and hides the real news: *indexer.ts got worse (+342), 8 new hotspots appeared, new coupling formed since snapshot 97.* Promote that delta payload to the top, phrased as "since you started this session, X got worse and Y is new" — that is the one thing a maintainer who already knows their repo could not have told you themselves.
