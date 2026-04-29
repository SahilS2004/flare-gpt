import type { ToolDefinition } from "../types";

export const createTimerTool: ToolDefinition = {
  name: "create_timer",
  description:
    "Create a timer with a duration in seconds. Use when the user asks to set a timer or remind in N minutes/seconds. The timer is persisted in KV.",
  parameters: {
    type: "object",
    properties: {
      seconds: {
        type: "number",
        description: "Total duration of the timer, in seconds."
      },
      label: {
        type: "string",
        description: "Optional short label for the timer."
      }
    },
    required: ["seconds"]
  },
  handler: async (args, ctx) => {
    const seconds = Number(args?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("Argument 'seconds' must be a positive number.");
    }
    const label = String(args?.label ?? "Timer").slice(0, 120);
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const firesAt = new Date(createdAt.getTime() + Math.floor(seconds) * 1000);

    const payload = {
      id,
      label,
      seconds: Math.floor(seconds),
      createdAt: createdAt.toISOString(),
      firesAt: firesAt.toISOString()
    };

    if (ctx.env?.USER_SETTINGS) {
      try {
        await ctx.env.USER_SETTINGS.put(
          `timer:${ctx.userId}:${id}`,
          JSON.stringify(payload),
          { expirationTtl: Math.max(60, Math.floor(seconds) + 3600) }
        );
      } catch (error: any) {
        console.error("Failed to persist timer in KV:", error);
        return { ...payload, persisted: false, reason: error?.message };
      }
    }

    return { ...payload, persisted: true };
  }
};
