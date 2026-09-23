---
"@codewatch/cli": patch
---

`graph coupled --window-days lifetime` now scans all of git history instead of returning no rows with a null window. `graph report` and `graph coupled` share one `--window-days` parser, which rejects values that are neither a positive day count nor `lifetime`.
