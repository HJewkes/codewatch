# Architectural Diff: Plan-vs-Actual for Codewatch Snapshots

**Date**: 2026-05-10
**Purpose**: Survey patterns for diffing two architecture snapshots, expressing intended changes as a marked-up "future" architecture, and reporting drift between plan and implementation. Recommends an end-to-end workflow that fits codewatch's SQLite snapshot model and brain's planning workflow.

## 1. Architectural diff tools — how they express expected vs actual

The mature tools split cleanly into two camps: **rule-based** (assert relationships, fail the build) and **model-based** (declare a model, diff against extracted reality).

- **dependency-cruiser** is the practical baseline for JS/TS. You write rules in `.dependency-cruiser.cjs` (e.g. `from: 'src/ui'` → `to: 'src/db'` → `severity: error`). It also has a `--baseline` mode that snapshots known violations so the build only fails on *new* deviations — a poor man's diff. It exports DOT/Mermaid but does not natively diff two graphs.
- **ts-arch** and **ArchUnitTS** mirror Java's ArchUnit: fluent assertions like `filesShouldNot().dependOnFiles({inFolder: 'db'})`. Run inside Jest/Vitest. Their "spec" is TypeScript code, not a separate model.
- **Structurizr DSL + Structurizr CLI** invert the model: you author the *intended* C4 model in DSL; tools render it. Drift detection is bolted on by **Erode** (`erode.dev`) and **LikeC4**, which extract dependencies from code, compare to the declared model, and surface delta as PR comments. Erode is the closest commercial example to the workflow you want — it pipes a code diff plus the architecture model through an LLM and emits "this PR added an undeclared edge from `payments → notifications`."
- **jQAssistant** ingests the codebase into Neo4j and runs Cypher *constraints* and *concepts*. Concepts enrich the graph (label classes that match a naming convention); constraints fail the build. Powerful, but the "diff" is "constraint passed yesterday, fails today" — it is not a visual snapshot delta.
- **NDepend** (.NET) is the only commercial tool with first-class **Code Diff since Baseline**: every metric (complexity, coupling, lines, rule violations) is shown as an absolute value plus delta against a stored baseline build, with red/green markers in the UI. This is the closest precedent for what codewatch can offer.
- **CodeScene** doesn't diff snapshots in the codewatch sense, but its *Architectural Analyses* over time series (change coupling trend, hotspot growth) is the gold-standard for showing evolution rather than instant deltas.

Key lesson: tools that diff a *declared* model against extracted reality (Erode, jQAssistant, NDepend with custom rules) are more useful than tools that just diff two extractions, because the model encodes intent.

## 2. Graph diff algorithms — what people actually use

The academic literature on **graph edit distance** (GED) is rich but mostly irrelevant to code-viz. GED is APX-hard; NetworkX's `optimize_graph_edit_distance` is a usable approximation but takes seconds to minutes on small graphs. Maximum common subgraph is similarly NP-hard. Neural approaches (GNOME, GIN-based embeddings) exist but are research-grade.

What real code-viz tools do is simpler and faster:

- **Set-diff on stable IDs**. If your nodes have stable identities (file path, fully-qualified module name, AST hash), node added/removed/modified is a SQL `LEFT JOIN`/`EXCEPT`. Edge diff is the same on `(source_id, target_id, kind)`. Codewatch already gives you stable IDs by virtue of file path being the natural primary key.
- **Per-attribute delta**: for "modified" nodes, diff the metric vector (cyclomatic, fan-in, fan-out, LOC) and flag deltas above a threshold. NDepend's UI is essentially this on every metric column.
- **Layout-stable rendering**: keep the same node positions across before/after so the human eye perceives structure changes, not layout churn. Eclipse Sirius, Graphviz with `-Kfdp` plus position attributes, and the *Evostreet* code-city research all rely on layout stability.

Verdict: skip GED. Use set-diff on `(file_id, kind)` for nodes, `(src, dst, kind)` for edges, and per-metric numeric delta for "modified" annotations. This is O(n) and gives a result every reviewer can read.

## 3. Visual diff patterns

Specific conventions seen across tools:

