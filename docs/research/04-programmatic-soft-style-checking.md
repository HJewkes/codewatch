# Programmatic Detection of "Soft" Coding Style

## Overview

The conventional wisdom is that detecting developer style preferences requires AI judgment —
things like "does this developer prefer guard clauses?" or "do they favor composition over
inheritance?" seem inherently subjective. In practice, a large fraction of these preferences
leave concrete, structurally measurable traces in the AST. This document surveys the techniques,
tools, and specific mechanisms that can detect these patterns programmatically, and is explicit
about where the methods break down and AI judgment genuinely is needed.

The core insight is that style preferences are hypotheses about *ratio and frequency*. A developer
who prefers early returns will have a measurably higher ratio of `ReturnStatement` nodes appearing
early in function bodies, guarded by a single-branch `IfStatement`, compared to one who uses a
single-exit discipline. You are not trying to classify any individual function — you are building
a frequency distribution across a corpus and looking for systematic skews.

---

## 1. Pattern Preference Detection via AST Analysis

### Guard Clauses vs. Nested Conditionals

**What is detectable:** A guard clause is structurally a function-level `IfStatement` (or switch
case) that has a `ReturnStatement`, `ThrowStatement`, or `ContinueStatement` as its sole or primary
consequence, and appears before the main function body. The inverse — nested conditionals — is a
`ReturnStatement` that appears deep inside nested `IfStatement` or `TryStatement` nodes.

**Measurement approach:**

- **Return depth**: Walk each function body. For every `ReturnStatement`, count the number of
  `IfStatement`, `ForStatement`, `WhileStatement`, `TryStatement`, and `SwitchCase` ancestors
  between the return and the function root. A developer who uses guard clauses will have a
  distribution skewed heavily toward depth 1; a nested-if developer will have returns at depth 3+.

- **Else-branch ratio**: Count `IfStatement` nodes that have an `alternate` (else branch) versus
  those that do not. A guard-clause developer rarely writes `if (x) { ... } else { ... }` when the
  if-branch contains a return — they eliminate the else. The `no-else-return` ESLint rule encodes
  exactly this heuristic.

- **Function-level nesting depth**: Track the maximum nesting depth within each function, defined
  as the maximum depth of the deepest `BlockStatement` descendent. High average values signal
  nested-if preference; low values combined with multiple returns signal guard-clause preference.

**Existing rule coverage:**

- ESLint `no-else-return`: Directly detects and flags the absence of guard-clause style — i.e.,
  when an `else` block follows an `if` block containing a `return`.
- ESLint `consistent-return`: Detects whether a function always returns a value or never does,
  which relates to single-exit discipline.
- ESLint code path analysis: Exposes seven code-path events (`onCodePathStart`,
  `onCodePathSegmentStart`, `onUnreachableCodePathSegmentStart`, etc.) that allow rules to trace
  every reachable execution path through a function, making it possible to detect functions that
  always converge to a single return versus those with multiple early exits.
- `eslint-plugin-unicorn` `no-negated-condition`: Detects `if (!condition) { ... } else { ... }`
  and flags it as a missed opportunity for a guard clause.

