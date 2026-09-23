---
"@codewatch/cli": minor
---

`codewatch audit` adds five code-graph rules (symbol-pass-through, symbol-narrating-comments, symbol-comment-ratio at the 90th percentile, file-swallowed-except, file-except-density at the 90th percentile) and runs vulture, pydoclint, pyright, import-linter and a suppression count over Python trees. A tool that is not installed or not configured is skipped with a warning.
