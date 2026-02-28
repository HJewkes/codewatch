# Task 02: Regenerate Expected Profile Script

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. Integration tests use `tests/integration/fixtures/corpus/expected-profile.json` as a snapshot of the expected aggregation output when the full extraction pipeline runs against the TypeScript corpus in `tests/integration/fixtures/corpus/typescript/`. After Task 01 changes the stability map keys and adds the `structure.import-order` observation, this profile needs regeneration. This task creates the script; Task 03 runs it.

The corpus contains 10 TypeScript files:
- `config-app.ts`, `controller-auth.ts`, `handler-webhook.ts`, `middleware-logging.ts`, `model-payment.ts`, `repository-user.ts`, `routes-index.ts`, `service-user.ts`, `types-api.ts`, `utils-string.ts`

The pipeline is: `parseFile()` -> extractors -> `Aggregator.aggregate()` -> features map.

## File Ownership

**May modify:**
- `scripts/regenerate-expected-profile.ts` (new file)

**Must not touch:**
- `tests/integration/fixtures/corpus/expected-profile.json` (Task 03 handles this)
- Any package source code
- Any test files

## Steps

### Step 1: Create `scripts/regenerate-expected-profile.ts`

Create the file at `/Users/hjewkes/Documents/projects/code-style/scripts/regenerate-expected-profile.ts`.

The script must:

1. **Load corpus files**: Read all `.ts` files from `tests/integration/fixtures/corpus/typescript/` using `fs.readdirSync` + `fs.readFileSync`.

2. **Parse each file**: Use `parseFile(content, filePath, "typescript")` from `packages/analyzer/src/extractors/parser.js`.

3. **Run all 5 extractors** on each parsed file and collect observations into a single array:
   - `NamingExtractor`
   - `StructureExtractor`
   - `ControlFlowExtractor`
   - `DocumentationExtractor`
   - `ErrorHandlingExtractor`

   Import these from `packages/analyzer/src/extractors/index.js`.

4. **Aggregate**: Create an `Aggregator` instance (from `packages/analyzer/src/aggregator/index.js`) and call `aggregator.aggregate(allObservations)`.

5. **Convert to plain object**: Iterate the `result.features` Map and build a plain object where each key is the feature type and each value is `{ convention, confidence (rounded to 2 decimal places), severity }`.

6. **Write output**: Write the JSON (with 2-space indent) to `tests/integration/fixtures/corpus/expected-profile.json`.

7. **Log summary**: Print how many features were written, and if the file previously existed, log which keys were added, removed, or had changed values.

Use relative imports from the script location, e.g.:
```typescript
import { parseFile } from "../packages/analyzer/src/extractors/parser.js";
import { NamingExtractor, StructureExtractor, ControlFlowExtractor, DocumentationExtractor, ErrorHandlingExtractor } from "../packages/analyzer/src/extractors/index.js";
import { Aggregator } from "../packages/analyzer/src/aggregator/index.js";
```

The script should be runnable with:
```bash
npx tsx scripts/regenerate-expected-profile.ts
```

### Step 2: Commit

```bash
git add scripts/regenerate-expected-profile.ts
git commit -m "Add script to regenerate expected-profile.json from corpus"
```

## Success Criteria

- [ ] `scripts/regenerate-expected-profile.ts` exists and is syntactically valid TypeScript
- [ ] Script imports from the correct relative paths to package source
- [ ] Script uses all 5 extractors listed above (not more, not fewer)
- [ ] Output format matches the existing `expected-profile.json` shape: `{ [type]: { convention, confidence, severity } }`
- [ ] Confidence values are rounded to 2 decimal places
- [ ] Script logs a human-readable summary of changes
- [ ] Script is runnable with `npx tsx scripts/regenerate-expected-profile.ts`

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not actually run the script or modify `expected-profile.json` -- Task 03 does that
5. Do not add the script as a package.json script -- it is a standalone utility
