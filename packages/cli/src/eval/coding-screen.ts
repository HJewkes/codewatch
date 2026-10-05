import {
  classifyEditFile,
  darkHunkKind,
  isSecondOrderDark,
  type DarkHunkKind,
  type DocumentFrequency,
  type EditFileInput,
  type EditFileLight,
  type HunkLines,
  type TestContext,
} from "./coding-hardness.js";
import { dominantStratum } from "./stratify.js";
import type { Stratum } from "./types.js";

/**
 * Static hardness screen of a mined candidate (C-86 mining steps 3 and 4): the
 * darkness, reach and hunk kind of each edit file, folded into per-task features
 * and a keep/reject verdict. Pure — the git reads live in `coding-git.ts`.
 */

export interface EditFileScreen {
  path: string;
  light: EditFileLight;
  /** Import-walk depth from the tests; null when no test reaches the file. */
  hop: number | null;
  /** Dark files only. */
  hunkKind?: DarkHunkKind;
  /** Dark files only: no distinctive identifier shared with the other edit files' changed lines. */
  secondOrderDark?: boolean;
}

export interface HardnessFeatures {
  /** Dark edit files, not counting those whose change is comment-only. */
  darkFiles: number;
  /** Dark files with an export-only change: written as soon as the main change is. */
  trivialDarkFiles: number;
  /** Dark files the tests reach at hop 2 or more. */
  darkReachable: number;
  /** Deepest hop at which the tests reach any edit file; null when none is reached. */
  maxHop: number | null;
  secondOrderDark: number;
  files: EditFileScreen[];
}

export interface ScreenInput {
  edits: readonly EditFileInput[];
  ctx: TestContext;
  /** Changed lines per edit file, from the fix commit's source diff. */
  hunks: ReadonlyMap<string, HunkLines>;
  hops: Readonly<Record<string, number | null>>;
  df: DocumentFrequency;
}

export type ScreenVerdict = "pass" | "dark-rejected" | "trivial-rejected";

const EMPTY_HUNK: HunkLines = { added: [], removed: [] };

export function screenEditFiles(input: ScreenInput): EditFileScreen[] {
  return input.edits.map((edit) => screenEditFile(edit, input));
}

function screenEditFile(edit: EditFileInput, input: ScreenInput): EditFileScreen {
  const light = classifyEditFile(edit, input.ctx);
  const hop = input.hops[edit.path] ?? null;
  if (light !== "dark") return { path: edit.path, light, hop };
  const others = otherChangedLines(edit.path, input.hunks);
  return {
    path: edit.path,
    light,
    hop,
    hunkKind: darkHunkKind(input.hunks.get(edit.path) ?? EMPTY_HUNK),
    secondOrderDark: isSecondOrderDark(edit.parentContent, others, input.df),
  };
}

function otherChangedLines(path: string, hunks: ReadonlyMap<string, HunkLines>): string[] {
  const out: string[] = [];
  for (const [p, h] of hunks) if (p !== path) out.push(...h.added, ...h.removed);
  return out;
}

export function hardnessFeatures(files: EditFileScreen[]): HardnessFeatures {
  const dark = files.filter((f) => f.light === "dark" && f.hunkKind !== "comment-only");
  const reached = files.flatMap((f) => (f.hop === null ? [] : [f.hop]));
  return {
    darkFiles: dark.length,
    trivialDarkFiles: dark.filter((f) => f.hunkKind === "export-only").length,
    darkReachable: dark.filter((f) => f.hop !== null && f.hop >= 2).length,
    maxHop: reached.length > 0 ? Math.max(...reached) : null,
    secondOrderDark: dark.filter((f) => f.secondOrderDark).length,
    files,
  };
}

/** Too few dark files, or enough only when export-only ones are counted. */
export function screenVerdict(h: HardnessFeatures, minDark: number): ScreenVerdict {
  if (h.darkFiles < minDark) return "dark-rejected";
  if (h.darkFiles - h.trivialDarkFiles < minDark) return "trivial-rejected";
  return "pass";
}

const LIGHT_STRATUM: Record<EditFileLight, Stratum> = {
  dark: "structurally-hidden",
  "test-imported": "import-chain-reachable",
  added: "semantic-findable",
  "shares-basename": "semantic-findable",
  "shares-identifier": "semantic-findable",
};

/** The task's stratum: the plurality of its edit files' lights. */
export function stratumOf(files: readonly EditFileScreen[]): Stratum {
  return dominantStratum(files.map((f) => LIGHT_STRATUM[f.light]));
}

/** Added and removed lines per file of a unified diff, keyed by the new path. */
export function parseDiffHunks(diff: string): Map<string, HunkLines> {
  const out = new Map<string, { added: string[]; removed: string[] }>();
  let current: { added: string[]; removed: string[] } | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      [current, inHunk] = [null, false];
    } else if (!inHunk && line.startsWith("+++ b/")) {
      current = { added: [], removed: [] };
      out.set(line.slice("+++ b/".length), current);
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && current && /^[+-]/.test(line)) {
      (line[0] === "+" ? current.added : current.removed).push(line.slice(1));
    }
  }
  return out;
}
