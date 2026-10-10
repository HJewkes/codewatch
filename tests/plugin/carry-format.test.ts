import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error plain ESM hook script without a declaration file
import { carryLimitsFromEnv, formatCarry, readCarry } from "../../plugins/codewatch/hooks/carry-format.mjs"
import { fixture, writeCarryFiles } from "./carry-fixtures"

const rows = (name: string) => fixture(name).trim().split("\n").map((line) => JSON.parse(line))
const brief = JSON.parse(fixture("session-brief.json"))
const tasteLines = [...fixture("taste.md").trim().split("\n"), fixture("taste-fragment.md").trim()]

describe("formatCarry", () => {
  it("is empty when there is no taste, no verdict and no brief", () => {
    expect(formatCarry({ taste: [], verdicts: [], brief: null })).toBe("")
    expect(formatCarry({ taste: ["  "], verdicts: rows("verdicts.jsonl").slice(1), brief: { openItems: [] } })).toBe("")
  })

  const verdicts = () => [...rows("verdicts.jsonl").slice(0, 1), ...rows("verdicts-fragment.jsonl")]

  it("renders taste, then every test gap, ratchet item and confirmed finding, then changed symbols, when no cap is set", () => {
    const output: string = formatCarry({ taste: tasteLines, verdicts: verdicts(), brief })

    expect(output).toBe(
      [
        "Conventions for this repository:",
        ...tasteLines,
        "",
        "Open review items:",
        "- [test-gap] shop/cart.py:41: No test executes the new rounding branch of Cart.total.",
        "- [ratchet] shop/pricing.py:12: symbol_cyclomatic=14 (max 10)",
        "- [quality] shop/pricing.py:30: The two discount branches do the same job.",
        "- [quality] shop/cart.py:8: A fourth item is never shown.",
        "",
        "Changed last session, most imported:",
        "- shop/pricing.py#apply_discount (3 importers)",
        "- shop/cart.py#Cart (1 importer)",
      ].join("\n"),
    )
  })

  it("keeps only the first maxOpenItems open items when that cap is set", () => {
    const output: string = formatCarry({ taste: [], verdicts: verdicts(), brief }, { maxOpenItems: 3 })

    expect(output).toContain("- [quality] shop/pricing.py:30:")
    expect(output).not.toContain("A fourth item is never shown.")
  })

  it("renders a section alone when only it is present", () => {
    const output: string = formatCarry({ taste: [], verdicts: [], brief: { changedSymbols: brief.changedSymbols } })

    expect(output.startsWith("Changed last session, most imported:")).toBe(true)
    expect(output).not.toContain("Conventions")
  })

  it("leaves a long carry whole when no character cap is set", () => {
    const longTaste = Array.from({ length: 400 }, (_, i) => `- Taste line ${i} with some padding text. {inferred cp1 fp:k${i}}`)

    const output: string = formatCarry({ taste: longTaste, verdicts: [], brief })

    expect(output.length).toBeGreaterThan(6000)
    expect(output.split("\n").filter((l) => l.startsWith("- Taste line"))).toHaveLength(400)
    expect(output).toContain("most imported")
  })

  it("stays within maxChars by dropping symbols, then taste lines, never cutting a line", () => {
    const longTaste = Array.from({ length: 400 }, (_, i) => `- Taste line ${i} with some padding text. {inferred cp1 fp:k${i}}`)
    const manySymbols = Array.from({ length: 5 }, (_, i) => ({ symbol: `pkg/mod.py#f${i}`, importers: 9 - i }))

    const output: string = formatCarry({ taste: longTaste, verdicts: [], brief: { ...brief, changedSymbols: manySymbols } }, { maxChars: 6000 })

    expect(output.length).toBeLessThanOrEqual(6000)
    expect(output).not.toContain("most imported")
    expect(output).toContain("Open review items:")
    for (const line of output.split("\n").filter((l) => l.startsWith("- Taste line"))) {
      expect(line).toMatch(/\{inferred cp1 fp:k\d+\}$/)
    }
  })

  it("skips malformed entries instead of throwing", () => {
    const malformed = {
      openItems: [null, { kind: "quality", path: "a.py", line: 1, text: null }, "x", brief.openItems[0]],
      changedSymbols: [null, { symbol: 3, importers: 1 }, { symbol: "a.py#f", importers: "many" }],
    }

    const output: string = formatCarry({ taste: [42, null], verdicts: [null, { verdict: "confirmed" }], brief: malformed })

    expect(output).toBe("Open review items:\n- [ratchet] shop/pricing.py:12: symbol_cyclomatic=14 (max 10)")
  })

  it("clips a long item text to one line", () => {
    const item = { kind: "quality", path: "a.py", line: 1, text: `${"word ".repeat(80)}\nsecond line` }

    const output: string = formatCarry({ taste: [], verdicts: [], brief: { openItems: [item] } })

    const line = output.split("\n")[1]
    expect(line.endsWith("...")).toBe(true)
    expect(output.split("\n")).toHaveLength(2)
  })
})

