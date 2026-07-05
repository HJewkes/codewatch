/**
 * C-82 retrieval suite — shared task/suite/score types.
 *
 * The retrieval suite is the second graph-as-oracle bench (beside the
 * comprehension oracle). It asks the question CCE / embedding-RAG systems are
 * built to answer — "given a query about a file, which files are relevant?" —
 * and grades it against the resolved dependency graph as ground truth. The
 * relevant set for a file is its true dependency NEIGHBOURS (resolved imports +
 * references, undirected, externals dropped); an arm proposes a RANKED candidate
 * list and we score how far up the true neighbours land.
 *
 * This is the productionised form of the C-76 crux (cosine-vs-resolved-edges):
 * an embedding arm ranks by similarity, a codewatch arm returns resolved edges.
 * Stratifying each neighbour by discoverability (see `stratify.ts`) is the point
 * — codewatch's lift should concentrate on `structurally-hidden` neighbours
 * (barrel / re-export links a name-grep or embedding can't follow).
 */

import type { Stratum } from "./types.js";

/** One relevant neighbour of the query file, tagged with how hard it is to find. */
export interface RelevantNeighbour {
  /** File id of the neighbour. */
  fileId: string;
  /** Cheapest discoverability stratum of the edge(s) linking query ↔ neighbour. */
  stratum: Stratum;
}

/** A single retrieval task: rank candidates for one query file. */
export interface RetrievalTask {
  /** Stable id: `retrieval::<queryFileId>`. */
  id: string;
  /** The file the query is about. */
  queryFileId: string;
  /** Natural-language prompt handed to an arm (never the ground truth). */
  question: string;
  /** The true dependency neighbours (the graph-derived relevant set). */
  relevant: RelevantNeighbour[];
}

export interface RetrievalSuite {
  source: {
    snapshotId: number;
    ref: string;
    commitHash: string | null;
    indexVersion: string;
  };
  params: { cap: number; defaultK: number };
  counts: {
    total: number;
    /** Relevant neighbour count summed over tasks, split by stratum. */
    relevantByStratum: Record<Stratum, number>;
  };
  tasks: RetrievalTask[];
}

/** Retrieval quality of one ranked candidate list against a task. */
export interface RetrievalScore {
  k: number;
  precisionAtK: number;
  recallAtK: number;
  /** Reciprocal rank of the first relevant hit (0 when none in the ranking). */
  reciprocalRank: number;
  /** Relevant hits found within the top-k. */
  hits: number;
  relevant: number;
  /** Recall@k restricted to each stratum (undefined strata omitted). */
  recallByStratum: Partial<Record<Stratum, number>>;
}
