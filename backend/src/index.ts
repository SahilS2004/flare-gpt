import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
import { chatRoute } from "./routes/chat";
import { authRoute } from "./routes/auth";
import { uploadRoute } from "./routes/upload";
import { profileRoute } from "./routes/profile";
import { sttRoute } from "./routes/stt";
import { settingsRoute } from "./routes/settings";
import { documentStatusRoute } from "./routes/document_status";
import { documentsRoute } from "./routes/documents";
import { processIndexingJob } from "./services/queue/indexer";
import { getSecret } from "./services/secrets";

const app = new Hono();

app.use('/*', cors());

app.use('/*', async (c, next) => {
  // Bypass JWT auth for these public routes
  if (
    c.req.path === '/' || 
    c.req.path === '/login' || 
    c.req.path === '/signup' || 
    c.req.path.startsWith('/auth/google')
  ) {
    return next();
  }

  const secret = (await getSecret(c.env, "JWT_SECRET")) || "fallback-secret";
  const jwtMiddleware = jwt({
    secret,
    alg: "HS256",
  });

  return jwtMiddleware(c, next);
});

app.onError((err, c) => {
  console.error(`Error: ${err.message}`, err);
  const status = (err as any).status || 500;
  return c.json({
    status: "error",
    message: err.message || "An unexpected error occurred",
    code: (err as any).code || "INTERNAL_SERVER_ERROR"
  }, status);
});

app.get("/", (c) => {
  return c.text("Health check: OK");
});
app.get("/users", async (c: any) => {
  const { results } = await c.env.flare_gpt
    .prepare("SELECT * FROM users")
    .all();

  return c.json(results);
});

chatRoute(app);
authRoute(app);
uploadRoute(app);
profileRoute(app);
sttRoute(app);
settingsRoute(app);
documentStatusRoute(app);
documentsRoute(app);

/**
 * Cloudflare Queues consumer. The platform invokes `queue` with a batch (up to
 * `max_batch_size` from wrangler.jsonc - currently 5). Per-message error
 * handling: throwing triggers a single-message retry; calling `message.retry()`
 * is equivalent. Messages that exceed `max_retries` (3) flow to the DLQ
 * (`flare-gpt-indexing-dlq`).
 */
async function handleQueueBatch(
  batch: MessageBatch<unknown>,
  env: any,
  ctx: ExecutionContext
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processIndexingJob(env, message.body);
      message.ack();
    } catch (error: any) {
      console.error("Queue: message will be retried", {
        id: message.id,
        attempts: (message as any).attempts,
        message: error?.message
      });
      message.retry();
    }
  }
}

export default {
  fetch: app.fetch.bind(app),
  queue: handleQueueBatch
};
