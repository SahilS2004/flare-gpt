import { embedQuery } from "./embedder";
import { vectorChatScope } from "./scope";
import type { ChunkRecord, SearchOptions, VectorMatch } from "./types";

type UpsertParams = {
  documentId: string;
  userId: string;
  chatId: string | null;
  fileName: string;
  chunks: ChunkRecord[];
  vectors: number[][];
};

type UpsertResult = {
  mutationId: string | null;
  count: number;
};

const DEFAULT_TOPK = 5;
const MAX_TOPK = 8;

/**
 * Persist a batch of chunk vectors to the Vectorize index. Each vector id is
 * deterministic (`<documentId>-chunk-<index>`) so re-uploading replaces in place.
 *
 * Returns the mutation id from Vectorize so callers can correlate logs with the
 * async indexing pipeline (vectors are eventually-consistent: see
 * `processedUpToMutation` in `wrangler vectorize info`).
 */
export async function upsertChunks(env: any, params: UpsertParams): Promise<UpsertResult> {
  if (params.chunks.length === 0) {
    return { mutationId: null, count: 0 };
  }

  const records = params.chunks.map((chunk, i) => ({
    id: `${params.documentId}-chunk-${chunk.index}`,
    values: params.vectors[i],
    metadata: {
      // Indexed metadata fields - only these can be used in `filter`. Strings are
      // truncated to the first 64B for filtering, so keep these short (UUIDs OK).
      userId: params.userId,
      chatId: vectorChatScope(params.chatId),
      // Non-indexed metadata - returned via returnMetadata: "all".
      documentId: params.documentId,
      fileName: params.fileName,
      text: chunk.text
    }
  }));

  let result: any;
  try {
    result = await env.VECTOR_INDEX.upsert(records);
  } catch (error: any) {
    console.error("Vectorize upsert failed", {
      documentId: params.documentId,
      count: records.length,
      message: error?.message,
      stack: error?.stack
    });
    throw error;
  }

  const mutationId = typeof result?.mutationId === "string" ? result.mutationId : null;
  console.log("Vectorize upsert", {
    documentId: params.documentId,
    count: records.length,
    mutationId,
    rawResult: result
  });
  if (!mutationId) {
    // Cloudflare Vectorize V2 always returns a mutationId for upsert. If we
    // got a falsy response, treat it as a failure so the queue retries.
    throw new Error(
      `Vectorize upsert returned no mutationId for document ${params.documentId}`
    );
  }
  return { mutationId, count: records.length };
}

/**
 * Verify how many of a document's expected chunk vectors actually landed in
 * the index. Uses `getByIds` (which doesn't require an indexed metadata field)
 * so it can be called even when `documentId` isn't a filterable column.
 *
 * Caller must pass `expectedChunks` (from D1's `total_chunks`). Returns
 * `{ found, expected, missingIds }` for diagnostics.
 */
export async function verifyDocumentVectors(
  env: any,
  documentId: string,
  expectedChunks: number
): Promise<{ found: number; expected: number; missingIds: string[] }> {
  const expected = Math.max(0, expectedChunks);
  if (expected === 0) {
    return { found: 0, expected: 0, missingIds: [] };
  }

  const ids: string[] = [];
  for (let i = 0; i < expected; i++) {
    ids.push(`${documentId}-chunk-${i}`);
  }

  const found = new Set<string>();
  // Vectorize V2 caps each `getByIds` call to 1000 ids; we batch defensively.
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const records: any[] = await env.VECTOR_INDEX.getByIds(batch);
    for (const record of records ?? []) {
      if (record?.id) found.add(String(record.id));
    }
  }

  const missingIds = ids.filter((id) => !found.has(id));
  return { found: found.size, expected, missingIds };
}

export async function deleteDocument(
  env: any,
  documentId: string,
  expectedChunks: number
): Promise<void> {
  if (expectedChunks <= 0) return;
  const ids: string[] = [];
  for (let i = 0; i < expectedChunks; i++) {
    ids.push(`${documentId}-chunk-${i}`);
  }
  try {
    const result = await env.VECTOR_INDEX.deleteByIds(ids);
    console.log("Vectorize deleteByIds", {
      documentId,
      count: ids.length,
      mutationId: result?.mutationId ?? null
    });
  } catch (error) {
    console.error("Vectorize deleteByIds failed:", error);
  }
}

/**
 * Search the index scoped to BOTH userId and chatId metadata (indexed fields).
 * chatId uses the same normalization as upserts (`none` when no chat was tied
 * to the upload).
 *
 * Filter syntax follows Vectorize V2 `$eq`.
 */
export async function searchDocuments(
  env: any,
  options: SearchOptions
): Promise<VectorMatch[]> {
  const query = options.query.trim();
  if (!query) return [];

  const topK = clampTopK(options.topK);
  const vector = await embedQuery(env, query);

  const chatScope = vectorChatScope(options.chatId ?? null);

  const filter: Record<string, unknown> = {
    userId: { $eq: options.userId },
    chatId: { $eq: chatScope }
  };

  const result = await env.VECTOR_INDEX.query(vector, {
    topK,
    filter,
    returnValues: false,
    returnMetadata: "all"
  });

  return (result?.matches ?? []).map((match: any) => ({
    id: String(match.id ?? ""),
    score: typeof match.score === "number" ? match.score : 0,
    text: String(match?.metadata?.text ?? ""),
    fileName: String(match?.metadata?.fileName ?? "unknown"),
    documentId: match?.metadata?.documentId ?? null,
    chatId: match?.metadata?.chatId && match.metadata.chatId !== "none"
      ? String(match.metadata.chatId)
      : null
  }));
}

function clampTopK(topK?: number): number {
  if (!Number.isFinite(topK) || !topK) return DEFAULT_TOPK;
  return Math.max(1, Math.min(MAX_TOPK, Math.floor(topK as number)));
}
