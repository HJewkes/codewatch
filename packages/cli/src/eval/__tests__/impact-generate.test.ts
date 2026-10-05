import { describe, it, expect } from "vitest";
import { documentFrequency, extractIdentifiers } from "../coding-hardness.js";
import { hardnessFeatures, type EditFileScreen } from "../coding-screen.js";
import {
  buildImpactTask,
  diffForFiles,
  distinctiveGoldIdentifiers,
  renderImpactPrompt,
  type ImpactCandidate,
} from "../impact-generate.js";
import type { ImpactTask } from "../impact-types.js";

/**
 * A fictional fix: `src/api/handler.ts` is the lit seed change, the dark
 * `src/wiring/route-table.ts` carries a logic change (the gold file), the dark
 * `src/wiring/index.ts` only toggles an export, and `src/notes.ts` only edits a
 * comment. Neither of the last two is gold or seed.
 */
const PARENT: Record<string, string> = {
  "src/api/handler.ts": "export function handleRequest(req) {\n  return req.body;\n}\n",
  "src/wiring/route-table.ts":
    "const quokkaRoutes = [];\nexport function mountQuokka(app) {\n  app.use(quokkaRoutes);\n}\n",
  "src/wiring/index.ts": "const shared = 1;\n",
  "src/notes.ts": "// old note\nexport const notes = [];\n",
  "src/other.ts": "export function handleRequest() {}\nexport const shared = 1;\n",
};

function section(path: string, removed: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,1 @@",
    `-${removed}`,
    `+${added}`,
    "",
  ].join("\n");
}

const SEED_SECTION = section("src/api/handler.ts", "  return req.body;", "  return req.body ?? {};");
const GOLD_DIFF = [
  SEED_SECTION,
  section("src/wiring/route-table.ts", "  app.use(quokkaRoutes);", "  app.use(\"/v2\", quokkaRoutes);"),
  section("src/wiring/index.ts", "const shared = 1;", "export const shared = 1;"),
  section("src/notes.ts", "// old note", "// new note"),
].join("");

const FILES: EditFileScreen[] = [
  { path: "src/api/handler.ts", light: "shares-identifier", hop: 1 },
  { path: "src/wiring/route-table.ts", light: "dark", hop: null, hunkKind: "logic" },
  { path: "src/wiring/index.ts", light: "dark", hop: null, hunkKind: "export-only" },
  { path: "src/notes.ts", light: "dark", hop: null, hunkKind: "comment-only" },
];

function candidate(over: Partial<ImpactCandidate> = {}): ImpactCandidate {
  return {
    fixCommit: "f".repeat(40),
    parentCommit: "e".repeat(40),
    testFiles: ["test/handler.test.ts"],
    editFiles: FILES.map((f) => f.path),
    testPatchDiff: "",
    goldDiff: GOLD_DIFF,
    stratum: "structurally-hidden",
    hardness: hardnessFeatures(FILES),
    packagesSpanned: 1,
    ...over,
  };
}

/** Filler files make the keywords common, so only fixture-specific names are distinctive. */
const FILLER = Array.from({ length: 10 }, () => "export const value = 1;\nexport function run() {\n  return value;\n}\n");
const DF = documentFrequency([...Object.values(PARENT), ...FILLER]);
const GOLD_IDS = distinctiveGoldIdentifiers([PARENT["src/wiring/route-table.ts"]!], DF);

function built(c: ImpactCandidate): ImpactTask {
  const result = buildImpactTask(c, GOLD_IDS);
  if (!result.ok) throw new Error(`rejected: ${result.reason} ${result.leaks?.join(", ")}`);
  return result.task;
}

/** Identifiers that appear in a gold file and in no other fixture file. */
function idsUniqueToGold(gold: readonly string[]): string[] {
  const elsewhere = new Set(
    Object.entries(PARENT)
      .filter(([path]) => !gold.includes(path))
      .flatMap(([, src]) => [...extractIdentifiers(src)]),
  );
  return gold.flatMap((p) => [...extractIdentifiers(PARENT[p]!)].filter((id) => !elsewhere.has(id)));
}

