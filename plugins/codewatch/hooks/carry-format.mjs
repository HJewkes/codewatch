// @ts-check
// Review notes carried from the last codewatch synthesis: `.codewatch/rubric.md` and `.codewatch/session-brief.json`.

import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * @typedef {{ kind: string, path: string, line?: number | null, text: string }} OpenItem
 * @typedef {{ symbol: string, importers: number }} ChangedSymbol
 * @typedef {{ openItems?: OpenItem[], changedSymbols?: ChangedSymbol[] }} SessionBrief
 * @typedef {{ rubric?: string | null, brief?: SessionBrief | null }} Carry
 */

// 1.5k tokens at about 4 characters per token.
export const MAX_CARRY_CHARS = 6000
export const MAX_OPEN_ITEMS = 3
export const MAX_CHANGED_SYMBOLS = 5
const MAX_ITEM_TEXT = 200

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
 * Read the carry files under `<root>/.codewatch`; a missing or malformed file reads as absent.
 * @param {string} root
 * @returns {Carry}
 */
export function readCarry(root) {
  const rubric = readText(join(root, ".codewatch", "rubric.md"))
  const briefText = readText(join(root, ".codewatch", "session-brief.json"))
  let brief = null
  try {
    brief = briefText === null ? null : JSON.parse(briefText)
  } catch {}
  return { rubric, brief: brief && typeof brief === "object" ? brief : null }
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

/**
 * @param {string[]} rubric
 * @param {string[]} items
 * @param {string[]} symbols
 */
function assemble(rubric, items, symbols) {
  const blocks = []
  if (rubric.length > 0) blocks.push(["Review notes from the last session:", ...rubric])
  if (items.length > 0) blocks.push(["Open review items:", ...items])
  if (symbols.length > 0) blocks.push(["Changed last session, most imported:", ...symbols])
  return blocks.map((lines) => lines.join("\n")).join("\n\n")
}

/**
 * Render the carried notes, never longer than MAX_CARRY_CHARS and never cut mid-line; "" when there are none.
 * @param {Carry} carry
 */
export function formatCarry({ rubric, brief }) {
  const rubricLines = (rubric ?? "").trim() === "" ? [] : (rubric ?? "").trim().split("\n")
  const items = listOf(brief?.openItems).slice(0, MAX_OPEN_ITEMS).map(itemLine)
  const symbols = listOf(brief?.changedSymbols)
    .slice(0, MAX_CHANGED_SYMBOLS)
    .map((s) => `- ${s.symbol} (${s.importers} importer${s.importers === 1 ? "" : "s"})`)
  let output = assemble(rubricLines, items, symbols)
  while (output.length > MAX_CARRY_CHARS) {
    if (symbols.length > 0) symbols.pop()
    else if (rubricLines.length > 0) rubricLines.pop()
    else items.pop()
    output = assemble(rubricLines, items, symbols)
  }
  return output
}
