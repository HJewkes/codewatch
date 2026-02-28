# Task 07: Roundtrip Test

## Architectural Context

This is the most important integration test. It validates the system's core value proposition: analyze code to produce a profile, then check that same code against the profile and find low violations. The roundtrip proves that the pipeline is self-consistent.

The flow:
1. Read golden corpus files (10 TypeScript files with consistent style)
2. Parse each file with `parseFile` (WASM-based, async)
3. Run all 5 extractors to produce `Observation[]`
4. Aggregate with `Aggregator` to get `AggregatorResult`
5. Convert aggregated features into a `Profile` shape, validate with `ProfileSchema.parse()`
6. Use `diffAgainstProfile(profile, observations)` to check the SAME observations against the profile
7. Assert: deviations are < 10% of total observations

Key types and imports:
- `parseFile`, extractors, `Aggregator`, `AggregatorResult`, `AggregatedFeature` from `@code-style/analyzer`
- `ProfileSchema`, `Profile`, `SCHEMA_VERSION`, `DEFAULT_SEVERITY_THRESHOLDS`, `PROFILE_CATEGORIES` from `@code-style/profile`
- `diffAgainstProfile`, `DiffResult` from `@code-style/cli` — exported via `packages/cli/src/commands/diff.ts` and re-exported from `packages/cli/src/commands/index.ts`

Note on CLI imports: The CLI package's main entry (`packages/cli/src/index.ts`) is a commander script, not a library barrel. However, `diffAgainstProfile` is exported from `packages/cli/src/commands/index.ts`. The package.json `exports` field points to `./dist/index.js`. Since the test runs in a workspace context, import directly from the source module path: `@code-style/cli/src/commands/diff.js` may not resolve. Instead, use a relative path to the CLI source or check if the commands subpath is accessible. The safest approach is a relative import from the test file to the CLI source.

Profile construction from aggregated features: The `AggregatorResult.features` map has entries like `"naming.variable"` with `convention`, `confidence`, `stability`, `severity`. These must be grouped into profile categories (`naming`, `structure`, `documentation`, `errorHandling`, `formatting`, `patterns`) where each category is a `Record<string, StyleRule>`. A `StyleRule` has `convention`, `confidence`, optional `stability`, `fixability`, `description`, `examples`, `extensions`.

## File Ownership

**May create/modify:**
- `tests/integration/roundtrip/profile-roundtrip.test.ts`

**Must not touch:**
- `packages/**` (all package source code)
- `tests/integration/fixtures/**` (fixtures from Tasks 02 and 03)
- `tests/integration/pipeline/**` (Task 05)
- `tests/integration/exports/**` (Task 06)
- `tests/integration/vitest.config.ts` (Task 04)

**Read for context (do not modify):**
- `packages/cli/src/commands/diff.ts` — `diffAgainstProfile` function, `DiffResult` and `Deviation` types
- `packages/cli/src/commands/index.ts` — re-exports `diffAgainstProfile`
- `packages/analyzer/src/aggregator/index.ts` — `Aggregator`, `AggregatedFeature`, `AggregatorResult`
- `packages/profile/src/schema/profile.ts` — `ProfileSchema`, `PROFILE_CATEGORIES`, `Profile` type
- `packages/profile/src/schema/style-rule.ts` — `StyleRule` shape: `{ convention, confidence, stability?, fixability?, description?, examples?, extensions? }`

## Steps

### Step 1: Write the roundtrip test

Create `tests/integration/roundtrip/profile-roundtrip.test.ts`:

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
  PROFILE_CATEGORIES as ANALYZER_CATEGORIES,
} from "@code-style/analyzer"
import type {
  Observation,
  ParsedFile,
  Extractor,
  AggregatorResult,
  AggregatedFeature,
} from "@code-style/analyzer"
import {
  ProfileSchema,
  SCHEMA_VERSION,
  DEFAULT_SEVERITY_THRESHOLDS,
  PROFILE_CATEGORIES,
} from "@code-style/profile"
import type { Profile, StyleRule } from "@code-style/profile"

/**
 * Import diffAgainstProfile from the CLI commands module.
 * The CLI package re-exports this from packages/cli/src/commands/index.ts
 * but the package entry point is the commander script. Use a relative path.
 */