**The guard-clause rule gap:** A formal `guard-clause` rule was proposed for ESLint (issue #10858)
and for `eslint-plugin-unicorn` (issue #1862) but was not merged into either due to implementation
complexity. The core difficulty is distinguishing a "real" guard clause (early exit from an invalid
state) from a legitimately-structured if/else. For *style fingerprinting* this does not matter —
you are not enforcing; you are measuring the ratio.

**Where AI is still needed:**

- Determining *intent*: Is the early return a defensive guard, or is it a coincidental structure
  that happens to return early? The ratio metric is agnostic to intent; it will still capture the
  developer's behavioral preference.
- Cross-function patterns: Whether a developer applies guard clauses consistently across all entry
  points or only in certain contexts (public vs. private, sync vs. async) requires tracking context
  across many functions.

---

### Early Return vs. Single-Exit Discipline

**What is detectable:**

- Count `ReturnStatement` nodes per function.
- Compute the ratio of functions with `return_count > 1` to total functions.
- Measure where returns appear relative to total function line count: a return at line 2 of 30 is
  structurally different from a return at line 30 of 30.

**Existing rule coverage:**

- ESLint `consistent-return` with `treatUndefinedAsUnspecified: false` enforces single-exit
  discipline by requiring all returns to be value-bearing or all to be bare.
- ESLint `no-else-return` enforces early-return style by flagging unnecessary `else` blocks.
- These two rules are *inverses in spirit*; whether a codebase enables one, the other, or both
  reveals the developer's preference.

**Where AI is still needed:** Neither rule captures why a developer structured the control flow
as they did. A function with 5 returns might be spaghetti or might be a well-structured state
machine. The metric captures the pattern; meaning requires semantic understanding.

---

### Composition vs. Inheritance

**What is detectable:**

- **Class hierarchy depth**: Walk `ClassDeclaration` nodes. For each class, check whether
  `superClass` is present. Track the maximum depth of inheritance chains. A developer who avoids
  inheritance will have nearly all classes with no `superClass`.
- **`extends` frequency**: Count `ClassDeclaration` nodes with `superClass` divided by total class
  declarations. This is a direct structural signal.
- **Interface/mixin usage**: Count how often classes implement multiple interfaces or compose
  behavior via function injection versus inheritance. In TypeScript, `implements` clauses are
  structurally distinct from `extends` clauses.
- **Constructor injection patterns**: Count constructors that accept dependencies as parameters
  (composition via DI) versus classes that instantiate dependencies internally via `new` within
  the class body.

**Existing rule coverage:**

- `eslint-plugin-functional` `no-classes`: Enforces a hard ban on class declarations entirely,
  which is the maximal form of "prefer composition." Whether a project enables this rule is itself
  a style signal.
- No existing linting rule detects "composition *over* inheritance" as a graduated preference
  rather than a binary ban.

**Where AI is still needed:** Composition and inheritance are semantic concepts. A class that
`extends EventEmitter` to inherit its event system is using inheritance opportunistically, not as
a design doctrine. Detecting whether the pattern is architectural versus incidental requires
understanding the role of the class in the system.

---

### Explicit vs. Implicit Style

**What is detectable:**

- **Type annotation density** (TypeScript/Python): Count the ratio of typed vs. untyped function
  parameters, return positions, and variable declarations. In TypeScript, this is the ratio of
  `TypeAnnotation` nodes to positions where annotations could appear.
- **Explicit return types**: `typescript-eslint` `explicit-function-return-type` detects whether
  functions carry explicit return types. Its inverse, `no-inferrable-types`, detects annotations
  on variables where TypeScript can infer the type — capturing over-annotation preference.
- **`explicit-module-boundary-types`**: Enforces explicit types at module boundaries (exported
  functions and classes), revealing whether a developer treats types as internal details or public
  contracts.
- **Default parameter vs. conditional body**: Count functions that use default parameter syntax
  (`function f(x = 0)`) versus functions that reassign defaults inside the body
  (`if (x === undefined) x = 0`). This is a clean structural split.
- **Destructuring density**: Count uses of destructuring assignment vs. property access chains.
  `const { a, b } = obj` versus `const a = obj.a; const b = obj.b` are structurally distinct
  in the AST (`ObjectPattern` vs. `MemberExpression`).

**Where AI is still needed:** Whether explicit annotations signal a "defensive" mindset or a
"documentation-first" mindset is a semantic question. The ratio alone captures behavior.

---

## 2. Idiomatic Code Detection

### Array Methods vs. Imperative Loops

**What is detectable:**

This is one of the cleanest detections available because the structural difference is unambiguous:
a `ForStatement` with a counter variable is syntactically different from a `CallExpression` on
`Array.prototype.map`.

- **`eslint-plugin-unicorn` `no-for-loop`**: Detects `for (let i = 0; i < arr.length; i++)` loops
  that can be replaced with `for-of` or array method calls. The rule specifically checks whether
  the loop variable is used only for array indexing.
- **`prefer-array-some`**: Detects manual boolean-returning loops that iterate to check a
  condition, flagging them as candidates for `.some()`.
- **`no-array-for-each`**: Takes the opposite position — detects `.forEach()` calls and prefers
  `for-of`. Whether a project enables `no-for-loop` (preferring functional) or `no-array-for-each`
  (preferring imperative) directly reveals the developer's idiom preference.
- **Functional idiom ratio**: Count `CallExpression` nodes where the callee is a member expression
  matching `.map(`, `.filter(`, `.reduce(`, `.find(`, `.some(`, `.every(`. Divide by the sum of
  that count plus `ForStatement` and `WhileStatement` counts in array-processing contexts.

**Where AI is still needed:** A `for` loop used for its side effects (updating external state) is
not a candidate for `.map()`. Determining whether a loop is "equivalent" to a higher-order function
requires data-flow analysis, not just structural matching.

---

### Async/Await vs. Promise Chains

**What is detectable:**

- **Structural AST detection**: `AwaitExpression` nodes inside `AsyncFunction` declarations are
  unambiguously `async/await` style. `CallExpression` nodes where the callee is a `MemberExpression`
  with property `then` are promise chains.
- **Anti-pattern detection**: The DrAsync research tool (Sotiropoulos, ICSE 2022) demonstrates that
  several async/await anti-patterns are detectable via simple static analysis:
  - `asyncFunctionAwaitedReturn`: An `async` function that `return await expr` — the `await` is
    redundant. Detected by ESLint `no-return-await`.
  - `promiseResolveThen`: `Promise.resolve(x).then(f)` — an unnecessary promise chain when `f(x)`
    would suffice.
  - `await` inside a loop body (`no-await-in-loop`): Detects sequential awaiting where
    `Promise.all()` could parallelize.
- **`no-async-promise-executor`**: Detects async functions passed as `new Promise()` executor
  arguments — a common confusion anti-pattern.
- **`require-await`**: Detects `async` functions that contain no `await` expressions — either
  the `async` keyword is unnecessary, or the developer is applying it habitually.
- **Style ratio**: Count `AwaitExpression` nodes vs. `.then(` call expressions across a file.
  A developer who converted a codebase from promises to async/await may have a mix; a developer
  who always wrote async/await will have a near-zero promise-chain count.

**Where AI is still needed:**

- Promise chains are sometimes *preferable* (e.g., in functional pipelines where `.then()` chains
  read as a sequence of transforms). Whether a chain reflects style preference or deliberate design
  requires context.
- The DrAsync tool combined static analysis with *dynamic* analysis to rank which anti-patterns
  are most frequently executed, demonstrating that static analysis alone can miss severity.

---

## 3. Code Structure Heuristics

### Import Grouping and Organization

**What is detectable:**

Import declarations are syntactically uniform: `ImportDeclaration` nodes all appear at the top
of the file (in well-formed ES modules). Their text content reveals their type:

- **`eslint-plugin-import` `import/order`**: Classifies imports into groups: `builtin`, `external`,
  `internal`, `parent`, `sibling`, `index`, `object`, `type`. The rule detects whether imports are
  sorted within and between groups, and whether blank lines separate groups. The *configuration*
  a developer uses reveals their grouping preference; violations reveal their behavior.
- **Type import separation**: In TypeScript, `import type { Foo }` vs. `import { Foo }` is a
  structural distinction. Whether a developer separates type imports into their own group (enforced
  by `eslint-plugin-import` with `newlines-between: always`) is a detectable preference.
- **Alias vs. path patterns**: Count imports that use path aliases (`@/components/...`) vs. relative
  paths (`../../components/...`). This is a string-pattern match on the `source` field of
  `ImportDeclaration`.
- **Side-effect import positioning**: `import 'styles.css'` (no specifiers) is structurally distinct
  from named imports. Counting their position relative to other imports reveals organizational style.

**What `import/order` does not detect:**

- Whether the *intent* of a grouping is "by domain" vs. "by dependency direction" — two developers
  can produce the same file structure for entirely different organizational reasons.
- Multi-file import topology: Understanding whether a developer structures modules in layers
  (utilities → services → controllers) requires graph analysis across files, not per-file rules.

**For topology detection:** Tools like `madge` and `dependency-cruiser` build a module dependency
graph from all import declarations. The graph's properties (depth, cycles, fan-in/fan-out
distributions) are computable metrics that reveal architectural style — e.g., a developer who
builds strict layered architectures will have a DAG with few cross-layer edges; a developer who
accepts coupling will have many.

---

### Module Boundary and Export Style

**What is detectable:**

- **Named vs. default export ratio**: Count `ExportDefaultDeclaration` vs. `ExportNamedDeclaration`
  nodes per file. A developer who always uses named exports for explicit API surfaces will have
  near-zero default exports. A developer who uses one-export-per-file will have near-100% defaults.
- **Re-export barrel patterns**: Detect `export { ... } from '...'` re-exports (index files that
  aggregate). Whether a developer uses barrel files is detectable by looking for files where all
  exports are re-exports rather than definitions.
- **Export proximity to definition**: Some developers define a function and immediately export it
  (`export function foo() {}`); others define everything first and export at the end (`export {
  foo, bar }`). This is a measurable structural pattern in the AST.

---

## 4. Documentation Style Detection

### What Gets Documented vs. What Does Not

The most tractable programmatic documentation analysis works at two levels: *presence* and
*coverage ratio*.

**Presence detection:**

- **Leading comment association**: Walk the AST. For each `FunctionDeclaration`,
  `MethodDefinition`, `ClassDeclaration`, and `VariableDeclaration`, check whether a
  `/** ... */` comment (block comment starting with `*`) immediately precedes it in the source.
  ESLint's `require-jsdoc` rule (now deprecated but its logic is replicated in
  `eslint-plugin-jsdoc`) does exactly this.
