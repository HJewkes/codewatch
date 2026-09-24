import { AuthMisconfiguredError, assertAuthEnvOk, prepareEnv, type AgentRunConfig } from "@titan-design/agent";
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

export interface ReaderRunnerOptions {
  cwd: string;
  /** Per-call ceiling handed to the SDK; the run's own budget is enforced by mapItems. */
  maxCallUsd: number;
  traces: CallTrace[];
}

type SdkMessage = Parameters<NonNullable<AgentRunConfig["onMessage"]>>[0];

const MAX_TURNS = 4;

/** Fails before any spend, in one actionable line, when subscription auth is missing. */
export function preflightAuth(env: NodeJS.ProcessEnv = process.env): void {
  try {
    assertAuthEnvOk(prepareEnv(env));
  } catch (err) {
    if (!(err instanceof AuthMisconfiguredError)) throw err;
    throw new Error(`triage needs model auth: ${err.message}${err.hint ? `; ${err.hint}` : ""}`);
  }
}

function absorb(trace: CallTrace, message: SdkMessage): void {
  if (message.type === "system" && message.subtype === "init") {
    trace.model = message.model;
    trace.tools = message.tools;
  }
  if (message.type !== "result") return;
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
