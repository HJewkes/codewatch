---
"@codewatch/cli": patch
---

Depend on `@titan-design/style-checker@^0.1.0` instead of `@codewatch/checker`, and take
`diffAgainstProfile` from it instead of the CLI's own copy. `@codewatch/checker` is no longer
built from this repo. The package carries two fixes that change what `codewatch check` finds:
the generated ESLint config now registers the TypeScript parser and the plugins each rule
needs, so ESLint rules report violations instead of failing silently, and a profile rule
whose plugin is not installed in the project is skipped and listed rather than breaking the
whole ESLint run. `codewatch diff` output is unchanged.
