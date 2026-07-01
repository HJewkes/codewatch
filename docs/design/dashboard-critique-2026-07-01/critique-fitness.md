# FITNESS View — Skeptical Critique

## 1. Verdict + Value Score

This view is honest and correctly structured, but on THIS data it is 95% empty screen conveying a single fact: "you introduced 0 new violations." That fact is genuinely the actionable core of a ratcheting fitness system — the guardrail held — but the view does almost nothing to *celebrate or explain* it. The 0/2/0 tally row is the most valuable pixel on screen, yet it's rendered identically whether you have 0 new or 40 new. The two `carry` rows below are explicitly parked/grandfathered, yet the view gives no verb: no "fix", "re-baseline", or "ignore" affordance, no explanation of what `scary-hotspots` is, why 3000 is the line, or what a user should do about a 5035. A newcomer reading `churn_30d=265 * cognitive_max=19 = 5035 > 3000` learns the arithmetic but not the meaning or the next step. And ~1800px of vertical dead space below two rows makes a working guardrail look like a broken or under-built page rather than "all clear." **Value score: 2.5/5** — the ratchet delta is real signal, but it's under-communicated and the carry rows are near-trivia as presented.

## 2. Element-by-element

| Element | What it shows on THIS data | Verdict | Why |
|---|---|---|---|
| `0 new` tally (red text) | The one number that matters: guardrail held | **actionable** but **misleading color** | 0 is *good news* yet styled with `cw.error` red (line 51) — a zero here should read green/neutral, not alarm |
| `2 carryover` tally (amber) | Pre-existing parked debt count | marginal | Correct count, but "carryover" alone doesn't tell you these are *grandfathered and non-blocking* |
| `0 fixed` (teal) | Nothing resolved since baseline 97 | trivial | On this snapshot it's a zero conveying nothing; fine as a slot |
| `scary-hotspots` group header + "2 violations" | Groups both rows under the rule | marginal | Rule name is jargon with no tooltip/definition/threshold; a newcomer can't tell what it enforces |
| `error` severity badge | Both rows are severity=error | **misleading** | Severity says "error/blocking" but status says "carry/parked" — the two badges contradict; a `carry` error doesn't block, but the red badge screams that it does |
| `carry` pillet (amber) | Grandfathered status | marginal | Communicates state but not *consequence* ("won't fail your build") or *action* |
| File `…/src/incremental.ts` | Truncated path | marginal | `shortId` drops the `packages/graph/` prefix — with two files both under `packages/graph/src/` the disambiguating context is exactly what got trimmed |
| `detail` string | `churn_30d=199 * cognitive_max=22 = 4378 > 3000` | marginal→trivial | Shows the math but no units, no "what/why", no link to file or rule def; reads as jargon |
| Vast empty area below | ~1800px of nothing | **misleading** | Sparse layout makes a *passing* guardrail look broken/empty rather than "all clear" |
| `vs 97` / `30d window` / `v0.2.0` chips | Baseline & window context | actionable (underused) | The baseline ref `97` is the key to the whole ratchet story but is a tiny gray chip, not framed as "comparing against pinned baseline 97" |

## 3. Findings

1. **[DASHBOARD] — high — "0 new" is styled red (`cw.error`).** Lines 51 + 78: the `new` tally always uses `cw.error` regardless of value. On this data `0 new` is the single best outcome the system can report, rendered in alarm red. **Fix:** color the `new` tally green/success when `n === 0`, red only when `n > 0`. Same treatment for a conditional headline (see #10).

2. **[DASHBOARD] — high — Severity `error` badge contradicts `carry` status.** Both rows show a red `error` badge (line 60) while being non-blocking carries (line 61). A reader can't tell these don't fail CI. **Fix:** visually subordinate severity when `status === "carry"` (e.g., muted/outline badge), or add an explicit "not blocking build" affordance so error+carry doesn't read as "2 blocking errors."

3. **[DASHBOARD] — high — No explanation of what `scary-hotspots` is or why 3000.** The group header is a bare rule slug (line 56). A newcomer sees `4378 > 3000` with zero context for what the rule protects against or where 3000 came from. **Fix:** add a one-line rule description + threshold source under the group header (e.g., "churn × cognitive complexity; files above 3000 are change-magnets that are hard to modify safely"), ideally linking to the rule's `.codewatch/check.json` definition.

4. **[DASHBOARD] — high — Carry rows have no verb / next action.** The whole question "is a carry actionable?" is unanswered. The view lists two parked items and offers no path: fix, re-baseline, or suppress. **Fix:** make each row expandable/clickable to the file (there's an unused `onSelect` prop on line 15 — the rows never call it), and add per-rule guidance ("Grandfathered at baseline 97. To clear: reduce complexity/churn below 3000, or re-baseline to accept.").

5. **[DASHBOARD] — high — Massive dead space makes a passing guardrail look broken.** Two rows over ~2600px reads as empty/under-built, undercutting the "all clear" message. **Fix:** add a prominent positive summary banner at top ("Guardrail holding: 0 new violations vs baseline 97 — 2 pre-existing, parked") so the emptiness is framed as good news, not absence.

6. **[METRIC] — med — `detail` math omits units and meaning.** `churn_30d=199 * cognitive_max=22 = 4378 > 3000` (line 325) is precise but opaque: churn in what unit (commits? lines?), cognitive_max of what (worst function?). **Fix:** label units and add a plain-language tail, e.g. "199 commits in 30d × worst-function cognitive complexity 22." Consider showing the delta too — `indexer.ts` went 4693→5035 (+342, per drift data) — which is the actionable trend, not the static product.

7. **[DASHBOARD] — med — `shortId` trims the disambiguating prefix.** Both files collapse to `…/src/incremental.ts` and `…/src/indexer.ts`, hiding that both live in `packages/graph/src/`. **Fix:** for violations, show `pkgOf` + leaf (e.g. `graph/src/indexer.ts`) so files are unambiguous and the concentration in one package is visible.

8. **[DASHBOARD] — med — Baseline `97` is buried.** The entire ratchet story hinges on "vs baseline 97," shown only as a tiny gray `vs 97` chip. **Fix:** surface the baseline in the summary banner and label the `fixed`/`new`/`carry` tallies as "since baseline 97."

9. **[DASHBOARD] — low — Tally label mismatch.** Header pill says "carryover"; row pillet says "carry" (lines 52 vs 61). Minor inconsistency in vocabulary. **Fix:** pick one term ("carryover") everywhere.

10. **[DASHBOARD] — low — No positive headline for the clean-of-new case.** The `violations.length === 0` empty state (lines 22-31) has a nice "All checks pass / Baselines are holding" message, but the far more common "0 new, some carry" case gets no equivalent reassurance. **Fix:** conditional headline when `tally.new === 0 && violations.length > 0`: "No new violations — baselines holding. 2 pre-existing items parked below."

## 4. Single Highest-Leverage Improvement

Add a **positive ratchet summary banner at the top** that turns the delta into the headline instead of leaving it as a red "0": e.g. a green-toned bar reading *"Guardrail holding — 0 new violations since baseline 97. 2 pre-existing hotspots parked (not blocking). 0 fixed."* This simultaneously fixes the misleading red-zero (#1), frames the empty space as good news rather than a broken page (#5), surfaces the buried baseline (#8), and tells the user the carries are non-blocking (#2/#4) — converting the view's core insight from "here are 2 rows of arithmetic" into "your ratchet is working, and here's what's still parked."
