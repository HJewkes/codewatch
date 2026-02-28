# Task 02: Profile Schema

## Architectural Context

The profile schema is the central data contract for the entire system. Every pipeline stage reads or writes this schema: extractors produce observations that the aggregator maps into it, the checker reads it to generate lint configs, and exporters transform it into tool-specific formats. Getting the types right here prevents cascading changes later. The schema lives in `@code-style/profile` and uses Zod for runtime validation with inferred TypeScript types.

## File Ownership

**May modify:**
- `/packages/profile/package.json` (add zod dependency)
- `/packages/profile/src/index.ts` (re-export public API)
- `/packages/profile/src/schema/style-rule.ts` (NEW)
- `/packages/profile/src/schema/profile.ts` (NEW)
- `/packages/profile/src/schema/index.ts` (NEW)
- `/packages/profile/src/io.ts` (NEW)
- `/packages/profile/src/migrations/index.ts` (NEW)
- `/packages/profile/src/migrations/registry.ts` (NEW)
- `/packages/profile/src/defaults.ts` (NEW)
- `/packages/profile/src/__tests__/schema.test.ts` (NEW)
- `/packages/profile/src/__tests__/io.test.ts` (NEW)
- `/packages/profile/src/__tests__/migrations.test.ts` (NEW)

**Must not touch:**
- `/packages/analyzer/**`
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`

**Read for context (do not modify):**
- `/docs/plans/2026-02-27-code-style-design.md` (profile JSON example, storage layout)
- `/docs/research/07-unified-feature-taxonomy.md` (feature categories)

## Steps

### Step 1: Add zod dependency

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm --filter @code-style/profile add zod
```

### Step 2: Write the StyleRule schema — test first

**`packages/profile/src/__tests__/schema.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import {
  StyleRuleSchema,
  ProfileSchema,
  SCHEMA_VERSION,
  type StyleRule,
  type Profile,
} from "../schema/index.js";

describe("StyleRule", () => {
  it("validates a complete style rule", () => {
    const rule: StyleRule = {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      fixability: "maybe-incorrect",
      description: "Use camelCase for local variables",
      examples: [
        {
          good: "const userProfile = await fetchUser(id);",
          source: "repo-a/src/users.ts:42",
        },
        { bad: "const up = await fetchUser(id);" },
      ],
      extensions: {
        eslint: {
          rule: "@typescript-eslint/naming-convention",
          options: [{ selector: "variable", format: ["camelCase"] }],
        },
      },
    };

    const result = StyleRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it("validates a minimal style rule", () => {
    const rule = {
      convention: "camelCase",
      confidence: 0.94,
    };

    const result = StyleRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it("rejects confidence outside 0-1 range", () => {
    const rule = { convention: "camelCase", confidence: 1.5 };
    const result = StyleRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid stability value", () => {
    const rule = { convention: "camelCase", confidence: 0.8, stability: "extreme" };
    const result = StyleRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid fixability value", () => {
    const rule = { convention: "camelCase", confidence: 0.8, fixability: "auto" };
    const result = StyleRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });
});

describe("Profile", () => {
  it("validates a complete profile", () => {
    const profile: Profile = {
      $schema: "https://json.schemastore.org/code-style-profile.json",
      schemaVersion: SCHEMA_VERSION,
      author: "testuser",
      generated: "2026-02-27",
      sources: ["owner/repo-a", "owner/repo-b"],
      naming: {
        variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
        functions: { convention: "camelCase", confidence: 0.97, stability: "high" },
        types: { convention: "PascalCase", confidence: 0.99, stability: "high" },
      },
      structure: {
        importOrder: {
          convention: ["builtin", "external", "internal", "relative"],
          confidence: 0.91,
          fixability: "safe",
        },
      },
      documentation: {
        functionDocs: { convention: "jsdoc-selective", confidence: 0.80 },
      },
      errorHandling: {
        style: { convention: "return-errors", confidence: 0.72, stability: "high" },
      },
      formatting: {
        semicolons: { convention: true, confidence: 0.99, stability: "high", fixability: "safe" },
      },
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
      severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
    };

    const result = ProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("applies default severity thresholds when omitted", () => {
    const profile = {
      schemaVersion: SCHEMA_VERSION,
      author: "testuser",
      generated: "2026-02-27",
      sources: [],
      naming: {},
      structure: {},
      documentation: {},
      errorHandling: {},
      formatting: {},
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
    };

    const result = ProfileSchema.parse(profile);
    expect(result.severityThresholds).toEqual({
      error: 0.85,
      warn: 0.60,
      info: 0.40,
    });
  });

  it("rejects missing required top-level fields", () => {
    const result = ProfileSchema.safeParse({ schemaVersion: "1.0.0" });
    expect(result.success).toBe(false);
  });
});
```

