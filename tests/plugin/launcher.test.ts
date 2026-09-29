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

const LAUNCHER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../plugins/codewatch/bin/codewatch-launch.sh",
)

let scratch: string
let repo: string
let fakeBin: string
let callLog: string

function writeRecordingFake(): void {
  writeFileSync(
    fakeBin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${callLog}"\n`,
  )
  chmodSync(fakeBin, 0o755)
}

function runLauncher(env: Record<string, string>, cwd = repo) {
  return spawnSync("bash", [LAUNCHER], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: scratch, ...env },
  })
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "cw-launcher-")))
  repo = join(scratch, "repo")
  mkdirSync(repo)
  spawnSync("git", ["init", "-q", repo])
  fakeBin = join(scratch, "fake-codewatch")
  callLog = join(scratch, "calls.log")
  writeRecordingFake()
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe("codewatch launcher without a graph.db", () => {
  it("exits 1 without calling the CLI or creating .codewatch", () => {
    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: repo })

    expect(result.status).toBe(1)
    expect(existsSync(callLog)).toBe(false)
    expect(existsSync(join(repo, ".codewatch"))).toBe(false)
  })

  it("explains the refusal on stderr and keeps stdout empty for the MCP transport", () => {
    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: repo })

    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`no .codewatch/graph.db under ${repo}`)
    expect(result.stderr).toContain("codewatch graph index .")
  })

  it("exits 1 outside a git repository without calling the CLI", () => {
    const loose = join(scratch, "loose")
    mkdirSync(loose)

    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: loose }, loose)

    expect(result.status).toBe(1)
    expect(existsSync(callLog)).toBe(false)
    expect(existsSync(join(loose, ".codewatch"))).toBe(false)
  })
})

describe("codewatch launcher with a graph.db", () => {
  beforeEach(() => {
    mkdirSync(join(repo, ".codewatch"))
    writeFileSync(join(repo, ".codewatch", "graph.db"), "")
  })

  it("starts graph mcp with absolute db and repo-root paths", () => {
    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: repo })

    expect(result.status).toBe(0)
    const args = readFileSync(callLog, "utf8").trimEnd().split("\n")
    expect(args).toEqual([
      "graph",
      "mcp",
      "--db",
      join(repo, ".codewatch", "graph.db"),
      "--repo-root",
      repo,
    ])
  })

  it("resolves the repo root from a subdirectory project dir", () => {
    const nested = join(repo, "src", "deep")
    mkdirSync(nested, { recursive: true })

    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: nested }, nested)

    expect(result.status).toBe(0)
    expect(readFileSync(callLog, "utf8")).toContain(`--repo-root\n${repo}\n`)
  })

  it("falls back to the working directory when CLAUDE_PROJECT_DIR is unset", () => {
    const result = runLauncher({ CODEWATCH_BIN: fakeBin })

    expect(result.status).toBe(0)
    expect(readFileSync(callLog, "utf8")).toContain(`--repo-root\n${repo}\n`)
  })

  it("exits 1 with a hint when no codewatch CLI can be found", () => {
    const result = runLauncher({ CLAUDE_PROJECT_DIR: repo, PATH: "/usr/bin:/bin" })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("cannot find the codewatch CLI")
  })

  it("passes the exact argv when the project path and the CLI path contain a space", () => {
    const spaced = join(scratch, "my repo")
    mkdirSync(join(spaced, ".codewatch"), { recursive: true })
    spawnSync("git", ["init", "-q", spaced])
    writeFileSync(join(spaced, ".codewatch", "graph.db"), "")
    fakeBin = join(scratch, "fake codewatch")
    writeRecordingFake()

    const result = runLauncher({ CODEWATCH_BIN: fakeBin, CLAUDE_PROJECT_DIR: spaced }, spaced)

    expect(result.status).toBe(0)
    expect(readFileSync(callLog, "utf8").trimEnd().split("\n")).toEqual([
      "graph",
      "mcp",
      "--db",
      join(spaced, ".codewatch", "graph.db"),
      "--repo-root",
      spaced,
    ])
  })

  it("execs a CLI path that starts with a dash instead of parsing it as an option", () => {
    mkdirSync(join(repo, "-bin"))
    fakeBin = join(repo, "-bin", "codewatch")
    writeRecordingFake()

    const result = runLauncher({ CODEWATCH_BIN: "-bin/codewatch", CLAUDE_PROJECT_DIR: repo })

    expect(result.status).toBe(0)
    expect(readFileSync(callLog, "utf8")).toContain("graph\nmcp\n")
  })
})
