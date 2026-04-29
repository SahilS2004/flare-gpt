/**
 * Normalized chat scope stored in Vectorize metadata and used for filters.
 * Must match everywhere we upsert and query (upload indexer + searchDocuments).
 */
export function vectorChatScope(chatId: string | null | undefined): string {
  const t = typeof chatId === "string" ? chatId.trim() : "";
  return t === "" ? "none" : t;
}
