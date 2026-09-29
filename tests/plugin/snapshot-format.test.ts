import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
// @ts-expect-error plain ESM hook script without a declaration file
import { formatSnapshot, MAX_SNAPSHOT_CHARS } from "../../plugins/codewatch/hooks/snapshot-format.mjs"

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures")
const conventionsText = readFileSync(join(FIXTURES, "conventions.json"), "utf8")
const conventions = JSON.parse(conventionsText)
const top = JSON.parse(readFileSync(join(FIXTURES, "top.json"), "utf8"))
const SNAPSHOT_SHA: string = top.snapshot.commitHash
const OTHER_SHA = "0123456789abcdef0123456789abcdef01234567"

function areaLines(output: string): string[] {
  const start = output.split("\n").indexOf("Capability areas:")
  if (start === -1) return []
  const rest = output.split("\n").slice(start + 1)
  const end = rest.findIndex((line) => !line.startsWith("- "))
  return end === -1 ? rest : rest.slice(0, end)
}

function syntheticArea(index: number, summary: string | null, label = `src/area-${index}`) {
  return { id: `area-${index}`, label, size: 50 - index, files: [], summary }
}

function summaryOf(line: string): string {
  return line.slice(line.indexOf("): ") + 3)
}

describe("formatSnapshot over the captured codewatch fixtures", () => {
  it("stays within the character cap with the full conventions payload", () => {
    const output = formatSnapshot({ conventions, top, head: SNAPSHOT_SHA })

    expect(conventionsText.length).toBeGreaterThan(36_000)
    expect(MAX_SNAPSHOT_CHARS).toBe(6000)
    expect(output.length).toBeLessThanOrEqual(6000)
  })

  it("opens with the snapshot header and lists every fixture area and top file", () => {
    const output = formatSnapshot({ conventions, top, head: SNAPSHOT_SHA })

    expect(output.split("\n")[0]).toBe(
      `codewatch snapshot (${SNAPSHOT_SHA.slice(0, 7)}, ${top.snapshot.takenAt.slice(0, 10)})`,
    )
    expect(areaLines(output)).toHaveLength(conventions.areas.length)
    for (const row of top.rows) expect(output).toContain(row.nodeId)
    expect(output).toContain("get_context")
  })

  it("cuts each summary to whole sentences within 200 chars on one line", () => {
    const output = formatSnapshot({ conventions, top, head: SNAPSHOT_SHA })

    for (const line of areaLines(output)) {
      const summary = summaryOf(line)
      expect(summary.length).toBeLessThanOrEqual(200)
      expect(summary).toMatch(/([.!?]|\.\.\.)$/)
    }
  })

  it("omits the staleness line when the snapshot commit is HEAD", () => {
    const output = formatSnapshot({ conventions, top, head: SNAPSHOT_SHA })

    expect(output).not.toMatch(/stale/)
  })

  it("adds a staleness line when HEAD differs from the snapshot commit", () => {
    const output = formatSnapshot({ conventions, top, head: OTHER_SHA, commitsBehind: 3 })

    expect(output.split("\n")[1]).toBe(
      `Snapshot is 3 commits behind HEAD (${OTHER_SHA.slice(0, 7)}); edges may be stale.`,
    )
  })

  it("still flags staleness when the commit distance is unknown", () => {
    const output = formatSnapshot({ conventions, top, head: OTHER_SHA })

    expect(output.split("\n")[1]).toMatch(/differs from HEAD .*may be stale/)
  })
})

describe("formatSnapshot bounds", () => {
  const longSummary =
    "This area does one precise thing in a sentence that fits. " + "More detail follows here. ".repeat(20)

  it("renders at most 8 area lines", () => {
    const areas = Array.from({ length: 12 }, (_, i) => syntheticArea(i, longSummary))

    const output = formatSnapshot({ conventions: { areas }, top, head: SNAPSHOT_SHA })

    expect(areaLines(output)).toHaveLength(8)
    expect(output).not.toContain("src/area-8")
  })

  it("renders the label only when an area has no summary", () => {
    const areas = [syntheticArea(0, null), syntheticArea(1, "")]

    const lines = areaLines(formatSnapshot({ conventions: { areas }, top, head: SNAPSHOT_SHA }))

    expect(lines).toEqual(["- src/area-0 (50 files)", "- src/area-1 (49 files)"])
  })

  it("does not split on abbreviations and falls back to a word cut for one long sentence", () => {
    const abbreviated = "Compares snapshots, e.g. a baseline vs. head, for CI. Second sentence."
    const runOn = `Handles ${"many related concerns and ".repeat(12)}more`
    const areas = [syntheticArea(0, abbreviated), syntheticArea(1, runOn)]

    const [first, second] = areaLines(formatSnapshot({ conventions: { areas }, top, head: SNAPSHOT_SHA }))

    expect(summaryOf(first!)).toBe("Compares snapshots, e.g. a baseline vs. head, for CI.")
    expect(summaryOf(second!).length).toBeLessThanOrEqual(200)
    expect(summaryOf(second!)).toMatch(/[a-z]\.\.\.$/)
  })

  it("drops whole area lines from the bottom to honour the cap", () => {
    const label = `src/${"deeply/nested/".repeat(60)}area`
    const areas = Array.from({ length: 8 }, (_, i) => syntheticArea(i, longSummary, `${label}-${i}`))

    const output = formatSnapshot({ conventions: { areas }, top, head: SNAPSHOT_SHA })
    const lines = areaLines(output)

    expect(output.length).toBeLessThanOrEqual(6000)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThan(8)
    lines.forEach((line, i) => expect(line.startsWith(`- ${label}-${i} (`)).toBe(true))
    for (const row of top.rows) expect(output).toContain(row.nodeId)
  })

  it("renders the top files and tools when conventions are unavailable", () => {
    const output = formatSnapshot({ conventions: null, top, head: SNAPSHOT_SHA })

    expect(areaLines(output)).toEqual([])
    expect(output).toContain(top.rows[0].nodeId)
  })
})

describe("snapshot fixtures", () => {
  it("contain no absolute home paths or email addresses", () => {
    for (const name of readdirSync(FIXTURES)) {
      const text = readFileSync(join(FIXTURES, name), "utf8")
      expect(text, name).not.toContain("/Users/")
      expect(text, name).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })
})
