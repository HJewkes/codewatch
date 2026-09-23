---
"@codewatch/cli": minor
---

Add `codewatch audit <path>`: indexes the repo, runs a built-in audit rule set over code-graph's symbol and file metrics plus the style-checker ruff audit rules, and writes `findings.jsonl` and a per-file and per-function `scores.json` ranked against the repo's own distribution. Bumps `@titan-design/code-graph` to 0.5.0 and `@titan-design/style-checker` to 0.2.0.
