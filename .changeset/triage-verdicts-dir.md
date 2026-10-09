---
"@codewatch/cli": minor
---

`triage --verdicts-dir <dir>` carries verdicts from committed files: it reads `<dir>/verdicts.jsonl` plus `<dir>/verdicts.d/*.jsonl` (in id order, a later row replacing an earlier one with the same key) and reuses a verdict when the finding's key and excerpt hash match, as carry-forward in graph.db does, so a rerun on an unchanged tree makes no model calls even after graph.db is deleted and rebuilt. Only this run's new verdicts are written, to `<dir>/verdicts.d/<run-id>.jsonl`; the head file is never written, and no fragment is written when there is nothing new. `--run-id <id>` names the run and its fragment. Reused rows carry `provenance: "file"`, and `triage.json` reports them under `verdictStore.files`. Without the flag, behaviour is unchanged.
