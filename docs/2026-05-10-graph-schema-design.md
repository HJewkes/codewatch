# Graph schema design

_The load-bearing artifact under every Move 1+ consumer (render, diff, check, plan-verify, MCP). Companion to `docs/audit-2026-05-10-substrate-readiness.md` and `docs/2026-05-10-core-extraction-plan.md`._

## Goals

- A SQLite schema that survives renames, supports two-snapshot diffs, and can hold metrics, symbols, and the dependency graph for a TS or Python repo.
- Stable IDs that let a node in `main` resolve to its counterpart in `feature/foo`.
- Storage layout that scales to a 100k-LOC repo on a developer laptop with subsecond query times.
- A small, opinionated query catalog that every downstream consumer reads from.

## Non-goals

- Symbol-level callgraph in v1. Files + modules + import edges are enough for Move 1 (architecture render). Symbols are a v1.1 addition once the schema is stable.
- A full ORM or query builder. Plain prepared statements via `better-sqlite3` are enough.
- Multi-repo / cross-repo. One DB per repo. Federation lives in brain.
- Live / streaming updates. Batch index after merge / on demand. LSP-class freshness is six moves too early.
- Schema migrations as a hot-path concern. Design once, version it, accept that v1 → v2 will be a re-index.

## Identity (the load-bearing decision)

Every consumer relies on this. Get it right.

### ID kinds

| Kind | Format | Survives | Example |
|------|--------|----------|---------|
| `package` | npm or workspace package name | renames within repo if package.json `name` is unchanged | `@code-style/analyzer` |
| `module` | repo-relative path with extension stripped | content edits within a file | `packages/analyzer/src/ingest/cache` |
| `file` | repo-relative path with extension | content edits within a file | `packages/analyzer/src/ingest/cache.ts` |
| `symbol` | `<module-id>::<dotted-path>` | edits to function body, sibling symbols changing | `packages/analyzer/src/ingest/cache::FileCache.get` |
| `external` | `npm:<spec>` or `node:<builtin>` | nothing changes | `npm:better-sqlite3@^11`, `node:fs/promises` |

Every node has a stable ID (`id`) and a per-snapshot row. Ten snapshots of one file produce ten `node` rows with the same `id`.

### Renames and moves

Renames and moves break path-based identity. Two strategies, used together:

1. **`id_alias` table** — populated at ingestion time using `git diff -M --find-renames`. Maps `(snapshot_id, old_id) → new_id, reason`. The diff query consults it transparently.
2. **Content fingerprints on file nodes** — each `file` node records a `content_hash` and a `symbol_set_hash`. The diff walker uses these as a sanity check on the alias table; if a "rename" has zero shared symbols, it's recorded as `delete + add` instead.

Symbol IDs use the dotted path within the file. If a symbol is renamed in place, that's a delete + add at the symbol level even if the file is the same — that's the right semantic (`FileCache.fetch` ≠ `FileCache.get`).

### Worked examples

| Change | Old ID | New ID | Recorded as |
|--------|--------|--------|-------------|
| Edit body of `FileCache.get` | `…cache::FileCache.get` | same | metric delta only |
| Rename file `cache.ts` → `disk-cache.ts` | `…/ingest/cache` | `…/ingest/disk-cache` | alias + node update |
| Move file to a new dir | `…/ingest/cache` | `…/storage/cache` | alias + node update |
| Rename method `get` → `fetch` | `…cache::FileCache.get` | `…cache::FileCache.fetch` | delete + add at symbol level |
| Split file into two | `…/ingest/cache` | `…/ingest/cache` + `…/ingest/cache-meta` | first stays, second is added |
| Merge two files | `a` + `b` | `a` | `b` is deleted; symbols re-parented to `a` |

## Tables

