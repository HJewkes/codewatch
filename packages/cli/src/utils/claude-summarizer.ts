import { execFile } from "node:child_process";
import type { Summarizer } from "@titan-design/code-graph";

const DEFAULT_MODEL = "sonnet";

/** Summary-cache model key for the default summarizer; readers pass it to find stored summaries. */
export const DEFAULT_SUMMARY_MODEL = `claude:${DEFAULT_MODEL}`;
const CALL_TIMEOUT_MS = 120_000;

export interface ClaudeSummarizerOptions {
  /** Claude Code model alias (e.g. "sonnet", "haiku"). */
  model?: string;
}

/**
 * C-88 gate(b) — {@link Summarizer} backed by the local `claude` CLI in print
 * mode (subscription-billed headless call, the same channel the gating
 * experiments validated with sonnet). Kept product-side so
 * `@titan-design/code-graph` stays process-spawn-free; tests inject a fake instead.
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

function summarize(model: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["-p", prompt, "--model", model, "--output-format", "json"],
      { timeout: CALL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(
            new Error(
              `claude CLI summarization failed — is \`claude\` on PATH? ` +
                `(${err.message.split("\n")[0]})`,
            ),
          );
          return;
        }
        try {
          resolve(parseResult(stdout));
        } catch (parseErr) {
          reject(parseErr as Error);
        }
      },
    );
  });
}

function parseResult(stdout: string): string {
  const data = JSON.parse(stdout) as {
    is_error?: boolean;
    result?: unknown;
  };
  if (data.is_error || typeof data.result !== "string" || !data.result.trim()) {
    throw new Error(
      `Unexpected claude CLI response: ${stdout.slice(0, 200)}`,
    );
  }
  return data.result;
}
