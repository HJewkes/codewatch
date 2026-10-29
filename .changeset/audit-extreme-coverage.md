---
"@codewatch/cli": minor
---

`codewatch audit --changed-from <ref> --extreme-coverage <coverage-final.json>` body-deletes each changed, covered TypeScript function at `HEAD` through code-graph's extreme mutation, and writes `pseudo-tested` and `test-deletion-candidate` findings at weight 0 plus an `extreme.json` summary. The contract-change audit now also reads `.mjs` files, which code-graph indexes.
