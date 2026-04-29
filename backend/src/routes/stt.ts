import { Hono } from "hono";

export const sttRoute = (app: Hono) => {
  app.post("/transcribe", async (c: any) => {
    // Check for authorization (relying on the global middleware)
    const payload = c.get('jwtPayload');
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }

    try {
      // The audio should be sent as a multipart file or direct binary
      // Here we assume multipart with field name 'audio'
      const body = await c.req.parseBody();
      const audioFile = body.audio;

      if (!audioFile || !(audioFile instanceof File)) {
        return c.json({ error: "No audio file provided. Please send a multipart form with an 'audio' file." }, 400);
      }

      const blob = await audioFile.arrayBuffer();
      
      // Cloudflare AI Whisper expects a Uint8Array or similar
      // The user snippet uses [...new Uint8Array(blob)]
      const input = {
        audio: [...new Uint8Array(blob)]
      };

      const response = await c.env.AI.run("@cf/openai/whisper", input);

      return c.json({ 
        status: "success", 
        data: response 
      });
    } catch (e: any) {
      console.error("Transcription error:", e);
      return c.json({ error: "Failed to transcribe audio: " + e.message }, 500);
    }
  });
};
