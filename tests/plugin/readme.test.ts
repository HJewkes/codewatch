import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8")
}

function installCommands(readme: string): string[] {
  const block = readme.match(/<!-- install:start -->\s*```[a-z]*\n([\s\S]*?)```\s*<!-- install:end -->/)
  if (!block) throw new Error("plugin README has no install block between install markers")
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
}

describe("plugin README install block", () => {
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")).name as string
  const plugin = JSON.parse(read("plugins/codewatch/.claude-plugin/plugin.json")).name as string
  const commands = installCommands(read("plugins/codewatch/README.md"))

  it("contains the marketplace add and plugin install commands", () => {
    expect(commands.some((c) => c.startsWith("claude plugin marketplace add "))).toBe(true)
    expect(commands.some((c) => c.startsWith("claude plugin install "))).toBe(true)
  })

  it("names the declared plugin and marketplace in every plugin install command", () => {
    const installs = commands.filter((c) => c.startsWith("claude plugin install "))

    for (const command of installs) expect(command).toContain(`${plugin}@${marketplace}`)
  })

  it("points the marketplace add command at a codewatch checkout path, with no extra arguments", () => {
    const adds = commands.filter((c) => c.startsWith("claude plugin marketplace add "))

    for (const command of adds) expect(command).toMatch(/^claude plugin marketplace add \S*\/codewatch$/)
  })
})

describe("repo README plugin section", () => {
  it("has a Claude Code plugin heading that links to the plugin README", () => {
    const readme = read("README.md")

    expect(readme).toContain("## Claude Code plugin")
    expect(readme).toContain("plugins/codewatch/README.md")
  })
})