- **Public vs. private coverage**: For class methods, count the ratio of methods with `public`
  (or no access modifier) that have JSDoc versus `private` or `#`-prefixed methods that have JSDoc.
  A developer who documents only public API will have high public-JSDoc ratio and near-zero
  private-JSDoc ratio. This ratio is directly computable from access modifier AST nodes plus
  leading-comment presence.
- **Inline comment density**: Count `Line` comment nodes (single-line `//` comments) per function
  and per file. Divide by lines of code (LOC) for each scope. This produces a comments-per-LOC
  distribution that characterizes how heavily a developer annotates implementation details.

**Comment placement patterns:**

- **Pre-statement vs. end-of-line**: Comments attached to a node but placed on the *same line*
  as code (trailing comments) vs. on the line *before* the code (leading comments) are
  structurally distinct in most parsers. Recast, Babel, and tree-sitter all distinguish
  `leadingComments` from `trailingComments`. The ratio of inline-trailing to leading-block
  comments characterizes comment placement style.
- **Comment-to-block association**: Detect whether a developer tends to comment at the
  *section* level (a comment before a block of related statements) vs. the *line* level (a
  comment on individual statements). This is measurable via the ratio of comments that have
  multiple subsequent statements before the next comment.

**Where programmatic detection breaks down:**

