# `packages/core` extraction plan

_Companion to `docs/audit-2026-05-10-substrate-readiness.md`. The substrate move from a single-purpose style profiler to a multi-mode platform._

## Goals

- Split shared infrastructure (file ingestion, tree-sitter parsing, pipeline orchestration, LLM provider) from style-specific logic into a new `packages/core`.
- Make `analyzer` (style mode) the first consumer; the future `graph` package is the second peer consumer.
- Keep existing CLI behaviour identical at every step; no user-visible regressions.
- Generalise `Extractor<T>` so per-file observation extractors and per-file graph extractors share the producer abstraction.

## Non-goals

- Re-architecting the style aggregator. It stays in `analyzer` — frequency-distribution math is style-specific.
- Re-architecting the profile schema, exporters, or checker package. They stay as-is.
- Adding the graph package in this plan. That's a separate doc; this is purely the substrate split.
- "Just in case" generality. We extract what graph mode actually needs, not what it might need.

## What moves to `core`

| From | LOC | Why |
|------|-----|-----|
| `analyzer/src/ingest/` (entire dir) | ~400 | Universal: file discovery, gitignore filter, hash cache, GitHub source. Graph mode needs identically. |
| `analyzer/src/extractors/parser.ts` | ~70 | Universal: tree-sitter parse, language detection, `ParsedFile` shape. |
| `analyzer/src/extractors/types.ts` (the `Extractor`, `ParsedFile`, `ObservationCategory` reduced to a generic) | ~40 | The interface is shared; the concrete category list moves back to analyzer. |
| `analyzer/src/enricher/` (entire dir) | ~450 | LLM provider abstraction (Claude Haiku, Ollama), prompt framework, enrichment orchestration. Graph mode needs this for module-role inference, edge classification. |

**Total reuse:** ~960 LOC.

## What stays in `analyzer`

| File / dir | LOC | Why |
|------------|-----|-----|
| `extractors/{naming,structure,control-flow,error-handling,formatting,idioms,documentation,review-voice,complexity}.ts` | ~2,300 | Style-specific extractors. They consume `core`. |
| `aggregator/` | ~400 | Frequency-distribution math + confidence/stability/severity scoring. Style-specific. |
| `extractors/types.ts` (the concrete `ObservationCategory` enum, `Observation` shape) | (split out) | Style-specific category list. |

`packages/profile` and `packages/checker` are unaffected.

## What stays in `cli`

The `cli` package keeps its commander shell. New graph subcommands will eventually be added (`graph index`, `graph render`, `graph diff`) but are out of scope for the extraction itself.

## New abstractions

### `Extractor<T>` generalised

Today (`analyzer/src/extractors/types.ts:38`):

```ts
export interface Extractor {
  name: string;
  extract(file: ParsedFile): Observation[];
}
```

In `core`:

```ts
export interface Extractor<T> {
  name: string;
  extract(file: ParsedFile): T[];
}
```

In `analyzer`:

```ts
import type { Extractor, ParsedFile } from "@code-style/core";
export type StyleObservation = { /* unchanged */ };
export interface StyleExtractor extends Extractor<StyleObservation> {}
```

In future `graph`:

```ts
import type { Extractor, ParsedFile } from "@code-style/core";
export type GraphFragment = { nodes: Node[]; edges: Edge[] };
export interface GraphExtractor extends Extractor<GraphFragment> {}
```

One generic, two concrete shapes.

### `Aggregator<I, O>` generalised (deferred — only if needed)

The `Aggregator` class is style-specific math. Keep it in `analyzer`. If/when graph mode wants a similar fold-per-file pattern (`graph fragments → normalised graph`), introduce a `core` interface only if the second use case actually needs to be swappable; otherwise inline it in `graph`.

### `LlmProvider` exposure

Currently in `analyzer/src/enricher/providers.ts` (~178 LOC). Move to `core/src/llm/`. The provider abstraction (`LlmProvider`, `LlmMessage`, `LlmResponse`, `createProvider`) is generic; the prompt content is enricher-specific.

Split: `core/src/llm/providers.ts` (provider implementations) vs `analyzer/src/enricher/prompts.ts` (style-specific prompt templates) vs `core/src/llm/prompt-builder.ts` (the templating + safety harness).

## File-by-file migration map

### Phase 1 — types only (1 PR, ~200 LOC moved, 0 behaviour change)

Create `packages/core` with package.json, tsup.config, vitest.config. Move TYPE-ONLY content:

```
analyzer/src/ingest/types.ts                         → core/src/ingest/types.ts
analyzer/src/extractors/types.ts (Extractor, ParsedFile only — split from ObservationCategory)
                                                      → core/src/extractors/types.ts (generic)
                                                      → analyzer/src/extractors/types.ts (style-only)
analyzer/src/enricher/index.ts (LlmProvider, LlmMessage, LlmResponse types only)
                                                      → core/src/llm/types.ts
```

