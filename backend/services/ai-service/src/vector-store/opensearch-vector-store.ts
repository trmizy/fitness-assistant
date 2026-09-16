import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { EMBEDDING_VECTOR_SIZE } from "../services/embedding-config";
import type {
  VectorIndexStatus,
  VectorPoint,
  VectorSearchFilter,
  VectorSearchResult,
  VectorStore,
} from "./types";
import { VectorDimensionMismatchError } from "./types";

export const OPENSEARCH_VECTOR_FIELD = "vector";
export const OPENSEARCH_SPACE_TYPE = "cosinesimil";
export const OPENSEARCH_SIGNING_SERVICE = "aoss";

export const OPENSEARCH_REGION =
  process.env.OPENSEARCH_REGION || process.env.AWS_REGION || "ap-southeast-1";
export const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_SERVERLESS_ENDPOINT;
const OPENSEARCH_TIMEOUT_MS = Number.parseInt(
  process.env.OPENSEARCH_TIMEOUT_MS || "5000",
  10,
);

let cachedClient: Client | null = null;

export function buildOpenSearchNode(endpoint = OPENSEARCH_ENDPOINT): string {
  if (!endpoint) {
    throw new Error("OPENSEARCH_SERVERLESS_ENDPOINT is required when VECTOR_STORE_PROVIDER=opensearch");
  }
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
}

export function createOpenSearchClient(): Client {
  return new Client({
    ...AwsSigv4Signer({
      region: OPENSEARCH_REGION,
      service: OPENSEARCH_SIGNING_SERVICE,
      getCredentials: () => defaultProvider()(),
    }),
    node: buildOpenSearchNode(),
    requestTimeout: Number.isFinite(OPENSEARCH_TIMEOUT_MS) && OPENSEARCH_TIMEOUT_MS > 0
      ? OPENSEARCH_TIMEOUT_MS
      : 5000,
    maxRetries: 0,
  });
}

export function getOpenSearchClient(): Client {
  if (!cachedClient) cachedClient = createOpenSearchClient();
  return cachedClient;
}

export function buildOpenSearchIndexBody(dimension = EMBEDDING_VECTOR_SIZE): Record<string, unknown> {
  return {
    settings: {
      index: {
        knn: true,
      },
    },
    mappings: {
      dynamic: true,
      properties: {
        [OPENSEARCH_VECTOR_FIELD]: {
          type: "knn_vector",
          dimension,
          method: {
            name: "hnsw",
            engine: "faiss",
            space_type: OPENSEARCH_SPACE_TYPE,
          },
        },
        payload: { type: "object", enabled: true },
        text: { type: "text" },
        content: { type: "text" },
        title: { type: "text", fields: { keyword: { type: "keyword" } } },
        source_url: { type: "keyword" },
        source_type: { type: "keyword" },
        source_file: { type: "keyword" },
        category: { type: "keyword" },
        topic: { type: "keyword" },
        evidence_level: { type: "keyword" },
        tags: { type: "keyword" },
        chunk_id: { type: "keyword" },
        document_id: { type: "keyword" },
        source_name: { type: "keyword" },
        source_tier: { type: "keyword" },
        language: { type: "keyword" },
        typeOfEquipment: { type: "keyword" },
        typeOfActivity: { type: "keyword" },
        bodyPart: { type: "keyword" },
        exerciseName: { type: "text", fields: { keyword: { type: "keyword" } } },
        trust_score: { type: "float" },
        quality_score: { type: "float" },
        chunk_index: { type: "integer" },
        total_chunks: { type: "integer" },
        published_at: { type: "date", ignore_malformed: true },
      },
    },
  };
}

function readOpenSearchDimension(mapping: unknown): number | null {
  const properties = (mapping as { mappings?: { properties?: Record<string, unknown> } })
    ?.mappings?.properties;
  const vector = properties?.[OPENSEARCH_VECTOR_FIELD] as { dimension?: unknown; type?: unknown } | undefined;
  return vector?.type === "knn_vector" && typeof vector.dimension === "number"
    ? vector.dimension
    : null;
}

function isMissingIndex(err: unknown): boolean {
  const statusCode = (err as { statusCode?: unknown; meta?: { statusCode?: unknown } })?.statusCode
    ?? (err as { meta?: { statusCode?: unknown } })?.meta?.statusCode;
  if (statusCode === 404) return true;
  const name = (err as { name?: unknown })?.name;
  return name === "index_not_found_exception" || /index_not_found|not\s*found/i.test(String((err as Error)?.message ?? err));
}

