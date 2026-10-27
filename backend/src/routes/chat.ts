import { Hono } from "hono";
import { streamSSE } from 'hono/streaming';
import { orchestrateAiWithTools } from "../services/ai";
import {
  buildAiCacheKey,
  cacheChatMessage,
  getCachedAiResponse,
  getChatContext,
  incrementRateLimit,
  setActiveSession,
  setCachedAiResponse
} from "../services/redis";
import { getUserSettings } from "../services/settings";
import { deleteDocument } from "../services/vectorize/store";

function stripAttachedPdfContext(text: string): string {
  const marker = "\n\nAttached PDF context:\n";
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  return text.slice(0, idx).trim();
}

export const chatRoute = (app: Hono) => {
  app.post("/chat", async (c: any) => {
    // The global JWT middleware verifies the token and populates jwtPayload
    const payload = c.get('jwtPayload');
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }
    
    const userId = payload.id;
    const body = await c.req.json();
    const prompt = stripAttachedPdfContext(String(body.message || "").trim());
    if (!prompt) {
      return c.json({ error: "Message is required" }, 400);
    }

    const userSettings = await getUserSettings(c.env, userId);
    let aiCacheKey: string | null = null;
    let cachedAiResponse: string | null = null;

    if (userSettings.useRedis) {
      const rateCount = await incrementRateLimit(c.env, userId, 60);
      if (rateCount !== null && rateCount > 20) {
        return c.json({ error: "Rate limit exceeded. Please wait and try again." }, 429);
      }

      aiCacheKey = await buildAiCacheKey(userId, prompt);
      cachedAiResponse = await getCachedAiResponse(c.env, aiCacheKey);
    }

    let chatId = body.chatId;

    try {
      // Create new chat if none provided
      let isNewChat = false;
      if (!chatId) {
        isNewChat = true;
        chatId = crypto.randomUUID();
        const title = body.message.slice(0, 32) + (body.message.length > 32 ? "..." : "");
        await c.env.flare_gpt.prepare(
          "INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)"
        ).bind(chatId, userId, title).run();
      }

      // Fetch recent messages for context
      let recentMessages: Array<{ role: string; content: string }> = [];

      const cachedContext = userSettings.useRedis ? await getChatContext(c.env, chatId, 10) : null;
      if (cachedContext && cachedContext.length > 0) {
        recentMessages = cachedContext.map((item) => ({
          role: item.role,
          content: stripAttachedPdfContext(item.content)
        }));
      } else {
        const { results } = await c.env.flare_gpt.prepare(
          "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 10"
        ).bind(chatId).all();
        recentMessages = (results as Array<{ role: string; content: string }>)
          .reverse()
          .map((item) => ({
            role: item.role,
            content: stripAttachedPdfContext(item.content)
          }));
      }

      // Insert current user message after context snapshot
      const userMessageId = crypto.randomUUID();
      await c.env.flare_gpt.prepare(
        "INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, ?, ?)"
      ).bind(userMessageId, chatId, "user", prompt).run();

      if (userSettings.useRedis) {
        await cacheChatMessage(c.env, chatId, "user", prompt);
        await setActiveSession(c.env, userId, chatId);
      }

      if (cachedAiResponse) {
        const aiMessageId = crypto.randomUUID();
        await c.env.flare_gpt.prepare(
          "INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, ?, ?)"
        ).bind(aiMessageId, chatId, "assistant", cachedAiResponse).run();
        if (userSettings.useRedis) {
          await cacheChatMessage(c.env, chatId, "assistant", cachedAiResponse);
        }

        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            data: JSON.stringify({ text: cachedAiResponse, chatId }),
            event: "message"
          });
          await stream.writeSSE({ data: "[DONE]" });
        });
      }

      // Return a streaming response (single chunk after tool orchestration)
      return streamSSE(c, async (stream) => {
        try {
          const aiResult = await orchestrateAiWithTools(c.env, {
            userId,
            chatId,
            userPrompt: prompt,
            recentMessages: recentMessages as Array<{ role: "user" | "assistant"; content: string }>,
            settings: userSettings
          });
          const fullReply = aiResult.text;
          console.log("AI tools used:", aiResult.toolsUsed.map((t) => t.name));
          await stream.writeSSE({
            data: JSON.stringify({ text: fullReply, chatId, toolsUsed: aiResult.toolsUsed }),
            event: "message"
          });

          // Save AI message to DB after stream completes
          const aiMessageId = crypto.randomUUID();
          await c.env.flare_gpt.prepare(
            "INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, ?, ?)"
          ).bind(aiMessageId, chatId, "assistant", fullReply).run();
          if (userSettings.useRedis) {
            await cacheChatMessage(c.env, chatId, "assistant", fullReply);
            if (aiCacheKey) {
              await setCachedAiResponse(c.env, aiCacheKey, fullReply, 1800);
            }
          }

          await stream.writeSSE({ data: "[DONE]" });
        } catch (err: any) {
          console.error("Streaming error:", err);
          await stream.writeSSE({ 
            data: JSON.stringify({ error: "AI failed to respond: " + err.message }),
            event: 'error'
          });
        }
      });
    } catch (e) {
      console.error("Chat error:", e);
      return c.json({ error: "Failed to process chat" }, 500);
    }
  });

  /** Create an empty chat so uploads can bind vectors to a real conversation id. */
  app.post("/chats", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }

    const userId = payload.id;
    let title = "New chat";
    try {
      const body = await c.req.json().catch(() => ({}));
      const raw = typeof body?.title === "string" ? body.title.trim() : "";
      if (raw) title = raw.slice(0, 64);
    } catch {
      // keep default title
    }

    const chatId = crypto.randomUUID();
    try {
      await c.env.flare_gpt
        .prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)")
        .bind(chatId, userId, title)
        .run();

      return c.json({
        status: "success",
        data: { id: chatId, title }
      });
    } catch (e) {
      console.error("Failed to create chat:", e);
      return c.json({ error: "Failed to create chat" }, 500);
    }
  });

  app.get("/history", async (c: any) => {
    const payload = c.get('jwtPayload');
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }
    
    const userId = payload.id;
    
    try {
      // Fetch only the chats belonging to the logged-in user
      const { results } = await c.env.flare_gpt.prepare(
        "SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC"
      ).bind(userId).all();

      return c.json({
        status: "success",
        data: results
      });
    } catch (e) {
      return c.json({ error: "Failed to fetch history" }, 500);
    }
  });

  app.get("/history/:chatId", async (c: any) => {
    const payload = c.get('jwtPayload');
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }
    const userId = payload.id;
    const chatId = c.req.param("chatId");
    
    try {
      // Verify chat belongs to user
      const chat = await c.env.flare_gpt.prepare(
        "SELECT id FROM chats WHERE id = ? AND user_id = ?"
      ).bind(chatId, userId).first();
      
      if (!chat) {
        return c.json({ error: "Chat not found or unauthorized" }, 404);
      }

      // Fetch messages
      const { results } = await c.env.flare_gpt.prepare(
        "SELECT id, role, content as text, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC"
      ).bind(chatId).all();

      return c.json({
        status: "success",
        data: results
      });
    } catch (e) {
      return c.json({ error: "Failed to fetch messages" }, 500);
    }
  });

  app.patch("/history/:chatId", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }
    const userId = payload.id;
    const chatId = c.req.param("chatId");

    let title = "";
    try {
      const body = await c.req.json();
      title = typeof body?.title === "string" ? body.title.trim() : "";
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }
    title = title.slice(0, 64);

    try {
      const chat = await c.env.flare_gpt
        .prepare("SELECT id FROM chats WHERE id = ? AND user_id = ?")
        .bind(chatId, userId)
        .first();

      if (!chat) {
        return c.json({ error: "Chat not found or unauthorized" }, 404);
      }

      await c.env.flare_gpt
        .prepare("UPDATE chats SET title = ? WHERE id = ? AND user_id = ?")
        .bind(title, chatId, userId)
        .run();

      return c.json({
        status: "success",
        data: { id: chatId, title }
      });
    } catch (e) {
      console.error("Failed to rename chat:", e);
      return c.json({ error: "Failed to rename chat" }, 500);
    }
  });

  app.delete("/history/:chatId", async (c: any) => {
    const payload = c.get('jwtPayload');
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }
    const userId = payload.id;
    const chatId = c.req.param("chatId");
    
    try {
      // Verify chat belongs to user
      const chat = await c.env.flare_gpt.prepare(
        "SELECT id FROM chats WHERE id = ? AND user_id = ?"
      ).bind(chatId, userId).first();
      
      if (!chat) {
        return c.json({ error: "Chat not found or unauthorized" }, 404);
      }

      // Documents FK-reference chats — remove them (and best-effort vectors/R2) first
      // or DELETE chats fails when the conversation has uploads.
      const { results: docs } = await c.env.flare_gpt
        .prepare(
          `SELECT id, file_url, total_chunks
             FROM documents
            WHERE chat_id = ? AND user_id = ?`
        )
        .bind(chatId, userId)
        .all();

      for (const doc of docs ?? []) {
        try {
          await deleteDocument(c.env, doc.id, Number(doc.total_chunks) || 0);
        } catch (err) {
          console.error("Failed to delete document vectors", { id: doc.id, err });
        }
        if (doc.file_url && c.env.DOCUMENTS_R2) {
          try {
            await c.env.DOCUMENTS_R2.delete(doc.file_url);
          } catch (err) {
            console.error("Failed to delete R2 object", { key: doc.file_url, err });
          }
        }
      }

      await c.env.flare_gpt
        .prepare("DELETE FROM documents WHERE chat_id = ? AND user_id = ?")
        .bind(chatId, userId)
        .run();
      await c.env.flare_gpt.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
      await c.env.flare_gpt
        .prepare("DELETE FROM chats WHERE id = ? AND user_id = ?")
        .bind(chatId, userId)
        .run();

      return c.json({ status: "success" });
    } catch (e: any) {
      console.error("Failed to delete chat:", e);
      return c.json(
        { error: e?.message ? `Failed to delete chat: ${e.message}` : "Failed to delete chat" },
        500
      );
    }
  });
};