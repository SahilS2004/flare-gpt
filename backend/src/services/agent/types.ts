import type { UserSettings } from "../settings";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ToolContext = {
  env: any;
  userId: string;
  chatId: string;
  settings: UserSettings;
};

export type ToolHandler = (
  args: Record<string, any>,
  ctx: ToolContext
) => Promise<any>;

export type ToolParameterSchema = {
  type: "object";
  properties: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  >;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  handler: ToolHandler;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, any>;
  /** Returned by Workers AI for some models; carry through for correct chat/tool replay */
  toolCallId?: string;
};

export type ToolExecution = {
  name: string;
  arguments: Record<string, any>;
  result: any;
};

export type AgentInput = {
  userId: string;
  chatId: string;
  userPrompt: string;
  recentMessages: ChatMessage[];
  settings: UserSettings;
};

export type AgentResult = {
  text: string;
  toolsUsed: ToolExecution[];
};
