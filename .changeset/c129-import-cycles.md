---
"@codewatch/cli": minor
---

`codewatch audit` reports file import cycles as `file-import-cycles` findings, each naming its member files (`members`) and its `cycleKind`. A cycle closed only by `import type` edges is not reported. `graph init` now scaffolds a `no-import-cycles` fitness rule.
