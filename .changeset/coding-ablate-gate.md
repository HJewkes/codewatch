---
"@codewatch/cli": patch
---

Add the coding-bench ablation necessity gate: it restores each dark file to its parent content at the fix commit and records whether the `failToPass` tests or `tsc` notice. `CodingTask` gains an optional per-file `adjudication`.
