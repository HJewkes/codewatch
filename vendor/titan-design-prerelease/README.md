# TEMPORARY: unreleased titan-platform packages

These tarballs are `pnpm pack` output of titan-platform `main` at
`9ad447f5db02debf9cb69a386fa7a8bea3bb85ab`, which carries the extreme-mutation exports and
`.mjs` indexing that npm's `@titan-design/code-graph@0.18.2` lacks. The root `package.json`
points `pnpm.overrides` at them.

When the code-graph release is on npm, delete this directory and the overrides, set
`@titan-design/code-graph` in `packages/cli/package.json` to the new version and
`@titan-design/code-parser` there to the release carrying `.mjs` indexing (the CLI's contract
audit parses `.mjs` only with it), and run `pnpm install`. No `file:` dependency may merge.
