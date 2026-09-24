---
"@codewatch/cli": minor
---

Consume `@titan-design/code-graph` 0.8.0 (INDEX_VERSION 0.18.0), so existing graphs re-index on the next run and `except ImportError` fallbacks no longer count as swallowed exceptions. `codewatch audit` now ranks `symbol-comment-ratio` (floor 0.5) and `file-except-density` (floor 3) as top-decile outliers among non-zero carriers instead of fixed maxima, and adds the `symbol-single-caller-helper` and `symbol-constant-params` rules over the new call graph.
