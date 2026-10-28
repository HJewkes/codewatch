---
"@codewatch/cli": patch
---

`codewatch analyze` now reads only the project's own files, the same scope as `graph index`, so a `.venv` or other untracked tool environment no longer feeds its conventions.
