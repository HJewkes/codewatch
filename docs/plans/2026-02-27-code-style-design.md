# code-style: Personal Coding Style Fingerprinting Tool

**Date**: 2026-02-27
**Status**: Approved — research integrated

## Problem Statement

AI-generated code often doesn't match a developer's personal style — naming conventions, structural patterns, documentation habits, and higher-level preferences. Existing linters enforce project-wide rules but don't capture the individual fingerprint that makes code "feel like you wrote it."

## Solution

A tool that analyzes your GitHub contributions (commits, PRs, review comments) to build a personal coding style profile, then provides that profile as both a programmatic linter (CLI) and an AI-consumable skill (Claude Code).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | TypeScript monorepo | Single language for tool + skill, tree-sitter for multi-lang AST |
| Analysis approach | Programmatic-first | Minimize token usage; AST/regex/statistics handle 89% of 85 identified features |
| Profile scope | Personal (not project) | Each developer has their own style; projects use project-level linters |
| Schema strategy | Versioned with migrations | Additive evolution, backwards compatible |
| Target languages (v1) | TypeScript, Python | User's primary languages; tree-sitter supports both |
| Distribution | npm package | `npm install -g code-style` |
| Data source | GitHub API only | All code on GitHub; uses octokit |
| Linter strategy | Delegate to existing tools | Generate ESLint/Ruff/Semgrep/ast-grep configs; custom engine only for gaps |
| Idiom detection | jscpd in v1 | Habitual idiom detection via clone analysis is a unique differentiator |
| Claude integration | Full stack (skill + rules + hooks) | Skill for guidance, .claude/rules/ for instructions, hooks for hard enforcement |
| Confidence weighting | Stability-weighted | RoPGen stability rankings inform base confidence; unstable features flagged for review |
| Fixability model | Four-level (from Clippy) | `safe` / `maybe-incorrect` / `requires-input` / `not-fixable` |
| Schema extensions | `$schema` URL + extensions object | SchemaStore registration for IDE support; extensions for tool-specific metadata |

## Data Model

### Style Profile

Stored at `~/.code-style/profile.json`. Each rule carries:

- **Machine-readable convention** (e.g., `"camelCase"`) — drives the linter
- **Confidence score** (0-1) — how consistently the pattern appears
- **Description** (prose) — human-readable explanation, extracted into the Claude skill
- **Examples** (code snippets) — real examples from analyzed repos

```jsonc
{
  "$schema": "https://json.schemastore.org/code-style-profile.json",
  "schemaVersion": "1.0.0",
  "author": "username",
  "generated": "2026-02-27",
  "sources": ["owner/repo-a", "owner/repo-b"],

  "naming": {
    "variables": {
      "convention": "camelCase",
      "confidence": 0.94,
      "stability": "high",
      "fixability": "maybe-incorrect",
      "description": "Use camelCase for all local variables and parameters. Prefer descriptive multi-word names over abbreviations.",
      "examples": [
        { "good": "const userProfile = await fetchUser(id);", "source": "repo-a/src/users.ts:42" },
        { "bad": "const up = await fetchUser(id);" }
      ],
      "extensions": {
        "eslint": { "rule": "@typescript-eslint/naming-convention", "options": [{ "selector": "variable", "format": ["camelCase"] }] },
        "ruff": { "codes": ["N806"] }
      }
    },
    "functions": { "convention": "camelCase", "confidence": 0.97, "stability": "high" },
    "types": { "convention": "PascalCase", "confidence": 0.99, "stability": "high" },
    "files": { "convention": "kebab-case", "confidence": 0.88, "stability": "high" },
    "booleans": { "prefix": "is|has|should", "confidence": 0.72, "stability": "medium" },
    "constants": { "convention": "SCREAMING_SNAKE", "confidence": 0.85, "stability": "high" }
  },

  "structure": {
    "importOrder": { "convention": ["builtin", "external", "internal", "relative"], "confidence": 0.91, "fixability": "safe" },
    "exportStyle": { "convention": "named-prefer", "confidence": 0.85, "fixability": "maybe-incorrect" },
    "functionMaxLines": { "convention": 28, "confidence": 0.78, "fixability": "not-fixable" },
    "fileOrganization": { "convention": "group-by-type", "confidence": 0.65, "stability": "low" },
    "preferredPatterns": { "convention": ["guard-clauses", "early-return", "composition"], "confidence": 0.82 }
  },

  "documentation": {
    "functionDocs": { "convention": "jsdoc-selective", "confidence": 0.80, "fixability": "requires-input" },
    "paramDocs": { "convention": false, "confidence": 0.75, "description": "Relies on TypeScript types instead of @param tags" },
    "moduleHeaders": { "convention": false, "confidence": 0.90 },
    "inlineComments": { "convention": "why-not-what", "confidence": 0.70, "stability": "low" }
  },

  "errorHandling": {
    "style": { "convention": "return-errors", "confidence": 0.72, "stability": "high" },
    "customErrorClasses": { "convention": true, "confidence": 0.68, "stability": "medium" },
    "exhaustiveChecks": { "convention": true, "confidence": 0.88, "stability": "high" }
  },

  "formatting": {
    "braceStyle": { "convention": "1tbs", "confidence": 0.99, "stability": "high", "fixability": "safe" },
    "trailingCommas": { "convention": "all", "confidence": 0.97, "stability": "high", "fixability": "safe" },
    "semicolons": { "convention": true, "confidence": 0.99, "stability": "high", "fixability": "safe" }
  },

  "patterns": {
    "preferPureFunctions": { "strength": "strong", "confidence": 0.82, "stability": "medium" },
    "avoidClassInheritance": { "strength": "moderate", "confidence": 0.68, "stability": "medium" },
    "favorExplicitOverImplicit": { "strength": "strong", "confidence": 0.90, "stability": "medium" }
  },

  "idioms": {
    "detected": [
      {
        "name": "fetch-try-catch-pattern",
        "description": "Wraps all fetch calls in try/catch with specific error handling shape",
        "frequency": 12,
        "confidence": 0.85,
        "example": "try { const res = await fetch(url); ... } catch (err) { if (err instanceof NetworkError) ... }"
      }
    ]
  },

  "antiPatterns": {
    "acknowledged": [
      { "pattern": "nested-ternaries", "reason": "Readable for simple cases", "deprecated": false }
    ]
  },

  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.spec.ts"],
      "naming": {
        "functions": { "convention": "any", "description": "Test names can be descriptive phrases" }
      }
    }
  ],

  "severityThresholds": {
    "error": 0.85,
    "warn": 0.60,
    "info": 0.40
  }
}
```

