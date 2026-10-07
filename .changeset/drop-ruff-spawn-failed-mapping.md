---
"@codewatch/cli": patch
---

`audit` consumes `@titan-design/style-checker` 0.4.3, which reports a missing ruff as the warning `ruff not found; install with \`pip install ruff\``. The audit's own "not found on PATH" mapping for spawn failures is removed, so every Python tool reports a missing binary the same way.
