# @codewatch/render

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.0

### Minor Changes

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
