import { indexDocument } from "../vectorize";

/**
 * Payload enqueued by `routes/upload.ts` and consumed by the queue handler in
 * `src/index.ts`. Keep this small (Cloudflare Queues max message size is 128KB)
 * - never stash file data here, only the R2 coordinates.
 */
export type IndexingJobPayload = {
  documentId: string;
  userId: string;
  chatId: string | null;
  fileName: string;
  fileType: string;
  /** R2 object key inside the DOCUMENTS_R2 bucket. */
  objectKey: string;
  /** Producer-side timestamp (ms) for end-to-end latency tracking. */
  enqueuedAt: number;
};

/**
 * Schema version for the message body. Bump when payload changes incompatibly
 * so consumers can refuse messages they don't understand.
 */
const MESSAGE_VERSION = 2;

type EnqueuedMessage = {
  v: typeof MESSAGE_VERSION;
  payload: IndexingJobPayload;
};

/**
 * Producer entry point - enqueue an indexing job. Errors propagate to the
 * caller so the upload route can decide whether to fail the request.
 */
export async function enqueueIndexingJob(
  env: any,
  payload: IndexingJobPayload
): Promise<void> {
  if (!env.INDEXING_QUEUE) {
    throw new Error("INDEXING_QUEUE binding is not configured.");
  }
  const message: EnqueuedMessage = { v: MESSAGE_VERSION, payload };
  await env.INDEXING_QUEUE.send(message, {
    contentType: "json"
  });
}

/**
 * Consumer entry point - process one message. Throws on transient failures so
 * Cloudflare Queues will retry; on terminal failures (corrupt blob, missing
 * object, etc.) marks the D1 row 'failed' / 'skipped' and returns normally.
 */
export async function processIndexingJob(
  env: any,
  raw: unknown
): Promise<void> {
  const message = parseMessage(raw);
  if (!message) {
    console.error("Queue: rejecting unparseable message", { raw });
    return; // ack - DLQ won't help with garbage payloads.
  }

  const { payload } = message;
  const startedAt = Date.now();
  console.log("Queue: indexing job started", {
    documentId: payload.documentId,
    fileName: payload.fileName,
    fileType: payload.fileType,
    objectKey: payload.objectKey,
    enqueuedAt: payload.enqueuedAt
  });

  try {
    if (!env.DOCUMENTS_R2) {
      throw new Error("DOCUMENTS_R2 binding is not configured.");
    }

    const object = await env.DOCUMENTS_R2.get(payload.objectKey);
    if (!object) {
      throw new Error(`R2 object not found: ${payload.objectKey}`);
    }
    const data = await object.arrayBuffer();
    console.log("Queue: R2 object fetched", {
      documentId: payload.documentId,
      objectKey: payload.objectKey,
      bytes: data.byteLength
    });

    const result = await indexDocument(env, {
      userId: payload.userId,
      chatId: payload.chatId,
      documentId: payload.documentId,
      fileName: payload.fileName,
      fileType: payload.fileType,
      data
    });

    await env.flare_gpt
      .prepare(
        `UPDATE documents
           SET indexing_status = ?,
               indexed_chunks = ?,
               total_chunks = ?,
               indexing_error = ?,
               indexed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        result.status,
        result.indexedChunks,
        result.totalChunks,
        result.reason ?? null,
        payload.documentId
      )
      .run();

    console.log("Queue: indexing job completed", {
      documentId: payload.documentId,
      status: result.status,
      chunks: result.indexedChunks,
      mutationIds: result.mutationIds,
      latencyMs: Date.now() - startedAt,
      queueLatencyMs: startedAt - payload.enqueuedAt
    });
  } catch (error: any) {
    // Surface the failure to D1 so the UI can show it, then re-throw so the
    // queue retries this message (and ultimately routes it to the DLQ).
    await env.flare_gpt
      .prepare(
        `UPDATE documents
           SET indexing_status = 'failed',
               indexing_error = ?,
               indexed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(error?.message ?? "Indexing failed.", payload.documentId)
      .run()
      .catch((e: any) => console.error("Queue: failed to mark D1 row failed", e));

    console.error("Queue: indexing job failed", {
      documentId: payload.documentId,
      message: error?.message,
      stack: error?.stack
    });
    throw error;
  }
}

function parseMessage(raw: unknown): EnqueuedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<EnqueuedMessage>;
  if (candidate.v !== MESSAGE_VERSION) return null;
  const payload = candidate.payload;
  if (!payload || typeof payload !== "object") return null;
  if (
    !payload.documentId ||
    !payload.userId ||
    !payload.fileName ||
    !payload.objectKey
  ) {
    return null;
  }
  return { v: MESSAGE_VERSION, payload };
}
