# Diagnostic v1 Findings Fixes Design

**Date**: 2026-02-28
**Status**: Approved
**Findings**: `docs/diagnostic/v1/findings.md`
**Goal**: Fix all pre-run findings before first diagnostic execution. Improve skill export signal quality, fix aggregation bugs, harden tests, rewrite runner in TypeScript, and refine prompts.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stability map naming | Normalize to kebab-case | Extractors are source of truth |
| Skill templates | Keep Handlebars | Less churn, existing infrastructure |
| Runner language | Rewrite in TypeScript | Better JSON handling, error types, concurrency |
| Runner packaging | Standalone `tsx` script | Separate from published CLI |
| New prompts (D-16+) | Defer to after first run | Data-driven prompt design |
| Import order observation | Add `structure.import-order` | Import ordering is high-value style signal |
| Convention humanization | Use `description` field for bool/number | Simple, no mapping table needed |

---

## Fix 1: Import Order Observation + Stability Map

### Problem

Two issues with structure observations:

1. **Naming mismatch**: StructureExtractor emits kebab-case types (`structure.import-group`) but `STABILITY_MAP` uses camelCase keys (`structure.importGrouping`). Affects ALL structure observations — stability lookup falls through to "medium" default, deflating confidence by ~17%.

2. **Semantic gap**: `structure.import-group` counts which import group is most common (e.g., "internal" at 41.9%). This doesn't capture import ORDER (builtin → external → internal → relative), which is the actual style convention users care about.

### Design

**1a. Add `structure.import-order` observation** (new observation type):

In `StructureExtractor.extractImports()`, after processing all imports in a file, emit one observation per file capturing the ordering pattern:

```typescript
// After collecting all import groups for a file, determine order
const groupSequence = importGroups.map(g => g.group) // ["builtin", "external", "internal", "relative"]
const uniqueOrder = [...new Set(groupSequence)]       // Deduplicated, preserving first-seen order

observations.push({
  type: "structure.import-order",
  category: "structure",
  value: JSON.stringify(uniqueOrder),  // '["builtin","external","internal","relative"]'
  file: file.filePath,
  line: 1,
  metadata: { groupCount: uniqueOrder.length },
})
```

This produces one observation per file (not per import). The aggregator's majority voting works correctly here — if 8/10 files have `["builtin","external","internal","relative"]` order, that becomes the dominant convention with 80% confidence.

**1b. Normalize `STABILITY_MAP` to kebab-case**:

Rename all structure keys:
- `structure.importGrouping` → `structure.import-group`
- `structure.exportStyle` → `structure.export-style`
- `structure.exportProximity` → `structure.export-proximity`
- `structure.barrelFiles` → `structure.barrel-file`

Add entry for the new type:
- `structure.import-order` → `"high"` (ordering patterns are highly stable)

**1c. Drift prevention test**:

New unit test: extract all observation types from every extractor, verify each has a `STABILITY_MAP` entry. Prevents future naming drift.

**1d. Regenerate expected profile**:

Create `scripts/regenerate-expected-profile.ts` that:
1. Loads corpus files from `tests/integration/fixtures/corpus/typescript/`
2. Runs full extraction pipeline
3. Aggregates observations
4. Writes output to `expected-profile.json`
5. Prints diff for human review

Run this script after the fix, review the diff, commit the updated profile.

### Files Modified

- `packages/analyzer/src/extractors/structure.ts` — add import-order observation
- `packages/analyzer/src/aggregator/stability.ts` — rename keys, add import-order
- `packages/analyzer/src/__tests__/structure.test.ts` — test new observation
- `packages/analyzer/src/__tests__/stability.test.ts` — add drift prevention test
- `tests/integration/fixtures/corpus/expected-profile.json` — regenerated
- `scripts/regenerate-expected-profile.ts` — new script

---

## Fix 2: Skill Export Improvements

### Problem

The skill.md Claude receives has flat bullet points (no confidence hierarchy), raw boolean/number conventions, no examples in most templates, and ignores idioms/anti-patterns entirely.

### Design