### Storage Layout

```
~/.code-style/
  profile.json          # The style profile
  profile-meta.json     # Metadata: generation info, source repos, timestamps
  cache/                # Cached GitHub API responses
  languages/
    typescript.json      # Language-specific overrides
    python.json
```

## Analysis Pipeline

### Pipeline Stages

```
Ingest → Extract → Aggregate → AI Enrich → Interactive Review
```

### Stage 1: Ingest (Programmatic — zero tokens)

- Uses `octokit` to fetch commits, PR diffs, and review comments
- Filters: code files only, skip generated/vendored files
- Caches raw data locally to avoid re-fetching
- Output: corpus of code snippets, diffs, and review comments by language

### Stage 2: Extract (Programmatic — zero tokens)

Primary tool: **tree-sitter** with language-specific grammars (handles 10 of 15 feature categories). Supplementary tools for specific needs.

| Extractor | Method | Tool | Features |
|-----------|--------|------|----------|
| `naming` | AST walk + `#match?` predicates | tree-sitter | 10 features: variable, function, type, file, boolean, constant, enum, parameter, private member naming |
| `structure` | AST node counting + classification | tree-sitter | Import grouping, export style, barrel files, export proximity |
| `control-flow` | Ratio measurements over AST nodes | tree-sitter | Guard clauses, early return, ternary preference, loop styles, async patterns |
| `formatting` | Config detection + frequency analysis | Existing configs (.prettierrc, .editorconfig) + ECLint-style inference | Brace style, semicolons, commas, quotes, indentation |
| `documentation` | Comment node analysis | tree-sitter | JSDoc presence, coverage by visibility, density, placement, tag usage |
| `error-handling` | Structural detection | tree-sitter | try/catch frequency, catch specificity, Result types, exhaustive handling |
| `type-system` | Type annotation analysis | tree-sitter + ts-morph (for type-resolution) | Annotation density, explicit returns, interface vs type, generics, readonly |
| `complexity` | Statement/depth counting | tree-sitter | Function length, nesting depth, file length |
| `idioms` | Token-based clone detection | jscpd | Repeated structural patterns, habitual code shapes |
| `review-voice` | Text analysis | Regex + keyword frequency | What the user flags in reviews, common themes |
| `topology` | Module graph (deferred to v2) | dependency-cruiser | Layering, cycles, fan-in/fan-out |

Each extractor outputs raw observations: `{ type, value, file, line }`.

**85 total features** across 10 categories. See `docs/research/07-unified-feature-taxonomy.md` for the complete list.

### Stage 3: Aggregate (Programmatic — zero tokens)

