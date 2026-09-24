import { scoreControls, type ControlScore, type LabeledAnswer } from "@titan-design/evidence";
import { expectedVerdict } from "./triage-controls/controls.js";
import type { Control, ExpectedVerdict } from "./triage-controls/types.js";
import type { TriageItem } from "./triage-items.js";
import type { Verdict } from "./triage-questions.js";
import type { VerifiedRow } from "./triage-verify.js";

export type ControlRun = "ok" | "provisional";

export interface ControlOutcome {
  id: string;
  label: Control["label"];
  expected: ExpectedVerdict;
  /** The control's answer; undefined when no verified verdict came back. */
  answered?: Verdict;
}

export interface ControlReport {
  controls: ControlOutcome[];
  score: ControlScore;
  /** Controls answered with the opposite verdict: slop called justified, or clean called confirmed. */
  failed: string[];
  controlRun: ControlRun;
}

const OPPOSITE: Record<ExpectedVerdict, Verdict> = { confirmed: "justified", justified: "confirmed" };

/** A control's answer: the opposite verdict if any finding got it, the expected one if all did, else unclear. */
function answerOf(control: Control, rows: readonly VerifiedRow[]): Verdict | undefined {
  if (rows.length === 0) return undefined;
  const expected = expectedVerdict(control.label);
  const verdicts = rows.map((r) => r.row.verdict);
  if (verdicts.includes(OPPOSITE[expected])) return OPPOSITE[expected];
  const allExpected = verdicts.length === control.findings.length && verdicts.every((v) => v === expected);
  return allExpected ? expected : "unclear";
}

/** Owner decision 4: a failed control marks the whole run provisional; unclear and missing answers do not. */
export function scoreControlItems(items: readonly TriageItem[], kept: ReadonlyMap<string, VerifiedRow[]>): ControlReport {
  const controls = items.flatMap((item) => (item.control ? [{ item, control: item.control }] : []));
  const outcomes: ControlOutcome[] = controls.map(({ item, control }) => {
    const answered = answerOf(control, kept.get(item.id) ?? []);
    return { id: control.id, label: control.label, expected: expectedVerdict(control.label), ...(answered ? { answered } : {}) };
  });
  const expected: LabeledAnswer[] = outcomes.map((o) => ({ id: o.id, label: o.expected }));
  const answered: LabeledAnswer[] = outcomes.flatMap((o) => (o.answered ? [{ id: o.id, label: o.answered }] : []));
  const failed = outcomes.filter((o) => o.answered === OPPOSITE[o.expected]).map((o) => o.id);
  return { controls: outcomes, score: scoreControls(expected, answered), failed, controlRun: failed.length > 0 ? "provisional" : "ok" };
}
