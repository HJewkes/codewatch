import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(here, "../../plugins/codewatch/hooks/grep-augment.mjs")
const HOOKS_JSON = resolve(here, "../../plugins/codewatch/hooks/hooks.json")
const PLUGIN_JSON = resolve(here, "../../plugins/codewatch/.claude-plugin/plugin.json")
const REAL_CLI = resolve(here, "../../packages/cli/dist/index.js")

const BARREL_TREE: Record<string, string> = {
  "src/lib/format.ts": "export function formatWidget(name: string): string {\n  return `widget ${name}`\n}\n",
  "src/lib/index.ts": 'export { formatWidget } from "./format"\n',
  "src/app/use.ts": 'import { formatWidget } from "../lib"\n\nexport const label = formatWidget("a")\n',
  "tsconfig.json": '{ "compilerOptions": { "strict": true, "moduleResolution": "bundler" }, "include": ["src"] }\n',
}

let scratch: string
let repo: string
let fakeCli: string
let importMarker: string

function run(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`)
}

function createIndexedRepo(): void {
  for (const [path, body] of Object.entries(BARREL_TREE)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), body)
  }
  run(repo, "git", ["init", "-q"])
  run(repo, "git", ["add", "-A"])
  run(repo, "git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init"])
  run(repo, process.execPath, [REAL_CLI, "graph", "index", "src", "--no-churn"])
}

// A CLI whose read API only records that something imported it.
function createFakeCli(): void {
  mkdirSync(join(fakeCli, "read-api"), { recursive: true })
  writeFileSync(join(fakeCli, "index.js"), "")
  writeFileSync(
    join(fakeCli, "read-api", "reader.js"),
    `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(importMarker)}, "")\nexport function createReadApi() { throw new Error("unused") }\n`,
  )
}

function grepPayload(pattern: string, cwd = repo) {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "Grep",
    cwd,
    tool_input: { pattern, path: "src/lib", output_mode: "files_with_matches" },
    tool_response: { mode: "files_with_matches", filenames: ["src/lib/format.ts", "src/lib/index.ts"], numFiles: 2 },
  }
}

function runHook(payload: object, env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH ?? "", HOME: scratch, ...env },
    timeout: 15_000,
  })
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "cw-grep-augment-")))
  repo = join(scratch, "repo")
  fakeCli = join(scratch, "fake-cli")
  importMarker = join(scratch, "read-api-imported")
  mkdirSync(repo)
  createIndexedRepo()
  createFakeCli()
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(importMarker, { force: true })
})

describe("Grep augment when disabled", () => {
  it("exits 0 with empty stdout and never loads the read API", () => {
    const result = runHook(grepPayload("formatWidget"), { CODEWATCH_BIN: join(fakeCli, "index.js") })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
    expect(existsSync(importMarker)).toBe(false)
  })

  it("lets a false plugin option override the env fallback", () => {
    const result = runHook(grepPayload("formatWidget"), {
      CODEWATCH_BIN: join(fakeCli, "index.js"),
      CLAUDE_PLUGIN_OPTION_GREPAUGMENT: "false",
      CODEWATCH_GREP_AUGMENT: "1",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(existsSync(importMarker)).toBe(false)
  })
})

describe("Grep augment when enabled", () => {
  it.each([
    ["the plugin option", { CLAUDE_PLUGIN_OPTION_GREPAUGMENT: "true" }],
    ["the env fallback", { CODEWATCH_GREP_AUGMENT: "1" }],
  ])("names the barrel-only importer via %s", (_label, flag) => {
    const result = runHook(grepPayload("formatWidget"), { CODEWATCH_BIN: REAL_CLI, ...flag })

    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout).hookSpecificOutput
    expect(output.hookEventName).toBe("PostToolUse")
    expect(output.additionalContext).toContain("`formatWidget` through re-export barrels")
    expect(output.additionalContext.split("\n").slice(1)).toEqual(["src/app/use.ts"])
  })

  it("stays silent when the search already matched every importer", () => {
    const payload = grepPayload("formatWidget")
    payload.tool_response.filenames.push("src/app/use.ts")

    const result = runHook(payload, { CODEWATCH_BIN: REAL_CLI, CODEWATCH_GREP_AUGMENT: "1" })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("skips regex patterns without loading the read API", () => {
    const result = runHook(grepPayload("format.*Widget"), {
      CODEWATCH_BIN: join(fakeCli, "index.js"),
      CODEWATCH_GREP_AUGMENT: "1",
    })

    expect(result.stdout).toBe("")
    expect(existsSync(importMarker)).toBe(false)
  })

  it("stays silent in a repo without a graph.db", () => {
    const bare = join(scratch, "bare")
    mkdirSync(bare, { recursive: true })
    run(bare, "git", ["init", "-q"])

    const result = runHook(grepPayload("formatWidget", bare), {
      CODEWATCH_BIN: join(fakeCli, "index.js"),
      CODEWATCH_GREP_AUGMENT: "1",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(existsSync(importMarker)).toBe(false)
    expect(existsSync(join(bare, ".codewatch"))).toBe(false)
  })
})

describe("Grep augment on unusable input", () => {
  const enabled = { CODEWATCH_GREP_AUGMENT: "1" }

  it("exits 0 with empty stdout when cwd is not a git repository", () => {
    const outside = mkdtempSync(join(scratch, "outside-"))

    const result = runHook(grepPayload("formatWidget", outside), { ...enabled, CODEWATCH_BIN: join(fakeCli, "index.js") })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("exits 0 with empty stdout on malformed stdin", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: "utf8",
      input: "{not json",
      env: { PATH: process.env.PATH ?? "", HOME: scratch, CODEWATCH_GREP_AUGMENT: "1" },
      timeout: 15_000,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })
})

describe("plugin wiring", () => {
  it("registers the runner on PostToolUse for Grep with a 3 s timeout", () => {
    const config = JSON.parse(readFileSync(HOOKS_JSON, "utf8"))

    expect(config.hooks.PostToolUse).toEqual([
      {
        matcher: "Grep",
        hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/grep-augment.mjs"', timeout: 3 }],
      },
    ])
  })

  it("declares grepAugment as an opt-in boolean", () => {
    const manifest = JSON.parse(readFileSync(PLUGIN_JSON, "utf8"))

    expect(manifest.userConfig.grepAugment).toMatchObject({ type: "boolean", default: false })
  })
})