- **Voice and tone**: Whether a comment says "Check that x is not null before proceeding" vs.
  "Guard: x must be non-null" is a linguistic distinction. Detecting *imperative vs. declarative*
  comment voice requires NLP.
- **Why vs. what**: Research on code comment classification (Pascarella et al., MSR 2017) shows
  that comments can be classified as "what" (restating the code), "why" (explaining rationale),
  "how-to-use" (usage instructions), or "warning". This classification requires understanding
  the semantic relationship between the comment text and the code it annotates — purely
  programmatic detection fails here.
- **Redundancy detection**: Deep Learning to Detect Redundant Method Comments (Steidl et al.,
  ICSE 2019) requires ML; pure static analysis cannot determine whether a comment adds information
  beyond what the code already expresses.

---

## 5. Error Handling Pattern Detection

### try/catch vs. Result Types vs. Error Returns

**What is structurally detectable:**

- **try/catch frequency**: Count `TryStatement` nodes per file and per function. The ratio of
  functions containing a `TryStatement` to total functions is a direct measurement of how heavily
  a developer uses exception-based error handling.
- **Catch clause width**: In a `TryStatement`, examine the `CatchClause`'s `param`. A developer
  who catches all exceptions (`catch (e)`) versus one who catches specific types
  (`catch (e instanceof SpecificError)`) has a structurally different pattern.
