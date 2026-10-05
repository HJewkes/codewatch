import { extractIdentifiers } from "./coding-hardness.js";
import { extractRelativeSpecifiers } from "./coding-mine.js";
import { resolveRelativeSpecifier } from "./stratify.js";

/**
 * Gold clues in an impact task's seed diff, the only task-specific text of its
 * prompt. A clue is anything an arm could grep from the seed to a gold file.
 */

export interface LeakInput {
  seedDiff: string;
  seedFiles: readonly string[];
  gold: readonly string[];
}

/**
 * Leaks, in order: an import in a seed file that resolves to a gold file, a
 * gold path, a bare gold basename or specifier, and a gold identifier. The
 * bare mentions skip a basename a seed file shares (two `index.ts` files);
 * resolved imports never do.
 */
export function findGoldLeaks(
  input: LeakInput,
  goldIdentifiers: ReadonlySet<string>,
): string[] {
  const text = input.seedDiff;
  const seedStems = new Set(input.seedFiles.map((p) => stem(basename(p))));
  const leaks = resolvedImportLeaks(text, input.gold);
  for (const path of input.gold) leaks.push(...pathLeaks(text, path, seedStems));
  for (const id of extractIdentifiers(text)) {
    if (goldIdentifiers.has(id)) leaks.push(`identifier:${id}`);
  }
  return leaks;
}

function resolvedImportLeaks(seedDiff: string, gold: readonly string[]): string[] {
  const goldIds = new Set(gold);
  const out = new Set<string>();
  for (const [from, section] of diffSections(seedDiff)) {
    for (const spec of importSpecifiers(section)) {
      const target = resolveRelativeSpecifier(from, spec, goldIds);
      if (target !== null) out.add(`import:${target}`);
    }
  }
  return [...out];
}

/** The per-file sections of a unified diff, keyed by new path. */
export function diffSections(diff: string): Array<[path: string, section: string]> {
  return diff.split(/^(?=diff --git )/m).flatMap((section) => {
    const path = /^diff --git a\/\S+ b\/(\S+)/.exec(section)?.[1];
    return path ? [[path, section] as [string, string]] : [];
  });
}

/** Relative specifiers, including template-literal dynamic imports. */
function importSpecifiers(source: string): string[] {
  const templated = [...source.matchAll(/(?:import|require)\s*\(\s*`(\.[^`$]*)`/g)];
  return [...extractRelativeSpecifiers(source), ...templated.map((m) => m[1]!)];
}

function pathLeaks(text: string, path: string, seedStems: ReadonlySet<string>): string[] {
  const name = basename(path);
  const s = stem(name);
  const leaks = text.includes(path) ? [`path:${path}`] : [];
  if (seedStems.has(s)) return leaks;
  if (text.includes(name)) leaks.push(`basename:${name}`);
  if (specifierPattern(s).test(text)) leaks.push(`specifier:${s}`);
  return leaks;
}

function specifierPattern(fileStem: string): RegExp {
  const escaped = fileStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`/]${escaped}(\\.[cm]?[jt]sx?)?["'\`]`);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Basename without its last extension, so `user.service.ts` keeps `user.service`. */
function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}
