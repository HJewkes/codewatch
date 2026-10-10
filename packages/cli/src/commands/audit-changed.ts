import { execFileSync } from "node:child_process";

export interface LineRange {
  start: number;
  end: number;
}

/** New-side lines a diff touches, per repo-relative path. */
export type ChangedLines = ReadonlyMap<string, readonly LineRange[]>;

const NEW_FILE = /^\+\+\+ b\/(.+)$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** A pure deletion (count 0) touches the line it sits after, so the symbol around it counts as changed. */
function hunkRange(start: number, count: number): LineRange {
  return count === 0 ? { start, end: start } : { start, end: start + count - 1 };
}

/** Changed lines from `git diff -U0` output. */
export function parseChangedLines(diff: string): ChangedLines {
  const out = new Map<string, LineRange[]>();
  let current: LineRange[] | undefined;
  for (const line of diff.split("\n")) {
    const file = NEW_FILE.exec(line);
    if (file) {
      current = out.get(file[1]!) ?? [];
      out.set(file[1]!, current);
      continue;
    }
    if (line.startsWith("+++ ")) current = undefined;
    const hunk = current && HUNK.exec(line);
    if (hunk) current!.push(hunkRange(Number(hunk[1]), Number(hunk[2] ?? "1")));
  }
  return out;
}

/** Prefixes and paths are pinned because diff.mnemonicPrefix, diff.noprefix and diff.relative would change them. */
const DIFF_ARGS = ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-relative", "--src-prefix=a/", "--dst-prefix=b/"];

/** Lines the working tree changes against `ref`, read in the repo at `cwd`. */
export function changedLinesSince(ref: string, cwd: string): ChangedLines {
  const diff = execFileSync("git", [...DIFF_ARGS, ref, "--"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return parseChangedLines(diff);
}

export function touches(changed: ChangedLines | undefined, path: string, span: LineRange): boolean {
  return (changed?.get(path) ?? []).some((r) => r.start <= span.end && span.start <= r.end);
}