- **Result type usage** (TypeScript): If a developer uses `neverthrow`, `ts-results`, or a
  custom `Result<T, E>` type, function return types will contain that type name. This is
  detectable via type annotation text (`TypeReference` nodes matching `Result`, `Ok`, `Err`,
  `Either`). `eslint-plugin-neverthrow` takes this further, providing rules that ensure Result
  values are not ignored (analogous to `no-floating-promises` for promises).
- **Error return pattern** (Go-style): Functions that return `[value, error]` tuples or
  `{ data, error }` objects are detectable by examining return type annotations for union
  types containing `Error` or `null`.
- **Floating promise detection**: `typescript-eslint` `no-floating-promises` detects `Promise`
  values that are created but not `await`-ed or chained — a common error handling omission.

### Exhaustive Error Handling

**What is detectable:**

- **Switch exhaustiveness**: `typescript-eslint` `switch-exhaustiveness-check` uses the TypeScript
  type checker to determine whether a `switch` statement over a discriminated union covers all
  cases. This is a type-aware rule: it reads the type of the switch expression, enumerates all
  possible values, and checks that each has a corresponding `case`. This is a canonical example of
  where type information makes a sophisticated structural check possible.
- **`never` type usage**: Detecting whether a developer uses the "assertNever" pattern
  (`function assertNever(x: never): never { throw new Error(...) }`) is a direct AST match:
  look for `FunctionDeclaration` nodes with a parameter type annotation of `never` and a
  `never` return type.

**Where AI is still needed:**

- Whether a developer's error handling is *architecturally appropriate* — using exceptions for
  truly exceptional conditions and Result types for expected failure paths — requires understanding
  the domain semantics of what constitutes an exception vs. a normal failure.
- Detecting error handling *omissions* (a function that should validate its input but does not)
  requires understanding what the function does and what invariants it should enforce.

---

## 6. Tree-sitter Queries

### What Tree-sitter Queries Can Do

Tree-sitter's query language is an S-expression pattern language ("regular expressions for
syntax trees," per the documentation). A query is a set of patterns; each pattern matches a
subtree shape and optionally captures named nodes from it.

**Core capabilities:**

- **Node type matching**: `(if_statement consequence: (block) @if.block)` matches any `if`
  statement and captures its consequence block.
- **Field access**: Queries can constrain on specific structural positions (fields) within a node,
  not just node types, which is essential for precision.
- **Wildcards**: `(_)` matches any named node; `_` matches any node. These allow "match this
  structure with any child here" patterns.
- **Predicates**:
  - `#eq?`: Equality test between two captured node texts or between a capture and a literal string.
  - `#match?`: Regular expression match against a capture's text — e.g.,
    `(#match? @name "^[A-Z][A-Z_\\d]+")` to detect SCREAMING_SNAKE_CASE constants.
  - `#any-of?`: Match a capture against a set of strings.
  - `#not-eq?`, `#not-match?`: Negations of the above.
- **Quantifiers**: `*` (zero or more), `+` (one or more), `?` (optional) on child patterns.
- **Alternation**: `[(arrow_function) (function_expression)]` matches either node type.
- **Anchors**: `"."` forces adjacency between siblings, enabling "immediately followed by" patterns.

**Concrete style-detection examples:**

```scheme
; Detect a function with an early return as its first statement
(function_declaration
  body: (statement_block
    "."
    (return_statement) @early.return))

; Detect class declarations that extend something (inheritance)
(class_declaration
  name: (identifier) @class.name
  (class_heritage
    (identifier) @parent.class))

; Detect await expressions inside for loops
(for_statement
  body: (_
    (await_expression) @await.in.loop))

; Detect named exports (as opposed to default exports)
(export_statement
  declaration: (_) @named.export)

; Detect try-catch blocks
(try_statement
  handler: (catch_clause) @catch.handler)

; Detect identifiers in camelCase vs snake_case (using #match? predicate)
((identifier) @camel
  (#match? @camel "^[a-z][a-zA-Z0-9]*$")
  (#not-match? @camel "^[a-z][a-z_0-9]*$"))
```

