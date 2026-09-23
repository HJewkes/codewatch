---
"@codewatch/cli": minor
---

`codewatch audit` adds five code-graph rules (symbol-pass-through, symbol-narrating-comments, symbol-comment-ratio above 1.0, file-swallowed-except, file-except-density above 5 handlers per 100 lines) and runs vulture, pydoclint, pyright, import-linter and a suppression count over Python trees. A tool that is not installed or not configured is skipped with a warning.
