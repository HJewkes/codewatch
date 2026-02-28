# Tool-to-Pipeline Matrix

**Date**: 2026-02-27
**Purpose**: Define which tool handles which role in the code-style pipeline. Each detection or enforcement need maps to exactly one primary tool to avoid overlap.

## Pipeline Stage Assignments

### Stage 1: Ingest (Data Collection)

| Tool | Role | Why This Tool |
|------|------|---------------|
| **octokit** | Fetch commits, PR diffs, review comments from GitHub API | Official GitHub SDK, comprehensive API coverage |

No alternatives needed — GitHub-only data source.

### Stage 2: Extract (Feature Detection)

The extraction stage has the most tools. The key principle: **one primary tool per feature category**, with fallbacks only where the primary can't reach.

| Feature Category | Primary Tool | Fallback | Why |
|-----------------|-------------|----------|-----|
| **Naming conventions (TS)** | tree-sitter + `#match?` predicates | — | Language-agnostic queries, works on raw source without project setup |
| **Naming conventions (Python)** | tree-sitter + `#match?` predicates | — | Same engine, Python grammar |
| **File naming** | Filesystem path regex | — | No AST needed |
| **Import ordering & grouping** | tree-sitter (parse import nodes, classify by source string) | — | Simpler than running ESLint for detection; we just need observations, not enforcement |
| **Export style** | tree-sitter (count node types) | — | Direct AST node counting |
| **Function/file length** | tree-sitter (statement count per function body) | lizard (cross-validation) | tree-sitter is primary; lizard validates and adds cyclomatic complexity |
| **Nesting depth** | tree-sitter (recursive depth walk) | — | Simple AST traversal |
| **Control flow patterns** | tree-sitter (guard clause detection, return depth, loop types) | — | All ratio-based measurements over AST nodes |
| **Error handling** | tree-sitter (try/catch nodes, type annotations) | — | Structural detection |
| **Documentation presence** | tree-sitter (comment nodes adjacent to declarations) | — | Comment node analysis |
| **Type system usage (TS)** | tree-sitter (type annotation nodes, interface vs type) | ts-morph (type-aware queries) | tree-sitter for most features; ts-morph only for type-resolution-dependent checks (utility types, discriminated unions) |
| **Formatting** | Existing config detection (.prettierrc, .editorconfig) + ECLint-style frequency analysis | — | Parse existing configs first; infer from code where no config exists |
| **Habitual idioms** | jscpd (Rabin-Karp clone detection) | — | Only tool designed for this; TS API for programmatic use |
| **Review voice** | Regex + keyword frequency analysis on review comment text | — | Simple text analysis; AI handles synthesis |
| **Module topology** | dependency-cruiser (graph analysis) | — | Purpose-built for module dependency graphs |

**Why tree-sitter is the primary extraction tool**: It handles 10 of 15 feature categories from a single engine. Using tree-sitter queries with `#match?` predicates for regex matching on captured node text gives us naming, structure, control flow, error handling, documentation presence, and type system features in one unified AST walk per file. This minimizes parse overhead and keeps the extractor architecture simple.

