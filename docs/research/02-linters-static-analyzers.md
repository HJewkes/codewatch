# Linters and Static Analyzers for Style Analysis

**Research date:** 2026-02-27
**Scope:** Tools applicable to detecting and enforcing coding style conventions in TypeScript and Python codebases.

---

## Table of Contents

1. [TypeScript / JavaScript Tools](#1-typescript--javascript-tools)
   - 1.1 ESLint Core and Built-in Rules
   - 1.2 @typescript-eslint
   - 1.3 ESLint Plugin Ecosystem
   - 1.4 ts-morph (TypeScript Compiler API Wrapper)
   - 1.5 TypeScript Compiler API (Raw)
   - 1.6 Knip (Dead Code and Unused Exports)
   - 1.7 dependency-cruiser (Architecture Enforcement)
2. [Python Tools](#2-python-tools)
   - 2.1 Ruff
   - 2.2 Pylint
   - 2.3 Flake8 and Plugins
   - 2.4 wemake-python-styleguide
   - 2.5 Radon (Complexity Metrics)
   - 2.6 Python ast Module
   - 2.7 LibCST (Concrete Syntax Tree)
3. [Language-Agnostic Tools](#3-language-agnostic-tools)
   - 3.1 Tree-sitter
   - 3.2 Semgrep
   - 3.3 SonarQube / SonarCloud
4. [Code Complexity and Quality Tools](#4-code-complexity-and-quality-tools)
   - 4.1 ESLint Built-in Complexity Rules
   - 4.2 Lizard
   - 4.3 Radon (see also §2.5)
5. [Integration Summary](#5-integration-summary)
6. [Sources](#6-sources)

---

## 1. TypeScript / JavaScript Tools

### 1.1 ESLint Core and Built-in Rules

**What it detects:** ESLint ships with a large set of built-in rules covering both correctness and style. For style analysis specifically, the relevant built-in rules include:

| Rule | What it enforces |
|------|-----------------|
| `complexity` | Cyclomatic complexity ceiling (default 20, configurable) |
| `max-depth` | Maximum nesting depth for blocks |
| `max-lines` | Maximum lines per file |
| `max-lines-per-function` | Maximum lines per function |
| `max-params` | Maximum parameter count per function |
| `max-statements` | Maximum statement count per function |
| `max-nested-callbacks` | Maximum callback nesting depth |
| `no-var` | Enforces `const`/`let` over `var` |
| `prefer-const` | Requires `const` when variable is never reassigned |
| `eqeqeq` | Requires strict equality operators |
| `consistent-return` | Enforces consistent return behavior |
| `curly` | Requires braces for all control statements |

**Configurable:** Yes, all rules accept options. Most style rules accept numeric thresholds.
**Auto-fixable:** Some (e.g., `prefer-const`, `no-var`); structural rules like `max-lines` are not.
**Integration:** Standard ESLint config (`eslint.config.js` flat config, ESLint v9+). Runs in CI via `eslint .` or as part of editor plugins.

---

### 1.2 @typescript-eslint

The `@typescript-eslint` project (typescript-eslint.io) provides a TypeScript parser and over 100 TypeScript-specific rules. As of 2025, ESLint v9 has native TypeScript syntax support in several core rules, but `@typescript-eslint` remains the primary source of type-aware linting.

**Key style-relevant rules:**

| Rule | What it enforces | Type-aware |
|------|-----------------|------------|
| `@typescript-eslint/naming-convention` | Configurable naming patterns for variables, functions, classes, interfaces, enums, type aliases, generics, parameters, properties. Supports `PascalCase`, `camelCase`, `UPPER_CASE`, `snake_case`, regex patterns, and decorator-based modifiers. | No |
| `@typescript-eslint/explicit-function-return-type` | Requires explicit return type annotations on functions | No |
| `@typescript-eslint/explicit-module-boundary-types` | Requires return types on exported functions | No |
| `@typescript-eslint/no-explicit-any` | Disallows `any` type | No |
| `@typescript-eslint/consistent-type-imports` | Enforces `import type` syntax for type-only imports | No |
| `@typescript-eslint/consistent-type-exports` | Enforces `export type` for type-only exports | Yes |
| `@typescript-eslint/consistent-type-definitions` | Enforces `interface` or `type` alias uniformly | No |
| `@typescript-eslint/array-type` | Enforces `T[]` vs `Array<T>` style | No |
| `@typescript-eslint/prefer-readonly` | Requires `readonly` on class properties that are never reassigned | Yes |
| `@typescript-eslint/no-unnecessary-type-assertion` | Removes unnecessary type casts | Yes |
| `@typescript-eslint/prefer-nullish-coalescing` | Prefers `??` over `\|\|` for nullish checks | Yes |
| `@typescript-eslint/prefer-optional-chain` | Prefers optional chaining over explicit checks | Yes |
| `@typescript-eslint/member-ordering` | Enforces order of class members (fields, constructors, methods, decorators) | No |
| `@typescript-eslint/no-shadow` | Disallows variable shadowing (TypeScript-aware version) | No |

**Configurable:** Yes, all rules accept detailed options. `naming-convention` is particularly granular — it can target specific selector types (variable, function, parameter, typeAlias, enum, enumMember, interface, etc.) with distinct casing and affix rules.
**Auto-fixable:** Many; `consistent-type-imports`, `array-type`, `prefer-nullish-coalescing` etc. are auto-fixable.
**Integration:** Drop-in with ESLint. Type-aware rules require a `tsconfig.json` and `parserOptions.project` in config.

**Shared configs available:**
- `recommended` — correctness, no type info needed
- `recommended-type-checked` — recommended + type-aware rules
- `strict` — opinionated correctness rules
- `stylistic` — conciseness and consistency rules
- `stylistic-type-checked` — stylistic + type-aware

---

### 1.3 ESLint Plugin Ecosystem

#### eslint-plugin-import / eslint-plugin-import-x

`eslint-plugin-import` (github.com/import-js/eslint-plugin-import) validates import/export statements. `eslint-plugin-import-x` is a maintained fork with flat config support and performance improvements.

**Style-relevant rules:**

| Rule | What it enforces |
|------|-----------------|
| `import/order` | Enforces import group ordering (builtin, external, internal, parent, sibling, index) with blank line separators |
| `import/no-duplicates` | Merges duplicate import statements from same module |
| `import/no-cycle` | Detects circular dependencies |
| `import/no-unresolved` | Validates all import paths resolve |
| `import/extensions` | Enforces or disallows file extensions in import paths |
| `import/no-default-export` | Disallows default exports (enforces named-only) |
| `import/prefer-default-export` | Requires default export when single export exists |
| `import/no-extraneous-dependencies` | Disallows imports of packages not in package.json |
| `import/first` | Requires all imports to appear before other statements |
| `import/newline-after-import` | Requires blank line after the last import |
| `import/no-named-as-default` | Warns when using a named export as a default import |

**Configurable:** Yes. `import/order` accepts group arrays, `pathGroups`, and `alphabetize` options.
**Auto-fixable:** `import/order`, `import/no-duplicates`, `import/first`, `import/newline-after-import` are fixable.
**Integration:** Standard ESLint plugin.

#### eslint-plugin-perfectionist

(perfectionist.dev) — Dedicated to sorting and ordering, all rules are auto-fixable.

| Rule | What it enforces |
|------|-----------------|
| `perfectionist/sort-imports` | Sorts and groups import statements with granular control |
| `perfectionist/sort-named-imports` | Sorts named import specifiers alphabetically |
| `perfectionist/sort-exports` | Sorts export statements |
| `perfectionist/sort-objects` | Sorts object keys |
| `perfectionist/sort-interfaces` | Sorts TypeScript interface members |
| `perfectionist/sort-types` | Sorts TypeScript type members |
| `perfectionist/sort-enums` | Sorts enum members |
| `perfectionist/sort-array-includes` | Sorts elements in `.includes()` calls |
| `perfectionist/sort-jsx-props` | Sorts JSX attributes |
| `perfectionist/sort-union-types` | Sorts union type members |

**Configurable:** Yes, each rule accepts `type` (alphabetical, natural, line-length), `order` (asc/desc), and grouping options.
**Auto-fixable:** All rules.
**Integration:** Standard ESLint plugin. Requires ESLint >=9.20.0 with flat config.

#### eslint-plugin-unicorn

(github.com/sindresorhus/eslint-plugin-unicorn) — 100+ rules enforcing modern, idiomatic JavaScript/TypeScript patterns.

**Style-relevant rules (selection):**

| Rule | What it enforces |
|------|-----------------|
| `unicorn/filename-case` | Enforces filename casing: `kebabCase`, `camelCase`, `pascalCase`, `snakeCase`. Supports multiple allowed cases and ignore patterns. |
| `unicorn/prevent-abbreviations` | Bans abbreviated variable names; replacements are configurable. |
| `unicorn/no-array-for-each` | Prefers `for...of` over `.forEach()` |
| `unicorn/prefer-ternary` | Simplifies if/else into ternaries |
| `unicorn/no-negated-condition` | Prefers non-negated conditions in if/else |
| `unicorn/prefer-module` | Enforces ES module syntax over CommonJS |
| `unicorn/no-anonymous-default-export` | Disallows anonymous default exports |
| `unicorn/prefer-top-level-await` | Prefers top-level await over async IIFE |
| `unicorn/import-style` | Enforces specific import styles (named, default, namespace) per module |
| `unicorn/consistent-function-scoping` | Moves functions to outermost scope when closure isn't needed |
| `unicorn/no-useless-undefined` | Removes unnecessary `undefined` in certain positions |

**Configurable:** Yes; `filename-case` accepts `cases` object, `prevent-abbreviations` accepts a `replacements` map.
**Auto-fixable:** Most rules.
**Integration:** Standard ESLint plugin. Requires flat config (ESLint v9).

#### eslint-plugin-jsdoc

(github.com/gajus/eslint-plugin-jsdoc) — Lints JSDoc comment blocks.

| Rule | What it enforces |
|------|-----------------|
| `jsdoc/require-jsdoc` | Requires JSDoc on functions, classes, methods |
| `jsdoc/require-param` | Requires `@param` for each function parameter |
| `jsdoc/require-returns` | Requires `@returns` when a function returns a value |
| `jsdoc/require-description` | Requires description text in JSDoc |
| `jsdoc/check-types` | Validates JSDoc type expressions |
| `jsdoc/check-param-names` | Validates `@param` names match actual params |
| `jsdoc/check-tag-names` | Validates tag names are recognized |
| `jsdoc/multiline-blocks` | Enforces block comment style (single vs multi-line) |
| `jsdoc/imports-as-dependencies` | Checks that `import()` in JSDoc types are in package.json |

**Configurable:** Yes. Presets: `flat/recommended`, `flat/recommended-error`, `flat/recommended-typescript`.
**Auto-fixable:** Partial; description-related rules are not fixable, formatting rules are.
**Integration:** Standard ESLint plugin. TypeScript-mode disables redundant type checks.

#### eslint-plugin-sonarjs

(github.com/SonarSource/eslint-plugin-sonarjs) — Exposes SonarJS rules to ESLint users. Focuses on code smells and bugs.

**Style/quality relevant rules:**

| Rule | What it enforces |
|------|-----------------|
| `sonarjs/cognitive-complexity` | Enforces a cognitive complexity ceiling (stricter than cyclomatic) |
| `sonarjs/no-duplicate-string` | Flags repeated string literals (magic strings) |
| `sonarjs/no-identical-functions` | Detects copy-pasted function bodies |
| `sonarjs/no-nested-template-literals` | Flags nested template literal expressions |
| `sonarjs/prefer-single-boolean-return` | Simplifies boolean return patterns |
| `sonarjs/no-redundant-boolean` | Removes unnecessary boolean comparisons |
| `sonarjs/no-small-switch` | Warns when switch has fewer than 3 cases (should be if/else) |

**Configurable:** Yes; `cognitive-complexity` accepts a threshold.
**Auto-fixable:** Partial.
**Integration:** Standard ESLint plugin.

#### eslint-plugin-boundaries

(github.com/javierbrea/eslint-plugin-boundaries) — Enforces architectural boundaries between modules.

**What it detects:**
- Import violations between defined architectural zones (e.g., `feature` layer cannot import from `ui` layer)
- File/folder element types are declared via glob patterns
- Checks `import`, `require`, `export`, and dynamic imports

**Rules:**
- `boundaries/element-types` — controls which element types can import from which other types
- `boundaries/external` — controls which external packages each element type may use
- `boundaries/no-private` — enforces that internal files within an element are not accessed from outside

**Configurable:** Highly configurable. Element types, patterns, and dependency rules are all defined in the ESLint config.
**Auto-fixable:** No.
**Integration:** Standard ESLint plugin. Not a replacement for `eslint-plugin-import` — both are recommended together.

---

### 1.4 ts-morph (TypeScript Compiler API Wrapper)

(ts-morph.com, github.com/dsherret/ts-morph)

ts-morph is not a linter — it is a library for programmatic TypeScript AST access and manipulation. It wraps the TypeScript Compiler API with a more ergonomic object-oriented interface.

**What it can do for style analysis:**
- Navigate and query any node in a TypeScript AST: functions, classes, interfaces, type aliases, decorators, etc.
- Access full type information (types, symbols, signatures) via the embedded `TypeChecker`
- Detect style patterns that no ESLint plugin can reach — for example:
  - Functions whose return type is `any` after inference
  - Classes with more than N public methods
  - Files where exported identifiers don't follow naming conventions relative to the file name
  - Type aliases that shadow built-in types
  - Generic type parameters that don't follow a naming scheme
- Drive codemods: programmatically rewrite code to conform to conventions

**What it cannot do out-of-the-box:**
- It produces no warnings or errors on its own; all analysis logic must be written in custom code
- Not a CLI tool; it is a library requiring a script or tool wrapper

**Integration approach:** Write a Node.js script using ts-morph that walks the project, applies custom checks, and emits structured output (JSON, or human-readable). Can be run as a pre-commit hook or CI step alongside ESLint.

**Relevant for our pipeline:** Custom checks that ESLint plugins cannot express — particularly checks requiring cross-file type resolution or checks on AST structure that ESLint's visitor API makes awkward.

---

### 1.5 TypeScript Compiler API (Raw)

(github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

The underlying API that ts-morph wraps. Lower-level but more complete.

**Key capabilities for style detection:**
- `ts.createProgram()` — creates a full compilation unit for a project
- `TypeChecker` — resolves types, symbols, and signatures across the whole program
- `SourceFile` AST traversal via `ts.forEachChild` and `ts.visitEachChild`
- `ts.getDiagnostics()` — retrieves type errors programmatically
- Custom transformer plugins via `ts.TransformationContext` — can be used to detect and report style violations during compilation

**Use case vs ts-morph:** Prefer ts-morph for custom tooling (much more ergonomic API). The raw Compiler API is relevant when building compiler plugins or integrating directly into the TypeScript build pipeline.

**Auto-fixable:** Yes, via transformers, but this requires careful AST manipulation.

---

### 1.6 Knip (Dead Code and Unused Exports)

(knip.dev, github.com/webpro-nl/knip)

Knip analyzes the full module graph of a TypeScript/JavaScript project to detect unused files, exports, and npm dependencies.

**What it detects:**
- Unused files (not reachable from any entry point)
- Unused exports (exported identifiers imported nowhere)
- Unused class members, enum members, type aliases
- Duplicate exports
- Unused npm dependencies and devDependencies

**How it works:** Starts from configured entry points, follows all imports to build a module graph, then reports everything not included in that graph.

**Configurable:** Yes. Entry points, ignore patterns, and plugin configurations are defined in `knip.json` or `package.json`.
**Auto-fixable:** `--fix` removes unused items from `package.json` dependencies; does not auto-fix code.
**Integration:** Run as a separate CLI step (`knip`) in CI. Not an ESLint plugin.

**Relevant for our pipeline:** Detecting dead code and naming-related issues (exports whose names were changed but old names left as aliases).

---

### 1.7 dependency-cruiser (Architecture Enforcement)

(github.com/sverweij/dependency-cruiser)

Validates and visualizes module dependencies in JavaScript/TypeScript projects.

**What it detects:**
- Circular dependencies
- Dependency violations based on custom rules (e.g., layer A may not import from layer B)
- Orphaned modules (not imported by anything)
- Dependencies on deprecated modules
- Violations of "shared" module contracts (a module declared as shared but only used by one consumer)

**How rules work:** Rules are written in a `.dependency-cruiser.js` config as objects with `from`, `to`, and `severity` fields. Patterns are regex-based and can match file paths, package names, etc.

**Configurable:** Highly. Supports allows/forbids rule sets, and integrates with various output reporters (text, JSON, HTML, Graphviz dot).
**Auto-fixable:** No. Reports violations; fixing requires manual restructuring.
**Integration:** CLI tool (`depcruise src/`). Can output Checkstyle XML for CI. Also supports `--validate` mode that exits non-zero on violations.

---

## 2. Python Tools

### 2.1 Ruff

(docs.astral.sh/ruff) — The dominant Python linter/formatter as of 2025. Written in Rust, extremely fast. Implements 900+ rules from Flake8, isort, pylint, pyupgrade, and others in a single tool.

**Rule categories relevant to style:**

| Prefix | Source | Style aspects covered |
|--------|--------|-----------------------|
| `E` | pycodestyle | PEP 8 layout: indentation, blank lines, line length, whitespace around operators |
| `W` | pycodestyle | Whitespace warnings: trailing whitespace, blank lines at EOF |
| `N` | pep8-naming | Naming conventions: `ClassName` (PascalCase), `function_name` (snake_case), `CONSTANT` (UPPER_CASE), `_private`, module names, type variable names |
| `D` | pydocstyle | Docstring conventions: presence, format (one-liner vs multi-line), summary line, blank lines around sections. Supports PEP 257, NumPy, and Google conventions. |
| `I` | isort | Import ordering: groups (stdlib, third-party, first-party), alphabetization within groups, blank lines between groups |
| `ANN` | flake8-annotations | Type annotation presence on function arguments and return values |
| `UP` | pyupgrade | Modernization: Python 2/3 compat patterns, deprecated constructs, f-string upgrades |
| `SIM` | flake8-simplify | Simplification: redundant conditions, unnecessary list comprehensions, `contextlib.suppress` patterns |
| `B` | flake8-bugbear | Opinionated style: mutable default arguments, f-strings for concatenation, `assert False` vs `raise` |
| `C90` | mccabe | Cyclomatic complexity (configurable threshold) |
| `TD` | flake8-todos | TODO comment format enforcement |
| `RUF` | Ruff-specific | Ruff's own rules: unused noqa directives, ambiguous variable names, etc. |
| `FA` | flake8-future-annotations | `from __future__ import annotations` enforcement |
| `TCH` | flake8-type-checking | Moving imports into `TYPE_CHECKING` blocks |
| `PT` | flake8-pytest-style | pytest conventions |
| `ERA` | eradicate | Commented-out code detection |
| `PIE` | flake8-pie | Misc improvements: `return` vs `return None`, `pass` in bare `except` |

**Configurable:** Yes. Rules selected via `select`, `ignore`, `extend-select`, `extend-ignore` in `pyproject.toml` or `ruff.toml`. Per-file ignores supported. Line length, docstring convention, and naming patterns are configurable.

**Auto-fixable:** Many rules are fixable (`ruff check --fix`). `I` (isort), `UP`, `SIM`, `B`, `D` (some), `N` (none — naming requires manual fix) are examples.

**Integration:** `ruff check .` and `ruff format .`. Pre-commit hook available (`ruff-pre-commit`). GitHub Actions integration. Output formats: text, JSON, GitHub Annotations, SARIF.

---

### 2.2 Pylint

(pylint.pycqa.org) — Deep static analysis with type inference via astroid. Slower than Ruff but catches subtler issues.

**Message categories:**
- `C` — Convention violations (naming, formatting standards)
- `R` — Refactor suggestions (code smell, design issues)
- `W` — Warnings (Python-specific problems)
- `E` — Errors (probable bugs)
- `F` — Fatal (prevents further analysis)

**Style-relevant checkers:**

| Checker | What it detects |
|---------|----------------|
| `basic` | Naming conventions (configurable regex per identifier type), docstring presence, bad whitespace |
| `format` | Line length, indentation, blank line rules |
| `design` | Too many arguments, too many branches, too many statements, too many instance attributes, too many public methods, too few public methods |
| `similarities` | Code duplication (similar lines across files) |
| `classes` | Method ordering, property/attribute conventions |
| `variables` | Unused variables, undefined variables, variable shadowing |
| `imports` | Import ordering, wildcard imports, cyclic imports |
| `string` | String formatting issues, implicit string concatenation |

**Key `design` checker thresholds (all configurable):**
- `max-args` (default 5)
- `max-attributes` (default 7)
- `max-bool-expr` (default 5)
- `max-branches` (default 12)
- `max-locals` (default 15)
- `max-parents` (default 7)
- `max-public-methods` (default 20)
- `max-returns` (default 6)
- `max-statements` (default 50)
- `min-public-methods` (default 2)

**Custom checkers:** Pylint exposes a first-class API for custom `ASTChecker` plugins. Implementing `visit_<nodetype>` methods on a class registered as a plugin is well-documented and commonly used.

**Configurable:** Highly. `.pylintrc` or `pyproject.toml [tool.pylint]`. Naming patterns per identifier type accepted as regex.
**Auto-fixable:** No. Pylint is analysis-only.
**Integration:** `pylint src/`. JSON output available. Pre-commit hook available. Slower than Ruff; typically run less frequently (e.g., in CI only, not on every save).

---

### 2.3 Flake8 and Plugins

Flake8 is a wrapper around pycodestyle, pyflakes, and mccabe. While Ruff supersedes it for most purposes, Flake8's plugin ecosystem is mature and some plugins are not yet ported to Ruff.

**Core:**
- **pycodestyle** — PEP 8 style (E/W codes); line length, whitespace, blank lines
- **pyflakes** — Logical errors (F codes); unused imports, undefined names
- **mccabe** — Cyclomatic complexity (C90 codes)

**Notable plugins not fully covered by Ruff:**

| Plugin | What it detects |
|--------|----------------|
| `flake8-bugbear` (B) | Pythonic anti-patterns: mutable default args, use of `assert` in production code, overly complex comprehensions |
| `pep8-naming` (N) | Naming conventions enforced via regex patterns per identifier type |
| `flake8-docstrings` (D) | Delegates to pydocstyle; docstring presence and format |
| `flake8-annotations` (ANN) | Missing type annotations |
| `flake8-cognitive-complexity` | Cognitive complexity (a stricter measure than cyclomatic) per function |
| `flake8-comprehensions` (C4) | Unnecessary comprehensions that could be replaced with builtins |
| `flake8-simplify` (SIM) | Pattern simplification suggestions |
| `flake8-import-order` | Import grouping and ordering |
| `flake8-eradicate` (E8) | Commented-out code detection |
| `flake8-type-checking` (TCH) | `TYPE_CHECKING` block enforcement |
| `flake8-pytest-style` (PT) | pytest conventions |
| `flake8-length` | Function length limits |

**Configurable:** Yes, via `.flake8` or `setup.cfg`. Max line length, per-file ignores, plugin-specific settings.
**Auto-fixable:** Flake8 itself does not auto-fix; plugins like `autoflake` and `autopep8` handle fixes.
**Integration:** `flake8 src/`. Pre-commit hook available. Note: Ruff implements most of these rules natively, making Flake8 redundant for new projects.

---

### 2.4 wemake-python-styleguide

(github.com/wemake-services/wemake-python-styleguide) — A Flake8 plugin described as "the strictest and most opinionated Python linter." Adds 100+ violation codes in the `WPS` namespace.

**Style-relevant violations (selection):**

| Code | What it enforces |
|------|-----------------|
| `WPS111` | Too short names (configurable minimum length) |
| `WPS112` | Too long names (configurable maximum length) |
| `WPS120-121` | Name pattern violations (trailing/leading underscores outside conventions) |
| `WPS200` | Module-level complexity: too many cognitive complexity units |
| `WPS201` | Too many imports in a module (default 12) |
| `WPS202` | Too many module members |
| `WPS210` | Too many local variables in a function (default 5) |
| `WPS211` | Too many arguments in a function (default 5) |
| `WPS212` | Too many return statements (default 3) |
| `WPS213` | Too many expressions in a function |
| `WPS214` | Too many methods in a class (default 7) |
| `WPS220` | Too deep nesting (default 4 levels) |
| `WPS221` | Too high Jones complexity (a line-level complexity metric) |
| `WPS222` | Too high cognitive complexity in a function (default 12) |
| `WPS223` | Too many `elif` branches (default 3) |
| `WPS225` | Too many `except` cases |
| `WPS226` | String constant overuse (configurable threshold) |
| `WPS232` | Module average cognitive complexity too high |
| `WPS300` | Local folder imports |
| `WPS301` | Dotted imports |
| `WPS302` | Extra indentation in imports |
| `WPS305` | f-string usage (can be disabled) |
| `WPS400-499` | Best practice violations: magic numbers, nested classes, lambdas in assignments, mutable module constants |
| `WPS500-599` | OOP violations: methods without `self`/`cls`, overridden methods that don't add behavior |
| `WPS600-699` | Complexity inside classes |

**Configurable:** Yes. Each numeric threshold is configurable. Can be used alongside Ruff for the `WPS`-specific rules not yet ported.
**Auto-fixable:** No.
**Integration:** Flake8 plugin; `flake8 --select=WPS`. Note that wemake-python-styleguide is compatible with Ruff as a formatter/runner pair.

---

### 2.5 Radon (Complexity Metrics)

(radon.readthedocs.io, github.com/rubik/radon) — A Python reporting tool computing multiple complexity metrics from source code.

**Metrics computed:**

| Command | Metric | Description |
|---------|--------|-------------|
| `radon cc` | Cyclomatic Complexity (CC) | McCabe's metric; number of independent paths through a function. Grades A (1-5) through F (>25). |
| `radon mi` | Maintainability Index (MI) | Composite score (0-100) from SLOC, CC, and Halstead Volume. Below 25 is considered unmaintainable; Visual Studio uses the same formula. |
| `radon hal` | Halstead Metrics | Volume, Difficulty, Effort, and Estimated Bugs; derived from operator/operand counts. |
| `radon raw` | Raw Metrics | SLOC, logical lines, comment lines, blank lines, comment ratio. |

**Configurable:** Yes. Thresholds for CC grades are configurable. `--min` and `--max` flags filter output.
**Auto-fixable:** No. Reporting only.
**Integration:** CLI tool. Outputs JSON for CI consumption. Can be combined with `xenon` (a Radon-based CI gate tool that exits non-zero when metrics exceed thresholds).

**xenon:** A companion tool to Radon that provides a CI-friendly interface: `xenon --max-absolute B --max-modules A --max-average A src/` exits non-zero if any block exceeds the specified grade.

---

### 2.6 Python `ast` Module

(docs.python.org/3/library/ast.html) — Python's standard library module for parsing source code into an AST.

**What it can do:**
- Parse any `.py` file into a structured AST
- Traverse nodes via `ast.NodeVisitor` (read-only) or `ast.NodeTransformer` (read/write)
- Access all syntactic constructs: functions (`FunctionDef`), classes (`ClassDef`), imports (`Import`, `ImportFrom`), assignments, calls, decorators, etc.
- Detect style patterns programmatically: function length (via `lineno` / `end_lineno`), argument count, missing docstrings (`ast.get_docstring()`), nesting depth via recursive visitor

**Limitations vs LibCST:**
- Does not preserve whitespace, comments, or formatting details (those are stripped in the AST)
- Not suitable for building auto-fixing tools (round-trip fidelity is not guaranteed)
- No built-in output format for linting pipelines

**Use case:** Writing quick, dependency-free custom analysis scripts. Suitable for detecting structural patterns (function length, class method count, import ordering) that need no whitespace awareness.

**Integration:** Import in any Python script. Can be run as a CLI via a thin wrapper. Output JSON or plain text.

---

### 2.7 LibCST (Concrete Syntax Tree)

(libcst.readthedocs.io, github.com/Instagram/LibCST) — A Python CST library maintained by Meta/Instagram. Unlike `ast`, LibCST preserves all formatting details: whitespace, comments, parentheses, trailing commas.

**What makes it different from `ast`:**
- Lossless: parsing and re-serializing produces identical source code
- Preserves comments and all whitespace — usable for building auto-fixing tools
- Provides `CSTVisitor` (read-only) and `CSTTransformer` (read/write) patterns matching the `ast` visitor interface
- Provides type-safe node classes for all Python constructs

**Style analysis capabilities:**
- Detect and enforce comment placement and formatting (not possible with `ast`)
- Detect trailing comma presence/absence in function signatures, import lists, etc.
- Detect string quote style (single vs double)
- Enforce blank line counts around functions and classes (whitespace is part of the CST)
- Build codemods that rewrite code in a style-preserving way

**Codemods framework:** LibCST ships a `libcst.codemod` module for building reusable, testable codemods that transform code while preserving style in unmodified regions.

**Configurable:** As a library, all analysis logic is custom code.
**Auto-fixable:** Yes, via `CSTTransformer`. This is the primary use case — LibCST is the right tool when auto-fix is required for Python style violations.
**Integration:** Python library. Wrap in a CLI script for CI integration. Can be combined with `libcst.codemod.CodemodContext` for project-wide transformations.

**Supports:** Python 3.0 through 3.14 (as of 1.x releases).

---

## 3. Language-Agnostic Tools

### 3.1 Tree-sitter

(tree-sitter.github.io) — An incremental parsing library that can parse any language with an available grammar. Provides a query language for pattern matching against syntax trees.

**Architecture:**
- Grammars are available for TypeScript, JavaScript, Python, and 100+ other languages
- Parsers run in C (with bindings for Python, Node.js, Rust, etc.)
- Incremental: only re-parses changed regions, making it suitable for editor integration
- Error-tolerant: produces a tree even for syntactically invalid input

**Query language:**

Tree-sitter queries use S-expression syntax (similar to Lisp). A query targets node types and captures named subtrees:

```scheme
; Match all function declarations and capture their name
(function_declaration
  name: (identifier) @function.name)

; Match functions whose names do NOT match camelCase (using predicate)
(function_declaration
  name: (identifier) @bad-name
  (#not-match? @bad-name "^[a-z][a-zA-Z0-9]*$"))
```

**Style detection capabilities:**
- Naming convention enforcement: match identifier nodes and apply regex predicates
- Function length: compute line spans from `startPosition` and `endPosition` on matched nodes
- Nesting depth: count ancestor nodes of a given type
- Import ordering: match and sequence import nodes, compare ordering
- Comment presence: check for comment nodes as siblings of specific constructs

**Predicates available:**
- `#match?` / `#not-match?` — regex match on node text
- `#eq?` / `#not-eq?` — exact text match
- `#is?` / `#is-not?` — arbitrary named predicates (language binding handles implementation)

**Limitations:**
- No type information (purely syntactic — no semantic analysis)
- No built-in violation reporter; must wrap in a custom harness
- Rule expressiveness limited to structural patterns visible in the CST; cannot detect cross-file patterns

**Configurable:** Queries are just text files; highly configurable.
**Auto-fixable:** Not built-in; would require writing a replacement transformation alongside the query.
**Integration:** Python binding (`tree-sitter` pip package), Node.js binding (`tree-sitter` npm package). Build a custom CLI that runs queries and reports results.

**Relevant for our pipeline:** Cross-language style checks with a single query mechanism. Particularly useful for detecting structural patterns (naming conventions, nesting, comment placement) in any language without writing separate parsers.

---

### 3.2 Semgrep

(semgrep.dev) — A multi-language static analysis tool using pattern matching with optional dataflow analysis. Supports TypeScript, JavaScript, Python, and 30+ other languages.

**Pattern language features:**

- **Patterns** — match code structurally, not textually. `$VAR = foo($X)` matches any assignment from a call to `foo` regardless of formatting.
- **Ellipsis operator (`...`)** — matches any sequence of code: `foo(..., $BAD, ...)` matches calls to `foo` with `$BAD` appearing anywhere in the arguments.
- **Metavariables** — `$VAR`, `$FUNC`, `$TYPE` capture and can be reused across a pattern to enforce consistency.
- **Pattern-either** — `or` across multiple patterns in a single rule.
- **Pattern-not** — negate a pattern to exclude matches.
- **Focus-metavariable** — report only on a specific captured element.
- **Metavariable-pattern** — apply a sub-pattern to a captured element.
- **Metavariable-regex** — apply a regex predicate to a captured element's text.

**Style enforcement examples:**

```yaml
# Enforce that all exported functions have a JSDoc comment
rules:
  - id: require-jsdoc-on-exports
    languages: [typescript]
    pattern: |
      export function $FUNC(...) { ... }
    pattern-not: |
      /** ... */
      export function $FUNC(...) { ... }
    message: Exported function $FUNC is missing a JSDoc comment.
    severity: WARNING

# Enforce snake_case for Python variables
rules:
  - id: no-camelcase-variables
    languages: [python]
    pattern: $VAR = ...
    metavariable-regex:
      metavariable: $VAR
      regex: '^[a-z]+[A-Z]'  # starts lowercase, contains uppercase (camelCase)
    message: Variable $VAR should use snake_case.
    severity: WARNING
```

**Configurable:** Rules are YAML files. Highly composable. Rulesets can be imported from the Semgrep Registry (public, community-maintained) or written locally.

**Auto-fixable:** Yes. Rules can include a `fix` field that provides a replacement pattern using the same metavariable captures.

**Integration:** CLI (`semgrep --config rules/ src/`). GitHub Actions native integration. SARIF output for GitHub Code Scanning. Pre-commit hook available. Semgrep Cloud provides organization-wide rule management.

**Limitations:**
- No type-level information for TypeScript (syntactic only)
- Regex on metavariables is limited; complex naming conventions may be awkward to express
- Performance degrades on very large codebases with many rules

**Relevant for our pipeline:** Cross-language style rules expressible as structural patterns. Particularly good for enforcing project-specific conventions (required patterns, forbidden patterns, documentation presence) that no off-the-shelf linter rule covers.

---

### 3.3 SonarQube / SonarCloud

(sonarsource.com) — A comprehensive code quality platform with static analysis rules for 40+ languages including TypeScript and Python.

**Capabilities relevant to style:**
- 6,000+ static analysis rules across supported languages
- Cognitive complexity measurement (Sonar's own metric, stricter than cyclomatic)
- Code duplication detection
- Coding standard violations
- Documentation coverage
- Technical debt estimation
- Quality gates: configurable thresholds on metrics (e.g., cognitive complexity > 20 blocks the build)

**Languages:** TypeScript and Python both have extensive rule sets.

**Integration modes:**
- SonarQube Server (self-hosted, free Community Edition)
- SonarCloud (hosted, free for open source)
- SonarQube for IDE (VS Code / IntelliJ extension for real-time feedback)
- CI integration via `sonar-scanner` CLI with GitHub/GitLab/Azure DevOps plugins

**Configurable:** Yes. Rules are enabled/disabled per project via the SonarQube UI or `sonar-project.properties`. Quality gate thresholds are configurable.

**Auto-fixable:** No. Analysis and reporting only. The `eslint-plugin-sonarjs` (see §1.3) brings a subset of Sonar JS/TS rules into ESLint where auto-fixing is possible.

**Trade-offs:** SonarQube adds significant infrastructure overhead for self-hosted use. For a focused style-enforcement pipeline, the `eslint-plugin-sonarjs` subset is often sufficient and avoids the operational burden.

---

## 4. Code Complexity and Quality Tools

### 4.1 ESLint Built-in Complexity Rules

(eslint.org)

ESLint ships all necessary complexity rules without plugins:

| Rule | Metric | Default | Configurable |
|------|--------|---------|--------------|
| `complexity` | Cyclomatic complexity per function | 20 | Yes |
| `max-depth` | Block nesting depth | 4 | Yes |
| `max-lines` | Lines per file | 300 | Yes (also excludes blank/comment lines) |
| `max-lines-per-function` | Lines per function | 50 | Yes (includes/excludes blank/comment lines) |
| `max-params` | Parameters per function | 3 | Yes |
| `max-statements` | Statements per function | 10 | Yes |
| `max-nested-callbacks` | Callback nesting depth | 10 | Yes |
| `max-len` | Maximum line length | 80 | Yes |

All are reportable (non-fixable) by default. **Integration:** Standard ESLint.

---

### 4.2 Lizard

(github.com/terryyin/lizard, pypi.org/project/lizard) — A multi-language complexity analyzer supporting TypeScript, JavaScript, Python, Java, C/C++, Go, Rust, and 10+ more. Written in Python.

**Metrics per function:**
- `nloc` — non-comment lines of code
- `cyclomatic_complexity` (CCN) — McCabe's cyclomatic complexity
- `token_count` — total token count
- `parameter_count` — number of function parameters
- `length` — total lines including comments

**Configurable thresholds:**
- `-C <n>` — warn when CCN exceeds n
- `-L <n>` — warn when function length exceeds n lines
- `-a <n>` — warn when argument count exceeds n
- `-T <field>=<threshold>` — generic threshold on any metric field

**Output formats:**
- Human-readable text
- CSV
- XML / Checkstyle format (for Jenkins integration)
- JSON

**Auto-fixable:** No. Analysis and reporting only.

**Integration:**
```bash
lizard src/ -C 10 -L 50 -a 5 --csv > complexity-report.csv
lizard src/ --xml > checkstyle.xml  # Jenkins-compatible
```

Can be used as a Python library for custom pipeline integration. Pre-commit hook usage documented.

**Relevant for our pipeline:** The key advantage over ESLint/Ruff built-in complexity is language-agnostic enforcement of the same thresholds across TypeScript and Python in a single tool.

---

### 4.3 Radon (Python-specific)

See §2.5 for the full description. Summary for this section:

- Provides richer Python-specific metrics than Lizard (Halstead, Maintainability Index)
- `xenon` wrapper provides CI gate semantics
- Not applicable to TypeScript

---

## 5. Integration Summary

The following table maps style concern categories to the recommended tool(s) for each language:

| Style Concern | TypeScript | Python |
|---------------|-----------|--------|
| Naming conventions | `@typescript-eslint/naming-convention` | Ruff `N` (pep8-naming), Pylint `basic` |
| Import ordering | `eslint-plugin-perfectionist` or `import/order` | Ruff `I` (isort) |
| File naming | `unicorn/filename-case` | Ruff `N999` |
| Documentation presence | `eslint-plugin-jsdoc` | Ruff `D` (pydocstyle) |
| Function length | ESLint `max-lines-per-function`, Lizard | Ruff `C90`, Radon, Lizard, wemake `WPS213` |
| Parameter count | ESLint `max-params`, Lizard | Ruff `PLR0913`, Pylint `max-args`, Lizard |
| Nesting depth | ESLint `max-depth` | wemake `WPS220`, Pylint `max-branches` |
| Cyclomatic complexity | ESLint `complexity`, Lizard, `sonarjs/cognitive-complexity` | Radon, Ruff `C90`, wemake `WPS222` |
| Class structure / member ordering | `@typescript-eslint/member-ordering` | Pylint `classes` checker |
| Type annotations | `@typescript-eslint/explicit-function-return-type` | Ruff `ANN` (flake8-annotations) |
| Dead code / unused exports | Knip | Ruff `F401`, `ERA` |
| Architecture / layer boundaries | `eslint-plugin-boundaries`, dependency-cruiser | (custom, no standard tool) |
| Duplicate / repeated code | `sonarjs/no-identical-functions` | Pylint `similarities`, Ruff (none) |
| Cross-language custom patterns | Semgrep, tree-sitter | Semgrep, tree-sitter |
| AST-based custom analysis | ts-morph, TypeScript Compiler API | Python `ast`, LibCST |
| Auto-fix for structural changes | ts-morph + TypeScript Compiler API | LibCST codemods |

**Pipeline integration pattern:**

1. **Fast feedback loop (pre-commit / editor):** ESLint (with `@typescript-eslint`, `unicorn`, `perfectionist`, `jsdoc`, `import`) + Ruff for Python. Both run in milliseconds.
2. **CI gate (per PR):** ESLint + Ruff + Knip (dead code) + Lizard (cross-language complexity) + Semgrep (custom pattern rules) + dependency-cruiser (architecture).
3. **Deep analysis (periodic / on demand):** Pylint (Python semantic analysis) + Radon/xenon (Python complexity gates) + SonarQube (if infrastructure exists) + custom ts-morph / LibCST scripts for project-specific conventions.

---

## 6. Sources

- [naming-convention | typescript-eslint](https://typescript-eslint.io/rules/naming-convention/)
- [typescript-eslint Rules Overview](https://typescript-eslint.io/rules/)
- [Shared Configs | typescript-eslint](https://typescript-eslint.io/users/configs/)
- [ts-morph Documentation](https://ts-morph.com/)
- [ts-morph GitHub](https://github.com/dsherret/ts-morph)
- [Using the TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [eslint-plugin-import GitHub](https://github.com/import-js/eslint-plugin-import)
- [ESLint Plugin Perfectionist](https://perfectionist.dev/)
- [eslint-plugin-unicorn GitHub](https://github.com/sindresorhus/eslint-plugin-unicorn)
- [eslint-plugin-unicorn filename-case rule](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/filename-case.md)
- [eslint-plugin-jsdoc npm](https://www.npmjs.com/package/eslint-plugin-jsdoc)
- [eslint-plugin-sonarjs GitHub](https://github.com/SonarSource/eslint-plugin-sonarjs)
- [eslint-plugin-boundaries GitHub](https://github.com/javierbrea/eslint-plugin-boundaries)
- [Knip — dead code detection](https://knip.dev/)
- [Knip GitHub](https://github.com/webpro-nl/knip)
- [dependency-cruiser GitHub](https://github.com/sverweij/dependency-cruiser)
- [Ruff Rules](https://docs.astral.sh/ruff/rules/)
- [The Ruff Linter](https://docs.astral.sh/ruff/linter/)
- [Ruff Formatter](https://docs.astral.sh/ruff/formatter/)
- [Pylint Features](https://pylint.pycqa.org/en/latest/user_guide/checkers/features.html)
- [Pylint Custom Checkers](https://pylint.pycqa.org/en/latest/development_guide/how_tos/custom_checkers.html)
- [flake8-bugbear GitHub](https://github.com/PyCQA/flake8-bugbear)
- [flake8-bugbear PyPI](https://pypi.org/project/flake8-bugbear/)
- [wemake-python-styleguide GitHub](https://github.com/wemake-services/wemake-python-styleguide)
- [wemake-python-styleguide Complexity Violations](https://wemake-python-styleguide.readthedocs.io/en/1.0.0/pages/usage/violations/complexity.html)
- [Radon Documentation](https://radon.readthedocs.io/en/latest/)
- [Radon GitHub](https://github.com/rubik/radon)
- [Python ast module](https://docs.python.org/3/library/ast.html)
- [LibCST Documentation](https://libcst.readthedocs.io/)
- [LibCST GitHub](https://github.com/Instagram/LibCST)
- [Tree-sitter Queries](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/index.html)
- [Tree-sitter Predicates and Directives](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html)
- [Semgrep Rule Pattern Syntax](https://semgrep.dev/docs/writing-rules/pattern-syntax)
- [Semgrep Rule Structure](https://semgrep.dev/docs/writing-rules/rule-syntax)
- [Semgrep Rules GitHub](https://github.com/semgrep/semgrep-rules)
- [SonarQube Products](https://www.sonarsource.com/products/sonarqube/)
- [SonarQube TypeScript Analysis](https://www.sonarsource.com/ts/)
- [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity)
- [ESLint max-depth rule](https://eslint.org/docs/latest/rules/max-depth)
- [ESLint max-lines rule](https://eslint.org/docs/latest/rules/max-lines)
- [ESLint max-lines-per-function rule](https://eslint.org/docs/latest/rules/max-lines-per-function)
- [Lizard GitHub](https://github.com/terryyin/lizard)
- [Lizard PyPI](https://pypi.org/project/lizard/)
- [Lizard on Codacy](https://blog.codacy.com/lizard-codacys-new-code-complexity-analysis-tool)
