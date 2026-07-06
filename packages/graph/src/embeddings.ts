import { createHash } from "node:crypto";
import type { GraphDatabase } from "./database.js";

/**
 * C-88 — the semantic-capability layer: precomputed embeddings of each exported
 * symbol's `signature + purpose` text, serving a query-time "does a similar
 * capability already exist?" top-K surface for planning agents.
 *
 * Design constraints from the gating experiments (sources/c88-gating-experiments.md):
 * results are CANDIDATES, not duplicate verdicts (recall@1 is too low to assert);
 * no co-location filter (true duplicates are more often cross-directory); value
 * is coverage-gated on docstring presence, so coverage is always reported with
 * the candidates. The embedder is injected — this module never talks to a
 * network — and vectors are stored L2-normalized so similarity is a dot product.
 */

export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

/** A text-embedding backend; `model` keys the stored vectors. */
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface EmbeddableSymbol {
  id: string;
  name: string;
  file: string;
  signature: string;
  purpose?: string;
  text: string;
  textHash: string;
}

export interface EmbedCoverage {
  /** Embeddable exported symbols in the snapshot. */
  symbols: number;
  /** How many symbols have a stored vector for this model. */
  embedded: number;
  /** How many carry docstring purpose text (where recall is strongest). */
  withPurpose: number;
}

export interface EmbedSnapshotResult extends EmbedCoverage {
  model: string;
  /** Unique new texts sent to the embedder (symbols can share a text). */
  newlyEmbedded: number;
  /** Symbols whose vector was already stored (content-addressed cache hits). */
  reused: number;
}

export interface SimilarCandidate {
  id: string;
  name: string;
  file: string;
  signature: string;
  purpose?: string;
  /** Cosine similarity to the query, in [-1, 1]. */
  score: number;
}

export interface SimilarResult {
  query: string;
  model: string;
  coverage: EmbedCoverage;
  candidates: SimilarCandidate[];
}

/** Mirrors the gate harness: purpose text is appended to the signature when present. */
export function buildEmbedText(signature: string, purpose?: string | null): string {
  return purpose ? `${signature} -- ${purpose}` : signature;
}

export function hashEmbedText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const TEST_OR_FIXTURE_PATH = /\.test\.|\.spec\.|__tests__|\/fixtures\//;
const EXCLUDED_FILE_ROLES = new Set(["test", "generated"]);

/**
 * The embeddable corpus of a snapshot: exported symbols that carry a signature,
 * excluding test/fixture/generated code (matching the validated gate corpus).
 */
export function listEmbeddableSymbols(
  db: GraphDatabase,
  snapshotId: number,
): EmbeddableSymbol[] {
  const nodes = db.listNodes(snapshotId, { includeSymbols: true });
  const fileRoles = new Map<string, string | null>();
  for (const n of nodes) {
    if (n.kind === "file") fileRoles.set(n.id, n.role ?? null);
  }
  const out: EmbeddableSymbol[] = [];
  for (const n of nodes) {
    if (n.kind !== "symbol") continue;
    const attrs = (n.attrs ?? {}) as {
      exported?: boolean;
      signature?: string;
      purpose?: string;
    };
    if (attrs.exported !== true || !attrs.signature) continue;
    const file = n.parentId ?? n.id.split("#")[0] ?? n.id;
    if (TEST_OR_FIXTURE_PATH.test(file)) continue;
    const role = fileRoles.get(file);
    if (role && EXCLUDED_FILE_ROLES.has(role)) continue;
    const text = buildEmbedText(attrs.signature, attrs.purpose);
    out.push({
      id: n.id,
      name: n.name,
      file,
      signature: attrs.signature,
      purpose: attrs.purpose,
      text,
      textHash: hashEmbedText(text),
    });
  }
  return out;
}

