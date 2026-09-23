# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) —
one markdown file per pending change describing the version bump it warrants.

- Add one with `pnpm changeset` (pick the bump, write a summary).
- The `@codewatch/*` packages are a **fixed** group: a single changeset bumps every
  package in lockstep. Only `@codewatch/cli` is published; `core` and `render` are
  private and bundled into it.
- `pnpm version-packages` applies pending changesets (bumps versions, writes
  changelogs). The **Release** workflow publishes.

See `docs/releasing.md` for the full release runbook.
