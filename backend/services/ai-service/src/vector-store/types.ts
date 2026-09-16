export type VectorStoreProvider = "qdrant" | "opensearch";

export type VectorPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

export type VectorSearchFilter = Record<string, unknown>;

export type VectorSearchResult = {
  id: string;
  similarity: number;
  payload: Record<string, unknown>;
  rawScore?: number;
};

export type VectorIndexStatus =
  | { kind: "ok"; size: number; pointsCount?: number }
  | { kind: "missing" }
  | { kind: "mismatch"; error: VectorDimensionMismatchError };

export interface VectorStore {
  readonly provider: VectorStoreProvider;
  healthCheck(): Promise<void>;
  getIndexStatus(index: string, expectedSize?: number): Promise<VectorIndexStatus>;
  ensureIndex(index: string, expectedSize?: number): Promise<{ size: number; created: boolean }>;
  search(
    index: string,
    args: {
      vector: number[];
      limit: number;
      filter?: VectorSearchFilter;
    },
  ): Promise<VectorSearchResult[]>;
  upsert(index: string, points: VectorPoint[]): Promise<void>;
}

export class VectorDimensionMismatchError extends Error {
  readonly code = "VECTOR_DIMENSION_MISMATCH";

  constructor(
    readonly index: string,
    readonly actual: number | null,
    readonly expected: number,
    readonly provider: VectorStoreProvider,
  ) {
    super(
      actual === null
        ? `${provider} vector dimension mismatch: expected ${expected} but index "${index}" has no verifiable vector field. Reindex is required. The existing index was not modified.`
        : `${provider} vector dimension mismatch: expected ${expected} but index is configured for ${actual}. Reindex is required. Index "${index}" was not modified.`,
    );
    this.name = "VectorDimensionMismatchError";
  }
}

export function resolveVectorStoreProvider(
  env: NodeJS.ProcessEnv = process.env,
): VectorStoreProvider {
  const raw = (env.VECTOR_STORE_PROVIDER || "qdrant").trim().toLowerCase();
  if (raw === "qdrant" || raw === "opensearch") return raw;
  throw new Error(
    `Unsupported VECTOR_STORE_PROVIDER "${raw}". Expected "qdrant" or "opensearch".`,
  );
}
