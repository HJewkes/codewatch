# Releasing @codewatch/cli to npm

`@codewatch/cli` is the only package this repo publishes. `@codewatch/core` and
`@codewatch/render` are private workspace packages: the CLI build bundles their code into
`packages/cli/dist`, and their runtime dependencies are declared in the CLI's own
`dependencies`. Every `@titan-design/*` package stays an external npm dependency.

Publishing uses npm trusted publishing (OIDC). There is no `NPM_TOKEN` secret and no
access token of any kind. Do not add one.

## Normal release

1. Land changesets on `main` (`pnpm changeset`), then `pnpm version-packages` and commit
   the version bumps. The fixed `@codewatch/*` group also bumps the private packages;
   that is harmless because they are never published.
2. Actions, **Release**, **Run workflow** with `dry_run` left `true`. The tarball listing
   shows exactly one package, `@codewatch/cli`.
3. Run it again with `dry_run` set to `false`. The job exchanges its GitHub OIDC identity
   for a short-lived npm credential and runs `pnpm changeset publish`, which skips
   private packages.
4. Verify: `npm view @codewatch/cli version` and `npx codewatch --version` from a temp
   directory.

Requirements the workflow already meets: `permissions: id-token: write`, npm 11.5.1 or
later (pinned to 11.x), Node 22.14 or later.

## Checking the tarball locally

```sh
pnpm install --frozen-lockfile && pnpm build
cd packages/cli && pnpm pack --pack-destination /tmp/cw-pack
mkdir /tmp/cw-smoke && cd /tmp/cw-smoke && npm init -y && npm i /tmp/cw-pack/codewatch-cli-*.tgz
npx codewatch --version
```

`packages/cli/src/__tests__/publish-bundle.test.ts` fails if the build imports any
`@codewatch/*` package or if the CLI declares one as a runtime dependency.

## Adding a new published package

Avoid this: new internal code goes in a private workspace package bundled into the CLI,
and reusable engine code goes in titan-platform as a `@titan-design/*` package. If a
second published name is ever needed, npm cannot configure a trusted publisher for a
package that does not exist yet (npm/cli#8544). Its first version is published by hand,
once, with `npm login --auth-type=web` and `pnpm publish --access public --no-git-checks`
from the package directory. Then add a trusted publisher on
`https://www.npmjs.com/package/<name>/access`: GitHub Actions, user `HJewkes`, repository
`codewatch`, workflow filename `release.yml`, no environment. Finish with `npm logout`.

## Retired names

Six names published at 0.1.0 are no longer released from this repo. Run these once,
after the 0.2.0 release of `@codewatch/cli` is on npm, logged in with
`npm login --auth-type=web`:

```sh
npm deprecate @codewatch/profile "Merged into @titan-design/style-profile; install that package instead. The codewatch CLI (@codewatch/cli) no longer uses @codewatch/profile."
npm deprecate @codewatch/checker "Merged into @titan-design/style-checker; install that package instead. The codewatch CLI (@codewatch/cli) no longer uses @codewatch/checker."
npm deprecate @codewatch/analyzer "Merged into @titan-design/style-analyzer; install that package instead. The codewatch CLI (@codewatch/cli) no longer uses @codewatch/analyzer."
npm deprecate @codewatch/graph "Merged into @titan-design/code-graph; install that package instead. The codewatch CLI (@codewatch/cli) no longer uses @codewatch/graph."
npm deprecate @codewatch/core "Bundled into @codewatch/cli; install that package instead."
npm deprecate @codewatch/render "Bundled into @codewatch/cli; install that package instead."
```

The trusted publishers configured on the retired names stay in place. They are
harmless: nothing publishes those names any more.
