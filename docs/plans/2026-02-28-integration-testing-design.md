# Integration & Diagnostic Testing Design

**Date**: 2026-02-28
**Status**: Approved
**Goal**: Validate that code-style produces accurate profiles from real code and that those profiles generate configs that enforce the detected style — including when Claude Code uses them.

## Problem

The project has 344 unit tests but zero integration tests. Every test mocks at package boundaries. We have no validation that:
- The full Extract → Aggregate → Profile pipeline produces correct profiles from known code
- Exported configs (ESLint, Ruff, skill) actually work with their target tools
- Claude Code follows the generated style profiles when writing code

## Architecture: Three Tiers

| Tier | What | Runs | Evaluation | Location |
|------|------|------|------------|----------|
| 1. Pipeline Integration | Extract → Aggregate → Profile | `pnpm test` (CI) | Assertion-based | `tests/integration/pipeline/` |
| 2. Export Validation | Profile → Config → Lint | `pnpm test` (CI) | Lint output parsing | `tests/integration/exports/` |
| 3. AI Diagnostics | Profile + Skill → Claude writes code | `scripts/diagnostic/run.sh` (on-demand) | Hybrid: checker + LLM-as-judge | `scripts/diagnostic/` |

Implementation priority: Tier 1 → Tier 2 → Tier 3.

---

## Tier 1: Pipeline Integration Tests

### Golden Corpus

A set of ~20 synthetic TypeScript files with deliberate, documented style patterns:

```
tests/integration/fixtures/corpus/
  typescript/
    service-user.ts         # camelCase vars, PascalCase types, arrow functions
    utils-string.ts         # helper functions, jsdoc-selective, early returns
    controller-auth.ts      # try/catch error handling, builtin→external→relative imports
    model-payment.ts        # interfaces, enums, SCREAMING_SNAKE constants
    config.ts               # short functions (<25 lines), template literals
    handler-webhook.ts      # async/await, error boundaries, typed errors
    types-api.ts            # type-only exports, interface composition
    middleware-logging.ts   # higher-order functions, functional patterns
    repository-user.ts     # class-based, constructor injection
    routes-index.ts         # barrel exports, re-export patterns
    ... (15-20 files total, each ~30-60 lines)
  expected-profile.json     # Hand-verified expected profile output
```

Each fixture file has a comment header documenting its intended style signals:

```typescript
// Style signals: camelCase variables, PascalCase types, arrow functions,
// jsdoc on public functions only, early returns, no semicolons
```

### Test Scenarios

#### 1. Full pipeline test
Parse all corpus files → run all extractors → aggregate → verify profile matches `expected-profile.json`:
- Convention values match exactly (camelCase, PascalCase, etc.)
- Confidence values within ±0.05
- Severity mappings correct given default thresholds
- All 6 profile categories populated

#### 2. Per-extractor integration tests
Each extractor runs against the full corpus (not single fixtures), verifying aggregate behavior:
- NamingExtractor on 20 files → majority convention is camelCase for variables
- StructureExtractor on 20 files → import order detected as builtin→external→relative
- DocumentationExtractor → detects jsdoc-selective pattern

#### 3. Aggregator faithfulness test
Given observations with known distributions (e.g., 18/20 files use camelCase), verify:
- Confidence calculation is correct
- Severity mapping follows thresholds
- Low-confidence features flagged for review

#### 4. Profile schema compliance
Pipeline output parses with `ProfileSchema.parse()` — no runtime validation failures.

### Ownership

`expected-profile.json` is owned by the test suite. When extractors or aggregation logic changes, the expected profile is updated deliberately through a manual review process — never auto-updated.

---

## Tier 2: Export Validation Tests

### Approach

Start from a fixed profile (hand-crafted, not pipeline output) and verify each exporter produces working output.

### Test Scenarios

#### 1. ESLint config validity
- Generate ESLint config from profile
- Write a "violation file" (snake_case vars when profile says camelCase)
- Write a "compliant file" (follows all profile rules)
- Run ESLint with generated config via `runTool("npx", ["eslint", ...])`
- Assert: violations detected in violation file, zero in compliant file

#### 2. Ruff config validity
- Same pattern for Python — generate ruff.toml, lint violation + compliant .py files
- Assert correct diagnostics

#### 3. EditorConfig validity
- Generate .editorconfig
- Parse back and verify settings match profile (indent_style, indent_size, end_of_line)

#### 4. Skill export structure
- Generate skill files from profile
- Verify skill.md contains top rules by confidence
- Verify references/ files exist for each category
- Verify no unrendered Handlebars artifacts (`{{`, `}}`)

#### 5. Roundtrip test (most important)
- Start with golden corpus from Tier 1
- Run pipeline → profile
- Export profile → ESLint config
- Run ESLint with generated config against the same corpus
- Assert: near-zero violations (corpus should comply with its own detected profile)

### Tool Availability

ESLint/Ruff validation tests require those tools installed. Gate behind:
```typescript
const hasEslint = await commandExists("npx");
describe.skipIf(!hasEslint)("ESLint integration", () => { ... });
```

### Fixture Structure

