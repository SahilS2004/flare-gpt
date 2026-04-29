import { Hono } from "hono";
import { verifyDocumentVectors } from "../services/vectorize";

/**
 * Lightweight polling endpoint for the frontend to track async indexing status.
 * Always scoped to the authenticated user so one user can never read another's
 * document state.
 *
 * Add `?verify=1` to also call `getByIds` against Vectorize and report the
 * actual number of vectors that landed for this document. Useful for diagnosing
 * cases where D1 says "completed" but the index hasn't caught up (or silently
 * dropped chunks).
 */
export const documentStatusRoute = (app: Hono) => {
  app.get("/document-status/:id", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const userId = payload.id;
    const documentId = c.req.param("id");
    const verify = c.req.query("verify") === "1";

    const row = (await c.env.flare_gpt
      .prepare(
        `SELECT id, file_name, indexing_status, indexed_chunks, total_chunks,
                indexing_error, indexed_at, created_at
           FROM documents
          WHERE id = ? AND user_id = ?`
      )
      .bind(documentId, userId)
      .first()) as
      | {
          id: string;
          file_name: string;
          indexing_status: string;
          indexed_chunks: number;
          total_chunks: number;
          indexing_error: string | null;
          indexed_at: string | null;
          created_at: string;
        }
      | null;

    if (!row) {
      return c.json({ error: "Document not found" }, 404);
    }

    let verification:
      | { found: number; expected: number; missingIds: string[] }
      | null = null;
    if (verify) {
      try {
        verification = await verifyDocumentVectors(
          c.env,
          row.id,
          row.total_chunks ?? 0
        );
      } catch (error: any) {
        verification = {
          found: -1,
          expected: row.total_chunks ?? 0,
          missingIds: [String(error?.message ?? "verify failed")]
        };
      }
    }

    return c.json({
      status: "success",
      data: {
        documentId: row.id,
        fileName: row.file_name,
        indexingStatus: row.indexing_status,
        indexedChunks: row.indexed_chunks ?? 0,
        totalChunks: row.total_chunks ?? 0,
        indexingError: row.indexing_error,
        indexedAt: row.indexed_at,
        createdAt: row.created_at,
        ...(verification ? { verification } : {})
      }
    });
  });
};
