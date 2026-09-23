import type { Finding } from "@titan-design/code-graph";

export interface FileStats {
  path: string;
  loc: number;
  cognitiveMax: number;
}

export interface SymbolStats {
  path: string;
  symbol: string;
  lineStart?: number;
  lineEnd?: number;
  cognitive: number;
  cyclomatic: number;
}

export type SignalCounts = Record<string, number>;

export interface FileScore extends FileStats {
  /** 0-100: mean of the file's loc and cognitive-max percentiles within this repo. */
  rank: number;
  findings: SignalCounts;
  total: number;
}

export interface SymbolScore extends SymbolStats {
  findings: SignalCounts;
  total: number;
}

export interface ScoreTable {
  files: FileScore[];
  symbols: SymbolScore[];
}

/** Percent of the other values each value strictly exceeds; ties share a percentile. */
export function percentileRanks(values: readonly number[]): number[] {
  if (values.length <= 1) return values.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => (countBelow(sorted, v) / (values.length - 1)) * 100);
}

function countBelow(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function countSignals(findings: readonly Finding[]): SignalCounts {
  const counts: SignalCounts = {};
  for (const f of findings) counts[f.signal] = (counts[f.signal] ?? 0) + 1;
  return counts;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

const symbolKey = (path: string, symbol: string): string => `${path}#${symbol}`;

function contains(s: SymbolStats, line: number): boolean {
  return s.lineStart !== undefined && s.lineEnd !== undefined && s.lineStart <= line && line <= s.lineEnd;
}

function spanOf(s: SymbolStats): number {
  return (s.lineEnd ?? 0) - (s.lineStart ?? 0);
}

/** A finding names its symbol, or sits inside the innermost symbol whose span holds its first line. */
function symbolOf(f: Finding, symbolsInFile: readonly SymbolStats[]): string | undefined {
  if (f.symbol !== undefined) return symbolKey(f.path, f.symbol);
  if (f.lineStart === undefined) return undefined;
  const holders = symbolsInFile.filter((s) => contains(s, f.lineStart!));
  if (holders.length === 0) return undefined;
  const innermost = holders.reduce((a, b) => (spanOf(b) < spanOf(a) ? b : a));
  return symbolKey(innermost.path, innermost.symbol);
}

function scoreFiles(files: readonly FileStats[], findings: readonly Finding[]): FileScore[] {
  const locPct = percentileRanks(files.map((f) => f.loc));
  const cogPct = percentileRanks(files.map((f) => f.cognitiveMax));
  const byPath = groupBy(findings, (f) => f.path);
  const scored = files.map((file, i) => {
    const counts = countSignals(byPath.get(file.path) ?? []);
    const rank = Math.round(((locPct[i]! + cogPct[i]!) / 2) * 10) / 10;
    return { ...file, rank, findings: counts, total: sumCounts(counts) };
  });
  return scored.sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path));
}

function scoreSymbols(symbols: readonly SymbolStats[], findings: readonly Finding[]): SymbolScore[] {
  const symbolsByPath = groupBy(symbols, (s) => s.path);
  const bySymbol = groupBy(findings, (f) => symbolOf(f, symbolsByPath.get(f.path) ?? []));
  const scored = symbols.map((s) => {
    const counts = countSignals(bySymbol.get(symbolKey(s.path, s.symbol)) ?? []);
    return { ...s, findings: counts, total: sumCounts(counts) };
  });
  return scored.sort(
    (a, b) => b.total - a.total || b.cognitive - a.cognitive || symbolKey(a.path, a.symbol).localeCompare(symbolKey(b.path, b.symbol)),
  );
}

function sumCounts(counts: SignalCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function buildScoreTable(
  files: readonly FileStats[],
  symbols: readonly SymbolStats[],
  findings: readonly Finding[],
): ScoreTable {
  return { files: scoreFiles(files, findings), symbols: scoreSymbols(symbols, findings) };
}
