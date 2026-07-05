/**
 * C-81 — codewatch's stable, versioned read API. Import this module (not the
 * sqlite schema) to pull deterministic per-target context off a snapshot.
 */
export { createReadApi } from "./read-api.js";
export {
  READ_API_VERSION,
  type GraphReadApi,
  type ReadApiOptions,
  type GetContextOptions,
  type ContextRecord,
  type ContextBundle,
  type BundleEdge,
  type BundleEdges,
  type SourceChunk,
  type DeepAst,
  type SearchHit,
  type SearchResult,
} from "./contract.js";