Run: `pnpm test -- packages/profile` -- expect failures (modules don't exist yet).

### Step 3: Implement StyleRule schema

**`packages/profile/src/schema/style-rule.ts`**:

```ts
import { z } from "zod";

export const ExampleSchema = z.object({
  good: z.string().optional(),
  bad: z.string().optional(),
  source: z.string().optional(),
});

export const StabilitySchema = z.enum(["high", "medium", "low"]);

export const FixabilitySchema = z.enum([
  "safe",
  "maybe-incorrect",
  "requires-input",
  "not-fixable",
]);

export const StyleRuleSchema = z.object({
  convention: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ]),
  confidence: z.number().min(0).max(1),
  stability: StabilitySchema.optional(),
  fixability: FixabilitySchema.optional(),
  description: z.string().optional(),
  examples: z.array(ExampleSchema).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type StyleRule = z.infer<typeof StyleRuleSchema>;
export type Stability = z.infer<typeof StabilitySchema>;
export type Fixability = z.infer<typeof FixabilitySchema>;
```

### Step 4: Implement Profile schema

**`packages/profile/src/schema/profile.ts`**:

```ts
import { z } from "zod";
import { StyleRuleSchema } from "./style-rule.js";

export const SCHEMA_VERSION = "1.0.0";

const CategorySchema = z.record(z.string(), StyleRuleSchema);

const IdiomSchema = z.object({
  name: z.string(),
  description: z.string(),
  frequency: z.number(),
  confidence: z.number().min(0).max(1),
  example: z.string().optional(),
});

const AntiPatternSchema = z.object({
  pattern: z.string(),
  reason: z.string(),
  deprecated: z.boolean().optional(),
});

const OverrideSchema = z.object({
  files: z.array(z.string()),
  naming: CategorySchema.optional(),
  structure: CategorySchema.optional(),
  documentation: CategorySchema.optional(),
  errorHandling: CategorySchema.optional(),
  formatting: CategorySchema.optional(),
  patterns: CategorySchema.optional(),
});

const SeverityThresholdsSchema = z.object({
  error: z.number().min(0).max(1),
  warn: z.number().min(0).max(1),
  info: z.number().min(0).max(1),
});

export const DEFAULT_SEVERITY_THRESHOLDS = {
  error: 0.85,
  warn: 0.60,
  info: 0.40,
} as const;

export const ProfileSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.string(),
  author: z.string(),
  generated: z.string(),
  sources: z.array(z.string()),

  naming: CategorySchema,
  structure: CategorySchema,
  documentation: CategorySchema,
  errorHandling: CategorySchema,
  formatting: CategorySchema,
  patterns: CategorySchema,

  idioms: z.object({
    detected: z.array(IdiomSchema),
  }),

  antiPatterns: z.object({
    acknowledged: z.array(AntiPatternSchema),
  }),

  overrides: z.array(OverrideSchema),

  severityThresholds: SeverityThresholdsSchema.default(DEFAULT_SEVERITY_THRESHOLDS),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type SeverityThresholds = z.infer<typeof SeverityThresholdsSchema>;
```

### Step 5: Create schema barrel export

**`packages/profile/src/schema/index.ts`**:

```ts
export {
  StyleRuleSchema,
  ExampleSchema,
  StabilitySchema,
  FixabilitySchema,
  type StyleRule,
  type Stability,
  type Fixability,
} from "./style-rule.js";

export {
  ProfileSchema,
  SCHEMA_VERSION,
  DEFAULT_SEVERITY_THRESHOLDS,
  type Profile,
  type SeverityThresholds,
} from "./profile.js";
```

Run: `pnpm test -- packages/profile` -- schema tests should now pass.

### Step 6: Write I/O tests

**`packages/profile/src/__tests__/io.test.ts`**:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readProfile, writeProfile, validateProfile } from "../io.js";
import { SCHEMA_VERSION, DEFAULT_SEVERITY_THRESHOLDS } from "../schema/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Profile I/O", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const minimalProfile = {
    schemaVersion: SCHEMA_VERSION,
    author: "testuser",
    generated: "2026-02-27",
    sources: [],
    naming: {},
    structure: {},
    documentation: {},
    errorHandling: {},
    formatting: {},
    patterns: {},
    idioms: { detected: [] },
    antiPatterns: { acknowledged: [] },
    overrides: [],
  };

  it("round-trips a profile through write and read", async () => {
    const filePath = path.join(testDir, "profile.json");

    await writeProfile(filePath, minimalProfile);
    const loaded = await readProfile(filePath);

    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.author).toBe("testuser");
    expect(loaded.severityThresholds).toEqual(DEFAULT_SEVERITY_THRESHOLDS);
  });

  it("throws on invalid profile JSON", async () => {
    const filePath = path.join(testDir, "profile.json");
    await fs.writeFile(filePath, '{"invalid": true}');

    await expect(readProfile(filePath)).rejects.toThrow();
  });

  it("validateProfile returns errors for invalid data", () => {
    const result = validateProfile({ bad: "data" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("validateProfile returns parsed data for valid input", () => {
    const result = validateProfile(minimalProfile);
    expect(result.success).toBe(true);
  });
});
```

Run: `pnpm test -- packages/profile` -- I/O tests fail (module doesn't exist yet).

### Step 7: Implement I/O

**`packages/profile/src/io.ts`**:

```ts
import * as fs from "node:fs/promises";
import { ProfileSchema, type Profile } from "./schema/index.js";

export async function readProfile(filePath: string): Promise<Profile> {
  const raw = await fs.readFile(filePath, "utf-8");
  const json: unknown = JSON.parse(raw);
  return ProfileSchema.parse(json);
}

export async function writeProfile(
  filePath: string,
  profile: unknown,
): Promise<void> {
  const validated = ProfileSchema.parse(profile);
  await fs.writeFile(filePath, JSON.stringify(validated, null, 2) + "\n");
}

export function validateProfile(data: unknown) {
  return ProfileSchema.safeParse(data);
}
```

Run: `pnpm test -- packages/profile` -- I/O tests should pass.

### Step 8: Write migration tests

**`packages/profile/src/__tests__/migrations.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { migrateProfile, registerMigration } from "../migrations/index.js";

describe("Migration framework", () => {
  it("returns profile unchanged when already at current version", () => {
    const profile = { schemaVersion: "1.0.0", data: "test" };
    const result = migrateProfile(profile as any);
    expect(result.schemaVersion).toBe("1.0.0");
  });

  it("applies migrations in order", () => {
    registerMigration({
      from: "0.9.0",
      to: "1.0.0",
      migrate: (p: any) => ({ ...p, schemaVersion: "1.0.0", migrated: true }),
    });

    const profile = { schemaVersion: "0.9.0" };
    const result = migrateProfile(profile as any);
    expect(result.schemaVersion).toBe("1.0.0");
    expect((result as any).migrated).toBe(true);
  });

  it("throws for unknown schema version with no migration path", () => {
    const profile = { schemaVersion: "0.1.0" };
    expect(() => migrateProfile(profile as any)).toThrow();
  });
});
```

### Step 9: Implement migration framework

**`packages/profile/src/migrations/registry.ts`**:

```ts
export interface Migration {
  from: string;
  to: string;
  migrate: (profile: Record<string, unknown>) => Record<string, unknown>;
}

const migrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.from.localeCompare(b.from));
}

