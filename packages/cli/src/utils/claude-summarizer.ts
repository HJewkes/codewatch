import { runAgent } from "@titan-design/agent";
import type { Summarizer } from "@titan-design/code-graph";

const DEFAULT_MODEL = "sonnet";

/** Summary-cache model key for the default summarizer; readers pass it to find stored summaries. */
export const DEFAULT_SUMMARY_MODEL = `claude:${DEFAULT_MODEL}`;
const CALL_TIMEOUT_MS = 120_000;
const MAX_CALL_USD = 1;

export interface ClaudeSummarizerOptions {
  /** Claude Code model alias (e.g. "sonnet", "haiku"). */
  model?: string;
}

/**
 * C-88 gate(b) — {@link Summarizer} backed by the local `claude` CLI in print
 * mode through `@titan-design/agent`'s claude-print harness (subscription-billed,
 * no tools). Kept product-side so `@titan-design/code-graph` stays
 * process-spawn-free; tests point `CLAUDE_BIN` at a fake instead.
 */
export function createClaudeSummarizer(
  opts?: ClaudeSummarizerOptions,
): Summarizer {
  const model = opts?.model ?? DEFAULT_MODEL;
  return {
    model: `claude:${model}`,
    summarize: (prompt) => summarize(model, prompt),
  };
}

async function summarize(model: string, prompt: string): Promise<string> {
  const run = await runAgent({
    harness: "claude-print",
    prompt,
    model,
    cwd: process.cwd(),
    maxTurns: 1,
    maxBudgetUsd: MAX_CALL_USD,
    inactivityTimeoutMs: CALL_TIMEOUT_MS,
  });
  if (!run.ok) {
    throw new Error(`claude CLI summarization failed: ${run.failure.reason}`);
  }
  if (!run.output.trim()) {
    throw new Error("claude CLI returned an empty summary");
  }
  return run.output;
}
