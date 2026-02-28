# Research: Style Convention Frameworks and Schemas

**Date**: 2026-02-27
**Status**: Complete

## Purpose

This document surveys how existing tools, style guides, and ecosystems represent coding style conventions. The goal is to identify patterns, schemas, and formats that inform the design of the `code-style` profile schema — specifically what can be expressed, what cannot, and what patterns we should borrow or avoid.

---

## 1. Style Guide Formats: Major Prose-Based Guides

### PEP 8 (Python)

**What it is**: The authoritative Python style guide, distributed as a human-authored document (PEP — Python Enhancement Proposal).

**Structure**: Organized into named sections covering discrete concern areas:
- Code Layout (indentation, tabs/spaces, line length, blank lines)
- String Quotes
- Whitespace in Expressions and Statements
- Trailing Commas
- Comments (block, inline, docstrings)
- Naming Conventions (with explicit sub-rules per identifier type)
- Programming Recommendations

**How rules are described**: Pure prose with "Correct" and "Wrong" code examples inline. Rules carry qualified guidance — PEP 8 explicitly acknowledges context-dependent exceptions and repeats: "A foolish consistency is the hobgoblin of little minds." The guide distinguishes naming *styles* (describing what patterns look like) from naming *conventions* (prescribing what to use where).

**Machine-readable**: No. PEP 8 itself has no machine-readable form. Its rules are operationalized by separate tools: `pycodestyle` (formerly `pep8`), `flake8`, and `ruff` each implement a subset with their own interpretation. There is no single authoritative machine-readable encoding of PEP 8.

**What it can represent**: High-level intent, rationale, and trade-offs. Context-sensitive rules ("unless you disagree"). The *why* behind conventions.

**What it cannot represent**: Tooling configuration, confidence levels, per-project overrides, machine enforcement logic, or anything requiring computation.

**Lessons for our schema**:
- The "Correct/Wrong" example pattern maps directly to our `examples: [{ good, bad, source }]` structure.
- PEP 8's section organization (naming, layout, whitespace, comments) provides a natural category taxonomy.
- The distinction between a style *style* and a *convention* is useful: we detect observed patterns, then let users ratify them as their conventions.
- Prose rationale ("why") belongs in `description` fields; the machine-readable part belongs in the convention value itself.

---

### Google Style Guides (JavaScript, Java, C++, Python)

**What they are**: Comprehensive HTML documents authored and maintained by Google, available at `https://google.github.io/styleguide/`.

**Structure**: Section-based, covering formatting, naming, file structure, language feature usage, and idioms. The JS guide explicitly states it focuses on "hard-and-fast rules that Google follows universally" and avoids advice that "isn't clearly enforceable (whether by human or tool)."

**Machine-readable form**: Google provides a companion ESLint shareable config (`eslint-config-google`) that operationalizes the JavaScript style guide as ESLint rules. The prose guide and the ESLint config are maintained separately and are not formally linked — the config is derived from the guide, not generated from it.

Google also published `cpplint` (C++) and `google-java-format` (Java) as separate enforcement tools. There is no single schema that unifies the prose and tooling.

**What it can represent**: Opinionated, non-negotiable rules. Rules that are checkable by a tool are encoded in companion linter configs; rules that are too contextual remain prose-only.

**Lessons for our schema**:
- The gap between prose guide and ESLint config illustrates the core problem our tool addresses: rules described in English do not automatically become linter rules.
- Google's conscious choice to only include enforceable rules in its official guide is worth noting — our schema should be clear about what is machine-checkable vs. what is AI-guidance-only.
- The pattern of a "shareable config" as the machine form of a style guide is ubiquitous (Google, Airbnb, StandardJS all follow it).

---

### Airbnb JavaScript Style Guide

**What it is**: A widely adopted JavaScript style guide, maintained as a GitHub repository (`airbnb/javascript`) with an accompanying ESLint shareable config (`eslint-config-airbnb`).

**Structure**: Organized as a single long Markdown document with numbered sections and inline code examples. Each rule has a section heading, rationale, and code examples.

**Machine form**: `eslint-config-airbnb` is a JavaScript module exporting an ESLint configuration object. Airbnb exports three configs for different use cases: the main config (with React), `eslint-config-airbnb-base` (without React), and hooks-specific config. This modular composition pattern is notable.

**What it illustrates**: A style guide can be decomposed into layered, composable machine-readable units. The "extends" pattern lets projects inherit Airbnb's rules and override specific ones.

**Lessons for our schema**:
- Composition via "extends" is a powerful pattern for profile inheritance (e.g., "start from my base profile, apply TypeScript overrides").
- The three-config decomposition (base, full, hooks) shows how a single conceptual style guide can have multiple machine-readable representations for different contexts — analogous to our `languages/typescript.json` overrides.

---

### StandardJS

**What it is**: A JavaScript style guide with a radical design choice: zero configuration. The style is fixed, opinionated, and non-negotiable.

