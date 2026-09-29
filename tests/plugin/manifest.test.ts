import { accessSync, constants, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const PLUGIN_ROOT = join(REPO_ROOT, "plugins/codewatch")

interface McpServer {
  command: string
  args?: string[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function readPluginManifest() {
  return readJson<{ name: string; mcpServers: Record<string, McpServer> }>(
    join(PLUGIN_ROOT, ".claude-plugin/plugin.json"),
  )
}

describe("codewatch plugin manifest", () => {
  it("points the codewatch MCP server at an executable file inside the plugin", () => {
    const server = readPluginManifest().mcpServers.codewatch
    const commandPath = server.command.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)

    expect(server.command.startsWith("${CLAUDE_PLUGIN_ROOT}/")).toBe(true)
    expect(statSync(commandPath).isFile()).toBe(true)
    expect(() => accessSync(commandPath, constants.X_OK)).not.toThrow()
  })
})

describe("repo marketplace", () => {
  it("lists the codewatch plugin from its plugin directory", () => {
    const marketplace = readJson<{
      name: string
      plugins: { name: string; source: string }[]
    }>(join(REPO_ROOT, ".claude-plugin/marketplace.json"))

    const entry = marketplace.plugins.find((plugin) => plugin.name === "codewatch")

    expect(marketplace.name).toBe("codewatch-local")
    expect(entry?.source).toBe("./plugins/codewatch")
    expect(readPluginManifest().name).toBe(entry?.name)
  })
})
