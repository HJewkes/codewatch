---
"@codewatch/cli": patch
---

`graph report` and `graph wiki` now take their report sections (hotspots, bus factor, test coverage, centrality, unused exports, unreferenced files, growth and untested risks, and drift) from `@titan-design/code-graph` 0.14.0 instead of local copies. Report output is unchanged.
