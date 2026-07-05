import type { Stratum } from "./types.js";
import type { RetrievalScore, RetrievalTask } from "./retrieval-types.js";

/**
 * C-82 retrieval grader — pure scoring of a ranked candidate list against a
 * task's graph-derived relevant set. No I/O, no graph access: any arm (embedding
 * cosine ranking, resolved edges, brain) produces a ranked `string[]` of file ids
 * and is scored uniformly. The stratified recall is the load-bearing number —
 * it isolates codewatch's lift on `structurally-hidden` neighbours.
 */

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** De-duplicated top-k of a ranking, order preserved. */
function topK(ranked: readonly string[], k: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranked) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= k) break;
  }
  return out;
}

function recallByStratum(
  relevant: RetrievalTask["relevant"],
  found: ReadonlySet<string>,
): Partial<Record<Stratum, number>> {
  const total = new Map<Stratum, number>();
  const hit = new Map<Stratum, number>();
  for (const n of relevant) {
    total.set(n.stratum, (total.get(n.stratum) ?? 0) + 1);
    if (found.has(n.fileId)) hit.set(n.stratum, (hit.get(n.stratum) ?? 0) + 1);
  }
  const out: Partial<Record<Stratum, number>> = {};
  for (const [stratum, count] of total) out[stratum] = ratio(hit.get(stratum) ?? 0, count);
  return out;
}

/** First 1-based rank at which any relevant id appears; 0 when none appear. */
function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  const seen = new Set<string>();
  let rank = 0;
  for (const id of ranked) {
    if (seen.has(id)) continue;
    seen.add(id);
    rank++;
    if (relevant.has(id)) return 1 / rank;
  }
  return 0;
}

/** Score a ranked candidate list against a retrieval task at cutoff `k`. */
export function gradeRetrieval(
  task: RetrievalTask,
  ranked: readonly string[],
  k: number,
): RetrievalScore {
  const relevantSet = new Set(task.relevant.map((n) => n.fileId));
  const top = topK(ranked, k);
  const found = new Set(top.filter((id) => relevantSet.has(id)));
  return {
    k,
    precisionAtK: ratio(found.size, Math.min(k, top.length) || k),
    recallAtK: ratio(found.size, relevantSet.size),
    reciprocalRank: reciprocalRank(ranked, relevantSet),
    hits: found.size,
    relevant: relevantSet.size,
    recallByStratum: recallByStratum(task.relevant, found),
  };
}
