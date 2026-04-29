export type ChunkRecord = {
  index: number;
  text: string;
};

export type IndexDocumentInput = {
  userId: string;
  chatId: string | null;
  documentId: string;
  fileName: string;
  fileType: string;
  data: ArrayBuffer;
};

export type IndexDocumentResult = {
  status: "completed" | "deferred" | "skipped";
  totalChunks: number;
  indexedChunks: number;
  reason?: string | null;
  /**
   * Mutation IDs returned by each upsert batch. Vectorize is eventually
   * consistent - callers can compare these against `processedUpToMutation` from
   * `wrangler vectorize info` to verify the data is queryable.
   */
  mutationIds: string[];
};

export type VectorMatch = {
  id: string;
  score: number;
  text: string;
  fileName: string;
  documentId: string | null;
  chatId: string | null;
};

export type SearchOptions = {
  userId: string;
  /** Active chat UUID, or omit / null — combined with normalization so it matches vectors stored under "none". */
  chatId: string | null;
  query: string;
  topK?: number;
};
