# Codewatch substrate audit — 2026-05-10

Read-only audit of `~/Documents/projects/code-style` against the six substrate properties from `docs/vision.md`.

## Headline finding

**The vision doc and the actual code describe different products.**

- `docs/vision.md` and the CW PM workstreams describe a **code-intelligence platform**: SQLite graph of nodes/edges/symbols, Martin-style package metrics, Louvain/Leiden boundary detection, snapshot diff, plan-as-marked-diff.
- The shipped code is a **statistical style-profile generator**: tree-sitter parse → per-file observations of style features (naming, structure, control-flow, error-handling, formatting, idioms, complexity) → frequency-distribution aggregator with confidence/stability scoring → `Profile` JSON → exporters for ESLint / ruff / EditorConfig / CLAUDE.md / markdown / a Claude skill.

There is no SQLite, no graph schema, no symbol references, no scip-typescript, no boundary detection, no snapshot history. `grep` for `sqlite|graph.nodes|scip|tree-sitter-graph|stable.id|snapshot` in `packages/**/*.ts` returns zero hits. The dependencies are `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-python`, `@jscpd/core`, `octokit`, `zod`, `handlebars`, `commander`, `inquirer`, `chalk` — exactly a style-profiler stack.

What's there is well-built. ~7,000 LOC across four packages, extensive test fixtures, deterministic tree-sitter pipeline, statistically grounded aggregator (consistency × stability → confidence → severity), a working CLI (`init`/`show`/`check`/`diff`/`compare`/`update`/`export`/`hook`), and a profile-vs-code deviation pipeline. This is the "profile" consumer surface from the vision doc — already shipped at production quality.

What's not there is the substrate the other six consumer surfaces depend on.

## Substrate properties — current state

| # | Property | State | Notes |
|---|----------|-------|-------|
| 1 | Deterministic indexing | **Partial (style only)** | Tree-sitter parse + per-file observations is deterministic. `FileCache` (`ingest/cache.ts`, 50 LOC) hashes content for incremental work. But the output is a flat `Observation[]` list, not a node/edge graph. Nothing is indexed at module/symbol level. |
| 2 | Stable cross-snapshot IDs | **Missing** | No node concept exists. Identity is implicit per-file, per-line, per-feature-type. Nothing is designed to survive a rename or a refactor. |
| 3 | Snapshot history | **Missing** | The pipeline runs, emits a `Profile`, exports configs, exits. No archive of prior runs. `compare` compares two profile JSONs in memory; it doesn't store them as snapshots in a queryable way. |
| 4 | Pluggable metrics | **Partial (style observations only)** | `Extractor` interface (`extractors/types.ts:38`) is clean. Adding a new style observation is one new extractor + one wire-up in `extractors/index.ts`. Adding a non-style metric (complexity per package, fan-in, instability) requires inventing a new layer — observations are file-line-typed, not module-typed. |
| 5 | Queryable interface | **Missing for graph queries** | Excellent CLI for the style use case. No graph queries. No library API for "callers of X" or "modules that depend on Y". No MCP server. |
| 6 | Plugin extension points | **Partial** | Extractors and exporters are loosely pluggable but require touching repo-internal index files. No documented plugin manifest, no third-party plugin contract. CW-06 in PM is at design stage; the code has not been touched. |

## What this means for the vision's MVP sequence

The vision's Move 0 (substrate hardening) was framed as "harden what's there". The honest framing is **build new substrate alongside the existing style profiler**. The existing profiler doesn't need substrate work — it works. The architecture-graph platform doesn't have substrate yet.

Concretely, the work to enable Move 1 (architecture map render) from current state:

1. **A new package** (`packages/graph` or similar) housing the node/edge/symbol model, deterministic ID scheme, and storage. Estimate: 1500–2500 LOC.
2. **A graph extractor** — minimum viable: ts-morph or scip-typescript driving file/module nodes and import/re-export edges. Symbol-level callgraph deferrable. Estimate: 600–1200 LOC.
3. **A snapshot store** — SQLite with `(snapshot_id, node_id, kind, attrs)` and `(snapshot_id, src, dst, kind, attrs)` tables. Two snapshots coexist. Estimate: 300–500 LOC plus schema migrations.
4. **A small query API** — the 5–8 graph queries the renderer + diff need. Library + CLI. Estimate: 200–400 LOC.
5. **The renderer itself** (Cytoscape + ELKjs static SSG, per `docs/research/12`). Estimate: 400–800 LOC.

That's roughly **3,000–5,400 LOC of net-new code** before Move 1 is shippable. Aggressively scoped, achievable in 2–3 focused weeks. Ambitious but not absurd.

## The strategic decision

Three viable paths. The user picks.

