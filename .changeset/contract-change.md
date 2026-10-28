---
"@codewatch/cli": minor
---

`codewatch audit --changed-from <ref>` writes `contract-change` findings for Python and TypeScript. It indexes the ref's tree first, then compares each touched symbol's error sites and parameters against it. A finding fires when the diff removes an error site, adds a required param, removes or reorders params, or changes a default, and an affected caller or test of that symbol sits outside the diff. Error sites are counted across all changed files, so a check moved into a new helper stays silent. Audits without `--changed-from` are unchanged.
