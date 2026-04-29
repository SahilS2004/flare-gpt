import type { ToolDefinition } from "../types";

export const createScheduleTool: ToolDefinition = {
  name: "create_schedule",
  description:
    "Create a scheduled item with a title and date/time. Use when the user wants to schedule a meeting, task, or reminder for a specific time. Persisted in KV.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short title of the schedule entry."
      },
      when: {
        type: "string",
        description:
          "ISO date-time or natural language time, e.g. '2026-05-01T10:00' or 'tomorrow 9am'."
      },
      notes: {
        type: "string",
        description: "Optional extra notes."
      }
    },
    required: ["title", "when"]
  },
  handler: async (args, ctx) => {
    const title = String(args?.title ?? "").trim();
    const when = String(args?.when ?? "").trim();
    const notes = String(args?.notes ?? "").trim();
    if (!title || !when) {
      throw new Error("Arguments 'title' and 'when' are required.");
    }

    const id = crypto.randomUUID();
    const payload = {
      id,
      title: title.slice(0, 200),
      when,
      notes: notes.slice(0, 500),
      createdAt: new Date().toISOString()
    };

    if (ctx.env?.USER_SETTINGS) {
      try {
        await ctx.env.USER_SETTINGS.put(
          `schedule:${ctx.userId}:${id}`,
          JSON.stringify(payload)
        );
      } catch (error: any) {
        console.error("Failed to persist schedule in KV:", error);
        return { ...payload, persisted: false, reason: error?.message };
      }
    }

    return { ...payload, persisted: true };
  }
};
