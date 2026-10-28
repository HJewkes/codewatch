import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { armSpec } from "../coding-arms.js";
import { runArms, writeArmOutputs, type ArmRunnerDeps } from "../coding-arms-runner.js";
import type { CodingTask } from "../coding-types.js";

const GOLD_DIFF = [
  "diff --git a/src/sum.ts b/src/sum.ts",
  "--- a/src/sum.ts",
  "+++ b/src/sum.ts",
  "@@ -2,1 +2,1 @@",
  "-  return a - b;",
  "+  return a + b;",
  "",
].join("\n");

const TASK: CodingTask = {
  id: "abc1234::src/sum.ts",
  corpus: { repo: "fixture", parentCommit: "p".repeat(40), fixCommit: "f".repeat(40) },
  problemStatement: "sum() subtracts instead of adding.",
  testPatch: { files: ["src/sum.test.ts"], diff: "" },
  failToPass: ["sum adds"],
  passToPass: [],
  goldDiff: GOLD_DIFF,
  editFiles: ["src/sum.ts"],
  stratum: "semantic-findable",
};

function stream(model: string): string {
  const assistant = {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "msg-1",
      model,
      usage: { input_tokens: 100, output_tokens: 10 },
      content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/work/repo/src/sum.ts" } }],
    },
  };
  const result = { type: "result", num_turns: 1, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 10 } };
  return [JSON.stringify(assistant), JSON.stringify(result)].join("\n");
}

interface FakeDeps extends ArmRunnerDeps {
  spawned: { args: readonly string[]; input: string }[];
  injectionCalls: number;
  mcpCalls: number;
}

function fakeDeps(): FakeDeps {
  const deps: FakeDeps = {
    spawned: [],
    injectionCalls: 0,
    mcpCalls: 0,
    runClaude: (args, input) => {
      deps.spawned.push({ args, input });
      return stream("claude-sonnet-x");
    },
    prepare: () => undefined,
    agentDiff: () => GOLD_DIFF,
    grade: () => ({ resolved: true, failToPassPassed: ["sum adds"], failToPassFailed: [], passToPassRegressed: [], runError: false }),
    injectionFor: () => {
      deps.injectionCalls++;
      return { text: "INJECTED", citations: [], estimatedTokens: 3 };
    },
    mcpConfigFor: () => {
      deps.mcpCalls++;
      return "/work/mcp.json";
    },
    spansFor: () => () => [{ path: "src/sum.ts", symbol: "sum", lineStart: 1, lineEnd: 3 }],
    log: () => undefined,
  };
  return deps;
}

const OPTS = { model: "sonnet", maxTurns: 30, workdir: "/work/repo" };

describe("coding-bench arm runner", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("records one graded run per task and arm through the injected process runner", () => {
    const deps = fakeDeps();

    const runs = runArms([TASK], ["A0", "AI"].map(armSpec), OPTS, deps);

    expect(deps.spawned).toHaveLength(2);
    expect(runs.map((r) => [r.arm, r.resolved, r.main.inputTokens])).toEqual([
      ["A0", true, 100],
      ["AI", true, 100],
    ]);
    expect(runs[0]!.localization?.symbol.f1).toBe(1);
    expect(runs[0]!.readLocalization?.f1).toBe(0);
    expect(runs[0]!.editedFiles).toEqual(["src/sum.ts"]);
  });

  it("builds the injection only for the injected arm and the MCP config only for the MCP arm", () => {
    const deps = fakeDeps();

    const runs = runArms([TASK], ["A0", "A2", "AI"].map(armSpec), OPTS, deps);

    expect(deps.injectionCalls).toBe(1);
    expect(deps.mcpCalls).toBe(1);
    expect(deps.spawned.map((s) => s.input.startsWith("INJECTED"))).toEqual([false, false, true]);
    expect(runs.map((r) => r.injectedTokens)).toEqual([0, 0, 3]);
  });

  it("leaves localization unscored when the agent diff cannot be read", () => {
    const deps = { ...fakeDeps(), agentDiff: () => null };

    const [run] = runArms([TASK], [armSpec("A0")], OPTS, deps);

    expect(run!.localization).toBeNull();
    expect(run!.editedFiles).toEqual([]);
  });

  it("writes results.json and report.md beside the requested output path", () => {
    dir = mkdtempSync(join(tmpdir(), "coding-arms-"));
    const results = runArms([TASK], ["A0", "AI"].map(armSpec), OPTS, fakeDeps());

    const written = writeArmOutputs(join(dir, "results.json"), { suite: "suite.json", model: "sonnet", maxTurns: 30, arms: ["A0", "AI"], results });

    const parsed = JSON.parse(readFileSync(written.resultsPath, "utf-8")) as { results: unknown[] };
    expect(parsed.results).toHaveLength(2);
    expect(written.reportPath).toBe(join(dir, "report.md"));
    expect(readFileSync(written.reportPath, "utf-8")).toContain("# Coding-bench arm report");
  });
});