**When NOT to use tree-sitter**:
- File naming (no AST needed — just path analysis)
- Formatting (existing config files are the primary signal)
- Habitual idioms (jscpd's token-based approach is purpose-built)
- Module topology (requires cross-file graph, not per-file AST)
- Type-resolution queries (need ts-morph for actual TypeScript type checker access)

### Stage 3: Aggregate (Statistical Analysis)

No external tools. Custom TypeScript code computes:
- Frequency distributions per feature
- Consistency scores (how often the dominant pattern appears)
- Confidence = consistency × stability_weight (from RoPGen rankings)
- Outlier detection (features with no dominant pattern → flag for review)
- Language-specific vs cross-language pattern separation

### Stage 4: Enrich (AI Pass)

| Tool | Role | Input | Token Budget |
|------|------|-------|-------------|
| **Claude Haiku** (primary) | Higher-level pattern interpretation, description prose generation, anti-pattern flagging | Summarized statistics + 3-5 representative code samples per category | ~2K tokens per category, ~20K total |
| **Ollama** (optional local) | Same role, for users who prefer local inference | Same input format | N/A (local) |

AI handles only 9 of 85 features (11%). The input is never raw files — always summarized observations.

### Stage 5: Interactive Review

| Tool | Role |
|------|------|
| **@inquirer/prompts** | Interactive CLI prompts for confirm/reject/adjust per category |
| **chalk** | Terminal styling for confidence indicators, code examples |

---

## Enforcement Layer (code-style check)

The key architectural decision: **delegate to existing linters, don't build a custom engine**.

### How It Works

`code-style check` generates tool-specific configs from the profile, runs the tools, and unifies their output.

```
Profile JSON → Config Generator → [ESLint, Ruff, Semgrep, ast-grep] → Unified Output
```

### Tool Assignments for Enforcement

| What's Being Checked | Enforcement Tool | Config Generated | Auto-fixable? |
|---------------------|-----------------|-----------------|---------------|
| **TS naming conventions** | ESLint + `@typescript-eslint/naming-convention` | eslint.config.js | No (rename is risky) |
| **TS import ordering** | ESLint + `eslint-plugin-perfectionist` | eslint.config.js | Yes (safe reorder) |
| **TS export style** | ESLint + `eslint-plugin-import` | eslint.config.js | Partial |
| **TS file naming** | ESLint + `eslint-plugin-unicorn/filename-case` | eslint.config.js | No |
| **TS function length** | ESLint `max-lines-per-function` | eslint.config.js | No |
| **TS nesting depth** | ESLint `max-depth` | eslint.config.js | No |
| **TS documentation** | ESLint + `eslint-plugin-jsdoc` | eslint.config.js | Partial (skeleton) |
| **TS type annotations** | ESLint + `@typescript-eslint` type rules | eslint.config.js | No |
| **Python naming** | Ruff (`N` rules) | ruff.toml | No |
| **Python import ordering** | Ruff (`I` rules / isort) | ruff.toml | Yes |
| **Python docstrings** | Ruff (`D` rules / pydocstyle) | ruff.toml | Partial |
| **Python complexity** | Ruff (`C90` rules) | ruff.toml | No |
| **Python formatting** | Ruff format settings | ruff.toml | Yes |
| **Structural patterns (guard clauses, etc.)** | Semgrep (YAML rules) | .semgrep/ rules | No (report only) |
| **Custom AST patterns** | ast-grep (YAML rules) | .ast-grep/ rules | Partial (rewrite rules) |
| **Habitual idiom drift** | jscpd (consistency check) | jscpd config | No (report only) |

### What Doesn't Get Checked Programmatically

These profile categories are **AI-guidance-only** — they appear in the Claude skill but have no linter rule:

- Documentation voice/tone
- Why vs what comments
- Pure function preference
- Error boundary architecture
- Composition vs inheritance (heuristic detection but no enforcement)
- Review voice themes

### Output Unification

All tools output in different formats. `code-style check` normalizes to:

```
{file}:{line}:{col} {severity} {message} [{category}.{rule}]
```

This format is compatible with:
- reviewdog (for PR comment delivery)
- VS Code problem matcher
- Standard terminal output

---

## Export Layer (code-style export)

| Export Format | Source Categories | Generated Artifact |
|--------------|------------------|-------------------|
| `--format skill` | All categories | `~/.claude/skills/code-style-personal/` (skill.md + references/) |
| `--format claude-rules` | All categories | `.claude/rules/{language}.md` files |
| `--format hooks` | High-confidence checkable rules | `.claude/settings.json` hook entries |
| `--format eslint` | TS naming, imports, exports, docs, types, formatting | `eslint.config.js` |
| `--format ruff` | Python naming, imports, docs, complexity, formatting | `ruff.toml` or `pyproject.toml` section |
| `--format semgrep` | Structural patterns | `.semgrep/` YAML rules |
| `--format ast-grep` | Custom AST patterns | `.ast-grep/` YAML rules |
| `--format editorconfig` | Formatting basics | `.editorconfig` |
| `--format markdown` | All categories | Human-readable style guide document |

---

## Dependency Summary

### Runtime Dependencies (shipped with CLI)

| Package | Purpose | Used In |
|---------|---------|---------|
| tree-sitter + grammars (TS, Python) | Multi-language AST parsing | Extract stage |
| octokit | GitHub API | Ingest stage |
| zod | Profile schema validation | Profile package |
| commander or yargs | CLI framework | CLI package |
| @inquirer/prompts | Interactive review session | CLI (init command) |
| chalk | Terminal styling | CLI output |
| jscpd | Clone/idiom detection | Extract stage |

### Peer/Optional Dependencies (user must have installed)

| Package | Purpose | Used In |
|---------|---------|---------|
| eslint + plugins | TS enforcement | check command |
| ruff | Python enforcement | check command |
| semgrep | Structural pattern enforcement | check command (optional) |
| ast-grep | Custom pattern enforcement | check command (optional) |

### Build Dependencies

| Package | Purpose |
|---------|---------|
| tsup | Bundle packages |
| vitest | Testing |
| pnpm | Workspace management |
| tsx | Development runner |

### NOT Used (considered and rejected)

| Tool | Reason |
|------|--------|
| ts-morph (as primary) | tree-sitter sufficient for 90% of TS extraction; ts-morph only for type-resolution edge cases |
| LibCST | Python auto-fixing handled by Ruff; LibCST adds complexity |
| Joern / Code Property Graphs | Overkill for our extraction needs; tree-sitter sufficient |
| code2vec / CodeBERT | ML embeddings not needed — we use statistical aggregation over AST features |
| GumTree | Commit diff analysis could be useful later but not needed for v1 (we analyze final file state, not diffs) |
| NiCad | Near-miss clone detection interesting but jscpd covers our needs |
| dependency-cruiser | Deferred to v2 — module topology is a low-stability, low-priority feature |
| lizard | Deferred to v2 — tree-sitter handles function length; lizard adds cyclomatic complexity which is a nice-to-have |
