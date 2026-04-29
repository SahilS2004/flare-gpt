import { chunkText } from "./chunker";
import { embedTexts } from "./embedder";
import { extractText } from "./extractor";
import { searchDocuments, upsertChunks } from "./store";
import type { IndexDocumentInput, IndexDocumentResult } from "./types";

const EMBED_BATCH_SIZE = 8;

/**
 * Ingest a document into Vectorize. Pipeline:
 *   extractText -> chunkText -> embedTexts (batched) -> upsertChunks
 *
 * Errors during embedding/upsert are caught: existing successful chunks remain
 * indexed and the result reports `deferred` so an upstream queue can retry.
 *
 * The returned `mutationIds` array can be matched against `processedUpToMutation`
 * (from `wrangler vectorize info` or the Vectorize info API) to verify that all
 * chunks have been processed by the eventually-consistent index.
 */
export async function indexDocument(
  env: any,
  input: IndexDocumentInput
): Promise<IndexDocumentResult> {
  const extraction = await extractText(input.data, input.fileName, input.fileType);
  if (!extraction.text || extraction.deferred) {
    return {
      status: extraction.deferred ? "deferred" : "skipped",
      totalChunks: 0,
      indexedChunks: 0,
      reason: extraction.reason ?? null,
      mutationIds: []
    };
  }

  const chunks = chunkText(extraction.text);
  if (chunks.length === 0) {
    return {
      status: "skipped",
      totalChunks: 0,
      indexedChunks: 0,
      reason: "Document produced no usable text chunks.",
      mutationIds: []
    };
  }

  const mutationIds: string[] = [];
  let indexedChunks = 0;
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await embedTexts(env, batch.map((chunk) => chunk.text));
      const upsertResult = await upsertChunks(env, {
        documentId: input.documentId,
        userId: input.userId,
        chatId: input.chatId,
        fileName: input.fileName,
        chunks: batch,
        vectors
      });
      indexedChunks += upsertResult.count;
      if (upsertResult.mutationId) {
        mutationIds.push(upsertResult.mutationId);
      }
    }
  } catch (error: any) {
    console.error("indexDocument: vectorization deferred", {
      documentId: input.documentId,
      indexedSoFar: indexedChunks,
      total: chunks.length,
      message: error?.message
    });
    return {
      status: "deferred",
      totalChunks: chunks.length,
      indexedChunks,
      reason: error?.message ?? "Vectorization failed.",
      mutationIds
    };
  }

  console.log("indexDocument: completed", {
    documentId: input.documentId,
    chunks: chunks.length,
    mutationIds
  });

  return {
    status: "completed",
    totalChunks: chunks.length,
    indexedChunks,
    reason: null,
    mutationIds
  };
}

export { searchDocuments, verifyDocumentVectors } from "./store";
export { vectorChatScope } from "./scope";
export type {
  IndexDocumentInput,
  IndexDocumentResult,
  VectorMatch,
  SearchOptions
} from "./types";
