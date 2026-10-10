---
"@codewatch/cli": minor
---

`codewatch triage --budget-usd` no longer defaults to 5: unset means no budget cap, and the report's `settings.budgetUsd` is `null`. `--max-failures` keeps its default of 3.
