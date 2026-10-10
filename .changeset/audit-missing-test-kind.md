---
"@codewatch/cli": minor
---

`codewatch audit` writes `missing-test-kind` findings for Python, from the code-kind and test-kind metrics in `@titan-design/code-graph` 0.16. A policy table says which test kinds each code kind needs. An output boundary needs a snapshot or exact-output test and an error-path test. A parser needs a malformed-input error-path test. Pure logic needs an exact-value test, and I/O needs an error-path test. Each finding's evidence names the code kind, the missing test kind and the tests that reach the symbol. A symbol is checked only when a test reaches it, or when `--changed-from <ref>` shows the change touches it. An output boundary whose tests assert only loose output is flagged. The first index after upgrading reparses every file, because code-graph's `INDEX_VERSION` changed.