### A. Pivot codewatch via core extraction _(recommended; revised 2026-05-10)_
Extract `packages/core` for shared infrastructure: ingest, tree-sitter parser, pipeline orchestration, generic `Extractor<T>` interface, LLM provider/prompt framework. Existing `analyzer` + `profile` + `checker` become the first consumer ("style mode"). New `packages/graph` + `render` + `diff` are peer consumers ("graph mode"). One repo, one CLI surface, shared core.
- **Pros:** real reuse — ~550 LOC of ingestion + parsing + pipeline directly reusable; another ~750 LOC of patterns (Extractor, Aggregator, CLI shell) reusable with minor evolution; LLM enrichment framework shared (graph mode gets module-role inference, edge classification for free); single CLI surface; no parallel tree-sitter pipelines.
- **Cons:** requires careful refactor of existing analyzer to depend on core; brief period of internal API churn during extraction.
- **Net-new LOC for Move 1:** ~1,800–3,200 (graph package + extractors + snapshot store + query API + renderer), down from ~3,000–5,400 if built in isolation.

### B. Two projects, shared author
Codewatch stays focused on style profiles (it's almost done; ship what's there). A new project — **codegraph** or similar — owns the architecture-graph substrate and the consumer surfaces 1–4 + 6 from the vision. The two projects can integrate later (the profile generator could consume the graph for richer rule context), but they ship and evolve independently.
- **Pros:** each project has a sharp, defensible identity; no scope creep; faster to ship Move 1.
- **Cons:** two repos to maintain; some duplicated infrastructure (tree-sitter setup, file ingestion, CLI patterns); cross-project coordination overhead.

### C. Build graph substrate inside brain instead
The brain repo already has a `codebase` module (`src/modules/codebase`, ~400 LOC) that scans TS exports, generates architecture notes, has a post-merge hook. Extend that into the graph substrate. Codewatch stays a style profiler.
- **Pros:** brain already has SQLite, MCP server, CLI, modules, hook system, embedder, search. The substrate plumbing is half-done; just add a graph schema and a renderer.
- **Cons:** brain becomes more sprawling; the graph substrate is then coupled to brain-specific infra; harder to use the graph platform standalone without bringing brain along.

## My recommendation _(revised 2026-05-10)_

**A done architecturally** — extract `packages/core`, then add graph mode as a peer consumer.

The initial audit underestimated reuse. Concretely shared:
- `packages/analyzer/src/ingest/` (~400 LOC) — file discovery, gitignore-aware filter, hash cache, GitHub source.
- `packages/analyzer/src/extractors/parser.ts` (~70 LOC) — tree-sitter setup, `ParsedFile`, language detection.
- `packages/analyzer/src/enricher/` (~450 LOC) — LLM provider/prompt framework. Graph mode reuses this for module-role inference, edge classification, the deterministic+LLM dual pass.
- `packages/cli/src/utils/pipeline.ts` (~46 LOC) — orchestration shape (discover → parse → extract → aggregate → emit) is identical for graph mode.
- Patterns: `Extractor<T>` generic, `Aggregator` shape, commander CLI shell.

Building graph mode in a separate project would mean re-doing all of that. The core-extraction approach gets the technical benefits of one platform without the dilution risk of bolting graph onto analyzer.

**The shape:** codewatch is the platform; style and graph are two analysis modes that share an indexing core; profile and graph-render/diff/check/plan-verify are output families that consume one mode each. The vision's 7-move sequence stays as written; the existing `analyzer` + `profile` + `checker` packages map onto Move 5 (LLM context).

```
                         [tree-sitter + ingest + LLM provider]   ← packages/core
                                  /                       \
                     [style extractors]              [graph extractors]   ← analyzer / graph
                            |                                |
                  [frequency aggregator]            [graph normalizer]
                            |                                |
                    [Profile JSON]                  [SQLite snapshot]
                            |                                |
              [profile / checker exporters]    [render / diff / check / plan-verify / MCP]
```

## Punch list (path A — core extraction)

1. **Extract `packages/core`** in three phases — see `docs/2026-05-10-core-extraction-plan.md`. Types-only → ingest + parser → enricher. Each phase ships independently; the existing CLI keeps working throughout.
2. **Generalize `Extractor<T>`** so style observations and graph fragments share a producer abstraction.
3. **Design the graph schema** — node/edge/symbol/metric tables, stable IDs, snapshot history. See `docs/2026-05-10-graph-schema-design.md`.
4. **Add `packages/graph`** with the schema, a ts-morph extractor (file + module nodes + import edges first; symbol-level callgraph deferrable), and a small query API.
5. **Add `packages/render`** — Cytoscape + ELKjs static SSG over a graph snapshot. Per `docs/research/12`.
6. **First milestone:** `codewatch graph index ./ && codewatch graph render --out report.html` produces an interactive HTML map of the brain repo.

## CW PM workstream realignment

- **CW-01** (Project Scaffold & Core IR) → repurpose as the core-extraction work + graph schema.
- **CW-02** (Extraction Layer) → split: existing style extractors are done; add a CW-02b for graph extractors.
- **CW-03** (Graph & Storage) → matches Move 0/1 directly.
- **CW-04** (Analysis Engine) → boundary detection, complexity-per-package metrics; downstream of CW-03.
- **CW-05** (CLI & Output) → matches Move 1/2/3 (render/diff/check) directly.
- **CW-06** (Plugin System) → defer until at least one external plugin author is asking; substrate first.
