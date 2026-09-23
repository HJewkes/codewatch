# @codewatch/cli

## 0.4.0

### Minor Changes

- 48938ca: Add `codewatch audit <path>`: indexes the repo, runs a built-in audit rule set over code-graph's symbol and file metrics plus the style-checker ruff audit rules, and writes `findings.jsonl` and a per-file and per-function `scores.json` ranked against the repo's own distribution. Bumps `@titan-design/code-graph` to 0.5.0 and `@titan-design/style-checker` to 0.2.0.
- d8e6b48: Add two audit rules over `@titan-design/code-graph` 0.6.0's new per-function metrics: `symbol-loc` (flags functions over 60 lines) and `symbol-nesting` (flags functions with block nesting deeper than 4). Bumps `@titan-design/code-graph` to 0.6.0.

## 0.3.0

### Minor Changes

- a6bca7e: Add `graph conventions` (convention map of capability areas with cached LLM summaries, `--query` ranking), the `get_conventions` MCP tool, and read API 1.3.0 `getConventions`/`findConventions`, consuming @titan-design/code-graph 0.4.0.

## 0.2.0

### Minor Changes

- f565168: `codewatch check` now reports when ruff or ESLint could not do its job, and exits 1 when that
  happens.

  Before: a missing `ruff` stopped the run with `Failed to spawn ruff: spawn ruff ENOENT` and
  exit 1, while every other tool problem (a missing ESLint, an ESLint config error, a file a
  tool could not parse) printed `No violations found.` and exited 0.

  After: every tool problem is reported and the run exits 1. A missing `ruff` still prints
  `Failed to spawn ruff: spawn ruff ENOENT`, now as a `failed ... [ruff.spawn-failed]` line
  instead of an error that aborts the run, and diagnostics from the other tool are still shown.
  A profile rule skipped because its ESLint plugin is not installed is printed as a `skipped`
  warning and does not change the exit code. `--format json` gains `failures` and
  `skippedRules` arrays. `--format reviewdog` keeps stdout to diagnostics only and writes
  failures and skipped rules to stderr.

- 2b96ac8: Publish `@codewatch/cli` as the only codewatch package. The CLI build now bundles the code of
  `@codewatch/core` and `@codewatch/render`, and declares their runtime dependencies (`octokit`,
  `cytoscape`, `cytoscape-cose-bilkent`, `cose-base`, `layout-base`, `elkjs`) itself. Those two
  packages are private and will not be published again; install `@codewatch/cli` instead.
  Every `@titan-design/*` package remains an ordinary npm dependency.
- f2ebc66: Run every `graph` command on the store, indexer, checks, diffs and similar-symbol search of
  `@titan-design/code-graph@^0.3.0`, and embeddings on `@titan-design/embed@^0.2.0`.
  `@codewatch/graph` is gone. Its engine now lives in `@titan-design/code-graph`, and
  `@codewatch/render` takes that package's `CodeGraphStore` in place of `GraphDatabase`.

  One documented break: an existing `.codewatch/graph.db` must be reindexed. `graph index` renames
  it aside to `graph.db.legacy-<its index version>` with one stderr line and builds a fresh store.
  Every other command exits 1 with "this database predates codewatch 0.2; run `codewatch graph
index`". A `check --baseline <ref>` needs one `graph index --ref <baseline>` after upgrading.

  Python files are now indexed by default, next to TypeScript. They have no dead-code metrics,
  growth risk gives them only `loop_depth`, and they record no signatures or docstrings, so no
  Python symbol enters the `graph similar` corpus. Their imports resolve by dotted path, without
  a type checker.

  Other visible changes: symbol ids are qualified by their enclosing scope
  (`file.ts#Class.method`, index version 0.15.0), and a file rename carries its violations over as
  carryover. `graph similar` and `graph embed` now apply nomic's `search_document:` and
  `search_query:` prefixes by default, so rankings change once and existing vectors are
  re-embedded. `graph index` prints only the total time, not per-phase durations; its `--json`
  `durationMs` holds only `total`.

- fcd9c2b: Parse files with `@titan-design/code-parser@^0.1.0` instead of `@codewatch/core`'s own
  parser. `@codewatch/core` no longer exports `parseFile`, `getSupportedLanguages`,
  `shouldIncludeFile`, `getLanguageFromPath`, `isExcludedDir`, `ParsedFile` or `Extractor`;
  import them from `@titan-design/code-parser`, which has the same signatures. `@codewatch/core`
  keeps `GitHubService`, the LLM providers, `LlmRunner` and `FileCache`. `@codewatch/graph` no
  longer depends on `@codewatch/core`. The package brings two behaviour changes.

  `.tsx` files are now parsed with the TSX grammar. Before, they were parsed with the
  TypeScript grammar, which cannot read JSX, so almost every `.tsx` file produced a tree with
  parse errors. On titan-design, files with parse errors fell from 543 of 569 `.tsx` files to 6.
  Every number computed from those trees changes for `.tsx` files only:

  - `graph index`: cognitive and cyclomatic complexity, nesting depth, function counts, unused
    parameters and locals, and symbol line spans. Components the broken parse missed now appear
    as symbols, and symbols it invented disappear. Imports and other edges do not change.
    Because the same bytes now give different values, the index version moves to `0.12.0` and
    the first `graph index` after upgrading rebuilds every file instead of reusing an older
    snapshot.
  - `graph check`, `graph report` and `graph top` follow those metrics, so `.tsx` files can
    newly cross a complexity threshold or enter a hotspot list.
  - `analyze`, `diff`, `init` and `update` see more observations in `.tsx` files (functions,
    ternaries, array methods and JSDoc that the broken parse lost), so profile confidences can
    move. `.ts` and `.py` results are unchanged.

  `.js` and `.jsx` files are no longer recognised as a language. codewatch never had a
  JavaScript grammar: before, a `.js` or `.jsx` file was classed as `javascript` and then
  failed to parse, which stopped the whole run with `Unsupported language: javascript`.

  - `codewatch diff` no longer stops when a `.js` or `.jsx` file is staged or changed. It checks
    the other files and prints `Skipped N file(s) with no parser: <paths>` to stderr. The exit
    code still depends only on the deviations found.
  - `codewatch analyze --lang` rejects any language it cannot parse, before reading any file:
    `Unsupported language: javascript (supported: typescript, python)`, exit 1. Before, it
    failed only when the tree held a `.js` or `.jsx` file, and other unknown languages found
    no files and exited 0.
  - `init` and `update` leave `.js` and `.jsx` files out of the ingested corpus instead of
    failing on them.

