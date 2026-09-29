// @ts-check

/**
 * @typedef {{ id: string, kind: string, name: string }} SearchHit
 * @typedef {{ from: string }} CallerEdge
 * @typedef {{
 *   search: (query: string, limit?: number) => { hits: SearchHit[] },
 *   getNeighbors: (target: string) => { callers: CallerEdge[] },
 * }} AugmentReadApi
 * @typedef {{ mode?: string, filenames?: string[], content?: string }} GrepResponse
 * @typedef {{ tool_input?: { pattern?: string }, tool_response?: GrepResponse }} GrepPayload
 */

export const MAX_AUGMENT_FILES = 15
const SEARCH_LIMIT = 5

const IDENTIFIER = /^(?:\\b)?([A-Za-z_$][\w$]{2,})(?:\\b)?$/
// A content line starts "path:" for a match or a count, or "path-<n>-" for a context line.
const CONTENT_PATH = /^(.+?)(?::|-\d+-)/

/**
 * The bare identifier a Grep pattern searches for, or null for regexes, paths and phrases.
 * @param {string} pattern
 */
export function normalizeIdentifier(pattern) {
  return IDENTIFIER.exec(pattern)?.[1] ?? null
}

/**
 * Injection text naming files that use the searched symbol but are missing from the Grep result, or null.
 * @param {GrepPayload} input
 * @param {AugmentReadApi} api
 */
export function decideAugment(input, api) {
  const name = normalizeIdentifier(input.tool_input?.pattern ?? "")
  if (!name) return null
  const exact = api.search(name, SEARCH_LIMIT).hits.filter((hit) => hit.kind === "symbol" && hit.name === name)
  if (exact.length !== 1) return null
  const matched = grepResultFiles(input.tool_response ?? {})
  const callers = unique(api.getNeighbors(exact[0].id).callers.map((edge) => edge.from))
  const missing = callers.filter((file) => !matched.some((path) => samePath(path, file)))
  return missing.length === 0 ? null : formatAugment(name, missing)
}

/**
 * @param {string} name
 * @param {string[]} files
 */
function formatAugment(name, files) {
  const header = `codewatch: ${files.length} files use \`${name}\` through re-export barrels and did not match this search:`
  return [header, ...files.slice(0, MAX_AUGMENT_FILES)].join("\n")
}

/** @param {GrepResponse} response */
function grepResultFiles(response) {
  const fromContent = (response.content ?? "")
    .split("\n")
    .map((line) => CONTENT_PATH.exec(line)?.[1])
    .filter((path) => path !== undefined)
  return [...(response.filenames ?? []), ...fromContent]
}

/**
 * Grep reports paths relative to the session cwd, which may sit below the repo root.
 * @param {string} grepPath
 * @param {string} repoPath
 */
function samePath(grepPath, repoPath) {
  const path = grepPath.replace(/^\.\//, "")
  return path === repoPath || repoPath.endsWith(`/${path}`) || path.endsWith(`/${repoPath}`)
}

/** @param {string[]} items */
function unique(items) {
  return [...new Set(items)]
}