import { diffAgainstProfile } from "../../../packages/cli/src/commands/diff.js"
import type { DiffResult } from "../../../packages/cli/src/commands/diff.js"

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

async function runFullPipeline(): Promise<{
  observations: Observation[]
  result: AggregatorResult
}> {
  const corpusFiles = await loadCorpusFiles()
  const extractors = createExtractors()
  const observations: Observation[] = []

  for (const file of corpusFiles) {
    const parsed = await parseFile(file.content, file.path, "typescript")
    if (!parsed) continue
    for (const extractor of extractors) {
      observations.push(...extractor.extract(parsed))
    }
  }

  const aggregator = new Aggregator()
  const result = aggregator.aggregate(observations)
  return { observations, result }
}

/**
 * Convert AggregatorResult features into a Profile-compatible shape.
 * Groups features by their category prefix (e.g. "naming.variable" -> naming)
 * and builds StyleRule entries for each.
 */
function buildProfileFromFeatures(
  features: Map<string, AggregatedFeature>,
): Profile {
  const categoryMap: Record<string, Record<string, StyleRule>> = {}

  for (const category of PROFILE_CATEGORIES) {
    categoryMap[category] = {}
  }

  for (const [featureType, feature] of features) {
    const dotIndex = featureType.indexOf(".")
    if (dotIndex < 0) continue

    const category = featureType.substring(0, dotIndex)
    const ruleName = featureType.substring(dotIndex + 1)

    // Map observation categories to profile categories
    let profileCategory: string
    if (category === "error-handling") {
      profileCategory = "errorHandling"
    } else if (category === "control-flow") {
      // control-flow observations map to patterns
      profileCategory = "patterns"
    } else if (PROFILE_CATEGORIES.includes(category as any)) {
      profileCategory = category
    } else {
      // Skip categories that don't map to profile sections
      continue
    }

    if (!categoryMap[profileCategory]) {
      categoryMap[profileCategory] = {}
    }

    categoryMap[profileCategory][ruleName] = {
      convention: feature.convention as string | number | boolean | string[],
      confidence: feature.confidence,
      stability: feature.stability,
    }
  }

  const profile: Profile = ProfileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    author: "integration-test",
    generated: new Date().toISOString(),
    sources: ["golden-corpus"],
    naming: categoryMap["naming"] ?? {},
    structure: categoryMap["structure"] ?? {},
    documentation: categoryMap["documentation"] ?? {},
    errorHandling: categoryMap["errorHandling"] ?? {},
    formatting: categoryMap["formatting"] ?? {},
    patterns: categoryMap["patterns"] ?? {},
    idioms: { detected: [] },
    antiPatterns: { acknowledged: [] },
    overrides: [],
    severityThresholds: DEFAULT_SEVERITY_THRESHOLDS,
  })

  return profile
}

