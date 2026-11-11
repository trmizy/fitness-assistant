/**
 * Shared embedding helpers for the seed/ingest scripts.
 *
 * 2026-10-26: the first Bedrock (Cohere) ingest sent 20 single-text requests in parallel and was throttled
 * (HTTP 429 ThrottlingException) after ~240 rows, aborting the run. Cohere Embed on Bedrock accepts up to 96 texts per
 * request, so on Bedrock a whole batch goes out as ONE request, and any throttling is retried with exponential back-off.
 * Ollama / mock keep the per-text path unchanged.
 */
import { EMBEDDING_PROVIDER, assertEmbeddingDimension } from "../../services/embedding-config";
import { embedTextsWithCohere } from "../../services/bedrock.client";
import { llmService } from "../../services/llm.service";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isThrottleError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; status?: number; $metadata?: { httpStatusCode?: number }; cause?: unknown } | null;
  if (!e) return false;
  if (e.$metadata?.httpStatusCode === 429 || e.status === 429) return true;
  if (/throttl|too many requests|rate exceeded/i.test(`${e.name ?? ""} ${e.message ?? ""}`)) return true;
  return e.cause ? isThrottleError(e.cause) : false;
}

/** Retries only throttling errors (anything else is a real failure and is thrown immediately). */
export async function withThrottleBackoff<T>(fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isThrottleError(err) || attempt >= maxAttempts) throw err;
      const waitMs = Math.min(60_000, 1500 * 2 ** (attempt - 1));
      console.warn(`  throttled by the embedding service - waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
      await sleep(waitMs);
    }
  }
}

/** Rows per batch: one Cohere request carries a whole batch (max 96); Ollama keeps the original 20. */
export const EMBED_BATCH_SIZE = EMBEDDING_PROVIDER === "bedrock" ? 64 : 20;

/** Embeds stored documents. Result order matches `texts`. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (EMBEDDING_PROVIDER === "bedrock") {
    const vectors = await withThrottleBackoff(() => embedTextsWithCohere(texts, "search_document", { timeoutMs: 60_000 }));
    vectors.forEach((v) => assertEmbeddingDimension(v));
    return vectors;
  }
  return Promise.all(
    texts.map((text) =>
      withThrottleBackoff(() => llmService.generateEmbedding(text, { inputType: "search_document", timeoutMs: 30_000 })),
    ),
  );
}

/** Single-text variant for the scripts that embed one chunk at a time. */
export async function embedDocument(text: string): Promise<number[]> {
  return withThrottleBackoff(() => llmService.generateEmbedding(text, { inputType: "search_document", timeoutMs: 30_000 }));
}
