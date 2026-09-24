import { hashContent, parseSymbolId, type Finding } from "@titan-design/code-graph";
import { symbolKey, symbolOf, type SymbolSpan } from "./audit-score.js";
import {
  copyShown,
  estimateTokens,
  lineRange,
  mergeShown,
  renderShown,
  type ShownLines,
} from "./triage-excerpt.js";
import { questionFor, type TriageQuestion } from "./triage-questions.js";
import type { SelectedFile } from "./triage-select.js";
import type { BundleSource } from "./triage-source.js";

export const DEFAULT_TOKEN_CAP = 24_000;
/** Lines kept either side of a flagged line when a symbol is too large to show whole. */
export const OVERSIZE_CONTEXT = 20;

export interface BundleQuestion {
  finding: Finding;
  question: TriageQuestion;
  /** Hash of the excerpt this question was asked over, so an unchanged answer can be reused. */
  excerptHash: string;
}

export interface TriageBundle {
  id: string;
  path: string;
  shown: ShownLines;
  excerpt: string;
  tokens: number;
  hash: string;
  questions: BundleQuestion[];
}

export interface BundleResult {
  bundles: TriageBundle[];
  skippedFiles: string[];
}

interface Unit {
  firstLine: number;
  shown: ShownLines;
  findings: Finding[];
}

interface Range {
  key: string;
  start: number;
  end: number;
}

interface RangeGroup {
  range: Range;
  findings: Finding[];
}

type TextOf = (p: string) => readonly string[];

/** A symbol-level finding points at its declaration line; a line finding at its own lines. */
export function flaggedLines(f: Finding): number[] {
  if (f.lineStart === undefined) return [];
  if (f.symbol !== undefined) return [f.lineStart];
  return lineRange(f.lineStart, f.lineEnd ?? f.lineStart, Number.MAX_SAFE_INTEGER);
}

function spanRange(symbolId: string | undefined, spans: readonly SymbolSpan[]): Range | undefined {
  const span = spans.find((s) => symbolKey(s.path, s.symbol) === symbolId);
  if (span?.lineStart === undefined || span.lineEnd === undefined) return undefined;
  return { key: symbolId!, start: span.lineStart, end: span.lineEnd };
}

/** The innermost symbol holding the finding; else its lines with context; else the whole file. */
function rangeOf(f: Finding, spans: readonly SymbolSpan[], lineCount: number): Range {
  const symbol = spanRange(symbolOf(f, spans), spans);
  if (symbol) return symbol;
  if (f.lineStart === undefined) return { key: f.path, start: 1, end: lineCount };
  const start = f.lineStart - OVERSIZE_CONTEXT;
  const end = (f.lineEnd ?? f.lineStart) + OVERSIZE_CONTEXT;
  return { key: `${f.path}:${start}-${end}`, start, end };
}

function prefixWithin(numbers: readonly number[], text: readonly string[], cap: number): number[] {
  const out: number[] = [];
  let tokens = 0;
  for (const n of numbers) {
    tokens += estimateTokens(`${n}| ${text[n - 1] ?? ""}\n`);
    if (tokens > cap && out.length > 0) break;
    out.push(n);
  }
  return out;
}

/** The whole range when it fits the cap; otherwise only the flagged lines with context. */
function fitRange(p: string, range: Range, flagged: readonly number[], textOf: TextOf, cap: number): ShownLines {
  const text = textOf(p);
  const whole = lineRange(range.start, range.end, text.length);
  const shown: ShownLines = new Map([[p, new Set(whole)]]);
  if (estimateTokens(renderShown(shown, textOf)) <= cap) return shown;
  const near = new Set(flagged.flatMap((n) => lineRange(n - OVERSIZE_CONTEXT, n + OVERSIZE_CONTEXT, text.length)));
  const kept = whole.filter((n) => near.has(n));
  return new Map([[p, new Set(kept.length > 0 ? kept : prefixWithin(whole, text, cap))]]);
}

