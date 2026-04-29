import { getChatContext } from "../../redis";
import type { ToolDefinition } from "../types";

export const redisMemoryLookupTool: ToolDefinition = {
  name: "redis_memory_lookup",
  description:
    "Read older messages from the current chat's Redis memory cache. Only call this when you genuinely need older context that is not already in the visible conversation.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of recent messages to fetch (1-20)."
      }
    }
  },
  handler: async (args, ctx) => {
    const limit = Math.max(1, Math.min(20, Number(args?.limit) || 10));
    const messages = await getChatContext(ctx.env, ctx.chatId, limit);
    return {
      enabled: true,
      count: messages?.length ?? 0,
      messages: messages ?? []
    };
  }
};
