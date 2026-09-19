---
"@codewatch/graph": minor
"@codewatch/cli": patch
---

Mine git history with the `./history` entry of `@titan-design/code-graph@^0.2.0` instead of
`@codewatch/graph`'s own copy. Metric names, windows and values are unchanged, so the index
version stays `0.12.0`.

`@codewatch/graph` no longer exports `loadChurnEntries`, `parseChurnLog`, `resolveRenamedPath`,
`aggregateChurn`, `computeChangeCoupling`, `couplingFor` or the types `ChurnEntry`,
`ChurnWindow`, `CoEditPair`, `ChangeCouplingResult`, `ComputeChangeCouplingOptions`,
`ComputeOwnershipOptions` and `OwnershipForFile`. Import them from
`@titan-design/code-graph/history`. There, `aggregateChurn` returns per-path records instead of
metrics, and the `knownFileIds` option is named `knownPaths`. `computeTestCoverageOwnership`
is exported from the root of `@titan-design/code-graph`. `computeChurnMetrics`,
`computeOwnershipMetrics` and `ComputeChurnOptions` are removed; the package's `aggregateChurn`
and `computeOwnership` return the same numbers per path. `windowSuffix` is still exported.