```sql
-- One row per indexing run.
CREATE TABLE snapshot (
  id            INTEGER PRIMARY KEY,
  ref           TEXT NOT NULL,                      -- 'main', 'feature/foo', 'wd' for working dir
  commit_hash   TEXT,                               -- nullable when ref='wd'
  taken_at      TEXT NOT NULL,                      -- ISO 8601
  index_version TEXT NOT NULL,                      -- semver of the indexer that produced it
  attrs         JSON NOT NULL DEFAULT '{}'          -- repo metadata, language stats, etc.
);

CREATE INDEX idx_snapshot_ref ON snapshot (ref, taken_at DESC);

-- Nodes per snapshot.
CREATE TABLE node (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,                      -- stable ID
  kind          TEXT NOT NULL CHECK (kind IN ('package','module','file','symbol','external')),
  name          TEXT NOT NULL,                      -- display name
  parent_id     TEXT,                               -- e.g. file → module → package
  language      TEXT,                               -- 'typescript' | 'python' | NULL
  attrs         JSON NOT NULL DEFAULT '{}',         -- loc, doc_summary, role, content_hash, symbol_set_hash
  PRIMARY KEY (snapshot_id, id)
);

CREATE INDEX idx_node_kind   ON node (snapshot_id, kind);
CREATE INDEX idx_node_parent ON node (snapshot_id, parent_id);

-- Edges per snapshot.
CREATE TABLE edge (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  src_id        TEXT NOT NULL,
  dst_id        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('imports','re-exports','calls','extends','implements','references','depends-on')),
  attrs         JSON NOT NULL DEFAULT '{}',         -- count, lines, weight, condition
  PRIMARY KEY (snapshot_id, src_id, dst_id, kind)
);

CREATE INDEX idx_edge_src ON edge (snapshot_id, src_id, kind);
CREATE INDEX idx_edge_dst ON edge (snapshot_id, dst_id, kind);

-- Per-node metrics. Wide-form so adding a metric requires no schema change.
CREATE TABLE metric (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  name          TEXT NOT NULL,                      -- 'loc' | 'cyclomatic' | 'fan_in' | 'fan_out' | 'instability' | 'abstractness' | 'churn_30d' | 'authors_30d' | 'doc_coverage' | …
  value         REAL,
  unit          TEXT,                               -- 'count' | 'ratio' | 'lines' | 'commits' | …
  PRIMARY KEY (snapshot_id, node_id, name)
);

CREATE INDEX idx_metric_name ON metric (snapshot_id, name, value DESC);

-- Rename / move tracking. Populated from git rename detection.
CREATE TABLE id_alias (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  old_id        TEXT NOT NULL,
  new_id        TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('rename','move','merge')),
  PRIMARY KEY (snapshot_id, old_id)
);

-- Boundary detection results (Louvain / Leiden output, future).
CREATE TABLE boundary (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  algorithm     TEXT NOT NULL,                      -- 'louvain' | 'leiden'
  community_id  INTEGER NOT NULL,
  node_id       TEXT NOT NULL,
  modularity    REAL,
  PRIMARY KEY (snapshot_id, algorithm, node_id)
);

CREATE INDEX idx_boundary_community ON boundary (snapshot_id, algorithm, community_id);

-- Entry points: CLI commands, MCP tools, HTTP routes, exported APIs.
CREATE TABLE entry_point (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,                      -- 'cli-command' | 'mcp-tool' | 'http-route' | 'public-api' | 'event-handler'
  attrs         JSON NOT NULL DEFAULT '{}',         -- route, method, command name, etc.
  PRIMARY KEY (snapshot_id, node_id, kind)
);
```

### Decisions baked in

- **Wide-form metrics.** Adding a metric is `INSERT INTO metric VALUES (…)`. No schema migration.
- **JSON `attrs`.** Light-touch extensibility. Don't put query predicates in here without first promoting them to a column.
- **`id` is `TEXT`, not `INTEGER`.** Stable across snapshots and human-readable in logs. We can fold a content-addressable hash in if joins get slow at scale; not now.
- **No `chunks`, `embeddings`, or `fulltext`.** That's brain's job. Codewatch is structural.
- **`ON DELETE CASCADE`.** Pruning an old snapshot is one statement.

## Storage layout

- One SQLite file per repo at `.codewatch/graph.db`.
- WAL mode. `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL`.
- Default retention: keep the most recent 5 snapshots; user can override per-repo.
- Snapshot pruning is an explicit `codewatch graph prune` command, not automatic, to avoid silently losing baselines.

## Index versioning

`snapshot.index_version` is the semver of the indexer that wrote it. Diffs across major versions are an error; minor / patch are forward-compatible. Bumping the indexer's major version implies a `codewatch graph reindex` recommendation.

## Query catalog

The minimum set every downstream consumer needs. Each is a prepared statement; the `graph` package exposes them as a typed library API and as CLI subcommands.

| # | Name | Purpose | Consumer |
|---|------|---------|----------|
| 1 | `node-by-id(snapshot, id)` | basic lookup with all attrs and metrics | render, diff, MCP |
| 2 | `children(snapshot, parent_id)` | walk the module/symbol tree | render, MCP |
| 3 | `outgoing(snapshot, node_id, kinds?)` | edges leaving (with attrs) | render, diff, MCP |
| 4 | `incoming(snapshot, node_id, kinds?)` | edges entering (with attrs) | render, diff, MCP, "callers of X" |
| 5 | `subgraph(snapshot, root_id, depth, edge_kinds?)` | focus + N-hop context | render (the load-bearing query for the architecture map) |
| 6 | `path(snapshot, src, dst, edge_kinds?, max_hops?)` | does X reach Y? | check ("no upward deps"), plan-verify |
| 7 | `metrics-for(snapshot, node_id)` | all metrics on one node | render overlay, MCP |
| 8 | `top-by-metric(snapshot, name, limit, kind?)` | hotspot list | render hotspot view, debt report |
| 9 | `entry-points(snapshot, kind?)` | CLI/MCP/HTTP roots | render swimlanes, sequence diagrams |
| 10 | `boundaries(snapshot, algorithm)` | community labels per node | render coloring |
| 11 | `diff(snapshot_a, snapshot_b)` | added/removed nodes, added/removed edges, metric deltas with stable IDs and alias resolution | diff, plan-verify, render two-state |
| 12 | `rule-violations(snapshot, rule_set)` | for the check command, expressed in terms of the above queries | check |

