# Task 03: Run Regeneration + Drift Test

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. Task 01 fixed the stability map keys and added the `structure.import-order` observation. Task 02 created the regeneration script. This task runs the script to update `expected-profile.json` with corrected confidence values (structure observations now get proper stability lookup instead of falling through to "medium" default) and the new `structure.import-order` feature. It also adds a drift prevention test that ensures every observation type emitted by extractors has a corresponding entry in `STABILITY_MAP`, preventing future naming mismatches.

## File Ownership

**May modify:**
- `tests/integration/fixtures/corpus/expected-profile.json`
- `packages/analyzer/src/__tests__/stability.test.ts` (new file)

**Must not touch:**
- Any source code in `packages/analyzer/src/extractors/` or `packages/analyzer/src/aggregator/`
- `scripts/regenerate-expected-profile.ts`
- Any other test files

## Steps

### Step 1: Run the regeneration script

```bash
cd /Users/hjewkes/Documents/projects/code-style
npx tsx scripts/regenerate-expected-profile.ts
```

This updates `tests/integration/fixtures/corpus/expected-profile.json`.

### Step 2: Review the diff

Run `git diff tests/integration/fixtures/corpus/expected-profile.json` and verify:

1. **`structure.import-order` appears** as a new key with a reasonable convention value (a JSON-stringified array of import groups) and confidence > 0.
2. **Existing structure features** (`structure.import-group`, `structure.export-style`, `structure.export-proximity`) may have updated confidence values because they now get the correct stability lookup ("high" or "medium") instead of falling through to the "medium" default.
3. **No features were unexpectedly removed** -- all previously existing keys should still be present.
4. **Confidence values are reasonable** -- most should be between 0.3 and 1.0.

If the diff looks wrong, stop and investigate before proceeding.

### Step 3: Add drift prevention test

Create `packages/analyzer/src/__tests__/stability.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { parseFile } from "../extractors/parser.js";
import { NamingExtractor } from "../extractors/naming.js";
import { StructureExtractor } from "../extractors/structure.js";
import { ControlFlowExtractor } from "../extractors/control-flow.js";
import { DocumentationExtractor } from "../extractors/documentation.js";
import { ErrorHandlingExtractor } from "../extractors/error-handling.js";
import { STABILITY_MAP } from "../aggregator/stability.js";
import type { Observation } from "../extractors/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

The test should:

1. Load the existing fixture `packages/analyzer/src/__tests__/fixtures/structure-sample.ts` (it has imports, exports, and is already used by structure tests).
2. Parse it with `parseFile(content, filePath, "typescript")`.
3. Instantiate all 5 extractors: `NamingExtractor`, `StructureExtractor`, `ControlFlowExtractor`, `DocumentationExtractor`, `ErrorHandlingExtractor`.
4. Run each extractor's `extract()` method and collect all observations.
5. Get all unique observation types: `const types = [...new Set(observations.map(o => o.type))]`.
6. For each type, assert that `STABILITY_MAP[type]` is defined (not `undefined`). This verifies that `lookupStability(type)` will NOT fall through to the category-level or default "medium" fallback.

The test name should describe the scenario, e.g.:
```typescript
it("has a STABILITY_MAP entry for every observation type emitted by extractors", () => {
  // ...
  for (const type of types) {
    expect(STABILITY_MAP[type], `Missing STABILITY_MAP entry for "${type}"`).toBeDefined();
  }
});
```

Note: This fixture may not exercise every extractor fully (e.g., it may not trigger all control-flow or error-handling observations). That is acceptable -- the test catches the most common case of naming drift for observation types that ARE emitted. A more exhaustive fixture can be added later.

### Step 4: Run tests

```bash
cd /Users/hjewkes/Documents/projects/code-style && pnpm test
```

All tests must pass, including the new drift prevention test.

### Step 5: Commit

```bash
git add tests/integration/fixtures/corpus/expected-profile.json packages/analyzer/src/__tests__/stability.test.ts
git commit -m "Regenerate expected profile and add stability map drift test"
```

## Success Criteria

- [ ] `expected-profile.json` contains the `structure.import-order` feature
- [ ] Existing features in `expected-profile.json` are preserved (none removed)
- [ ] Confidence values in `expected-profile.json` are reasonable (0.3-1.0 range for most)
- [ ] Drift prevention test exists in `stability.test.ts`
- [ ] Drift test verifies every observation type from the 5 extractors has a `STABILITY_MAP` entry
- [ ] `pnpm test` passes cleanly

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not modify any source code -- this task only touches test files and the generated fixture
5. Do not skip reviewing the expected-profile.json diff before committing
