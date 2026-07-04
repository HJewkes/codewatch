# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) —
one markdown file per pending change describing the version bump it warrants.

- Add one with `pnpm changeset` (pick the bump, write a summary).
- The `@codewatch/*` packages are a **fixed** group: they always version and
  publish together, so a single changeset bumps every package in lockstep.
- `pnpm version-packages` applies pending changesets (bumps versions, writes
  changelogs). `pnpm release` builds and publishes.

See the repository README for the full release runbook.
