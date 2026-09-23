# Critic Report: workflow:planning:critic:c6750314

## Summary

The design is architecturally sound — the pure-service + `buildAssembleCtx` boundary mirrors the existing `buildReportContext` pattern and the risk recipe is well-specified. But there are hard, implementation-blocking contradictions between the three artifacts: a null-vs-throw disagreement on the core entry point, an export-location impossibility for `buildAssembleCtx`, mismatched public symbol names (`RISK_CAPS`/`FACTOR_CAPS`, missing `bandForScore`), and — most seriously — the `graph wiki` retrofit (spec R9) is silently dropped from the design's file plan and has no acceptance criterion. These must be reconciled before a task can be decomposed cleanly.

## Verdict: NEEDS REVISION

## Findings

### Correctness

- [FIX] **R9 (`graph wiki` retrofit) is not in the design's implementation plan.** The spec requires it (R9) and the Approach paragraph name-drops it, but the "Files to Create/Modify" table has no `graph-wiki*.ts` entry and no wiki test, and there is **no acceptance criterion** covering it (AC-11 covers `graph report` only). `graph-wiki.ts`, `graph-wiki-sections.ts`, `graph-wiki-format.ts` all exist, so this is real work that vanished. *Fix:* either add the wiki files + a dedicated AC to the plan, or explicitly move R9 to Out of Scope for PR #1 with a rationale. Do not leave it half-specified.
- [FIX] **Null-vs-throw contradiction on the primary function.** The design's type signature comment and Key-Decisions table say `assembleFileProfile` **throws `ProfileError`** for a non-file/missing id; AC-02 says it **returns `null` and does not throw**. These cannot both be tested. Spec R2 only mandates never-throw for a *file with no metrics* (not a non-file node), so it doesn't force either. *Fix:* pick one contract. Given "CLI resolves the id first," throwing is defensible — but then AC-02 must be rewritten to assert the throw. Update both artifacts to agree.
- [FIX] **`RISK_CAPS` vs `FACTOR_CAPS` / missing `bandForScore`.** Design exports `RISK_CAPS` and never mentions `bandForScore`; AC-06/AC-12 reference `FACTOR_CAPS[key]` and require `bandForScore` to be importable, and AC-08 calls `bandForScore` directly. *Fix:* settle on one constant name and add `bandForScore` (+ `RiskBand`) to the design's export list and `index.ts` re-export plan, or drop them from the ACs.
- [FIX] **Ownership fields have no stated source.** `FileProfile.ownership` needs `busFactor`, `topAuthorShare`, `distinctAuthors`, but `AssembleCtx` only carries `topAuthorByFile: Map<string,string>`. In the codebase these are **windowed numeric metrics** (`bus_factor_<window>`, `top_author_share`, etc.) that would arrive via `metricsByName`. The design never says this, so an implementer can't know which metric names to read or that they are window-suffixed. *Fix:* document that ownership numerics come from `metricsByName` via `windowSuffix(windowDays)` and name the exact metric keys.
- [ACCEPTED] **PageRank percentile math.** AC-04 (3rd-of-4 → 75) and EC-04 (single file → 100) are internally consistent with a "count at-or-below / total × 100" definition over `filePageRanksSorted`. Coherent and testable.
- [ACCEPTED] **Band thresholds.** R5 (`<25/25-49/50-74/>=75`) map correctly to AC-08's 10/40/60/90 → healthy/watch/elevated/urgent.

### Error Handling

- [FIX] **R6 explainability vs. total-rounding.** R6 requires "summed factor `weight`s (pre-clamp) equal the reported points," but the design computes `score = round(min(100, Σ weight))` from **fractional** per-factor weights (e.g. `40 * min(1, ratio)`). The rounded total will not equal the sum of un-rounded factor weights, breaking the explainability invariant. *Fix:* round per-factor and define `score = Σ round(weight)` clamped, or restate R6 to allow ±1 rounding drift. Pin it in `risk.test.ts`.
- [FIX] **Recency: ε weight vs. zero weight contradiction.** Design's recipe table adds recency as "`+small ε` used only to order ties," implying it enters `Σ weight`; EC-06 asserts "recency cap is 0 … not as added score weight" and that two profiles differing only in recency have **equal** scores. An ε in the sum can flip a `round()` boundary and make scores unequal. *Fix:* make recency contribute exactly 0 to `score` and expose ordering only via the emitted factor (or a separate tiebreak field), then EC-06 holds deterministically.
- [ACCEPTED] **Git-absent / coupling.** `coupling = []`, no throw (EC-05, EC-04); divide-by-zero floored at `max(1, p90)`. Correct and covered by edge cases.
- [ACCEPTED] **Zero-churn / null-LCOM.** EC-01 and EC-02 explicitly require `hotspot`/`cohesion` → 0 with no NaN; recipe formulas (`min(1, 0/…)`, `null → 0`) satisfy this.

### API Design

