---
"@codewatch/cli": patch
---

`graph report` and `graph wiki` now take their report sections (hotspots, bus factor, test coverage, centrality, unused exports, unreferenced files, growth and untested risks, and drift) from `@titan-design/code-graph` instead of local copies. The report code is unchanged, so the same index gives the same report.

The move from code-graph 0.9 to 0.14 does change the indexer, and the next index of an existing store is a full re-index:

- New `story` and `lab` file roles. Story and lab files also seed dead-module reachability, so they are no longer reported as unreferenced.
- Generator functions, abstract classes and `const`-bound generator expressions now get symbol nodes and complexity metrics.
- `linguist-generated` patterns in `.gitattributes` now match the way git matches them.