export function normalizeOpenSearchCosineScore(score: number): number {
  // OpenSearch k-NN cosine scores are provider-specific positive _score values,
  // not the same contract as Qdrant. For FAISS cosine distance, the common
  // score transform is 1 / (1 + distance), where cosine distance = 1 - cosine.
  // Invert that into cosine-like similarity so RAG_MIN_SCORE remains a 0..1
  // threshold. Clamp because engines can return tiny floating overshoots.
  if (!Number.isFinite(score) || score <= 0) return 0;
  const distance = (1 / score) - 1;
  const cosine = 1 - distance;
  return Math.max(0, Math.min(1, cosine));
}

function translateFilter(filter?: VectorSearchFilter): Record<string, unknown> | undefined {
  if (!filter) return undefined;
  const mustNot = Array.isArray(filter.must_not) ? filter.must_not : [];
  const translatedMustNot = mustNot
    .map((clause) => {
      const key = (clause as { key?: unknown })?.key;
      const any = (clause as { match?: { any?: unknown } })?.match?.any;
      if (typeof key === "string" && Array.isArray(any)) {
        return { terms: { [key]: any } };
      }
      const value = (clause as { match?: { value?: unknown } })?.match?.value;
      if (typeof key === "string" && value !== undefined) {
        return { term: { [key]: value } };
      }
      return null;
    })
    .filter(Boolean);
  return translatedMustNot.length > 0 ? { must_not: translatedMustNot } : undefined;
}

export function buildOpenSearchKnnQuery(args: {
  vector: number[];
  limit: number;
  filter?: VectorSearchFilter;
}): Record<string, unknown> {
  const knn = {
    knn: {
      [OPENSEARCH_VECTOR_FIELD]: {
        vector: args.vector,
        k: args.limit,
      },
    },
  };
  const filter = translateFilter(args.filter);
  if (!filter) return knn;
  return {
    bool: {
      must: [knn],
      ...filter,
    },
  };
}

export class OpenSearchVectorStore implements VectorStore {
  readonly provider = "opensearch" as const;

  constructor(private readonly client: Client = getOpenSearchClient()) {}

  async healthCheck(): Promise<void> {
    await this.client.cat.indices({ format: "json" });
  }

  async getIndexStatus(
    index: string,
    expectedSize = EMBEDDING_VECTOR_SIZE,
  ): Promise<VectorIndexStatus> {
    try {
      const response = await this.client.indices.getMapping({ index });
      const mappingByIndex = (response.body ?? response) as Record<string, unknown>;
      const indexMapping = (mappingByIndex[index] ?? response.body ?? response) as unknown;
      const actual = readOpenSearchDimension(indexMapping);
      return actual === expectedSize
        ? { kind: "ok", size: actual }
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
      if (!isMissingIndex(err)) throw err;
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
    await this.client.indices.create({
      index,
      body: buildOpenSearchIndexBody(expectedSize),
    });
    return { size: expectedSize, created: true };
  }

  async search(
    index: string,
    args: { vector: number[]; limit: number; filter?: VectorSearchFilter },
  ): Promise<VectorSearchResult[]> {
    const response = await this.client.search({
      index,
      body: {
        size: args.limit,
        query: buildOpenSearchKnnQuery(args),
      },
    });
    const hits = ((response.body as { hits?: { hits?: unknown[] } })?.hits?.hits ?? []) as Array<{
      _id?: string;
      _score?: number;
      _source?: Record<string, unknown>;
    }>;
    return hits.map((hit) => {
      const rawScore = typeof hit._score === "number" ? hit._score : 0;
      const source = hit._source ?? {};
      return {
        id: String(hit._id ?? source.id ?? ""),
        similarity: normalizeOpenSearchCosineScore(rawScore),
        rawScore,
        payload: (source.payload as Record<string, unknown> | undefined) ?? source,
      };
    });
  }

  async upsert(index: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    const body = points.flatMap((point) => [
      { index: { _index: index, _id: point.id } },
      {
        ...point.payload,
        id: point.id,
        payload: point.payload,
        [OPENSEARCH_VECTOR_FIELD]: point.vector,
      },
    ]);
    const response = await this.client.bulk({ refresh: false, body });
    const responseBody = (response.body ?? response) as { errors?: boolean };
    if (responseBody.errors) {
      throw new Error("OpenSearch bulk upsert completed with item errors");
    }
  }
}
