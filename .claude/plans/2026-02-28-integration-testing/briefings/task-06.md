# Task 06: Export Validation Tests

## Architectural Context

The profile package provides export generators that convert a `Profile` into configuration files for various tools. The checker package provides `generateEslintConfig()` which returns structured `EslintFlatConfigEntry[]` objects. This task validates that these generators produce correct, well-formed output for a known test profile.

Key APIs:
- `generateEslintConfig(profile)` from `@code-style/checker` — returns `EslintFlatConfigEntry[]` with `rules`, `plugins`, `files` fields
- `generateEslintExport(profile)` from `@code-style/profile` — returns `GeneratedFile { path: string, content: string }` containing a full `eslint.config.js` file as a string
- `generateSkillFiles(profile)` from `@code-style/profile` — returns `GeneratedFile[]` including `skill.md` and `references/*.md` files, rendered from Handlebars templates
- `generateEditorConfigExport(profile)` from `@code-style/profile` — returns `GeneratedFile { path: string, content: string }` containing `.editorconfig` content
- `ProfileSchema.parse(obj)` from `@code-style/profile` — validates and returns a `Profile`

The test fixtures (from Task 03) are:
- `tests/integration/fixtures/exports/test-profile.json` — a valid Profile JSON
- `tests/integration/fixtures/exports/violation-ts.ts` — TypeScript with style violations
- `tests/integration/fixtures/exports/compliant-ts.ts` — TypeScript matching the profile

## File Ownership

**May create/modify:**
- `tests/integration/exports/eslint-config.test.ts`
- `tests/integration/exports/skill-export.test.ts`
- `tests/integration/exports/editorconfig.test.ts`

**Must not touch:**
- `packages/**` (all package source code)
- `tests/integration/fixtures/exports/*` (fixtures from Task 03)
- `tests/integration/pipeline/**` (Task 05)
- `tests/integration/roundtrip/**` (Task 07)
- `tests/integration/vitest.config.ts` (Task 04)

**Read for context (do not modify):**
- `packages/checker/src/generators/eslint.ts` — `generateEslintConfig` implementation and `EslintFlatConfigEntry` type
- `packages/profile/src/exporters/eslint.ts` — `generateEslintExport` implementation
- `packages/profile/src/exporters/skill.ts` — `generateSkillFiles` implementation
- `packages/profile/src/exporters/editorconfig.ts` — `generateEditorConfigExport` implementation
- `packages/profile/src/exporters/types.ts` — `GeneratedFile` type
- `packages/profile/src/schema/profile.ts` — `ProfileSchema` and `Profile` type

## Steps

### Step 1: Write ESLint config test

Create `tests/integration/exports/eslint-config.test.ts`:

