const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

/**
 * Embed a batch of texts via Workers AI. Returns the raw vectors in the same
 * order as the inputs. Throws on any provider error so callers can decide
 * whether to retry or defer.
 */
export async function embedTexts(env: any, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  const data = response?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error("Embedding model returned an unexpected response shape.");
  }
  return data as number[][];
}

export async function embedQuery(env: any, query: string): Promise<number[]> {
  const [vector] = await embedTexts(env, [query]);
  if (!vector) {
    throw new Error("Embedding model returned no vector for query.");
  }
  return vector;
}
