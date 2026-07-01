# DRIFT view — skeptical end-user critique

## 1. Verdict + Value score

**Value: 2/5.** Drift is the right *idea* — a single "what moved and why" surface is the most defensible concept in the tool — but on this data the execution mostly restates `git log --stat` with scores bolted on, and the two genuinely actionable signals are buried under expected-growth noise. The owner/cold-reader split is the crux: **for the person who did the work (this snapshot), value is near-zero** — every one of the 8 "new hotspots" and all 5 "new silos" are files they personally created or heavily edited this session; they need no reminder. **For a cold reviewer the view is orientation, not action** — it tells you *what* files changed but never *why it matters* or *what to do*, and critically it ranks by raw score, so "biggest new file" outranks "genuine regression." The one file a reviewer should actually worry about (indexer.ts, already an open violation, still climbing) is rendered smaller and second to a wall of red "new" badges that are mostly benign. And on a single-author repo the entire "new knowledge silos" section is degenerate. So even the cold-reader case, which is drift's best case, is served weakly. It clears the "pure trivia" bar only because worsened + the hidden complexity outlier *could* drive action — but the view doesn't surface them as such.

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| Header "vs 97" pill | Baseline = snapshot 97 | **marginal** | No date, no commit, no "N days/session ago." "97" is meaningless to a human; cold reader can't tell if baseline is yesterday or last quarter. |
| 5 stat cards (8/1/0/0/5) | Category counts | marginal | newCoupling (3) has *no* card — inconsistent. "8" red implies alarm for mostly-new files. |
| **New hotspots** (8 rows, 2840→684) | Files that crossed into hotspot territory | **misleading** | Nearly all are *new files born this session* (graph-dashboard, test-linker, hook-cli...). A new file with churn is expected growth, not regression. Labeled red "new" = false alarm. |
| Hotspot scores, all red | 2840…684 in uniform `cw.error` | **misleading** | Row hardcodes red; ignores theme's `hotspotColor` gradient (red≥3000, amber≥1000, blue<1000). 684 and 2840 look equally severe. No churn/complexity split shown. |
| **Worsened**: indexer.ts 4693→5035 ▲342 | The one true regression | **actionable (but buried)** | Already an open `scary-hotspots` violation, still growing +7%. This is the single item worth acting on — and it's visually the *smallest* section. No significance threshold: any +1 would land here. |
| improved / resolved = 0 | Nothing paid down | marginal | Correct but silent. "You added 8 hotspots and resolved 0" is itself a session verdict the view never states. |
| **New knowledge silos** (5× "bus factor 1") | New single-owner files | **trivial/misleading** | Single-author repo → *every* new file is automatically bus-factor-1. "Became single-owner" is false; they were never multi-owner. Zero signal here. |
| **New coupling** (3 pairs, ×4/×2/×2) | Pairs that co-changed | **trivial** | dashboard-template ↔ graph-dashboard are two halves of one feature — of course they co-edit. ×2 is a single feature-touch; no threshold separates signal from a coincidental commit. |
| Baseline control | none | marginal | Fixed at generation time; no scrubber/timeline. Can't re-diff against a different baseline without regenerating. |

## 3. Findings

1. **[METRIC] — high — "New hotspots" conflates newborn files with regressions.** 6 of the 8 (graph-dashboard 2840, test-linker 1695, hook-cli 1050, graph-auto-update 940, graph-report 840, hook 684) are files that didn't meaningfully exist at snapshot 97 — they're this session's new code. A file being *born* with churn is expected, not a health event. Marking them red "new" cries wolf. **Fix:** split into "newly *created* (informational, neutral color)" vs "*existing* file that crossed the hotspot threshold (alarming)." Only the latter is a drift signal.

