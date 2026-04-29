import { Hono } from "hono";
import { enqueueIndexingJob } from "../services/queue/indexer";

/**
 * Producer route. Steps:
 *   1. Stream binary into Cloudflare R2 (sync; user is waiting).
 *   2. Insert D1 row with indexing_status='pending'.
 *   3. Enqueue the indexing job and return.
 *
 * The slow work (text extraction, chunking, embedding, vectorize upsert) runs
 * asynchronously in the queue consumer (`src/services/queue/indexer.ts`), so
 * users get an instant response and large PDFs don't block the request.
 */
export const uploadRoute = (app: Hono) => {
  app.post("/upload-document", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const userId = payload.id;

    const body = await c.req.parseBody();
    const file = body["file"] as File;
    const chatId = (body["chatId"] as string) || null;

    if (!file) return c.json({ error: "No file provided" }, 400);

    if (!c.env.DOCUMENTS_R2) {
      return c.json({ error: "R2 storage is not configured." }, 500);
    }

    try {
      const arrayBuffer = await file.arrayBuffer();

      const documentId = crypto.randomUUID();
      const objectKey = `${userId}/${documentId}-${file.name}`;

      await c.env.DOCUMENTS_R2.put(objectKey, arrayBuffer, {
        httpMetadata: {
          contentType: file.type || "application/octet-stream"
        },
        customMetadata: {
          userId,
          documentId,
          fileName: file.name,
          chatId: chatId ?? "none"
        }
      });

      // We store the R2 object key in `file_url` (column kept for backwards
      // compatibility). Frontend should use the `/documents/:id` route to fetch
      // the file with auth, not this raw key.
      await c.env.flare_gpt
        .prepare(
          `INSERT INTO documents
             (id, user_id, chat_id, file_name, file_url, indexing_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        )
        .bind(documentId, userId, chatId, file.name, objectKey)
        .run();

      try {
        await enqueueIndexingJob(c.env, {
          documentId,
          userId,
          chatId,
          fileName: file.name,
          fileType: file.type,
          objectKey,
          enqueuedAt: Date.now()
        });
      } catch (queueError: any) {
        console.error("Failed to enqueue indexing job:", queueError);
        await c.env.flare_gpt
          .prepare(
            `UPDATE documents
               SET indexing_status = 'failed',
                   indexing_error = ?
             WHERE id = ?`
          )
          .bind(queueError?.message ?? "Failed to enqueue indexing job.", documentId)
          .run()
          .catch(() => undefined);

        return c.json(
          {
            status: "partial",
            data: {
              documentId,
              url: `/documents/${documentId}`,
              name: file.name,
              indexingStatus: "failed",
              indexingError:
                "Document was uploaded but could not be queued for indexing. Please retry later."
            }
          },
          202
        );
      }

      return c.json({
        status: "success",
        data: {
          documentId,
          url: `/documents/${documentId}`,
          name: file.name,
          indexingStatus: "pending"
        }
      });
    } catch (error: any) {
      console.error("Document upload failed:", error);
      return c.json(
        { error: "Document upload failed: " + error.message },
        500
      );
    }
  });
};
