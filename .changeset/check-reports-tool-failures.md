---
"@codewatch/cli": minor
---

`codewatch check` now reports when ruff or ESLint could not do its job, and exits 1 when that
happens.

Before: a missing `ruff` stopped the run with `Failed to spawn ruff: spawn ruff ENOENT` and
exit 1, while every other tool problem (a missing ESLint, an ESLint config error, a file a
tool could not parse) printed `No violations found.` and exited 0.

After: every tool problem is reported and the run exits 1. A missing `ruff` still prints
`Failed to spawn ruff: spawn ruff ENOENT`, now as a `failed ... [ruff.spawn-failed]` line
instead of an error that aborts the run, and diagnostics from the other tool are still shown.
A profile rule skipped because its ESLint plugin is not installed is printed as a `skipped`
warning and does not change the exit code. `--format json` gains `failures` and
`skippedRules` arrays. `--format reviewdog` keeps stdout to diagnostics only and writes
failures and skipped rules to stderr.