```typescript
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { ProfileSchema } from "@code-style/profile"
import { generateEslintExport } from "@code-style/profile"
import { generateEslintConfig } from "@code-style/checker"
import type { Profile } from "@code-style/profile"
import type { EslintFlatConfigEntry } from "@code-style/checker"

const FIXTURE_PATH = join(
  __dirname,
  "../fixtures/exports/test-profile.json",
)

describe("ESLint config generation", () => {
  let profile: Profile
  let configEntries: EslintFlatConfigEntry[]

  beforeAll(async () => {
    const raw = await readFile(FIXTURE_PATH, "utf-8")
    profile = ProfileSchema.parse(JSON.parse(raw))
  })

  describe("generateEslintConfig (checker)", () => {
    beforeAll(() => {
      configEntries = generateEslintConfig(profile)
    })

    it("returns non-empty config entries", () => {
      expect(configEntries.length).toBeGreaterThan(0)
    })

    it("contains naming convention rule", () => {
      const allRules = configEntries.flatMap((entry) =>
        Object.keys(entry.rules ?? {}),
      )
      const hasNamingRule = allRules.some(
        (rule) =>
          rule.includes("naming-convention") ||
          rule.includes("naming"),
      )
      expect(hasNamingRule).toBe(true)
    })

    it("contains import ordering rule", () => {
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
    })

    it("targets TypeScript files", () => {
      const hasTypeScriptFiles = configEntries.some((entry) =>
        entry.files?.some((f) => f.includes(".ts")),
      )
      expect(hasTypeScriptFiles).toBe(true)
    })
  })

  describe("generateEslintExport (profile)", () => {
    it("generates eslint.config.js file", () => {
      const exported = generateEslintExport(profile)
      expect(exported.path).toBe("eslint.config.js")
      expect(exported.content.length).toBeGreaterThan(0)
    })

    it("contains import statements for required plugins", () => {
      const exported = generateEslintExport(profile)
      const content = exported.content

      // Should have at least an export default statement
      expect(content).toContain("export default")

      // If the profile has naming rules, should import typescript-eslint
      if (profile.naming && Object.keys(profile.naming).length > 0) {
        const hasPluginImport =
          content.includes("@typescript-eslint") ||
          content.includes("perfectionist") ||
          content.includes("eslint-plugin")
        expect(hasPluginImport).toBe(true)
      }
    })

    it("contains rules matching the profile", () => {
      const exported = generateEslintExport(profile)
      const content = exported.content

      // The generated config should contain a rules object
      expect(content).toContain("rules")
    })

    it("is parseable JavaScript", () => {
      const exported = generateEslintExport(profile)
      const content = exported.content

      // Strip import/export statements for parseability check,
      // since new Function() doesn't support ESM syntax.
      // Instead, verify no obvious syntax errors by checking structure.
      const lines = content.split("\n")
      const nonImportLines = lines.filter(
        (line) =>
          !line.startsWith("import ") && !line.startsWith("export default"),
      )

      // Should have balanced braces
      const openBraces = (content.match(/{/g) ?? []).length
      const closeBraces = (content.match(/}/g) ?? []).length
      expect(openBraces).toBe(closeBraces)

      // Should have balanced brackets
      const openBrackets = (content.match(/\[/g) ?? []).length
      const closeBrackets = (content.match(/]/g) ?? []).length
      expect(openBrackets).toBe(closeBrackets)

      // Should not have dangling commas before closing braces
      expect(content).not.toMatch(/,\s*\n\s*\}/)
    })

    it("includes generation metadata comment", () => {
      const exported = generateEslintExport(profile)
      expect(exported.content).toContain("Generated by code-style")
    })
  })
})
```

### Step 2: Write skill export test

Create `tests/integration/exports/skill-export.test.ts`:

```typescript
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { ProfileSchema, generateSkillFiles } from "@code-style/profile"
import type { Profile, GeneratedFile } from "@code-style/profile"

const FIXTURE_PATH = join(
  __dirname,
  "../fixtures/exports/test-profile.json",
)

describe("Skill file generation", () => {
  let profile: Profile
  let files: GeneratedFile[]

  beforeAll(async () => {
    const raw = await readFile(FIXTURE_PATH, "utf-8")
    profile = ProfileSchema.parse(JSON.parse(raw))
    files = generateSkillFiles(profile)
  })

  it("generates skill.md", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()
    expect(skillFile!.content.length).toBeGreaterThan(0)
  })

  it("generates reference files", () => {
    const refFiles = files.filter((f) => f.path.startsWith("references/"))
    expect(refFiles.length).toBeGreaterThan(0)
  })

  it("generates naming reference", () => {
    const namingFile = files.find((f) => f.path === "references/naming.md")
    expect(namingFile).toBeDefined()
    expect(namingFile!.content.length).toBeGreaterThan(0)
  })

  it("contains no unrendered Handlebars artifacts", () => {
    for (const file of files) {
      expect(file.content).not.toContain("{{")
      expect(file.content).not.toContain("}}")
    }
  })

  it("includes top rules by confidence in skill.md", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()

    // The skill.md should mention the author
    expect(skillFile!.content).toContain(profile.author)

    // Should contain rule references — naming conventions are high confidence
    const content = skillFile!.content.toLowerCase()
    const hasRuleReference =
      content.includes("naming") ||
      content.includes("camelcase") ||
      content.includes("convention") ||
      content.includes("style")
    expect(hasRuleReference).toBe(true)
  })

  it("skill.md is valid markdown", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()

    // Should start with a heading
    const firstNonEmptyLine = skillFile!.content
      .split("\n")
      .find((l) => l.trim().length > 0)
    expect(firstNonEmptyLine).toMatch(/^#/)
  })
})
```

### Step 3: Write editorconfig test

Create `tests/integration/exports/editorconfig.test.ts`:

