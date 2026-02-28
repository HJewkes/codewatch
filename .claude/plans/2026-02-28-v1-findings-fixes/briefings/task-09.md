# Task 09: Assembler Fixes

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. The diagnostic assembler at `scripts/diagnostic/assemble.ts` reads structured JSON from test bench agents, check results, and judge evaluations, then computes aggregates and writes a markdown scorecard. It has several edge-case bugs: `extractJson()` tries raw parse before markdown stripping, nested property access lacks optional chaining, delta calculation suppresses meaningful nonzero values, and the model name is hardcoded.

## File Ownership

**May modify:**
- `scripts/diagnostic/assemble.ts`

**Must not touch:**
- `scripts/diagnostic/run.sh` or `scripts/diagnostic/run.ts` (Task 8 owns these)
- Any prompts under `scripts/diagnostic/prompts/`
- Any source code under `packages/`
- Any test files

## Steps

### Step 1: Fix extractJson() ordering

In `scripts/diagnostic/assemble.ts`, find the `extractJson()` function (line 81-103). Reorder so markdown code fence stripping happens FIRST, then raw JSON.parse as fallback. Add logging when extraction fails.

Replace the current `extractJson` function with:

```typescript
function extractJson(raw: string): string | null {
  let text = raw

  // Handle claude -p --output-format json wrapping
  try {
    const outer = JSON.parse(text)
    if (outer.result) {
      text = outer.result
    }
  } catch {
    // Not wrapped, use raw text
  }

  // Try markdown code fence stripping FIRST (claude -p output is typically markdown-wrapped)
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) {
    try {
      JSON.parse(fenceMatch[1])
      return fenceMatch[1]
    } catch {
      // Fence content wasn't valid JSON, fall through
    }
  }

  // Fallback: find JSON object boundaries in raw text
  const jsonStart = text.indexOf("{")
  const jsonEnd = text.lastIndexOf("}")
  if (jsonStart === -1 || jsonEnd === -1) return null

  return text.slice(jsonStart, jsonEnd + 1)
}
```

Also update `loadTestResult` and `loadJudgeResult` to log when extraction fails. In `loadTestResult` (around line 105-116), after `const jsonStr = extractJson(raw)`, add logging:

```typescript
if (!jsonStr) {
  console.error(`  WARN: Failed to extract JSON from ${path}: ${raw.slice(0, 200)}`)
  return null
}
```

Similarly in `loadJudgeResult` (around line 128-138), change the catch block and add logging after `extractJson`:

```typescript
if (!jsonStr) {
  console.error(`  WARN: Failed to extract JSON from ${path}: ${raw.slice(0, 200)}`)
  return null
}
```

### Step 2: Add validation guards with optional chaining

Replace all bare property access patterns with optional chaining and nullish coalescing:

In `buildHeadlineTable` (around line 186-189), change:
```typescript
? avg(checks.map((c) => c.summary.total))
```
to:
```typescript
? avg(checks.map((c) => c.summary?.total ?? 0))
```

And the same for `prevAvgCheckViolations`:
```typescript
? avg(prevChecks.map((c) => c.summary?.total ?? 0))
```

In `buildHeadlineTable` (around line 195), change:
```typescript
const zeroViolations = checks.filter((c) => c.summary.total === 0).length
const prevZeroViolations = prevChecks.filter((c) => c.summary.total === 0).length
```
to:
```typescript
const zeroViolations = checks.filter((c) => (c.summary?.total ?? 0) === 0).length
const prevZeroViolations = prevChecks.filter((c) => (c.summary?.total ?? 0) === 0).length
```

In `buildJudgeDimensionTable` (around line 236-237), change:
```typescript
const curAvg = avg(judges.map((j) => j.scores[dim]))
const prevAvg = prevJudges.length > 0 ? avg(prevJudges.map((j) => j.scores[dim])) : 0
```
to:
```typescript
const curAvg = avg(judges.map((j) => j.scores?.[dim] ?? 0))
const prevAvg = prevJudges.length > 0 ? avg(prevJudges.map((j) => j.scores?.[dim] ?? 0)) : 0
```

In `buildPerPromptTable` (around line 266-268), change:
```typescript
const total = r.check.summary.total
```
to:
```typescript
const total = r.check.summary?.total ?? 0
```

In `loadAllResults`, add filtering to remove records with missing required fields before they're used. After building the records array, filter out records where test result exists but has no `id`:

```typescript
// Filter out records with malformed test results
for (const record of records) {
  if (record.test && !record.test.id) record.test = null
  if (record.judge && !record.judge.scores) record.judge = null
  if (record.check && !record.check.summary) record.check = null
}
```

### Step 3: Fix delta calculation

In `buildHeadlineTable`, find the `delta` function (around line 198-205). Change:

```typescript
const delta = (cur: number, prev: number, decimals = 1): string => {
  if (prev === 0 && cur === 0) return "---"
  if (prev === 0) return "---"
  const diff = cur - prev
  if (Math.abs(diff) < 0.05) return "flat"
  const sign = diff > 0 ? "+" : ""
  return `**${sign}${diff.toFixed(decimals)}**`
}
```

to:

```typescript
const delta = (cur: number, prev: number, decimals = 1): string => {
  if (prev === 0 && cur === 0) return "---"
  if (prev === 0) return `**+${cur.toFixed(decimals)}**`
  const diff = cur - prev
  if (Math.abs(diff) < 0.05) return "flat"
  const sign = diff > 0 ? "+" : ""
  return `**${sign}${diff.toFixed(decimals)}**`
}
```

Note: The em dash character in the source is `"---"`. Preserve whatever character the file actually uses (it may be a Unicode em dash). The key change is replacing the second `return "---"` with `return \`**+${cur.toFixed(decimals)}**\`` so that when prev is 0 but cur is nonzero, the actual value is shown.

### Step 4: Replace hardcoded model name

At the top of the file (after the imports and interface definitions, around line 79), add:

```typescript
const DEFAULT_MODEL = "claude-sonnet-4-6"
```

In the `main()` function, find the scorecard template string (around line 358) where `claude-sonnet-4-6` is hardcoded:

```typescript
**Agent model:** claude-sonnet-4-6
```

Replace with:

```typescript
**Agent model:** ${DEFAULT_MODEL}
```

### Step 5: Verify assembler exits cleanly with no args

```bash
cd /Users/hjewkes/Documents/projects/code-style
npx tsx scripts/diagnostic/assemble.ts
```

This should print the usage message and exit with code 1 (no crash, no unhandled exception). Verify the output looks like:

```
Usage: npx tsx scripts/diagnostic/assemble.ts <version>
Example: npx tsx scripts/diagnostic/assemble.ts v1
```

### Step 6: Commit

```bash
git add scripts/diagnostic/assemble.ts
git commit -m "Fix assembler JSON extraction, validation guards, and delta calculation"
```

## Success Criteria

- [ ] `extractJson()` tries markdown code fence stripping before raw JSON boundary detection
- [ ] Failed JSON extraction logs file path and first 200 chars of content
- [ ] All nested property access uses optional chaining (`?.`) with nullish coalescing (`?? 0` or `?? null`)
- [ ] Records with missing required fields are filtered out before aggregation
- [ ] Delta calculation shows `+{value}` when prev is 0 but cur is nonzero
- [ ] Model name uses `DEFAULT_MODEL` constant instead of inline string
- [ ] `npx tsx scripts/diagnostic/assemble.ts` prints usage and exits cleanly (no crash)
- [ ] `git status` is clean after commit

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not change the scorecard format or add new sections — only fix existing bugs
5. Do not touch the runner (run.sh/run.ts) — Task 8 owns those
