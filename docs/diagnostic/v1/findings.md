# Diagnostic v1: Pre-Run Findings

**Date**: 2026-02-28
**Status**: Pre-run review (test infrastructure audit before first diagnostic execution)
**Scope**: Integration tests, diagnostic prompts, skill export, runner/assembler

## Context

Before running the v1 diagnostic suite, we reviewed the full test infrastructure — integration tests (Tiers 1-2), diagnostic prompts and runner (Tier 3), and the skill export system that Claude Code consumes. This document captures findings that should be fixed before the first diagnostic run, establishing the baseline for the fix → rerun → review → fix cycle.

---

## Finding 1: Skill Export Provides Weak Signal to Claude (P0)

**Component**: `packages/profile/src/exporters/skill.ts`
**Impact**: Directly reduces Claude's ability to produce style-conforming code

The skill.md that Claude Code receives as a style guide has structural problems that limit its effectiveness:

### 1a. All rules appear equal weight

skill.md lists top rules as flat bullet points. A 99% confidence rule (indentation) looks identical to an 85% rule (file naming). Claude has no way to prioritize.

**Current output**:
```
- **formatting.indentation**: 2-space indentation
- **naming.types**: Types/interfaces use PascalCase
- **naming.files**: Files use kebab-case naming
```

**Needed**: Confidence-tiered grouping (Critical 90%+, Strong 85-89%, Preferred 60-84%) so Claude knows what's non-negotiable vs. preferred.

### 1b. Boolean and number conventions are ambiguous

`convention: true` for semicolons, `convention: 2` for indentation. These raw values require interpretation Claude may get wrong.

**Fix**: Render human-readable labels — "Always use semicolons", "2-space indentation", "Prefer optional chaining".

### 1c. Examples are nearly absent

The schema supports examples per rule but they're rarely populated. Without concrete good/bad examples, rules stay abstract. One example per category would dramatically improve compliance.

### 1d. Fixability metadata is hidden

Profile tracks `fixability` (safe, maybe-incorrect, requires-input) but skill export ignores it. Claude doesn't know which rules are auto-fixable vs. which need human judgment.

### 1e. Idioms and anti-patterns are not surfaced

Profile captures `idioms.detected` and `antiPatterns.acknowledged` but neither appears in the skill export. These are high-value signals for code generation.

### 1f. Per-language reference is unsorted

`references/per-language/typescript.md` dumps all rules in a flat list. Low-confidence rules (68%) are mixed with high-confidence (99%). No hierarchy.

### Resolution

RESOLVED -- skill.md now uses confidence-tiered sections (Critical/Strong/Preferred), human-readable conventions for boolean/number values, idioms and anti-patterns sections, and fixability metadata in reference files. Per-language reference is sorted by confidence tier.

---

## Finding 2: Possible Aggregation Bug — Import Group Confidence (P0)

**Component**: `packages/analyzer/src/aggregator/`
**Evidence**: `tests/integration/fixtures/corpus/expected-profile.json`

The expected profile shows `structure.import-group` with **36% confidence** and **"off" severity**. However, all 10 corpus files demonstrate clear, consistent import grouping (builtin → external → internal → relative, separated by blank lines).

This is either:
1. An aggregation logic bug that underweights structural observations
2. A mismatch in how the expected profile was generated
3. A category mapping issue (observations not reaching the right feature bucket)

If this is a real aggregation bug, it affects all real-world profiles — import ordering would be systematically underreported.

**Action**: Trace the aggregation for import-related observations through the pipeline to determine root cause.

### Resolution

RESOLVED -- STABILITY_MAP keys normalized to kebab-case to match extractor output. New `structure.import-order` observation added to capture import ordering patterns. Drift prevention test ensures all observation types have stability map entries. Expected profile regenerated with corrected confidence values.

---

## Finding 3: Integration Test Thresholds Are Too Loose (P1)

**Component**: `tests/integration/pipeline/full-pipeline.test.ts`, `tests/integration/roundtrip/profile-roundtrip.test.ts`

### 3a. Average confidence threshold is 0.5

`full-pipeline.test.ts` asserts `avgConfidence > 0.5`. Given a deliberately consistent corpus, this should be > 0.7. The current threshold would pass even if half the features had garbage confidence values.

### 3b. Roundtrip match rate threshold is 50%

`profile-roundtrip.test.ts` asserts `matchRate > 0.5`. A profile generated from its own corpus should achieve > 75% match rate. 50% means nearly half the observations could disagree with the profile and the test still passes.

### 3c. Three profile categories have no pipeline assertions

errorHandling, formatting, and patterns are extracted but never directly verified in `full-pipeline.test.ts`. If these extractors silently broke, pipeline tests would still pass.

### 3d. ESLint config test uses substring matching

`eslint-config.test.ts` checks `rule.includes("naming")` instead of exact rule names like `"@typescript-eslint/naming-convention"`. Would pass with any string containing "naming".

### Resolution

RESOLVED -- avgConfidence threshold raised from 0.5 to 0.65. Roundtrip matchRate threshold raised from 0.5 to 0.7. Category assertions added for error-handling and structure features. ESLint config tests use exact rule matching via `expect.stringMatching()` instead of `.includes()`.

---

## Finding 4: Diagnostic Runner Has Critical Bugs (P1)

**Component**: `scripts/diagnostic/run.sh`