2. **[METRIC] — high — Ranking by raw score hides the genuinely concerning file.** partition-quality.ts has **complexity 23 — the repo max** — with only churn 44; it's the one new file that's *structurally* hard, not just active. It ranks 5th (1012) behind graph-dashboard.ts (2840 = churn 284 × complexity **10**, pure activity). Score = churn × complexity flattens "actively edited" and "hard to understand" into one number. **Fix:** show the churn × complexity decomposition per row (e.g. `44 × 23`), and let the reader sort by complexity, so the durable-risk files surface above the transient-activity ones.

3. **[METRIC] — high — "New knowledge silos" is fully degenerate on a single-author repo.** All 5 are "bus factor 1" because there is exactly one author; `data.busFactorRisks` shows *every* file at `topAuthorShare: 1`. The subtitle "became single-owner since baseline" is factually wrong — nothing *became* concentrated. **Fix:** suppress the silo section (and its stat card) when repo author count ≤ 1, replaced by a one-line "single-author repo — silo/bus-factor signals not applicable." Same degeneracy the ownership view has.

4. **[METRIC] — med — No significance threshold on "worsened" or "new coupling."** indexer.ts +342 (a 7% move on a 4693 base) is the *only* worsened row, and coupling pairs land at coEdits **2**. Any +1 delta or any 2 co-edits qualifies. On a busier repo this section becomes noise. **Fix:** threshold worsened at a meaningful delta (e.g. ≥10% or crossing the 3000 violation line) and coupling at coEdits ≥3; annotate indexer's row with "already an open violation" so its significance is explicit.

5. **[DASHBOARD] — med — The one actionable item is visually de-emphasized.** New hotspots (mostly benign) gets top billing and a wall of red; the real regression (indexer, an open carry violation still climbing) is a single small second-row line. **Fix:** reorder — lead with "Worsened / regressions" and tie it to the open violation, demote newborn files below the fold.

6. **[DASHBOARD] — med — Baseline is opaque to a cold reader.** "vs 97" and "since snapshot 97" carry no date, commit, or elapsed time. The strongest case for drift is the returning/cold reader, and that reader can't anchor "97" in time. (Also a data smell: `meta.baseline.snapshotId` is `0` while `drift.baselineSnapshotId` is `97`.) **Fix:** render "vs snapshot 97 · <date> · <commit short-sha> · N commits ago."

7. **[DASHBOARD] — med — Data-trust contradiction: header says 8 new hotspots, `kpis.newHotspots` says 2.** The same dashboard disagrees with itself on its headline number. Whatever the definitional reason (top-N churn vs threshold-cross), a user sees a contradiction and stops trusting the view. **Fix:** one definition of "new hotspot," used by both the KPI and the drift panel.

8. **[DASHBOARD] — low — Uniform red scores ignore the theme gradient.** `Row` hardcodes `rightColor={cw.error}`, so 684 and 2840 are the same red even though `hotspotColor` defines red≥3000 / amber≥1000 / blue<1000. **Fix:** pass `hotspotColor(h.score)`.

9. **[DASHBOARD] — low — Empty categories are silent, and there's massive dead vertical space.** improved/resolved = 0 render as gray cards with no narrative; content ends ~700px into a 2600px canvas. **Fix:** add a one-line session summary ("+8 hotspots, 0 resolved, net debt ↑") and either two-column the categories or let the page not reserve full height.

## 4. Single highest-leverage improvement

**Separate "newborn files" from "regressions," and lead with the regression tied to its open violation.** The core failure is that the view treats *this session's new code* (expected, known to the author, benign) identically to *an existing healthy file that got worse* (the actual drift signal) — and then ranks the former on top in alarm-red. Reclassify new hotspots into "newly created (neutral)" vs "existing file crossed threshold (alarm)," move Worsened to the top annotated with "already an open violation" (indexer.ts 4693→5035, still >3000), and suppress the single-author silo section. That one change converts the view from a red-tinted `git log --stat` restatement into a short, honest "here is the *one* thing that actually got worse" — which is the payoff the owner believes drift delivers but this rendering doesn't yet earn.
