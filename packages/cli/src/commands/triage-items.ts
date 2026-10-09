import { hashContent, keyFindings, type Finding, type FindingKeyInput } from "@titan-design/code-graph";
import { lineSourceFromTexts, type LineSource } from "@titan-design/evidence";
import type { SymbolSpan } from "./audit-score.js";
import type { TriageBundle } from "./triage-bundle.js";
import type { Control } from "./triage-controls/types.js";
import { lineRange, renderShown, type ShownLines } from "./triage-excerpt.js";
import { keyInputOf, type KeySource } from "./triage-keys.js";
import { questionFor, type TriageQuestion } from "./triage-questions.js";
import { SPEC_PATH } from "./triage-spec.js";

export interface ItemQuestion {
  /** The code-graph finding key; the reader answers by it and verdicts are stored by it. */
  key: string;
  finding: Finding;
  question: TriageQuestion;
  excerptHash: string;
}

/** One model call: a real file bundle or a planted control, which the reader cannot tell apart. */
export interface TriageItem {
  id: string;
  path: string;
  excerpt: string;
  shown: ShownLines;
  lines: LineSource;
  questions: ItemQuestion[];
  control?: Control;
}

interface Keyable {
  input: FindingKeyInput;
  question: TriageQuestion;
  excerptHash: string;
}

function keyableOf(f: Finding, excerptHash: string, source: KeySource): Keyable {
  return { input: keyInputOf(f, source, excerptHash), question: questionFor(f.signal)!, excerptHash };
}

/** Keys every finding at once, so same-rule collisions number the same way the store will. */
function keyAll(keyables: readonly Keyable[]): Map<Finding, ItemQuestion> {
  const stored = keyFindings(keyables.map((k) => k.input));
  const byFinding = new Map(keyables.map((k) => [k.input.finding, k]));
  return new Map(
    stored.map(({ key, finding }) => {
      const { question, excerptHash } = byFinding.get(finding)!;
      return [finding, { key, finding, question, excerptHash }];
    }),
  );
}

/** `keys` comes from keying the whole selection, so a finding keeps the key the audit stored even when others were skipped. */
export function bundleItems(bundles: readonly TriageBundle[], keys: ReadonlyMap<Finding, string>, source: LineSource): TriageItem[] {
  return bundles.map((b) => ({
    id: b.id,
    path: b.path,
    excerpt: b.excerpt,
    shown: b.shown,
    lines: source,
    questions: b.questions.map(({ finding, question, excerptHash }) => ({ key: keys.get(finding)!, finding, question, excerptHash })),
  }));
}

function controlFinding(control: Control, i: number): Finding {
  const { expected: _expected, ...row } = control.findings[i]!;
  return { ...row, id: `${row.tool}:${row.signal}:${row.path}:${row.lineStart}`, severity: "warning" };
}

function wholeFiles(lines: LineSource, paths: readonly string[]): ShownLines {
  return new Map(paths.map((p) => [p, new Set(lineRange(1, lines.lines(p)?.length ?? 0, Number.MAX_SAFE_INTEGER))]));
}

/** A control is shown whole, like a small real file, with its own planted spec when it has one. */
export function controlItem(control: Control): TriageItem {
  const texts = { [control.path]: control.text, ...(control.spec === undefined ? {} : { [SPEC_PATH]: control.spec }) };
  const lines = lineSourceFromTexts(texts);
  const text = lines.lines(control.path) ?? [];
  const shown = wholeFiles(lines, Object.keys(texts));
  const excerpt = renderShown(shown, (p) => lines.lines(p) ?? []);
  const source: KeySource = { lines: () => text, symbols: () => symbolSpans(control) };
  const keyables = control.findings.map((_, i) => keyableOf(controlFinding(control, i), hashContent(excerpt), source));
  const keyed = keyAll(keyables);
  const questions = keyables.map((k) => keyed.get(k.input.finding)!);
  return { id: control.path, path: control.path, excerpt, shown, lines, questions, control };
}

function symbolSpans(control: Control): SymbolSpan[] {
  return control.findings.flatMap((f) =>
    f.symbol ? [{ path: control.path, symbol: f.symbol, lineStart: f.lineStart, lineEnd: f.lineEnd }] : [],
  );
}