**Structure**: Rules are documented in `RULES.md` organized by category (indentation, spacing, string conventions, code quality, naming, etc.). Each rule has acceptable and problematic code examples, and links to the underlying ESLint rule.

**Machine form**: Implemented as a wrapper around ESLint with a fixed, locked ESLint config. The entire "configuration" is the absence of configuration.

**Philosophy**: StandardJS eliminates style debates entirely. Its value is consistency without decisions.

**What it can and cannot represent**: StandardJS represents a complete, fixed style with no dials. It cannot represent personal or project-specific variation. Its documentation structure (rule name → category → examples → ESLint rule reference) is clean and well-suited to programmatic tooling.

**Lessons for our schema**:
- The "no-configuration" philosophy is the extreme opposite of what we're building, but instructive: our tool builds a personal style that plays the same role — eliminating decisions — but derived from observed behavior rather than external authority.
- The rule structure (name, category, correct example, incorrect example, tool reference) is a clean template for rule documentation.

---

## 2. Configuration Schemas: Tool-Based Rule Representations

### ESLint (JavaScript/TypeScript Linter)

**Format**: JavaScript object (flat config, `eslint.config.js`) or JSON/YAML (legacy `.eslintrc`).

**Rule definition schema**: Each rule is a JavaScript module exporting an object with:

```javascript
{
  meta: {
    type: "problem" | "suggestion" | "layout",
    docs: {
      description: "Brief explanation",
      url: "https://eslint.org/docs/rules/rule-name",
      recommended: true | false
    },
    fixable: "code" | "whitespace" | undefined,
    hasSuggestions: boolean,
    schema: [ /* JSON Schema Draft-04 array defining valid options */ ],
    messages: { messageId: "Error message template" },
    defaultOptions: [ /* default option values */ ]
  },
  create(context) { /* implementation */ }
}
```

**Severity model**: Three levels — `"error"` (2), `"warn"` (1), `"off"` (0). Rules are configured as either a severity string or an array of `[severity, ...options]`.

**Options schema**: Defined using JSON Schema Draft-04. Options are positional (an array where each element has its own schema). Complex options use object schemas with `properties` and `additionalProperties: false`.

**Config structure (flat config)**:
```javascript
[
  {
    name: "my-config",
    files: ["**/*.ts"],
    ignores: ["dist/**"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { vars: "all", args: "after-used" }]
    },
    plugins: { pluginName: pluginObject },
    settings: { sharedData: "value" }
  }
]
```

**Rule documentation structure** (per-rule pages): Each rule page has:
- Title + badges (✅ Recommended, 🔧 Fixable, 💡 hasSuggestions, ❄️ Frozen)
- Brief description
- Rule Details (what it detects)
- Paired Incorrect/Correct code examples with "Open in Playground" links
- Options documentation (option name → values → sub-examples)
- "When Not To Use It" section
- Related Rules links
- Version introduced

**What ESLint can represent**: Syntax-level and semantic-level JavaScript/TypeScript rules with rich option schemas, auto-fix capability declaration, suggestion capability, and detailed documentation.

**What it cannot represent**: Language-agnostic conventions, cross-language style consistency, higher-level architectural patterns, confidence scores, or the "why" for a specific developer's choices.

**Lessons for our schema**:
- The `meta.type` trichotomy (problem/suggestion/layout) maps well to our rule categories: `naming`, `structure`, `formatting` are analogous to `layout`; `patterns` and `errorHandling` are analogous to `suggestion`.
- The `fixable: "code" | "whitespace" | undefined` flag is exactly what we need in our schema — each convention should declare its fixability.
- The `messages` pattern (messageId → template) is good for our linter's error reporting: `{ missingCamelCase: "Variable '{{name}}' should use camelCase" }`.
- `schema: []` with JSON Schema Draft-04 for option validation is a proven approach for validating our profile values.
- The badges (recommended, fixable, hasSuggestions) map to our confidence score + fixability markers.
- The `defaultOptions` field is directly useful: our profile conventions have inferred defaults, and users can override.

---

### Prettier (JavaScript/TypeScript Formatter)

**Format**: `.prettierrc` (JSON/YAML), `prettier.config.js`, or `package.json` key. Validated by JSON Schema available at SchemaStore (`https://www.schemastore.org/prettierrc.json`).

**Options structure**: Flat key-value map. Approximately 25 options, each with:
- A name (camelCase for API, kebab-case for CLI)
- A type: boolean, integer, or string enum
- A default value
- A fixed set of allowed values (for enums)

Example options:
```json
{
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "singleQuote": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always",
  "semi": true
}
```

**Overrides pattern**: File-glob-scoped option overrides:
```json
{
  "overrides": [
    {
      "files": "*.json",
      "options": { "printWidth": 120 }
    }
  ]
}
```

**Design philosophy**: Prettier is deliberately minimal in its option surface. Its design intent is to end style debates — having few options is a feature, not a limitation. The documentation states that `printWidth` is "not a hard limit" but a guide for line-wrapping decisions.

