/**
 * Qdrant collection dimension guard.
 *
 * Switching embeddings from Ollama nomic-embed-text (768) to Bedrock Cohere
 * Embed Multilingual v3 (1024) makes every existing collection the wrong
 * size. Nothing here deletes or recreates a collection: a size mismatch is
 * reported as VectorDimensionMismatchError and the fix is an explicit
 * re-index into a correctly sized collection.
 *
 *   - Write paths call ensureCollectionDimension(): creates a missing
 *     collection at the configured size, verifies an existing one, and
 *     throws on mismatch so no document is embedded into the wrong place.
 *   - Read paths call getCollectionDimensionStatus(): a mismatch is reported
 *     back so the caller can skip that collection with a loud log instead of
 *     letting Qdrant's per-query error disappear into an empty result.
 */
import type { QdrantClient } from "@qdrant/js-client-rest";
import { getQdrantClient } from "./qdrant";
import { EMBEDDING_VECTOR_SIZE } from "../services/embedding-config";

export type CollectionClient = Pick<QdrantClient, "getCollection" | "createCollection">;

export class VectorDimensionMismatchError extends Error {
  readonly code = "QDRANT_VECTOR_DIMENSION_MISMATCH";

  constructor(
    readonly collection: string,
    readonly actual: number | null,
    readonly expected: number,
  ) {
    super(
      actual === null
        ? `Qdrant collection vector size mismatch: expected ${expected} but collection "${collection}" does not use a single unnamed vector. Reindex is required. The existing collection was not modified.`
        : `Qdrant collection vector size mismatch: expected ${expected} but collection is ${actual}. Reindex is required. Collection "${collection}" was not modified.`,
    );
    this.name = "VectorDimensionMismatchError";
  }
}

export type CollectionDimensionStatus =
  | { kind: "ok"; size: number }
  | { kind: "missing" }
  | { kind: "mismatch"; error: VectorDimensionMismatchError };

/** Reads the vector size from a getCollection() response. */
export function readCollectionVectorSize(info: unknown): number | null {
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

const STATUS_TTL_MS = 5 * 60 * 1000;
const statusCache = new Map<string, { status: CollectionDimensionStatus; at: number }>();

export function clearCollectionDimensionCache(): void {
  statusCache.clear();
}

/**
 * Compares a collection's stored vector size with `expectedSize`.
 * Network/permission errors are rethrown — never reported as "missing",
 * because callers create missing collections.
 */
export async function getCollectionDimensionStatus(
  collection: string,
  opts: { client?: CollectionClient; expectedSize?: number } = {},
): Promise<CollectionDimensionStatus> {
  const expected = opts.expectedSize ?? EMBEDDING_VECTOR_SIZE;
  const cacheKey = `${collection}:${expected}`;
  const cached = statusCache.get(cacheKey);
  if (!opts.client && cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.status;
  }

  const client = opts.client ?? getQdrantClient();
  let status: CollectionDimensionStatus;
  try {
    const info = await client.getCollection(collection);
    const actual = readCollectionVectorSize(info);
    status =
      actual === expected
        ? { kind: "ok", size: actual }
        : { kind: "mismatch", error: new VectorDimensionMismatchError(collection, actual, expected) };
  } catch (err) {
    if (!isNotFound(err)) throw err;
    status = { kind: "missing" };
  }

  if (!opts.client) statusCache.set(cacheKey, { status, at: Date.now() });
  return status;
}

/**
 * Write-path guard: returns the verified size, creating the collection at
 * the configured size when it does not exist yet. Throws
 * VectorDimensionMismatchError instead of writing into a wrongly sized
 * collection. Never deletes anything.
 */
export async function ensureCollectionDimension(
  collection: string,
  opts: { client?: CollectionClient; expectedSize?: number } = {},
): Promise<{ size: number; created: boolean }> {
  const expected = opts.expectedSize ?? EMBEDDING_VECTOR_SIZE;
  const client = opts.client ?? getQdrantClient();
  const status = await getCollectionDimensionStatus(collection, { client, expectedSize: expected });

  if (status.kind === "mismatch") throw status.error;
  if (status.kind === "ok") return { size: status.size, created: false };

  await client.createCollection(collection, {
    vectors: { size: expected, distance: "Cosine" },
  });
  statusCache.set(`${collection}:${expected}`, {
    status: { kind: "ok", size: expected },
    at: Date.now(),
  });
  return { size: expected, created: true };
}