Analyzer adds `@code-style/core: workspace:*` and re-imports the type names.

**Done when:** `pnpm typecheck` passes, all tests green, no runtime change.

### Phase 2 — ingest + parser (1 PR, ~470 LOC moved)

```
analyzer/src/ingest/cache.ts          → core/src/ingest/cache.ts
analyzer/src/ingest/file-filter.ts    → core/src/ingest/file-filter.ts
analyzer/src/ingest/github-service.ts → core/src/ingest/github-service.ts
analyzer/src/ingest/index.ts          → core/src/ingest/index.ts (barrel)
analyzer/src/extractors/parser.ts     → core/src/parser/parser.ts
analyzer/src/extractors/index.ts (parseFile, getSupportedLanguages exports)
                                       → core/src/parser/index.ts
```

`analyzer/src/index.ts` re-exports from `@code-style/core` to preserve its public surface. CLI imports unchanged.

**Done when:** all tests green; deleted analyzer paths leave no dangling imports.

### Phase 3 — enricher (1 PR, ~450 LOC moved)

Trickier because `prompts.ts` mixes provider abstraction with style-specific prompt content.

```
analyzer/src/enricher/providers.ts    → core/src/llm/providers.ts
analyzer/src/enricher/index.ts (createProvider, Enricher class shell)
                                       → core/src/llm/orchestrator.ts (rename Enricher to LlmRunner; analyzer wraps it)
analyzer/src/enricher/prompts.ts       stays in analyzer (style prompts)
analyzer/src/enricher/index.ts (Enricher specific to AI_ENRICHED_FEATURES, needsAiEnrichment, prompt selection)
                                       → analyzer/src/enricher/style-enricher.ts
```

The split criterion: anything that takes a string template and a model and returns a response → `core`. Anything that knows what features look like → `analyzer`.

**Done when:** the LLM tests in `analyzer/src/__tests__/enricher.test.ts` still pass against the new `LlmRunner` import path; new test in `core/src/__tests__/llm-runner.test.ts` covers the generic interface.

### Phase 4 — `Extractor<T>` generic (1 PR, ~50 LOC touched, no moves)

Promote the `Extractor` interface in `core` to `Extractor<T>`. Update `analyzer`'s extractor type to `StyleExtractor = Extractor<StyleObservation>`. The compiler is the test — every existing extractor either typechecks or doesn't.

**Done when:** `pnpm typecheck` clean; future `graph` package can declare `GraphExtractor extends Extractor<GraphFragment>` without touching `core` or `analyzer`.

## CLI surface during the migration

No new commands in this plan. All four phases preserve the existing `init` / `show` / `check` / `diff` / `compare` / `update` / `export` / `hook` commands and their flags.

After the extraction, the `graph` work adds new top-level subcommands (e.g. `codewatch graph index`, `codewatch graph render`, `codewatch graph diff`).

## Workspace + tooling

- `pnpm-workspace.yaml` — already includes `packages/*`; no change.
- `tsconfig.base.json` — verify path aliases match (`@code-style/*` resolution).
- Each new package needs its own `tsup.config.ts` and `vitest.config.ts` matching the existing pattern.
- ESLint config at the root applies to all packages; don't duplicate.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Circular dependency between core and analyzer during extraction | Medium | Each phase moves only items with no back-references to analyzer code. Phase 3 is the riskiest; the prompts/orchestrator split is what addresses it. |
| Test-fixture paths break | Low | All fixtures live in `analyzer/src/__tests__/fixtures/`; nothing moves there. |
| LLM tests against real providers slow CI | Low | They already mock providers (see `enricher.test.ts`); preserved. |
| Public API drift surprises consumers | Low | Only the user is a consumer today; no external dependents. Re-exports from `analyzer/src/index.ts` keep the public surface identical until the user opts in to importing `@code-style/core` directly. |

## Acceptance criteria for the whole extraction

1. `pnpm test` and `pnpm typecheck` and `pnpm lint` all green at the end of each phase.
2. The CLI does the same thing it did before (verified by re-running the integration tests in `tests/integration/`).
3. `packages/core` builds standalone (`pnpm --filter @code-style/core build`) — no analyzer dependency.
4. `analyzer` declares `@code-style/core` as a dependency; no source-level imports from outside `core` other than the existing peers (`@code-style/profile`).
5. The `Extractor<T>` interface is in `core` and the codepath for adding a future `graph` extractor type does not require touching `analyzer`.

## Next after this is done

Once Phase 4 lands, the substrate is ready. Next concrete piece of work: design and bootstrap `packages/graph`, starting from `docs/2026-05-10-graph-schema-design.md`.