**What it can represent**: Low-level formatting decisions (whitespace, punctuation, line length, quote style). Language-specific parser selection for embedded content. File-type-scoped overrides.

**What it cannot represent**: Naming conventions, structural patterns, documentation style, error handling preferences, higher-level architectural choices, semantic rules, or anything requiring AST analysis beyond formatting.

**Lessons for our schema**:
- Our `formatting` category closely mirrors Prettier's option set — our schema should be compatible with and exportable to Prettier config (already noted in the design: `code-style export --format prettier`).
- The boolean/integer/enum type system is simple and sufficient for low-level formatting rules. Our schema uses the same types for `formatting` category values.
- The `overrides` glob pattern is directly applicable to our language-specific override mechanism.
- Prettier's explicit refusal to add more options is a useful reminder: the goal of a style profile is not to configure every possible knob, but to represent the developer's meaningful choices.

---

### EditorConfig

**Format**: INI-like format (`.editorconfig`), hierarchical by directory. Supported natively by most editors without plugins.

**Supported properties** (the complete list):
- `indent_style` (`tab` | `space`)
- `indent_size` (integer)
- `tab_width` (integer)
- `end_of_line` (`lf` | `cr` | `crlf`)
- `charset` (`utf-8`, `latin1`, `utf-16be`, `utf-16le`, `utf-8-bom`)
- `trim_trailing_whitespace` (boolean)
- `insert_final_newline` (boolean)
- `spelling_language` (ISO 639/3166 code)
- `root` (boolean — stop directory traversal)

**Glob patterns**: Unix shell-style, supporting `*`, `**`, `?`, `[seq]`, `{s1,s2}`, `{num1..num2}`.

**Design philosophy**: EditorConfig is deliberately narrow in scope — it standardizes only editor-level whitespace and encoding behavior. The spec explicitly accepts unknown key-value pairs without error, enabling extensions.

**What it can represent**: The most basic whitespace and encoding conventions shared across all editors. Nothing language-specific, nothing semantic.

**What it cannot represent**: Naming, structure, documentation, patterns, or anything requiring language parsing.

**Lessons for our schema**:
- Our `formatting` category overlaps with EditorConfig's domain. Our export to EditorConfig format should map `formatting.indentStyle`, `formatting.tabWidth`, etc.
- The directory-hierarchical INI format is interesting as a human-editable format but not what we want for a programmatic profile.
- The spec's acceptance of unknown keys (forward compatibility) is a good principle for our schema: unknown fields should be ignored, not rejected.

---

### Ruff (Python Linter/Formatter)

**Format**: TOML (`pyproject.toml` or `ruff.toml`). The most comprehensive Python linting configuration schema currently available.

**Schema structure** (three-level hierarchy):

```toml
[tool.ruff]              # Global options
line-length = 88
target-version = "py311"
indent-width = 4

[tool.ruff.lint]         # Linting configuration
select = ["E", "F", "I", "UP"]
ignore = ["E501"]
fixable = ["ALL"]
unfixable = ["F401"]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]

[tool.ruff.lint.isort]   # Per-plugin subsection
known-first-party = ["my_package"]
force-sort-within-sections = true

[tool.ruff.format]       # Formatter configuration
quote-style = "double"
indent-style = "space"
line-ending = "lf"
```

**Rule selection system**: Rules are referenced by prefix codes (e.g., `"E"` for all pycodestyle errors, `"F841"` for a specific flake8 rule). The `select`/`ignore`/`extend-select` pattern allows additive or subtractive configuration.

**Plugin subsections**: Each linter plugin (isort, pylint, flake8-quotes, pydocstyle, etc.) has its own nested TOML section with typed options. Option types include: booleans, integers, strings, string enums, lists, dict mappings, regex patterns.

**Extension keys**: `extend-select`, `extend-ignore`, `extend-fixable` allow augmenting inherited configurations rather than replacing them — a clean composition pattern.

**Fix classification**: Rules are individually classified as safe-fixable (`extend-safe-fixes`) vs unsafe-fixable (`extend-unsafe-fixes`), giving fine-grained control over automated repair.

**What it can represent**: A very large surface of Python-specific style rules with rich per-rule configuration. Per-file overrides, complexity thresholds (function argument counts, nesting depth), import organization, docstring format, quote style.

**What it cannot represent**: Cross-language conventions, confidence scores, prose descriptions, examples from the developer's own code, or architectural/pattern-level preferences.

**Lessons for our schema**:
- Ruff's `select`/`ignore`/`extend-*` pattern is worth borrowing: for our linter, individual rules could be enabled/disabled/extended.
- The per-plugin subsection pattern (`[tool.ruff.lint.isort]`) maps to our category-specific configuration: each category in our profile could have its own structured sub-object.
- The safe vs. unsafe fixability distinction is important for our schema — renaming a variable is potentially unsafe (breaks references); reordering imports is safe.
- Ruff's `per-file-ignores` glob mapping is a key pattern we need: style conventions may differ between test files and production code.