function loadVectorsByHash(
  db: GraphDatabase,
  model: string,
  hashes: readonly string[],
): Map<string, Float32Array> {
  const stmt = db.raw.prepare(
    "SELECT text_hash, vector FROM embedding WHERE model = ? AND text_hash = ?",
  );
  const found = new Map<string, Float32Array>();
  for (const hash of new Set(hashes)) {
    const row = stmt.get(model, hash) as
      | { text_hash: string; vector: Buffer }
      | undefined;
    if (row) found.set(row.text_hash, bufferToVector(row.vector));
  }
  return found;
}

function storeVectors(
  db: GraphDatabase,
  model: string,
  rows: ReadonlyArray<{ textHash: string; vector: Float32Array }>,
): void {
  const stmt = db.raw.prepare(
    "INSERT OR IGNORE INTO embedding (model, text_hash, dims, vector) VALUES (?, ?, ?, ?)",
  );
  const tx = db.raw.transaction(() => {
    for (const r of rows) {
      stmt.run(model, r.textHash, r.vector.length, vectorToBuffer(r.vector));
    }
  });
  tx();
}

function bufferToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function vectorToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

const EMBED_BATCH_SIZE = 64;

/**
 * Precompute capability embeddings for a snapshot. Only texts whose hash has no
 * stored vector are sent to the embedder, so re-runs and unchanged symbols cost
 * nothing — the content-addressed store is the incremental-reuse mechanism.
 */
export async function embedSnapshot(
  db: GraphDatabase,
  snapshotId: number,
  embedder: Embedder,
): Promise<EmbedSnapshotResult> {
  const symbols = listEmbeddableSymbols(db, snapshotId);
  const existing = loadVectorsByHash(
    db,
    embedder.model,
    symbols.map((s) => s.textHash),
  );
  const missing = new Map<string, string>();
  for (const s of symbols) {
    if (!existing.has(s.textHash)) missing.set(s.textHash, s.text);
  }
  const pending = [...missing.entries()];
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedder.embed(batch.map(([, text]) => text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedder returned ${vectors.length} vectors for ${batch.length} texts`,
      );
    }
    storeVectors(
      db,
      embedder.model,
      batch.map(([textHash], j) => ({
        textHash,
        vector: l2Normalize(vectors[j]),
      })),
    );
  }
  return {
    model: embedder.model,
    symbols: symbols.length,
    withPurpose: symbols.filter((s) => s.purpose).length,
    embedded: symbols.length,
    newlyEmbedded: pending.length,
    reused: symbols.filter((s) => existing.has(s.textHash)).length,
  };
}

/**
 * The query-time "about to write X — does it exist?" surface. Embeds the query
 * (an intent sentence, a pseudo-signature, or both as `sig -- intent`), ranks
 * the snapshot's embedded symbols by cosine similarity, and returns the top-K
 * with coverage so the caller can weigh how much of the repo was searchable.
 */
export async function findSimilarCapability(
  db: GraphDatabase,
  snapshotId: number,
  query: string,
  embedder: Embedder,
  opts?: { limit?: number },
): Promise<SimilarResult> {
  const symbols = listEmbeddableSymbols(db, snapshotId);
  const vectors = loadVectorsByHash(
    db,
    embedder.model,
    symbols.map((s) => s.textHash),
  );
  if (vectors.size === 0) {
    throw new Error(
      `No capability embeddings stored for snapshot ${snapshotId} ` +
        `(model ${embedder.model}) — run \`codewatch graph embed\` first.`,
    );
  }
  const [rawQuery] = await embedder.embed([query]);
  const queryVec = l2Normalize(rawQuery);
  const scored: SimilarCandidate[] = [];
  let covered = 0;
  for (const s of symbols) {
    const vec = vectors.get(s.textHash);
    if (!vec || vec.length !== queryVec.length) continue;
    covered++;
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i] * queryVec[i];
    scored.push({
      id: s.id,
      name: s.name,
      file: s.file,
      signature: s.signature,
      purpose: s.purpose,
      score: dot,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    query,
    model: embedder.model,
    coverage: {
      symbols: symbols.length,
      embedded: covered,
      withPurpose: symbols.filter((s) => s.purpose).length,
    },
    candidates: scored.slice(0, opts?.limit ?? 10),
  };
}