function callerExcerpt(f: Finding, source: BundleSource, cap: number): ShownLines | undefined {
  const helperId = f.symbol === undefined ? undefined : symbolKey(f.path, f.symbol);
  const callerId = helperId === undefined ? undefined : source.caller(helperId);
  const parsed = callerId === undefined ? null : parseSymbolId(callerId);
  if (!parsed || !source.lines(parsed.fileId)) return undefined;
  const range = spanRange(callerId, source.symbols(parsed.fileId));
  if (!range) return undefined;
  const textOf: TextOf = (p) => source.lines(p) ?? [];
  return fitRange(parsed.fileId, range, [range.start], textOf, cap);
}

function groupByRange(file: SelectedFile, spans: readonly SymbolSpan[], lineCount: number): Map<string, RangeGroup> {
  const byRange = new Map<string, RangeGroup>();
  for (const f of file.findings) {
    const range = rangeOf(f, spans, lineCount);
    const entry = byRange.get(range.key) ?? { range, findings: [] };
    entry.findings.push(f);
    byRange.set(range.key, entry);
  }
  return byRange;
}

function unitFor({ range, findings }: RangeGroup, p: string, source: BundleSource, cap: number): Unit {
  const textOf: TextOf = (x) => source.lines(x) ?? [];
  const shown = fitRange(p, range, findings.flatMap(flaggedLines), textOf, cap);
  for (const f of findings.filter((x) => questionFor(x.signal)?.needsCaller)) {
    const caller = callerExcerpt(f, source, cap);
    if (caller) mergeShown(shown, caller);
  }
  return { firstLine: range.start, shown, findings };
}

/** A file-level finding has no line, so it rides on the file's other excerpts and shows the whole file only when alone. */
function buildUnits(file: SelectedFile, source: BundleSource, cap: number): Unit[] {
  const groups = groupByRange(file, source.symbols(file.path), source.lines(file.path)!.length);
  const fileLevel = groups.size > 1 ? groups.get(file.path) : undefined;
  if (fileLevel) groups.delete(file.path);
  const units = [...groups.values()].map((group) => unitFor(group, file.path, source, cap));
  if (fileLevel) units.push({ firstLine: 0, shown: new Map(), findings: fileLevel.findings });
  return units;
}

/** Greedy packing in line order: a unit joins the open bundle while the union stays under the cap. */
function packUnits(units: readonly Unit[], textOf: TextOf, cap: number): Unit[][] {
  const groups: { shown: ShownLines; units: Unit[] }[] = [];
  for (const unit of [...units].sort((a, b) => a.firstLine - b.firstLine)) {
    const open = groups[groups.length - 1];
    const merged = open ? mergeShown(copyShown(open.shown), unit.shown) : undefined;
    if (open && merged && estimateTokens(renderShown(merged, textOf)) <= cap) {
      open.shown = merged;
      open.units.push(unit);
    } else {
      groups.push({ shown: copyShown(unit.shown), units: [unit] });
    }
  }
  return groups.map((g) => g.units);
}

function toBundle(p: string, id: string, units: readonly Unit[], textOf: TextOf): TriageBundle {
  const shown = units.reduce((acc, u) => mergeShown(acc, u.shown), new Map() as ShownLines);
  const excerpt = renderShown(shown, textOf);
  const hash = hashContent(excerpt);
  const questions = units.flatMap((u) => {
    const excerptHash = u.shown.size > 0 ? hashContent(renderShown(u.shown, textOf)) : hash;
    return u.findings.map((finding) => ({ finding, question: questionFor(finding.signal)!, excerptHash }));
  });
  return { id, path: p, shown, excerpt, tokens: estimateTokens(excerpt), hash, questions };
}

/** One bundle per file, split by symbol when the excerpts together pass the token cap. */
export function buildBundles(files: readonly SelectedFile[], source: BundleSource, cap = DEFAULT_TOKEN_CAP): BundleResult {
  const textOf: TextOf = (p) => source.lines(p) ?? [];
  const bundles: TriageBundle[] = [];
  const skippedFiles: string[] = [];
  for (const file of files) {
    if (!source.lines(file.path)) {
      skippedFiles.push(file.path);
      continue;
    }
    const parts = packUnits(buildUnits(file, source, cap), textOf, cap);
    parts.forEach((units, i) => {
      const id = parts.length > 1 ? `${file.path}:part${i + 1}` : file.path;
      bundles.push(toBundle(file.path, id, units, textOf));
    });
  }
  return { bundles, skippedFiles };
}
