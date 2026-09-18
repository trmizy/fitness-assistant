import { getQdrantClient } from "../repositories/qdrant";
import { EMBEDDING_VECTOR_SIZE } from "../services/embedding-config";
import type {
  VectorIndexStatus,
  VectorPoint,
  VectorSearchResult,
  VectorStore,
  VectorSearchFilter,
} from "./types";
import { VectorDimensionMismatchError } from "./types";

function readQdrantVectorSize(info: unknown): number | null {
  const vectors = (info as { config?: { params?: { vectors?: unknown } } })
    ?.config?.params?.vectors as Record<string, unknown> | undefined;
  if (!vectors || typeof vectors !== "object") return null;
  const size = (vectors as { size?: unknown }).size;
  return typeof size === "number" ? size : null;
}

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (status === 404) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /not\s*found|doesn't exist|does not exist/i.test(message);
}

export class QdrantVectorStore implements VectorStore {
  readonly provider = "qdrant" as const;

  async healthCheck(): Promise<void> {
    await getQdrantClient().getCollections();
  }

  async getIndexStatus(
    index: string,
    expectedSize = EMBEDDING_VECTOR_SIZE,
  ): Promise<VectorIndexStatus> {
    try {
      const info = await getQdrantClient().getCollection(index);
      const actual = readQdrantVectorSize(info);
      const pointsCount = (info as { points_count?: unknown })?.points_count;
      return actual === expectedSize
        ? {
            kind: "ok",
            size: actual,
            pointsCount: typeof pointsCount === "number" ? pointsCount : undefined,
          }
        : {
            kind: "mismatch",
            error: new VectorDimensionMismatchError(
              index,
              actual,
              expectedSize,
              this.provider,
            ),
          };
    } catch (err) {
      if (!isNotFound(err)) throw err;
      return { kind: "missing" };
    }
  }

  async ensureIndex(
    index: string,
    expectedSize = EMBEDDING_VECTOR_SIZE,
  ): Promise<{ size: number; created: boolean }> {
    const status = await this.getIndexStatus(index, expectedSize);
    if (status.kind === "mismatch") throw status.error;
    if (status.kind === "ok") return { size: status.size, created: false };
    await getQdrantClient().createCollection(index, {
      vectors: { size: expectedSize, distance: "Cosine" },
    });
    return { size: expectedSize, created: true };
  }

  async search(
    index: string,
    args: { vector: number[]; limit: number; filter?: VectorSearchFilter },
  ): Promise<VectorSearchResult[]> {
    const results = await getQdrantClient().search(index, {
      vector: args.vector,
      limit: args.limit,
      with_payload: true,
      ...(args.filter ? { filter: args.filter } : {}),
    });
    return results.map((item) => {
      const score = typeof item.score === "number" ? item.score : 0;
      return {
        id: String(item.id),
        similarity: score,
        rawScore: score,
        payload: (item.payload || {}) as Record<string, unknown>,
      };
    });
  }

  async upsert(index: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await getQdrantClient().upsert(index, {
      wait: true,
      points: points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload,
      })),
    });
  }
}
