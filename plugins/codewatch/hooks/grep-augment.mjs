// @ts-check
// PostToolUse Grep hook (opt-in): name files that reach the searched symbol only through re-export barrels.
// Disabled or non-identifier searches exit before touching git or the db. Every path exits 0.

import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { decideAugment, normalizeIdentifier } from "./grep-augment-core.mjs"
import { findCodewatchBin, git } from "./hook-env.mjs"

const ENABLED_VALUES = new Set(["1", "true"])

// Claude Code exports userConfig.grepAugment as CLAUDE_PLUGIN_OPTION_GREPAUGMENT; the owner can also set the env var.
function isEnabled() {
  const value = process.env.CLAUDE_PLUGIN_OPTION_GREPAUGMENT ?? process.env.CODEWATCH_GREP_AUGMENT ?? ""
  return ENABLED_VALUES.has(value.toLowerCase())
}

/**
 * @param {string} message
 * @returns {never}
 */
function bail(message) {
  process.stderr.write(`codewatch grep-augment: ${message}\n`)
  process.exit(0)
}

// The read API ships beside the CLI entry, so one node process does search plus neighbors.
function readApiModule() {
  const bin = findCodewatchBin()
  if (!bin) return bail("cannot find the codewatch CLI; set CODEWATCH_BIN")
  const reader = join(dirname(realpathSync(bin)), "read-api", "reader.js")
  if (!existsSync(reader)) return bail(`no read API beside ${bin}`)
  return pathToFileURL(reader).href
}

/** @param {any} payload */
async function augment(payload) {
  const root = git(["-C", payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(), "rev-parse", "--show-toplevel"])
  const db = join(root, ".codewatch", "graph.db")
  if (!existsSync(db)) return bail(`no .codewatch/graph.db under ${root}`)
  const { createReadApi } = await import(readApiModule())
  const api = createReadApi({ db, repoRoot: root })
  try {
    return decideAugment(payload, api)
  } finally {
    api.close()
  }
}

async function main() {
  if (!isEnabled()) return
  const payload = JSON.parse(readFileSync(0, "utf8"))
  if (!normalizeIdentifier(payload.tool_input?.pattern ?? "")) return
  const additionalContext = await augment(payload)
  if (!additionalContext) return
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }))
}

main().catch((error) => bail(error instanceof Error ? error.message : String(error)))
