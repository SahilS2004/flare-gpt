import type { UserSettings } from "../settings";
import { buildToolRegistry, indexByName, toToolSchema } from "./registry";
import { sanitizeAssistantText } from "./sanitize";
import type {
  AgentInput,
  AgentResult,
  ToolCall,
  ToolDefinition,
  ToolExecution
} from "./types";

const MAX_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 8;
const AGENT_LOOP_TEMPERATURE = 0.2;
const FINAL_SYNTHESIS_TEMPERATURE = 0.45;
const FINAL_SYNTHESIS_HINT =
  "Write ONLY the final user-facing reply in markdown. Do not mention tools, planning, searches, or intermediate steps. Do not call any more tools.";

function buildSystemPrompt(
  settings: UserSettings,
  registry: ToolDefinition[]
): string {
  const toolList = registry
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  const lines = [
    "You are FlareGPT, an assistant that MUST use the provided tools via native function calls whenever they apply.",
    "Never invent tool results. Never skip a relevant tool.",
    "When a suitable tool exists, CALL IT before answering — do not estimate in natural language.",
    "You may call multiple tools in one turn when independent; otherwise call them in dependency order.",
    "",
    "**Output rules (critical):**",
    "- Never reveal chain-of-thought, planning, or which tool you will call.",
    "- Never narrate steps like \"I'll search\" / \"Let me use the calculator\".",
    "- User-visible text must be the final answer only (clean markdown).",
    "",
    "**Hard routing:**",
    "- Arithmetic / numbers / percentages / powers / roots → **calculator** (`expression`).",
    "- Current events, news, live prices, citations, post-cutoff facts → **web_search** (`query`).",
    "- Weather for a place → **weather**.",
    "- Timers → **create_timer**; schedules → **create_schedule**.",
    "- Past turns in this chat (when Redis is on) → **redis_memory_lookup**.",
    "- Uploaded documents in THIS chat → **vector_search** (also pre-seeded below when enabled).",
    "Do not invent tools that are not listed below."
  ];

  if (settings.useVector) {
    lines.push(
      "An initial vector_search already ran for this chat (scoped to user + conversation). Results appear as synthetic tool messages above — use those chunks before re-querying documents.",
      "If vector_search returned count 0 / empty matches, answer normally from general knowledge. Do not mention empty search or missing documents unless the user asked about uploads."
    );
  }

  lines.push(
    "",
    "Available tools (use them via function calls):",
    toolList,
    "",
    `Flags: useRedis=${settings.useRedis}, useVector=${settings.useVector}.`
  );

  return lines.join("\n");
}

function finalizeReply(text: string, toolsUsed: ToolExecution[]): AgentResult {
  const cleaned = sanitizeAssistantText(text);
  return {
    text: cleaned || "I could not produce a response. Please try again.",
    toolsUsed
  };
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

/**
 * Workers AI now validates OpenAI-compatible tool_call shapes. Legacy
 * `{ name, arguments }` objects fail with 8007 / missing id|type|function.
 */
function toOpenAiToolCall(call: ToolCall): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} {
  return {
    id: call.toolCallId || `call_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {})
    }
  };
}

function toOpenAiToolResult(
  toolCallId: string,
  name: string,
  result: unknown
): { role: "tool"; tool_call_id: string; name: string; content: string } {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    name,
    content: JSON.stringify(result)
  };
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

  const seededCall: ToolCall = {
    name: "vector_search",
    arguments: args,
    toolCallId: `call_seed_vector_${crypto.randomUUID()}`
  };
  const openAiCall = toOpenAiToolCall(seededCall);

  try {
    const result = await tool.handler(args, ctx);
    toolsUsed.push({ name: "vector_search", arguments: args, result });

    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: [openAiCall]
    });
    conversation.push(
      toOpenAiToolResult(openAiCall.id, "vector_search", result)
    );
  } catch (error: any) {
    console.error("Agent: vector_search seed failed", error);
    const errResult = { error: error?.message ?? "vector_search failed." };
    toolsUsed.push({ name: "vector_search", arguments: args, result: errResult });
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: [openAiCall]
    });
    conversation.push(
      toOpenAiToolResult(openAiCall.id, "vector_search", errResult)
    );
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
        return finalizeReply(responseText, toolsUsed);
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
      // Model repeated prior tool calls — synthesize from what we already have.
      break;
    }

    const openAiCalls = fresh.map((call) => toOpenAiToolCall(call));
    // Keep tool-call turns silent so planning text never leaks into synthesis.
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: openAiCalls
    });

    const executions = await Promise.all(
      fresh.map((call, index) =>
        runToolCall(
          { ...call, toolCallId: openAiCalls[index].id },
          handlersByName,
          ctx
        )
      )
    );

    for (let i = 0; i < executions.length; i++) {
      const execution = executions[i];
      toolsUsed.push(execution);
      conversation.push(
        toOpenAiToolResult(openAiCalls[i].id, execution.name, execution.result)
      );
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
    return finalizeReply(finalText, toolsUsed);
  } catch (error) {
    console.error("Agent: final synthesis failed", error);
    return finalizeReply("", toolsUsed);
  }
}
