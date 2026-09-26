import { AuthMisconfiguredError, assertAuthEnvOk, prepareEnv, resolveClaudeBin, type AgentRunConfig } from "@titan-design/agent";
import { agentRunner, idempotentRunner, type LegacyStepRunner, type StepRunner } from "@titan-design/workflow";
import { READER_SYSTEM_PROMPT, ReaderOutputSchema } from "./triage-prompt.js";

/** One reader call as the SDK reported it, for measuring the per-call overhead (plan risk R5). */
export interface CallTrace {
  stepId: string;
  model?: string;
  tools?: string[];
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  turns?: number;
}

/** `claude-print` spawns the logged-in `claude` CLI; `sdk` runs the Agent SDK on CLAUDE_CODE_OAUTH_TOKEN. */
export const TRIAGE_HARNESSES = ["claude-print", "sdk"] as const;
export type TriageHarness = (typeof TRIAGE_HARNESSES)[number];
export const DEFAULT_HARNESS: TriageHarness = "claude-print";

export interface ReaderRunnerOptions {
  harness: TriageHarness;
  cwd: string;
  /** Per-call ceiling handed to the SDK; the run's own budget is enforced by mapItems. */
  maxCallUsd: number;
  traces: CallTrace[];
}

type SdkMessage = Parameters<NonNullable<AgentRunConfig["onMessage"]>>[0];

const MAX_TURNS = 4;

/** Fails before any spend, in one actionable line, when the chosen harness cannot authenticate. */
export function preflightAuth(harness: TriageHarness, env: NodeJS.ProcessEnv = process.env): void {
  const prepared = prepareEnv(env);
  try {
    assertAuthEnvOk(prepared, { requireOAuthToken: harness === "sdk" });
  } catch (err) {
    if (!(err instanceof AuthMisconfiguredError)) throw err;
    throw new Error(`triage needs model auth: ${err.message}${err.hint ? `; ${err.hint}` : ""}`);
  }
  if (harness === "claude-print" && !resolveClaudeBin(prepared)) {
    throw new Error("triage needs the claude CLI: no `claude` binary on PATH; install Claude Code and log in, set CLAUDE_BIN, or pass --harness sdk");
  }
}

function absorb(trace: CallTrace, message: SdkMessage): void {
  if (message.type === "system" && message.subtype === "init") {
    trace.model = message.model;
    trace.tools = message.tools;
  }
  if (message.type !== "result") return;
  trace.model ??= Object.keys(message.modelUsage ?? {})[0];
  trace.inputTokens = message.usage.input_tokens;
  trace.cacheCreationInputTokens = message.usage.cache_creation_input_tokens ?? undefined;
  trace.cacheReadInputTokens = message.usage.cache_read_input_tokens ?? undefined;
  trace.outputTokens = message.usage.output_tokens;
  trace.costUsd = message.total_cost_usd;
  trace.turns = message.num_turns;
}

/** agentRunner with no tools and a short system prompt; each call's init and usage land in `traces`. */
function tracingReader(options: ReaderRunnerOptions): LegacyStepRunner {
  return {
    run(input) {
      const trace: CallTrace = { stepId: input.stepId };
      options.traces.push(trace);
      const live = agentRunner({
        cwd: options.cwd,
        maxTurns: MAX_TURNS,
        maxBudgetUsd: options.maxCallUsd,
        defaults: {
          harness: options.harness === "sdk" ? "claude-code" : "claude-print",
          tools: [],
          systemPrompt: READER_SYSTEM_PROMPT,
          outputSchema: ReaderOutputSchema,
          onMessage: (message) => absorb(trace, message),
        },
      });
      return live.run(input);
    },
  };
}

export function readerRunner(options: ReaderRunnerOptions): StepRunner {
  return idempotentRunner(tracingReader(options));
}