**What makes tree-sitter queries powerful for style fingerprinting:**

- They are language-grammar-aware. Each language has its own grammar; queries are written against
  that grammar's node types, which means they capture semantic structure (e.g., "this is actually
  an arrow function, not a method shorthand") rather than text patterns.
- They are fast: tree-sitter parses in near-real-time and queries are compiled to efficient
  matchers. Running 50 style queries across a large repository is feasible in seconds.
- They are cross-language: the same query engine works for JavaScript, TypeScript, Python, Go,
  Rust, etc. with language-appropriate grammars.

**Limits of tree-sitter queries:**

- **No data-flow awareness**: A query cannot determine whether a variable defined on line 10 is
  used on line 20, or whether two calls share the same argument. There is no concept of scope
  resolution or type resolution within the query language.
- **No cross-node conditions with arbitrary structure**: Queries match *local subtrees*. There is
  no way to write "match a function that somewhere in its body contains X and also Y, where X and
  Y are related." You can write two separate queries and intersect results in the host language,
  but the query language itself is local.
- **Exponential match explosion**: Complex queries with many alternations and wildcards can produce
  exponential numbers of matches for large input. The documentation warns that performance for
  100kb+ inputs with complex queries can degrade to seconds.
- **No recursive type handling**: Capturing recursive structures (e.g., "a chain of three or more
  `.then()` calls") requires either multiple queries and host-language post-processing, or a custom
  tree walk — the query language cannot express "match this pattern repeated N times."
- **Predicates are not first-class**: Predicates (`#match?`, `#eq?`) are implemented by the
  host-language binding, not by the C library itself. Some bindings implement only a subset of
  predicates.
- **No semantic understanding**: Tree-sitter operates entirely on syntax. It cannot tell you
  that two identifiers refer to the same binding, or that a return type annotation of `Result<T, E>`
  is semantically a Result pattern rather than any generic type named Result.

---

## 7. Semgrep for Style Patterns

### What Semgrep Can Detect Beyond Security

Semgrep describes itself as "lightweight static analysis for many languages" with patterns that
"look like source code." Its primary design goal is security, but the pattern language is general
enough for style analysis.

**Key pattern operators for style detection:**

- **Metavariables** (`$X`): Match any single expression, statement, or identifier. `if ($COND) {
  return $VAL; }` matches any if-with-return regardless of what `$COND` and `$VAL` are.
- **Ellipsis** (`...`): Match zero or more items. `foo(...)` matches any call to `foo` with any
  arguments. `{ ...; return $X; }` matches any block that eventually returns `$X`.
- **`pattern-inside`**: Match patterns that are nested within another pattern. Useful for "find all
  await expressions inside for loops" or "find all returns inside catch blocks."
- **`pattern-not`** and `pattern-not-inside`: Negation — match patterns that do *not* contain
  something. Useful for "functions that do not have a try/catch" or "classes that do not extend
  anything."
- **`pattern-either`**: Alternation — match any of several patterns. Useful for "match any of the
  three ways this developer writes callbacks."
- **`metavariable-regex`**: Apply a regex to a metavariable's text — detect naming conventions
  (e.g., `$NAME` matching `^handle[A-Z]` for event handler naming).
- **`metavariable-comparison`**: Numeric comparisons on metavariable-derived values.
- **`focus-metavariable`**: When using pattern combinations, restrict the match to just the
  piece you care about.

**Concrete style-detection examples:**

```yaml
# Detect async functions that wrap returns in unnecessary await
rules:
  - id: redundant-return-await
    pattern: |
      async function $F(...) {
        ...
        return await $EXPR;
      }
    message: "Possibly redundant return await in async function"
    languages: [javascript, typescript]
    severity: INFO

# Detect for loops that could use array methods
  - id: prefer-array-iteration
    pattern: |
      for (let $I = 0; $I < $ARR.length; $I++) {
        ...
      }
    message: "Consider using array methods instead of indexed for loop"
    languages: [javascript, typescript]
    severity: INFO

# Detect classes with inheritance
  - id: class-uses-inheritance
    pattern: "class $NAME extends $PARENT { ... }"
    languages: [javascript, typescript]
    severity: INFO

# Detect promise chains (as opposed to async/await)
  - id: promise-chain-usage
    pattern: "$PROMISE.then($HANDLER)"
    languages: [javascript, typescript]
    severity: INFO
```

**Semgrep's advantage over pure tree-sitter queries:**

- Semgrep normalizes across syntax variants. `$X.then($Y)` will match whether the promise is
  stored in a variable, returned inline, or chained from a function call — the structural
  variations are abstracted away.
- The `pattern-not-inside` and `pattern-inside` operators allow context-sensitive matching that
  tree-sitter queries cannot express directly.
- Semgrep Pro adds interprocedural taint tracking and cross-file analysis, enabling patterns like
  "find all values that flow from an unchecked user input into a function that does not have a
  try/catch."

**Limits of Semgrep for style analysis:**

- **Intra-procedural by default**: Semgrep's pattern matching and even its taint analysis are
  fundamentally within-function (intraprocedural) in the open-source version. Cross-function
  analysis is a Pro (paid) feature. Style patterns that span multiple functions — like "does this
  developer consistently wrap external calls in error boundaries" — require Pro or custom tooling.
- **No aggregate statistics**: Semgrep reports individual matches, not distributions. It cannot
  tell you "60% of this developer's functions use guard clauses." You get a list of files/lines
  that match; the aggregation must be done externally.
- **Metavariable limitations in generic mode**: In Semgrep's generic (non-language-specific) mode,
  metavariables can only capture a single "word" token and cannot capture multi-token sequences.
  This makes generic-mode style patterns brittle for anything beyond simple identifier matching.
- **Ellipsis scope in generic mode**: In generic mode, an ellipsis extends only to the end of
  the current block or 10 lines, whichever is shorter. Complex patterns that span function bodies
  may not match as expected.
- **No type system integration** (open source): Detecting whether a variable is of type
  `Result<T, E>` or whether an `extends` clause refers to a particular base class requires type
  resolution that Semgrep's open-source version does not provide.
- **Pattern combinatorial explosion**: Complex rules using `pattern-either` with many alternatives,
  combined with `pattern-not` and deep `pattern-inside` nesting, can become slow and hard to
  maintain. The recommended approach is to keep rules focused and compose at the report-aggregation
  layer rather than within a single rule.

---

## 8. Synthesis: The Programmatic/AI Boundary

The table below summarizes what is robustly detectable programmatically, what is partially
detectable with heuristics, and what genuinely requires AI judgment.

| Style Dimension | Programmatic Detection | Heuristic (fragile) | Needs AI |
|---|---|---|---|
| Guard clause vs. nested if | Return depth, else-after-return ratio | Intent of early return | Architectural appropriateness |
| Early return vs. single exit | Return count per function, return position ratio | Intentional vs. accidental pattern | |
| Array methods vs. for loops | for-loop structure vs. .map/.filter calls | Whether loop is "equivalent" to method | |
| async/await vs. promise chains | AwaitExpression count vs. .then() call count | Mixed codebases, intentional chains | Pipeline design intent |
| Composition vs. inheritance | extends frequency, constructor injection patterns | | Role of class in system |
| Explicit vs. implicit types | Type annotation density, no-inferrable-types ratio | | Annotation intent |
| Import grouping | Import source patterns, blank-line positions | | Organizational intent |
| Module topology | Dependency graph shape, cycle detection | Layer violations | Architectural intent |
| try/catch vs. Result types | TryStatement count, Result type annotation presence | | Domain-appropriate choice |
| Exhaustive error handling | switch-exhaustiveness-check, never type usage | | Missing validation detection |
| Documentation presence | Leading comment ratio, public/private coverage | | |
| Documentation *what* | Comment-to-code density, placement patterns | Redundancy detection | Voice, tone, why vs. what |
| Ternary vs. if/else | ConditionalExpression count vs. IfStatement count | | Readability appropriateness |
| Naming convention style | Regex on identifier nodes | Cross-context consistency | Semantic appropriateness |
| Function length discipline | Statement count per function | | |
| Test structure patterns | Describe/it block nesting, assertion density | | Test quality, coverage intent |

**The key principle:** Programmatic tools excel at detecting *what structure is present* and
computing *frequency distributions* over that structure. They cannot detect *why* a structure was
chosen or whether it was *appropriate*. AI is needed when the relevant question is contextual or
semantic — not when it is structural and measurable.

For a developer fingerprinting system, this means:

1. Use programmatic detection to build a high-dimensional feature vector per file, per function,
   and per repository. Many of the features above are computable via a single AST traversal.
2. Use frequency distributions (ratios, histograms) rather than binary flags. A developer is not
   "a guard-clause developer" — they have a *distribution* of guard-clause usage that can be
   compared against other developers.
3. Reserve AI analysis for the interpretive layer: given a feature vector, what does this suggest
   about the developer's *intent* and *values* — and how do the features cluster into coherent
   style archetypes?

---

## References and Sources

- [ESLint Code Path Analysis](https://eslint.org/docs/latest/extend/code-path-analysis)
- [ESLint Custom Rules](https://eslint.org/docs/latest/extend/custom-rules)
- [ESLint `no-else-return`](https://eslint.org/docs/latest/rules/no-else-return)
- [ESLint `consistent-return`](https://eslint.org/docs/latest/rules/consistent-return)
- [ESLint `no-return-await`](https://eslint.org/docs/latest/rules/no-return-await)
- [ESLint `no-await-in-loop`](https://eslint.org/docs/latest/rules/no-await-in-loop)
- [eslint-plugin-unicorn](https://github.com/sindresorhus/eslint-plugin-unicorn)
- [eslint-plugin-unicorn `no-for-loop`](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/no-for-loop.md)
- [eslint-plugin-unicorn guard-clause proposal](https://github.com/sindresorhus/eslint-plugin-unicorn/issues/1862)
- [eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional)
- [typescript-eslint `explicit-function-return-type`](https://typescript-eslint.io/rules/explicit-function-return-type/)
- [typescript-eslint `no-inferrable-types`](https://typescript-eslint.io/rules/no-inferrable-types/)
- [typescript-eslint `switch-exhaustiveness-check`](https://typescript-eslint.io/rules/switch-exhaustiveness-check/)
- [typescript-eslint `no-misused-promises`](https://typescript-eslint.io/rules/no-misused-promises/)
- [typescript-eslint `prefer-readonly`](https://typescript-eslint.io/rules/prefer-readonly/)
- [Typed Linting overview](https://typescript-eslint.io/blog/typed-linting/)
- [eslint-plugin-import `order`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md)
- [Semgrep pattern syntax](https://semgrep.dev/docs/writing-rules/pattern-syntax)
- [Semgrep rule structure](https://semgrep.dev/docs/writing-rules/rule-syntax)
- [Semgrep taint analysis](https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/overview)
- [Semgrep ellipsis metavariables](https://semgrep.dev/docs/kb/rules/ellipsis-metavariables)
- [Semgrep generic pattern matching](https://semgrep.dev/docs/writing-rules/generic-pattern-matching)
- [Tree-sitter query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html)
- [Tree-sitter predicates and directives](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html)
- [Tree-sitter query tips (Cycode)](https://cycode.com/blog/tips-for-using-tree-sitter-queries/)
- [DrAsync: anti-patterns in async JavaScript (ICSE 2022)](https://reallytg.github.io/files/papers/drasync.pdf)
- [neverthrow](https://github.com/supermacro/neverthrow)
- [eslint-plugin-neverthrow](https://dev.to/caverar/error-handling-and-logging-policy-helper-for-neverthrow-5d2j)
- [Pylint naming styles](https://pylint.pycqa.org/en/v2.13.9/user_guide/options.html)
- [Classifying code comments in Java (MSR 2017)](https://sback.it/publications/publications/msr2017a.pdf)
- [Stylometry for real-world expert coders (PMC 2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11623162/)
- [Oxlint beta](https://oxc.rs/blog/2025-03-15-oxlint-beta)
- [Early return and cyclomatic complexity](https://medium.com/@billocsic/early-return-and-cyclomatic-complexity-dc61453607e8)
