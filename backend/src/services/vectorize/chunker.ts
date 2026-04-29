import type { ChunkRecord } from "./types";

const DEFAULT_CHUNK_SIZE = 700;
const DEFAULT_CHUNK_OVERLAP = 80;

/**
 * Sliding-window chunker that prefers paragraph and sentence boundaries.
 * Empty/whitespace-only chunks are dropped.
 */
export function chunkText(
  text: string,
  size: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_CHUNK_OVERLAP
): ChunkRecord[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\s+\n/g, "\n").trim();
  if (!normalized) return [];

  if (normalized.length <= size) {
    return [{ index: 0, text: normalized }];
  }

  const chunks: ChunkRecord[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + size, normalized.length);
    let slice = normalized.slice(cursor, end);

    if (end < normalized.length) {
      const breakAt = findBreakpoint(slice);
      if (breakAt > 0 && breakAt > size * 0.5) {
        slice = slice.slice(0, breakAt);
      }
    }

    const trimmed = slice.trim();
    if (trimmed.length > 0) {
      chunks.push({ index: index++, text: trimmed });
    }

    const advance = Math.max(slice.length - overlap, 1);
    cursor += advance;
  }

  return chunks;
}

function findBreakpoint(slice: string): number {
  const candidates = [
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("\n")
  ];
  return Math.max(...candidates);
}
