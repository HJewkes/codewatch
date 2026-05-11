# codewatch — platform vision

_Living document. Last edit: 2026-05-10._

## Thesis

A codebase is, at root, a graph: files/modules/symbols as nodes, imports/calls/refs as edges, with metrics, boundaries, and a history axis layered on top. **Codewatch's bet is that one canonical, deterministic, queryable model of this graph unlocks a portfolio of products** that are otherwise expensive to build separately.

We are not building any one of those products in isolation. We are building the substrate, then iterating consumers on top — each one shipping standalone value, each one further hardening the substrate.

The trap is treating every consumer as its own project. The discipline is the opposite: pick one consumer at a time, ship it end-to-end, and let it force the substrate to be solid before moving on.

## Where we are

- Tree-sitter extraction for TS + Python, language-neutral IR, SQLite persistence (CW-01, CW-02, CW-03).
- Package-level metrics (Martin's I/A, complexity, cohesion, doc coverage), boundary detection (Louvain/Leiden), smell detection (CW-04).
- CLI surface and module-doc / architecture-map output (CW-05).
- Plugin adapters for Knip, dependency-cruiser, radon, vulture (CW-06).
- A profile package that already emits ESLint/ruff/CLAUDE.md from the analysis — _the first consumer is partially shipped_.

The substrate is real but uneven. It needs stable IDs across snapshots, a snapshot history axis, and a queryable interface before the substrate-as-platform thesis can pay off. Those gaps are the biggest single lever right now.

## The substrate (what must be true)

Six properties have to hold before any consumer can be built cheaply:

1. **Deterministic indexing** — same input → same output. No LLM in the indexing path. Re-runnable in CI.
2. **Stable IDs** — a node in `main` and a node in `feature/foo` representing the same module must share an ID, so diffs work. Today we conflate path with identity; we will need a content/symbol-aware identity scheme that survives renames.
3. **Snapshot history** — at least two snapshots must coexist in the same DB or be cheap to compose. This is what makes diffs and trends possible.
4. **Pluggable metrics** — adding a metric should not require schema migration or surgery to existing extractors. A typed registry, or one wide JSON column with a known schema, both work; pick one.
5. **One queryable interface, three consumption modes** — CLI for humans, library import for code, MCP for agents. All three back to the same store.
6. **Plugin extension points** — extractors, metrics, and outputs all need ways to be added without touching the core. CW-06 is the right shape; it needs to be enforced as the only way to grow the system.

Until these are true, every consumer feature is paying interest on the substrate. Once they are true, consumers become weeks of work, not months.

## Consumer surfaces

The six surfaces the user named, plus one implicit, framed as products with audiences:

### 1. LLM context generation _(profile)_
**Audience:** agents working in this repo, and humans authoring CLAUDE.md / linter configs.
**Value:** agents follow the same conventions humans do, derived from the actual code, not aspirational rules nobody enforces.
**Status:** partially shipped via `packages/profile`. Exporters exist for ESLint, ruff, EditorConfig, claude-rules, markdown.
**Gap:** the profile is convention-only today. Wiring in architectural rules (boundary, fan-out caps, instability bounds) and codifying them in CLAUDE.md is the missing piece.

### 2. Architecture visualization for humans _(map)_
**Audience:** developers onboarding, leads doing refactor planning, reviewers.
**Value:** scannable picture of an unfamiliar codebase in seconds; "do I understand this?" answered visually rather than from a 30-page wiki page.
**Status:** module-level architecture-map output exists; it is markdown. Visual rendering is not built.
**Gap:** an interactive HTML renderer over the SQLite graph. Research note `docs/research/12` will recommend the stack; research `docs/research/10` and `docs/research/13` already concluded that a Sugiyama-layered dep graph + a hotspot treemap + an NDepend-style main-sequence plot are the three canonical canvases.

### 3. Architectural diff _(diff)_
**Audience:** PR reviewers, CI, and the human looking at "what did this branch actually change?"
**Value:** detects redundancy, dead modules, surprise edges, and complexity blooms before merge. Closes the gap between "the code review looked fine" and "the architecture got worse."
**Status:** not built. Requires snapshot history + stable IDs.
**Gap:** the largest unbuilt piece of substrate. Once snapshot diff works, it powers four downstream surfaces.

### 4. CI scoring / fitness functions _(check)_
**Audience:** CI, on every PR.
**Value:** prevents regressions in architectural properties: no upward dependencies, max complexity per file, boundary cohesion floor, no orphan modules, instability bounds.
**Status:** the metrics exist. The rule DSL and exit-code wiring do not.
**Gap:** a small rule format (YAML or TS literal) and an exit-code surface. Lowest-risk MVP after the substrate is solid.

### 5. Plan-as-marked-diff _(plan)_
**Audience:** planning agents producing change proposals; humans approving them.
**Value:** plans are expressed as a delta against the current architecture model — planned new nodes/edges, expected complexity envelope, expected boundary changes — instead of long markdown documents that nobody reviews carefully and that hide debt being added.
**Post-implementation:** the same delta format becomes the spec against which the actual diff is checked. Where the implementation diverged from the plan is then a generated artifact, not a manual review activity.
**Status:** not built. Highest leverage; highest novelty; highest risk.
**Gap:** a plan-as-data schema (probably layered on Structurizr DSL or a custom YAML), a renderer that overlays the plan on the current map, and a divergence checker that compares the post-merge snapshot against the plan.

### 6. Code + architecture indexing for retrieval _(query)_
**Audience:** agents needing surgical context for changes, humans answering "where does X get called from", "what touches Y".
**Value:** replaces grep-and-pray with graph queries: "smallest set of files I need to read to understand Z", "callers of this function across the repo", "everything that depends on this module".
**Status:** the graph supports it; the queries and MCP surface do not.
**Gap:** an MCP server exposing a small, opinionated set of graph queries. Tight tie-in to brain's existing MCP infrastructure.

### 7. Debt scoring / strategic reporting _(implicit)_
**Audience:** the author themself, or a team lead.
**Value:** monthly view of debt index, hotspot list, boundary health, instability drift. Roadmap input.
**Status:** the data is there; the rollup and presentation are not.
**Gap:** a `codewatch report` that emits a single-page summary per repo, optionally over time.

## MVP iteration plan

Eight ordered moves. Each is a working product on its own; each forces a specific substrate gap closed; each leaves the next one cheaper than it would have been alone.

### Move 0 — substrate hardening
**Status:** in flight, conceptually CW-01..CW-04 closeout.
**Ships:** stable cross-snapshot IDs, snapshot store, pluggable metric registry, one queryable interface (`codewatch query`).
**Why first:** without this, every later move pays substrate tax. With it, every later move is days, not weeks.
**Done when:** two snapshots of the same repo can be loaded and a node in one resolves cleanly to its counterpart in the other; adding a metric requires touching one file.

### Move 1 — `codewatch render` (architecture map)
**Ships:** static HTML bundle for one repo: dep graph (Sugiyama-laid out, community-colored), hotspot treemap (LoC × churn), main-sequence plot. Click a node → metrics panel + source link.
**Why second:** visible, motivating, demos in five seconds, forces graph + layout + metric overlay to all be solid.
**Forces solid:** node identity, metric API, output pipeline.
**Doesn't force:** snapshot history, plan format.
**Done when:** rendered map of the brain repo + codewatch + one third repo are useful at a glance to the user.

### Move 2 — `codewatch diff <ref-a> <ref-b>` (architectural diff)
**Ships:** CLI summary ("+12 files, -3 modules, complexity Δ +8%, boundary cohesion Δ −0.05"); HTML side-by-side or overlay rendering of two snapshots on the same layout.
**Why third:** leverages Move 1's renderer with two inputs; demonstrates the platform thesis. Stable IDs from Move 0 are the unlock.
**Forces solid:** snapshot persistence, stable IDs across commits, diff algorithm.
**Done when:** running it against a real PR catches an architectural regression that human review missed.

### Move 3 — `codewatch check` (CI fitness)
**Ships:** a small rule DSL (`max-complexity: 15 per file`, `no-upward-deps: domain → adapters`), exit-code surface, a GitHub Action example.
**Why fourth:** minimal new viz, immediate dev workflow value. Once `diff` exists, "rules over the diff" is a 200-line file.
**Forces solid:** rule API, error reporting, baseline tracking.
**Done when:** five fitness functions run in CI in <30s on the brain repo.

### Move 4 — `codewatch plan` (plan-as-marked-diff)
**Ships:** a plan format (YAML, ideally compatible with a subset of Structurizr DSL); a renderer that overlays the plan on the current architecture map; a `codewatch verify <plan> <after-snapshot>` that reports divergence.
**Why fifth:** highest leverage, highest risk. Building it on top of a working diff (Move 2) is much safer than building it standalone.
**Forces solid:** plan-as-data schema, plan-validation tooling, plan ↔ implementation reconciliation.
**Done when:** a plan written in this format can be rendered for human review, executed by an agent, and the divergence reported as a generated artifact — closing the loop the user described.

### Move 5 — profile polish (LLM context)
**Ships:** profile picks up architectural rules from `check`, emits them into CLAUDE.md and the linter config. The "things humans care about" and "things linters check" become the same set.
**Why sixth:** unblocks once `check` exists. Mostly an integration move.
**Done when:** an agent working in a codewatch-instrumented repo follows boundary and complexity rules without being told.

### Move 6 — `codewatch serve --mcp` (agent retrieval)
**Ships:** an MCP server exposing the graph as a small set of opinionated queries. Tight integration with brain's existing MCP server pattern.
**Why seventh:** depends on a stable substrate (Move 0) but is otherwise independent. Sequenced late because batch consumers (1–4) are higher value per unit effort.
**Done when:** an agent uses graph queries to scope a real change in a real repo, faster than naive grep, in a recorded session.

### Move 7 — `codewatch report` (debt rollup)
**Ships:** single-page summary per repo (debt index, top hotspots, boundary health, drift since last report), optionally as a recurring email/PR.
**Why last:** mostly a packaging move once everything else is in place.

## Anti-patterns to avoid

- **Treating consumers as separate codebases.** They MUST share the substrate. The day someone adds a "viz" package that doesn't read the canonical SQLite is the day this thesis fails.
- **Investing in new metrics before the graph is solid.** Metrics are infinite. Pick a small set, get them right, then add.
- **Building UI before headless works.** Every move ships a CLI / library API first; HTML is a renderer over those.
- **Going multi-language too early.** TS + Python is enough. Don't add Java, Go, Rust until the TS+Python loop is closed for two real consumers.
- **Tight coupling to brain's planning workflow before Move 4.** Loose coupling via files first; tight via MCP after Move 6. Brain is a consumer, not a co-dependency.
- **Letting research outpace ship cycles.** The research backlog (`docs/research/00-14`) is already large. Discipline: each Move closes a research thread; new research only when a Move is in flight.

## Open questions

- **Plan format:** custom YAML vs Structurizr DSL subset vs Mermaid + frontmatter. Decide at the start of Move 4, informed by `docs/research/14`.
- **Graph diff algorithm:** path-based set diff is enough for v1. Graph-edit-distance is overkill. Revisit if false positives become a problem.
- **Rule DSL surface:** TypeScript literal (typed, IDE-aware) vs YAML (portable, less typed). Lean TypeScript for v1 — the user is the only author and gets autocomplete.
- **Multi-repo:** out of scope until brain federation lands. Federation is a brain workstream, not a codewatch concern.
- **Live updates:** out of scope. Post-merge hook + on-demand CLI is enough. Anyone asking for an LSP-grade live picture is six moves too early.

## Connection to the brain ecosystem

- **VNM-13** (Architecture Knowledge in brain) is a mini-codewatch for self-indexing brain. Once Move 1 ships, that module gets retired and brain consumes codewatch instead.
- **VNM-50** (Tech Debt Workflow) is the brain-side wrapper around Move 7.
- **VNM-33** (Spec-Driven Development) is the brain-side wrapper around Move 4.
- **VNM-32 / VNM-36** (Agent-Native PM, MCP Integration) are the brain-side consumers of Move 6.

Codewatch becomes the engine; brain becomes the orchestrator and human-facing surface. Neither one needs to absorb the other.

## Definition of "done" for this vision

This document succeeds if it makes the following easy to answer at any moment:

- "What's the next thing we should ship?" — the lowest-numbered Move not yet done.
- "Is this idea in scope?" — yes if it sharpens an existing Move; no if it adds an unscheduled Move.
- "Are we still on the thesis?" — yes if every consumer reads from the canonical store.

If any of those gets harder to answer, the document is wrong and gets edited before the code does.

## Adjacent prior art (2026-05-10)

Four neighbouring projects worth studying. None of them does the full thesis, but each is the strongest reference for one consumer surface:

- **fallow** (`docs.fallow.tools`) — closest competitor. Dual layer: free static analysis (module graph, dead code, duplication, health/complexity) plus paid runtime intelligence; both merge in `fallow health`. CLI + VS Code Code Lens + **MCP** for agents. `fallow fix --dry-run` hints at planning/diff. **The piece they don't have:** plan-as-marked-diff and snapshot-vs-snapshot architectural diff. That's our wedge. (This is what the user originally called "Foundry" — name confusion.)
- **logicstamp-context** (`github.com/LogicStamp/logicstamp-context`) — best precedent for the **profile / agent retrieval** surfaces (Moves 5 + 6). TypeScript via ts-morph, extracts contracts (props, hooks, routes — not full implementations), emits per-folder `context.json` with `graph.nodes`/`graph.edges`, has `semanticHash`/`bundleHash` for diffability. The "agents need your interfaces, not your implementation" framing should anchor how codewatch shapes its retrieval API.
- **react-doctor** (`github.com/millionco/react-doctor`) — best precedent for the **check** surface (Move 3). 0–100 health score, CLI + GitHub Action + Node API, JSON output, framework-aware rule toggling, three-tier suppression config (global / file / file-rule). The tagline ("Your agent writes bad React, this catches it") is the exact framing for codewatch's CI surface.
- **matt pocock skills** (`github.com/mattpocock/skills`) — agent skills, not analysis tools. `improve-codebase-architecture` invokes Ousterhout's "deep modules, simple interfaces" — worth codifying as a codewatch metric (interface-width × implementation-depth ratio). `zoom-out` is the user-experience codewatch's `render` map should provide for free.

**Net:** the substrate codewatch is building is genuinely more general than any of these. Each adjacent project is an existence proof of one consumer surface; none combines them; none does plan-as-marked-diff or snapshot architectural diff. That gap is the strategic differentiator and should be invested in deliberately (Moves 2 and 4).

## References

Research informing this vision (all in `docs/research/`):

- `10-visual-architecture-best-practices.md` — five canonical views; Sugiyama-layered graph, hotspot treemap, plan-overlay diff, hexagonal lens, sequence-per-plan.
- `11-extraction-gaps-vs-codewatch.md` — five concrete extraction gaps and a punch list (scip-typescript for callgraph, entry-point adapter, Mermaid sequence walker, intent-overlay YAML, OTel/AppMap for traces). Notes that "Foundry" has no canonical OSS match in this space — closest semantic neighbours are **CocoIndex** and **LikeC4**.
- `12-interactive-html-viz.md` — recommended renderer stack: Cytoscape.js + ELKjs `layered` + static SSG; `sql.js-httpvfs` for large graphs; D2 for printable diagrams. Skip react-flow.
- `13-metric-overlays.md` — encoding spec for every codewatch metric, three default canvases (hotspot circle-pack, dep graph, main-sequence plot), explicit anti-patterns (rainbow palettes, 3D, redundant encodings without legend).
- `14-architectural-diff.md` — skip graph-edit-distance; set-diff on stable IDs is enough. OpenSpec's delta-spec format is the cleanest plan-as-data pattern. BIM "tolerance bands" worth borrowing for what counts as divergence.

Earlier research (`00-08`) covers the prior style/lint/profile landscape and remains the substrate for the **profile** consumer surface.
