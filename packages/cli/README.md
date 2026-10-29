# @codewatch/cli

Analyze code structure, drift, and architecture from your terminal.

`codewatch` builds a dependency graph of a TypeScript codebase and reports on
it: architectural fitness checks, coupling and churn hotspots, layering, and an
interactive dashboard.

## Install

```sh
# one-off, no install
npx @codewatch/cli graph index .

# or install the `codewatch` command globally
npm i -g @codewatch/cli
codewatch --help
```

The published binary is named **`codewatch`** regardless of how you install it.

## Quick start

```sh
codewatch graph index .          # build the graph for the current repo
codewatch graph check            # run the architectural fitness checks
codewatch graph dashboard        # generate an interactive HTML dashboard
```

Run `codewatch --help` for the full command surface.

## Reading the metrics

The metrics direct attention; they do not predict defects. Hotspots (churn × complexity) are
Adam Tornhill's hotspot analysis from *Your Code as a Crime Scene*, also used by CodeScene.
Complexity estimates comprehension friction and is shown beside LOC, because once file size is
controlled for it adds little. LCOM4 is a qualitative flag that a file may mix concerns, not a
verdict to split it.

## Audit: entry points and input classes (Python)

`codewatch audit` checks test gaps at public entry points only. An entry is a console script, a
function a `__main__` guard or `__main__.py` calls, or an HTTP `do_GET`-style handler method. A
repo with none of those uses the public functions its tests call directly instead.
`missing-test-kind` fires only on entries, so private and internal helpers get no per-symbol
test-gap rows.

For each entry, `input-classes.json` (next to `findings.jsonl`) lists the input classes its tests
feed. These are empty input; present, null, missing or empty for each optional key a reader in
its call closure reads; each CLI flag on and off; error codes asserted under only one flag
setting; and error codes no test asserts. Each class no test feeds becomes one
`entry-input-class` finding, at most five per entry and ranked. These findings are questions for
the next change, not fix items, and triage does not ask about them.

The detection is static. It follows `dict(BASE, k=v)`, `{**BASE}`, and `del`/`pop`/assignment
edits to a bound copy inside a test. It does not see inputs built at runtime (loops, fixtures,
computed parametrize ids), reader keys held in variables (`record.get(field)`), or input classes
in a pattern language inside strings.

## Audit: contract changes (Python and TypeScript)

With `--changed-from <ref>`, `codewatch audit` also indexes the ref's tree and compares the base
and head versions of each symbol the diff touches. It writes one `contract-change` finding per
change, of these kinds:

- `error-removed`: an error key (`<exception>:<message>`) counts fewer times across all changed
  files at head than at base. Error sites are `raise`/`throw`, non-zero `sys.exit`,
  `raise SystemExit`, `process.exit` and `process.exitCode`, and calls to a same-file function
  that always raises (its last statement raises and it never returns). Because the count is
  diff-wide, a check moved into a new helper or another changed file stays silent.
- `param-added` (a required param), `param-removed`, `param-reordered` and `default-changed`.
  Adding an optional param, and annotation, return-type or body-only edits, stay silent.

A finding fires when an affected caller or a test reaching the symbol through one sits outside
the diff, or, for `error-removed`, when no test asserts the error. For a param change, only the
call sites the change can break count, for example the ones that omit a changed default. The
evidence lists callers in and outside the diff, the tests outside it, and for `error-removed` the
test lines that assert the error's message (or, with no message, `raises`/`toThrow` of its
exception). "In the diff" is decided per caller span, not per file.

It does not reach renamed or deleted symbols, raiser chains deeper than one call, raisers in
another file, error codes returned as values, added error sites, or callers code-graph does not
resolve (for example a method called on a freshly constructed instance).

The same signal covers scripts at the process boundary. A changed `.py`, `.ts`, `.mts`, `.mjs`,
`.cjs` or `.js` file is a script when it has an entry guard (`if __name__ == "__main__":`,
`process.argv[1]` compared with `fileURLToPath(import.meta.url)`, `import.meta.main`,
`require.main === module`, or a `#!` line). Its kinds are `exit-code-added:<N>`,
`exit-code-removed:<N>` and `flag-removed:<--flag>`. Exit codes are `0`, literal exit codes
(each branch of a conditional), the integer returns of a same-file function an exit passes on
(one hop), and `1` when a throw or raise sits outside every try. Flags come from
`argv.includes(...)`, `add_argument(...)` and `parseArgs({ options })`; added flags stay silent.

Invokers are lines of tracked `package.json`, YAML, `Makefile`, shell and source files (never
docs) that hold the script's path, its basename inside a string or config value, or
`-m <module>` for Python. A line that runs a `package.json` script which invokes it also counts,
cited `via <name>` (one hop). A removed flag affects only invokers that pass it. The finding
fires when an affected invoker sits outside the diff, decided per line.

## Audit: extreme mutation (TypeScript, opt-in)

`codewatch audit --changed-from <ref> --extreme-coverage <coverage-final.json>` also makes each
changed function that the coverage file marks as run return at once, one mutant per function,
and runs its package's tests against it in a throwaway worktree at the committed `HEAD`. The
coverage file must be a whole-suite Istanbul JSON report measured at that `HEAD`. Nothing in your
checkout is written.

- `pseudo-tested`: the mutant built and no test failed.
- `test-deletion-candidate`: a test that passed, failed under no mutant, and reaches only
  pseudo-tested functions. It is advisory only; codewatch never deletes or edits a test.

Both are qualitative flags at weight 0: they are listed apart and counted in no score.
`extreme.json`, next to `findings.jsonl`, holds the run's counts and per-mutant outcomes.

## Requirements

- Node.js >= 20

## License

MIT