describe("Profile roundtrip integration", () => {
  let observations: Observation[]
  let aggregatorResult: AggregatorResult
  let profile: Profile
  let diffResult: DiffResult

  beforeAll(async () => {
    const pipeline = await runFullPipeline()
    observations = pipeline.observations
    aggregatorResult = pipeline.result

    profile = buildProfileFromFeatures(aggregatorResult.features)
    diffResult = diffAgainstProfile(profile, observations)
  })

  it("parses corpus and produces observations", () => {
    expect(observations.length).toBeGreaterThan(0)
  })

  it("aggregates into features", () => {
    expect(aggregatorResult.features.size).toBeGreaterThan(0)
  })

  it("produces a valid profile from aggregated features", () => {
    // ProfileSchema.parse() already ran in buildProfileFromFeatures.
    // Verify key structure.
    expect(profile.schemaVersion).toBe(SCHEMA_VERSION)
    expect(profile.naming).toBeDefined()
    expect(Object.keys(profile.naming).length).toBeGreaterThan(0)
  })

  it("profile contains expected naming conventions", () => {
    const variableRule = profile.naming["variable"]
    if (variableRule) {
      expect(variableRule.convention).toBe("camelCase")
    }

    const functionRule = profile.naming["function"]
    if (functionRule) {
      expect(functionRule.convention).toBe("camelCase")
    }
  })

  it("diffing the same corpus against its own profile yields low deviations", () => {
    const { total, deviating } = diffResult.summary
    expect(total).toBeGreaterThan(0)

    // Core assertion: deviations should be less than 10% of total observations
    const deviationRate = deviating / total
    expect(deviationRate).toBeLessThan(0.1)
  })

  it("majority of observations match the profile", () => {
    const { total, matching } = diffResult.summary
    expect(total).toBeGreaterThan(0)

    const matchRate = matching / total
    // At least 50% of observations should match
    // (some observations may not map to profile categories, so they aren't counted)
    expect(matchRate).toBeGreaterThan(0.5)
  })

  it("deviations are low severity when present", () => {
    if (diffResult.deviations.length === 0) return

    // Most deviations should be info or warn, not error
    const errorDeviations = diffResult.deviations.filter(
      (d) => d.severity === "error",
    )
    const errorRate = errorDeviations.length / diffResult.deviations.length
    // Error-severity deviations should be rare in a self-consistent roundtrip
    expect(errorRate).toBeLessThan(0.5)
  })

  it("all profile categories have valid StyleRule entries", () => {
    for (const category of PROFILE_CATEGORIES) {
      const section = profile[category]
      if (!section) continue
      for (const [ruleName, rule] of Object.entries(section)) {
        expect(rule.convention).toBeDefined()
        expect(rule.confidence).toBeGreaterThanOrEqual(0)
        expect(rule.confidence).toBeLessThanOrEqual(1)
      }
    }
  })

  it("roundtrip preserves high-confidence conventions", () => {
    // For features with confidence > 0.85, check that the diffResult
    // does not flag them as deviating for the majority of their observations.
    const highConfFeatures = Array.from(aggregatorResult.features.entries())
      .filter(([, f]) => f.confidence > 0.85)

    for (const [featureType] of highConfFeatures) {
      const featureDeviations = diffResult.deviations.filter(
        (d) => d.rule === featureType,
      )
      const featureObservations = observations.filter(
        (o) => o.type === featureType,
      )

      if (featureObservations.length === 0) continue

      const featureDeviationRate =
        featureDeviations.length / featureObservations.length
      // High-confidence features should have < 20% deviation in roundtrip
      expect(featureDeviationRate).toBeLessThan(0.2)
    }
  })
})
```

### Step 2: Verify the test runs

```bash
pnpm test tests/integration/roundtrip/
```

Expected: all tests pass. The roundtrip proves that code -> profile -> diff produces < 10% deviations.

### Step 3: Verify all integration tests together

```bash
pnpm test tests/integration/
```

Expected: all pipeline, export, and roundtrip tests pass.

### Step 4: Verify full test suite

```bash
pnpm test
```

Expected: all existing unit tests (344+) plus all new integration tests pass.

### Step 5: Commit

```bash
git add tests/integration/roundtrip/profile-roundtrip.test.ts
git commit -m "Add roundtrip integration test for profile self-consistency"
```

## Success Criteria

- [ ] `pnpm test tests/integration/roundtrip/` passes (all tests green)
- [ ] Roundtrip test validates < 10% deviation rate when checking corpus against its own profile
- [ ] Profile is validated by `ProfileSchema.parse()` with no errors
- [ ] High-confidence features (> 0.85) have < 20% deviation in roundtrip
- [ ] All profile categories contain valid `StyleRule` entries
- [ ] `pnpm test` still passes (all existing tests + all integration tests)

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not modify the golden corpus files or fixtures — they are read-only
5. Do not hardcode expected profile values — the roundtrip test validates self-consistency, not specific values
6. Do not expect 0% deviations — the aggregator may produce features for observation categories that don't cleanly map to profile categories, and `diffAgainstProfile` only checks observations whose type matches a profile rule
7. Do not make the `buildProfileFromFeatures` function overly complex — it only needs to handle the basic category.rule mapping; enrichment features like AI descriptions are not needed
8. Do not import `diffAgainstProfile` from `@code-style/cli` package entry (it's the CLI script, not a library) — use a relative import to the source file
9. Do not skip `ProfileSchema.parse()` validation — this is a critical part of the roundtrip proving the constructed profile is schema-valid