describe("buildImpactTask", () => {
  it("takes the logic dark files as gold and the lit files as seed", () => {
    const task = built(candidate());

    expect(task).toMatchObject({
      id: "impact-ffffffffffff",
      parentCommit: "e".repeat(40),
      seedFiles: ["src/api/handler.ts"],
      gold: ["src/wiring/route-table.ts"],
      seedDiff: SEED_SECTION,
    });
    expect(task.type).toBeUndefined();
  });

  it("never shows a gold path, basename or gold-only identifier in the seed diff or prompt", () => {
    const task = built(candidate());
    const texts = [task.seedDiff, renderImpactPrompt(task)];
    const uniqueIds = idsUniqueToGold(task.gold);

    expect(uniqueIds.length).toBeGreaterThan(0);
    for (const text of texts) {
      for (const path of task.gold) {
        expect(text).not.toContain(path);
        expect(text).not.toContain(path.slice(path.lastIndexOf("/") + 1));
        expect(text).not.toContain("route-table");
      }
      for (const id of uniqueIds) expect(extractIdentifiers(text).has(id)).toBe(false);
    }
  });

  it("carries the candidate's type when it has one", () => {
    expect(built(candidate({ type: "T2" })).type).toBe("T2");
  });

  it("rejects a candidate whose seed diff imports a gold file", () => {
    const leaky = section(
      "src/api/handler.ts",
      "  return req.body;",
      '  return import("../wiring/route-table.js");',
    );
    const c = candidate({ goldDiff: GOLD_DIFF.replace(SEED_SECTION, leaky) });

    const result = buildImpactTask(c, GOLD_IDS);

    expect(result).toMatchObject({ ok: false, reason: "gold-leak" });
    expect(result.ok ? [] : result.leaks).toEqual([
      "import:src/wiring/route-table.ts",
      "specifier:route-table",
    ]);
  });

  it("does not read the prompt's own wording as a gold identifier", () => {
    const ids = new Set([...GOLD_IDS, "repository", "existing", "change"]);

    expect(buildImpactTask(candidate(), ids).ok).toBe(true);
  });

  it("rejects a candidate whose seed diff names a distinctive gold identifier", () => {
    const leaky = section("src/api/handler.ts", "  return req.body;", "  return mountQuokka(req);");
    const c = candidate({ goldDiff: GOLD_DIFF.replace(SEED_SECTION, leaky) });

    expect(buildImpactTask(c, GOLD_IDS)).toEqual({
      ok: false,
      reason: "gold-leak",
      leaks: ["identifier:mountQuokka"],
    });
  });

  it("does not count a basename the seed shares with a gold file as a leak", () => {
    const files: EditFileScreen[] = [
      { path: "src/api/index.ts", light: "test-imported", hop: 1 },
      { path: "src/wiring/index.ts", light: "dark", hop: null, hunkKind: "logic" },
    ];
    const goldDiff =
      section("src/api/index.ts", "export * from './a';", "export * from './b';") +
      section("src/wiring/index.ts", "mount(a);", "mount(b);");

    const task = built(candidate({ goldDiff, hardness: hardnessFeatures(files) }));

    expect(task.gold).toEqual(["src/wiring/index.ts"]);
    expect(task.seedDiff).not.toContain("src/wiring/index.ts");
  });

  it("rejects a candidate with no logic dark file", () => {
    const files = FILES.filter((f) => f.hunkKind !== "logic");

    expect(buildImpactTask(candidate({ hardness: hardnessFeatures(files) }))).toEqual({
      ok: false,
      reason: "no-gold",
    });
  });

  it("rejects a candidate with no lit file to seed from", () => {
    const files = FILES.filter((f) => f.light === "dark");

    expect(buildImpactTask(candidate({ hardness: hardnessFeatures(files) }))).toEqual({
      ok: false,
      reason: "no-seed",
    });
  });
});

describe("diffForFiles", () => {
  it("keeps only the sections of the named files", () => {
    expect(diffForFiles(GOLD_DIFF, ["src/notes.ts"])).toBe(
      section("src/notes.ts", "// old note", "// new note"),
    );
  });
});

describe("renderImpactPrompt", () => {
  it("states the answer budget and holds the seed diff", () => {
    const prompt = renderImpactPrompt(built(candidate()), 5);

    expect(prompt).toContain("at most 5");
    expect(prompt).toContain("return req.body ?? {};");
  });
});
