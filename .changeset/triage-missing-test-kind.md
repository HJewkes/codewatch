---
"@codewatch/cli": minor
---

`triage` drops the `regnet-diff` question and its control, and asks `missing-test-kind` instead, with one planted control. A `missing-test-kind` row's evidence gives `code kind:`, `missing:` and `tests:` lines; the question names the symbol, its code kind and the missing test kind, and the bundle shows every test range the evidence names. `--spec <file>` still passes the spec from outside the workspace, and is now shown beside `missing-test-kind` questions when given; without it those findings are still asked.
