---
"@codewatch/cli": minor
---

`graph diff --footprint` diffs symbol footprints between two snapshots and gates doc units: it prints the changed symbols with reasons, the units to regenerate or skip, `llmCallNeeded`, and fresh unit provenance records. `--units` takes custom units and `--provenance` gates against a prior run. `graph diff --from previous` now resolves to the snapshot before `--to`.