- [FIX] **`snapshotId` parameter appears unused.** `assembleFileProfile(snapshotId, fileId, ctx)` is pure and `ctx` is already scoped to one snapshot; nothing in the described logic reads `snapshotId`. A dead parameter invites misuse. *Fix:* drop it, or state exactly what it's used for (e.g. stamping the profile).
- [FIX] **`buildAssembleCtx` location contradicts R10 and creates command→command coupling.** R10 requires it exported from `packages/graph/src/index.ts`, but the design puts it in `packages/cli/src/commands/graph-profile.ts` — a CLI-package symbol cannot be re-exported from the graph package, and both `graph report` (and R9's wiki) would then `import` from a sibling *command* file. *Fix:* move `buildAssembleCtx` into a shared module (graph package if it's to satisfy R10, or a dedicated `cli/src/.../assemble-ctx.ts` and drop `buildAssembleCtx` from R10). Reconcile R10 with AC-12, which omits it.
- [FIX] **AC field names drift from the design's types.** ACs reference `hotspot.raw`/`hotspot` and `couplingByFile`; the design defines `riskInputs.hotspotRaw`/`hotspotP90` and `couplingPairsByFile`. A test author following the ACs will write against non-existent fields. *Fix:* rename ACs to the design's actual field paths.
- [ACCEPTED] **Purity boundary.** Pushing all I/O into `buildAssembleCtx` and keeping both service functions pure is the right, testable design and matches `buildReportContext`.

### Chain of Verification

| Question | Independent Answer | Design Says | Match? |
|----------|-------------------|-------------|--------|
| Q1: Which surfaces must change per the spec, and does the file plan cover all? | R7 `graph profile`, R8 `graph report`, R9 `graph wiki`. | File table lists profile + report only; wiki absent. | **No** |
| Q2: What does `assembleFileProfile` do for a non-file id? | Must be one behavior. | Design: throws; AC-02: returns null. | **No** |
| Q3: Can `buildAssembleCtx` be exported from `graph/src/index.ts`? | Only if it lives in the graph package; it can't do so from a CLI command file. | Places it in CLI, yet R10 demands the graph-package export. | **No** |
| Q4: Do summed factor weights equal the score? | Not if fractional weights are summed then the total rounded. | Claims R6 holds while rounding the total. | **No** |
| Q5: Do two profiles differing only in recency get equal scores? | Only if recency adds exactly 0. | Adds "+ε," which can flip rounding. | **No** |
| Q6: Where do `busFactor`/`distinctAuthors`/`topAuthorShare` come from? | Windowed numeric metrics (`bus_factor_<window>`, `top_author_share`). | Unspecified; `AssembleCtx` carries only `topAuthorByFile`. | **No** |
| Q7: Is the risk factor set exactly the five capped + recency, `bus_factor` excluded? | hotspot/complexity_peak/high_fanout/high_fanin/cohesion + recency tiebreak. | Same. | Yes |
| Q8: Does `graph report` text output stay byte-identical? | Achievable if only the JSON path is touched. | Retrofit adds `riskScore?` to JSON only; text renderer untouched. | Yes |

### Cross-Cutting

- [FIX] **Wave-2 "parallelizable" claim is overstated.** The `graph report` retrofit (owner C/D) depends on `buildAssembleCtx`, which lives in owner C's `graph-profile.ts`; the (missing) wiki retrofit would too. So the retrofit(s) cannot start until C's helper signature is stable — this is a sequence, not free parallelism. *Fix:* land `buildAssembleCtx` in its own scaffolding-wave module so report/wiki/profile can proceed in parallel against a fixed signature.
- [FIX] **AC → spec-requirement citations are systematically off-by-one** (e.g. AC-08 cites "req 7" for banding which is R5; AC-10 cites "req 8" for the CLI which is R7; AC-11 cites "req 9" for the report retrofit which is R8). Harmless to code but will mislead traceability/review. *Fix:* correct the citations.
- [ACCEPTED] **Scaffolding wave is coherent** — types + `RISK_CAPS`/caps + `index.ts` land first and form the contract; wave-2 bodies depend only on types. Sound, once the naming/export issues above are fixed.
- [ACCEPTED] **Convention compliance** — new modules in `packages/graph/src/`, split-file CLI convention (`register`/`run`/`formatText`/`formatJson`), pre-load-context pattern, functions ≤30 lines all align with CLAUDE.md and NF-02.

## Open Questions

- Is R9 (`graph wiki` retrofit) actually in scope for PR #1? The spec says yes, the design's file plan says no. A human decision is needed — this materially changes the PR size and the acceptance set.
- Should `buildAssembleCtx` live in `@codewatch/graph` (satisfying R10 literally) or in the CLI layer (matching the `buildReportContext` precedent, which lives in CLI)? R10 and AC-12 disagree; pick the authoritative one.
- For explainability (R6), is exact "weights sum to score" required, or is ±1 rounding drift acceptable? This determines the rounding strategy and several tests.

## FIX Summary

Total: 11 FIX items
1. design.md / acceptance-criteria.md — R9 `graph wiki` retrofit missing from file plan and has no AC; add it or move R9 out of scope.
2. design.md / AC-02 — reconcile null-return vs. `ProfileError` throw on non-file/missing id.
3. design.md / R10 / AC-12 — `buildAssembleCtx` export location impossible as drawn; fix placement and export contract.
4. design.md / AC-06 / AC-12 — unify `RISK_CAPS` vs `FACTOR_CAPS` and add `bandForScore`/`RiskBand` to exports.
5. design.md — specify ownership numerics come from windowed metrics via `windowSuffix`; name the keys.
6. risk.ts recipe / R6 — define per-factor rounding so summed weights equal the reported score.
7. risk.ts recipe / EC-06 — make recency contribute exactly 0 to `score`; expose tiebreak without weight.
8. profile.ts signature — remove or justify the unused `snapshotId` parameter.
9. design.md — move `buildAssembleCtx` to a shared scaffolding module; fix the overstated wave-2 parallelism.
10. acceptance-criteria.md — align AC field names (`hotspot.raw`→`riskInputs.hotspotRaw`, `couplingByFile`→`couplingPairsByFile`).
11. acceptance-criteria.md — fix off-by-one spec-requirement citations across ACs.

<!-- signal: needs_revision -->
