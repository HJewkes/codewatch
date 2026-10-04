---
"@codewatch/cli": patch
---

`audit`, `triage` and the installed git hooks now resolve the graph database and audit output like `graph index` (the git toplevel), so running them from a subdirectory creates no `.codewatch` there. On a tree without git history, `graph report` and the dashboard say churn and ownership are unavailable, and `graph index` no longer lists churn and ownership among the metrics it computed.
