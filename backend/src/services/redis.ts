import { getSecret } from "./secrets";

type RedisPrimitive = string | number;

type ChatContextMessage = {
  role: "user" | "assistant";
  content: string;
};

async function resolveRedisConfig(env: any): Promise<{ url: string; token: string } | null> {
  const url = typeof env?.UPSTASH_REDIS_REST_URL === "string" ? env.UPSTASH_REDIS_REST_URL : "";
  const token = await getSecret(env, "UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

async function redisCommand<T = unknown>(env: any, command: RedisPrimitive[]): Promise<T | null> {
  const config = await resolveRedisConfig(env);
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Redis command failed (${response.status}): ${body}`);
  }

  const json = await response.json() as { result?: T; error?: string };
  if (json.error) throw new Error(json.error);
  return (json.result ?? null) as T | null;
}

function chatContextKey(chatId: string): string {
  return `chat:${chatId}:context`;
}

function sessionKey(userId: string): string {
  return `session:${userId}`;
}

function rateLimitKey(userId: string): string {
  return `rate:${userId}`;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildAiCacheKey(userId: string, prompt: string): Promise<string> {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 2000);
  const hash = await sha256(normalized);
  return `ai:${userId}:${hash}`;
}

export async function getCachedAiResponse(env: any, key: string): Promise<string | null> {
  try {
    const value = await redisCommand<string | null>(env, ["GET", key]);
    return value ?? null;
  } catch (error) {
    console.error("Redis GET cache failed:", error);
    return null;
  }
}

export async function setCachedAiResponse(env: any, key: string, answer: string, ttlSeconds = 1800): Promise<void> {
  try {
    await redisCommand(env, ["SET", key, answer, "EX", ttlSeconds]);
  } catch (error) {
    console.error("Redis SET cache failed:", error);
  }
}

export async function incrementRateLimit(env: any, userId: string, windowSeconds = 60): Promise<number | null> {
  try {
    const key = rateLimitKey(userId);
    const count = await redisCommand<number>(env, ["INCR", key]);
    if (count === 1) {
      await redisCommand(env, ["EXPIRE", key, windowSeconds]);
    }
    return count ?? null;
  } catch (error) {
    console.error("Redis rate limit update failed:", error);
    return null;
  }
}

export async function setActiveSession(env: any, userId: string, chatId: string, ttlSeconds = 86400): Promise<void> {
  try {
    await redisCommand(env, ["SET", sessionKey(userId), chatId, "EX", ttlSeconds]);
  } catch (error) {
    console.error("Redis active session set failed:", error);
  }
}

export async function setSessionStatus(env: any, userId: string, status = "active", ttlSeconds = 86400): Promise<void> {
  try {
    await redisCommand(env, ["SET", sessionKey(userId), status, "EX", ttlSeconds]);
  } catch (error) {
    console.error("Redis session status set failed:", error);
  }
}

export async function cacheChatMessage(
  env: any,
  chatId: string,
  role: "user" | "assistant",
  content: string,
  maxMessages = 10
): Promise<void> {
  try {
    const key = chatContextKey(chatId);
    const payload = JSON.stringify({ role, content });
    await redisCommand(env, ["LPUSH", key, payload]);
    await redisCommand(env, ["LTRIM", key, 0, maxMessages - 1]);
    await redisCommand(env, ["EXPIRE", key, 86400]);
  } catch (error) {
    console.error("Redis context cache write failed:", error);
  }
}

export async function getChatContext(env: any, chatId: string, limit = 10): Promise<ChatContextMessage[] | null> {
  try {
    const key = chatContextKey(chatId);
    const values = await redisCommand<string[]>(env, ["LRANGE", key, 0, limit - 1]);
    if (!values || values.length === 0) return null;

    const parsed = values
      .map((value) => {
        try {
          return JSON.parse(value) as ChatContextMessage;
        } catch {
          return null;
        }
      })
      .filter((item): item is ChatContextMessage => Boolean(item?.role && item?.content));

    // LPUSH keeps newest first; reverse to chronological order.
    return parsed.reverse();
  } catch (error) {
    console.error("Redis context cache read failed:", error);
    return null;
  }
}
