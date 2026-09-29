/**
 * C-93 S1: two-ledger token accounting for one `claude -p --output-format stream-json` arm run.
 * The main ledger holds the arm agent's own API calls; the helper ledger holds subagent
 * (sidechain) calls and internal helper-model calls. Pure: no I/O, no model calls.
 *
 * STREAM SHAPE ASSUMPTIONS. These follow the Agent SDK message types
 * (`SDKAssistantMessage`, `SDKResultMessage`), not a captured stream:
 * 1. stream-json emits one `assistant` event per content block, each repeating the same
 *    `message.id` and `message.usage`, so one API call is keyed by `message.id` (last event wins).
 * 2. A subagent call carries a non-null `parent_tool_use_id`; a main call carries null.
 * 3. `result.modelUsage` covers every model the session called, subagents included, so its sum
 *    is the session total. Without it, `result.usage` is the total.
 * 4. Sidechain calls on a non-arm model are already inside that model's `modelUsage` entry, so
 *    only arm-model sidechain calls add their stream usage to the helper ledger.
 * `ledgerGap` (result total minus both ledgers) is zero when these hold; a real run falsifies them.
 */

export interface TokenCounts {
  inputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface Ledger extends TokenCounts {
  /** Distinct API calls observed in the stream (modelUsage-only calls are not countable). */
  calls: number;
}

export interface ArmStreamLedgers {
  main: Ledger;
  helper: Ledger;
  resultTotal: TokenCounts;
  ledgerGap: TokenCounts;
  hasResult: boolean;
  toolCalls: Record<string, number>;
  numTurns: number;
  costUsd: number;
  /** Distinct main-agent turns (message ids) before the turn holding the first Edit/Write. */
  preEditTurns: number;
  /** Distinct files the main agent Read before its first Edit/Write, as the tool input named them. */
  readFiles: string[];
}

interface ApiCall {
  model: string;
  sidechain: boolean;
  usage: TokenCounts;
}

interface StreamCalls {
  calls: Map<string, ApiCall>;
  toolCalls: Record<string, number>;
}

type Json = Record<string, unknown>;

const TOKEN_FIELDS: readonly (keyof TokenCounts)[] = [
  "inputTokens",
  "cacheCreateTokens",
  "cacheReadTokens",
  "outputTokens",
];

const EMPTY_COUNTS: TokenCounts = {
  inputTokens: 0,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

export function totalTokens(counts: TokenCounts): number {
  return TOKEN_FIELDS.reduce((sum, field) => sum + counts[field], 0);
}

function combine(a: TokenCounts, b: TokenCounts, sign: 1 | -1): TokenCounts {
  const out = { ...EMPTY_COUNTS };
  for (const field of TOKEN_FIELDS) out[field] = a[field] + sign * b[field];
  return out;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asJson(value: unknown): Json {
  return value !== null && typeof value === "object" ? (value as Json) : {};
}

function fromApiUsage(usage: Json): TokenCounts {
  return {
    inputTokens: num(usage["input_tokens"]),
    cacheCreateTokens: num(usage["cache_creation_input_tokens"]),
    cacheReadTokens: num(usage["cache_read_input_tokens"]),
    outputTokens: num(usage["output_tokens"]),
  };
}

function fromModelUsage(entry: Json): TokenCounts {
  return {
    inputTokens: num(entry["inputTokens"]),
    cacheCreateTokens: num(entry["cacheCreationInputTokens"]),
    cacheReadTokens: num(entry["cacheReadInputTokens"]),
    outputTokens: num(entry["outputTokens"]),
  };
}

function parseEvents(raw: string): Json[] {
  const events: Json[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(asJson(JSON.parse(trimmed)));
    } catch {
      continue;
    }
  }
  return events;
}

function countToolUses(content: unknown, seen: Set<string>, into: Record<string, number>): void {
  if (!Array.isArray(content)) return;
  for (const block of content.map(asJson)) {
    const id = String(block["id"] ?? "");
    if (block["type"] !== "tool_use" || seen.has(id)) continue;
    if (id) seen.add(id);
    const name = typeof block["name"] === "string" ? block["name"] : "unknown";
    into[name] = (into[name] ?? 0) + 1;
  }
}

function collectCalls(events: readonly Json[]): StreamCalls {
  const calls = new Map<string, ApiCall>();
  const toolCalls: Record<string, number> = {};
  const seenToolUses = new Set<string>();
  for (const event of events) {
    if (event["type"] !== "assistant") continue;
    const message = asJson(event["message"]);
    countToolUses(message["content"], seenToolUses, toolCalls);
    const id = typeof message["id"] === "string" ? message["id"] : `anon-${calls.size}`;
    calls.set(id, {
      model: String(message["model"] ?? ""),
      sidechain: event["parent_tool_use_id"] != null,
      usage: fromApiUsage(asJson(message["usage"])),
    });
  }
  return { calls, toolCalls };
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write"]);

interface EditTrace {
  preEditTurns: number;
  readFiles: string[];
}

/** Main-agent turns and Reads ahead of the first edit; sidechain events never count. */
function traceBeforeFirstEdit(events: readonly Json[]): EditTrace {
  const turns = new Set<string>();
  const readFiles = new Set<string>();
  for (const event of events) {
    if (event["type"] !== "assistant" || event["parent_tool_use_id"] != null) continue;
    const message = asJson(event["message"]);
    const id = typeof message["id"] === "string" ? message["id"] : `anon-${turns.size}`;
    const blocks = Array.isArray(message["content"]) ? message["content"].map(asJson) : [];
    if (blocks.some((block) => block["type"] === "tool_use" && EDIT_TOOLS.has(String(block["name"])))) {
      return { preEditTurns: turns.has(id) ? turns.size - 1 : turns.size, readFiles: [...readFiles] };
    }
    turns.add(id);
    for (const block of blocks) {
      const path = asJson(block["input"])["file_path"];
      if (block["type"] === "tool_use" && block["name"] === "Read" && typeof path === "string") readFiles.add(path);
    }
  }
  return { preEditTurns: turns.size, readFiles: [...readFiles] };
}

function ledgerOf(calls: readonly ApiCall[]): Ledger {
  const counts = calls.reduce((sum, call) => combine(sum, call.usage, 1), EMPTY_COUNTS);
  return { ...counts, calls: calls.length };
}

function armModelMatcher(armModel: string, mainCalls: readonly ApiCall[]): (m: string) => boolean {
  const mainModels = new Set(mainCalls.map((call) => call.model));
  return (model) => mainModels.has(model) || (armModel !== "" && model.includes(armModel));
}

function modelUsageEntries(result: Json | undefined): [string, Json][] {
  return Object.entries(asJson(result?.["modelUsage"])).map(([model, entry]) => [
    model,
    asJson(entry),
  ]);
}

function sessionTotal(result: Json | undefined): TokenCounts {
  const entries = modelUsageEntries(result);
  if (entries.length === 0) return fromApiUsage(asJson(result?.["usage"]));
  return entries.reduce((sum, [, entry]) => combine(sum, fromModelUsage(entry), 1), EMPTY_COUNTS);
}

function helperLedger(
  sidechain: readonly ApiCall[],
  result: Json | undefined,
  isArmModel: (model: string) => boolean,
): Ledger {
  const armSidechain = ledgerOf(sidechain.filter((call) => isArmModel(call.model)));
  const otherModels = modelUsageEntries(result)
    .filter(([model]) => !isArmModel(model))
    .reduce((sum, [, entry]) => combine(sum, fromModelUsage(entry), 1), EMPTY_COUNTS);
  return { ...combine(armSidechain, otherModels, 1), calls: sidechain.length };
}

function resultCost(result: Json | undefined): number {
  const reported = num(result?.["total_cost_usd"]);
  if (reported > 0) return reported;
  return modelUsageEntries(result).reduce((sum, [, entry]) => sum + num(entry["costUSD"]), 0);
}

/** Split one arm run's stream-json output into main and helper ledgers, reconciled to the result. */
export function parseArmStream(raw: string, armModel: string): ArmStreamLedgers {
  const events = parseEvents(raw);
  const result = events.filter((event) => event["type"] === "result").at(-1);
  const { calls, toolCalls } = collectCalls(events);
  const all = [...calls.values()];
  const mainCalls = all.filter((call) => !call.sidechain);
  const isArmModel = armModelMatcher(armModel, mainCalls);
  const main = ledgerOf(mainCalls);
  const helper = helperLedger(
    all.filter((call) => call.sidechain),
    result,
    isArmModel,
  );
  const resultTotal = sessionTotal(result);
  return {
    main,
    helper,
    resultTotal,
    ledgerGap: combine(combine(resultTotal, main, -1), helper, -1),
    hasResult: result !== undefined,
    toolCalls,
    numTurns: num(result?.["num_turns"]),
    costUsd: resultCost(result),
    ...traceBeforeFirstEdit(events),
  };
}
