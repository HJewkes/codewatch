import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { AggregatorResult, Observation } from "@titan-design/style-analyzer";
import type { CodeCorpus } from "@codewatch/core";

const FIXTURE_FILES: Record<string, string> = {
  "src/index.ts": [
    "export const maxRetries = 3;",
    "export function fetchUser(userId: string): string {",
    "  if (!userId) {",
    "    throw new Error('missing id');",
    "  }",
    "  return `user:${userId}`;",
    "}",
  ].join("\n"),
  "src/utils.ts": [
    "export const defaultTimeout = 500;",
    "export function addNumbers(left: number, right: number): number {",
    "  return left + right;",
    "}",
  ].join("\n"),
  "README.md": "# fixture",
  "lib/legacy.js": "module.exports = 1;",
};

function fixtureCorpus(languages: string[], parser: typeof import("@titan-design/code-parser")): CodeCorpus {
  const files = Object.entries(FIXTURE_FILES)
    .filter(([filePath]) => parser.shouldIncludeFile(filePath, languages))
    .map(([filePath, content]) => ({
      path: filePath,
      content,
      language: parser.getLanguageFromPath(filePath) ?? "unknown",
      repo: "octo/fixture",
      sha: "abc123",
    }));
  return {
    files,
    pullRequests: [],
    reviewComments: [],
    metadata: {
      repos: ["octo/fixture"], author: "octo", fetchedAt: "2026-09-22T00:00:00Z",
      totalCommits: 1, totalFiles: files.length, totalReviewComments: 0,
    },
  };
}

describe("codewatch init pipeline on a fixture repository", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `codewatch-init-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("ingests files with the default languages and saves a profile the schema accepts", async () => {
    const parser = await import("@titan-design/code-parser");
    const analyzer = await import("@titan-design/style-analyzer");
    const { ProfileSchema, readProfile, writeProfile } = await import("@titan-design/style-profile");
    const { runInitPipeline } = await import("../commands/init.js");
    const { profileFromAggregation } = await import("../commands/profile-from-aggregation.js");
    const { resolveLanguages } = await import("../utils/languages.js");
    const { extractFromFiles } = await import("../utils/pipeline.js");

    const profilePath = path.join(testDir, "profile.json");
    let ingestedPaths: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInitPipeline({
        githubToken: "ghp_fixture",
        repos: ["octo/fixture"],
        profilePath,
        ingest: async () => {
          const corpus = fixtureCorpus(resolveLanguages(undefined), parser);
          ingestedPaths = corpus.files.map((f) => f.path);
          return corpus;
        },
        extract: async (corpus) =>
          extractFromFiles(
            (corpus as CodeCorpus).files,
            analyzer.createStyleExtractors(),
            parser.parseFile,
          ),
        aggregate: async (observations) =>
          new analyzer.Aggregator().aggregate(observations as Observation[]),
        enrich: async (aggregated, corpus) =>
          profileFromAggregation(aggregated as AggregatorResult, {
            author: (corpus as CodeCorpus).metadata.author,
            sources: ["octo/fixture"],
          }),
        review: async (enriched) => enriched,
        writeProfile: (filePath, profile) => writeProfile(filePath, profile),
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(ingestedPaths.sort()).toEqual(["src/index.ts", "src/utils.ts"]);

    const saved = JSON.parse(await fs.readFile(profilePath, "utf8"));
    expect(ProfileSchema.safeParse(saved).success).toBe(true);
    const loaded = await readProfile(profilePath);
    expect(loaded.author).toBe("octo");
    expect(loaded.sources).toEqual(["octo/fixture"]);
    expect(Object.keys(loaded.naming).length).toBeGreaterThan(0);
  });
});
