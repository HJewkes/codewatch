import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCommand } from "../commands/audit.js";
import { runTriage } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import { SILENT_RUNNERS } from "./triage-fake-reader.js";

const CORE_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  structured_output: { verdicts: [] },
  session_id: "fake-session",
  num_turns: 1,
  duration_ms: 5,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  modelUsage: { "claude-fake-model": { inputTokens: 1200, outputTokens: 40, costUSD: 0.01 } },
};

/** A stand-in `claude` that logs its argv and whether an API key reached it, then prints one JSON result. */
function fakeClaude(dir: string): string {
  const bin = join(dir, "claude");
  writeFileSync(join(dir, "result.json"), JSON.stringify(RESULT));
  const script = [
    "#!/bin/sh",
    'model=; prev=; for a in "$@"; do [ "$prev" = "--model" ] && model="$a"; prev="$a"; done',
    `echo "$1 model=$model key=\${ANTHROPIC_API_KEY:-none}" >> "${join(dir, "calls.log")}"`,
    "cat > /dev/null",
    `cat "${join(dir, "result.json")}"`,
  ].join("\n");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

describe("triage on the claude-print harness", () => {
  let dir: string;
  let bin: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-print-"));
    bin = mkdtempSync(join(tmpdir(), "triage-print-bin-"));
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it("spawns claude -p with no token, strips the API key, and records the model and tokens it reports", async () => {
    vi.stubEnv("CLAUDE_BIN", fakeClaude(bin));
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "metered-key");
    const controls = loadControls().filter((c) => c.id === "py-helper-clean" || c.id === "py-helper-slop");

    const { report } = await runTriage({ path: dir, minRank: 0, includeTests: false, model: "sonnet", concurrency: 1, budgetUsd: 5, controls, controlCount: 2, seed: "s" });

    const calls = readFileSync(join(bin, "calls.log"), "utf8").trim().split("\n");
    expect(calls).toHaveLength(report.calls.planned);
    expect(calls.every((c) => c === "-p model=sonnet key=none")).toBe(true);
    expect(report.harness).toBe("claude-print");
    expect(report.observedModels).toEqual(["claude-fake-model"]);
    expect(report.traces[0]).toMatchObject({ inputTokens: 1200, outputTokens: 40, costUsd: 0.01 });
  });
});
