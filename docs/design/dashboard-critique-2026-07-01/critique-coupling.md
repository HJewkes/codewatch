# Coupling View Critique

## 1. Verdict + Value Score

This view is the single strongest confirmation of the owner's fear. On this data it renders **10 pairs, zero of which are `hidden:true`** — meaning the entire "most actionable signal" (the hidden-coupling warning banner) is dead code that never fires. What remains is a flat list where the top-ranked "finding" is `dashboard-template.ts ↔ graph-dashboard.ts` (a generated asset and its generator) and the third is `graph-report.test.ts ↔ graph-report.ts` (a test and its own source). These are not discoveries; they are tautologies — of course a template co-changes with the code that emits it. The view presents structurally-guaranteed couplings with the same visual weight it reserves for genuine latent dependencies, and it does nothing to distinguish import-linked pairs (expected) from import-free pairs (interesting). With co-edit counts of 2–4 from a single author, there is no statistical floor and no honesty about the single-author confound. **Value score: 1.5 / 5.** The hidden-coupling *concept* is worth a 4; the *execution on real data* delivers a 1.

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| Hidden-coupling `Alert` banner | Never renders — `hidden.length === 0` for all 10 pairs | Trivial (absent) | The one feature that justifies the view is invisible on the flagship dataset. The view degrades to a plain co-change list with no framing of what's expected vs. surprising. |
| Pair #1 `dashboard-template ↔ graph-dashboard` ×4 | Generated template co-changing with its generator | Trivial | Structurally forced. Editing the emitted HTML *requires* editing the emitter. Zero information. |
| Pair #3 `graph-report.test ↔ graph-report` ×2 | Test co-changing with its own source | Trivial | The canonical "of course" coupling. codewatch *has* a test-linker; it knows this is a test-of edge, yet surfaces it as a finding. |
| Pairs `graph-report-format ↔ graph-report-types ↔ graph-report` (×2 each) | Three siblings of one feature edited together | Marginal | Sensible but self-evident — they share a filename prefix. A reader learns nothing they couldn't read off the paths. |
| `graph-cli ↔ indexer` ×3, `graph-auto-update ↔ indexer` ×2 | Commands co-editing the core indexer | Marginal | Plausibly real (commands track indexer API churn) but almost certainly import-linked, so not "hidden." Not distinguished as such. |
| Blue `Bar` (frac = coEdits/maxCoEdits) | Bars for 2,3,4 spanning ~50–100% width | Misleading | With max=4, a ×2 pair fills half the bar, implying substance. It visually inflates noise-level counts into a meaningful gradient. |
| `×N` count column | 4, 3, 2, 2… | Marginal | The only real datum, but with no confidence/threshold context a ×2 (two commits, one author) reads identically to a strong signal. |
| `↔` glyph / clickable file names | Navigation to file detail | Actionable | The drill-through is the one genuinely useful affordance here. |
| Sort order (by coEdits desc) | Puts the template/generator tautology at #1 | Misleading | Ranking by raw count surfaces the *least* interesting (expected) pairs first. Hidden/surprising pairs — the point — are not prioritized. |
| `Filter files`, `Copy JSON`, snapshot chips | Standard chrome | Marginal | Fine, but the empty 90% of the page below 10 short rows signals how thin the payload is. |

## 3. Findings

1. **[METRIC] — high —** The hidden-coupling feature never fires: **all 10 pairs are `hidden:false`**, so the `Alert` banner (CouplingView.tsx:28–36) — described in its own copy as "the most actionable coupling signal" — is invisible on the canonical dataset. Either the hidden-detection threshold is too strict, or hidden pairs are being pruned before reaching the top-10. **Fix:** stop truncating to co-edit-ranked top-N; specifically *reserve slots for or dedicated-section the hidden pairs* even at coEdits=2. If genuinely none exist, show that as an explicit "0 hidden couplings — all co-change is import-backed" state rather than silently omitting the banner, so the reader knows the check ran.

2. **[METRIC] — high —** Structurally-guaranteed pairs are presented as findings. `dashboard-template ↔ graph-dashboard` (×4, rank #1) and `graph-report.test ↔ graph-report` (×2) are a generator/artifact pair and a test/source pair. codewatch already models `test-of` edges (it has a test-linker) and knows the template edge. **Fix:** filter or visually demote pairs joined by a known `imports`, `test-of`, or `emits` edge. Default the list to "co-change *not explained by* a static edge"; put explained pairs behind a toggle. This is the difference between trivia and insight.

3. **[METRIC] — high —** No confidence threshold or single-author warning. Eight of ten pairs are ×2 — two commits, from one author (the repo is single-author, per every `topAuthorShare:1` in the data). Two co-edits is indistinguishable from "batched into one commit by habit." **Fix:** add a minimum-support floor (e.g. coEdits ≥ 3 *and* ≥ some % of each file's commits) and render a persistent caveat: "Single-author repo — co-change reflects one person's commit batching, not team-level coupling." Consider a lift/confidence metric (coEdits / min(commitsA, commitsB)) instead of raw count.

4. **[DASHBOARD] — med —** The `Bar` normalizes to `maxCoEdits` (=4), so a ×2 noise pair renders at 50% fill — visual inflation of statistically meaningless counts. **Fix:** anchor the bar to a meaningful absolute (e.g. a confidence/lift score in 0–1), not to the max of a tiny sample; or drop the bar entirely at these counts and show confidence as the encoded dimension.

5. **[DASHBOARD] — med —** It's a flat list, not a coupling *structure*. The brief asks whether this is a real DSM/matrix/chord; it is neither. Ten disconnected rows hide that `graph-report`, `graph-report-format`, `graph-report-types` form a triangle (a cluster), and that `indexer` is a shared hub for `graph-cli` and `graph-auto-update`. **Fix:** cluster transitively-coupled files into groups, or render a small DSM/adjacency matrix so hubs and cliques are visible at a glance. The word "clusters" is in the data key (`couplingClusters`) but nothing is clustered.

6. **[DASHBOARD] — low —** Enormous vertical dead space: 10 single-line rows occupy the top ~12% and the rest of the ~2600px canvas is empty black. **Fix:** cap panel height to content, or use the reclaimed space for the matrix (finding 5) and a per-pair "why they're coupled" expansion (shared author, shared commit messages, edge status).

7. **[DASHBOARD] — low —** `hidden` styling can't be assessed because no pair is hidden, but the design (a `Pillet` + warning-colored bar, CouplingView.tsx:41,49) means a hidden pair is distinguished only by a small inline tag and bar hue — easy to miss in a list. **Fix:** hidden pairs should be a *separate, top* section with the warning `Alert`, not interleaved and ranked below trivial import-backed pairs.

## 4. Single Highest-Leverage Improvement

**Invert the view's default from "top co-changed pairs" to "co-change unexplained by a static edge."** Everything wrong here stems from ranking by raw co-edit count over an unfiltered set — which mathematically floats generator/artifact and test/source tautologies to the top while the actual product thesis (hidden coupling) renders nothing. Filter out pairs joined by a known `imports`/`test-of`/`emits` edge, apply a support/confidence floor to survive the single-author noise, and lead with the hidden set (with an explicit "0 found" state when empty). That one change is the difference between "codewatch tells me a test changes with its source" and "codewatch found two files that keep changing together but nothing links them — go look."
