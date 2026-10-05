import { extractRelativeSpecifiers } from "./coding-mine.js";
import { resolveRelativeSpecifier, splitTokens } from "./stratify.js";

/**
 * Hardness screen for coding tasks: which edit files a grep agent cannot reach
 * from the identifiers in the failing tests. Pure functions over plain data —
 * callers do the git reads (file contents, changed lines, the source corpus).
 */

export interface DocumentFrequency {
  /** Number of source files each identifier appears in. */
  readonly counts: ReadonlyMap<string, number>;
  readonly fileCount: number;
}

export type EditFileLight =
  | "dark"
  | "added"
  | "shares-identifier"
  | "shares-basename"
  | "test-imported";

export interface EditFileInput {
  readonly path: string;
  readonly added: boolean;
  /** File content at the parent commit; empty for an added file. */
  readonly parentContent: string;
}

export interface TestContext {
  readonly testFiles: readonly string[];
  readonly distinctiveSeeds: ReadonlySet<string>;
  /** Files a test file imports directly (see `testImportedFiles`). */
  readonly testImported: ReadonlySet<string>;
}

export interface HunkLines {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export type DarkHunkKind = "comment-only" | "export-only" | "type-only" | "logic";

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]{3,}/g;
const MIN_DISTINCTIVE_DF = 4;
const DISTINCTIVE_DF_SHARE = 0.02;

/** Every identifier of 4 or more characters in `source`. */
export function extractIdentifiers(source: string): Set<string> {
  return new Set(source.match(IDENTIFIER_RE) ?? []);
}

/** Seed identifiers: the union of identifiers across the changed test files. */
export function seedIdentifiers(testSources: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const src of testSources) for (const id of extractIdentifiers(src)) out.add(id);
  return out;
}

/** How many of `sources` (one entry per source file) contain each identifier. */
export function documentFrequency(sources: Iterable<string>): DocumentFrequency {
  const counts = new Map<string, number>();
  let fileCount = 0;
  for (const src of sources) {
    fileCount++;
    for (const id of extractIdentifiers(src)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { counts, fileCount };
}

/** Distinctive: document frequency at most max(4, 2% of source files). */
export function isDistinctive(id: string, df: DocumentFrequency): boolean {
  const limit = Math.max(MIN_DISTINCTIVE_DF, Math.floor(df.fileCount * DISTINCTIVE_DF_SHARE));
  return (df.counts.get(id) ?? 0) <= limit;
}

export function distinctiveSeeds(
  seeds: Iterable<string>,
  df: DocumentFrequency,
): Set<string> {
  const out = new Set<string>();
  for (const id of seeds) if (isDistinctive(id, df)) out.add(id);
  return out;
}

/** Repo files that a test file imports through a relative specifier. */
export function testImportedFiles(
  testSources: ReadonlyMap<string, string>,
  repoFileIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const [testFile, src] of testSources) {
    for (const spec of extractRelativeSpecifiers(src)) {
      const resolved = resolveRelativeSpecifier(testFile, spec, repoFileIds);
      if (resolved !== null) out.add(resolved);
    }
  }
  return out;
}

/**
 * Dark edit file: modified (not added), and at the parent commit it shares no
 * distinctive seed identifier, no basename token with a test file, and is not
 * imported by a test file. Any other verdict names the first clue that lights it.
 */
export function classifyEditFile(edit: EditFileInput, ctx: TestContext): EditFileLight {
  if (edit.added) return "added";
  if (ctx.testImported.has(edit.path)) return "test-imported";
  if (sharesBasenameToken(edit.path, ctx.testFiles)) return "shares-basename";
  if (sharesAny(edit.parentContent, ctx.distinctiveSeeds)) return "shares-identifier";
  return "dark";
}

/**
 * Second-order dark: the dark file also shares no distinctive identifier with
 * the changed lines of the other edit files, so following the main change by
 * grep does not lead to it either.
 */
export function isSecondOrderDark(
  darkParentContent: string,
  otherChangedLines: readonly string[],
  df: DocumentFrequency,
): boolean {
  const reachable = new Set<string>();
  for (const id of extractIdentifiers(otherChangedLines.join("\n"))) {
    if (isDistinctive(id, df)) reachable.add(id);
  }
  return !sharesAny(darkParentContent, reachable);
}

function sharesAny(content: string, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return false;
  for (const id of extractIdentifiers(content)) if (ids.has(id)) return true;
  return false;
}

function sharesBasenameToken(path: string, testFiles: readonly string[]): boolean {
  const editTokens = splitTokens(stem(path));
  for (const tf of testFiles) {
    for (const t of splitTokens(stem(tf))) if (editTokens.has(t)) return true;
  }
  return false;
}

/** Basename up to its first dot, so `.test.tsx` and `.ts` add no shared token. */
function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * Kind of a dark file's change, judged line by line. Comment, blank and
 * brace-only lines carry no weight; a change made only of them is
 * `comment-only`. `export-only` adds or drops `export` on otherwise unchanged
 * lines, or touches re-export lines only. `type-only` touches type
 * declarations, member signatures without an initializer, or type imports.
 */
export function darkHunkKind(hunk: HunkLines): DarkHunkKind {
  const added = hunk.added.filter(isWeighted);
  const removed = hunk.removed.filter(isWeighted);
  if (added.length + removed.length === 0) return "comment-only";
  const rest = cancelExportToggles(added, removed).filter((l) => !isReExport(l));
  if (rest.length === 0) return "export-only";
  if ([...added, ...removed].every(isTypeLine)) return "type-only";
  return "logic";
}

function isWeighted(line: string): boolean {
  const t = line.trim();
  if (t === "" || /^[{}()[\];,]+$/.test(t)) return false;
  return !/^(\/\/|\/\*|\*)/.test(t);
}

/** Lines left after pairing each removed line with an added `export`-toggled twin. */
function cancelExportToggles(added: readonly string[], removed: readonly string[]): string[] {
  const pending = [...removed];
  const rest: string[] = [];
  for (const line of added) {
    const i = pending.findIndex((r) => isExportToggle(r, line));
    if (i >= 0) pending.splice(i, 1);
    else rest.push(line);
  }
  return [...rest, ...pending];
}

function isExportToggle(a: string, b: string): boolean {
  return a.trim() !== b.trim() && stripExport(a) === stripExport(b);
}

function stripExport(line: string): string {
  return line.trim().replace(/^export\s+(default\s+)?/, "");
}

function isReExport(line: string): boolean {
  return /^export\s+(type\s+)?(\*|\{[^}]*\})\s*(as\s+\w+\s+)?from\s/.test(line.trim());
}

const TYPE_LINE_RES = [
  /^(export\s+)?(declare\s+)?(type|interface)\s/,
  /^import\s+type\s/,
  /^(readonly\s+)?[\w$]+\??\s*:\s*[^=]+;?$/,
  /^\|/,
];

function isTypeLine(line: string): boolean {
  const t = line.trim().replace(/=>/g, "");
  if (t.endsWith(",")) return false;
  return isReExport(t) || TYPE_LINE_RES.some((re) => re.test(t));
}
