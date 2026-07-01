import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Config utilities", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `codewatch-cli-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("loadConfig returns defaults when no config file exists", async () => {
    const { loadConfig } = await import("../utils/config.js");
    const config = await loadConfig(path.join(testDir, "config.json"));
    expect(config).toEqual({ githubToken: undefined, defaultRepos: [] });
  });

  it("saveConfig writes and loadConfig reads back", async () => {
    const { loadConfig, saveConfig } = await import("../utils/config.js");
    const configPath = path.join(testDir, "config.json");
    await saveConfig(configPath, {
      githubToken: "ghp_test123",
      defaultRepos: ["owner/repo-a"],
    });
    const loaded = await loadConfig(configPath);
    expect(loaded.githubToken).toBe("ghp_test123");
    expect(loaded.defaultRepos).toEqual(["owner/repo-a"]);
  });

  it("saveConfig creates parent directories if needed", async () => {
    const { saveConfig, loadConfig } = await import("../utils/config.js");
    const nested = path.join(testDir, "nested", "dir", "config.json");
    await saveConfig(nested, { githubToken: "ghp_abc", defaultRepos: [] });
    const loaded = await loadConfig(nested);
    expect(loaded.githubToken).toBe("ghp_abc");
  });
});

describe("Output utilities", () => {
  it("formatSuccess returns a styled success message", async () => {
    const { formatSuccess } = await import("../utils/output.js");
    const msg = formatSuccess("Profile saved");
    expect(msg).toContain("Profile saved");
  });

  it("formatError returns a styled error message", async () => {
    const { formatError } = await import("../utils/output.js");
    const msg = formatError("Something failed");
    expect(msg).toContain("Something failed");
  });

  it("formatStep returns a numbered step indicator", async () => {
    const { formatStep } = await import("../utils/output.js");
    const msg = formatStep(1, 5, "Ingesting repositories");
    expect(msg).toContain("1");
    expect(msg).toContain("5");
    expect(msg).toContain("Ingesting repositories");
  });

  it("formatConfidence returns color-coded confidence", async () => {
    const { formatConfidence } = await import("../utils/output.js");
    const high = formatConfidence(0.95);
    const low = formatConfidence(0.35);
    expect(high).toContain("95");
    expect(low).toContain("35");
  });
});

describe("Init command", () => {
  it("runInitPipeline orchestrates the full pipeline in correct order", async () => {
    const ingest = vi.fn().mockResolvedValue({ files: [], reviews: [] });
    const extract = vi.fn().mockResolvedValue([]);
    const aggregate = vi.fn().mockResolvedValue({});
    const enrich = vi.fn().mockResolvedValue({});
    const review = vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0",
      author: "testuser",
      generated: "2026-02-27",
      sources: ["owner/repo"],
      naming: {},
      structure: {},
      documentation: {},
      errorHandling: {},
      formatting: {},
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
    });
    const writeProfile = vi.fn().mockResolvedValue(undefined);

    const { runInitPipeline } = await import("../commands/init.js");

    await runInitPipeline({
      githubToken: "ghp_test",
      repos: ["owner/repo"],
      ingest,
      extract,
      aggregate,
      enrich,
      review,
      writeProfile,
      profilePath: "/tmp/test-profile.json",
    });

    expect(ingest).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    expect(aggregate).toHaveBeenCalledOnce();
    expect(enrich).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(writeProfile).toHaveBeenCalledOnce();

    const ingestOrder = ingest.mock.invocationCallOrder[0];
    const extractOrder = extract.mock.invocationCallOrder[0];
    const aggregateOrder = aggregate.mock.invocationCallOrder[0];
    const enrichOrder = enrich.mock.invocationCallOrder[0];
    const reviewOrder = review.mock.invocationCallOrder[0];
    const writeOrder = writeProfile.mock.invocationCallOrder[0];

    expect(ingestOrder).toBeLessThan(extractOrder);
    expect(extractOrder).toBeLessThan(aggregateOrder);
    expect(aggregateOrder).toBeLessThan(enrichOrder);
    expect(enrichOrder).toBeLessThan(reviewOrder);
    expect(reviewOrder).toBeLessThan(writeOrder);
  });

  it("runInitPipeline passes ingest output to extract", async () => {
    const corpus = { files: [{ path: "a.ts", content: "const x = 1;" }], reviews: [] };
    const ingest = vi.fn().mockResolvedValue(corpus);
    const extract = vi.fn().mockResolvedValue([]);
    const aggregate = vi.fn().mockResolvedValue({});
    const enrich = vi.fn().mockResolvedValue({});
    const review = vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0",
      author: "testuser",
      generated: "2026-02-27",
      sources: [],
      naming: {},
      structure: {},
      documentation: {},
      errorHandling: {},
      formatting: {},
      patterns: {},
      idioms: { detected: [] },
      antiPatterns: { acknowledged: [] },
      overrides: [],
    });
    const writeProfile = vi.fn().mockResolvedValue(undefined);

    const { runInitPipeline } = await import("../commands/init.js");

    await runInitPipeline({
      githubToken: "ghp_test",
      repos: ["owner/repo"],
      ingest,
      extract,
      aggregate,
      enrich,
      review,
      writeProfile,
      profilePath: "/tmp/test-profile.json",
    });

    expect(extract).toHaveBeenCalledWith(corpus);
  });

  it("runInitPipeline passes each stage output to the next", async () => {
    const corpusResult = { files: [], reviews: [] };
    const extractResult = [{ type: "naming", value: "camelCase" }];
    const aggregateResult = { naming: { camelCase: 0.9 } };
    const enrichResult = { naming: { camelCase: { confidence: 0.95 } } };
    const reviewResult = { schemaVersion: "1.0.0", naming: {} };

    const ingest = vi.fn().mockResolvedValue(corpusResult);
    const extract = vi.fn().mockResolvedValue(extractResult);
    const aggregate = vi.fn().mockResolvedValue(aggregateResult);
    const enrich = vi.fn().mockResolvedValue(enrichResult);
    const review = vi.fn().mockResolvedValue(reviewResult);
    const writeProfile = vi.fn().mockResolvedValue(undefined);

    const { runInitPipeline } = await import("../commands/init.js");

    await runInitPipeline({
      githubToken: "ghp_test",
      repos: ["owner/repo"],
      ingest,
      extract,
      aggregate,
      enrich,
      review,
      writeProfile,
      profilePath: "/tmp/test-profile.json",
    });

    expect(extract).toHaveBeenCalledWith(corpusResult);
    expect(aggregate).toHaveBeenCalledWith(extractResult);
    expect(enrich).toHaveBeenCalledWith(aggregateResult);
    expect(review).toHaveBeenCalledWith(enrichResult);
    expect(writeProfile).toHaveBeenCalledWith("/tmp/test-profile.json", reviewResult);
  });
});
