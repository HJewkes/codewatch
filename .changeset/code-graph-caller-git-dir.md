---
"@codewatch/cli": patch
---

`graph index --rev` now works when the caller sets GIT_DIR to a git dir outside the work tree, as a work tree with no `.git` needs (`@titan-design/code-graph` 0.18.2).
