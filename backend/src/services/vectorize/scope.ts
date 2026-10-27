/**
 * Normalized chat scope stored in Vectorize metadata and used for filters.
 * Must match everywhere we upsert and query (upload indexer + searchDocuments).
 *
 * Empty / missing chat ids become `"none"`. New uploads must never use that
 * sentinel — searchDocuments refuses `"none"` so retrieval stays per-conversation.
 */
export function vectorChatScope(chatId: string | null | undefined): string {
  const t = typeof chatId === "string" ? chatId.trim() : "";
  return t === "" || t.startsWith("local-") ? "none" : t;
}
