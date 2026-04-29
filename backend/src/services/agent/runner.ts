import type { UserSettings } from "../settings";
import { buildToolRegistry, indexByName, toToolSchema } from "./registry";
import type {
  AgentInput,
  AgentResult,
  ToolCall,
  ToolDefinition,
  ToolExecution
} from "./types";

const MAX_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 8;
const AGENT_LOOP_TEMPERATURE = 0.35;
const FINAL_SYNTHESIS_TEMPERATURE = 0.55;
const FINAL_SYNTHESIS_HINT =
  "Now write the final reply for the user as plain markdown. Do not call any more tools.";

function buildSystemPrompt(
  settings: UserSettings,
  registry: ToolDefinition[]
): string {
  const toolList = registry
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  const lines = [
    "You are FlareGPT, orchestrating callable tools—you do not hallucinate factual or numeric answers when a tool covers them.",
    "When a suitable tool exists, CALL IT BEFORE answering rather than estimating in natural language.",
    "Call tools sequentially when one depends on another; when independent you may invoke multiple tools in one turn.",
    "After receiving tool outputs, summarise clearly in markdown.",
    "",
    "**Hard routing (follow these priorities):**",
    "- Arithmetic, any non-trivial numbers, percentages, averages, powers, roots: use **calculator** with a single `expression` string (never guess products or large divisions).",
    "- Current information, news, recent events, live prices, anything after your knowledge cutoff, or anything requiring citations/sources: use **web_search** with a focused `query` first.",
    "- Timers/schedules/redis/weather: use those tools directly when requested.",
    "Do not invent tools that are not listed below."
  ];

  if (settings.useVector) {
    lines.push(
      "An initial vector_search already ran for this chat (scoped to user + conversation). Results appear as synthetic tool messages above — use those chunks before re-querying documents."
    );
  }

  lines.push(
    "",
    "Available tools:",
    toolList,
    "",
    `User feature flags: useRedis=${settings.useRedis}, useVector=${settings.useVector}, microphoneEnabled=${settings.microphoneEnabled}.`
  );

  return lines.join("\n");
}

/**
 * Parse one Workers AI-style tool-call object (handles both legacy `{ name, arguments }`
 * and OpenAI-compatible `{ id, type, function: { name, arguments } }`).
 */
function parseToolCallEntry(item: unknown): ToolCall | null {
  if (!item || typeof item !== "object") return null;
  const entry = item as Record<string, unknown>;

  const nested = entry.function;
  let name = String(entry.name ?? "").trim();
  let argsUnknown: unknown = entry.arguments;

  if (nested && typeof nested === "object") {
    const fn = nested as Record<string, unknown>;
    const fnName = String(fn.name ?? "").trim();
    if (fnName) name = fnName;
    if (fn.arguments !== undefined) argsUnknown = fn.arguments;
  }

  if (!name) return null;

  let parsedArgs: Record<string, unknown> = {};
  if (typeof argsUnknown === "string") {
    const trimmed = argsUnknown.trim();
    if (trimmed) {
      try {
        parsedArgs = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
    }
  } else if (
    argsUnknown &&
    typeof argsUnknown === "object" &&
    !Array.isArray(argsUnknown)
  ) {
    parsedArgs = argsUnknown as Record<string, unknown>;
  }

  const idRaw = entry.id;
  const toolCallId =
    typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : undefined;

  return {
    name,
    arguments: parsedArgs,
    ...(toolCallId ? { toolCallId } : {})
  };
}

/**
 * Collect tool calls from the Workers AI `run()` payload. Older runtimes buried
 * tool_calls under auxiliary keys—scan a shallow set of nests defensively.
 */
function collectAiToolCalls(response: unknown): ToolCall[] {
  if (!response || typeof response !== "object") return [];
  const root = response as Record<string, unknown>;

  const buckets: unknown[] = [];

  if (Array.isArray(root.tool_calls)) buckets.push(...root.tool_calls);

  const nestedRoots = ["raw", "data", "output", "result", "responses"] as const;
  for (const key of nestedRoots) {
    const nested = root[key];
    if (!nested || typeof nested !== "object") continue;
    const n = nested as Record<string, unknown>;
    if (Array.isArray(n.tool_calls)) {
      buckets.push(...n.tool_calls);
    }
    if (Array.isArray(n.choices)) {
      const first = n.choices[0] as Record<string, unknown> | undefined;
      const tc = first?.message;
      if (tc && typeof tc === "object") {
        const msg = tc as Record<string, unknown>;
        if (Array.isArray(msg.tool_calls)) {
          buckets.push(...msg.tool_calls);
        }
      }
    }
  }

  const out: ToolCall[] = [];
  for (const bucket of buckets) {
    const c = parseToolCallEntry(bucket);
    if (c) out.push(c);
  }
  const dedupe = new Map<string, ToolCall>();
  for (const call of out) {
    dedupe.set(callSignature(call), call);
  }
  return [...dedupe.values()];
}

function callSignature(call: ToolCall): string {
  return `${call.name}::${JSON.stringify(call.arguments)}`;
}

async function runToolCall(
  call: ToolCall,
  registry: Record<string, ToolDefinition>,
  ctx: { env: any; userId: string; chatId: string; settings: UserSettings }
): Promise<ToolExecution> {
  const tool = registry[call.name];
  if (!tool) {
    return {
      name: call.name,
      arguments: call.arguments,
      result: { error: `Unknown tool '${call.name}'.` }
    };
  }

  try {
    const result = await tool.handler(call.arguments, ctx);
    return { name: call.name, arguments: call.arguments, result };
  } catch (error: any) {
    return {
      name: call.name,
      arguments: call.arguments,
      result: { error: error?.message ?? "Tool execution failed." }
    };
  }
}

/**
 * Seed the conversation with an initial `vector_search` exchange so the model
 * always starts with document context retrieved. This keeps retrieval owned
 * by the agent tool (same code path, same toolsUsed shape) while compensating
 * for small models that won't reliably call the tool on their own.
 */
async function seedVectorSearch(
  input: AgentInput,
  ctx: { env: any; userId: string; chatId: string; settings: UserSettings },
  conversation: any[],
  handlersByName: Record<string, ToolDefinition>,
  toolsUsed: ToolExecution[],
  seenSignatures: Set<string>
): Promise<void> {
  if (!input.settings.useVector) return;

  const tool = handlersByName["vector_search"];
  if (!tool) return;

  const args = { query: input.userPrompt };
  const sig = callSignature({ name: "vector_search", arguments: args });
  seenSignatures.add(sig);

  try {
    const result = await tool.handler(args, ctx);
    toolsUsed.push({ name: "vector_search", arguments: args, result });

    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: [{ name: "vector_search", arguments: args }]
    });
    conversation.push({
      role: "tool",
      name: "vector_search",
      content: JSON.stringify(result)
    });
  } catch (error: any) {
    console.error("Agent: vector_search seed failed", error);
    const errResult = { error: error?.message ?? "vector_search failed." };
    toolsUsed.push({ name: "vector_search", arguments: args, result: errResult });
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: [{ name: "vector_search", arguments: args }]
    });
    conversation.push({
      role: "tool",
      name: "vector_search",
      content: JSON.stringify(errResult)
    });
  }
}

