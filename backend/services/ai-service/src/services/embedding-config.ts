/**
 * Single source of truth for which embedding backend ai-service uses and how
 * many dimensions its vectors have.
 *
 * Every Qdrant read, write, and collection creation derives its vector size
 * from EMBEDDING_VECTOR_SIZE below — never from a hard-coded 768. Mixing
 * vectors of two sizes in one collection is not something Qdrant silently
 * tolerates (it rejects the write), but a collection created at the wrong
 * size blocks every later write, so the size must be decided in one place.
 *
 * EMBEDDING_PROVIDER
 *   bedrock → Amazon Bedrock Cohere Embed (AWS production)
 *   ollama  → Ollama /api/embeddings at LLM_BASE_URL (local development)
 *   mock    → deterministic hash vectors (tests)
 *   unset   → "mock" when LLM_PROVIDER=mock, otherwise "ollama" — exactly the
 *             behaviour before this setting existed.
 *
 * KNOWLEDGE_VECTOR_SIZE overrides the per-provider default dimension.
 */

export type EmbeddingProvider = "bedrock" | "ollama" | "mock";
export type EmbeddingInputType = "search_document" | "search_query";

const SUPPORTED_PROVIDERS: readonly EmbeddingProvider[] = ["bedrock", "ollama", "mock"];

/** Cohere Embed v3 models on Bedrock always return 1024-dimension floats. */
const FIXED_DIMENSION_BY_BEDROCK_MODEL: Record<string, number> = {
  "cohere.embed-multilingual-v3": 1024,
  "cohere.embed-english-v3": 1024,
};

const DEFAULT_DIMENSION_BY_PROVIDER: Record<EmbeddingProvider, number> = {
  bedrock: 1024,
  // nomic-embed-text, the Ollama model every local collection was built with.
  ollama: 768,
  mock: 768,
};

export function resolveEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
  const raw = (env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (!raw) return env.LLM_PROVIDER === "mock" ? "mock" : "ollama";
  if ((SUPPORTED_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as EmbeddingProvider;
  }
  throw new Error(
    `Unsupported EMBEDDING_PROVIDER "${raw}". Expected one of: ${SUPPORTED_PROVIDERS.join(", ")}.`,
  );
}

export function resolveBedrockEmbeddingModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.BEDROCK_EMBEDDING_MODEL || "cohere.embed-multilingual-v3";
}

export function resolveEmbeddingVectorSize(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const provider = resolveEmbeddingProvider(env);
  const raw = env.KNOWLEDGE_VECTOR_SIZE;
  const size =
    raw === undefined || raw.trim() === ""
      ? DEFAULT_DIMENSION_BY_PROVIDER[provider]
      : Number.parseInt(raw, 10);

  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(
      `KNOWLEDGE_VECTOR_SIZE must be a positive integer, got "${raw}".`,
    );
  }

  if (provider === "bedrock") {
    const model = resolveBedrockEmbeddingModel(env);
    const fixed = FIXED_DIMENSION_BY_BEDROCK_MODEL[model];
    if (fixed !== undefined && fixed !== size) {
      // A mismatch here can never work: every vector the model returns would
      // be rejected by a collection sized to the configured value.
      throw new Error(
        `KNOWLEDGE_VECTOR_SIZE=${size} does not match ${model}, which always returns ${fixed} dimensions.`,
      );
    }
  }

  return size;
}

export const EMBEDDING_PROVIDER: EmbeddingProvider = resolveEmbeddingProvider();
export const EMBEDDING_VECTOR_SIZE: number = resolveEmbeddingVectorSize();

export class EmbeddingDimensionError extends Error {
  constructor(
    readonly actual: number,
    readonly expected: number,
  ) {
    super(
      `Embedding has ${actual} dimensions but ${expected} are configured (KNOWLEDGE_VECTOR_SIZE). Refusing to use it so vectors of different sizes never reach the same Qdrant collection.`,
    );
    this.name = "EmbeddingDimensionError";
  }
}

export function assertEmbeddingDimension(
  vector: readonly number[],
  expected: number = EMBEDDING_VECTOR_SIZE,
): void {
  if (vector.length !== expected) {
    throw new EmbeddingDimensionError(vector.length, expected);
  }
}