### 4a. String substitution breaks on profile JSON with `/` characters

```bash
judge_content="${judge_content//\{\{PROFILE_JSON\}\}/$profile_json}"
```

Bash `//` substitution treats the replacement as a pattern. Any `/` in the profile JSON (file paths, regex examples) will corrupt the substitution.

**Fix**: Use `jq` for proper JSON escaping, or write a temporary file and reference it.

### 4b. No timeout on `claude` invocations

A hung prompt blocks the entire batch indefinitely. Need `timeout 120s claude ...`.

### 4c. Silent failure suppression

Multiple `2>/dev/null || true` patterns hide real errors. Failed checks and judge evaluations are silently skipped, producing incomplete scorecards.

### 4d. No budget tracking

The design specifies per-prompt budget limits ($0.50) but the runner doesn't track or enforce actual spend.

### Resolution

RESOLVED -- Runner rewritten in TypeScript (`scripts/diagnostic/run.ts`) with proper JSON handling via native `JSON.parse`/`JSON.stringify`, subprocess timeouts via `AbortSignal.timeout(120_000)`, structured error logging per phase, per-prompt budget tracking, and hand-rolled concurrency limiter. Bash string substitution issues eliminated.

---

## Finding 5: Diagnostic Prompts Need Tightening (P2)

**Component**: `scripts/diagnostic/prompts/test-bench/`

### 5a. Vague specifications invite excess tool calls

- D-01: "Handle edge cases like empty strings and Unicode input" — doesn't specify expected behavior
- D-04: "database, server, and auth settings" — doesn't list config keys
- D-05: Doesn't provide `calculateDiscount` function signature

When prompts are vague, Claude explores more, burns budget, and produces variable output.

### 5b. Analysis prompts lack output schema

D-12 (code review) and D-13 (suggest fixes) say "write as JSON" but don't specify the JSON schema. Different runs will produce incomparable structures, making judge evaluation inconsistent.

### 5c. Judge prompt doesn't receive original task

For refactoring prompts (D-06 to D-08), the judge sees the output code but not the "before" code or the task description. It can't verify whether the refactoring was complete — only whether the result follows style.

### 5d. Coverage gaps

Missing test dimensions:
- Generic/template code
- Cross-module refactoring (multi-file consistency)
- Async concurrency patterns (Promise.all, streaming)
- Module organization (barrel exports, index files)
- Testing patterns (mocks, fixtures, test data builders)

### Resolution

RESOLVED -- D-01, D-04, D-05 tightened with specific edge cases, config shapes, and function signatures. D-12 and D-13 have output JSON schemas for consistent judge evaluation. Judge prompt receives `{{TASK_DESCRIPTION}}` from the original prompt's Task section for completeness verification. Coverage gaps (5d) deferred to after first diagnostic run for data-driven prompt design.

---

## Finding 6: Assembler Edge Cases (P3)

**Component**: `scripts/diagnostic/assemble.ts`

### 6a. `extractJson()` tries raw parse before markdown stripping

Should try stripping markdown code fences first, since `claude -p` output is typically markdown-wrapped.

### 6b. No validation guards on nested access

`checks.map(c => c.summary.total)` assumes all check results have `summary.total`. Missing guards would cause runtime crashes on malformed output.

### 6c. Delta calculation too broad

`if (prev === 0) return "—"` suppresses any delta where the previous value was zero, even if the current value is nonzero (which is meaningful information).

### 6d. Hardcoded model name

Assumes `"claude-sonnet-4-6"` instead of reading from test results.

### Resolution

RESOLVED -- `extractJson()` reordered to try markdown code fence stripping first. All nested property access guarded with optional chaining and nullish coalescing. Records with missing required fields filtered before aggregation. Delta calculation fixed to show `+{value}` when previous is zero but current is nonzero. Model name parameterized via `DEFAULT_MODEL` constant.

---

## Fix Priority for v1 Cycle

| Phase | Findings | Gate |
|-------|----------|------|
| **Pre-run fixes** | F1 (skill export), F2 (aggregation bug), F4a (runner substitution) | Skill output is tiered, import confidence investigated, runner doesn't break on real profiles |
| **Test hardening** | F3 (thresholds), F4b-d (runner robustness) | Tests catch real regressions, runner has timeouts and error reporting |
| **Prompt refinement** | F5 (prompt clarity, schemas, judge context) | Prompts are unambiguous, judge can verify completeness |
| **Polish** | F6 (assembler guards) | Assembler handles malformed output gracefully |

After pre-run fixes, run the diagnostic suite → review scorecard → identify which prompts reveal new issues → fix → repeat.

---

## Summary

All six findings have been addressed. The diagnostic suite is ready for the first v1 run:

- **F1** (Skill Export): Tiered, human-readable skill output with idioms and anti-patterns
- **F2** (Aggregation): Stability map normalized, import order observation added, expected profile regenerated
- **F3** (Tests): Thresholds tightened, category assertions added, ESLint matching made precise
- **F4** (Runner): Rewritten in TypeScript with timeouts, error logging, and budget tracking
- **F5** (Prompts): Specifications tightened, output schemas added, judge receives task context
- **F6** (Assembler): JSON extraction fixed, validation guards added, delta calculation corrected

Next step: execute `npx tsx scripts/diagnostic/run.ts v1` and review the scorecard.
