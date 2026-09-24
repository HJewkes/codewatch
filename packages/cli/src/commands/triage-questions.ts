import type { Finding } from "@titan-design/code-graph";

export const VERDICTS = ["confirmed", "justified", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface TriageQuestion {
  text: string;
  meanings: Record<Verdict, string>;
  /** The reader also needs the one caller's excerpt to judge the finding. */
  needsCaller?: boolean;
}

const UNCLEAR = "the excerpt does not show enough to decide";

function question(text: string, confirmed: string, justified: string, needsCaller = false): TriageQuestion {
  return { text, meanings: { confirmed, justified, unclear: UNCLEAR }, ...(needsCaller ? { needsCaller } : {}) };
}

const COMMENTED_CODE = question(
  "Is this commented-out code dead and safe to delete?",
  "it is dead code left in a comment",
  "it is an example, a documented alternative, or otherwise worth keeping",
);

const DEFENSIVE_CHECK = question(
  "Is this check redundant given the types the code already guarantees?",
  "the check can never change the outcome",
  "the check guards a case the types do not rule out at runtime",
);

const SWALLOWED = question(
  "Does this except block hide failures a caller should see?",
  "an error is silenced that should surface or be handled",
  "ignoring the error is deliberate and correct here",
);

/** The signals a model can usefully judge; every other signal is a mechanical fact and gets no question. */
const QUESTIONS: Readonly<Record<string, TriageQuestion>> = {
  "symbol-single-caller-helper": question(
    "Is this helper, called from exactly one place, justified as a separate function?",
    "inlining it into its caller would read at least as clearly",
    "it names a real concept, isolates a test seam, or keeps the caller readable",
    true,
  ),
  "symbol-cognitive": question(
    "Is this function's complexity avoidable?",
    "it could be split or simplified without losing behavior",
    "the complexity is inherent to what the function must do",
  ),
  "symbol-narrating-comments": question(
    "Do these comments only restate what the next line of code does?",
    "the comments narrate the code and carry no extra information",
    "the comments explain intent, constraints, or context the code does not show",
  ),
  "symbol-comment-ratio": question(
    "Does this comment carry information the code does not?",
    "the comments repeat the code or pad the function",
    "the comments carry reasoning, references, or constraints worth keeping",
  ),
  "symbol-constant-params": question(
    "Is this parameter, passed the same value by every caller, unnecessary?",
    "the parameter could become a constant or be removed",
    "the parameter is a deliberate extension point or part of a public contract",
  ),
  "symbol-pass-through": question(
    "Does this function add nothing beyond forwarding its arguments?",
    "it is a pure pass-through that callers could skip",
    "it adapts a signature, marks an API boundary, or exists for a stated reason",
  ),
  ERA001: COMMENTED_CODE,
  "pyright/reportUnnecessaryCast": DEFENSIVE_CHECK,
  "pyright/reportUnnecessaryIsInstance": DEFENSIVE_CHECK,
  "file-swallowed-except": SWALLOWED,
  "file-except-density": question(
    "Is this file's exception handling heavier than its failure modes need?",
    "some handlers are redundant, overly broad, or defensive without cause",
    "each handler covers a distinct, real failure",
  ),
  SIM105: SWALLOWED,
};

export function questionFor(signal: string): TriageQuestion | undefined {
  return QUESTIONS[signal];
}

export function isTriageSignal(signal: string): boolean {
  return signal in QUESTIONS;
}

/** Where a question points: the named symbol, the flagged lines, or the whole file. */
export function findingTarget(f: Finding): string {
  const lines = f.lineStart === undefined ? "" : `:${f.lineStart}${f.lineEnd && f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}`;
  return f.symbol ? `${f.path}${lines} (${f.symbol})` : `${f.path}${lines}`;
}

/** One question block, headed by the label the reader must answer it with. */
export function renderQuestion(f: Finding, q: TriageQuestion, label = f.id): string {
  const meanings = VERDICTS.map((v) => `  ${v}: ${q.meanings[v]}`).join("\n");
  return `[${label}] ${findingTarget(f)}\n${q.text}\nEvidence: ${f.evidence ?? f.signal}\n${meanings}`;
}