- Groups observations by type
- Computes frequency distributions and consistency scores
- **Confidence = consistency × stability_weight**: Features rated "high stability" by RoPGen research receive a confidence boost; "low stability" features are penalized
- Identifies dominant pattern per category + confidence
- Flags low-confidence categories for human review (prioritizing low-stability features)
- Detects language-specific vs cross-language patterns
- Maps confidence scores to severity levels using configurable thresholds (default: ≥0.85 → error, ≥0.60 → warn, ≥0.40 → info)

### Stage 4: AI Enrich (Lightweight LLM — minimal tokens)

Only runs for the 9 of 85 features (11%) that AST/regex can't detect:

- **Description prose generation**: Turn statistical observations into human-readable rule descriptions with examples
- **Review voice synthesis**: Summarize what the user flags in code reviews into actionable prose rules
- **Documentation voice/tone**: Classify comment style (imperative vs declarative, why vs what)
- **Anti-pattern detection**: Compare detected patterns vs language best practices, flag potential improvements
- **Pure function/composition assessment**: Cross-pattern holistic analysis of architectural preferences

Uses **Claude Haiku** (or local Ollama) with bounded token budget: ~2K tokens per category, ~20K total. Input is always **summarized statistics + 3-5 representative code samples** — never raw files.

### Stage 5: Interactive Review (User-facing)

Deep-dive walkthrough of every detected category:

- Shows detected pattern, confidence, examples from your code
- Low confidence: "We detected both X and Y — which do you prefer?"
- Anti-patterns: "This is generally discouraged because... — keep or adjust?"
- AI patterns: "We think you prefer X — accurate?"
- User confirms/adjusts/rejects each item
- Final profile written after full walkthrough

## CLI Design

### Package: `code-style` (npm)

```
code-style init                    # Full analysis + interactive setup
  --repos owner/repo1,owner/repo2
  --since 2025-06-01
  --until 2026-02-27
  --languages ts,py
  --github-token <token>

code-style check [path]            # Lint files against your profile
  --fix                            # Auto-fix what's fixable
  --language ts
  --profile <path>

code-style diff                    # Check only staged/changed files
  --fix

code-style show                    # Pretty-print current profile
  --category naming
  --json

code-style update                  # Re-run analysis, merge with existing
  --repos ...
  --keep-overrides

code-style export                  # Export profile in different formats
  --format skill                   # Claude Code skill files
  --format claude-rules            # .claude/rules/ path-scoped files
  --format hooks                   # Claude Code hooks for hard enforcement
  --format eslint                  # ESLint flat config with plugins
  --format ruff                    # Ruff pyproject.toml section
  --format semgrep                 # Semgrep YAML rules for structural patterns
  --format ast-grep                # ast-grep YAML rules for custom patterns
  --format editorconfig            # Basic formatting conventions
  --format markdown                # Human-readable style guide

code-style compare <profile>       # Compare two profiles

code-style hook install            # Add pre-commit hook
code-style hook remove
```

### Lint Rule Fixability

| Category | Enforcement Tool | Fixability |
|----------|-----------------|------------|
| Naming conventions | ESLint `@typescript-eslint/naming-convention` / Ruff `N` | `maybe-incorrect` (rename could break references) |
| Import ordering | ESLint `eslint-plugin-perfectionist` / Ruff `I` | `safe` |
| Export style | ESLint `eslint-plugin-import` | `maybe-incorrect` |
| File naming | ESLint `eslint-plugin-unicorn/filename-case` | `not-fixable` |
| Function length | ESLint `max-lines-per-function` / Ruff `C90` | `not-fixable` |
| Nesting depth | ESLint `max-depth` | `not-fixable` |
| Documentation | ESLint `eslint-plugin-jsdoc` / Ruff `D` | `requires-input` (skeleton generation) |
| Type annotations | ESLint `@typescript-eslint` type rules | `not-fixable` |
| Structural patterns | Semgrep YAML rules | `not-fixable` (report only) |
| Custom AST patterns | ast-grep YAML rules | `maybe-incorrect` (rewrite rules) |
| Higher-level patterns | Claude Code skill only | N/A (AI guidance) |

## Claude Code Integration (Full Stack)

The tool exports three complementary enforcement layers:

1. **Skill** (advisory): Reference docs that Claude reads when writing/reviewing code
2. **`.claude/rules/`** (instructional): Path-scoped rules generated per-language, always loaded by Claude
3. **Hooks** (hard enforcement): PostToolUse hooks that run linter checks on written files, blocking violations of high-confidence rules

### Skill Structure