Notes:

- Queries 1–8 are simple prepared statements with indexed lookups.
- Query 5 (`subgraph`) is BFS up to depth `N` over `edge` with `kind IN (…)` filter; capped at `max_nodes` (default 500) for renderer performance.
- Query 6 (`path`) is BFS with cycle detection; capped at `max_hops` (default 12).
- Query 11 (`diff`) is set-diff on `(node_id, kind)` and `(src_id, dst_id, kind)` with `id_alias` substitution applied first. Per `docs/research/14`, set-diff on stable IDs is enough — graph-edit-distance is overkill.

## Ingestion (sketch)

The indexer that fills these tables, in order of execution per snapshot:

1. **Discover files** via `core` ingest (already exists post-extraction).
2. **Parse** each file via tree-sitter (`core` parser).
3. **For TS:** ts-morph creates a `Project` from `tsconfig.json` and resolves imports. Per file, emit a `GraphFragment` of file/module/(later)symbol nodes + `imports`/`re-exports` edges.
4. **For Python:** tree-sitter import parsing + a small resolver against `sys.path` and the project's package layout. Same `GraphFragment` shape.
5. **Merge fragments** into the `node` and `edge` tables. Apply `id_alias` from `git diff -M`.
6. **Compute metrics** that are pure functions of the graph (`fan_in`, `fan_out`, instability, abstractness). Insert into `metric`.
7. **Compute file-level metrics** that need source content (LoC, cyclomatic, doc_coverage). Insert into `metric`.
8. **Detect entry points** via per-framework adapters (Commander, Express, Hono, MCP `server.tool()`). Insert into `entry_point`.
9. _(deferred to v1.1)_ **Run boundary detection** (Louvain) on the file/module dep graph. Insert into `boundary`.
10. _(deferred to v1.1)_ **Compute churn metrics** from `git log` (lines changed, authors, age).

## Tooling decisions

| Decision | Choice | Why |
|----------|--------|-----|
| TS extractor | **ts-morph** for v1, plan to ingest **scip-typescript** in v1.1 | ts-morph gives us file + module + import edges with the typechecker. scip-typescript is the right answer for symbol-level callgraph (per `docs/research/11`) but introduces a separate Rust-binary build step we don't want as the v1 entry cost. |
| Python extractor | tree-sitter-python + a small import resolver | We don't need Jedi/Pyright-level fidelity for v1; imports + module structure are enough. |
| SQLite driver | `better-sqlite3` | Synchronous, fast, unchanged from brain's stack. Works across Node 20+. |
| Migration approach | Hand-written `migrations/` files, run by the indexer at startup | Same pattern as brain. Tiny footprint. |
| Ingestion language | TypeScript | Same package, same dependencies, same testing rig as the rest of the monorepo. |

## Acceptance criteria (v1)

1. `codewatch graph index ./` on the brain repo produces a `.codewatch/graph.db` with: every TS file as a `file` node, every directory under `src/` as a `module` node, every external dependency as an `external` node, and `imports` edges resolving to internal or external nodes.
2. `codewatch graph index --ref main && codewatch graph index --ref HEAD` produces two snapshots that share IDs for unchanged files.
3. `codewatch graph diff main HEAD` returns sensible JSON output (added/removed nodes + edges + metric deltas) — visible regression in a real PR.
4. Query 5 (`subgraph`) for a chosen root node returns under 100ms on the brain repo (~250 files).
5. Re-indexing the brain repo from scratch finishes in under 30 seconds.

## v1.1 additions (deferred)

- scip-typescript ingestion → symbol-level call edges.
- Per-framework entry-point adapters beyond the obvious ones.
- Louvain boundary detection.
- Churn metrics from `git log`.
- The `entry_point` MCP-tool detector for brain itself, validating dogfood.

## Open questions

- **Should `package` be a node kind, or just a `parent_id` reference on modules?** Leaning yes-it's-a-node so external deps are first-class. Already in the schema; revisit if it's awkward.
- **Where do test files live in the graph?** Edge attribute `attrs.test = true` on `imports` edges from test files; nodes are the same kind. Avoids a second axis of node-kind.
- **What about generated code?** Skip in v1 (filtered out at ingest by `core/ingest/file-filter`). The `.codewatch/config.json` can opt files in later.
- **How much does ts-morph slow down on a big monorepo?** The brain repo is ~250 files; expect <10s. The user's voltras workspace might be larger; benchmark before committing to ts-morph for v1.

## Next concrete unit of work after this lands

1. Phase 1 of `core` extraction (types only).
2. Bootstrap `packages/graph` with the schema above (just the SQL + migration runner; no extractors yet).
3. Land a stub indexer that fills `snapshot` + `node` rows from `core/ingest` output.
4. Add the ts-morph import-edge extractor.

That's the minimum to have a single-snapshot dep graph in SQLite. Everything else (diff, render, check, plan-verify) layers on top.
