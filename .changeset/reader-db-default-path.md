---
"@codewatch/cli": patch
---

Graph readers without `--db` now open the same database `graph index` writes (the git toplevel's `.codewatch/graph.db`) instead of one in the current directory, so running them from a subdirectory reads the real index and creates nothing. `graph index` on a tree that is not a git repository no longer computes churn or ownership; its output and `--json` result (`churn: "unavailable"`) say so.
