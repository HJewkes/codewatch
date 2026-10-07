---
"@codewatch/cli": minor
---

`graph index --rev <rev> <paths...>` indexes a git commit's tree straight from git objects, without a checkout and regardless of the working tree. Node ids stay rooted at the repo root, so the snapshot lines up with a working-tree index of the same commit. The snapshot label defaults to the rev when `--ref` is not given, and an unknown rev exits 1 with a one-line error.