```
~/.claude/skills/code-style-personal/
  skill.md              # Main skill file (minimal, references detail docs)
  references/
    style-guide.md      # Full human-readable style guide
    naming.md           # Detailed naming rules with examples
    patterns.md         # Higher-level patterns and preferences
    per-language/
      typescript.md
      python.md
```

### Trigger Conditions

- Writing new code (new files, new functions)
- Reviewing code
- Refactoring existing code

### Content Strategy

`skill.md` is kept minimal — top 5-8 high-confidence rules as bullet points, with `[references/...]` links for full details. This keeps context window usage low.

## Project Structure

```
code-style/
├── package.json                 # Workspace root (pnpm)
├── tsconfig.json
├── packages/
│   ├── cli/                     # CLI entry point + commands
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── interactive/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── analyzer/                # Analysis pipeline
│   │   ├── src/
│   │   │   ├── ingest/
│   │   │   ├── extractors/
│   │   │   ├── aggregator/
│   │   │   ├── enricher/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── checker/                  # Lint orchestration (delegates to ESLint, Ruff, Semgrep, ast-grep)
│   │   ├── src/
│   │   │   ├── orchestrator/    # Runs tools, collects results
│   │   │   ├── generators/     # Generate tool-specific configs from profile
│   │   │   └── formatters/     # Unify output (text, json, reviewdog)
│   │   └── package.json
│   │
│   └── profile/                 # Profile schema, migrations, I/O
│       ├── src/
│       │   ├── schema/
│       │   ├── migrations/
│       │   └── exporters/
│       └── package.json
│
├── skills/                      # Template skill files for export
│   └── code-style-personal/
│       └── ...
│
└── tests/
    └── fixtures/
```

### Key Dependencies

**Runtime (shipped with CLI)**:

| Dependency | Purpose |
|-----------|---------|
| `tree-sitter` + `tree-sitter-typescript` + `tree-sitter-python` | Multi-language AST parsing (primary extraction engine) |
| `octokit` | GitHub API (ingest stage) |
| `jscpd` | Clone/habitual idiom detection (TypeScript API) |
| `zod` | Profile schema validation |
| `commander` or `yargs` | CLI framework |
| `@inquirer/prompts` | Interactive review session |
| `chalk` | Terminal styling |

**Peer dependencies (user installs for enforcement)**:

| Dependency | Purpose |
|-----------|---------|
| `eslint` + `@typescript-eslint` + plugins | TypeScript enforcement |
| `ruff` | Python enforcement |
| `semgrep` (optional) | Structural pattern enforcement |
| `ast-grep` (optional) | Custom AST pattern enforcement |

**Build**:

| Dependency | Purpose |
|-----------|---------|
| `tsup` | Bundle packages |
| `vitest` | Testing |
| `pnpm` | Workspace management |
| `tsx` | Development runner |

## Research Findings & Design Refinements

Full research documents are in `docs/research/`. Key synthesis artifacts:
- `07-unified-feature-taxonomy.md` — Master list of 85 features with detection method, tool, and stability
- `08-tool-pipeline-matrix.md` — Which tool handles which role, avoiding overlap

Below are the key findings and resulting design changes.

### Market Validation

No existing tool — open source or commercial — does what we're building. The closest attempts:

- **JetBrains Junie**: auto-generates guidelines from codebase analysis, but produces a static snapshot with no schema, no linter, no interactive review
- **Windsurf Cascade**: automatic style learning (78% accuracy), but memories are opaque and non-inspectable
- **Qodo Rules Discovery**: infers conventions from codebase + PR history, but team-level only
- **Naturalize** (academic): n-gram models for identifier naming suggestions with pre-commit hook — validates the approach works
- **CodeStylometry** (USENIX 2015): 98% accuracy on 1,600-author classification using syntactic/layout/semantic features — validates that style fingerprinting is feasible

Every commercial feedback loop is suppression-based ("stop flagging this") rather than characterization-based ("here is what this developer's style actually looks like"). Our inspectable, editable profile is a genuine differentiator.

### Schema Refinements (from convention frameworks research)

Based on analysis of ESLint, Clippy, W3C Design Tokens, and other frameworks:

1. **`$schema` URL**: Register with SchemaStore.org for IDE autocomplete/validation
2. **Four-level fixability** (adopted from Clippy): `machine-applicable` / `maybe-incorrect` / `has-placeholders` / `unspecified` — replaces binary fixable flag
3. **`extensions` object**: Tool-specific metadata (ESLint rule mappings, Ruff codes, Semgrep rule IDs) without polluting the core schema
4. **Per-file overrides via globs**: Test files, config files, scripts may have different conventions than source code
5. **Configurable confidence-to-severity thresholds**: Users tune how strict the linter is
6. **`deprecated` field**: For rules that the user has since moved away from