**2a. Confidence-tiered skill.md**:

Update `template-helpers.ts`:
- New `getRulesByTier(profile)` function returning `{ critical: RuleEntry[], strong: RuleEntry[], preferred: RuleEntry[] }`
  - Critical: confidence >= severityThresholds.error (default 0.85)
  - Strong: confidence >= severityThresholds.warn (default 0.60)
  - Preferred: confidence >= severityThresholds.info (default 0.40)

Update `skill.md.hbs`:
```handlebars
## Critical Rules (always follow)
{{#each criticalRules}}
- **{{name}}**: {{readableConvention}} ({{confidencePercent}}%)
{{/each}}

## Strong Conventions (follow when possible)
{{#each strongRules}}
- **{{name}}**: {{readableConvention}} ({{confidencePercent}}%)
{{/each}}
```

**2b. Human-readable conventions**:

For boolean/number conventions, use the rule's `description` field instead of raw value. Only fall back to `JSON.stringify` when description is missing:

```typescript
function readableConvention(rule: RuleEntry): string {
  if (typeof rule.convention === "boolean" || typeof rule.convention === "number") {
    return rule.description ?? JSON.stringify(rule.convention)
  }
  if (Array.isArray(rule.convention)) {
    return rule.convention.join(" → ")  // ["builtin","external"] → "builtin → external"
  }
  return String(rule.convention)
}
```

**2c. Per-language template reorganization**:

Update `per-language.md.hbs` to group by confidence tier (same as skill.md). Rules within each tier sorted by category.

**2d. Surface idioms and anti-patterns**:

Add context builders in `skill.ts` for `profile.idioms.detected` and `profile.antiPatterns.acknowledged`.

Add to `skill.md.hbs`:
```handlebars
{{#if idioms}}
## Common Patterns
{{#each idioms}}
- **{{name}}**: {{description}}{{#if example}} — `{{example}}`{{/if}}
{{/each}}
{{/if}}

{{#if antiPatterns}}
## Avoid
{{#each antiPatterns}}
- **{{pattern}}**: {{reason}}
{{/each}}
{{/if}}
```

**2e. Add fixability to reference files**:

Update `naming.md.hbs`, `patterns.md.hbs`, and `per-language.md.hbs` to render fixability when present.

**2f. Expand examples to all reference files**:

Copy the example rendering block from `naming.md.hbs` into `patterns.md.hbs` and `per-language.md.hbs`.

**2g. Update tests**:

Update skill export integration test to verify:
- Tiered structure exists (Critical/Strong headings)
- Idioms section rendered when present
- Anti-patterns section rendered when present
- No unrendered Handlebars artifacts (existing check)

Update skill export unit tests for new context builder functions.

### Files Modified

- `packages/profile/src/exporters/template-helpers.ts` — add `getRulesByTier()`, `readableConvention()`
- `packages/profile/src/exporters/skill.ts` — add idiom/anti-pattern context builders
- `skills/code-style-personal/templates/skill.md.hbs` — tiered layout, idioms, anti-patterns
- `skills/code-style-personal/templates/per-language.md.hbs` — tiered layout, examples
- `skills/code-style-personal/templates/patterns.md.hbs` — fixability, examples
- `skills/code-style-personal/templates/naming.md.hbs` — fixability
- `packages/profile/src/__tests__/skill-exporter.test.ts` — updated assertions
- `tests/integration/exports/skill-export.test.ts` — updated assertions

---

## Fix 3: Test Hardening

### Problem

Test thresholds are too loose, three profile categories lack pipeline assertions, and ESLint config tests use substring matching.

### Design

**3a. Tighten thresholds**:

| Test | Current | New | Rationale |
|------|---------|-----|-----------|
| `full-pipeline.test.ts` avgConfidence | > 0.5 | > 0.65 | Consistent corpus should produce decent confidence |
| `profile-roundtrip.test.ts` matchRate | > 0.5 | > 0.7 | Profile from its own corpus should match well |
| `profile-roundtrip.test.ts` deviationRate | < 0.15 | < 0.15 | Already reasonable, keep |

