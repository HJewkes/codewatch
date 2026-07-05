import { parseSymbolId } from "@codewatch/graph";
import type { Stratum } from "./types.js";

/**
 * Dependency-discoverability stratification (C-82), the CodeCompass idea applied
 * to codewatch's `references` edges. Each edge is `importer → <originFile>#name`
 * and carries the original import `specifier` text. We ask: what is the CHEAPEST
 * way an agent *without* the resolved graph could discover this dependency?
 *
 *  - `semantic-findable` — the symbol name shares a token with its origin file's
 *    basename, so a plain name-grep lands on the origin. The graph adds little.
 *  - `import-chain-reachable` — no name hint, but the source's own import
 *    specifier resolves *directly* to the origin file: follow the import path.
 *  - `structurally-hidden` — the specifier resolves to a DIFFERENT file (a
 *    barrel / re-export) or does not resolve at all, and no name hint exists.
 *    Only the resolved graph links importer → true origin. codewatch's edge.
 *
 * Honest limits (documented in the design note): the name-token test is a proxy
 * for "grep would find it" — it over-counts on generic tokens and misses
 * synonyms; the specifier resolver is a lightweight posix walk, so an
 * extensionless/tsconfig-path import that it fails to resolve is bucketed
 * `structurally-hidden` even though a human could sometimes follow it.
 */

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];
const INDEX_BASES = EXTENSIONS.slice(1).map((e) => `/index${e}`);
/** Trailing module extension to strip so a TS ESM `./x.js` specifier maps to `x.ts`. */
const TRAILING_EXT_RE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/;

/** Minimal reference-edge shape the stratifier reads. */
export interface RefEdge {
  srcId: string;
  dstId: string;
  specifier: string;
}

/** Split an identifier/path segment into lowercase tokens of length ≥ 3. */
export function splitTokens(text: string): Set<string> {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ");
  const out = new Set<string>();
  for (const raw of spaced.split(" ")) {
    const t = raw.toLowerCase();
    if (t.length >= 3) out.add(t);
  }
  return out;
}

function baseName(fileId: string): string {
  const slash = fileId.lastIndexOf("/");
  const name = slash < 0 ? fileId : fileId.slice(slash + 1);
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/** True when the symbol name and its origin file basename share a token. */
export function shareNameToken(symbolName: string, originFileId: string): boolean {
  const fileTokens = splitTokens(baseName(originFileId));
  for (const t of splitTokens(symbolName)) if (fileTokens.has(t)) return true;
  return false;
}

/** Normalize a posix path, collapsing `.`/`..` segments. */
function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Resolve a *relative* import specifier against the importer's file id to a
 * known file id, trying extensions and `/index.*`. Returns null for bare
 * (package/workspace) specifiers or when nothing matches.
 */
export function resolveRelativeSpecifier(
  srcFileId: string,
  specifier: string,
  fileIds: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const dir = srcFileId.includes("/")
    ? srcFileId.slice(0, srcFileId.lastIndexOf("/"))
    : "";
  const stem = normalizePosix(`${dir}/${specifier}`).replace(TRAILING_EXT_RE, "");
  for (const ext of EXTENSIONS) if (fileIds.has(stem + ext)) return stem + ext;
  for (const idx of INDEX_BASES) if (fileIds.has(stem + idx)) return stem + idx;
  return null;
}

/** Classify a single reference edge into its discoverability stratum. */
export function classifyReferenceEdge(
  edge: RefEdge,
  fileIds: ReadonlySet<string>,
): Stratum {
  const origin = parseSymbolId(edge.dstId)?.fileId ?? edge.dstId;
  const symbolName = parseSymbolId(edge.dstId)?.name ?? "";
  if (shareNameToken(symbolName, origin)) return "semantic-findable";
  const resolved = resolveRelativeSpecifier(edge.srcId, edge.specifier, fileIds);
  if (resolved !== null && resolved === origin) return "import-chain-reachable";
  return "structurally-hidden";
}

const HARDNESS: Record<Stratum, number> = {
  "semantic-findable": 0,
  "import-chain-reachable": 1,
  "structurally-hidden": 2,
};

/**
 * The stratum of a *task* built from several edges: the plurality (modal)
 * stratum of its edges, ties broken toward the harder stratum so a task is never
 * flattered. Empty input defaults to `structurally-hidden` (a graph-only answer
 * with no discoverable edges, e.g. a computed ranking).
 */
export function dominantStratum(strata: readonly Stratum[]): Stratum {
  if (strata.length === 0) return "structurally-hidden";
  const counts = new Map<Stratum, number>();
  for (const s of strata) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: Stratum = "semantic-findable";
  let bestCount = -1;
  for (const [s, c] of counts) {
    if (c > bestCount || (c === bestCount && HARDNESS[s] > HARDNESS[best])) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}