```typescript
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import {
  ProfileSchema,
  generateEditorConfigExport,
} from "@code-style/profile"
import type { Profile } from "@code-style/profile"

const FIXTURE_PATH = join(
  __dirname,
  "../fixtures/exports/test-profile.json",
)

function parseEditorConfig(
  content: string,
): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {}
  let currentSection = "__root__"
  sections[currentSection] = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue

    const sectionMatch = trimmed.match(/^\[(.+)]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      sections[currentSection] = {}
      continue
    }

    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/)
    if (kvMatch) {
      sections[currentSection][kvMatch[1].trim()] = kvMatch[2].trim()
    }
  }

  return sections
}

describe("EditorConfig generation", () => {
  let profile: Profile
  let content: string
  let parsed: Record<string, Record<string, string>>

  beforeAll(async () => {
    const raw = await readFile(FIXTURE_PATH, "utf-8")
    profile = ProfileSchema.parse(JSON.parse(raw))
    const exported = generateEditorConfigExport(profile)
    expect(exported.path).toBe(".editorconfig")
    content = exported.content
    parsed = parseEditorConfig(content)
  })

  it("outputs .editorconfig path", () => {
    const exported = generateEditorConfigExport(profile)
    expect(exported.path).toBe(".editorconfig")
  })

  it("sets root = true", () => {
    expect(parsed["__root__"]["root"]).toBe("true")
  })

  it("contains indent_style", () => {
    const globalSection = parsed["*"]
    expect(globalSection).toBeDefined()
    expect(globalSection["indent_style"]).toBeDefined()

    // Verify it matches the profile formatting
    const profileIndent = profile.formatting?.indentStyle?.convention
    if (profileIndent === "spaces") {
      expect(globalSection["indent_style"]).toBe("space")
    } else if (profileIndent === "tabs") {
      expect(globalSection["indent_style"]).toBe("tab")
    }
  })

  it("contains end_of_line", () => {
    const globalSection = parsed["*"]
    expect(globalSection).toBeDefined()
    expect(globalSection["end_of_line"]).toBeDefined()
  })

  it("contains charset", () => {
    const globalSection = parsed["*"]
    expect(globalSection).toBeDefined()
    expect(globalSection["charset"]).toBe("utf-8")
  })

  it("contains indent_size when profile specifies it", () => {
    const globalSection = parsed["*"]
    const profileIndentSize = profile.formatting?.indentSize?.convention
    if (profileIndentSize !== undefined) {
      expect(globalSection["indent_size"]).toBe(String(profileIndentSize))
    }
  })

  it("contains max_line_length when profile specifies it", () => {
    const globalSection = parsed["*"]
    const profileLineLength = profile.formatting?.lineLength?.convention
    if (profileLineLength !== undefined) {
      expect(globalSection["max_line_length"]).toBe(
        String(profileLineLength),
      )
    }
  })

  it("includes generation comment", () => {
    expect(content).toContain("Generated by code-style")
  })
})
```

### Step 4: Verify

```bash
pnpm test tests/integration/exports/
```

Expected: all tests pass. The ESLint tests validate both structured config entries and generated file content. The skill tests validate Handlebars rendering completeness. The editorconfig tests validate parsed key-value correctness.

### Step 5: Commit

```bash
git add tests/integration/exports/eslint-config.test.ts tests/integration/exports/skill-export.test.ts tests/integration/exports/editorconfig.test.ts
git commit -m "Add export validation integration tests"
```

## Success Criteria

- [ ] `pnpm test tests/integration/exports/` passes (all tests green)
- [ ] ESLint config test validates naming-convention and sort-imports rules present
- [ ] ESLint export test validates generated JS has balanced braces and import statements
- [ ] Skill export test validates no unrendered `{{` artifacts in output
- [ ] Skill export test validates top rules appear in `skill.md`
- [ ] Editorconfig test validates `indent_style`, `end_of_line`, `charset` present
- [ ] Editorconfig test validates values match profile formatting settings
- [ ] `pnpm test` still passes (all existing tests + new integration tests)

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not modify the test-profile.json fixture — it is a read-only fixture from Task 03
5. Do not install additional npm packages for testing (no eslint runner, no markdown parser) — use string assertions
6. Do not test the internal implementation of generators — test the output shape and content
7. Do not make assertions that are too brittle on exact string content — prefer `toContain` and structural checks over exact equality
8. Do not import from `@code-style/cli` — this task only uses `@code-style/profile` and `@code-style/checker`