### Pipeline Refinements (from programmatic analysis research)

Core insight: **"Soft" style preferences leave concrete structural traces in the AST. Most style questions reduce to ratio measurements over structurally unambiguous node types.**

Extractors we can add or strengthen programmatically (no AI needed):

| Pattern | Detection Method |
|---------|-----------------|
| Guard clauses vs nested ifs | Return depth + else-after-return ratio |
| Idiomatic array methods vs for loops | `ForStatement` vs `.map()/.filter()` node counts |
| Async/await vs promise chains | AST node type ratios |
| Import grouping | `eslint-plugin-import` classification |
| Documentation presence by visibility | Comment nodes adjacent to function/method declarations |
| Error handling strategy | try/catch frequency, Result-type annotations, catch specificity |
| Code clone / habitual idioms | jscpd (Rabin-Karp over 150+ languages) |

AI enrichment stage shrinks to: **description prose generation, review-voice synthesis, tone/intent analysis, and cross-pattern holistic assessment**.

### Linter Strategy Refinement

Rather than building a from-scratch linter engine for everything, use a hybrid approach:

1. **Delegate to existing tools** where possible: Generate ESLint configs (with `@typescript-eslint/naming-convention`, `eslint-plugin-perfectionist`, `eslint-plugin-unicorn`, `eslint-plugin-import`), Ruff configs, and Semgrep rules from the profile
2. **ast-grep rules** for custom structural patterns that existing linters don't cover (12.6K stars, tree-sitter based, very fast)
3. **Custom engine** only for patterns that don't map to any existing tool

### Additional Dependencies (from research)

| Dependency | Purpose |
|-----------|---------|
| `ast-grep` | Tree-sitter based pattern matching for custom lint rules |
| `jscpd` | Repeated pattern / habitual idiom detection (TS API) |
| Semgrep | Higher-level structural style rules (YAML-based) |
| `eslint-plugin-perfectionist` | Auto-fixable ordering rules |
| `eslint-plugin-unicorn` | File naming, abbreviation prevention, idiom enforcement |
| `@typescript-eslint` | Naming conventions, type-aware rules |
| `eslint-plugin-import` | Import ordering and classification |
| `lizard` | Cross-language complexity metrics |

### Feature Taxonomy (from authorship attribution research)

AuthAttLyzer V2's 54-feature taxonomy and RoPGen's stability analysis inform which features to extract and how to weight confidence:

- **Most stable signals** (highest confidence weighting): AST node type distributions, naming conventions, import patterns
- **Moderately stable**: documentation patterns, error handling strategy, function length preferences
- **Least stable** (lower confidence, flag for review): formatting preferences that formatters override, comment density

### Export Targets (expanded)

Based on research into how tools consume style rules:

```
code-style export --format skill       # Claude Code skill + reference docs
code-style export --format eslint      # ESLint flat config
code-style export --format ruff        # Ruff pyproject.toml section
code-style export --format semgrep     # Semgrep YAML rules for structural patterns
code-style export --format ast-grep    # ast-grep rules for custom patterns
code-style export --format editorconfig # Basic formatting conventions
code-style export --format markdown    # Human-readable style guide
code-style export --format claude-rules # .claude/rules/ path-scoped files
code-style export --format hooks       # Claude Code hooks for hard enforcement
```

### Claude Code Integration Points

Beyond the skill, leverage additional Claude Code mechanisms:

- **`.claude/rules/`** path-scoped rules: Generate per-language rules (e.g., `typescript.md`, `python.md`)
- **Hooks** (PreToolUse/PostToolUse): Hard enforcement — block or auto-correct writes that violate high-confidence rules
- **Output Styles**: Possible export format for comprehensive style control of Claude's communication/code generation

## Next Steps

1. Create implementation plan (invoke writing-plans skill)
2. Begin implementation in order:
   - Profile schema (Zod schemas, migrations, I/O) — foundation everything builds on
   - Extractors (tree-sitter AST walks, jscpd integration) — core value
   - Aggregator (statistical analysis, stability-weighted confidence) — turns observations into profile
   - AI enricher (Haiku/Ollama integration for 11% of features) — prose and interpretation
   - Interactive review (deep-dive CLI session) — user confirms/adjusts profile
   - CLI commands (init, show, check, diff, update, export, compare, hook)
   - Checker orchestration (ESLint/Ruff/Semgrep/ast-grep config generation + unified output)
   - Export layer (skill, claude-rules, hooks, eslint, ruff, semgrep, ast-grep, editorconfig, markdown)
   - Skill template (handlebars templates for Claude Code skill generation)
