---
"@codewatch/cli": minor
---

`codewatch triage` plants at least one control per question kind the run asks, reports "controls not run" when no planted control reached the reader, and takes `--max-failures` (default 3): retryable reader failures up to that count are recorded in triage.json with their cost and no longer stop the run. Consumes `@titan-design/agent` 0.4.1 and `@titan-design/workflow` 0.4.2.
