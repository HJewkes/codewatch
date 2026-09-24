---
"@codewatch/cli": minor
---

Add `codewatch triage <path> --dry-run`. It reads an existing audit, keeps files at or above `--min-rank` (default 70), and keeps only findings with a triage question. Test files are left out unless `--include-tests` is passed. It then builds per-file excerpt bundles: the innermost symbol with numbered lines, the caller for single-caller helpers, and splits over a 24k-token cap. It prints the files, questions, and a token and cost estimate without calling a model. A run without `--dry-run` exits 2 until the triage run ships.
