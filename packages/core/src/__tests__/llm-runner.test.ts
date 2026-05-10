import { describe, it, expect, vi } from "vitest";
import { LlmRunner } from "../llm/runner.js";
import type { LlmProvider, LlmMessage } from "../llm/types.js";

function makeProvider(
  generate: LlmProvider["generate"],
): LlmProvider {
  return { name: "mock", generate };
}

function jobsForKeys(keys: string[]) {
  return keys.map((key) => ({
    key,
    messages: [{ role: "user", content: `prompt for ${key}` }] as LlmMessage[],
    maxTokens: 100,
  }));
}

describe("LlmRunner", () => {
  it("returns empty result when no jobs are passed", async () => {
    const provider = makeProvider(vi.fn());
    const runner = new LlmRunner({ provider });

    const result = await runner.run([]);

    expect(result.results).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.totalTokensUsed).toBe(0);
    expect(result.budgetExceeded).toBe(false);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("runs all jobs sequentially and accumulates tokens", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ content: "a", tokensUsed: 100 })
      .mockResolvedValueOnce({ content: "b", tokensUsed: 200 });
    const runner = new LlmRunner({ provider: makeProvider(generate) });

    const result = await runner.run(jobsForKeys(["x", "y"]));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ key: "x", content: "a", tokensUsed: 100 });
    expect(result.results[1]).toMatchObject({ key: "y", content: "b", tokensUsed: 200 });
    expect(result.totalTokensUsed).toBe(300);
    expect(result.budgetExceeded).toBe(false);
  });

  it("halts and flags budget exceeded once cumulative tokens reach the limit", async () => {
    const generate = vi.fn().mockResolvedValue({ content: "ok", tokensUsed: 15_000 });
    const runner = new LlmRunner({
      provider: makeProvider(generate),
      totalTokenBudget: 20_000,
    });

    const result = await runner.run(jobsForKeys(["a", "b", "c"]));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.budgetExceeded).toBe(true);
    expect(result.totalTokensUsed).toBe(30_000);
  });

  it("captures per-job errors without throwing and continues", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ content: "ok", tokensUsed: 50 });
    const runner = new LlmRunner({ provider: makeProvider(generate) });

    const result = await runner.run(jobsForKeys(["fail", "ok"]));

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ key: "ok" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ key: "fail", error: "boom" });
    expect(result.totalTokensUsed).toBe(50);
  });

  it("forwards the per-job maxTokens to provider.generate", async () => {
    const generate = vi.fn().mockResolvedValue({ content: "x", tokensUsed: 1 });
    const runner = new LlmRunner({ provider: makeProvider(generate) });

    await runner.run([
      { key: "a", messages: [{ role: "user", content: "hi" }], maxTokens: 42 },
    ]);

    expect(generate).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      { maxTokens: 42 },
    );
  });
});
