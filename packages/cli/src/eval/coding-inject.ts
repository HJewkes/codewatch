import { parseSymbolId } from "@titan-design/code-graph";
import type { BundleEdge, ContextBundle } from "@titan-design/code-graph";
import type { CodingTask } from "./coding-types.js";

/**
 * C-93 S4: the injected-context builder for coding-bench arm AI. Seeds come from the task's
 * test patch only; `editFiles` and `goldDiff` are the oracle and must never shape the prompt.
 * Pure: the caller supplies `bundleFor` (wrapping `contextBundleFromDb`) and optional line lookup.
 */

/** The context bundle for one seed file, or null when the seed is not in the graph. */
export type BundleFor = (seed: string) => ContextBundle | null;

/** The 1-based start line of a graph node, when the index recorded one. */
export type LineOf = (nodeId: string) => number | undefined;

export interface InjectionOptions {
  maxCitations?: number;
  budgetTokens?: number;
  lineOf?: LineOf;
}

export interface Citation {
  path: string;
  /** Start line of the cited symbol; 1 for a whole-file neighbour. */
  line: number;
  /** The cited symbol's name, absent for a whole-file neighbour. */
  symbol?: string;
  kind: string;
  relevance: number;
}

export interface Injection {
  text: string;
  citations: Citation[];
  /** Token estimate of `text`; the arm report records this as the injected overhead. */
  estimatedTokens: number;
}

export const DEFAULT_MAX_CITATIONS = 20;
export const DEFAULT_BUDGET_TOKENS = 1500;

const HEADER =
  "Plan-time repo context from codewatch (graph neighbours of the failing tests; candidates, not verdicts):";
const FOOTER = "Read the source before treating any of these as the place to change.";
const EMPTY: Injection = { text: "", citations: [], estimatedTokens: 0 };

/** Coarse chars/4 estimate, the same order as the tokenizer for English and code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildInjection(
  task: CodingTask,
  bundleFor: BundleFor,
  opts: InjectionOptions = {},
): Injection {
  const seeds = [...new Set(task.testPatch.files)];
  const candidates = rankCitations(collectCitations(seeds, bundleFor, opts.lineOf ?? (() => undefined)));
  return fitToBudget(
    candidates.slice(0, opts.maxCitations ?? DEFAULT_MAX_CITATIONS),
    opts.budgetTokens ?? DEFAULT_BUDGET_TOKENS,
  );
}

export function injectPrompt(problemStatement: string, injection: Injection): string {
  if (!injection.text) return problemStatement;
  return `${injection.text}\n\n${problemStatement}`;
}

function collectCitations(seeds: readonly string[], bundleFor: BundleFor, lineOf: LineOf): Citation[] {
  const seedSet = new Set(seeds);
  const byNode = new Map<string, Citation>();
  for (const seed of seeds) {
    const bundle = bundleFor(seed);
    if (!bundle) continue;
    for (const e of [...bundle.edges.dependencies, ...bundle.edges.callers]) {
      const neighbour = neighbourOf(e, seed);
      if (isExternal(neighbour) || seedSet.has(fileOf(neighbour))) continue;
      const cited = toCitation(neighbour, e, lineOf);
      const seen = byNode.get(neighbour);
      if (!seen || cited.relevance > seen.relevance) byNode.set(neighbour, cited);
    }
  }
  return [...byNode.values()];
}

function neighbourOf(e: BundleEdge, seed: string): string {
  return fileOf(e.from) === seed ? e.to : e.from;
}

function fileOf(id: string): string {
  return parseSymbolId(id)?.fileId ?? id;
}

function isExternal(id: string): boolean {
  return id.startsWith("npm:") || id.startsWith("node:");
}

function toCitation(nodeId: string, e: BundleEdge, lineOf: LineOf): Citation {
  const parsed = parseSymbolId(nodeId);
  const citation: Citation = {
    path: parsed?.fileId ?? nodeId,
    line: lineOf(nodeId) ?? 1,
    kind: e.kind,
    relevance: e.relevance ?? 0,
  };
  if (parsed) citation.symbol = parsed.name;
  return citation;
}

function rankCitations(citations: Citation[]): Citation[] {
  return citations.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      a.path.localeCompare(b.path) ||
      (a.symbol ?? "").localeCompare(b.symbol ?? ""),
  );
}

/** Keep the longest ranked prefix whose rendered block fits the token budget. */
function fitToBudget(ranked: readonly Citation[], budgetTokens: number): Injection {
  let best = EMPTY;
  for (let n = 1; n <= ranked.length; n++) {
    const citations = ranked.slice(0, n);
    const text = renderInjection(citations);
    const estimatedTokens = estimateTokens(text);
    if (estimatedTokens > budgetTokens) break;
    best = { text, citations, estimatedTokens };
  }
  return best;
}

function renderInjection(citations: readonly Citation[]): string {
  return [HEADER, ...citations.map(renderCitation), FOOTER].join("\n");
}

function renderCitation(c: Citation): string {
  const symbol = c.symbol ? ` \`${c.symbol}\`` : "";
  return `- ${c.path}:${c.line}${symbol} (${c.kind})`;
}
