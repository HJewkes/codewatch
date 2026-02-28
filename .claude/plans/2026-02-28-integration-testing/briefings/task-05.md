# Task 05: Pipeline Integration Tests

## Architectural Context

The analyzer package provides a WASM-based parser (`parseFile`), five extractors (`NamingExtractor`, `StructureExtractor`, `ControlFlowExtractor`, `DocumentationExtractor`, `ErrorHandlingExtractor`), and an `Aggregator` that produces `AggregatorResult` with a `features` map of `AggregatedFeature` entries. Each feature has a `type` (e.g. `naming.variable`), `convention` (dominant value), and `confidence` (0-1).

The golden corpus (created by Task 02) is 10 TypeScript files at `tests/integration/fixtures/corpus/typescript/*.ts` with consistent camelCase variables/functions, PascalCase types, ordered imports, jsdoc-selective docs, no-semicolons, and early returns.

These tests validate that parsing the entire corpus, running all extractors, and aggregating produces the expected conventions with high confidence. The integration vitest config (Task 04) provides 30s timeout for WASM operations.

Key types:
- `parseFile(content, filePath, "typescript")` returns `Promise<ParsedFile | null>`
- `Extractor.extract(parsed)` returns `Observation[]` (sync)
- `Aggregator.aggregate(observations)` returns `AggregatorResult { features: Map<string, AggregatedFeature>, reviewQueue, summary }`
- `AggregatedFeature { type, category, convention, distribution, confidence, stability, severity, needsReview, examples }`

## File Ownership

**May create/modify:**
- `tests/integration/pipeline/full-pipeline.test.ts`
- `tests/integration/pipeline/extractor-corpus.test.ts`
- `tests/integration/fixtures/corpus/expected-profile.json`

**Must not touch:**
- `packages/**` (all package source code)
- `tests/integration/fixtures/corpus/typescript/*.ts` (golden corpus from Task 02)
- `tests/integration/vitest.config.ts` (from Task 04)
- `tests/integration/exports/**`
- `tests/integration/roundtrip/**`

**Read for context (do not modify):**
- `packages/analyzer/src/extractors/index.ts` — extractor exports
- `packages/analyzer/src/aggregator/index.ts` — `Aggregator` class and `AggregatorResult` type
- `packages/analyzer/src/extractors/types.ts` — `Observation`, `ParsedFile`, `Extractor` types
- `packages/profile/src/schema/profile.ts` — `ProfileSchema`, `PROFILE_CATEGORIES`, `Profile` type

## Steps

### Step 1: Write full-pipeline test

