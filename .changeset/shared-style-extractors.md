---
"@codewatch/core": patch
"@codewatch/cli": patch
---

`codewatch update` now runs the full style extractor set from `createStyleExtractors()`, so it no longer drops formatting, complexity and the other extractors that `analyze` runs. `@codewatch/core` re-exports its corpus types from `@titan-design/style-analyzer` instead of keeping its own copy.
