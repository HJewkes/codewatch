import type { ParsedFile } from "@titan-design/code-parser";
import { touches, type ChangedLines } from "./audit-changed.js";
import { errorKey, errorSites, type ErrorSite } from "./audit-contract-facts.js";

/** The innermost symbol whose span holds a line of a file, or undefined at module level. */
export type OwnerOf = (file: string, line: number) => string | undefined;

/** Error sites a diff lost, grouped by the base symbol that held them. */
export interface LostError {
  ownerId: string;
  file: string;
  sites: ErrorSite[];
}

interface Located {
  file: string;
  site: ErrorSite;
  owner: string | undefined;
}

function locate(parsed: ReadonlyMap<string, ParsedFile>, ownerOf: OwnerOf): Located[] {
  return [...parsed].flatMap(([file, tree]) => errorSites(tree).map((site) => ({ file, site, owner: ownerOf(file, site.line) })));
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(keyOf(item), (out.get(keyOf(item)) ?? 0) + 1);
  return out;
}

const ownerKey = (l: Located): string => `${l.owner ?? ""}\0${errorKey(l.site)}`;

/** The base occurrences of `key` the head lost: drawn from owners holding fewer of it at head, at most `lost` of them. */
function lostOccurrences(key: string, lost: number, base: readonly Located[], headByOwner: ReadonlyMap<string, number>): Located[] {
  const quota = new Map(headByOwner);
  const out: Located[] = [];
  for (const occurrence of base) {
    if (errorKey(occurrence.site) !== key || out.length === lost) continue;
    const left = quota.get(ownerKey(occurrence)) ?? 0;
    if (left > 0) quota.set(ownerKey(occurrence), left - 1);
    else out.push(occurrence);
  }
  return out;
}

function groupByOwner(occurrences: readonly Located[]): LostError[] {
  const groups = new Map<string, LostError>();
  for (const { file, site, owner } of occurrences) {
    if (owner === undefined) continue;
    const id = `${owner}\0${errorKey(site)}`;
    const group = groups.get(id) ?? { ownerId: owner, file, sites: [] };
    group.sites.push(site);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/**
 * Error keys counted across every changed file, base against head: a key whose count drops lost
 * a site, and a key that only moved (into a new helper or another changed file) keeps its count.
 */
export function lostErrors(base: ReadonlyMap<string, ParsedFile>, head: ReadonlyMap<string, ParsedFile>, baseOwner: OwnerOf, headOwner: OwnerOf): LostError[] {
  const before = locate(base, baseOwner);
  const after = locate(head, headOwner);
  const headCounts = countBy(after, (l) => errorKey(l.site));
  const headByOwner = countBy(after, ownerKey);
  const lost = [...countBy(before, (l) => errorKey(l.site))].flatMap(([key, count]) => {
    const dropped = count - (headCounts.get(key) ?? 0);
    return dropped > 0 ? lostOccurrences(key, dropped, before, headByOwner) : [];
  });
  return groupByOwner(lost);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Shorter messages ("bad", "error") are substrings of unrelated test lines, so they cannot identify a test. */
export const MIN_ASSERTED_MESSAGE_LENGTH = 8;

/** A test line that asserts the error: its message, or with no message, a raises/toThrow of its exception. */
function asserts(site: ErrorSite): (line: string) => boolean {
  if (site.exception === "exit" && /^-?\d+$/.test(site.message)) {
    const code = new RegExp(`\\b${escapeRegExp(site.message)}\\b`);
    return (line) => /SystemExit|exit_?code|exitCode|returncode/.test(line) && code.test(line);
  }
  if (site.message.length >= MIN_ASSERTED_MESSAGE_LENGTH) return (line) => line.includes(site.message);
  if (site.message !== "") return () => false;
  const raises = new RegExp(`(?:raises|assertRaises|toThrow)\\(\\s*${escapeRegExp(site.exception)}\\b`);
  return (line) => raises.test(line);
}

/** `file:line` of each head test line asserting the error, marked when the diff touches it. */
export function assertingLines(site: ErrorSite, testFiles: readonly string[], readHead: (file: string) => string | undefined, changed: ChangedLines): string[] {
  const matches = asserts(site);
  return testFiles.flatMap((file) =>
    (readHead(file) ?? "").split("\n").flatMap((text, i) => {
      if (!matches(text)) return [];
      const inDiff = touches(changed, file, { start: i + 1, end: i + 1 }) ? " (in diff)" : "";
      return [`${file}:${i + 1}${inDiff}`];
    }),
  );
}