Create `tests/integration/pipeline/full-pipeline.test.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import {
  parseFile,
  NamingExtractor,
  StructureExtractor,
  ControlFlowExtractor,
  DocumentationExtractor,
  ErrorHandlingExtractor,
  Aggregator,
} from "@code-style/analyzer"
import type { Observation, ParsedFile, Extractor, AggregatorResult } from "@code-style/analyzer"

const CORPUS_DIR = join(__dirname, "../fixtures/corpus/typescript")

function createExtractors(): Extractor[] {
  return [
    new NamingExtractor(),
    new StructureExtractor(),
    new ControlFlowExtractor(),
    new DocumentationExtractor(),
    new ErrorHandlingExtractor(),
  ]
}

async function loadCorpusFiles(): Promise<{ content: string; path: string }[]> {
  const entries = await readdir(CORPUS_DIR)
  const tsFiles = entries.filter((f) => f.endsWith(".ts")).sort()
  const files: { content: string; path: string }[] = []
  for (const fileName of tsFiles) {
    const filePath = join(CORPUS_DIR, fileName)
    const content = await readFile(filePath, "utf-8")
    files.push({ content, path: filePath })
  }
  return files
}

async function parseCorpus(
  files: { content: string; path: string }[],
): Promise<ParsedFile[]> {
  const parsed: ParsedFile[] = []
  for (const file of files) {
    const result = await parseFile(file.content, file.path, "typescript")
    if (result) parsed.push(result)
  }
  return parsed
}

function extractAll(
  parsedFiles: ParsedFile[],
  extractors: Extractor[],
): Observation[] {
  const observations: Observation[] = []
  for (const parsed of parsedFiles) {
    for (const extractor of extractors) {
      observations.push(...extractor.extract(parsed))
    }
  }
  return observations
}

describe("Full pipeline integration", () => {
  let corpusFiles: { content: string; path: string }[]
  let parsedFiles: ParsedFile[]
  let observations: Observation[]
  let result: AggregatorResult

  beforeAll(async () => {
    corpusFiles = await loadCorpusFiles()
    parsedFiles = await parseCorpus(corpusFiles)
    const extractors = createExtractors()
    observations = extractAll(parsedFiles, extractors)
    const aggregator = new Aggregator()
    result = aggregator.aggregate(observations)
  })

  it("parses all corpus files successfully", () => {
    expect(corpusFiles.length).toBeGreaterThanOrEqual(10)
    expect(parsedFiles.length).toBe(corpusFiles.length)
  })

  it("produces observations from all extractors", () => {
    expect(observations.length).toBeGreaterThan(0)
    const categories = new Set(observations.map((o) => o.category))
    expect(categories.has("naming")).toBe(true)
    expect(categories.has("structure")).toBe(true)
    expect(categories.has("documentation")).toBe(true)
  })

  it("aggregates into features", () => {
    expect(result.features.size).toBeGreaterThan(0)
    expect(result.summary.totalObservations).toBe(observations.length)
  })

  it("detects camelCase variable naming convention", () => {
    const feature = result.features.get("naming.variable")
    expect(feature).toBeDefined()
    expect(feature!.convention).toBe("camelCase")
    expect(feature!.confidence).toBeGreaterThan(0.8)
  })

  it("detects camelCase function naming convention", () => {
    const feature = result.features.get("naming.function")
    expect(feature).toBeDefined()
    expect(feature!.convention).toBe("camelCase")
    expect(feature!.confidence).toBeGreaterThan(0.8)
  })

  it("detects PascalCase type naming convention", () => {
    const typeFeature =
      result.features.get("naming.type") ??
      result.features.get("naming.class") ??
      result.features.get("naming.interface")
    expect(typeFeature).toBeDefined()
    expect(typeFeature!.convention).toBe("PascalCase")
    expect(typeFeature!.confidence).toBeGreaterThan(0.8)
  })

  it("has high average confidence across features", () => {
    expect(result.summary.avgConfidence).toBeGreaterThan(0.5)
  })

  it("matches expected profile snapshot", async () => {
    const expectedPath = join(
      __dirname,
      "../fixtures/corpus/expected-profile.json",
    )
    let expected: Record<string, unknown>
    try {
      const raw = await readFile(expectedPath, "utf-8")
      expected = JSON.parse(raw)
    } catch {
      // If expected-profile.json doesn't exist yet, skip this assertion.
      // The agent should generate it on first run (see Step 3).
      console.warn(
        "expected-profile.json not found — run Step 3 to generate it",
      )
      return
    }

    const actual: Record<string, unknown> = {}
    for (const [key, feature] of result.features) {
      actual[key] = {
        convention: feature.convention,
        confidence: Math.round(feature.confidence * 100) / 100,
        severity: feature.severity,
      }
    }

    for (const [key, expectedFeature] of Object.entries(expected)) {
      const actualFeature = actual[key] as
        | { convention: unknown; confidence: number; severity: string }
        | undefined
      if (!actualFeature) continue
      const exp = expectedFeature as {
        convention: unknown
        confidence: number
      }
      expect(actualFeature.convention).toBe(exp.convention)
      // Allow 0.1 tolerance on confidence
      expect(actualFeature.confidence).toBeCloseTo(exp.confidence, 1)
    }
  })
})
```

