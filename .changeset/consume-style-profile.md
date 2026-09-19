---
"@codewatch/cli": patch
---

Depend on `@titan-design/style-profile@^0.1.0` instead of `@codewatch/profile`. The profile
schema and exporters are the same code, ported unchanged, so profiles, analyze output and
every export format are byte-identical. `@codewatch/profile` is no longer built from this
repo. One fix comes with the package: `codewatch export --format skill` from the published
CLI no longer fails with ENOENT, because the package ships the skill templates it renders.
