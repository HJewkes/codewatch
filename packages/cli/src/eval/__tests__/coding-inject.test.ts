import { describe, it, expect } from "vitest";
import {
  buildInjection,
  estimateTokens,
  injectPrompt,
  type BundleFor,
  type LineOf,
} from "../coding-inject.js";
import type { BundleEdge, ContextBundle } from "../../commands/graph-context-bundle.js";
import type { CodingTask } from "../coding-types.js";

const TEST_FILE = "test/router.test.ts";

function edge(from: string, to: string, relevance: number, kind = "references"): BundleEdge {
  return { from, to, kind, weight: 1, relevance };
}

function bundleOf(dependencies: BundleEdge[], callers: BundleEdge[] = []): ContextBundle {
  return {
    edges: { callers, dependencies, coupledWith: [], note: "" },
  } as unknown as ContextBundle;
}

function taskWith(files: string[]): CodingTask {
  const task = {
    id: "abc123::src/router.ts",
    problemStatement: "The router drops trailing slashes.",
    testPatch: { files, diff: files.map((f) => `+++ b/${f}\n`).join("") },
  };
  const trap = (): never => {
    throw new Error("gold field read");
  };
  Object.defineProperty(task, "editFiles", { get: trap });
  Object.defineProperty(task, "goldDiff", { get: trap });
  return task as unknown as CodingTask;
}

function manyDeps(seed: string, n: number): BundleEdge[] {
  return Array.from({ length: n }, (_, i) =>
    edge(seed, `src/mod${String(i).padStart(2, "0")}.ts#fn${i}`, 1 - i / 100),
  );
}

const LINES: LineOf = (id) => (id.includes("#") ? 7 : undefined);

describe("buildInjection", () => {
  it("caps injected citations at the budget and never reads the gold edit files", () => {
    const bundleFor: BundleFor = (seed) => bundleOf(manyDeps(seed, 60));

    const byCount = buildInjection(taskWith([TEST_FILE]), bundleFor, { lineOf: LINES });
    const byTokens = buildInjection(taskWith([TEST_FILE]), bundleFor, {
      lineOf: LINES,
      budgetTokens: 120,
    });

    expect(byCount.citations).toHaveLength(20);
    expect(byCount.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(byTokens.citations.length).toBeGreaterThan(0);
    expect(byTokens.citations.length).toBeLessThan(20);
    expect(byTokens.estimatedTokens).toBeLessThanOrEqual(120);
  });

  it("seeds only from the test patch files", () => {
    const seeds: string[] = [];
    const bundleFor: BundleFor = (seed) => {
      seeds.push(seed);
      return bundleOf([]);
    };

    buildInjection(taskWith([TEST_FILE, "test/other.test.ts"]), bundleFor);

    expect(seeds).toEqual([TEST_FILE, "test/other.test.ts"]);
  });

  it("dedupes an edge that two seeds both name, keeping its best relevance", () => {
    const shared = "src/router.ts#normalize";
    const bundleFor: BundleFor = (seed) =>
      bundleOf([edge(seed, shared, seed === TEST_FILE ? 0.2 : 0.9), edge(seed, "src/util.ts", 0.5)]);

    const result = buildInjection(taskWith([TEST_FILE, "test/other.test.ts"]), bundleFor, {
      lineOf: LINES,
    });

    expect(result.citations.map((c) => `${c.path}:${c.line}`)).toEqual([
      "src/router.ts:7",
      "src/util.ts:1",
    ]);
    expect(result.citations[0]?.relevance).toBe(0.9);
  });

  it("projects caller edges to the endpoint that is not the seed", () => {
    const bundleFor: BundleFor = (seed) => bundleOf([], [edge("src/caller.ts", `${seed}#helper`, 0.4)]);

    const result = buildInjection(taskWith([TEST_FILE]), bundleFor);

    expect(result.citations.map((c) => c.path)).toEqual(["src/caller.ts"]);
    expect(result.text).toContain("src/caller.ts:1");
  });

  it("skips external packages and the seed test files themselves", () => {
    const bundleFor: BundleFor = (seed) =>
      bundleOf([edge(seed, "npm:vitest", 0.9), edge(seed, "node:path", 0.9), edge(seed, "test/other.test.ts", 0.9)]);

    const result = buildInjection(taskWith([TEST_FILE, "test/other.test.ts"]), bundleFor);

    expect(result.citations).toEqual([]);
  });

  it("reports estimatedTokens as the token estimate of the exact injected text", () => {
    const bundleFor: BundleFor = (seed) => bundleOf(manyDeps(seed, 5));

    const result = buildInjection(taskWith([TEST_FILE]), bundleFor, { lineOf: LINES });

    expect(result.estimatedTokens).toBe(estimateTokens(result.text));
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("gives empty text and zero tokens for an empty bundle or an unknown seed", () => {
    const empty = buildInjection(taskWith([TEST_FILE]), () => bundleOf([]));
    const unknown = buildInjection(taskWith([TEST_FILE]), () => null);

    expect(empty).toEqual({ text: "", citations: [], estimatedTokens: 0 });
    expect(unknown).toEqual({ text: "", citations: [], estimatedTokens: 0 });
  });
});

describe("injectPrompt", () => {
  it("prepends the block framed as candidates, not verdicts", () => {
    const injection = buildInjection(taskWith([TEST_FILE]), (seed) => bundleOf(manyDeps(seed, 2)));

    const prompt = injectPrompt("Fix the router.", injection);

    expect(prompt.startsWith(injection.text)).toBe(true);
    expect(prompt).toContain("candidates, not verdicts");
    expect(prompt.endsWith("Fix the router.")).toBe(true);
  });

  it("leaves the problem statement untouched when nothing was injected", () => {
    const prompt = injectPrompt("Fix the router.", { text: "", citations: [], estimatedTokens: 0 });

    expect(prompt).toBe("Fix the router.");
  });
});
