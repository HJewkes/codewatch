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

function createDb(): void {
  mkdirSync(join(repo, ".codewatch"))
  writeFileSync(join(repo, ".codewatch", "graph.db"), "")
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