### Patch Changes

- 5055d8f: Mine git history with the `./history` entry of `@titan-design/code-graph@^0.2.0` instead of
  `@codewatch/graph`'s own copy. Metric names, windows and values are unchanged, so the index
  version stays `0.12.0`.

  `@codewatch/graph` no longer exports `loadChurnEntries`, `parseChurnLog`, `resolveRenamedPath`,
  `aggregateChurn`, `computeChangeCoupling`, `couplingFor` or the types `ChurnEntry`,
  `ChurnWindow`, `CoEditPair`, `ChangeCouplingResult`, `ComputeChangeCouplingOptions`,
  `ComputeOwnershipOptions` and `OwnershipForFile`. Import them from
  `@titan-design/code-graph/history`. There, `aggregateChurn` returns per-path records instead of
  metrics, and the `knownFileIds` option is named `knownPaths`. `computeTestCoverageOwnership`
  is exported from the root of `@titan-design/code-graph`. `computeChurnMetrics`,
  `computeOwnershipMetrics` and `ComputeChurnOptions` are removed; the package's `aggregateChurn`
  and `computeOwnership` return the same numbers per path. `windowSuffix` is still exported.

- e56b402: Depend on `@titan-design/style-analyzer@^0.1.0` instead of `@codewatch/analyzer`, which is
  no longer built from this repo. The switch does not change how files are parsed, so the
  same files produce the same observation counts. The package carries three fixes that change what
  `codewatch analyze`, `init` and `update` report:

  - Stability ratings now match the observation types the extractors emit. Fourteen types
    that silently fell back to `medium` are rated `high` as intended: `naming.variable`,
    `.function`, `.type`, `.constant`, `.enum` and `.private-member`;
    `control-flow.guard-clause`, `.array-method` and `.async-await`;
    `documentation.jsdoc-presence`; and `error-handling.try-catch`, `.result-type`,
    `.exhaustive-switch` and `.assert-never`. Their confidence rises from
    `consistency * 0.85` to `consistency`, and some move from `warn` to `error`.
  - Python capitals assignments at module scope, including inside a module-level `if`,
    `try`, `except` or `with` block, are reported as `naming.constant` instead of
    `naming.variable`.
  - A single capitalised word of two or more characters (`const DAY = 86400`,
    `VERSION = "1.0.0"`) counts as a constant name in TypeScript and Python. A single letter
    such as `T = TypeVar("T")` stays a variable.

  A profile generated from the same code therefore carries higher confidences and a
  `naming.constant` rule for Python. `codewatch diff` against such a profile no longer
  reports these constants as variable-naming deviations, and it grades naming deviations as
  errors when the profile rule's confidence is now 0.85 or more.

- f565168: Depend on `@titan-design/style-checker@^0.1.0` instead of `@codewatch/checker`, and take
  `diffAgainstProfile` from it instead of the CLI's own copy. `@codewatch/checker` is no longer
  built from this repo. The package carries two fixes that change what `codewatch check` finds:
  the generated ESLint config now registers the TypeScript parser and the plugins each rule
  needs, so ESLint rules report violations instead of failing silently, and a profile rule
  whose plugin is not installed in the project is skipped and listed rather than breaking the
  whole ESLint run. `codewatch diff` output is unchanged.
- f26abdf: Depend on `@titan-design/style-profile@^0.1.0` instead of `@codewatch/profile`. The profile
  schema and exporters are the same code, ported unchanged, so profiles, analyze output and
  every export format are byte-identical. `@codewatch/profile` is no longer built from this
  repo. One fix comes with the package: `codewatch export --format skill` from the published
  CLI no longer fails with ENOENT, because the package ships the skill templates it renders.
- 1000b00: `graph coupled --window-days lifetime` now scans all of git history instead of returning no rows with a null window. `graph report` and `graph coupled` share one `--window-days` parser, which rejects values that are neither a positive day count nor `lifetime`.
- 58c626d: `codewatch init` and `codewatch update` now build a valid profile from the aggregated style features instead of writing the raw aggregator result, which always failed schema validation. Both commands default to the `typescript` file filter and accept `ts`, `tsx`, `py` aliases; an unknown `--languages` value is rejected with a clear message instead of silently ingesting zero files.
