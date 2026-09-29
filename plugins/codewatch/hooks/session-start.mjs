// @ts-check
// SessionStart hook: inject a codewatch repo snapshot. Every failure path exits 0 with empty stdout.

import { execFileSync, spawn } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { formatSnapshot } from "./snapshot-format.mjs"

// hooks.json allows 5 s; stay well inside it so a slow CLI never delays the session.
const DEADLINE_MS = 2500

/** @type {Set<import("node:child_process").ChildProcess>} */
const children = new Set()

/** @param {string} message */
function bail(message) {
  process.stderr.write(`codewatch session-start: ${message}\n`)
  for (const child of children) killGroup(child)
  process.exit(0)
}

/** @param {import("node:child_process").ChildProcess} child */
function killGroup(child) {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

/** @param {string} name */
function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

/** @returns {{ command: string, prefix: string[] } | null} */
function resolveCli() {
  const bin = process.env.CODEWATCH_BIN || onPath("codewatch")
  if (!bin) return null
  return /\.m?js$/.test(bin) ? { command: process.execPath, prefix: [bin] } : { command: bin, prefix: [] }
}

/**
 * Run the CLI and parse its JSON stdout; detached so a timeout can kill the whole process group.
 * @param {{ command: string, prefix: string[] }} cli
 * @param {string[]} args
 * @returns {Promise<any>}
 */
function runJson(cli, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
    children.add(child)
    let stdout = ""
    child.stdout?.on("data", (chunk) => (stdout += chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      children.delete(child)
      if (code !== 0) return reject(new Error(`\`${args.slice(0, 2).join(" ")}\` exited ${code}`))
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`\`${args.slice(0, 2).join(" ")}\` printed invalid JSON`))
      }
    })
  })
}

/**
 * @param {string} root
 * @param {string | undefined} snapshotSha
 * @param {string} head
 */
function commitsBehind(root, snapshotSha, head) {
  if (!snapshotSha || snapshotSha === head) return undefined
  try {
    return Number(git(["-C", root, "rev-list", "--count", `${snapshotSha}..${head}`]))
  } catch {
    return undefined
  }
}

async function main() {
  const timer = setTimeout(() => bail(`timed out after ${DEADLINE_MS} ms`), DEADLINE_MS)
  const root = git(["-C", process.env.CLAUDE_PROJECT_DIR || process.cwd(), "rev-parse", "--show-toplevel"])
  const db = join(root, ".codewatch", "graph.db")
  if (!existsSync(db)) return bail(`no .codewatch/graph.db under ${root}`)
  const cli = resolveCli()
  if (!cli) return bail("cannot find the codewatch CLI; set CODEWATCH_BIN")
  const head = git(["-C", root, "rev-parse", "HEAD"])
  const [conventions, top] = await Promise.all([
    runJson(cli, ["graph", "conventions", "--offline", "--json", "--db", db]),
    runJson(cli, ["graph", "top", "--metric", "fan_in", "--kind", "file", "--exclude-role", "test", "--limit", "5", "--json", "--db", db]),
  ])
  const behind = commitsBehind(root, top?.snapshot?.commitHash, head)
  const additionalContext = formatSnapshot({ conventions, top, head, commitsBehind: behind })
  clearTimeout(timer)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }))
}

main().catch((error) => bail(error instanceof Error ? error.message : String(error)))
