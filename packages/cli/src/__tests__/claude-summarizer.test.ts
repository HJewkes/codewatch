import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSummarizer } from "../utils/claude-summarizer.js";

function result(overrides: Record<string, unknown>) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    num_turns: 1,
    duration_ms: 5,
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5 },
    modelUsage: {},
    ...overrides,
  };
}

/** A stand-in `claude` that logs its argv and stdin, then prints the prepared JSON result. */
function fakeClaude(dir: string, printed: object): string {
  const bin = join(dir, "claude");
  writeFileSync(join(dir, "result.json"), JSON.stringify(printed));
  const script = [
    "#!/bin/sh",
    `echo "$@" > "${join(dir, "argv.log")}"`,
    `cat > "${join(dir, "stdin.log")}"`,
    `cat "${join(dir, "result.json")}"`,
  ].join("\n");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

describe("claude summarizer on the claude-print harness", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "summarizer-print-"));
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the CLI's result text and sends the prompt on stdin with the chosen model", async () => {
    vi.stubEnv("CLAUDE_BIN", fakeClaude(dir, result({ result: "Services live in src/services." })));

    const summary = await createClaudeSummarizer({ model: "haiku" }).summarize("Summarize the area");

    expect(summary).toBe("Services live in src/services.");
    expect(readFileSync(join(dir, "stdin.log"), "utf8")).toBe("Summarize the area");
    expect(readFileSync(join(dir, "argv.log"), "utf8")).toContain("--model haiku");
  });

  it("rejects with the CLI's message when the run reports is_error", async () => {
    vi.stubEnv("CLAUDE_BIN", fakeClaude(dir, result({ is_error: true, result: "API Error: overloaded" })));

    const pending = createClaudeSummarizer().summarize("Summarize the area");

    await expect(pending).rejects.toThrow(/claude CLI summarization failed.*API Error: overloaded/);
  });

  it("rejects when the CLI returns an empty summary", async () => {
    vi.stubEnv("CLAUDE_BIN", fakeClaude(dir, result({ result: "  " })));

    await expect(createClaudeSummarizer().summarize("p")).rejects.toThrow(/empty summary/);
  });

  it("keys cached summaries by the claude model alias", () => {
    expect(createClaudeSummarizer({ model: "haiku" }).model).toBe("claude:haiku");
  });
});