### Step 2: Write extractor-corpus test

Create `tests/integration/pipeline/extractor-corpus.test.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import {
  parseFile,
  NamingExtractor,
  StructureExtractor,
  DocumentationExtractor,
  ErrorHandlingExtractor,
} from "@code-style/analyzer"
import type { Observation, ParsedFile } from "@code-style/analyzer"

const CORPUS_DIR = join(__dirname, "../fixtures/corpus/typescript")

async function parseAllCorpusFiles(): Promise<ParsedFile[]> {
  const entries = await readdir(CORPUS_DIR)
  const tsFiles = entries.filter((f) => f.endsWith(".ts")).sort()
  const parsed: ParsedFile[] = []
  for (const fileName of tsFiles) {
    const filePath = join(CORPUS_DIR, fileName)
    const content = await readFile(filePath, "utf-8")
    const result = await parseFile(content, filePath, "typescript")
    if (result) parsed.push(result)
  }
  return parsed
}

function extractWith<T extends { extract(file: ParsedFile): Observation[] }>(
  extractor: T,
  parsedFiles: ParsedFile[],
): Observation[] {
  const observations: Observation[] = []
  for (const parsed of parsedFiles) {
    observations.push(...extractor.extract(parsed))
  }
  return observations
}

function majorityValue(observations: Observation[]): string | number | boolean {
  const counts = new Map<string, number>()
  for (const obs of observations) {
    const key = String(obs.value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let maxKey = ""
  let maxCount = 0
  for (const [key, count] of counts) {
    if (count > maxCount) {
      maxKey = key
      maxCount = count
    }
  }
  return maxKey
}

describe("NamingExtractor corpus behavior", () => {
  let observations: Observation[]

  beforeAll(async () => {
    const parsedFiles = await parseAllCorpusFiles()
    observations = extractWith(new NamingExtractor(), parsedFiles)
  })

  it("produces naming observations", () => {
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every((o) => o.category === "naming")).toBe(true)
  })

  it("majority of variable observations are camelCase", () => {
    const variableObs = observations.filter(
      (o) => o.type === "naming.variable",
    )
    expect(variableObs.length).toBeGreaterThan(0)
    const majority = majorityValue(variableObs)
    expect(majority).toBe("camelCase")
  })

  it("majority of function observations are camelCase", () => {
    const functionObs = observations.filter(
      (o) => o.type === "naming.function",
    )
    expect(functionObs.length).toBeGreaterThan(0)
    const majority = majorityValue(functionObs)
    expect(majority).toBe("camelCase")
  })

  it("type/class/interface observations are PascalCase", () => {
    const typeObs = observations.filter(
      (o) =>
        o.type === "naming.type" ||
        o.type === "naming.class" ||
        o.type === "naming.interface",
    )
    if (typeObs.length === 0) return // may not be present in all corpus files
    const majority = majorityValue(typeObs)
    expect(majority).toBe("PascalCase")
  })
})

describe("StructureExtractor corpus behavior", () => {
  let observations: Observation[]

  beforeAll(async () => {
    const parsedFiles = await parseAllCorpusFiles()
    observations = extractWith(new StructureExtractor(), parsedFiles)
  })

  it("produces structure observations", () => {
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every((o) => o.category === "structure")).toBe(true)
  })

  it("detects import ordering patterns", () => {
    const importObs = observations.filter(
      (o) =>
        o.type.includes("import") ||
        o.type.includes("Import"),
    )
    // The corpus uses builtin -> external -> relative ordering
    // At minimum, import observations should be present
    expect(importObs.length).toBeGreaterThan(0)
  })
})

describe("DocumentationExtractor corpus behavior", () => {
  let observations: Observation[]

  beforeAll(async () => {
    const parsedFiles = await parseAllCorpusFiles()
    observations = extractWith(new DocumentationExtractor(), parsedFiles)
  })

  it("produces documentation observations", () => {
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every((o) => o.category === "documentation")).toBe(true)
  })

  it("detects jsdoc usage", () => {
    const jsdocObs = observations.filter(
      (o) =>
        o.type.includes("jsdoc") ||
        o.type.includes("Jsdoc") ||
        o.type.includes("doc") ||
        String(o.value).includes("jsdoc"),
    )
    expect(jsdocObs.length).toBeGreaterThan(0)
  })
})

describe("ErrorHandlingExtractor corpus behavior", () => {
  let observations: Observation[]

  beforeAll(async () => {
    const parsedFiles = await parseAllCorpusFiles()
    observations = extractWith(new ErrorHandlingExtractor(), parsedFiles)
  })

  it("produces error-handling observations when try-catch is present", () => {
    // The corpus may or may not have try-catch in all files.
    // If observations are produced, they should be categorized correctly.
    if (observations.length === 0) {
      // Acceptable: some corpus files may not have error handling
      return
    }
    expect(
      observations.every((o) => o.category === "error-handling"),
    ).toBe(true)
  })
})
```

