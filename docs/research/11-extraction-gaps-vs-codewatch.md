# Extraction Gaps vs. codewatch

**Date**: 2026-05-10
**Purpose**: Identify the deterministic extraction layers still missing from codewatch's analyzer to drive architecture, call-flow, and sequence diagrams — and to support overlay of "planned change" descriptions on top of an existing project's structure.

## What codewatch already produces

- Tree-sitter AST extraction for TypeScript and Python (`packages/analyzer/src/extractors/`)
- Inventory + Martin instability/abstractness, doc coverage, naming/idiom/error-handling extractors
- Dependency graph with symbol references (nodes, edges, closure tables) in SQLite
- Boundary detection via Louvain/Leiden community detection
- Code smells, depth scoring
- Plugin adapters for Knip, dependency-cruiser, radon, vulture

That gives codewatch a strong **module/package/import graph**. What's missing for diagram generation is the **dynamic-shaped artifacts**: call edges within and across modules, runtime entry points, request/response flows, and an annotation surface for "expected change."

## Gap 1 — Static call graph (function/method-level)

codewatch has *symbol references* but not *call edges between functions*. Every diagram beyond a package/module map (call flow, sequence, hot-path overlay) needs that.

**State of the art for TS:**
- **Jelly** (cs-au-dk) is the strongest static call-graph tool for JS/TS; field-based with approximate interpretation, indirection bounding, dynamic-cg comparison via NodeProf for recall measurement. Handles cross-package edges (entry-file traversal walks dependencies unless `--ignore-dependencies`). Outputs JSON + HTML. Active research project, MIT-licensed. ([cs-au-dk/jelly](https://github.com/cs-au-dk/jelly))
- **scip-typescript** (Sourcegraph) emits SCIP indexes built on the TypeScript typechecker — symbol-precise, robust on real-world monorepos, ~4x smaller than LSIF. SCIP is now the de-facto interchange format for TS code intelligence. ([SCIP overview](https://sourcegraph.com/blog/announcing-scip), [sourcegraph/scip](https://github.com/sourcegraph/scip))
- **stack-graphs** (GitHub) — name resolution language built on tree-sitter; per-file isolated subgraphs, cross-file/cross-repo path-finding. TS rules already exist. Excellent fit for codewatch's tree-sitter pipeline because it composes incrementally. ([Introducing stack graphs](https://github.blog/open-source/introducing-stack-graphs/), [stack-graphs TS](https://github.com/github/stack-graphs/tree/main/languages/tree-sitter-stack-graphs-typescript))
- **CodeQL** has a `CallGraph.qll` library — high-quality, but heavyweight DB build and license restrictions for non-OSS use. ([CodeQL CallGraph](https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/explore/CallGraph.qll/module.CallGraph.html))
- Lighter options: `Persper/js-callgraph` (field-based, JS-focused), `whyboris/TypeScript-Call-Graph` (per-file, no cross-module). Both useful as references; neither is production-grade for monorepos.

**Recommendation:** **buy** (integrate). Run **scip-typescript** as the canonical symbol+ref index, and ingest the resulting `index.scip` protobuf into codewatch's existing nodes/edges tables — it directly gives you definitions, references, and the relationships needed for caller/callee edges. Add **Jelly** as an optional deeper pass for callgraph precision when the user wants flow diagrams (it understands higher-order functions better than the typechecker alone). Build a thin protobuf reader + `cg_edges` table; do not reimplement either tool.

## Gap 2 — Entry-point & API/CLI/MCP surface extraction

A callgraph without entry points is a blob. The diagrams the user wants ("how a request flows through the system") require knowing **where the system is entered**.

Three concrete surfaces, three patterns:

- **HTTP routes (Express / Hono / Fastify):** schema-first frameworks already produce machine-readable route tables. `hono-openapi`, `@hono/zod-openapi`, and Cloudflare's **chanfana** all emit OpenAPI from declared routes; ts-rest and `openapi-typescript` round-trip OpenAPI ↔ TS. ([hono-openapi](https://github.com/rhinobase/hono-openapi), [chanfana](https://github.com/cloudflare/chanfana), [ts-rest OpenAPI](https://ts-rest.com/docs/open-api)). For codebases that *don't* use those, `bonukai/typescript-routes-to-openapi` does pure static extraction from TS source. ([typescript-routes-to-openapi](https://github.com/bonukai/typescript-routes-to-openapi))
- **CLI commands (Commander / yargs):** no off-the-shelf extractor — the pattern is a tree-sitter query over `.command()` / `.option()` chains. Trivial to add as a codewatch extractor (~one weekend of query work).
- **MCP tool registrations:** `McpServer.registerTool(name, schema, handler)` is a syntactic call shape. The community `trace.mcp` and `CaptainCrouton89/static-analysis` tools already prove this is extractable from a single TS file with ts-morph or tree-sitter. ([modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), [trace MCP](https://glama.ai/mcp/servers/@Mnehmos/mnehmos.trace.mcp))

**Generic pattern:** an *entry-point manifest* table — `{kind: 'http' | 'cli' | 'mcp' | 'cron' | 'lambda', name, file, symbol_id, schema?}` — populated by per-framework adapters that share one tree-sitter-query interface. Each adapter is small (Express, Hono, Commander, McpServer, AWS handler).

**Recommendation:** **build** the manifest schema and adapters (deterministic, fast, codewatch already has tree-sitter infra). **Buy** OpenAPI-emission paths by piping into the framework's own schema generator when present — don't reimplement validation.

## Gap 3 — Sequence/flow diagrams from a callgraph

Once you have entry points + a callgraph + a typed router, sequence diagrams are mostly a rendering problem.

- **code2flow** generates call-graph-shaped flowcharts (Python/JS/Ruby/PHP) — fine for prototypes, but it's an *approximation* tool, not a precision one. ([scottrogowski/code2flow](https://github.com/scottrogowski/code2flow))
- **pycallgraph2** — runtime-only, Python-only.
- **mermaid sequence diagrams** + **PlantUML** are the *targets*, not generators. They take a model in.
- The deterministic recipe: pick an entry point → BFS the callgraph N hops → emit Mermaid `sequenceDiagram` with one participant per module/boundary and one message per cross-boundary call. Boundaries are already known to codewatch (Louvain communities).

**Recommendation:** **build**. This is ~300 LOC of graph-walk + Mermaid emit on top of Gap 1's edges. Don't take a tool dependency — the rendering is too project-specific (the user wants planned-change overlays).

## Gap 4 — Runtime trace integration (optional but high-leverage)

Static calls miss dynamic dispatch, plugin systems, async chains, and the actual hot path. Pairing static with runtime traces is the standard fix.

- **OpenTelemetry + OpenInference** is now the canonical span format — OpenInference adds AI-specific semantics (LLM, tool, retrieval spans) on top of OTel. Phoenix renders agent traces as execution trees out of the box. ([OpenInference](https://github.com/Arize-ai/openinference), [spec](https://arize-ai.github.io/openinference/spec/))
- **AppMap** is the closest off-the-shelf product: instruments Node.js (JS+TS) at runtime, captures HTTP requests, emits sequence diagrams + OpenAPI from observed behavior. CLI emits PlantUML. Open-source, MIT-style. ([AppMap Node.js](https://appmap.io/docs/reference/appmap-node.html), [AppMap sequence diagrams](https://appmap.io/blog/2022/11/29/automagically-generate-sequence-diagrams-of-your-codes-runtime-behavior/))
- **Pyroscope / async_hooks** give you frequency-weighted call trees but not message sequences — useful as a *weighting* layer on top of the static graph (thicker edges for hot calls).
- Jaeger auto-builds service maps from traces; Mermaid can ingest raw trace logs and produce sequence diagrams.

**Recommendation:** **buy** OpenTelemetry/OpenInference as the input format and **build** an importer that joins span trees to the static callgraph by source-location attribute. Ship AppMap as the recommended runtime recorder for users who want generated sequence diagrams without rolling their own tracer. Treat this as an **optional enrichment tier** — codewatch stays fully deterministic by default.

## Gap 5 — Pseudocode/intent overlay for "planned change"

The user wants to describe *future* changes against the *current* graph. The right primitive is a separate annotation file that references symbol IDs from codewatch's index.

- **Structurizr DSL** (and the open-source **LikeC4**) are the relevant prior art — text-based architecture DSL, multiple views from one model, version-controllable. LikeC4 is TS-native and ships a React renderer. ([Structurizr DSL](https://docs.structurizr.com/dsl), [LikeC4](https://likec4.dev/))
- **ADRs** are a complementary surface for the *why* — `adr/e-adr` showed that `@ADR(N)` annotations in code can be statically extracted and joined with a markdown corpus. ([e-adr](https://github.com/adr/e-adr))
- **arc42** organizes ADRs + C4 diagrams into a documentation skeleton. ([arc42 + C4 example](https://github.com/bitsmuggler/arc42-c4-software-architecture-documentation-example))

**Recommendation:** **build** a tiny "intent layer" on top of codewatch's symbol IDs: a YAML/MDX file format like `{change_id, status: planned|in-progress|done, affects: [symbolId...], pseudocode: "..."}`. At render time, overlay onto Mermaid/LikeC4 views with a different node style. Don't adopt Structurizr DSL wholesale — it's heavy and doesn't reference symbol-level identity. Consider **emitting** LikeC4 as one of the output formats since its model is close.

## Foundry investigation

There is no widely-used OSS tool literally named "Foundry" in the codebase-visualization space. The closest interpretations:

- **Palantir Foundry** — closed-source enterprise data platform; its "code scanning" piece is just Jemma CI doing standard SAST. Not relevant. ([Palantir Foundry code scanning](https://www.palantir.com/docs/foundry/security/code-scanning-overview))
- **foundry-rs** (Solidity tooling) — irrelevant to TS/Python.
- **Microsoft Foundry** (Azure AI) — also unrelated.
- **CocoIndex** is the closest semantic match to what the user might mean: Rust + tree-sitter, incremental, "live context for agents," semantic codebase indexing. Not a diagram tool, but a strong reference for an incremental tree-sitter-based index. ([cocoindex/cocoindex-code](https://github.com/cocoindex-io/cocoindex-code))
- Comparable visualization tools worth a look: **CodeCharta** (3D city map, codemetric overlays) and **swark** (LLM-driven diagram generation from code). ([CodeCharta](https://codecharta.com/), [swark](https://github.com/swark-io/swark))

Most likely the user was thinking of either CocoIndex (incremental tree-sitter index) or LikeC4/Structurizr (architecture DSL). Both are referenced in this report.

## Punch list — highest-leverage extraction additions

Ordered by ratio of (diagram quality unlocked) ÷ (build cost):

1. **Adopt scip-typescript and ingest its protobuf into codewatch's edge tables.** Single biggest unlock — gives precise TS symbol/ref edges for free, future-proof format, no maintenance burden. Add a Python equivalent via `scip-python` later. ([scip-typescript via SCIP](https://github.com/sourcegraph/scip))
2. **Build a generic entry-point extractor with per-framework adapters** (Express, Hono, Commander, McpServer to start). Single `entry_points` table; tree-sitter queries already fit codewatch's pipeline.
3. **Add a callgraph-walker → Mermaid sequence-diagram renderer.** Takes `(entry_point_id, depth)` → Mermaid. Uses Louvain communities for swimlanes. ~300 LOC.
4. **Define an "intent overlay" YAML/MDX format keyed on codewatch symbol IDs.** Lets users describe planned changes that render on top of generated diagrams without polluting source.
5. **Optional: OpenTelemetry/OpenInference span importer** that joins runtime traces to static edges by source location, weighting the graph for hot-path overlays. Ship AppMap as the recommended recorder for users who don't already emit OTel.

Defer Jelly until the precision of scip-typescript proves insufficient for higher-order/dispatch-heavy code; defer LikeC4 emission until the intent overlay schema settles.

## Sources

- [cs-au-dk/jelly](https://github.com/cs-au-dk/jelly)
- [Jelly README](https://github.com/cs-au-dk/jelly/blob/master/README.md)
- [SCIP — sourcegraph blog](https://sourcegraph.com/blog/announcing-scip)
- [sourcegraph/scip](https://github.com/sourcegraph/scip)
- [Introducing stack graphs](https://github.blog/open-source/introducing-stack-graphs/)
- [stack-graphs TypeScript](https://github.com/github/stack-graphs/tree/main/languages/tree-sitter-stack-graphs-typescript)
- [tree-sitter/tree-sitter-graph](https://github.com/tree-sitter/tree-sitter-graph)
- [CodeQL CallGraph.qll](https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/explore/CallGraph.qll/module.CallGraph.html)
- [Persper/js-callgraph](https://github.com/Persper/js-callgraph)
- [whyboris/TypeScript-Call-Graph](https://github.com/whyboris/TypeScript-Call-Graph)
- [hono-openapi](https://github.com/rhinobase/hono-openapi)
- [@hono/zod-openapi](https://hono.dev/examples/zod-openapi)
- [chanfana](https://github.com/cloudflare/chanfana)
- [ts-rest OpenAPI](https://ts-rest.com/docs/open-api)
- [openapi-typescript](https://openapi-ts.dev/)
- [bonukai/typescript-routes-to-openapi](https://github.com/bonukai/typescript-routes-to-openapi)
- [modelcontextprotocol/typescript-sdk — Tool registration](https://deepwiki.com/modelcontextprotocol/typescript-sdk/3.2-tool-registration-and-execution)
- [trace MCP server](https://glama.ai/mcp/servers/@Mnehmos/mnehmos.trace.mcp)
- [scottrogowski/code2flow](https://github.com/scottrogowski/code2flow)
- [pycallgraph2](https://pypi.org/project/pycallgraph2/)
- [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid)
- [OpenInference spec](https://arize-ai.github.io/openinference/spec/)
- [Arize-ai/openinference](https://github.com/Arize-ai/openinference)
- [OpenTelemetry → Jaeger](https://opentelemetry.io/docs/languages/dotnet/traces/jaeger/)
- [Grafana Pyroscope](https://github.com/grafana/pyroscope)
- [Node.js async_hooks](https://nodejs.org/api/async_hooks.html)
- [AppMap Node.js agent](https://appmap.io/docs/reference/appmap-node.html)
- [AppMap sequence diagrams](https://appmap.io/blog/2022/11/29/automagically-generate-sequence-diagrams-of-your-codes-runtime-behavior/)
- [Structurizr DSL](https://docs.structurizr.com/dsl)
- [LikeC4](https://likec4.dev/)
- [likec4/likec4](https://github.com/likec4/likec4)
- [arc42 + C4 example](https://github.com/bitsmuggler/arc42-c4-software-architecture-documentation-example)
- [adr/e-adr (annotated ADRs)](https://github.com/adr/e-adr)
- [Palantir Foundry code scanning](https://www.palantir.com/docs/foundry/security/code-scanning-overview)
- [cocoindex/cocoindex-code](https://github.com/cocoindex-io/cocoindex-code)
- [CodeCharta](https://codecharta.com/)
- [swark-io/swark](https://github.com/swark-io/swark)
