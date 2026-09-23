# Acceptance Criteria: Profile + RiskScore shared service (insight-layer PR #1)

Every requirement in spec.md maps to at least one criterion below (requirement
tags shown in parentheses).

## Criteria

### AC-01: FileProfile assembles all fact groups (R1, R2)
**Given:** an `AssembleCtx` built from a synthetic snapshot where file
`pkg/a.ts` has metrics `loc=120`, `function_count=8`, `class_count=2`,
`cognitive_max=14`, `lcom4_max=5`, `fan_in=3`, `fan_out=6`, churn, and ownership.
**When:** `assembleFileProfile(snapshotId, "pkg/a.ts", ctx)` is called.
**Then:** the returned `FileProfile` has `size.loc=120`,
`size.functionCount=8`, `size.classCount=2`, `complexity.cognitiveMax=14`,
`complexity.lcom4Max=5`, `linkage.fanIn=3`, `linkage.fanOut=6`, a non-null
`package`, a `role`, and populated `ownership` and `activity` groups.

### AC-02: Inbound/outbound edges with cross-package flag (R1)
**Given:** a context where `pkg-a/x.ts` imports `pkg-b/y.ts` (cross-package) and
`pkg-a/z.ts` (same package), and `pkg-c/w.ts` imports `pkg-a/x.ts`.
**When:** the profile for `pkg-a/x.ts` is assembled.
**Then:** `linkage.outboundEdges` contains `{dst:"pkg-b/y.ts", crossPackage:true}`
and `{dst:"pkg-a/z.ts", crossPackage:false}`, and `linkage.inboundEdges`
contains `{src:"pkg-c/w.ts"}`.

### AC-03: PageRank percentile is populated (R1)
**Given:** an `AssembleCtx` whose `filePageRanksSorted` places the target file's
PageRank above 60% of file nodes.
**When:** the profile is assembled.
**Then:** `linkage.pageRankPercentile` is approximately `0.6` (0..1) and never
outside `[0, 1]`.

### AC-04: Coupling peers surfaced from context (R1)
**Given:** `ctx.couplingByFile` maps the target file to
`[{peer:"pkg/b.ts", count:4}]`.
**When:** the profile is assembled.
**Then:** `linkage.coupling` equals `[{peer:"pkg/b.ts", count:4}]`.

### AC-05: computeRiskScore produces score, band, and sorted factors (R3, R6)
**Given:** a `FileProfile` with a high hotspot, high cognitive peak, and
`lcom4Max=6`.
**When:** `computeRiskScore(profile)` is called.
**Then:** it returns `score` in `[0,100]`, a `band`, and `factors` sorted
descending by `weight`; each nonzero factor has a non-empty `detail`; the summed
pre-clamp factor weights equal the pre-clamp total.

### AC-06: Recipe factor ceilings honored (R4)
**Given:** a profile engineered so every factor maxes out (`hotspotNorm>=1`,
`cognitiveMax` above the complexity-peak ceiling, cross-package fan-out and
fan-in both above their thresholds, `lcom4Max>3`).
**When:** `computeRiskScore` runs.
**Then:** the individual factor weights are exactly `hotspot=40`,
`complexity_peak=20`, `high_fanout=15`, `high_fanin=15`, `cohesion=10` (their
declared maxima) before clamping.

### AC-07: bus_factor is not a risk factor (R4)
**Given:** a profile with `ownership.busFactor=1` (extreme knowledge
concentration) but otherwise healthy metrics.
**When:** `computeRiskScore` runs.
**Then:** `factors` contains no factor whose `key` relates to bus factor, and a
change in `ownership.busFactor` alone does not change `score`.

### AC-08: Banding by quartile (R5)
**Given:** profiles yielding clamped scores of 10, 30, 60, and 90.
**When:** `computeRiskScore` runs on each.
**Then:** the bands are `healthy`, `watch`, `elevated`, `urgent` respectively
(thresholds <25, 25-49, 50-74, >=75).

### AC-09: recency is a tie-breaker only (R4)
**Given:** two profiles with identical hotspot/complexity/linkage/cohesion inputs
differing only in recency (one in the top churn quartile, one not).
**When:** `computeRiskScore` runs on both.
**Then:** the `recency` factor's `weight` is `0` (it contributes nothing to the
summed score, preserving R6's "summed weights equal reported points" invariant);
it carries a `detail` documenting recent-churn status and is used only to order
otherwise-equal scores, so it never moves either profile across a band boundary.

