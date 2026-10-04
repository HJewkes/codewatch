// @ts-check
// Process-edge helpers shared by the plugin's hook runners.

import { execFileSync } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

/** @param {string[]} args */
export function git(args) {
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

/** The codewatch CLI entry: `CODEWATCH_BIN` when set, else `codewatch` on PATH, else null. */
export function findCodewatchBin() {
  return process.env.CODEWATCH_BIN || onPath("codewatch")
}
