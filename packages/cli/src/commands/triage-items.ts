import { hashContent, keyFindings, type Finding, type FindingKeyInput } from "@titan-design/code-graph";
import { lineSourceFromTexts, type LineSource } from "@titan-design/evidence";
import { symbolOf, type SymbolSpan } from "./audit-score.js";
import { flaggedLines, type TriageBundle } from "./triage-bundle.js";
import type { Control } from "./triage-controls/types.js";
import { lineRange, renderShown, type ShownLines } from "./triage-excerpt.js";
import { questionFor, type TriageQuestion } from "./triage-questions.js";

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

/** What the items need from the audit's snapshot: file text and symbol spans. */
export interface ItemSource {
  lines(path: string): readonly string[] | undefined;
  symbols(path: string): readonly SymbolSpan[];
}

interface Keyable {
  input: FindingKeyInput;
  question: TriageQuestion;
  excerptHash: string;
}

function flaggedText(f: Finding, text: readonly string[]): string {
  return flaggedLines(f)
    .map((n) => text[n - 1] ?? "")
    .join("\n");
}

function keyableOf(f: Finding, excerptHash: string, source: ItemSource): Keyable {
  const text = source.lines(f.path) ?? [];
  const anchor = symbolOf(f, source.symbols(f.path)) ?? f.path;
  return { input: { finding: f, anchor, flaggedText: flaggedText(f, text), excerptHash }, question: questionFor(f.signal)!, excerptHash };
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

export function bundleItems(bundles: readonly TriageBundle[], source: ItemSource): TriageItem[] {
  const keyables = bundles.flatMap((b) => b.questions.map((q) => keyableOf(q.finding, q.excerptHash, source)));
  const keyed = keyAll(keyables);
  const lines: LineSource = { lines: (p) => source.lines(p) };
  return bundles.map((b) => ({
    id: b.id,
    path: b.path,
    excerpt: b.excerpt,
    shown: b.shown,
    lines,
    questions: b.questions.map((q) => keyed.get(q.finding)!),
  }));
}

function controlFinding(control: Control, i: number): Finding {
  const { expected: _expected, ...row } = control.findings[i]!;
  return { ...row, id: `${row.tool}:${row.signal}:${row.path}:${row.lineStart}`, severity: "warning" };
}

/** A control is shown whole, like a small real file. */
export function controlItem(control: Control): TriageItem {
  const lines = lineSourceFromTexts({ [control.path]: control.text });
  const text = lines.lines(control.path) ?? [];
  const shown: ShownLines = new Map([[control.path, new Set(lineRange(1, text.length, text.length))]]);
  const excerpt = renderShown(shown, () => text);
  const source: ItemSource = { lines: () => text, symbols: () => symbolSpans(control) };
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
