import { DEFAULT_EMBEDDING_MODEL, type Embedder } from "@codewatch/graph";

const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaEmbedderOptions {
  baseUrl?: string;
  model?: string;
}

/**
 * C-88 — ollama-backed {@link Embedder} for the capability layer. Talks to the
 * local `/api/embed` endpoint (list input). Kept out of `@codewatch/graph` so
 * the graph package stays network-free; every consumer (embed/similar commands,
 * read API) wires this in — or a fake, in tests.
 */
export function createOllamaEmbedder(opts?: OllamaEmbedderOptions): Embedder {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts?.model ?? DEFAULT_EMBEDDING_MODEL;
  return {
    model,
    embed: (texts) => embed(baseUrl, model, texts),
  };
}

async function embed(
  baseUrl: string,
  model: string,
  texts: string[],
): Promise<Float32Array[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach ollama at ${baseUrl} — is it running with the ` +
        `"${model}" model pulled? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed error (${response.status}): ${body}`);
  }
  const data: unknown = await response.json();
  const embeddings = (data as { embeddings?: unknown })?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(
      `Unexpected ollama embed response shape: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return embeddings.map((v) => Float32Array.from(v as number[]));
}
