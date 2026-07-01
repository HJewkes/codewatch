# OWNERSHIP view — critique

## 1. Verdict + Value score

**The degeneracy is NOT handled honestly — and not because the author forgot to guard it, but because the guard is silently broken.** The code *intends* to do the right thing: `OwnershipView.tsx:9` computes `singleAuthor = data.meta.authorCount === 1` and renders an honest "Single-author repository / bus factor 1 by definition… shown for completeness" `Alert`. But `data.meta` **contains no `authorCount` field** (confirmed: meta keys are `repo, snapshotId, ref, windowDays, generatedAt, indexVersion, emptyWindow, baseline`). So `undefined === 1` is `false`, the Alert never renders, and the view falls straight through to a table of ten identical **100% / red-bar / churn** rows with the alarming header "**Knowledge silos**". This is the exact failure mode the owner fears: a degenerate metric presented as ten red findings. The one piece of honesty the author built is inert. Additionally, the C-4 test-coverage bus factor is entirely absent — the view neither consumes nor renders it. **Value score: 1/5** on this data (as-rendered it is misleading trivia; it would be a 2/5 even if the guard fired, because the empty-state still shows the same degenerate table underneath).

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| Single-author `Alert` | **Nothing** — never renders (`authorCount` absent → guard is dead) | **misleading** | The one honest element is silently disabled; user sees raw 100%s with no caveat |
| "Knowledge silos" title + "single-owner files, ranked by churn" | Header framing 10 rows as silos/risks | **misleading** | On a 1-author repo *every* file is a "single-owner file"; the ranking is just churn |
| File name (`shortId`) | e.g. `.../commands/graph-dashboard.ts` | marginal | Fine as a label, but `.../` truncation hides which package (both `cli` and `graph` collapse) |
| Red bar (`Bar frac={topAuthorShare}`) | Full-width red bar, all 10 identical | **trivial** | Encodes a constant (1.0). Ten identical bars carry zero information and imply danger |
| "100%" text | `topAuthorShare` = 1 for all 10 | **trivial** | Constant by construction; not a finding |
| "churn N" (284…105) | Identical values to Hotspots | **misleading** | 5 of the top 10 are literally the Hotspots top-10; this is Hotspots re-sorted, relabeled as an ownership risk |
| Test-coverage bus factor (C-4) | Absent | **(missing)** | The one ownership signal that *isn't* degenerate on a solo repo is not surfaced |

## 3. Findings

1. **[DASHBOARD] — high — The single-author guard is dead code; the honest empty-state never fires.** `OwnershipView.tsx:9` reads `data.meta.authorCount`, which does not exist in the emitted data. Result: the misleading 100%-everywhere table renders with no caveat. **Fix:** emit `authorCount` in `meta` from the CLI (it's derivable from the same blame/log pass that produces `topAuthorShare`), OR derive it client-side — `const singleAuthor = data.busFactorRisks.every(b => b.topAuthorShare === 1)` is a zero-dependency stopgap that would make the guard fire on this exact data today.

2. **[METRIC] — high — On a single-author repo this panel is pure trivia and should collapse, not just prepend a banner.** Even with the Alert showing, the table below still renders ten identical red 100% bars — the banner says "ignore this" while the UI screams "ten risks." **Fix:** when `singleAuthor`, replace the table entirely with the explanation of what a multi-author repo *would* show (e.g. "files where one author owns >X% of churn — pairing/doc/review-policy candidates"), plus the test-coverage bus factor (finding 3). Don't render the degenerate bars at all.

3. **[DASHBOARD] — high — The non-degenerate C-4 signal (test-coverage bus factor) is missing.** On a solo repo, *authorship* bus factor is always 1, but **test-coverage bus factor** (how few test files cover a source) is still meaningful and is exactly what would rescue this view from uselessness on this repo. It is computed but not surfaced here. **Fix:** add a second panel "Under-tested / thinly-covered sources" driven by the C-4 data; make it the primary content when `singleAuthor` is true.

4. **[METRIC] — med — `churn` column is redundant with Hotspots.** 5 of these 10 files are the Hotspots top-10, and the sort key *is* churn. **Fix:** on a multi-author repo, sort by `topAuthorShare` (the actual ownership signal) not churn; drop churn or replace it with author count so the two views stop overlapping.

5. **[DASHBOARD] — med — Wasted screen / no hierarchy.** The panel occupies ~300px of a 2600px canvas; the remaining ~88% is empty black. Ten identical bars is the whole payload. **Fix:** once the guard fires and the degenerate table is removed, the freed space should host the test-coverage panel and an "what would make a file a silo here" legend rather than dead space.

6. **[DASHBOARD] — low — Red is the wrong color for a constant.** `cw.error` red bars (`OwnershipView.tsx:31`) signal "danger" for what is a definitional 100%. Even on multi-author data, reserve red for shares above an actual threshold (e.g. >80%) and use a neutral fill below it.

7. **[DASHBOARD] — low — `.../` truncation is lossy.** `shortId` collapses `packages/cli/...` and `packages/graph/...` to `.../`, so package-level ownership patterns are invisible. **Fix:** show the last two path segments including package.

## 4. Single highest-leverage improvement

**Make the guard actually fire and swap the payload.** One line — `const singleAuthor = data.busFactorRisks.every(b => b.topAuthorShare === 1)` — turns this from actively-misleading (10 red "risks") into honest ("N/A on a solo repo, here's why"). Then, in that same single-author branch, render the **test-coverage bus factor** panel instead of the degenerate authorship table, so the view still delivers a real, actionable signal (which sources are one-test-file away from being untested) on the very repo where the headline metric is dead. That converts the worst-scoring view in the dashboard from a 1/5 liability into something genuinely useful even here.

Note on scope: the broken `authorCount` guard (finding 1) is a **data-contract bug**, not just a UI nit — worth confirming whether the CLI ever emits `authorCount` anywhere, since any other view relying on it is equally dead.
