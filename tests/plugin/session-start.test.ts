import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
// @ts-expect-error plain ESM hook script without a declaration file
import { formatSnapshot } from "../../plugins/codewatch/hooks/snapshot-format.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(here, "../../plugins/codewatch/hooks/session-start.mjs")
const HOOKS_JSON = resolve(here, "../../plugins/codewatch/hooks/hooks.json")
const FIXTURES = join(here, "fixtures")

let scratch: string
let repo: string
let fakeBin: string
let callLog: string

function git(...args: string[]): string {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).stdout.trim()
}

function initRepo(): void {
  spawnSync("git", ["init", "-q", repo])
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
}

function writeFake(body: string): void {
  writeFileSync(fakeBin, `#!/usr/bin/env bash\necho "$*" >> "${callLog}"\n${body}\n`)
  chmodSync(fakeBin, 0o755)
}

function writeFixtureFake(): void {
  writeFake(
    [
      'case "$2" in',
      `  conventions) cat "${join(FIXTURES, "conventions.json")}" ;;`,
      `  top) cat "${join(FIXTURES, "top.json")}" ;;`,
      "esac",
    ].join("\n"),
  )
}

function createDb(root = repo): void {
  mkdirSync(join(root, ".codewatch"), { recursive: true })
  writeFileSync(join(root, ".codewatch", "graph.db"), "")
}

function writeCarry(root: string): void {
  mkdirSync(join(root, ".codewatch"), { recursive: true })
  writeFileSync(join(root, ".codewatch", "rubric.md"), readFileSync(join(FIXTURES, "rubric.md")))
  writeFileSync(join(root, ".codewatch", "session-brief.json"), readFileSync(join(FIXTURES, "session-brief.json")))
}

function contextOf(stdout: string): string {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext
}

function fixtureSnapshot(head: string | undefined): string {
  const conventions = JSON.parse(readFileSync(join(FIXTURES, "conventions.json"), "utf8"))
  const top = JSON.parse(readFileSync(join(FIXTURES, "top.json"), "utf8"))
  return formatSnapshot({ conventions, top, head, commitsBehind: undefined })
}

function runHook(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    env: { PATH: process.env.PATH ?? "", HOME: scratch, CLAUDE_PROJECT_DIR: repo, ...env },
    timeout: 15_000,
  })
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "cw-session-start-")))
  repo = join(scratch, "repo")
  mkdirSync(repo)
  initRepo()
  fakeBin = join(scratch, "fake-codewatch")
  callLog = join(scratch, "calls.log")
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe("SessionStart hook with a graph.db", () => {
  beforeEach(() => {
    createDb()
    writeFixtureFake()
  })

  it("emits the snapshot as SessionStart additionalContext", () => {
    const result = runHook({ CODEWATCH_BIN: fakeBin })

    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart")
    expect(output.hookSpecificOutput.additionalContext).toContain("packages/cli/src/commands (+3 dirs)")
    expect(output.hookSpecificOutput.additionalContext).toContain("packages/cli/src/utils/output.ts")
  })

  it("reads conventions offline and file fan-in from the repo's db", () => {
    runHook({ CODEWATCH_BIN: fakeBin })

    const calls = readFileSync(callLog, "utf8")
    const db = join(repo, ".codewatch", "graph.db")
    expect(calls).toContain(`graph conventions --offline --json --db ${db}`)
    expect(calls).toContain(`graph top --metric fan_in --kind file --exclude-role test --limit 5 --json --db ${db}`)
  })

  it("compares the snapshot against the full HEAD sha", () => {
    const head = git("rev-parse", "HEAD")

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    const context: string = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(context).toContain(`HEAD (${head.slice(0, 7)})`)
    expect(context).toContain("edges may be stale")
  })

  it("reports no staleness when the snapshot was taken at HEAD", () => {
    const head = git("rev-parse", "HEAD")
    writeFake(`sed 's/"commitHash": "[0-9a-f]*"/"commitHash": "${head}"/' "${join(FIXTURES, "top.json")}"`)

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    const context: string = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
    expect(context).toContain(`codewatch snapshot (${head.slice(0, 7)}`)
    expect(context).not.toContain("edges may be stale")
  })

  it("prints exactly the snapshot payload when no synthesis notes exist", () => {
    const head = git("rev-parse", "HEAD")

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    const additionalContext = fixtureSnapshot(head)
    expect(result.stdout).toBe(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }))
  })

  it("appends the rubric, open items and changed symbols after the snapshot", () => {
    writeCarry(repo)

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    const context = contextOf(result.stdout)
    expect(context.startsWith(`${fixtureSnapshot(git("rev-parse", "HEAD"))}\n\nReview notes from the last session:`)).toBe(true)
    expect(context).toContain("- [regression] shop/cart.py:41:")
    expect(context).not.toContain("A fourth item is never shown.")
    expect(context).toContain("- shop/pricing.py#apply_discount (3 importers)")
  })

  it("still delivers the synthesis notes when the CLI prints invalid JSON", () => {
    writeCarry(repo)
    writeFake("echo not-json")

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    expect(result.status).toBe(0)
    expect(contextOf(result.stdout).startsWith("Review notes from the last session:")).toBe(true)
  })

  it("stays silent when the CLI prints invalid JSON", () => {
    writeFake("echo not-json")

    const result = runHook({ CODEWATCH_BIN: fakeBin })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("kills a hung CLI and exits 0 with empty stdout within 3.5 s", () => {
    writeFake("sleep 10")

    const started = Date.now()
    const result = runHook({ CODEWATCH_BIN: fakeBin })
    const elapsed = Date.now() - started

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(elapsed).toBeLessThan(3500)
    const survivors = spawnSync("pgrep", ["-f", fakeBin], { encoding: "utf8" }).stdout.trim()
    expect(survivors).toBe("")
  })
})