- **Color coding**: green = added, red = removed, amber/yellow = modified is universal (NDepend, Erode UI, GitHub's tree diff, BIM deviation analysis using rainbow heatmaps). Don't reinvent; use it.
- **Edge stylings**: solid = existing, dashed = planned/added, dotted = deprecated/to-be-removed. Graphviz `style=dashed` and Mermaid `-.->` both support this. Structurizr DSL allows tags + style overrides.
- **Side-by-side same-layout** beats overlay for large changes. CodeCity's *Evostreet* research showed users find evolutions easier to read when the city's layout is stable across versions and only buildings (files) change height/color. IntelliJ's diagram diff and VS code-maps both do this.
- **Risk markers**: NDepend shows a red dot on any module whose complexity grew >X% since baseline. CodeScene flags hotspots with a red corona. Useful for codewatch: emit a per-file *risk delta* alongside the structural delta.
- **Animated transitions** are nice-to-have (Structurizr's web viewer, LikeC4) but rarely worth the engineering. A static side-by-side with a "show me only deltas" toggle covers 95% of the use case.

## 4. Plan-as-data formats

The candidates, ranked for codewatch's needs:

1. **DSL with delta/tag annotations** — the OpenSpec model. OpenSpec ships changes as *delta specs* whose sections are explicitly marked `ADDED`, `MODIFIED`, or `REMOVED` against the living spec. This maps directly onto a codewatch snapshot: the plan is a small file that says "add node `src/payments/refund.ts`, add edge `refund.ts -> stripe-client.ts`, modify `cart.ts.complexity` from 12 to 18 (target)." The plan can be parsed deterministically.
2. **Structurizr / LikeC4 DSL with tags** — declare planned elements with a `planned` tag and have a style block that paints them green/dashed. Erode and LikeC4 already use tag-based styling for "future" elements. Verbose, but readable and humans can author it.
3. **Mermaid with `classDef`** — works for screenshot-and-paste plans in markdown. `classDef added fill:#90EE90` plus `class refundTs added` is enough. Cheap, but the syntax is awkward to author and impossible to validate against reality.
4. **ADR + GitHub spec-kit / Kiro spec** — captures *why* but not the structural delta. Pair with one of the above for the "what."
5. **BPMN / arch42** — too heavy. Skip.

Recommendation: **a small JSON/YAML schema layered on top of the codewatch snapshot**, of the form `{ add: { nodes: [...], edges: [...] }, modify: { nodes: [{id, target_metrics}] }, remove: { nodes: [...], edges: [...] } }`. This is OpenSpec's delta-spec idea applied to graphs. An LLM can produce it; a tool can render it as a Mermaid/Graphviz overlay; and the diff after implementation is trivial because the plan and the post-snapshot diff have the same shape.

## 5. Plan-vs-actual divergence frameworks

- **Fitness functions** (Ford/Parsons/Kua, *Building Evolutionary Architectures*): assertions that run in CI and fail when an architectural property regresses. Treat each plan-delta entry as a one-shot fitness function: "this PR must add the planned edge, must not add unplanned edges." This is a concrete, testable contract.
- **Specification-by-example / BDD**: Cucumber-style. Less helpful for graph deltas but useful for the *why* layer.
- **BIM as-built vs as-designed** in construction: laser-scan the building, register against the design model, render a heatmap of deviations greater than tolerance. Direct analog: codewatch's post-snapshot is the "laser scan," the plan-delta is the "design model," and the divergence report is the heatmap. The construction industry's convention of *tolerance bands* (acceptable deviation) is worth borrowing — not every unplanned edge is a bug.
- **Linear/GitHub Issues/Notion** rarely connect plans to architectural artifacts at all; the link is text-only. Kiro and GitHub spec-kit add a spec → tasks → implementation chain but stop short of a structural diff. This is the gap.

## 6. End-to-end OSS that gets close

- **Erode** (`erode.dev`, `github.com/erode-app/erode`) — closest match. Multi-stage AI pipeline that reads code diffs, extracts architectural changes, compares to a Structurizr/LikeC4 model, surfaces drift in PR comments, and can auto-PR a model update. Worth studying its prompt structure.
- **drift** (`github.com/sauremilk/drift`) — static analyzer for architectural erosion in AI-generated code. GitHub Action.
- **LikeC4** — architecture-as-code with live preview, exportable JSON model, supports tagged "future" views.
- **Sourcegraph batch changes** — large-scale code change coordination, but not architectural.
- **Stack-graphs** (GitHub) — name-resolution graphs, not architectural diffs.
- **Foundry**: there's no widely-used "Foundry" code-viz tool. The candidates are (a) Palantir Foundry's *Machinery* graph editor (workflow graphs, not code), (b) Microsoft's *Foundry Toolkit for VS Code* (AI agent inspector), (c) `foundry-rs` (Ethereum). None target architectural diff. If the user means "the Foundry pattern" abstractly, it likely refers to Palantir's data-as-objects approach — relevant only as inspiration for treating the snapshot as a queryable object graph.

## 7. Brain workflow integration — prior art and gap

Brain's planning workflow (`src/modules/workflow/flows/planning.ts`, `implementation.ts`, `planning-completion.ts`) already produces design docs at `docs/plans/`. The gap codewatch can fill: those docs are prose. Reviewers cannot mechanically check whether the implementation followed the plan. Adding a structured plan-delta block to the design doc — and a post-implementation divergence step to `planning-completion.ts` — is a low-disruption integration: brain writes the plan, codewatch interprets it, and the existing workflow runs.

## Proposed end-to-end workflow

1. **Before-state snapshot**. On planning-flow entry, codewatch runs against the current commit and writes `~/.codewatch/snapshots/<branch>-<commit>.db`. The planning agent receives a compact JSON projection (nodes, edges, key metrics) so its design doc can reference real files and metrics.
2. **Plan-as-marked-diff**. The planning workflow emits, alongside the prose design doc, a `plan.delta.yaml` of the form below. The schema is intentionally tiny and matches codewatch's snapshot shape so the same renderer handles both the plan overlay and the post-implementation diff:
   ```yaml
   add:
     nodes: [{id: "src/payments/refund.ts", kind: "module"}]
     edges: [{src: "src/payments/refund.ts", dst: "src/clients/stripe.ts", kind: "import"}]
   modify:
     nodes: [{id: "src/cart.ts", target: {complexity_max: 18}}]
   remove:
     edges: [{src: "src/cart.ts", dst: "src/legacy/checkout-v1.ts"}]
   tolerance:
     unplanned_edges_per_module: 1
     complexity_drift_pct: 10
   ```
   A `codewatch render --plan plan.delta.yaml --base <commit>` command emits a Mermaid diagram with green dashed arrows for planned additions, red dotted lines through removals, and amber boxes for modified nodes — pasteable into the design doc and PR description.
3. **Agent implements**. No change to brain's implementation flow.
4. **After-state snapshot**. The PR-lifecycle workflow runs codewatch against the head commit and stores it next to the base snapshot.
5. **Divergence report**. `codewatch divergence --base <commit-A> --head <commit-B> --plan plan.delta.yaml` performs three set-diffs and a metric delta:
   - *Planned ∩ Implemented*: green check.
   - *Planned ∖ Implemented*: missing work, listed by id.
   - *Implemented ∖ Planned*: unplanned changes, the most interesting bucket. Filter by tolerance band; anything over is a finding.
   - *Metric drift*: per modified node, target vs actual, percentage off.
   Output is markdown with an embedded Mermaid overlay (same renderer as step 2) and a JSON sidecar for CI gates. Treat each finding as a fitness-function failure: gateable in CI, like NDepend's baseline rules and Erode's drift comments. The report attaches to the PR via brain's `pr-lifecycle` flow.

The win is that **the plan, the implementation, and the divergence all share one schema and one renderer**, which is what makes deviation cheap to spot — exactly the property BIM deviation analysis exploits in construction.

## Sources

- [Structurizr CLI](https://github.com/structurizr/cli), [Structurizr DSL language reference](https://docs.structurizr.com/dsl/language)
- [Erode — Architecture Drift Detection](https://erode.dev/), [erode-app/erode on GitHub](https://github.com/erode-app/erode)
- [dependency-cruiser GitHub](https://github.com/sverweij/dependency-cruiser), [dependency-cruiser CLI docs](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)
- [ts-arch](https://github.com/ts-arch/ts-arch), [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS)
- [jQAssistant User Manual](https://jqassistant.github.io/jqassistant/current/), [Architecture verification with jQAssistant + arc42](https://software-engineering-corner.hashnode.dev/architecture-verification-and-documentation-with-jqassistant-and-arc42)
- [NDepend Code Diff since Baseline](https://www.ndepend.com/features/code-diff)
- [Building Evolutionary Architectures (Ford/Parsons/Kua/Sadalage)](https://nealford.com/books/buildingevolutionaryarchitectures.html), [Fitness Functions for Your Architecture (InfoQ)](https://www.infoq.com/articles/fitness-functions-architecture/)
- [CodeScene Architectural Analyses](https://docs.enterprise.codescene.io/versions/6.0.34/guides/architectural/architectural-analyses.html)
- [LikeC4](https://likec4.dev/), [LikeC4 GitHub](https://github.com/likec4/likec4)
- [Graph edit distance — Wikipedia](https://en.wikipedia.org/wiki/Graph_edit_distance), [NetworkX optimize_graph_edit_distance](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.similarity.optimize_graph_edit_distance.html)
- [Spec-Driven Development overview (Martin Fowler)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [Spec Kit vs OpenSpec](https://intent-driven.dev/knowledge/spec-kit-vs-openspec/), [Kiro Specs](https://kiro.dev/docs/specs/)
- [TOGAF Architecture Roadmap](https://goodelearning.com/what-is-a-togaf-architecture-roadmap/), [TOGAF Phase E: Opportunities & Solutions](https://pubs.opengroup.org/architecture/togaf9-doc/arch/chap12.html)
- [BIM as-built vs as-designed (NavVis)](https://www.navvis.com/blog/as-designed-as-built-as-constructed-as-is-differences), [BIM deviation analysis (Multivista)](https://www.multivista.com/blog/deviation-analysis-revolutionizing-construction-quality-with-automated-precision/)
- [ADR — Michael Nygard template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md), [ADR superseding pattern (Martin Fowler)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
- [Sourcegraph Batch Changes](https://sourcegraph.com/docs/batch-changes), [Mermaid classDef styling](https://mermaid.js.org/syntax/classDiagram.html), [Madge](https://github.com/pahen/madge)
- [Collaborative Design and Planning of Software Architecture Changes via Software City Visualization (arXiv)](https://arxiv.org/html/2408.16777), [CodeCity (Wettel)](https://wettel.github.io/download/Wettel08b-wasdett.pdf)
- [drift — Architectural Erosion Check](https://github.com/marketplace/actions/drift-architectural-erosion-check)
- [Palantir Foundry Machinery (graph editor)](https://www.palantir.com/docs/foundry/machinery/draw-a-graph), [Microsoft Foundry Toolkit for VS Code](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/microsoft-foundry-toolkit-for-vs-code-is-now-generally-available/4511831)
