import type { UserSettings } from "../settings";
import { calculatorTool } from "./tools/calculator";
import { redisMemoryLookupTool } from "./tools/memory";
import { createScheduleTool } from "./tools/schedules";
import { createTimerTool } from "./tools/timers";
import { vectorSearchTool } from "./tools/vector_search";
import { weatherTool } from "./tools/weather";
import { webSearchTool } from "./tools/web_search";
import type { ToolDefinition } from "./types";

/**
 * Build the tool registry the agent sees on this turn. Settings flags are
 * applied here so disabled tools never reach the model.
 */
export function buildToolRegistry(settings: UserSettings): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    calculatorTool,
    weatherTool,
    webSearchTool,
    createTimerTool,
    createScheduleTool
  ];

  if (settings.useVector) {
    tools.push(vectorSearchTool);
  }

  if (settings.useRedis) {
    tools.push(redisMemoryLookupTool);
  }

  return tools;
}

/**
 * Cloudflare Workers AI expects either legacy `{ name, description, parameters }`
 * **or** OpenAI-compatible `{ type: "function", function: { name, description, parameters } }`.
 * Using the canonical `type: "function"` shape matches `AiTextGenerationToolInput` exactly
 * and improves tool adhesion on Llama 3.x smaller instruct models.
 *
 * Docs: AiTextGenerationInput.tools in worker-configuration.d.ts
 */
export function toToolSchema(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export function indexByName(
  tools: ToolDefinition[]
): Record<string, ToolDefinition> {
  const map: Record<string, ToolDefinition> = {};
  for (const tool of tools) {
    map[tool.name] = tool;
  }
  return map;
}