describe("SessionStart hook without a graph.db", () => {
  beforeEach(writeFixtureFake)

  it("exits 0 silently without calling the CLI or creating .codewatch", () => {
    const result = runHook({ CODEWATCH_BIN: fakeBin })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(existsSync(callLog)).toBe(false)
    expect(existsSync(join(repo, ".codewatch"))).toBe(false)
  })

  it("exits 0 silently outside a git repository", () => {
    const loose = join(scratch, "loose")
    mkdirSync(loose)

    const result = runHook({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: loose })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(existsSync(callLog)).toBe(false)
  })
})

describe("SessionStart hook in a Python workspace that is not a git repository", () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(scratch, "workspace")
    mkdirSync(join(workspace, "shop"), { recursive: true })
    writeFileSync(join(workspace, "pyproject.toml"), '[project]\nname = "shop"\nversion = "0.1.0"\n')
    writeFileSync(join(workspace, "shop", "__init__.py"), "")
    writeFileSync(join(workspace, "shop", "cart.py"), "def total(prices):\n    return sum(prices)\n")
    createDb(workspace)
    writeFixtureFake()
  })

  it("stays silent and calls no CLI when no synthesis notes exist", () => {
    const result = runHook({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: workspace })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(existsSync(callLog)).toBe(false)
  })

  it("injects the snapshot without a staleness line, then the synthesis notes", () => {
    writeCarry(workspace)

    const result = runHook({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: workspace })

    const context = contextOf(result.stdout)
    expect(context.startsWith(`${fixtureSnapshot(undefined)}\n\nReview notes from the last session:`)).toBe(true)
    expect(context).not.toContain("edges may be stale")
    expect(readFileSync(callLog, "utf8")).toContain(`--db ${join(workspace, ".codewatch", "graph.db")}`)
  })

  it("delivers the synthesis notes alone when the workspace has no graph.db", () => {
    rmSync(join(workspace, ".codewatch", "graph.db"))
    writeCarry(workspace)

    const result = runHook({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: workspace })

    expect(contextOf(result.stdout).startsWith("Review notes from the last session:")).toBe(true)
    expect(existsSync(callLog)).toBe(false)
  })
})

describe("SessionStart hook without a CLI", () => {
  it("exits 0 silently when no codewatch CLI can be found", () => {
    createDb()

    const result = runHook({ CODEWATCH_BIN: undefined, PATH: "/usr/bin:/bin" })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })
})

describe("hooks.json", () => {
  it("registers one SessionStart hook for startup, clear and compact with a 5 s timeout", () => {
    const config = JSON.parse(readFileSync(HOOKS_JSON, "utf8"))

    const entries = config.hooks.SessionStart
    expect(entries).toHaveLength(1)
    expect(entries[0].matcher).toBe("startup|clear|compact")
    expect(entries[0].hooks).toEqual([
      {
        type: "command",
        command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"',
        timeout: 5,
      },
    ])
  })
})
