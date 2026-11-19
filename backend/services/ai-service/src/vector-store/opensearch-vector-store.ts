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

/**
 * Index mapping profile. "classic" (DEFAULT, unchanged since the first OpenSearch rollout): explicit faiss / hnsw method with the space type inside `method`.
 * "nextgen" (opt-in via OPENSEARCH_INDEX_PROFILE=nextgen): the form AWS documents for NextGen vector collections (`*.aoss.<region>.on.aws`): NextGen needs no `engine` / `mode`, the
 * space type sits on the field, `method` only names the algorithm. Which profile the live collection accepts is verified by the one-document canary; search is unaffected by the choice.
 */
export type OpenSearchIndexProfile = "classic" | "nextgen";
export function resolveOpenSearchIndexProfile(env: NodeJS.ProcessEnv = process.env): OpenSearchIndexProfile {
  const raw = (env.OPENSEARCH_INDEX_PROFILE || "classic").trim().toLowerCase();
  if (raw === "classic" || raw === "nextgen") return raw;
  throw new Error(`Unsupported OPENSEARCH_INDEX_PROFILE "${raw}". Expected "classic" or "nextgen".`);
}
export function buildOpenSearchIndexBody(dimension = EMBEDDING_VECTOR_SIZE, profile: OpenSearchIndexProfile = resolveOpenSearchIndexProfile()): Record<string, unknown> {
  const vectorField = profile === "nextgen"
    ? { type: "knn_vector", dimension, space_type: OPENSEARCH_SPACE_TYPE, method: { name: "hnsw" } }
    : { type: "knn_vector", dimension, method: { name: "hnsw", engine: "faiss", space_type: OPENSEARCH_SPACE_TYPE } };
  return {
    settings: {
      index: {
        knn: true,
      },
    },
    mappings: {
      dynamic: true,
      properties: {
        [OPENSEARCH_VECTOR_FIELD]: vectorField,
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

  /**
   * Number of documents currently searchable in `index` (NextGen read-after-write latency is ~5 s, so a count taken right after a write can lag). Used only by the ingest tooling
   * (`--check-empty`); deliberately NOT part of `getIndexStatus`, which sits on the V1 query path. Returns null when the index is missing or the count API is unavailable.
   */
  async countDocuments(index: string): Promise<number | null> {
    try {
      const response = await this.client.count({ index });
      const n = ((response.body ?? response) as { count?: unknown }).count;
      if (typeof n === "number") return n;
    } catch {
      /* the _count API may be unavailable on a vector collection: fall back to the total hit count of a size-0 search */
    }
    try {
      const response = await this.client.search({ index, body: { size: 0, track_total_hits: true, query: { match_all: {} } } });
      const total = ((response.body ?? response) as { hits?: { total?: { value?: unknown } | number } }).hits?.total;
      const n = typeof total === "number" ? total : total?.value;
      return typeof n === "number" ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Ingest tooling only (the M9.6 canary): what the collection actually accepted for `index` — vector dimension / method / space type from the mapping and the knn setting. Never throws:
   * `error` carries only the HTTP status and error type (no request body, no document text).
   */
  async describeIndex(index: string): Promise<{ ok: boolean; dimension: number | null; vector: unknown; knn: unknown; error?: { status?: number; type?: string } }> {
    try {
      const mapping = await this.client.indices.getMapping({ index });
      const byIndex = (mapping.body ?? mapping) as Record<string, { mappings?: { properties?: Record<string, unknown> } }>;
      const props = (byIndex[index] ?? Object.values(byIndex)[0])?.mappings?.properties ?? {};
      const vector = props[OPENSEARCH_VECTOR_FIELD] as { dimension?: unknown } | undefined;
      let knn: unknown = null;
      try { const st = await this.client.indices.getSettings({ index }); const sb = (st.body ?? st) as Record<string, { settings?: { index?: { knn?: unknown } } }>; knn = (sb[index] ?? Object.values(sb)[0])?.settings?.index?.knn ?? null; } catch { /* settings may be unavailable */ }
      return { ok: true, dimension: typeof vector?.dimension === "number" ? vector.dimension : null, vector: vector ?? null, knn };
    } catch (err) {
      const e = err as { statusCode?: number; meta?: { statusCode?: number }; message?: string };
      return { ok: false, dimension: null, vector: null, knn: null, error: { status: e.statusCode ?? e.meta?.statusCode, type: String(e.message ?? "").split(":")[0].slice(0, 60) } };
    }
  }

  /** Ingest tooling only: one document by its _id (`found:false` when absent). Tries GET _doc/<id>; if the collection does not serve it, an `ids` search. `via` says which worked. */
  async getDocument(index: string, id: string): Promise<{ found: boolean; id: string | null; via: "get" | "search" | "none"; payload: Record<string, unknown> | null }> {
    try {
      const r = await this.client.get({ index, id }); const b = (r.body ?? r) as { found?: boolean; _id?: string; _source?: Record<string, unknown> };
      return b.found === false ? { found: false, id: null, via: "get", payload: null } : { found: true, id: String(b._id ?? id), via: "get", payload: ((b._source?.payload as Record<string, unknown> | undefined) ?? b._source ?? null) };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return { found: false, id: null, via: "get", payload: null };
    }
    try {
      const r = await this.client.search({ index, body: { size: 1, query: { ids: { values: [id] } } } });
      const hit = ((r.body ?? r) as { hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } }).hits?.hits?.[0];
      return hit ? { found: true, id: String(hit._id ?? id), via: "search", payload: (hit._source?.payload as Record<string, unknown> | undefined) ?? hit._source ?? null } : { found: false, id: null, via: "search", payload: null };
    } catch {
      return { found: false, id: null, via: "none", payload: null };
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
