import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error plain ESM hook script without a declaration file
import { formatCarry, MAX_CARRY_CHARS, readCarry } from "../../plugins/codewatch/hooks/carry-format.mjs"

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures")
const rubric = readFileSync(join(FIXTURES, "rubric.md"), "utf8")
const brief = JSON.parse(readFileSync(join(FIXTURES, "session-brief.json"), "utf8"))

describe("formatCarry", () => {
  it("is empty when there is no rubric and no brief", () => {
    expect(formatCarry({ rubric: null, brief: null })).toBe("")
    expect(formatCarry({ rubric: "  \n", brief: { openItems: [], changedSymbols: [] } })).toBe("")
  })

  it("renders the rubric, then at most 3 open items in brief order, then changed symbols", () => {
    const output: string = formatCarry({ rubric, brief })

    expect(output).toBe(
      [
        "Review notes from the last session:",
        rubric.trim(),
        "",
        "Open review items:",
        "- [regression] shop/cart.py:41: The total no longer rounds half-up, and no spec line asks for the change.",
        "- [ratchet] shop/pricing.py:12: symbol_cyclomatic=14 (max 10)",
        "- [quality] shop/pricing.py:30: The two discount branches do the same job.",
        "",
        "Changed last session, most imported:",
        "- shop/pricing.py#apply_discount (3 importers)",
        "- shop/cart.py#Cart (1 importer)",
      ].join("\n"),
    )
  })

  it("renders a section alone when only it is present", () => {
    const output: string = formatCarry({ rubric: null, brief: { changedSymbols: brief.changedSymbols } })

    expect(output.startsWith("Changed last session, most imported:")).toBe(true)
    expect(output).not.toContain("Review notes")
  })

  it("stays within MAX_CARRY_CHARS by dropping symbols, then rubric lines, never cutting a line", () => {
    const longRubric = Array.from({ length: 400 }, (_, i) => `Rubric line ${i} with some padding text.`).join("\n")
    const manySymbols = Array.from({ length: 5 }, (_, i) => ({ symbol: `pkg/mod.py#f${i}`, importers: 9 - i }))

    const output: string = formatCarry({ rubric: longRubric, brief: { ...brief, changedSymbols: manySymbols } })

    expect(output.length).toBeLessThanOrEqual(MAX_CARRY_CHARS)
    expect(output).not.toContain("most imported")
    expect(output).toContain("Open review items:")
    for (const line of output.split("\n").filter((l) => l.startsWith("Rubric line"))) {
      expect(line).toMatch(/padding text\.$/)
    }
  })

  it("clips a long item text to one line", () => {
    const item = { kind: "quality", path: "a.py", line: 1, text: `${"word ".repeat(80)}\nsecond line` }

    const output: string = formatCarry({ rubric: null, brief: { openItems: [item] } })

    const line = output.split("\n")[1]
    expect(line.endsWith("...")).toBe(true)
    expect(output.split("\n")).toHaveLength(2)
  })
})

describe("readCarry", () => {
  let root: string

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("reads both files and treats a malformed brief as absent", () => {
    root = mkdtempSync(join(tmpdir(), "cw-carry-"))
    mkdirSync(join(root, ".codewatch"))
    writeFileSync(join(root, ".codewatch", "rubric.md"), rubric)
    writeFileSync(join(root, ".codewatch", "session-brief.json"), "{not json")

    expect(readCarry(root)).toEqual({ rubric, brief: null })
  })

  it("reads nothing from a directory without .codewatch", () => {
    root = mkdtempSync(join(tmpdir(), "cw-carry-"))

    expect(readCarry(root)).toEqual({ rubric: null, brief: null })
  })
})
