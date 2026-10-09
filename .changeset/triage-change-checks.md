---
"@codewatch/cli": minor
---

`triage` asks three new question kinds: `regnet-diff` (does the checkpoint spec require this replayed output change?), weak oracle (`symbol_weak_oracle_only`, `symbol_assertion_free`, `symbol_duplicate_assert`, `symbol_self_compare`) and `clone`, each with one planted control. They are asked whatever the file's rank or role. `--spec <file>` passes the spec to the reader from a file that must sit outside the workspace; spec citations are checked against that file, stored verdicts keep no spec quote, and the run's workflow store moves to a scratch directory, so no spec text is written under the workspace or into graph.db. Without `--spec`, `regnet-diff` findings are left unasked with a warning.
