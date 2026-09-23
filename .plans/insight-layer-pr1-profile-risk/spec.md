# Spec: Profile + RiskScore shared service (insight-layer PR #1)

## Problem
Codewatch has rich substrate (graph nodes/edges, complexity, churn, LCOM, ownership, PageRank) but every report (`graph report`, `graph wiki`) queries it independently and invents its own ribbon. There is no shared interpretation layer, so `lcom4_max=9` never composes with churn and complexity into the insight "this file is risky." This PR introduces the first insight-layer primitive — a per-file `Profile` and a composed `RiskScore` — as the single source of truth every downstream artifact (PRs #2–#5) will read.

## Requirements

1. **R1 — Profile assembly.** `assembleFileProfile(snapshotId, fileId, ctx)` returns a `FileProfile` for one `file` node, populated purely from pre-loaded snapshot data (no I/O inside the function). It covers: identity, package, role, size, complexity, linkage (fan-in/out, instability, PageRank percentile, inbound/outbound edges with cross-package flag, co-edited peers), ownership, activity (churn), a deterministic 1-line summary, and pre-computed peer-relative risk inputs.
2. **R2 — Context builder.** A `buildAssembleCtx(input)` helper assembles the shared `AssembleCtx` (node/edge/metric indexes, pre-computed PageRank, coupling pairs, per-package hotspot p90) once per snapshot, so `assembleFileProfile` stays pure and cheap per call.
3. **R3 — Risk scoring.** `computeRiskScore(profile)` returns a `RiskScore` — a 0–100 clamped `score`, a `band`, an ordered `factors[]` list, and a 1-line `why`. Factors: `hotspot` (≤40), `complexity_peak` (≤20), `high_fanout` (≤15), `high_fanin` (≤15), `cohesion` (≤10), `recency` (tiebreaker only). `bus_factor` is **not** a factor.
4. **R4 — Banding.** Band is derived from score: `healthy` <25, `watch` 25–49, `elevated` 50–74, `urgent` ≥75.
5. **R5 — Deterministic summary (v1).** `FileProfile.summary` is deterministic and built from filename + role + import count (outbound-edge count), e.g. `"source · imports 12 · src/foo/bar.ts"`. Per interview: this deterministic v1 ships in this PR; the LLM overlay is deferred (CW-11.01). PR #5 may enrich the deterministic form, but the field is fully populated (not a bare stub) now.
6. **R6 — CLI inspection command.** `graph profile <id>` prints the assembled profile + risk score in human text and, with `--json`, as a structured object. Registered in `graph-cli.ts`.
7. **R7 — Report retrofit.** `graph report` attaches a `RiskScore` to each hotspot row it emits (single source of truth), with **no change to existing text output** — the score is exposed in the result object / JSON only.
8. **R8 — Wiki retrofit.** `graph wiki` reads the same `RiskScore` for the hotspot rows it renders per package, so banding is consistent across artifacts. No behavior change to non-risk sections.
9. **R9 — Exports.** `FileProfile`, `AssembleCtx`, `buildAssembleCtx`, `assembleFileProfile`, `RiskScore`, `RiskFactor`, `RiskBand`, `computeRiskScore` re-exported from `packages/graph/src/index.ts`.

## Constraints
- **Location:** new modules live in `packages/graph/src/` (NOT `packages/profile`, which is an unrelated code-style package). Package name is `@codewatch/graph`.
- **Purity:** `assembleFileProfile` and `computeRiskScore` perform no filesystem/git/DB I/O; all data arrives via `AssembleCtx` / `FileProfile`. This keeps them unit-testable with synthetic maps.
- **Window type:** churn/ownership metric names are windowed via `windowSuffix(window)` where `window: ChurnWindow = number | "lifetime"`. Do not hard-code `"30d"`.
- **Backward compatibility:** existing `graph report` / `graph wiki` text output is unchanged; retrofit is additive to result/JSON shapes only.
- **Fitness:** 0 new fitness/`graph check` violations in modified files; functions ≤ ~30 lines; zero new lint/type warnings.
- **Recipe is opinionated v1:** weights are hard-coded constants (exposed at top of `risk.ts` with rationale). No config surface unless 2+ users disagree (deferred).

## Out of Scope
- L2 file-page rendering (`graph file <id>`) — PR #2.
- PR-overlay / `--vs <ref>` delta mode — PR #3.
- Recommendations engine — PR #4.
- LLM-generated summaries — deferred (CW-11.01). This PR ships the deterministic v1 summary (R5); PR #5 may enrich it.
- Symbol-level nodes, call edges, domain detection beyond packages — deferred.
- Persisting PageRank or hotspot-p90 to the DB — computed on demand at context-build time.
- `topAuthor` identity in `ownership` — author names are not in snapshot tables; field ships as `null` in v1.

## Dependencies
- Substrate modules (read-only): `database.ts` (`listNodes`/`listEdges`/`listMetrics`/`getNode`/`getSnapshot`), `types.ts`, `metrics.ts` (`fan_in`/`fan_out`/`instability`), `source-metrics.ts`, `lcom.ts`, `churn.ts` + `churn-window.ts` (`windowSuffix`, `ChurnWindow`), `ownership.ts`, `change-coupling.ts` (`CoEditPair`), `pagerank.ts` (`computePageRank`), `roles.ts`.
- CLI registration: `packages/cli/src/commands/graph-cli.ts` and the `registerGraph*` pattern.
- Retrofit targets: `graph-report.ts` / `graph-report-sections.ts` / `graph-report-types.ts` and `graph-wiki.ts` / `graph-wiki-sections.ts`.
