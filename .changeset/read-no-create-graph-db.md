---
"@codewatch/cli": patch
---

Read commands, including `graph render`, `graph render-diff` and `graph dashboard`, no longer create an empty `.codewatch/graph.db` when none exists. They fail with "no graph.db at <path>; run codewatch graph index" and leave the path absent; `graph index` still creates the database.
