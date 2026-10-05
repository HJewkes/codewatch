import { extractRelativeSpecifiers } from "./coding-mine.js";
import { resolveRelativeSpecifier } from "./stratify.js";

/**
 * Graph-free reachability: a breadth-first walk over relative imports in raw
 * source text, starting at the test files. Hop is the walk depth: a test file
 * is hop 0, a file a test imports directly is hop 1. No indexer is involved;
 * the caller supplies file contents through `read`, one batch per hop level.
 */

/** Contents of the requested files; a path missing from the result reads as "". */
export type SourceReader = (paths: readonly string[]) => ReadonlyMap<string, string>;

/** Hop depth of every file the tests reach through relative imports. */
export function importHops(
  roots: readonly string[],
  fileIds: ReadonlySet<string>,
  read: SourceReader,
): Map<string, number> {
  const hops = new Map<string, number>(roots.map((r) => [r, 0]));
  let frontier = [...hops.keys()];
  for (let depth = 1; frontier.length > 0; depth++) {
    const sources = read(frontier);
    const next: string[] = [];
    for (const file of frontier) {
      for (const target of resolvedImports(file, sources.get(file) ?? "", fileIds)) {
        if (hops.has(target)) continue;
        hops.set(target, depth);
        next.push(target);
      }
    }
    frontier = next;
  }
  return hops;
}

function resolvedImports(
  file: string,
  source: string,
  fileIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const spec of extractRelativeSpecifiers(source)) {
    const resolved = resolveRelativeSpecifier(file, spec, fileIds);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}

/** Hop depth per edit file; null when no test reaches it. */
export function editFileHops(
  editFiles: readonly string[],
  hops: ReadonlyMap<string, number>,
): Record<string, number | null> {
  return Object.fromEntries(editFiles.map((f) => [f, hops.get(f) ?? null]));
}