---

### Black (Python Formatter)

**Format**: TOML (`pyproject.toml`, `[tool.black]` section).

**Available options** (deliberately limited):

| Field | Type | Default |
|-------|------|---------|
| `line-length` | Integer | 88 |
| `target-version` | List of strings | Auto-detected |
| `include` | Regex | `.pyi?$` |
| `exclude` | Regex | (defaults) |
| `extend-exclude` | Regex | — |
| `force-exclude` | Regex | — |

**Philosophy**: Black explicitly limits its option surface. The documentation states: "While Black has quite a few knobs these days, it is still opinionated so style options are deliberately limited and rarely added." Many style choices (string normalization, magic trailing comma handling, AST safety) are command-line flags only or not configurable at all.

**What it can represent**: The line length and target Python version. That's nearly it.

**What it cannot represent**: Quote style, trailing commas, bracket spacing, or any of the dozens of formatting choices Prettier exposes. Black makes those decisions for you.

**Lessons for our schema**:
- Black represents the extreme of "fewer options = better." For our tool, this is instructive in the opposite direction: we are trying to capture personal variation, so we need options for every meaningful choice.
- The 88-character default (not 80 or 100) is interesting — it reflects Black's author's preference, formalized as the default. Our profile is doing the same thing: formalizing a developer's observed preferences as their defaults.

---

### Stylelint (CSS/SCSS Linter)

**Format**: JSON/YAML/JS (`.stylelintrc.json` or `stylelint.config.js`).

**Rule configuration structure**:
```json
{
  "rules": {
    "rule-name": null,
    "rule-name": "primary-option",
    "rule-name": ["primary-option", { "severity": "warning", "message": "Custom msg" }]
  },
  "extends": ["stylelint-config-standard"],
  "plugins": ["stylelint-scss"],
  "overrides": [
    { "files": ["**/*.scss"], "rules": { "scss/dollar-variable-colon-space-after": "always" } }
  ]
}
```

**Primary and secondary options**: Stylelint's rule configuration uses a two-element array pattern where the first element is the primary option (the rule setting) and the second is an object of secondary options. Secondary options include:
- `severity`: `"error"` (default) | `"warning"`
- `message`: Custom error message string or function
- `url`: Link to custom documentation
- `disableFix`: Prevent auto-fix for this rule
- `reportDisables`: Require justification for disable comments

**What it can represent**: CSS/SCSS style conventions with fine-grained severity control per-rule, custom messages, and file-scoped overrides.

**Lessons for our schema**:
- The primary/secondary option split is a clean pattern: the rule value (primary) is separate from meta-configuration (secondary). Our profile mixes these today — `convention` is primary, `confidence` and `description` are secondary.
- Per-rule `severity` control at the secondary-options level is worth considering: some conventions are "must follow" while others are "prefer when possible."
- The `url` secondary option (link to documentation) maps to our `examples[].source` — both provide provenance.

---

### Biome (JavaScript/TypeScript Unified Linter + Formatter)

**Format**: JSON (`biome.json` or `biome.jsonc`). Schema available via `$schema` reference.

