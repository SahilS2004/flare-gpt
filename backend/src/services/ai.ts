import { runAgent } from "./agent";
import type { AgentInput, AgentResult } from "./agent";

/**
 * Public AI surface for the rest of the worker.
 *
 * The heavy lifting (tool registry, robust native tool-calling loop, and
 * agent-driven retrieval via the vector_search tool) lives in
 * `services/agent`. This module is a thin facade so callers don't have to
 * know about the agent's internals.
 */

export type { AgentInput, AgentResult } from "./agent";

/**
 * Single-shot Q&A without tools or memory. Used by routes that just need a
 * direct model completion (e.g. internal utilities).
 */
export async function askAI(env: any, message: string): Promise<string> {
  try {
    const response = await env.AI.run(env.AI_MODEL, {
      messages: [
        {
          role: "system",
          content: "You are FlareGPT, a helpful and concise AI assistant."
        },
        { role: "user", content: message }
      ]
    });
    return String(response?.response ?? "");
  } catch (error) {
    console.error("askAI failed:", error);
    return "I'm sorry, my AI processing failed. Please try again.";
  }
}

/**
 * Chat orchestration entrypoint. Delegates to the agent runner so all tool
 * use, RAG retrieval, and settings-flag enforcement live in one place.
 */
export async function orchestrateAiWithTools(
  env: any,
  params: AgentInput
): Promise<AgentResult> {
  return runAgent(env, params);
}
