import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

const SOURCE = [
  "export function getUser(id: number): string {",
  "  if (id < 0) {",
  '    throw new Error("bad id");',
  "  }",
  '  return "alice";',
  "}",
  "",
].join("\n");

const ranExtractors = new Set<string>();

vi.mock("@titan-design/style-analyzer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@titan-design/style-analyzer")>();
  return {
    ...actual,
    createStyleExtractors: () =>
      actual.createStyleExtractors().map((extractor) => ({
        name: extractor.name,
        extract: (file: Parameters<typeof extractor.extract>[0]) => {
          ranExtractors.add(extractor.name);
          return extractor.extract(file);
        },
      })),
  };
});

vi.mock("@codewatch/core", () => ({
  GitHubService: class {
    async ingest() {
      return {
        files: [{ path: "user.ts", content: SOURCE, language: "typescript", repo: "o/r", sha: "x" }],
      };
    }
  },
}));

vi.mock("../utils/config.js", () => ({
  getDefaultProfilePath: () => "unused",
  getDefaultConfigPath: () => "unused",
  loadConfig: async () => ({}),
}));

vi.mock("@titan-design/style-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@titan-design/style-profile")>()),
  readProfile: async () => ({ author: "a", sources: ["o/r"], overrides: [] }),
  writeProfile: async () => undefined,
}));

vi.mock("../interactive/review.js", () => ({
  runReviewSession: async <T>(profile: T) => profile,
}));

async function extractorsRunBy(command: () => Promise<unknown>): Promise<string[]> {
  ranExtractors.clear();
  await command();
  return [...ranExtractors].sort();
}

describe("style extractor parity", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-parity-"));
    await fs.writeFile(path.join(testDir, "user.ts"), SOURCE);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("runs the same extractors in update as in analyze", async () => {
    const { runAnalyze } = await import("../commands/analyze.js");
    const { runUpdate } = await import("../commands/update.js");

    const analyzed = await extractorsRunBy(() =>
      runAnalyze({ rootDir: testDir, languages: ["typescript"] }),
    );
    const updated = await extractorsRunBy(() =>
      runUpdate({ githubToken: "token", repos: ["o/r"] }),
    );

    expect(analyzed).toContain("formatting");
    expect(analyzed).toContain("complexity");
    expect(updated).toEqual(analyzed);
  });
});
