---
"@codewatch/cli": patch
---

`graph arch` and `graph wiki` now call `computeArch`, `bucketFilesByPackage` and their helpers from `@titan-design/code-graph` and drop codewatch's duplicate copies. Output does not change.