### AC-10: graph profile <id> text + JSON output (R7)
**Given:** a real SQLite snapshot (CLI fixture) containing file node `pkg/a.ts`
with metrics.
**When:** `runGraphProfileCommand({db, repoRoot, fileId:"pkg/a.ts"})` runs and
its result is formatted.
**Then:** `formatGraphProfileText` returns a human-readable block containing the
id, band, and factor lines; `formatGraphProfileJson` returns valid JSON that
parses to `{snapshot, profile, risk}` with `profile.id === "pkg/a.ts"`.

### AC-11: graph profile registered as a subcommand (R7)
**Given:** the CLI program built by `registerGraphCommands`.
**When:** the `graph` command's subcommands are enumerated.
**Then:** a `profile` subcommand exists accepting a file-id argument and
`--json`, `--snapshot`, `--window-days` options.

### AC-12: graph report attaches RiskScore without changing markdown (R8)
**Given:** a snapshot with hotspot files.
**When:** `runGraphReportCommand` runs.
**Then:** each `HotspotRow` in the result carries a `risk` of type `RiskScore`,
`formatGraphReportJson` includes `risk.band`/`risk.score`, and
`formatGraphReportMarkdown` output is byte-identical to the pre-retrofit golden.

### AC-13: graph wiki bands via shared RiskScore (R9)
**Given:** a snapshot rendered by `graph wiki`.
**When:** a per-file / hotspot band is displayed.
**Then:** the band shown for a file equals `computeRiskScore(profile).band` for
that same file (bands are not independently recomputed).

### AC-14: Public exports available (R10)
**Given:** the built `@codewatch/graph` package.
**When:** importing from `@codewatch/graph`.
**Then:** `assembleFileProfile`, `buildAssembleCtx`, `computeRiskScore`, and the
types `FileProfile`, `AssembleCtx`, `RiskScore`, `RiskFactor` are importable.

## Edge Cases

### EC-01: Zero churn (R2, R4)
**Given:** a file with `churn_<w>=0` (or missing churn metric) and
`cognitive_max=20`.
**When:** the profile is assembled and scored.
**Then:** `activity.churnLines=0`, `activity.hotspotScore=0`, `hotspotNorm=0`,
and the `hotspot` factor contributes `0` points (no throw, no NaN).

### EC-02: Missing / degenerate package p90 anchor (R2)
**Given:** a package whose hotspot p90 anchor is `0` (all files zero churn, or a
single-file package).
**When:** the profile is assembled.
**Then:** `activity.hotspotNorm=0` (division-by-zero guarded), and the hotspot
factor contributes `0`.

### EC-03: Missing LCOM (R2, R4)
**Given:** a file with classes absent, so `lcom4_max` metric is not present.
**When:** the profile is assembled and scored.
**Then:** `complexity.lcom4Max=null` and the `cohesion` factor is absent /
contributes `0` (never treats null as `>3`).

### EC-04: Max clamp at 100 (R3)
**Given:** a profile whose raw factor sum exceeds 100 (e.g. all factors maxed =
100 plus a positive recency tie-breaker).
**When:** `computeRiskScore` runs.
**Then:** `score` equals `100` (never above), `band` is `urgent`, and the raw
factor weights are still individually reported (clamp applies to the total only).

### EC-05: Unknown / non-file id (R2, R7)
**Given:** a `fileId` that is not a file node in the snapshot (missing, or a
package/symbol node).
**When:** `assembleFileProfile` is called (or `graph profile` is invoked).
**Then:** assembly returns a defaulted profile or a typed error the CLI surfaces
cleanly (documented behavior), never an uncaught exception.

### EC-06: No git / empty coupling (R2)
**Given:** `buildAssembleCtx` is called with `coupling` omitted (no git
history).
**When:** a profile is assembled.
**Then:** `linkage.coupling` is `[]` and assembly succeeds.

### EC-07: File with no outbound or inbound edges (R1)
**Given:** an isolated file node with no edges.
**When:** the profile is assembled.
**Then:** `linkage.fanIn=0`, `linkage.fanOut=0`, `inboundEdges=[]`,
`outboundEdges=[]`, and scoring yields `0` for fan-in/fan-out factors.

## Non-Functional

### NF-01: Zero new fitness violations
`graph check` reports **0 new** violations attributable to the added/modified
files (functions <= ~30 lines; no new metric-max/product-max breaches).

### NF-02: Assembly purity (testability)
`assembleFileProfile` and `computeRiskScore` perform no filesystem, git, or DB
access - verified by unit tests that construct `AssembleCtx` / `FileProfile`
from in-memory literals only (no fixture DB).

### NF-03: Dogfood on codewatch itself
`graph profile <a real codewatch file id>` runs against codewatch's own snapshot
and prints a coherent profile + risk band with populated factors (manual
verification step recorded in the PR).

### NF-04: Type + lint clean
`tsc` and the linter report zero new warnings/errors in the added and modified
files.
