import { AuthMisconfiguredError, assertAuthEnvOk, prepareEnv, resolveClaudeBin, type AgentRunConfig } from "@titan-design/agent";
import { agentRunner, idempotentRunner, type LegacyStepRunner, type StepRunOutcome, type StepRunner } from "@titan-design/workflow";
import { READER_SYSTEM_PROMPT, ReaderOutputSchema } from "./triage-prompt.js";

/** One reader call as the SDK reported it, for measuring the per-call overhead (plan risk R5). */
export interface CallTrace {
  stepId: string;
  sessionId?: string;
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

type ModelUsage = NonNullable<Extract<SdkMessage, { type: "result" }>["modelUsage"]>;

/**
 * A reader's result also carries Claude Code side calls (a haiku model, session names `agent-*`)
 * under other `modelUsage` keys. Keep the entries of the model the reader was asked for; when none
 * match, the requested name is an alias we cannot map, so every entry stays.
 */
function readerUsage(usage: ModelUsage, requested: string | undefined): ModelUsage {
  const wanted = requested?.toLowerCase();
  const own = Object.entries(usage).filter(([name]) => wanted && name.toLowerCase().includes(wanted));
  return own.length > 0 ? Object.fromEntries(own) : usage;
}

function absorb(trace: CallTrace, message: SdkMessage, requested: string | undefined): void {
  if (message.type === "system" && message.subtype === "init") {
    if (trace.sessionId !== undefined) return;
    trace.sessionId = message.session_id;
    trace.model = message.model;
    trace.tools = message.tools;
  }
  if (message.type !== "result") return;
  if (trace.sessionId !== undefined && message.session_id !== trace.sessionId) return;
  const all = message.modelUsage ?? {};
  const own = readerUsage(all, requested);
  const sideCalls = Object.keys(own).length < Object.keys(all).length;
  trace.model ??= Object.keys(own)[0];
  trace.inputTokens = message.usage.input_tokens;
  trace.cacheCreationInputTokens = message.usage.cache_creation_input_tokens ?? undefined;
  trace.cacheReadInputTokens = message.usage.cache_read_input_tokens ?? undefined;
  trace.outputTokens = message.usage.output_tokens;
  trace.costUsd = sideCalls ? Object.values(own).reduce((sum, m) => sum + (m.costUSD ?? 0), 0) : message.total_cost_usd;
  trace.turns = message.num_turns;
}

/** The step's spend is the reader's, so a run's budget and `spentUsd` exclude side calls. */
function withReaderCost(outcome: StepRunOutcome, trace: CallTrace): StepRunOutcome {
  if (!outcome.usage || trace.costUsd === undefined) return outcome;
  return { ...outcome, usage: { ...outcome.usage, costUsd: trace.costUsd } };
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
          onMessage: (message) => absorb(trace, message, input.model),
        },
      });
      return live.run(input).then((outcome) => withReaderCost(outcome, trace));
    },
  };
}

export function readerRunner(options: ReaderRunnerOptions): StepRunner {
  return idempotentRunner(tracingReader(options));
}
