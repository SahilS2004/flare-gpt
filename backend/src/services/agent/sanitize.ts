/**
 * Strip model planning / chain-of-thought so users only see the final answer.
 */
export function sanitizeAssistantText(raw: string): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";

  text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  text = text.replace(/<\/?think(?:ing)?>/gi, "");

  // Drop fenced blocks that look like tool calls / function JSON, not user code.
  text = text.replace(/```(?:json|tool(?:_calls?)?|function)?\s*([\s\S]*?)```/gi, (full, body) => {
    const sample = `${full}\n${body}`.toLowerCase();
    if (
      sample.includes("tool_call") ||
      sample.includes("function_call") ||
      /"name"\s*:\s*"(calculator|web_search|vector_search|weather|create_timer|create_schedule|redis_memory)/.test(
        sample
      )
    ) {
      return "";
    }
    return full;
  });

  const filtered = text
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^tool[_ ]?calls?\b/i.test(l)) return false;
      if (/^arguments?\s*[:=]/i.test(l) && /[{[]/.test(l)) return false;
      if (
        /^(i(?:'ll| will)|let me|i need to|i should|i am going to|i'm going to)\b/i.test(l) &&
        /\b(tool|search|calculator|vector|lookup|call)\b/i.test(l)
      ) {
        return false;
      }
      if (/^(using|calling|invoking)\b.+\btool\b/i.test(l)) return false;
      return true;
    })
    .join("\n");

  return filtered.replace(/\n{3,}/g, "\n\n").trim();
}