```
tests/integration/fixtures/exports/
  test-profile.json           # Fixed profile with known rules
  violation-ts.ts             # TypeScript file that violates the profile
  compliant-ts.ts             # TypeScript file that follows the profile
  violation-py.py             # Python file that violates the profile
  compliant-py.py             # Python file that follows the profile
```

---

## Tier 3: AI Diagnostic Suite

Modeled on the brain project's diagnostic system (`~/Documents/projects/brain/scripts/diagnostic/`).

### Prompt Structure

Each prompt is a markdown file in `scripts/diagnostic/prompts/test-bench/`:

```markdown
# D-01: Write a TypeScript utility module

## Task
Write a TypeScript module that provides string utility functions:
capitalize, slugify, truncate, and pluralize.

## Profile
{{PROFILE_PATH}}

## Skill
{{SKILL_PATH}}

## Rules
- You have access to the code-style skill at {{SKILL_PATH}}
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files
- Do NOT install additional dependencies

## Output
Return a JSON object:
- id: "D-01"
- version: "{{VERSION}}"
- files_written: string[]
- tool_calls: number
- skill_referenced: boolean
- self_assessment: { naming: 1-5, structure: 1-5, documentation: 1-5, overall: 1-5 }
```

### Prompt Categories (15-20 prompts)

| Category | Count | Examples |
|----------|-------|---------|
| Module creation | 5 | Utility module, service class, data model, config parser, test file |
| Refactoring | 3 | Rename to match style, restructure imports, add error handling |
| Bug fixing | 3 | Fix a bug while maintaining style conventions |
| Code review | 2 | Review code against profile, suggest fixes |
| Documentation | 2 | Add docs matching profile's documentation voice |

### Evaluation Pipeline (Hybrid)

For each prompt result:

**Phase 1 — Automated check** (`code-style check`):
- Run `code-style check` against Claude's output files
- Count violations by category
- Score: violations / total checkable rules

**Phase 2 — LLM-as-judge** (for soft rules):
- Feed Claude's output + the profile to a judge prompt
- Judge evaluates: documentation voice, error handling patterns, code organization, naming "feel"
- Returns structured scores per category (1-5)

**Phase 3 — Efficiency metrics**:
- `tool_calls`: Total tool invocations
- `skill_referenced`: Did the agent read the skill files?
- `budget_used`: API cost for the prompt

### Runner Script

```bash
./scripts/diagnostic/run.sh <version> [options]
  --profile <path>     # Profile to test against (default: fixtures/test-profile.json)
  --concurrency <n>    # Parallel prompts (default: 3)
  --budget <usd>       # Per-prompt budget (default: 0.50)
  --skip-check         # Skip code-style check phase
  --skip-judge         # Skip LLM-as-judge phase
```

**Phases**:
1. Generate skill export from profile into temp directory
2. Run test bench prompts in parallel (budget-constrained via `claude -p`)
3. Collect output files from each prompt
4. Run `code-style check` against output files
5. Run LLM-as-judge evaluation prompts
6. Assemble results into scorecard

### Results Storage

```
docs/diagnostic/
  v1/
    test-bench/
      D-01.json                 # Raw agent output
      D-01-check.json           # code-style check results
      D-01-judge.json           # LLM-as-judge evaluation
    scorecard.md                # Aggregate metrics + per-prompt breakdown
    summary.md                  # Human-readable findings
```

### Scorecard Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Avg check violations / prompt | < 2 | Hard rule compliance |
| Avg judge score (naming) | >= 4/5 | Naming convention adherence |
| Avg judge score (overall) | >= 4/5 | Overall style match |
| Skill reference rate | >= 80% | % of prompts where agent read skill |
| Avg tool calls / prompt | < 15 | Efficiency (less context pollution) |
| Prompts at 0 violations | >= 60% | Perfect compliance rate |

### Version-to-Version Comparison

The assembler computes deltas against the previous version:
- Violation count trends (improving or regressing?)
- Judge score trends
- Tool call efficiency trends
- New observations (friction points, skill gaps)

---

## Design Decisions

### Why synthetic fixtures, not real repos?

Real repos have messy, inconsistent style. Synthetic fixtures give us full control over expected values, making assertions deterministic. If we later want real-repo smoke tests, we add them as a separate, non-asserting test.

### Why hybrid evaluation for Tier 3?

`code-style check` catches hard rules (naming, formatting, import order) but can't evaluate "does this code feel like my style?" The LLM-as-judge catches soft rules (documentation voice, error handling approach, code organization patterns). Together they cover the full profile.

### Why not test the enricher (AI) in Tier 1?

The enricher calls an LLM, making it non-deterministic and requiring API keys. Tier 1 tests the deterministic pipeline only: Extract → Aggregate → Profile. The enricher is tested separately in its existing unit tests with mocked providers.

### Why budget-constrain Tier 3?

Following the brain project's pattern: $0.50/prompt forces efficient tool use. If an agent burns its budget exploring, that's a signal the skill/profile isn't discoverable enough.

---

## Non-Goals

- Testing GitHub ingest with live API calls (keep mocked in unit tests)
- Testing the interactive review session (terminal UI, not automatable)
- Achieving 100% profile accuracy (style is subjective; we target "reasonable" profiles)
- Supporting arbitrary languages (TypeScript + Python only for now)
