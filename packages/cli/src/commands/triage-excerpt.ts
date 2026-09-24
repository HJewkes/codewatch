/** Shown lines per path; line numbers are 1-based. */
export type ShownLines = Map<string, Set<number>>;

export const ELISION = "     ...";

/** A rough count for budgeting: about four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function lineRange(start: number, end: number, max: number): number[] {
  const lo = Math.max(1, start);
  const hi = Math.min(max, end);
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

export function mergeShown(into: ShownLines, from: ShownLines): ShownLines {
  for (const [p, lines] of from) {
    const set = into.get(p) ?? new Set<number>();
    for (const n of lines) set.add(n);
    into.set(p, set);
  }
  return into;
}

export function copyShown(shown: ShownLines): ShownLines {
  return mergeShown(new Map(), shown);
}

function renderPath(p: string, numbers: readonly number[], text: readonly string[]): string {
  const width = String(numbers[numbers.length - 1] ?? 0).length;
  const out = [`=== ${p}`];
  numbers.forEach((n, i) => {
    if (i > 0 && n !== numbers[i - 1]! + 1) out.push(ELISION);
    out.push(`${String(n).padStart(width)}| ${text[n - 1] ?? ""}`);
  });
  return out.join("\n");
}

/** Numbered lines per path in path order, with an elision marker wherever shown lines skip ahead. */
export function renderShown(shown: ShownLines, textOf: (p: string) => readonly string[]): string {
  return [...shown.keys()]
    .sort()
    .map((p) => renderPath(p, [...shown.get(p)!].sort((a, b) => a - b), textOf(p)))
    .join("\n\n");
}
