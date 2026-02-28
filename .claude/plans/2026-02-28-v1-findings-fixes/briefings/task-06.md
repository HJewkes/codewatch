# Task 06: Test Hardening

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. Integration tests live at the workspace root under `tests/integration/`. Three test files have thresholds that are too loose and assertions that use imprecise matching. This task tightens thresholds and adds category assertions so that regressions in extraction quality are caught.

This task depends on Task 3 (expected-profile.json has been regenerated with corrected confidence values from the stability map fix).

## File Ownership

**May modify:**
- `tests/integration/pipeline/full-pipeline.test.ts`
- `tests/integration/roundtrip/profile-roundtrip.test.ts`
- `tests/integration/exports/eslint-config.test.ts`

**Must not touch:**
- Any source code under `packages/`
- Any other test files
- `scripts/` directory
- `docs/` directory

## Steps

### Step 1: Tighten full-pipeline.test.ts confidence threshold

In `tests/integration/pipeline/full-pipeline.test.ts`, find the test "has high average confidence across features" (line 127-129). Change:

```typescript
expect(result.summary.avgConfidence).toBeGreaterThan(0.5)
```

to:

```typescript
expect(result.summary.avgConfidence).toBeGreaterThan(0.65)
```

### Step 2: Add error-handling category assertion

In `tests/integration/pipeline/full-pipeline.test.ts`, add a new test after the existing category assertions:

```typescript
it("produces error-handling observations", () => {
  const errorHandlingFeatures = Array.from(result.features.entries())
    .filter(([, f]) => f.category === "error-handling")
  expect(errorHandlingFeatures.length).toBeGreaterThanOrEqual(1)
})
```

This asserts that the ErrorHandlingExtractor is producing at least one aggregated feature.

### Step 3: Add structure category assertion

In `tests/integration/pipeline/full-pipeline.test.ts`, add another test:

```typescript
it("produces structure observations", () => {
  const structureFeatures = Array.from(result.features.entries())
    .filter(([, f]) => f.category === "structure")
  expect(structureFeatures.length).toBeGreaterThanOrEqual(1)
})
```

### Step 4: Tighten profile-roundtrip.test.ts match rate

In `tests/integration/roundtrip/profile-roundtrip.test.ts`, find the test "majority of observations match the profile" (line 197-203). Change:

```typescript
expect(matchRate).toBeGreaterThan(0.5)
```

to:

```typescript
expect(matchRate).toBeGreaterThan(0.7)
```

### Step 5: Fix ESLint naming convention assertion

In `tests/integration/exports/eslint-config.test.ts`, replace the "contains naming convention rule" test body (lines 37-46). Replace:

```typescript
const allRules = configEntries.flatMap((entry) =>
  Object.keys(entry.rules ?? {}),
)
const hasNamingRule = allRules.some(
  (rule) =>
    rule.includes("naming-convention") ||
    rule.includes("naming"),
)
expect(hasNamingRule).toBe(true)
```

with:

```typescript
const allRules = configEntries.flatMap((entry) =>
  Object.keys(entry.rules ?? {}),
)
expect(allRules).toContainEqual(
  expect.stringMatching(/@typescript-eslint\/naming-convention/),
)
```

### Step 6: Fix ESLint import ordering assertion

In `tests/integration/exports/eslint-config.test.ts`, replace the "contains import ordering rule" test body (lines 48-59). Replace:

```typescript
const allRules = configEntries.flatMap((entry) =>
  Object.keys(entry.rules ?? {}),
)
const hasImportRule = allRules.some(
  (rule) =>
    rule.includes("sort-imports") ||
    rule.includes("import-order") ||
    rule.includes("import"),
)
expect(hasImportRule).toBe(true)
```

with:

```typescript
const allRules = configEntries.flatMap((entry) =>
  Object.keys(entry.rules ?? {}),
)
expect(allRules).toContainEqual(
  expect.stringMatching(/import/),
)
```

### Step 7: Verify and commit

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm test
git add tests/integration/pipeline/full-pipeline.test.ts tests/integration/roundtrip/profile-roundtrip.test.ts tests/integration/exports/eslint-config.test.ts
git commit -m "Harden integration test thresholds and assertions"
```

## Success Criteria

- [ ] `pnpm test` passes with no failures
- [ ] `avgConfidence` threshold is `> 0.65` in full-pipeline.test.ts
- [ ] `matchRate` threshold is `> 0.7` in profile-roundtrip.test.ts
- [ ] At least one test asserts error-handling features exist
- [ ] At least one test asserts structure features exist
- [ ] ESLint tests use `expect().toContainEqual(expect.stringMatching(...))` instead of `.includes()`
- [ ] `git status` is clean after commit

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not change any source code — this task only modifies test files
5. Do not change deviation rate threshold (it stays at `< 0.15`)
