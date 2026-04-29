import { getSecret } from "../../secrets";
import type { ToolDefinition } from "../types";

const SEARCH_ENDPOINT = "https://www.searchapi.io/api/v1/search";
const DEFAULT_TOPK = 6;
const MAX_TOPK = 10;
const MAX_SUMMARY_CHARS = 2500;
const MAX_SNIPPET_CHARS = 280;

type Reference = {
  index: number | null;
  title: string;
  link: string;
  snippet: string;
  source: string;
};

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + "…";
}

/**
 * Flatten Google AI Mode `text_blocks` into a single readable string.
 * Real shape (verified against the live API):
 *   { type: "paragraph" | "header" | "unordered_list" | "ordered_list",
 *     answer: string,
 *     items?: Array<{ type, answer }>,
 *     reference_indexes?: number[] }
 */
function flattenTextBlocks(blocks: any): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block) continue;
    const type = String(block.type ?? "");
    const answer = typeof block.answer === "string" ? block.answer.trim() : "";

    if (type === "header" && answer) {
      parts.push(`\n### ${answer}`);
      continue;
    }

    if (Array.isArray(block.items) && block.items.length > 0) {
      const ordered = type === "ordered_list";
      block.items.forEach((item: any, i: number) => {
        const itemAnswer = typeof item?.answer === "string" ? item.answer.trim() : "";
        if (!itemAnswer) return;
        parts.push(ordered ? `${i + 1}. ${itemAnswer}` : `- ${itemAnswer}`);
      });
      continue;
    }

    if (answer) {
      parts.push(answer);
    }
  }
  return parts.join("\n").trim();
}

function extractReferenceLinks(data: any, topK: number): Reference[] {
  const raw = Array.isArray(data?.reference_links)
    ? data.reference_links
    : Array.isArray(data?.organic_results)
      ? data.organic_results
      : [];

  return raw
    .slice(0, topK)
    .map((item: any): Reference => ({
      index: typeof item?.index === "number" ? item.index : null,
      title: clip(item?.title, 200),
      link: typeof item?.link === "string" ? item.link : "",
      snippet: clip(item?.snippet, MAX_SNIPPET_CHARS),
      source: clip(item?.source ?? item?.displayed_link, 120)
    }))
    .filter((item: Reference) => item.title || item.snippet || item.link);
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Live web lookup (Google AI Mode via SearchAPI.io). ALWAYS call when the question needs breaking news, today's prices, today's weather or sports outcomes, legislation after training cutoff, or any fact/citation you would otherwise invent. Do not hallucinate citations or timestamps—retrieve first.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Tight factual query copied from user intent—include year or 'latest' when relevant."
      },
      topK: {
        type: "number",
        description: "Number of reference links to include (1-10). Defaults to 6."
      }
    },
    required: ["query"]
  },
  handler: async (args, ctx) => {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      throw new Error("Missing required 'query' argument.");
    }

    const apiKey = await getSecret(ctx.env, "SEARCHAPI_KEY");
    if (!apiKey) {
      throw new Error("Web search is not configured (SEARCHAPI_KEY missing).");
    }

    const requestedTopK = Number(args?.topK);
    const topK = Number.isFinite(requestedTopK)
      ? Math.max(1, Math.min(MAX_TOPK, Math.floor(requestedTopK)))
      : DEFAULT_TOPK;

    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("engine", "google_ai_mode");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Web search failed (${response.status}): ${body.slice(0, 200) || response.statusText}`
      );
    }

    const data = (await response.json()) as any;

    // Prefer the engine's pre-rendered markdown when available - it already
    // includes inline citations like `[0](url)` so the agent can quote them.
    const markdown =
      typeof data?.markdown === "string" && data.markdown.trim()
        ? data.markdown.trim()
        : "";

    const summary = clip(
      markdown || flattenTextBlocks(data?.text_blocks) || data?.answer || "",
      MAX_SUMMARY_CHARS
    );

    const references = extractReferenceLinks(data, topK);
    const status = String(data?.search_metadata?.status ?? "");

    return {
      query,
      status: status || "ok",
      summary: summary || null,
      references
    };
  }
};