export function getMigrations(): ReadonlyArray<Migration> {
  return migrations;
}

export function clearMigrations(): void {
  migrations.length = 0;
}
```

**`packages/profile/src/migrations/index.ts`**:

```ts
import { SCHEMA_VERSION } from "../schema/index.js";
import { getMigrations, registerMigration, clearMigrations } from "./registry.js";

export { registerMigration, clearMigrations };

export function migrateProfile(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  let current = { ...profile };
  const version = current.schemaVersion as string;

  if (version === SCHEMA_VERSION) {
    return current;
  }

  const migrations = getMigrations();
  let currentVersion = version;

  for (const migration of migrations) {
    if (migration.from === currentVersion) {
      current = migration.migrate(current);
      currentVersion = migration.to;
    }
  }

  if (currentVersion !== SCHEMA_VERSION) {
    throw new Error(
      `No migration path from version ${version} to ${SCHEMA_VERSION}`,
    );
  }

  return current;
}
```

Run: `pnpm test -- packages/profile` -- all tests pass.

### Step 10: Wire up package entry point

**`packages/profile/src/index.ts`**:

```ts
export {
  StyleRuleSchema,
  ExampleSchema,
  StabilitySchema,
  FixabilitySchema,
  ProfileSchema,
  SCHEMA_VERSION,
  DEFAULT_SEVERITY_THRESHOLDS,
  type StyleRule,
  type Stability,
  type Fixability,
  type Profile,
  type SeverityThresholds,
} from "./schema/index.js";

export { readProfile, writeProfile, validateProfile } from "./io.js";

export { migrateProfile, registerMigration } from "./migrations/index.js";
```

### Step 11: Verify and commit

```bash
pnpm typecheck
pnpm test -- packages/profile
pnpm build
```

```bash
git add packages/profile/
git commit -m "Add profile schema with Zod validation, I/O, and migration framework"
```

## Success Criteria

- [ ] `pnpm test -- packages/profile` passes all tests (schema validation, I/O round-trip, migrations)
- [ ] `pnpm typecheck` exits 0
- [ ] `StyleRuleSchema` validates the full rule shape from the design doc JSON example
- [ ] `ProfileSchema` validates both complete and minimal profiles
- [ ] Default severity thresholds are applied when omitted
- [ ] `readProfile`/`writeProfile` round-trip preserves data
- [ ] `validateProfile` returns structured errors for invalid input
- [ ] Migration framework applies ordered migrations and throws on unknown versions
- [ ] `pnpm build` produces valid `.d.ts` files for all exported types

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace
2. **Do not skip the verify step** -- run typecheck and tests before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use `any` types** -- use `z.infer<>` for all derived types, `unknown` for unvalidated input
5. **Do not make all StyleRule fields required** -- only `convention` and `confidence` are required; the rest are optional to support partial profiles from early pipeline stages
6. **Do not hardcode the convention field type** -- it must accept `string | number | boolean | string[]` to handle all profile categories (naming uses strings, formatting uses booleans, importOrder uses arrays)
7. **Do not put validation logic in I/O functions** -- `readProfile` uses `ProfileSchema.parse()`, not custom validation code
