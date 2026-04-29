import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

/**
 * Extract plain text from an uploaded file. Returns:
 *   - { text, deferred: false } when extraction succeeds.
 *   - { text: "", deferred: true, reason } when we cannot/should not index now.
 *
 * Supported formats:
 *   - PDFs via `unpdf` (works on Cloudflare Workers; no native deps).
 *   - Text-based MIME types and common text extensions decoded as UTF-8.
 *   - Anything else: best-effort UTF-8 decode (binary files yield gibberish but
 *     callers should usually skip those upstream).
 */

const MAX_TEXT_BYTES = 5 * 1024 * 1024; // 5 MB safety cap on extracted text.

export async function extractText(
  data: ArrayBuffer,
  fileName: string,
  fileType: string
): Promise<{ text: string; deferred: boolean; reason?: string }> {
  const lower = fileName.toLowerCase();
  const isPdf =
    fileType === "application/pdf" ||
    fileType === "application/x-pdf" ||
    lower.endsWith(".pdf");

  if (isPdf) {
    return await extractPdf(data);
  }

  if (
    fileType.startsWith("text/") ||
    fileType === "application/json" ||
    fileType === "application/xml" ||
    /\.(txt|md|markdown|csv|tsv|json|xml|html?|log)$/i.test(lower)
  ) {
    return decodeText(data, "Text decode failed.");
  }

  return decodeText(data, "Unsupported binary file type.");
}

async function extractPdf(
  data: ArrayBuffer
): Promise<{ text: string; deferred: boolean; reason?: string }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
    const trimmed = merged.replace(/\u0000/g, "").trim();
    if (!trimmed) {
      return {
        text: "",
        deferred: true,
        reason:
          "PDF parsed but contained no extractable text (likely a scanned image - OCR not enabled)."
      };
    }
    return { text: capText(trimmed), deferred: false };
  } catch (error: any) {
    return {
      text: "",
      deferred: true,
      reason: error?.message ?? "PDF text extraction failed."
    };
  }
}

function decodeText(
  data: ArrayBuffer,
  failureReason: string
): { text: string; deferred: boolean; reason?: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
    return { text: capText(text), deferred: false };
  } catch (error: any) {
    return {
      text: "",
      deferred: true,
      reason: error?.message ?? failureReason
    };
  }
}

function capText(text: string): string {
  if (text.length <= MAX_TEXT_BYTES) return text;
  return text.slice(0, MAX_TEXT_BYTES);
}
