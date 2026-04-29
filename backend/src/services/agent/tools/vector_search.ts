import { searchDocuments } from "../../vectorize";
import type { ToolDefinition } from "../types";

const MAX_TEXT_PER_MATCH = 600;

export const vectorSearchTool: ToolDefinition = {
  name: "vector_search",
  description:
    "Search documents the user uploaded **in this chat** (same user + chat only). Call this when the answer might live in uploaded files. Results are scoped automatically; you only provide the semantic query.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search query, derived from the user's intent. Be specific."
      },
      topK: {
        type: "number",
        description:
          "Number of top matches to return (1-8). Defaults to 5."
      }
    },
    required: ["query"]
  },
  handler: async (args, ctx) => {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      throw new Error("Missing required 'query' argument.");
    }

    const topK = Number(args?.topK);
    const matches = await searchDocuments(ctx.env, {
      userId: ctx.userId,
      chatId: ctx.chatId,
      query,
      topK: Number.isFinite(topK) ? topK : undefined
    });

    return {
      query,
      count: matches.length,
      scopedTo: { userId: ctx.userId, chatId: ctx.chatId },
      matches: matches.map((match) => ({
        id: match.id,
        score: Number(match.score?.toFixed(4) ?? 0),
        fileName: match.fileName,
        documentId: match.documentId,
        chatId: match.chatId,
        text:
          match.text.length > MAX_TEXT_PER_MATCH
            ? match.text.slice(0, MAX_TEXT_PER_MATCH) + "…"
            : match.text
      }))
    };
  }
};
