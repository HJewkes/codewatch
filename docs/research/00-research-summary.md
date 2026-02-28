# Research Summary

**Date**: 2026-02-27
**Purpose**: Landscape research to inform the code-style design

## Research Documents

| # | Topic | File |
|---|-------|------|
| 01 | Agentic style tools (Claude, Cursor, Copilot, etc.) | [01-agentic-style-tools.md](01-agentic-style-tools.md) |
| 02 | Linters & static analyzers (ESLint, Ruff, tree-sitter, etc.) | [02-linters-static-analyzers.md](02-linters-static-analyzers.md) |
| 03 | Style convention frameworks (schemas, formats, standards) | [03-style-convention-frameworks.md](03-style-convention-frameworks.md) |
| 04 | Programmatic soft style checking (AST-based pattern detection) | [04-programmatic-soft-style-checking.md](04-programmatic-soft-style-checking.md) |
| 05 | Open source landscape (25 projects across 7 categories) | [05-open-source-landscape.md](05-open-source-landscape.md) |
| 06 | Commercial landscape (AI assistants, quality platforms, review tools) | [06-commercial-landscape.md](06-commercial-landscape.md) |
| 07 | **Unified feature taxonomy** (85 features, detection methods, stability) | [07-unified-feature-taxonomy.md](07-unified-feature-taxonomy.md) |
| 08 | **Tool-to-pipeline matrix** (which tool handles what, avoiding overlap) | [08-tool-pipeline-matrix.md](08-tool-pipeline-matrix.md) |

## Top-Level Findings

### 1. The gap is real

No existing tool — open source or commercial — automatically extracts per-developer style profiles from code history into an inspectable, editable format. Every approach is either manual (write rules yourself), opaque (model learns but you can't see what), or team-level (not personal).

### 2. The sub-problems are solved

Each component we need has mature prior art:
- **Feature extraction**: CodeStylometry (54 features), AuthAttLyzer, RoPGen (23 stable attributes)
- **AST analysis**: tree-sitter, ts-morph, ast-grep, Semgrep
- **Convention enforcement**: ESLint, Ruff, Semgrep, ast-grep
- **Delivery to AI**: Claude Code skills, .claude/rules/, hooks
- **Delivery to CI**: reviewdog (any linter → PR comments)

The integration is what's missing.

### 3. Programmatic detection is broader than expected

Most "soft" style preferences leave structural AST traces. Ratio measurements over node types detect: guard clauses, idiomatic patterns, import organization, error handling strategy, documentation habits. AI enrichment can shrink to prose generation, review-voice synthesis, and holistic assessment.

### 4. Delegate linting to existing tools

Rather than a from-scratch linter, generate configs for ESLint (with plugins), Ruff, Semgrep, and ast-grep from the profile. Custom engine only for gaps.

### 5. Schema should learn from the best

Adopt from Clippy: four-level fixability. From W3C Design Tokens: `$schema`, `$description`, `$extensions`. From Ruff: per-file glob overrides. Register with SchemaStore.org.

## Key Projects to Study Further

| Project | Why |
|---------|-----|
| Naturalize (mast-group) | Closest to our approach: learns naming from codebase, pre-commit hook |
| CodeStylometry | Feature taxonomy for extraction |
| AuthAttLyzer V2 | 54 features with SHAP interpretability |
| RoPGen | Which style attributes are most stable/reliable |
| ECLint | Frequency-voting inference for EditorConfig |
| ast-grep | Tree-sitter pattern matching, fast, active (12.6K stars) |
| jscpd | Habitual idiom detection via code clone analysis |

## Design Changes Incorporated

All findings have been incorporated into the [design document](../plans/2026-02-27-code-style-design.md) under "Research Findings & Design Refinements". Key changes:

1. Four-level fixability classification
2. `$schema` + SchemaStore registration
3. `extensions` object for tool-specific metadata
4. Per-file glob overrides
5. Hybrid linter strategy (delegate + ast-grep + custom)
6. Expanded export targets (semgrep, ast-grep, editorconfig, claude-rules, hooks)
7. Feature weighting informed by authorship attribution stability research
8. Reduced AI enrichment scope (more is programmatic than initially expected)