**Top-level structure**:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": { "include": ["src/**"], "ignore": ["dist/**"] },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noDebugger": "off" },
      "style": { "useConst": "error" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always" }
  },
  "overrides": [
    { "includes": ["*.test.ts"], "linter": { "rules": { "suspicious": "off" } } }
  ]
}
```

**Severity levels**: `"on"`, `"off"`, `"info"`, `"warn"`, `"error"` — notably a five-level system vs. ESLint's three.

**Rule groups**: accessibility, complexity, correctness, nursery, performance, security, style, suspicious.

**Key design**: Formatter and linter are unified under one schema with language-specific sub-objects (`javascript`, `json`, `css`, `graphql`) each having their own formatter sub-schema.

**What it illustrates**: Biome's use of a publicly available JSON Schema (`$schema` URL) enables IDE autocomplete and validation. SchemaStore.org serves schemas for hundreds of tools using exactly this pattern.

**Lessons for our schema**:
- Our profile schema should have a `$schema` URL so editors can validate it.
- The five-level severity (info/warn/error) is more expressive than three levels; combined with our `confidence` score, we have even richer expressiveness.
- The language-specific sub-objects pattern (`javascript.formatter`, `css.formatter`) directly corresponds to our `languages/typescript.json` override mechanism.
- The unified formatter+linter in one config shows how a complex tool can present a coherent, discoverable schema. Our profile should aim for the same: one coherent schema, not a scattered collection of files.

---

## 3. Tool-Agnostic Convention Specifications

### EditorConfig (as a cross-tool standard)

As covered above, EditorConfig is the most successful tool-agnostic coding convention format in existence. Its success comes from being:
- Deliberately narrow (only whitespace/encoding)
- Universally supported (built into VS Code, JetBrains, Vim, Emacs, Sublime)
- Simple to author (INI format)
- Version-control-friendly

There is no EditorConfig equivalent for semantic or naming conventions.

### SchemaStore.org

SchemaStore is a registry of JSON Schema files for configuration file formats. It serves over 1 TB of schema files per day and is integrated directly into VS Code, JetBrains IDEs, and other editors.

**Catalog format**: A `catalog.json` mapping file patterns to schema URLs:
```json
{
  "name": "Prettier",
  "description": "Prettier configuration",
  "fileMatch": [".prettierrc", ".prettierrc.json"],
  "url": "https://json.schemastore.org/prettierrc.json"
}
```

**Significance**: Any tool that publishes a JSON Schema to SchemaStore gets automatic IDE support for free — autocomplete, validation, tooltips. Our profile schema should be registered here.

### Semgrep Rules (YAML)

Semgrep is a static analysis tool that uses declarative YAML rules to match code patterns. It is noteworthy as a tool-agnostic way to express code conventions as checkable patterns.

**Rule schema**:
```yaml
rules:
  - id: no-nested-ternaries
    pattern: $A ? ($B ? $C : $D) : $E
    message: |
      Nested ternaries reduce readability.
      Refactor to if-else statements.
    severity: WARNING
    languages: [javascript, typescript]
    metadata:
      category: style
      technology: [javascript]
    fix: "if ($A) { $B ? $C : $D } else { $E }"
```

**Key fields**:
- `id`: Unique slug
- `pattern` / `patterns` / `pattern-either`: AST pattern matching with metavariables (`$X`)
- `message`: Human-readable explanation
- `severity`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
- `languages`: Supported language list
- `metadata`: Open key-value store for categorization (category, cwe, owasp, technology)
- `fix`: Auto-fix replacement (simple search-and-replace only)

**What it can express**: Syntactic patterns across multiple languages. Conditional pattern matching (AND/OR/NOT logic). Cross-file analysis (`interfile: true`). Simple auto-fix replacements.

**What it cannot express**: Type-level analysis, control-flow reasoning, statistical patterns, confidence levels, or prose-only conventions.

**Significance for our schema**: Semgrep rules are a compelling format for expressing the machine-checkable portion of style conventions in a language-agnostic way. A future version of our tool could represent checkable conventions as Semgrep rules alongside the profile JSON.

### OpenRewrite Recipes (YAML)

OpenRewrite is a code transformation framework for Java and other JVM languages. Its YAML recipe format is notable as a declarative specification for code style migration.

**Recipe schema**:
```yaml
type: specs.openrewrite.org/v1beta/recipe
name: com.example.UseGuardClauses
displayName: Prefer guard clauses over nested conditionals
description: Transforms deeply nested if-else blocks into guard clause patterns.
tags:
  - style
  - readability
recipeList:
  - org.openrewrite.java.cleanup.InvertConditionToGuardClause:
      maxDepth: 3
  - org.openrewrite.java.format.AutoFormat
```

**Key concepts**:
- **Composition**: Recipes compose other recipes via `recipeList`
- **Preconditions**: Filter which files a recipe applies to
- **Configuration**: Options passed as nested YAML properties
- **Versioned type**: `specs.openrewrite.org/v1beta/recipe` provides schema versioning

**Significance for our schema**: OpenRewrite shows how higher-level style migrations (not just lint checks) can be specified declaratively. The composition pattern (recipes calling recipes) is a model for how our exported tool configs could compose: our profile's `patterns.preferGuardClauses` rule could generate an OpenRewrite recipe plus an ESLint rule plus a Ruff rule, each targeting the same underlying convention in their respective languages.

---

## 4. Style Representation in Other Domains

### W3C Design Tokens Format (DTCG)

**What it is**: A community-group specification (now stable as of 2025.10) for representing design decisions as machine-readable tokens. Adopted by Figma, Sketch, Style Dictionary, and others.

**JSON schema**:
```json
{
  "colors": {
    "$type": "color",
    "primary": {
      "$value": { "colorSpace": "srgb", "components": [0.2, 0.4, 0.8], "alpha": 1 },
      "$description": "Brand primary color, used for CTAs and links"
    },
    "text-on-primary": {
      "$value": "{colors.primary}",
      "$description": "References the primary color"
    }
  }
}
```

**Key patterns**:
- `$type`: Classifies the token (color, dimension, typography, etc.)
- `$value`: The actual token data
- `$description`: Human-readable explanation
- `$deprecated`: Boolean or string for deprecation
- `$extensions`: Vendor-specific data under reverse-domain keys
- **Grouping**: Objects without `$value` are groups, enabling hierarchy
- **Aliases**: `{path.to.token}` reference syntax for token relationships

**What it can represent**: Design decisions with full type information, human descriptions, deprecation status, and cross-references between tokens.

**Lessons for our schema**: The DTCG format solves a strikingly similar problem to ours: representing decisions (style decisions vs. design decisions) in a structured, machine-readable, tool-agnostic way that can be consumed by multiple tools. Several patterns are directly borrowable:
- `$description` as a first-class schema field (we have `description`)
- `$deprecated` with a reason string (useful when the user wants to mark a previously-detected pattern as explicitly abandoned)
- `$extensions` for tool-specific metadata (our profile could use an `extensions` field for future tool-specific data without breaking the core schema)
- Hierarchical grouping via nesting (our `naming.variables`, `naming.functions` etc. already follow this)
- The `{path.to.token}` alias/reference pattern is worth considering for cross-references in our profile (e.g., a `formatting` rule that references the same line length used in `structure`)

---

### Writing Style Guides (AP, Chicago, APA, MLA)

**What they are**: Authoritative prose documents governing language use in journalism (AP), academic publishing (Chicago, APA, MLA), and other domains.

**Structure**: Topic-based entries in alphabetical reference format (AP) or chapter-based (Chicago). Rules cover punctuation, capitalization, number formatting, abbreviation, citation format, and tone.

**Machine-readable**: None of the major writing style guides have machine-readable specifications. Some rules (serial comma usage, number spelling, date formats) can be enforced by grammar checkers like ProWritingAid or Grammarly, but these tools do not expose the style guide as a schema.

**Relevant patterns**:
- AP and Chicago cover the same domain (English writing) but make opposite choices on key rules (serial comma, number formatting). This demonstrates that style guides for the same domain legitimately disagree — there is no single correct style, only consistent style.
- Chicago distinguishes "prescriptive rules" (must follow) from "preferred usage" (recommended). This maps to our `strength: "strong" | "moderate" | "weak"` pattern from the design doc's `patterns` section.
- Style guides are maintained through editions (AP Stylebook updates annually; Chicago is now in its 18th edition). The versioning and evolution of style guides maps to our `schemaVersion` and migration strategy.

**Lessons for our schema**:
- The existence of multiple legitimate style guides for the same domain validates our design: each developer's profile is their own AP or Chicago, equally valid and internally consistent.
- The "prescriptive vs. preferred" distinction maps to our `strength` field in pattern rules and `confidence` score in convention rules.
- Style guides are authored, not inferred — but our tool inverts this by inferring first and having the author ratify.

---

### Brand Guidelines and Design Systems

**What they are**: Documents specifying visual and communication rules for a brand. They cover typography, color, spacing, logo usage, voice and tone, and component patterns.

**Structure**: Modern brand guidelines are often expressed as a combination of:
1. A design system (Figma, Storybook) capturing visual tokens and components
2. A written document capturing usage rules, rationale, and examples
3. Machine-readable tokens (using DTCG format) for code consumption

**Naming conventions in design tokens**: Systems like Google Material, Salesforce Lightning, and IBM Carbon use hierarchical naming schemes — often Category > Type > Item > State (CTI). Example: `color-background-button-primary-hover`.

**Lessons for our schema**:
- The Category > Type > Item hierarchy maps to our top-level categories (`naming`, `formatting`) > subcategories (`variables`, `functions`) > values (`camelCase`).
- The "voice and tone" section of brand guidelines — covering how you communicate, not just what you communicate — has no analog in linter configs but is exactly what our `documentation` and higher-level `patterns` categories are trying to capture.
- Brand guidelines distinguish between "brand-required" elements and "brand-flexible" elements. Our `confidence` score serves a similar purpose: high-confidence conventions are brand-required; low-confidence ones are brand-flexible.

---

## 5. Rule Description Patterns in Linter Ecosystems

### Clippy (Rust)

Clippy has one of the most thoroughly documented lint ecosystems. Each of its 800+ lints has a structured entry containing:

- **What it does**: One-sentence description
- **Why restrict/is this bad**: Rationale explaining the problem
- **Known problems**: Honest acknowledgment of false positives and limitations
- **Example**: Problematic code
- **Suggested fix**: Recommended alternative
- **Configuration options**: Customizable parameters with defaults
- **Applicability level**: `machine-applicable` | `maybe-incorrect` | `unspecified` | `has-placeholders`
- **Version introduced**: When the lint was added
- **Past names**: Previous identifiers if renamed

**Lint categories** with default levels:
- `correctness` (deny) — Outright wrong code
- `style` (warn) — Unconventional patterns
- `complexity` (warn) — Unnecessarily complex code
- `performance` (warn) — Inefficient patterns
- `pedantic` (allow) — Strict, opinionated suggestions
- `nursery` (allow) — Experimental lints
- `restriction` (allow) — Deliberately non-default
- `suspicious` (warn) — Potentially buggy patterns
- `cargo` (allow) — Cargo.toml checks

**The applicability level** is particularly notable. It distinguishes between:
- `machine-applicable`: Safe to apply automatically
- `maybe-incorrect`: Suggested fix might not be right
- `has-placeholders`: Fix requires human input
- `unspecified`: Unknown auto-fix safety

**Lessons for our schema**:
- Clippy's category taxonomy (style, complexity, performance, correctness) maps well to our categories plus adds a quality dimension we don't currently have.
- The applicability level concept maps to our `fixable` flag — but Clippy's four-level system is more nuanced than binary. Our schema could benefit from: `"safe"` (auto-apply) | `"maybe-incorrect"` (suggest only) | `"requires-input"` (interactive) | `"not-fixable"`.
- The "known problems / false positives" section is valuable metadata. Our profile could track known exceptions to avoid false positives in specific contexts.
- The "past names" field for renamed lints maps to our migration strategy for schema evolution.

### ESLint Rule Pages (Pattern Analysis)

As described in section 2, individual ESLint rule documentation pages have a consistent structure:

1. **Page header**: Rule name, badges (recommended/fixable/hasSuggestions/frozen), version
2. **Rule Details**: What the rule detects and why
3. **Examples**: Incorrect code → Correct code pairs (with playground links)
4. **Options**: Each option documented with: purpose, values, examples
5. **When Not To Use It**: Legitimate cases for disabling
6. **Related Rules**: Cross-references

This structure is consistent across 200+ rules, enabling the documentation to be generated from rule metadata. The ESLint team uses `eslint-doc-generator` to auto-generate docs from rule metadata.

**Lessons for our schema**:
- Our profile's `examples` field structure should mirror the Incorrect/Correct pair pattern.
- The "When Not To Use" concept maps to our anti-patterns and acknowledged exceptions.
- The generated documentation pattern (metadata → docs) is exactly what we want: our profile schema should be rich enough to generate human-readable style guides automatically (`code-style export --format markdown`).

---

## 6. Cross-Cutting Observations and Synthesis

### What Existing Formats Can Represent Well

| Capability | EditorConfig | ESLint | Prettier | Ruff | Semgrep |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Whitespace/indentation | ✓ | ✓ | ✓ | ✓ | — |
| Naming conventions | — | ✓ | — | Partial | ✓ |
| Import ordering | — | ✓ | — | ✓ | — |
| Code structure patterns | — | ✓ | — | Partial | ✓ |
| Documentation style | — | ✓ | — | ✓ | — |
| Error handling patterns | — | Partial | — | Partial | ✓ |
| Higher-level patterns | — | — | — | — | Partial |
| Confidence/strength | — | — | — | — | — |
| Personal provenance | — | — | — | — | — |
| Cross-language consistency | — | — | — | — | ✓ |
| Prose rationale | — | Partial | — | — | ✓ |
| Auto-fix classification | — | ✓ | — | ✓ | Partial |

**No existing format can represent**: confidence scores, personal provenance (examples from the developer's own code), cross-language style consistency for personal style, or the distinction between a developer's deliberate choice and an accidental pattern.

### The Pattern of "Prose + Config" as Twin Artifacts

Every major style guide follows the same pattern: a prose document (the guide) paired with a machine-readable config (the linter config). These are maintained separately and can drift. Our tool collapses this: the profile JSON is both the machine-readable config and the source of truth for the prose guide (generated via `export --format markdown`). This is architecturally superior to the status quo.

### Severity / Strength Modeling

Different tools model rule strength differently:

| Tool | Levels |
|------|--------|
| ESLint | off / warn / error |
| Biome | off / info / warn / error |
| Stylelint | warning / error |
| Clippy | allow / warn / deny |
| Our profile (current) | strength: weak / moderate / strong (patterns only) |
| Our profile (current) | confidence: 0.0–1.0 (all rules) |

**Recommendation**: Our schema's `confidence` score is more expressive than any binary or ternary severity level. However, for the linter output, we should map to standard severity levels (warn/error) based on confidence thresholds. A convention with `confidence >= 0.85` is an error; `0.60–0.85` is a warning; below `0.60` is info or suppressed. These thresholds should be user-configurable.

### Fixability Classification

The Clippy `applicability` level is the most nuanced fixability model:
- `machine-applicable` → safe to auto-apply
- `maybe-incorrect` → suggest but require confirmation
- `has-placeholders` → present interactively
- `unspecified` → no auto-fix

Our current design table already captures this implicitly (auto-fixable? Yes/Partial/No). We should formalize this in the schema as a `fixability` field per rule type with these four values.

### Schema Versioning

Multiple tools handle schema evolution differently:
- ESLint: Major versions with migration guides
- Ruff: `preview = true` flag for unstable features
- OpenRewrite: `type: specs.openrewrite.org/v1beta/recipe` (versioned type field)
- DTCG: Spec version in the document URL

Our design already includes `schemaVersion: "1.0.0"`. OpenRewrite's `type` field pattern is worth considering: a `$schema` URL pointing to our versioned schema (for SchemaStore registration) plus a `schemaVersion` field for migration logic.

### The Taxonomy Gap: "Higher-Level Patterns"

The most striking gap in all existing tools is the inability to represent higher-level architectural preferences — things like "prefer composition over inheritance," "favor pure functions," "use guard clauses." These exist only as:
- Prose in style guides (PEP 8 Programming Recommendations, Google's JS guide)
- Pedantic/restriction lints in Clippy
- Semgrep rules (if someone writes them)

Our `patterns` category in the profile is novel in having a structured representation for these. The challenge is that they are not statically checkable — they require either AI evaluation or statistical inference over AST metrics. Our design correctly routes these through the AI enrichment stage.

---

## 7. Key Takeaways for the Profile Schema

### What to Adopt Directly

1. **`$schema` URL** (from Biome/DTCG): Add a `$schema` field pointing to our versioned JSON Schema. Register with SchemaStore for IDE support.

2. **Fixability classification** (from Clippy/ESLint): Formalize `fixability: "safe" | "maybe-incorrect" | "requires-input" | "not-fixable"` on each rule type definition.

3. **`$description` + `$deprecated`** (from DTCG): Our existing `description` field is correct; add a `deprecated: true | "reason string"` field for rules the user wants to stop following.

4. **`extensions` field** (from DTCG): Add an `extensions` object for tool-specific metadata (ESLint rule config, Ruff rule mapping, etc.) without polluting the core schema.

5. **Severity thresholds** (from multiple tools): Document explicitly how `confidence` maps to linter severity levels, and expose thresholds as configurable.

6. **Per-file overrides** (from Ruff/ESLint/Biome): The profile should support glob-scoped overrides. Tests, scripts, and generated code often legitimately deviate from personal style.

7. **Cross-references** (from DTCG aliases): Rules that reference each other (e.g., line length used in both `formatting` and `structure`) could use a reference syntax.

### What to Avoid

1. **Flat key-value config** (Prettier's model): Too limited for our expressive needs. Our nested category structure is correct.

2. **Code-as-config** (ESLint's flat config): JavaScript objects as config are powerful but not portable or serializable. JSON/JSONC is the right choice for our profile.

3. **Separate prose + config** (every major style guide): The whole point of our tool is to unify these. The profile IS the source of truth; markdown is generated from it.

4. **Fixed rule codes** (Ruff's `E501`, ESLint's `no-unused-vars`): Our conventions are named by category + sub-category, not by opaque codes. Human-readable keys are better for a personal profile.

### Open Questions This Research Surfaces

1. **Should the profile schema be self-describing enough to generate Semgrep rules?** Semgrep's pattern language is powerful and language-agnostic. If we can map our `naming.variables.convention: "camelCase"` to a Semgrep pattern, we get a separate, standalone enforcement artifact.

2. **Should we adopt DTCG-style `{path.to.value}` references** for cross-category consistency (e.g., line length referenced in both formatting and structure rules)?

3. **How do we represent "I know I sometimes do X but I prefer Y"?** No existing tool has a concept analogous to our `antiPatterns.acknowledged` — this is novel and we should think carefully about its schema representation.

4. **What is the right granularity for per-file overrides?** Ruff, ESLint, and Biome all support glob-based overrides. Should our profile also support them, or is language-level granularity (`languages/typescript.json`) sufficient?

---

## Sources

- [ESLint Custom Rules Documentation](https://eslint.org/docs/latest/extend/custom-rules)
- [ESLint Configuration Files (Flat Config)](https://eslint.org/docs/latest/use/configure/configuration-files)
- [ESLint no-unused-vars Rule Page](https://eslint.org/docs/latest/rules/no-unused-vars)
- [EditorConfig Specification](https://spec.editorconfig.org/)
- [Prettier Options Documentation](https://prettier.io/docs/options)
- [Ruff Configuration](https://docs.astral.sh/ruff/configuration/)
- [Ruff Settings Schema](https://docs.astral.sh/ruff/settings/)
- [Black Configuration](https://black.readthedocs.io/en/stable/usage_and_configuration/the_basics.html)
- [Stylelint Configuration](https://stylelint.io/user-guide/configure/)
- [Biome Configuration Reference](https://biomejs.dev/reference/configuration/)
- [PEP 8 — Style Guide for Python Code](https://peps.python.org/pep-0008/)
- [Clippy Lints Catalog](https://rust-lang.github.io/rust-clippy/master/index.html)
- [Semgrep Rule Syntax](https://semgrep.dev/docs/writing-rules/rule-syntax)
- [OpenRewrite Declarative YAML Format](https://docs.openrewrite.org/reference/yaml-format-reference)
- [W3C Design Tokens Format Module](https://www.designtokens.org/tr/drafts/format/)
- [SchemaStore.org](https://www.schemastore.org/)
- [StandardJS Rules](https://github.com/standard/standard/blob/master/RULES.md)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
- [Naturalize: Learning Natural Coding Conventions (Allamanis et al., 2014)](https://arxiv.org/abs/1402.4182)