export async function runAgent(
  env: any,
  input: AgentInput
): Promise<AgentResult> {
  const toolsUsed: ToolExecution[] = [];
  const ctx = {
    env,
    userId: input.userId,
    chatId: input.chatId,
    settings: input.settings
  };

  const registry = buildToolRegistry(input.settings);
  const handlersByName = indexByName(registry);
  const toolsSchema = toToolSchema(registry);
  const systemPrompt = buildSystemPrompt(input.settings, registry);

  const conversation: any[] = [
    { role: "system", content: systemPrompt },
    ...input.recentMessages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.userPrompt }
  ];

  const seenSignatures = new Set<string>();

  await seedVectorSearch(input, ctx, conversation, handlersByName, toolsUsed, seenSignatures);

  for (let step = 0; step < MAX_ITERATIONS; step++) {
    let response: any;
    try {
      response = await env.AI.run(env.AI_MODEL, {
        messages: conversation,
        tools: toolsSchema,
        max_tokens: 1024,
        temperature: AGENT_LOOP_TEMPERATURE
      });
    } catch (error: any) {
      console.error("Agent: AI.run failed", error);
      return {
        text: "I had trouble processing that request. Please try again.",
        toolsUsed
      };
    }

    const toolCalls = collectAiToolCalls(response);
    const responseText = String(response?.response ?? "").trim();

    if (toolCalls.length === 0) {
      if (responseText) {
        return { text: responseText, toolsUsed };
      }
      break;
    }

    const fresh: ToolCall[] = [];
    for (const call of toolCalls) {
      const sig = callSignature(call);
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
      fresh.push(call);
    }

    if (fresh.length === 0) {
      break;
    }

    conversation.push({
      role: "assistant",
      content: responseText,
      tool_calls: fresh.map((call) => ({
        ...(call.toolCallId ? { id: call.toolCallId } : {}),
        name: call.name,
        arguments: call.arguments
      }))
    });

    const executions = await Promise.all(
      fresh.map((call) => runToolCall(call, handlersByName, ctx))
    );

    for (const execution of executions) {
      toolsUsed.push(execution);
      conversation.push({
        role: "tool",
        name: execution.name,
        content: JSON.stringify(execution.result)
      });
    }
  }

  try {
    const final = await env.AI.run(env.AI_MODEL, {
      messages: [
        ...conversation,
        { role: "system", content: FINAL_SYNTHESIS_HINT }
      ],
      max_tokens: 1024,
      temperature: FINAL_SYNTHESIS_TEMPERATURE
    });
    const finalText = String(final?.response ?? "").trim();
    return {
      text: finalText || "I could not produce a response. Please try again.",
      toolsUsed
    };
  } catch (error) {
    console.error("Agent: final synthesis failed", error);
    return {
      text: "I could not produce a response. Please try again.",
      toolsUsed
    };
  }
}
