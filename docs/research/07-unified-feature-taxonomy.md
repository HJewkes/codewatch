# Unified Feature Taxonomy

**Date**: 2026-02-27
**Purpose**: Master feature list synthesized from CodeStylometry, AuthAttLyzer V2, RoPGen, HowYouCode, and the programmatic detection research. Each feature is mapped to its detection method, tool, stability rating, and pipeline stage.

## Stability Ratings (from RoPGen)

- **High**: Persists even when developer tries to write differently. Most reliable signal.
- **Medium**: Consistent under normal conditions but can shift with context.
- **Low**: Varies by project, language, or intent. Flag for interactive review.

## Detection Tiers

- **Programmatic**: AST walk, regex, or existing linter rule. Zero tokens.
- **Heuristic**: Ratio computation over AST observations. Zero tokens but requires statistical aggregation.
- **AI**: Requires LLM for interpretation, prose generation, or context-dependent judgment.

---

## Category 1: Naming Conventions

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Variable naming convention (camelCase, snake_case, etc.) | Programmatic | tree-sitter `#match?` predicate / `@typescript-eslint/naming-convention` | High | Extract |
| Function naming convention | Programmatic | tree-sitter / `@typescript-eslint/naming-convention` | High | Extract |
| Type/class naming convention | Programmatic | tree-sitter / `@typescript-eslint/naming-convention` | High | Extract |
| Constant naming convention | Programmatic | tree-sitter `#match?` / ESLint | High | Extract |
| File naming convention | Programmatic | `eslint-plugin-unicorn/filename-case` / regex on paths | High | Extract |
| Boolean variable prefixes (is/has/should) | Programmatic | tree-sitter + regex | Medium | Extract |
| Abbreviation avoidance | Heuristic | `eslint-plugin-unicorn/prevent-abbreviations` / name length distribution | Medium | Extract + Aggregate |
| Parameter naming patterns | Programmatic | tree-sitter | Medium | Extract |
| Enum member naming | Programmatic | `@typescript-eslint/naming-convention` | High | Extract |
| Private member prefix/convention | Programmatic | tree-sitter (# prefix, _ prefix) | High | Extract |

## Category 2: Code Structure

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Import grouping order | Programmatic | `eslint-plugin-import/order` classification | High | Extract |
| Import path style (aliases vs relative) | Programmatic | regex on import source strings | Medium | Extract |
| Type import separation | Programmatic | tree-sitter (`import type` vs `import`) | Medium | Extract |
| Export style (named vs default) | Heuristic | AST node ratio: `ExportDefault` vs `ExportNamed` | High | Extract + Aggregate |
| Barrel file usage | Programmatic | detect files where all exports are re-exports | Medium | Extract |
| Export proximity to definition | Programmatic | AST position: `export function` vs trailing `export { }` | Medium | Extract |
| Function length distribution | Programmatic | tree-sitter statement count per function / `lizard` | High | Extract |
| Max nesting depth distribution | Programmatic | tree-sitter / ESLint `max-depth` | High | Extract |
| File length distribution | Programmatic | line count per file | Medium | Extract |
| Module topology (layering, cycles) | Heuristic | `dependency-cruiser` / `madge` graph analysis | Low | Extract + Aggregate |
| Group-by-type vs group-by-feature | AI | File path analysis + module graph | Low | Enrich |

## Category 3: Control Flow Patterns

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Guard clauses vs nested conditionals | Heuristic | Return depth + else-after-return ratio (tree-sitter) | High | Extract + Aggregate |
| Early return vs single exit | Heuristic | Return count per function + position ratio | High | Extract + Aggregate |
| Ternary vs if/else preference | Heuristic | `ConditionalExpression` vs `IfStatement` ratio | Medium | Extract + Aggregate |
| Array methods vs for loops | Heuristic | `.map/.filter` call count vs `ForStatement` count | High | Extract + Aggregate |
| for-of vs for-in vs indexed for | Programmatic | tree-sitter node types | Medium | Extract |
| async/await vs promise chains | Heuristic | `AwaitExpression` vs `.then()` call ratio | High | Extract + Aggregate |
| Switch vs if/else chains | Heuristic | `SwitchStatement` vs long `IfStatement` chains ratio | Medium | Extract + Aggregate |
| Optional chaining usage | Programmatic | `OptionalChaining` node count | Medium | Extract |
| Nullish coalescing vs OR | Programmatic | `??` vs `||` operator counts | Low | Extract |

## Category 4: Error Handling

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| try/catch frequency | Heuristic | `TryStatement` count per function ratio | High | Extract + Aggregate |
| Catch clause specificity | Programmatic | catch parameter type checks in body | Medium | Extract |
| Result type usage | Programmatic | type annotation matching `Result`, `Either`, `Ok`, `Err` | High | Extract |
| Error return tuples `[value, error]` | Programmatic | return type annotation pattern matching | Medium | Extract |
| Custom error classes | Programmatic | `class X extends Error` detection | Medium | Extract |
| Exhaustive switch handling | Programmatic | `@typescript-eslint/switch-exhaustiveness-check` | High | Extract |
| assertNever pattern | Programmatic | function with `never` param + `never` return | High | Extract |
| Floating promise handling | Programmatic | `@typescript-eslint/no-floating-promises` | Medium | Extract |
| Error boundary architecture | AI | Cross-function analysis of error propagation | Low | Enrich |

## Category 5: Documentation

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| JSDoc/docstring presence ratio | Programmatic | tree-sitter comment nodes adjacent to declarations | High | Extract |
| Public vs private doc coverage | Programmatic | cross-reference access modifiers with leading comments | Medium | Extract |
| Inline comment density (comments per LOC) | Heuristic | line comment count / lines of code ratio | Medium | Extract + Aggregate |
| Comment placement (leading vs trailing) | Programmatic | tree-sitter `leadingComments` vs `trailingComments` | Medium | Extract |
| Section-level vs line-level comments | Heuristic | ratio of comments with multiple subsequent statements | Low | Extract + Aggregate |
| Module/file header comments | Programmatic | detect comment block as first node in file | Medium | Extract |
| JSDoc tag usage (which tags are used) | Programmatic | regex on JSDoc blocks for @param, @returns, @throws, etc. | Medium | Extract |
| Documentation voice (imperative/declarative) | AI | NLP on comment text | Low | Enrich |
| Why vs what comment classification | AI | Semantic relationship between comment and code | Low | Enrich |
| Redundancy detection | AI | Whether comment restates the code | Low | Enrich |

## Category 6: Type System Usage (TypeScript)

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Type annotation density | Heuristic | typed vs untyped positions ratio | High | Extract + Aggregate |
| Explicit return types | Programmatic | `@typescript-eslint/explicit-function-return-type` | High | Extract |
| Module boundary types | Programmatic | `@typescript-eslint/explicit-module-boundary-types` | Medium | Extract |
| Type inference reliance (no-inferrable-types) | Programmatic | `@typescript-eslint/no-inferrable-types` violations | Medium | Extract |
| Interface vs type alias preference | Heuristic | `InterfaceDeclaration` vs `TypeAliasDeclaration` ratio | Medium | Extract + Aggregate |
| Generic usage frequency | Heuristic | `TypeParameter` node count per declaration | Low | Extract + Aggregate |
| Readonly/immutability markers | Programmatic | `@typescript-eslint/prefer-readonly` | Medium | Extract |
| Discriminated union patterns | Programmatic | union types with literal type members | Medium | Extract |
| Utility type usage (Partial, Pick, Omit) | Programmatic | type reference matching known utility names | Low | Extract |

## Category 7: Formatting & Layout

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Indentation style (tabs/spaces) | Programmatic | EditorConfig / leading whitespace analysis | High | Extract |
| Indent size | Programmatic | EditorConfig / leading space count analysis (ECLint approach) | High | Extract |
| Semicolons | Programmatic | Prettier config / AST presence detection | High | Extract |
| Quote style (single/double) | Programmatic | Prettier config / string literal analysis | High | Extract |
| Trailing commas | Programmatic | Prettier config / AST trailing comma presence | High | Extract |
| Brace style (1TBS, Allman, etc.) | Programmatic | brace position relative to statement (regex/AST) | High | Extract |
| Line length preference | Heuristic | line length distribution percentiles | Medium | Extract + Aggregate |
| Blank line patterns | Heuristic | blank line frequency between declarations, functions, etc. | Medium | Extract + Aggregate |
| Destructuring preference | Heuristic | `ObjectPattern` vs `MemberExpression` chain ratio | Medium | Extract + Aggregate |
| Default parameters vs conditional defaults | Heuristic | default syntax usage vs body reassignment ratio | Low | Extract + Aggregate |
| Arrow function vs function expression | Heuristic | node type ratio | Medium | Extract + Aggregate |
| Trailing newline | Programmatic | file ending detection | High | Extract |

## Category 8: Higher-Level Patterns

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Composition vs inheritance | Heuristic | `extends` frequency, constructor injection patterns | Medium | Extract + Aggregate |
| Class vs functional preference | Heuristic | `ClassDeclaration` count vs standalone function count | High | Extract + Aggregate |
| Pure function tendency | AI | Side-effect analysis (writes to external state) | Low | Enrich |
| Immutability preference | Heuristic | `const` vs `let` ratio, readonly usage, Object.freeze | Medium | Extract + Aggregate |
| Explicit vs implicit style | Heuristic | type annotation density + destructuring + default params | Medium | Aggregate |
| DRY adherence | Heuristic | jscpd clone density | Medium | Extract + Aggregate |

## Category 9: Habitual Idioms (NEW — via jscpd)

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| Repeated structural patterns | Programmatic | jscpd (Rabin-Karp over tokenized code) | High | Extract |
| Go-to error handling shape | Heuristic | jscpd + tree-sitter pattern clustering | Medium | Extract + Aggregate |
| Data transformation idioms | Heuristic | jscpd + functional idiom frequency | Medium | Extract + Aggregate |
| API call patterns | Heuristic | jscpd + fetch/axios/request pattern shapes | Medium | Extract + Aggregate |
| Test structure templates | Heuristic | jscpd on test files specifically | Medium | Extract + Aggregate |

## Category 10: Review Voice (from PR review comments)

| Feature | Detection | Tool | Stability | Stage |
|---------|-----------|------|-----------|-------|
| What the user flags in reviews | Heuristic | keyword/topic frequency analysis on review comments | Medium | Extract + Aggregate |
| Review comment tone and style | AI | NLP on review comment text | Low | Enrich |
| Consistent review themes | AI | Topic clustering across review comments | Low | Enrich |
| Things the user values most | AI | Synthesis of review patterns into prose | Low | Enrich |

---

## Summary Statistics

| Category | Total Features | Programmatic | Heuristic | AI-Required |
|----------|---------------|-------------|-----------|-------------|
| Naming | 10 | 9 | 1 | 0 |
| Structure | 11 | 7 | 3 | 1 |
| Control Flow | 9 | 3 | 6 | 0 |
| Error Handling | 9 | 7 | 1 | 1 |
| Documentation | 10 | 5 | 2 | 3 |
| Type System | 9 | 6 | 3 | 0 |
| Formatting | 12 | 8 | 4 | 0 |
| Higher-Level Patterns | 6 | 0 | 5 | 1 |
| Habitual Idioms | 5 | 1 | 4 | 0 |
| Review Voice | 4 | 0 | 1 | 3 |
| **Total** | **85** | **46 (54%)** | **30 (35%)** | **9 (11%)** |

**89% of features are detectable without AI.** Only 11% require LLM interpretation. This strongly validates the programmatic-first approach.

---

## Stability Distribution

| Stability | Count | % |
|-----------|-------|---|
| High | 35 | 41% |
| Medium | 38 | 45% |
| Low | 12 | 14% |

High-stability features should receive a confidence boost in the aggregation stage. Low-stability features should be prioritized for interactive review discussion.
