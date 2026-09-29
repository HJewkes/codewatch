import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  decideAugment,
  MAX_AUGMENT_FILES,
  normalizeIdentifier,
  // @ts-expect-error plain ESM hook script without a declaration file
} from "../../plugins/codewatch/hooks/grep-augment-core.mjs"

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures")
const GREP_FIXTURES = ["grep-files-with-matches.json", "grep-content.json"]
const readFixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))
const filesPayload = readFixture("grep-files-with-matches.json")
const contentPayload = readFixture("grep-content.json")
const SNAPSHOT_FILE = "plugins/codewatch/hooks/snapshot-format.mjs"

interface Hit {
  id: string
  kind: string
  name: string
}

function symbolHit(file: string, name: string): Hit {
  return { id: `${file}#${name}`, kind: "symbol", name }
}

function stubApi(hits: Hit[], callers: string[]) {
  return {
    search: (query: string) => ({ query, hits: hits.map((h) => ({ ...h, path: h.id.split("#")[0], score: 100 })) }),
    getNeighbors: () => ({
      callers: callers.map((from) => ({ from, to: hits[0]?.id ?? "", kind: "references", weight: 1 })),
      dependencies: [],
      coupledWith: [],
      note: "",
    }),
  }
}

function withPattern(payload: Record<string, unknown>, pattern: string) {
  return { ...payload, tool_input: { ...(payload.tool_input as object), pattern } }
}

const callerFiles = (count: number) => Array.from({ length: count }, (_, i) => `src/caller-${i}.ts`)
const listedFiles = (text: string) => text.split("\n").slice(1)

describe("normalizeIdentifier", () => {
  it("accepts bare identifiers and strips word boundaries", () => {
    expect(normalizeIdentifier("formatSnapshot")).toBe("formatSnapshot")
    expect(normalizeIdentifier("\\bformatSnapshot\\b")).toBe("formatSnapshot")
    expect(normalizeIdentifier("$store_1")).toBe("$store_1")
  })

  it("rejects regexes, paths, phrases and short names", () => {
    for (const pattern of ["format.*Snapshot", "foo|bar", "src/foo.ts", "import foo", "fo", "1abc", "foo(", ""]) {
      expect(normalizeIdentifier(pattern), pattern).toBeNull()
    }
  })
})

describe("decideAugment over the files_with_matches fixture", () => {
  it("lists callers missing from the grep result and drops ones already in it", () => {
    const api = stubApi([symbolHit("src/snapshot.ts", "formatSnapshot")], [SNAPSHOT_FILE, "src/a.ts", "src/b.ts"])

    const text = decideAugment(filesPayload, api)

    expect(text.split("\n")[0]).toBe(
      "codewatch: 2 files use `formatSnapshot` through re-export barrels and did not match this search:",
    )
    expect(listedFiles(text)).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("caps the listed callers at 15", () => {
    const api = stubApi([symbolHit("src/snapshot.ts", "formatSnapshot")], callerFiles(20))

    const text = decideAugment(filesPayload, api)

    expect(MAX_AUGMENT_FILES).toBe(15)
    expect(listedFiles(text)).toEqual(callerFiles(15))
    expect(text).toContain("20 files use")
  })

  it("lists each caller file once when several edges come from it", () => {
    const api = stubApi([symbolHit("src/snapshot.ts", "formatSnapshot")], ["src/a.ts", "src/a.ts"])

    expect(listedFiles(decideAugment(filesPayload, api))).toEqual(["src/a.ts"])
  })

  it("returns null when every caller is already in the grep result", () => {
    const api = stubApi([symbolHit("src/snapshot.ts", "formatSnapshot")], [SNAPSHOT_FILE])

    expect(decideAugment(filesPayload, api)).toBeNull()
  })
})

describe("decideAugment over the content fixture", () => {
  it("parses file paths from content lines to filter callers", () => {
    const api = stubApi([symbolHit("src/snapshot.ts", "clipSummary")], [SNAPSHOT_FILE, "src/c.ts"])

    expect(listedFiles(decideAugment(contentPayload, api))).toEqual(["src/c.ts"])
  })

  it("filters callers against context lines and a grep run from a subdirectory", () => {
    const payload = {
      ...contentPayload,
      tool_response: { mode: "content", filenames: [], content: "hooks/a-b.mjs-12-context\nhooks/c.mjs:3:hit" },
    }
    const callers = ["plugins/codewatch/hooks/a-b.mjs", "plugins/codewatch/hooks/c.mjs", "src/d.ts"]
    const api = stubApi([symbolHit("src/snapshot.ts", "clipSummary")], callers)

    expect(listedFiles(decideAugment(payload, api))).toEqual(["src/d.ts"])
  })
})

describe("decideAugment returns null", () => {
  it("for a regex, path or phrase pattern without querying the graph", () => {
    const api = {
      search: () => {
        throw new Error("search must not run")
      },
      getNeighbors: () => {
        throw new Error("getNeighbors must not run")
      },
    }

    for (const pattern of ["format.*Snapshot", "hooks/snapshot-format", "format snapshot"]) {
      expect(decideAugment(withPattern(filesPayload, pattern), api), pattern).toBeNull()
    }
  })

  it("when no exported symbol matches the name exactly", () => {
    const hits = [symbolHit("src/a.ts", "formatSnapshotLine"), { id: "src/formatSnapshot.ts", kind: "file", name: "formatSnapshot.ts" }]
    const api = stubApi(hits, ["src/b.ts"])

    expect(decideAugment(filesPayload, api)).toBeNull()
  })

  it("when two exported symbols share the name", () => {
    const hits = [symbolHit("src/a.ts", "formatSnapshot"), symbolHit("src/b.ts", "formatSnapshot")]
    const api = stubApi(hits, ["src/c.ts"])

    expect(decideAugment(filesPayload, api)).toBeNull()
  })

  it("when the name matches only in a different case", () => {
    const api = stubApi([symbolHit("src/a.ts", "FormatSnapshot")], ["src/c.ts"])

    expect(decideAugment(filesPayload, api)).toBeNull()
  })
})

describe("grep fixtures", () => {
  it("carry no absolute home paths or email addresses", () => {
    const names = readdirSync(FIXTURES).filter((name) => name.startsWith("grep-"))
    expect(names.sort()).toEqual([...GREP_FIXTURES].sort())
    for (const name of names) {
      const text = readFileSync(join(FIXTURES, name), "utf8")
      expect(text, name).not.toContain("/Users/")
      expect(text, name).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })
})