**3b. Add category assertions in `full-pipeline.test.ts`**:

New test cases:
- Assert at least one feature with category containing "error" exists
- Assert at least one feature with category "formatting" exists (requires FormattingExtractor to run — check if it's included)
- Assert at least one feature with category "structure" exists

**3c. ESLint config test precision**:

Replace `rule.includes("naming")` with specific checks:
```typescript
expect(allRules).toContainEqual(
  expect.stringMatching(/@typescript-eslint\/naming-convention/)
)
```

**3d. Stability map drift test**:

New test that instantiates all extractors, runs them against a minimal fixture, collects all observation types, and verifies each has a `STABILITY_MAP` entry.

### Files Modified

- `tests/integration/pipeline/full-pipeline.test.ts` — threshold + category assertions
- `tests/integration/roundtrip/profile-roundtrip.test.ts` — threshold update
- `tests/integration/exports/eslint-config.test.ts` — precise rule matching
- `packages/analyzer/src/__tests__/stability.test.ts` — drift prevention

---

## Fix 4: Runner Rewrite in TypeScript

### Problem

Bash runner has broken string substitution, no timeouts, silent failures, and no budget tracking.

### Design

Replace `scripts/diagnostic/run.sh` with `scripts/diagnostic/run.ts`.

**Dependencies**: Add `tsx` as root dev dependency for running TypeScript scripts. Use a hand-rolled concurrency limiter (no `p-limit` dependency — trivial to implement with a counter and promises).

**Structure**:

```typescript
// scripts/diagnostic/run.ts
import { spawn } from "node:child_process"
import { parseArgs } from "node:util"

interface RunConfig {
  version: string
  profilePath: string
  concurrency: number
  budget: number
  skipCheck: boolean
  skipJudge: boolean
  dryRun: boolean
}

// Phase 1: Export skill files to temp directory
async function setupSkillExport(profilePath: string): Promise<string>

// Phase 2: Run test bench prompts with bounded concurrency
async function runTestBench(config: RunConfig, skillDir: string): Promise<void>

// Phase 3: Run code-style check against agent output
async function runChecks(config: RunConfig): Promise<void>

// Phase 4: Run judge evaluations with task context
async function runJudge(config: RunConfig): Promise<void>

// Phase 5: Call assembler
async function assemble(version: string): Promise<void>
```

**Key improvements**:
- **JSON handling**: Native `JSON.parse`/`JSON.stringify`, no bash string substitution
- **Timeouts**: `AbortSignal.timeout(120_000)` on each subprocess
- **Error handling**: Try/catch with structured error logging per phase
- **Budget tracking**: Parse `claude` output for usage info, accumulate per-prompt
- **Concurrency**: Hand-rolled limiter using promise queue
- **Template substitution**: `String.replaceAll()` with proper values
- **Judge context**: Pass `{{TASK_DESCRIPTION}}` to judge prompt (extracted from original prompt's Task section)
- **Dry run mode**: Print what would execute without running

**CLI**:
```
npx tsx scripts/diagnostic/run.ts <version> [options]
  --profile <path>     Profile to test (default: scripts/diagnostic/fixtures/test-profile.json)
  --concurrency <n>    Parallel prompts (default: 3)
  --budget <usd>       Per-prompt budget (default: 0.50)
  --skip-check         Skip code-style check phase
  --skip-judge         Skip judge phase
  --dry-run            Print plan without executing
```

Delete `run.sh` after verification.

### Files Modified

- `scripts/diagnostic/run.ts` — new TypeScript runner
- `scripts/diagnostic/run.sh` — deleted
- `package.json` (root) — add `tsx` dev dependency

---

## Fix 5: Prompt Refinement

### Problem

Some prompts are vague (inviting excess tool calls), analysis prompts lack output schemas, and judge doesn't receive task context.

### Design

**5a. Tighten D-01** (string utility):

Replace:
> Handle edge cases like empty strings and Unicode input

With:
> Edge cases to handle: (1) empty string input returns empty string, (2) null/undefined input throws TypeError, (3) single-word input for pluralize adds "s", (4) truncate with maxLength < 3 returns "..."

**5b. Tighten D-04** (configuration module):

Replace:
> sections for database, server, and auth settings

With:
> Config shape: database: { url: string, maxConnections: number, timeoutMs: number }, server: { port: number, host: string }, auth: { jwtSecret: string, tokenExpirySeconds: number }. All fields required. Throw if any environment variable is missing.

**5c. Tighten D-05** (discount calculator tests):

Add function signature:
> The function signature is: `calculateDiscount(price: number, tier: 'bronze' | 'silver' | 'gold' | 'platinum'): number`. Discount rates: bronze=10%, silver=15%, gold=20%, platinum=25%.

**5d. Add output schema to D-12** (code review):

Add:
```json
{
  "violations": [
    { "line": 9, "category": "naming", "rule": "variables", "issue": "snake_case variable", "suggestion": "use camelCase" }
  ],
  "summary": { "total": 12, "byCategory": { "naming": 5, "structure": 3, "formatting": 4 } }
}
```

**5e. Add output schema to D-13** (suggest fixes):

Add:
```json
{
  "fixes": [
    { "line": 9, "before": "let user_name = ...", "after": "let userName = ...", "category": "naming" }
  ]
}
```

**5f. Add task context to judge prompt**:

Update `judge.md` to accept `{{TASK_DESCRIPTION}}` variable. Runner extracts the `## Task` section from each prompt and passes it to the judge.

Add to judge.md:
```markdown
## Original Task
{{TASK_DESCRIPTION}}

Use this to verify the agent completed the task, not just followed style rules.
```

### Files Modified

- `scripts/diagnostic/prompts/test-bench/D-01.md`
- `scripts/diagnostic/prompts/test-bench/D-04.md`
- `scripts/diagnostic/prompts/test-bench/D-05.md`
- `scripts/diagnostic/prompts/test-bench/D-12.md`
- `scripts/diagnostic/prompts/test-bench/D-13.md`
- `scripts/diagnostic/prompts/judge.md`

---

## Fix 6: Assembler Fixes

### Problem

`extractJson()` tries raw parse before markdown stripping, missing validation guards, delta edge cases, hardcoded model name.

### Design

**6a. Fix `extractJson()` ordering**:

Try markdown code fence stripping first (since `claude -p` output is typically markdown-wrapped), then raw JSON parse as fallback.

**6b. Add validation guards**:

Guard all nested access patterns:
- `c.summary?.total ?? 0` instead of `c.summary.total`
- `r.judge?.scores?.[dimension] ?? null` instead of `r.judge.scores[dimension]`
- Filter out records with missing required fields before aggregation

**6c. Fix delta calculation**:

Change `if (prev === 0) return "—"` to `if (prev === 0 && cur === 0) return "—"`. When prev is 0 but cur is nonzero, show the actual value as "new".

**6d. Parameterize model name**:

Read model from test result metadata if available, fall back to a `MODEL` constant defined at the top of the file (not inline).

**6e. Add parse failure logging**:

When `extractJson()` returns null, log the file path and first 200 chars of content for debugging.

### Files Modified

- `scripts/diagnostic/assemble.ts`

---

## Fix 7: Update Findings Document

After all fixes are applied, update `docs/diagnostic/v1/findings.md`:
- Add a "Resolution" column to each finding
- Mark findings as addressed with commit references
- Note any deferred items

---

## Implementation Order

```
Fix 1 (aggregation bug + import order)
  ↓
Fix 2 (skill export)     Fix 3 (test hardening)     Fix 5 (prompt refinement)
  ↓                        ↓                           ↓
Fix 4 (runner rewrite)   Fix 6 (assembler fixes)
  ↓
Fix 7 (update findings doc)
```

Fix 1 must go first because it changes expected-profile.json which affects test thresholds (Fix 3). Fixes 2, 3, and 5 are independent. Fix 4 (runner) can happen in parallel but should come after Fix 5 (prompt changes) since the runner templates prompts. Fix 7 is last.
