---
"@codewatch/cli": patch
---

`codewatch init` and `codewatch update` now build a valid profile from the aggregated style features instead of writing the raw aggregator result, which always failed schema validation. Both commands default to the `typescript` file filter and accept `ts`, `tsx`, `py` aliases; an unknown `--languages` value is rejected with a clear message instead of silently ingesting zero files.
