# Hotspots view — end-user critique

## 1. Verdict + Value score

This is the one view where codewatch has a legitimate, literature-backed thesis (churn × complexity is Tornhill's hotspot heuristic), and it does surface something a maintainer would act on: `indexer.ts` (5035) and `incremental.ts` (4378) both trip the `scary-hotspots` violation and are the obvious "add tests / carve up before you touch again" candidates. But the presentation buries the actionable kernel and pads with the obvious. The score is dominated by churn — churn spans 44–284 (6.5×) while complexity spans only 9–23 (2.6×), so the "complexity" axis barely re-ranks anything and the list reads mostly as "files I edited this month." Worse, the genuinely non-obvious signals that live in the same `data.json` — `indexer.ts` **worsened +342 vs baseline** (`drift.worsened`), **8 of these 10 are brand-new hotspots** (`drift.newHotspots`), and the `scary-hotspots` threshold breach — are either absent from the view or blanked/buried in the dossier. The dossier itself is a stat dump that hardcodes "Bus factor 1" (pure noise on a single-author repo) and shows "Centrality —" for the #1 hotspot. Real signal, under-surfaced. **Value score: 3/5.**

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| Treemap "Hotspot map" | Same 10 files, area = score, color = score band | **marginal** | Double-encodes ONE variable (score) as both area and color; adds no dimension the table lacks. Redundant with the table below it. |
| Table: File column | `…/src/indexer.ts` etc. | actionable | Correctly identifies the two files worth acting on; but long `…/commands/*` paths collide with the churn number (see F1). |
| Churn column | 265, 199, 284… | marginal | On a single-author active repo this is ~"lines I touched this month" — the reader already knows. |
| Complexity column | 9–23 | **marginal** | 2.6× range vs churn's 6.5×; too compressed to meaningfully re-rank. It's max cognitive of one function, not file-level — not labeled as such. |
| Score = churn×complexity | 5035 down to 684 | actionable | The top-2 crossing 3000 is the real signal — but the view never draws the 3000 threshold line. |
| Score bar viz | linear frac of maxScore (5035) | marginal | Redundant with treemap area; a third rendering of the same number. |
| Sort affordance ("SCORE ↓") | orange active header | actionable | Clear, works; good. |
| Package pills (all/cli/graph) | derived from the 10 rows | trivial | Only 2 packages appear because the list is pre-truncated to 10 — filter is an artifact of truncation, not the repo. |
| Row → Dossier | only the filename Text is pressable | marginal | No chevron/cursor cue; churn/complexity/score cells are dead. Not discoverable. |
| Dossier: Churn×complexity | `265 × 19 = 5035` | marginal | Restates the row you clicked. |
| Dossier: Bus factor | "1 (100% top author)" | **trivial** | Hardcoded "1"; every file on a single-author repo is bus factor 1. Exactly the owner's "meaningless" fear. |
| Dossier: Centrality | "—" for `indexer.ts` | **misleading** | The single best "should I care" signal is blank because `centralFiles` is top-10-only; a hotspot that isn't in that top-10 reads as "not central," which is false. |
| Dossier: Change-coupled with | graph-cli ×3, graph-auto-update ×2 | actionable | Genuinely useful — "editing indexer drags these along." Best thing in the dossier. |
| Dossier: violation | `churn_30d=265 * cognitive_max=19 = 5035 > 3000` | actionable but buried | The one line that says "this crossed a line," in the faintest, smallest text at the very bottom. |

## 3. Findings

1. `[DASHBOARD]` — **high** — Text collision: `…/commands/graph-dashboard.ts` overruns the right-aligned Churn value so it renders as "graph-dashboard.ts84" (284 hidden); same for graph-auto-update ("update.ts94"). `numberOfLines={1}` doesn't truncate because the cell has no max width. **Fix:** give the File `TableCell` `flex: 1, minWidth: 0` and the Text `flexShrink: 1` with ellipsization, or widen the File column and hard-cap the numeric columns.

2. `[DASHBOARD]` — **high** — The view is snapshot-only and ignores trend data sitting in the same payload. `drift.worsened` shows `indexer.ts` went 4693→5035 (+342), and `drift.newHotspots` marks 8 of these 10 rows as NEW vs baseline 97. "Just became a hotspot" and "getting worse" are the non-obvious, decision-changing facts; raw score is not. **Fix:** add a "NEW"/"▲+342" badge on rows present in `drift.newHotspots`/`worsened`, and a trend column.

3. `[METRIC]` — **high** — The complexity axis is too low-variance (9–23) to matter, so `score` mostly tracks churn; and multiplication collapses the four quadrants. `partition-quality.ts` — the single most complex file in the repo (23 = repo max) — is demoted to #7 because it doesn't churn, and the view gives the reader no way to see it's the complexity peak. **Fix:** render a churn×complexity scatter with the 3000 iso-curve, or add a quadrant tag ("complex+churning" vs "churn-only"); stop hiding the axes inside one product.

4. `[DASHBOARD]` — **high** — Dossier "Bus factor" is hardcoded to `1 (100% top author)` and is meaningless on this single-author repo. **Fix:** suppress the row when `topAuthorShare === 1` and author count == 1, or replace with something real (top author name + #authors); don't emit a constant.

5. `[DASHBOARD]` — **med** — Dossier "Centrality (PageRank)" shows "—" for the #1 hotspot because `centralFiles` is truncated to 10. A hotspot with blank centrality reads as "peripheral," which may be wrong. **Fix:** carry PageRank for all hotspot nodes (or at minimum the ones shown), so the drawer can actually answer "is this depended-upon?"

6. `[DASHBOARD]` — **med** — The list is capped at 10 with no "10 of N" indicator and no way to see the tail; the package filter pills are themselves derived from those 10. On a 60-file `graph` package, an arbitrary 10-row cut hides whether #11 is at 683 or 12. **Fix:** show "top 10 of N", allow expand; derive package pills from the full set.

7. `[DASHBOARD]` — **med** — The violation detail — the one objectively actionable line (threshold breached, status=carry across snapshots) — is the faintest 11px text at the bottom of the drawer. **Fix:** promote it to a colored banner at the top of the dossier ("⚠ scary-hotspot: 5035 > 3000, carried since snap 97").

8. `[DASHBOARD]` — **low** — Treemap double-encodes score (area AND color) and duplicates the table's one metric. **Fix:** free one channel — color the treemap by package or by complexity so it adds a dimension instead of restating the bar.

9. `[DASHBOARD]` — **low** — Row→dossier affordance is invisible: only the filename Text is pressable, no cursor/chevron, and the numeric cells are dead. **Fix:** make the whole `TableRow` the press target and add a trailing chevron.

## 4. Single highest-leverage improvement

Fold the trend and threshold data the view already receives into the rows: badge each row that is a **new hotspot** or **worsened** (`▲+342`), and draw the **3000 "scary" line** on the score bar/treemap. That single change flips the view from "here are the files I've been editing" (which the maintainer knows) to "these two crossed the danger line and `indexer.ts` is still getting worse, and 8 of these are new since your last baseline" (which they don't) — directly answering the owner's "is this just trivia?" fear with the one thing on the screen that isn't.