describe("carryLimitsFromEnv", () => {
  it("leaves both caps off when the variables are unset", () => {
    expect(carryLimitsFromEnv({})).toEqual({ maxChars: undefined, maxOpenItems: undefined })
  })

  it("turns a token count into a character cap and reads the open-items cap", () => {
    const env = { CODEWATCH_CARRY_MAX_TOKENS: "1500", CODEWATCH_CARRY_MAX_OPEN_ITEMS: "3" }

    expect(carryLimitsFromEnv(env)).toEqual({ maxChars: 6000, maxOpenItems: 3 })
  })

  it("ignores values that are not whole numbers of at least 1", () => {
    const env = { CODEWATCH_CARRY_MAX_TOKENS: "0", CODEWATCH_CARRY_MAX_OPEN_ITEMS: "many" }

    expect(carryLimitsFromEnv(env)).toEqual({ maxChars: undefined, maxOpenItems: undefined })
  })
})

describe("readCarry", () => {
  let root: string

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("reads the heads, then fragments in id order, a fragment row replacing the head row with its key", () => {
    root = mkdtempSync(join(tmpdir(), "cw-carry-"))
    writeCarryFiles(root)
    writeFileSync(join(root, ".codewatch", "taste.d", "cp-10.md"), "- Tenth. {inferred cp10 fp:k}\n")
    writeFileSync(join(root, ".codewatch", "taste.d", "notes.txt"), "not a fragment\n")

    const carry = readCarry(root)

    expect(carry.taste).toEqual([...tasteLines, "- Tenth. {inferred cp10 fp:k}"])
    expect(carry.verdicts.map((v: { path: string; verdict: string }) => `${v.path} ${v.verdict}`)).toEqual([
      "shop/pricing.py confirmed",
      "shop/cart.py confirmed",
      "shop/cart.py justified",
      "shop/cart.py confirmed",
    ])
    expect(carry.brief).toEqual(brief)
  })

  it("skips malformed verdict rows and treats a malformed brief as absent", () => {
    root = mkdtempSync(join(tmpdir(), "cw-carry-"))
    mkdirSync(join(root, ".codewatch"))
    writeFileSync(join(root, ".codewatch", "verdicts.jsonl"), `{truncated\n${fixture("verdicts.jsonl")}`)
    writeFileSync(join(root, ".codewatch", "session-brief.json"), "{not json")

    const carry = readCarry(root)

    expect(carry.verdicts).toHaveLength(3)
    expect(carry.brief).toBeNull()
  })

  it("reads nothing from a directory without .codewatch", () => {
    root = mkdtempSync(join(tmpdir(), "cw-carry-"))

    expect(readCarry(root)).toEqual({ taste: [], verdicts: [], brief: null })
  })
})
