# codewatch

pnpm monorepo of `@codewatch/*` packages (`core`, `analyzer`, `checker`, `graph`, `cli`,
`profile`, `render`) plus the `codewatch` CLI. Read `README.md` for what the tool does; this
file is the short version for agents.

## Direction: this repo is becoming a thin composition

codewatch's engine code is being ported into the titan-platform monorepo and published as
`@titan-design/*` packages. This repo stays the product's home and shrinks to a composition
over those packages.

- **Port first, strictly.** Do not add a new detector, metric, tool runner, or command to
  `packages/*` here. New engine work lands in titan-platform, in the package the ported unit
  lives in, after that unit has been ported.
- **A port unit is done only when this repo consumes the published release and deletes its
  own copy.** Until then the original stays as it is, bug fixes excepted.
- Port units are tracked as TP tasks in the titan-platform initiative.

## Where shared code lives

> **Where shared code lives.** Reusable engine code lives in the titan-platform monorepo
> (`~/projects/titan-platform`, `packages/*`), published to npm as `@titan-design/*`.
> Product repos (active-work, agent-chat, relay, codewatch) are thin compositions over those
> packages. The design system is separate: `~/projects/titan-design` publishes
> `@titan-design/react-ui`.
>
> **Before building new functionality, ask three questions in order.**
> 1. Does a `@titan-design/*` package already do this? Read the package list in
>    `titan-platform/README.md` and the package's own README. If yes, install it from npm.
>    Never copy its source and never use a relative `file:` dependency.
> 2. Is it product-specific (this product's policy, vocabulary, or UI)? Then build it here.
> 3. Would a second product plausibly want it? Then build it in titan-platform as a package
>    (or extend an existing one), release it through changesets, and consume the release
>    here. File the package work as a TP task in the titan-platform initiative and link it
>    from this initiative's task.
>
> **When a package almost fits,** do not fork it locally. File a TP task naming the missing
> export, and either wait for the release or build a product-side adapter that is deleted
> when the release lands.
>
> **Tier rule.** Packages depend only on lower tiers (0 primitives, 1 engines, 2 domain).
> Products never depend on other products' source; they talk over a process boundary
> (CLI, loopback HTTP, MCP).
>
> **Extraction is not done until the source repo consumes the package.** An extraction that
> leaves the original copy in place creates two diverging implementations. The swap-back is
> part of the same task.

## Before you finish any change

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

All four must be green. CI also runs the fitness gate, `graph check --snapshot head
--baseline main`, against `.codewatch/check.json`. The `max-file-loc` limit is 350 lines:
extract rather than append.

## Conventions

- Releases run through changesets. Add one (`pnpm changeset`) for any change under
  `packages/*` that should ship; CI does not enforce it.
- Name things in neutral code-analysis terms: findings, audit, report.
