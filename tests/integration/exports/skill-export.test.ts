import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, beforeAll } from "vitest"
import { ProfileSchema } from "../../../packages/profile/src/schema/profile.js"
import { generateSkillFiles } from "../../../packages/profile/src/exporters/skill.js"
import type { Profile } from "../../../packages/profile/src/schema/profile.js"
import type { GeneratedFile } from "../../../packages/profile/src/exporters/types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

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

    expect(skillFile!.content).toContain(profile.author)

    const content = skillFile!.content.toLowerCase()
    const hasRuleReference =
      content.includes("naming") ||
      content.includes("camelcase") ||
      content.includes("convention") ||
      content.includes("style")
    expect(hasRuleReference).toBe(true)
  })

  it("renders idioms section when profile has idioms", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()
    expect(skillFile!.content).toContain("## Common Patterns")
    expect(skillFile!.content).toContain("guard-clause")
  })

  it("renders anti-patterns section when profile has anti-patterns", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()
    expect(skillFile!.content).toContain("## Avoid")
    expect(skillFile!.content).toContain("nested-ternary")
  })

  it("renders fixability in naming reference when present", () => {
    const namingFile = files.find((f) => f.path === "references/naming.md")
    expect(namingFile).toBeDefined()
    expect(namingFile!.content).toContain("Fixability")
  })

  it("skill.md is valid markdown", () => {
    const skillFile = files.find((f) => f.path === "skill.md")
    expect(skillFile).toBeDefined()

    const firstNonEmptyLine = skillFile!.content
      .split("\n")
      .find((l) => l.trim().length > 0)
    // May start with YAML frontmatter (---) or a heading (#)
    expect(firstNonEmptyLine).toMatch(/^(#|---)/)
  })
})
