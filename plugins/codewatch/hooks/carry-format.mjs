// @ts-check
// Notes carried between sessions under `.codewatch`: the taste head `taste.md` plus unmerged
// `taste.d/*.md` fragments, the verdict head `verdicts.jsonl` plus unmerged `verdicts.d/*.jsonl`
// fragments, and the derived, uncommitted `session-brief.json`.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * @typedef {{ kind: string, path: string, line?: number | null, text: string }} OpenItem
 * @typedef {{ symbol: string, importers: number }} ChangedSymbol
 * @typedef {{ openItems?: OpenItem[], changedSymbols?: ChangedSymbol[] }} SessionBrief
 * @typedef {{ key: string, verdict: string, signal?: string, path: string, rationale?: string,
 *   citations?: { lineStart?: number }[] }} VerdictRow
 * @typedef {{ taste?: string[], verdicts?: VerdictRow[], brief?: SessionBrief | null }} Carry
 */

// 1.5k tokens at about 4 characters per token.
export const MAX_CARRY_CHARS = 6000
export const MAX_OPEN_ITEMS = 3
export const MAX_CHANGED_SYMBOLS = 5
const MAX_ITEM_TEXT = 200
// Findings that say changed code lacks a test, or has only a weak one; they come first.
const TEST_GAP_SIGNALS = new Set([
  "diff-uncovered",
  "missing-test-kind",
  "symbol_assertion_free",
  "symbol_weak_oracle_only",
  "symbol_duplicate_assert",
  "symbol_self_compare",
])

/**
 * @param {string} path
 * @returns {string | null}
 */
function readText(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/**
 * The head file, then each fragment in id order (`cp-2` before `cp-10`), as `codewatch triage --verdicts-dir` reads them.
 * @param {string} dir
 * @param {string} head
 * @param {string} fragmentDir
 * @param {string} suffix
 */
function headThenFragments(dir, head, fragmentDir, suffix) {
  let fragments = []
  try {
    fragments = readdirSync(join(dir, fragmentDir)).filter((name) => name.endsWith(suffix))
  } catch {}
  fragments.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
  return [join(dir, head), ...fragments.map((name) => join(dir, fragmentDir, name))]
    .map(readText)
    .filter((text) => text !== null)
}

/** @param {string} line */
function parseRow(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** @param {any} row */
const isVerdictRow = (row) => typeof row?.key === "string" && typeof row?.verdict === "string" && typeof row?.path === "string"

/**
 * Every verdict, a later row replacing an earlier one with the same key; malformed rows are skipped.
 * @param {string[]} texts
 * @returns {VerdictRow[]}
 */
function mergeVerdicts(texts) {
  /** @type {Map<string, VerdictRow>} */
  const byKey = new Map()
  for (const text of texts) {
    for (const row of text.split("\n").filter((l) => l.trim() !== "").map(parseRow)) {
      if (isVerdictRow(row)) byKey.set(row.key, row)
    }
  }
  return [...byKey.values()]
}

/**
 * Read the carry files under `<root>/.codewatch`; a missing or malformed file reads as absent.
 * @param {string} root
 * @returns {Carry}
 */
export function readCarry(root) {
  const dir = join(root, ".codewatch")
  const taste = headThenFragments(dir, "taste.md", "taste.d", ".md")
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
  const verdicts = mergeVerdicts(headThenFragments(dir, "verdicts.jsonl", "verdicts.d", ".jsonl"))
  const briefText = readText(join(dir, "session-brief.json"))
  let brief = null
  try {
    brief = briefText === null ? null : JSON.parse(briefText)
  } catch {}
  return { taste, verdicts, brief: brief && typeof brief === "object" ? brief : null }
}

/** @param {string} text */
function oneLine(text) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= MAX_ITEM_TEXT ? flat : `${flat.slice(0, MAX_ITEM_TEXT - 3).trimEnd()}...`
}

/** @param {OpenItem} item */
function itemLine(item) {
  const where = item.line ? `${item.path}:${item.line}` : item.path
  return `- [${item.kind}] ${where}: ${oneLine(item.text)}`
}

/** @param {unknown} value */
const listOf = (value) => (Array.isArray(value) ? value : [])

/** @param {any} item */
const isOpenItem = (item) =>
  typeof item?.kind === "string" && typeof item?.path === "string" && typeof item?.text === "string"

/** @param {any} symbol */
const isChangedSymbol = (symbol) => typeof symbol?.symbol === "string" && Number.isFinite(symbol?.importers)

/**
 * @param {string} kind
 * @param {VerdictRow} row
 * @returns {OpenItem}
 */
const verdictItem = (kind, row) => ({
  kind,
  path: row.path,
  line: listOf(row.citations)[0]?.lineStart ?? null,
  text: typeof row.rationale === "string" ? row.rationale : "",
})

/**
 * Confirmed test gaps, then the brief's ratchet items, then other confirmed findings.
 * @param {unknown} verdicts
 * @param {SessionBrief | null | undefined} brief
 */
function openItems(verdicts, brief) {
  const confirmed = listOf(verdicts).filter((row) => isVerdictRow(row) && row.verdict === "confirmed")
  const testGaps = confirmed.filter((row) => TEST_GAP_SIGNALS.has(row.signal))
  const quality = confirmed.filter((row) => !TEST_GAP_SIGNALS.has(row.signal))
  return [
    ...testGaps.map((row) => verdictItem("test-gap", row)),
    ...listOf(brief?.openItems),
    ...quality.map((row) => verdictItem("quality", row)),
  ].filter(isOpenItem)
}

/**
 * @param {string[]} taste
 * @param {string[]} items
 * @param {string[]} symbols
 */
function assemble(taste, items, symbols) {
  const blocks = []
  if (taste.length > 0) blocks.push(["Conventions for this repository:", ...taste])
  if (items.length > 0) blocks.push(["Open review items:", ...items])
  if (symbols.length > 0) blocks.push(["Changed last session, most imported:", ...symbols])
  return blocks.map((lines) => lines.join("\n")).join("\n\n")
}

/**
 * Render the carried notes, never longer than MAX_CARRY_CHARS and never cut mid-line; "" when there are none.
 * Malformed entries are skipped, so a bad file can never cost the session its snapshot.
 * @param {Carry} carry
 */
export function formatCarry({ taste, verdicts, brief }) {
  const tasteLines = listOf(taste).filter((line) => typeof line === "string" && line.trim() !== "")
  const items = openItems(verdicts, brief).slice(0, MAX_OPEN_ITEMS).map(itemLine)
  const symbols = listOf(brief?.changedSymbols)
    .filter(isChangedSymbol)
    .slice(0, MAX_CHANGED_SYMBOLS)
    .map((s) => `- ${s.symbol} (${s.importers} importer${s.importers === 1 ? "" : "s"})`)
  let output = assemble(tasteLines, items, symbols)
  while (output.length > MAX_CARRY_CHARS) {
    if (symbols.length > 0) symbols.pop()
    else if (tasteLines.length > 0) tasteLines.pop()
    else items.pop()
    output = assemble(tasteLines, items, symbols)
  }
  return output
}
