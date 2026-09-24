---
"@codewatch/cli": minor
---

`codewatch triage <path>` without `--dry-run` now runs the model reader. It sends each selected file bundle, plus four planted control bundles at seeded positions, to a no-tools reader (default `sonnet`, `--concurrency 4`, `--budget-usd 5`). It verifies every cited line and quote against the lines the bundle showed and drops any verdict it cannot verify or that answers a question never asked. Results go to `.codewatch/audit/verdicts.jsonl` and `triage.json` (cost, control accuracy, verdict and drop counts, skipped bundles). A clean control answered `confirmed` or a slop control answered `justified` marks every verdict in the run `provisional`. Missing model auth fails before any call, in one line. The graph database now migrates to schema 4 (code-graph 0.9.0), which older codewatch builds refuse to open.
