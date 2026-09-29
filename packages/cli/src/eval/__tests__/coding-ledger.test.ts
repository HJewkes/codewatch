import { describe, it, expect } from "vitest";
import { parseArmStream, totalTokens } from "../coding-ledger.js";

const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";

interface Usage {
  in: number;
  cc: number;
  cr: number;
  out: number;
}

function apiUsage(u: Usage): Record<string, number> {
  return {
    input_tokens: u.in,
    cache_creation_input_tokens: u.cc,
    cache_read_input_tokens: u.cr,
    output_tokens: u.out,
  };
}

function modelUsage(u: Usage, costUSD = 0): Record<string, number> {
  return {
    inputTokens: u.in,
    cacheCreationInputTokens: u.cc,
    cacheReadInputTokens: u.cr,
    outputTokens: u.out,
    costUSD,
  };
}

function assistant(
  id: string,
  u: Usage,
  block: Record<string, unknown>,
  parent: string | null = null,
  model = SONNET,
): string {
  return JSON.stringify({
    type: "assistant",
    parent_tool_use_id: parent,
    session_id: "s",
    message: { id, model, role: "assistant", content: [block], usage: apiUsage(u) },
  });
}

function result(extra: Record<string, unknown>): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    num_turns: 3,
    total_cost_usd: 0.42,
    ...extra,
  });
}

const text = { type: "text", text: "looking" };
const toolUse = (id: string, name: string) => ({ type: "tool_use", id, name, input: {} });

const M1: Usage = { in: 100, cc: 1000, cr: 0, out: 50 };
const M2: Usage = { in: 10, cc: 200, cr: 1000, out: 30 };
const S1: Usage = { in: 5, cc: 300, cr: 0, out: 20 };
const S2: Usage = { in: 7, cc: 0, cr: 0, out: 3 };

// Two main calls, one Task subagent with a sonnet call and a haiku call, and one unseen haiku call.
function sidechainStream(): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", model: SONNET }),
    assistant("m1", M1, text),
    assistant("m1", M1, toolUse("tu1", "Read")),
    assistant("m2", M2, toolUse("tu2", "Task")),
    assistant("s1", S1, toolUse("tu3", "Grep"), "tu2"),
    assistant("s2", S2, text, "tu2", HAIKU),
    result({
      usage: apiUsage({ in: 115, cc: 1500, cr: 1000, out: 100 }),
      modelUsage: {
        [SONNET]: modelUsage({ in: 115, cc: 1500, cr: 1000, out: 100 }, 0.4),
        [HAIKU]: modelUsage({ in: 47, cc: 0, cr: 0, out: 13 }, 0.02),
      },
    }),
  ].join("\n");
}

describe("parseArmStream", () => {
  it("counts a sidechain subagent call in the helper ledger, not the main ledger", () => {
    const parsed = parseArmStream(sidechainStream(), "sonnet");

    expect(parsed.main).toEqual({
      inputTokens: 110,
      cacheCreateTokens: 1200,
      cacheReadTokens: 1000,
      outputTokens: 80,
      calls: 2,
    });
    expect(parsed.helper).toEqual({
      inputTokens: 52,
      cacheCreateTokens: 300,
      cacheReadTokens: 0,
      outputTokens: 33,
      calls: 2,
    });
  });

  it("reconciles main plus helper to the result total with a zero ledger gap", () => {
    const parsed = parseArmStream(sidechainStream(), "sonnet");

    expect(totalTokens(parsed.main) + totalTokens(parsed.helper)).toBe(
      totalTokens(parsed.resultTotal),
    );
    expect(totalTokens(parsed.ledgerGap)).toBe(0);
  });

  it("counts one API call once when stream-json repeats it per content block", () => {
    const raw = [
      assistant("m1", M1, text),
      assistant("m1", M1, toolUse("tu1", "Read")),
      assistant("m1", M1, toolUse("tu2", "Grep")),
      result({ usage: apiUsage(M1), modelUsage: { [SONNET]: modelUsage(M1) } }),
    ].join("\n");

    const parsed = parseArmStream(raw, "sonnet");

    expect(parsed.main.calls).toBe(1);
    expect(totalTokens(parsed.main)).toBe(1150);
    expect(parsed.toolCalls).toEqual({ Read: 1, Grep: 1 });
  });

  it("exposes a positive ledger gap when the result reports tokens the stream never showed", () => {
    const raw = [
      assistant("m1", M1, text),
      result({ usage: apiUsage({ ...M1, out: 90 }) }),
    ].join("\n");

    const parsed = parseArmStream(raw, "sonnet");

    expect(parsed.ledgerGap.outputTokens).toBe(40);
    expect(totalTokens(parsed.ledgerGap)).toBe(40);
  });

  it("reads turns and cost from the result and skips non-JSON lines", () => {
    const raw = ["warning: not json", sidechainStream(), ""].join("\n");

    const parsed = parseArmStream(raw, "sonnet");

    expect(parsed.hasResult).toBe(true);
    expect(parsed.numTurns).toBe(3);
    expect(parsed.costUsd).toBe(0.42);
    expect(parsed.toolCalls).toEqual({ Read: 1, Task: 1, Grep: 1 });
  });

  it("falls back to the modelUsage cost sum when total_cost_usd is zero", () => {
    const raw = sidechainStream().replace('"total_cost_usd":0.42', '"total_cost_usd":0');

    expect(parseArmStream(raw, "sonnet").costUsd).toBeCloseTo(0.42);
  });

  it("reports an empty result total and hasResult false for a stream with no result event", () => {
    const parsed = parseArmStream(assistant("m1", M1, text), "sonnet");

    expect(parsed.hasResult).toBe(false);
    expect(totalTokens(parsed.resultTotal)).toBe(0);
    expect(totalTokens(parsed.ledgerGap)).toBe(-1150);
  });
});