### Step 3: Generate expected-profile.json

Run the pipeline once and capture the output. This is a manual step:

1. Run the full-pipeline test in isolation first (it will skip the snapshot assertion if the file is missing).
2. Add a temporary script or vitest helper that writes the aggregated features to `expected-profile.json`.
3. Hand-verify the key values in the JSON:
   - `naming.variable` convention is `"camelCase"`
   - `naming.function` convention is `"camelCase"`
   - Type-related naming convention is `"PascalCase"`
   - Confidence values are > 0.8 for consistent patterns
4. Save as `tests/integration/fixtures/corpus/expected-profile.json`.

The JSON format should be a flat object keyed by feature type:

```json
{
  "naming.variable": {
    "convention": "camelCase",
    "confidence": 0.95,
    "severity": "error"
  },
  "naming.function": {
    "convention": "camelCase",
    "confidence": 0.92,
    "severity": "error"
  }
}
```

To generate this, temporarily add to the full-pipeline test:

```typescript
// Add after aggregation in beforeAll, then remove after capturing output:
const snapshot: Record<string, unknown> = {}
for (const [key, feature] of result.features) {
  snapshot[key] = {
    convention: feature.convention,
    confidence: Math.round(feature.confidence * 100) / 100,
    severity: feature.severity,
  }
}
await writeFile(
  join(__dirname, "../fixtures/corpus/expected-profile.json"),
  JSON.stringify(snapshot, null, 2) + "\n",
)
```

Run `pnpm test tests/integration/pipeline/full-pipeline.test.ts`, inspect the output file, then remove the temporary write code.

### Step 4: Verify

```bash
pnpm test tests/integration/pipeline/
```

Expected: all tests pass. The full-pipeline test validates naming conventions and confidence thresholds. The extractor-corpus tests validate per-extractor majority behavior.

### Step 5: Commit

```bash
git add tests/integration/pipeline/full-pipeline.test.ts tests/integration/pipeline/extractor-corpus.test.ts tests/integration/fixtures/corpus/expected-profile.json
git commit -m "Add pipeline integration tests for corpus analysis"
```

## Success Criteria

- [ ] `pnpm test tests/integration/pipeline/` passes (all tests green)
- [ ] Full pipeline test validates camelCase variables, camelCase functions, PascalCase types
- [ ] Confidence thresholds > 0.8 for high-consistency patterns
- [ ] Extractor-corpus tests validate per-extractor majority values
- [ ] `expected-profile.json` exists with hand-verified values
- [ ] `pnpm test` still passes (all existing tests + new integration tests)

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not modify the golden corpus files — they are read-only fixtures from Task 02
5. Do not hardcode file paths to specific corpus files — use directory scanning
6. Do not skip WASM initialization — `parseFile` is async and needs `beforeAll`
7. Do not make assertions too tight on confidence values — use `> 0.8` thresholds, not exact equality
8. Do not leave the temporary snapshot-generation code in the final test file
