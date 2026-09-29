// @ts-check

/**
 * @typedef {{ label: string, size?: number, summary?: string | null }} Area
 * @typedef {{ areas?: Area[] }} Conventions
 * @typedef {{ nodeId: string, value: number }} TopRow
 * @typedef {{ snapshot?: { commitHash?: string, takenAt?: string }, rows?: TopRow[] }} Top
 * @typedef {{ conventions?: Conventions | null, top?: Top | null, head?: string | null, commitsBehind?: number }} SnapshotInput
 */

export const MAX_SNAPSHOT_CHARS = 6000
export const MAX_AREAS = 8
export const MAX_SUMMARY_CHARS = 200

const TOOLS_LINE =
  "codewatch MCP tools: `get_context` for barrel-resolved callers and dependencies, " +
  "`find_similar` and `get_conventions` for existing capabilities before adding new code."

// A terminator followed by whitespace and a capital (or the end) ends a sentence, so "e.g. a" does not.
const SENTENCE_END = /[.!?](?=\s+[A-Z(`"]|\s*$)/

/** @param {string} sha */
const shortSha = (sha) => sha.slice(0, 7)

/**
 * The first sentence of a summary on one line, or a word-boundary cut ending "..." when it exceeds `max`.
 * @param {string} summary
 * @param {number} [max]
 */
export function clipSummary(summary, max = MAX_SUMMARY_CHARS) {
  const sentence = firstSentence(summary.replace(/\s+/g, " ").trim())
  if (sentence.length <= max) return sentence
  const room = sentence.slice(0, max - 3)
  const lastSpace = room.lastIndexOf(" ")
  return `${(lastSpace > 0 ? room.slice(0, lastSpace) : room).replace(/[\s,;:]+$/, "")}...`
}

/** @param {Area} area */
function areaLine(area) {
  const head = `- ${area.label} (${area.size ?? 0} files)`
  return area.summary ? `${head}: ${clipSummary(area.summary)}` : head
}

/** @param {string} text */
function firstSentence(text) {
  const end = text.search(SENTENCE_END)
  return end === -1 ? text : text.slice(0, end + 1)
}

/** @param {Top | null | undefined} top */
function headerLine(top) {
  const sha = top?.snapshot?.commitHash
  const date = top?.snapshot?.takenAt?.slice(0, 10)
  const detail = [sha && shortSha(sha), date].filter(Boolean).join(", ")
  return detail ? `codewatch snapshot (${detail})` : "codewatch snapshot"
}

/**
 * @param {Top | null | undefined} top
 * @param {string | null | undefined} head
 * @param {number | undefined} commitsBehind
 */
function stalenessLine(top, head, commitsBehind) {
  const snapshotSha = top?.snapshot?.commitHash
  if (!head || !snapshotSha || head === snapshotSha) return null
  const where = `HEAD (${shortSha(head)})`
  return commitsBehind && commitsBehind > 0
    ? `Snapshot is ${commitsBehind} commit${commitsBehind === 1 ? "" : "s"} behind ${where}; edges may be stale.`
    : `Snapshot commit differs from ${where}; edges may be stale.`
}

/** @param {Top | null | undefined} top */
function topFileLines(top) {
  return (top?.rows ?? []).map((row) => `- ${row.nodeId} (fan-in ${row.value})`)
}

/**
 * @param {string[]} preamble
 * @param {string[]} areas
 * @param {string[]} topFiles
 */
function assemble(preamble, areas, topFiles) {
  const blocks = [preamble]
  if (areas.length > 0) blocks.push(["Capability areas:", ...areas])
  if (topFiles.length > 0) blocks.push(["Most depended-on files:", ...topFiles])
  blocks.push([TOOLS_LINE])
  return blocks.map((lines) => lines.join("\n")).join("\n\n")
}

/**
 * Render the SessionStart repo snapshot, never longer than MAX_SNAPSHOT_CHARS and never cut mid-line.
 * @param {SnapshotInput} input
 */
export function formatSnapshot({ conventions, top, head, commitsBehind }) {
  const staleness = stalenessLine(top, head, commitsBehind)
  const preamble = staleness ? [headerLine(top), staleness] : [headerLine(top)]
  const areas = (conventions?.areas ?? []).slice(0, MAX_AREAS).map(areaLine)
  const topFiles = topFileLines(top)
  let output = assemble(preamble, areas, topFiles)
  while (output.length > MAX_SNAPSHOT_CHARS && (areas.length > 0 || topFiles.length > 0)) {
    if (areas.length > 0) areas.pop()
    else topFiles.pop()
    output = assemble(preamble, areas, topFiles)
  }
  return output
}
