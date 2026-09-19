# Releasing @codewatch/* to npm

Publishing uses npm trusted publishing (OIDC). There is no `NPM_TOKEN` secret and no
access token of any kind. Do not add one.

## Normal release

1. Land changesets on `main` (`pnpm changeset`), then `pnpm version-packages` and commit
   the version bumps.
2. Actions, **Release**, **Run workflow** with `dry_run` left `true`. Check the tarball
   listing.
3. Run it again with `dry_run` set to `false`. The job exchanges its GitHub OIDC identity
   for a short-lived npm credential and runs `pnpm changeset publish`.
4. Verify: `npm view @codewatch/cli version` and `npx codewatch --version` from a temp
   directory.

Requirements the workflow already meets: `permissions: id-token: write`, npm 11.5.1 or
later (pinned to 11.x), Node 22.14 or later.

## First publish of a new package

npm cannot configure a trusted publisher for a package that does not exist yet, and it has
no pending-publisher feature (npm/cli#8544). The first version of any new package is
therefore published by hand, once, with an interactive login:

```sh
git checkout main && git pull
pnpm install --frozen-lockfile && pnpm -r run build
npm login --auth-type=web          # browser login with your security key, no token stored in CI
pnpm -r publish --access public --no-git-checks
```

Use `pnpm publish`, not `npm publish`: only pnpm rewrites `workspace:` dependency ranges
into real version ranges. `pnpm -r publish` skips private packages and versions already on
the registry, and publishes in dependency order.

Then, for each new package, on `https://www.npmjs.com/package/<name>/access`, add a
trusted publisher: GitHub Actions, organization or user `HJewkes`, repository `codewatch`,
workflow filename `release.yml`, no environment. This needs a security-key challenge per
package. Every later release goes through the workflow above.

Finish with `npm logout`.
