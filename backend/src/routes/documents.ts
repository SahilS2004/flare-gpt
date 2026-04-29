import { Hono } from "hono";

/**
 * Authenticated document download. Looks up the document in D1, checks owner,
 * then streams the body from R2. We intentionally never expose raw R2 keys to
 * the client - the {id} -> {objectKey} mapping stays server-side.
 *
 * Range requests are passed straight through so PDFs/videos can be ranged.
 */
export const documentsRoute = (app: Hono) => {
  app.get("/documents/:id", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const userId = payload.id;
    const documentId = c.req.param("id");

    const row = (await c.env.flare_gpt
      .prepare(
        `SELECT id, file_name, file_url FROM documents
          WHERE id = ? AND user_id = ?`
      )
      .bind(documentId, userId)
      .first()) as
      | { id: string; file_name: string; file_url: string }
      | null;

    if (!row || !row.file_url) {
      return c.json({ error: "Document not found" }, 404);
    }

    if (!c.env.DOCUMENTS_R2) {
      return c.json({ error: "R2 storage is not configured." }, 500);
    }

    const rangeHeader = c.req.header("range");
    const getOptions: R2GetOptions = {};
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (match) {
        const offset = match[1] ? parseInt(match[1], 10) : undefined;
        const endByte = match[2] ? parseInt(match[2], 10) : undefined;
        getOptions.range =
          offset != null && endByte != null
            ? { offset, length: endByte - offset + 1 }
            : offset != null
              ? { offset }
              : endByte != null
                ? { suffix: endByte }
                : undefined;
      }
    }

    const object = await c.env.DOCUMENTS_R2.get(row.file_url, getOptions);
    if (!object) {
      return c.json({ error: "Document file missing in storage" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(row.file_name)}"`
    );
    if (object.range) {
      headers.set(
        "Content-Range",
        `bytes ${object.range.offset}-${object.range.offset + (object.range.length ?? object.size) - 1}/${object.size}`
      );
    }

    return new Response(object.body, {
      status: rangeHeader ? 206 : 200,
      headers
    });
  });
};
