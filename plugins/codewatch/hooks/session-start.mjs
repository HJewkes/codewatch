// @ts-check
// SessionStart hook: inject a codewatch repo snapshot plus any carried synthesis notes.
// Every failure path exits 0, with empty stdout unless synthesis notes exist.

import { spawn } from "node:child_process"
import { existsSync, writeSync } from "node:fs"
import { join } from "node:path"
import { formatCarry, readCarry } from "./carry-format.mjs"
import { findCodewatchBin, git } from "./hook-env.mjs"
import { formatSnapshot } from "./snapshot-format.mjs"

// hooks.json allows 5 s; stay well inside it so a slow CLI never delays the session.
const DEADLINE_MS = 2500

/** @type {Set<import("node:child_process").ChildProcess>} */
const children = new Set()

// Notes carried from the last synthesis still reach the session when the snapshot fails.
let carried = ""

/** @param {string} additionalContext */
function emit(additionalContext) {
  writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }))
}

/** @param {string} message */
function bail(message) {
  process.stderr.write(`codewatch session-start: ${message}\n`)
  for (const child of children) killGroup(child)
  if (carried) emit(carried)
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

/** @returns {{ command: string, prefix: string[] } | null} */
function resolveCli() {
  const bin = findCodewatchBin()
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
 * @param {string | undefined} head
 */
function commitsBehind(root, snapshotSha, head) {
  if (!head || !snapshotSha || snapshotSha === head) return undefined
  try {
    return Number(git(["-C", root, "rev-list", "--count", `${snapshotSha}..${head}`]))
  } catch {
    return undefined
  }
}

/**
 * The git toplevel; outside git, the project dir only when it carries synthesis notes.
 * @param {string} projectDir
 * @returns {{ root: string, inGit: boolean }}
 */
function resolveRoot(projectDir) {
  try {
    return { root: git(["-C", projectDir, "rev-parse", "--show-toplevel"]), inGit: true }
  } catch {
    return { root: projectDir, inGit: false }
  }
}

/**
 * The carried notes, or "" when they cannot be read: they must never cost the session its snapshot.
 * @param {string} root
 */
function carriedNotes(root) {
  try {
    return formatCarry(readCarry(root))
  } catch (error) {
    process.stderr.write(`codewatch session-start: ignoring synthesis notes: ${error instanceof Error ? error.message : error}\n`)
    return ""
  }
}

async function main() {
  const timer = setTimeout(() => bail(`timed out after ${DEADLINE_MS} ms`), DEADLINE_MS)
  const { root, inGit } = resolveRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  carried = carriedNotes(root)
  if (!inGit && !carried) return bail(`${root} is not a git repository`)
  const db = join(root, ".codewatch", "graph.db")
  if (!existsSync(db)) return bail(`no .codewatch/graph.db under ${root}`)
  const cli = resolveCli()
  if (!cli) return bail("cannot find the codewatch CLI; set CODEWATCH_BIN")
  const head = inGit ? git(["-C", root, "rev-parse", "HEAD"]) : undefined
  const [conventions, top] = await Promise.all([
    runJson(cli, ["graph", "conventions", "--offline", "--json", "--db", db]),
    runJson(cli, ["graph", "top", "--metric", "fan_in", "--kind", "file", "--exclude-role", "test", "--limit", "5", "--json", "--db", db]),
  ])
  const behind = commitsBehind(root, top?.snapshot?.commitHash, head)
  const snapshot = formatSnapshot({ conventions, top, head, commitsBehind: behind })
  clearTimeout(timer)
  emit(carried ? `${snapshot}\n\n${carried}` : snapshot)
}

main().catch((error) => bail(error instanceof Error ? error.message : String(error)))
