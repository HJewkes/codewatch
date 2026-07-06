import type { DeepAst } from "@codewatch/graph";
import type {
  BundleEdge,
  BundleEdges,
  ContextBundle,
  SourceChunk,
} from "../commands/graph-context-bundle.js";

/**
 * C-81 — the **stable library-level read API contract**. Consumers (an MCP
 * server, an ingestor, a coding agent) pin THIS interface + {@link READ_API_VERSION},
 * never the raw sqlite schema — so an `INDEX_VERSION` bump that reshapes the
 * tables leaves them unbroken as long as this projection is preserved.
 *
 * Versioning is semver: the MAJOR is the compatibility promise (a breaking
 * change to any function signature or record shape bumps it); MINOR adds
 * fields/functions backward-compatibly; PATCH is non-behavioural. Consumers
 * assert `major(api.version) === expected`.
 */
export const READ_API_VERSION = "1.1.0";

export type {
  ContextBundle,
  BundleEdge,
  BundleEdges,
  SourceChunk,
  DeepAst,
};

export interface ReadApiOptions {
  /** Path to the graph.db snapshot store. */
  db: string;
  /** Repo root for source + deep-AST reads; defaults to the git toplevel of cwd. */
  repoRoot?: string | null;
  /** Snapshot id to read; defaults to the latest. */
  snapshot?: number;
}

export interface GetContextOptions {
  /** Compute deep AST (class members, param/return types) on-pull. */
  includeDeepAst?: boolean;
}

/** The C-80 bundle, optionally extended with on-pull deep AST (C-81). */
export type ContextRecord = ContextBundle & { deepAst?: DeepAst | null };

export interface SearchHit {
  id: string;
  kind: string;
  name: string;
  /** Owning file id (a symbol's declaring file, or the file itself). */
  path: string;
  score: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
}

/**
 * A deterministic pull surface over one snapshot. Every method resolves a
 * `target` string — a file id, a `<file>#<symbol>` id, or a unique path suffix.
 * The graph is read; the working-tree source is read only for `getSource` /
 * `getContext` / deep AST. Nothing else touches the disk.
 */
export interface GraphReadApi {
  readonly version: string;
  getContext(target: string, opts?: GetContextOptions): ContextRecord;
  getSource(target: string): SourceChunk;
  getNeighbors(target: string): BundleEdges;
  search(query: string, limit?: number): SearchResult;
  close(): void;
}
