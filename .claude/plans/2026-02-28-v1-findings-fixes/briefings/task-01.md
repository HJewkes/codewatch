# Task 01: Import Order Observation + Stability Map Fix

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. The `packages/analyzer` package contains extractors that emit `Observation` objects with a `type` field (e.g., `"structure.import-group"`). The aggregator in `packages/analyzer/src/aggregator/` uses `STABILITY_MAP` to look up stability ratings by observation type, which directly affects confidence scoring. There are two bugs: (1) the stability map uses camelCase keys but extractors emit kebab-case types, causing all structure observations to fall through to the "medium" default, and (2) there is no `structure.import-order` observation capturing the ordering sequence of import groups within a file.

## File Ownership

**May modify:**
- `packages/analyzer/src/extractors/structure.ts`
- `packages/analyzer/src/aggregator/stability.ts`
- `packages/analyzer/src/__tests__/structure.test.ts`

**Must not touch:**
- `packages/analyzer/src/aggregator/index.ts`
- `packages/analyzer/src/aggregator/frequency.ts`
- Any other extractor files
- Any files outside the ownership list

## Steps

### Step 1: Add `structure.import-order` observation to `structure.ts`

In `packages/analyzer/src/extractors/structure.ts`, modify the `extractImports` method. After the existing `for (const child of root.children)` loop (which collects per-import `structure.import-group` observations), add logic to derive the unique group ordering sequence and emit one `structure.import-order` observation per file.

The existing loop already pushes `structure.import-group` observations with `value: group` where group is one of `"builtin"`, `"external"`, `"internal"`, `"relative"`. After the loop:

1. Collect the group values from all `structure.import-group` observations emitted during this call (filter `observations` for those added in this method, or track them separately).
2. Deduplicate preserving first-seen order: `const uniqueOrder = [...new Set(groupSequence)]`.
3. If `uniqueOrder.length > 0`, push one observation:

```typescript
observations.push({
  type: "structure.import-order",
  category: "structure",
  value: JSON.stringify(uniqueOrder),
  file: file.filePath,
  line: 1,
  metadata: { groupCount: uniqueOrder.length },
});
```

Implementation hint: the simplest approach is to track the group sequence in a local array before the loop, push to it inside the `if (source)` block alongside the existing observation push, then use it after the loop.

### Step 2: Rename stability map keys in `stability.ts`

In `packages/analyzer/src/aggregator/stability.ts`, rename these keys in the `STABILITY_MAP` object under the "Category 2: Code Structure" comment:

| Old Key | New Key | Stability (unchanged) |
|---------|---------|-----------------------|
| `"structure.importGrouping"` | `"structure.import-group"` | `"high"` |
| `"structure.exportStyle"` | `"structure.export-style"` | `"high"` |
| `"structure.barrelFiles"` | `"structure.barrel-file"` | `"medium"` |
| `"structure.exportProximity"` | `"structure.export-proximity"` | `"medium"` |

Add one new entry in the same section:
```typescript
"structure.import-order": "high",
```

Do NOT rename any other keys (other categories use camelCase and their extractors also use camelCase -- only the structure extractor has this mismatch).

### Step 3: Add import-order test in `structure.test.ts`

In `packages/analyzer/src/__tests__/structure.test.ts`, inside the existing `describe("TypeScript", ...)` block (which already has `observations` loaded from `structure-sample.ts`), add a new test:

```typescript
it("emits import-order observation with correct sequence", () => {
  const importOrder = observations.filter(
    (o) => o.type === "structure.import-order",
  );
  expect(importOrder.length).toBe(1);
  expect(JSON.parse(importOrder[0].value as string)).toEqual([
    "builtin",
    "external",
    "internal",
    "relative",
  ]);
  expect(importOrder[0].metadata?.groupCount).toBe(4);
});
```

The fixture `structure-sample.ts` has imports in builtin -> external -> internal -> relative order (2 of each), so the deduplicated sequence is `["builtin","external","internal","relative"]`.

### Step 4: Run tests

```bash
cd /Users/hjewkes/Documents/projects/code-style && pnpm test
```

All tests must pass, including the new import-order test and all existing structure tests.

### Step 5: Commit

```bash
git add packages/analyzer/src/extractors/structure.ts packages/analyzer/src/aggregator/stability.ts packages/analyzer/src/__tests__/structure.test.ts
git commit -m "Add structure.import-order observation and fix stability map keys"
```

## Success Criteria

- [ ] `structure.import-order` observation is emitted once per file with `value` as a JSON-stringified array of unique groups in order
- [ ] `STABILITY_MAP` keys match the kebab-case types emitted by `StructureExtractor`: `structure.import-group`, `structure.export-style`, `structure.export-proximity`, `structure.barrel-file`, `structure.import-order`
- [ ] New test passes: verifies import-order observation with correct sequence from `structure-sample.ts`
- [ ] All existing tests continue to pass (no regressions)
- [ ] `pnpm test` exits cleanly

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not rename stability map keys outside the structure category -- only structure keys have the mismatch
5. Do not change the existing `structure.import-group` per-import observations -- only ADD the new `structure.import-order` observation
