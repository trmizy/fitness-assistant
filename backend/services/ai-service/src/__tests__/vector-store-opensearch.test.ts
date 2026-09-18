import test from "node:test";
import assert from "node:assert/strict";
import { resolveVectorStoreProvider } from "../vector-store/types";
import { QdrantVectorStore } from "../vector-store/qdrant-vector-store";
import {
  OPENSEARCH_SIGNING_SERVICE,
  OPENSEARCH_SPACE_TYPE,
  OpenSearchVectorStore,
  buildOpenSearchIndexBody,
  buildOpenSearchNode,
  normalizeOpenSearchCosineScore,
} from "../vector-store/opensearch-vector-store";

function fakeOpenSearchClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    cat: {
      async indices(args: unknown) {
        calls.push({ name: "cat.indices", args });
        return { body: [] };
      },
    },
    indices: {
      async getMapping(args: { index: string }) {
        calls.push({ name: "indices.getMapping", args });
        const fn = overrides.getMapping as ((args: { index: string }) => unknown) | undefined;
        if (fn) return fn(args);
        return {
          body: {
            [args.index]: {
              mappings: {
                properties: {
                  vector: { type: "knn_vector", dimension: 1024 },
                },
              },
            },
          },
        };
      },
      async create(args: unknown) {
        calls.push({ name: "indices.create", args });
        const fn = overrides.create as ((args: unknown) => unknown) | undefined;
        return fn ? fn(args) : { body: { acknowledged: true } };
      },
    },
    async search(args: unknown) {
      calls.push({ name: "search", args });
      const fn = overrides.search as ((args: unknown) => unknown) | undefined;
      return fn
        ? fn(args)
        : {
            body: {
              hits: {
                hits: [
                  { _id: "p1", _score: 1, _source: { payload: { text: "doc", typeOfEquipment: "Dumbbell" } } },
                ],
              },
            },
          };
    },
    async bulk(args: unknown) {
      calls.push({ name: "bulk", args });
      const fn = overrides.bulk as ((args: unknown) => unknown) | undefined;
      return fn ? fn(args) : { body: { errors: false } };
    },
  };
  return { client: client as any, calls };
}

test("provider selection supports qdrant default and opensearch explicitly", () => {
  assert.equal(resolveVectorStoreProvider({}), "qdrant");
  assert.equal(resolveVectorStoreProvider({ VECTOR_STORE_PROVIDER: "qdrant" }), "qdrant");
  assert.equal(resolveVectorStoreProvider({ VECTOR_STORE_PROVIDER: "opensearch" }), "opensearch");
  assert.throws(
    () => resolveVectorStoreProvider({ VECTOR_STORE_PROVIDER: "pinecone" }),
    /Unsupported VECTOR_STORE_PROVIDER/,
  );
  assert.equal(new QdrantVectorStore().provider, "qdrant");
});

test("OpenSearch client config is endpoint-driven and uses SigV4 service aoss", () => {
  assert.equal(OPENSEARCH_SIGNING_SERVICE, "aoss");
  assert.equal(buildOpenSearchNode("abc123.ap-southeast-1.aoss.amazonaws.com"), "https://abc123.ap-southeast-1.aoss.amazonaws.com");
  assert.equal(buildOpenSearchNode("https://abc123.ap-southeast-1.aoss.amazonaws.com"), "https://abc123.ap-southeast-1.aoss.amazonaws.com");
  assert.throws(() => buildOpenSearchNode(undefined), /OPENSEARCH_SERVERLESS_ENDPOINT is required/);
});

test("OpenSearch index mapping uses 1024-dim faiss hnsw cosine and filterable metadata fields", () => {
  const body = buildOpenSearchIndexBody(1024) as any;
  const vector = body.mappings.properties.vector;
  assert.equal(body.settings.index.knn, true);
  assert.equal(vector.type, "knn_vector");
  assert.equal(vector.dimension, 1024);
  assert.equal(vector.method.engine, "faiss");
  assert.equal(vector.method.name, "hnsw");
  assert.equal(vector.method.space_type, OPENSEARCH_SPACE_TYPE);
  assert.equal(body.mappings.properties.typeOfEquipment.type, "keyword");
  assert.equal(body.mappings.properties.document_id.type, "keyword");
  assert.equal(body.mappings.properties.trust_score.type, "float");
});

test("OpenSearch ensureIndex verifies existing index and creates only when missing", async () => {
  const ok = fakeOpenSearchClient();
  const store = new OpenSearchVectorStore(ok.client);
  assert.deepEqual(await store.ensureIndex("fitness_evidence", 1024), { size: 1024, created: false });
  assert.equal(ok.calls.some((c) => c.name === "indices.create"), false);

  const missing = fakeOpenSearchClient({
    getMapping() {
      throw Object.assign(new Error("index_not_found_exception"), { meta: { statusCode: 404 } });
    },
  });
  const missingStore = new OpenSearchVectorStore(missing.client);
  assert.deepEqual(await missingStore.ensureIndex("fitness_evidence", 1024), { size: 1024, created: true });
  const createCall = missing.calls.find((c) => c.name === "indices.create")!;
  assert.equal((createCall.args as any).body.mappings.properties.vector.dimension, 1024);
});

test("OpenSearch dimension mismatch fails safely and never recreates the index", async () => {
  const fake = fakeOpenSearchClient({
    getMapping(args: { index: string }) {
      return {
        body: {
          [args.index]: {
            mappings: { properties: { vector: { type: "knn_vector", dimension: 768 } } },
          },
        },
      };
    },
  });
  const store = new OpenSearchVectorStore(fake.client);
  await assert.rejects(store.ensureIndex("fitness_evidence", 1024), /expected 1024.*768.*Reindex is required/i);
  assert.equal(fake.calls.some((c) => c.name === "indices.create"), false);
});

test("OpenSearch search builds k-NN query, preserves payload, filter, and normalized similarity", async () => {
  const fake = fakeOpenSearchClient();
  const store = new OpenSearchVectorStore(fake.client);
  const results = await store.search("exercises", {
    vector: [0.1, 0.2],
    limit: 5,
    filter: { must_not: [{ key: "typeOfEquipment", match: { any: ["Machine", "Barbell"] } }] },
  });

  assert.equal(results[0].id, "p1");
  assert.equal(results[0].similarity, 1);
  assert.deepEqual(results[0].payload, { text: "doc", typeOfEquipment: "Dumbbell" });
  const searchCall = fake.calls.find((c) => c.name === "search")!;
  assert.deepEqual((searchCall.args as any).body.query.bool.must[0].knn.vector.vector, [0.1, 0.2]);
  assert.deepEqual((searchCall.args as any).body.query.bool.must_not[0].terms.typeOfEquipment, ["Machine", "Barbell"]);
});

test("OpenSearch upsert uses bulk and stores vector plus payload without delete-index permission", async () => {
  const fake = fakeOpenSearchClient();
  const store = new OpenSearchVectorStore(fake.client);
  await store.upsert("fitness_evidence", [
    { id: "v1", vector: [0.1, 0.2], payload: { text: "hello", document_id: "doc1" } },
  ]);
  const bulk = fake.calls.find((c) => c.name === "bulk")!;
  const body = (bulk.args as any).body;
  assert.deepEqual(body[0], { index: { _index: "fitness_evidence", _id: "v1" } });
  assert.deepEqual(body[1].vector, [0.1, 0.2]);
  assert.deepEqual(body[1].payload, { text: "hello", document_id: "doc1" });
  assert.equal(fake.calls.some((c) => /delete/i.test(c.name)), false);
});

test("OpenSearch errors propagate for 403, 429, timeout, and bulk item failures", async () => {
  for (const err of [
    Object.assign(new Error("Forbidden"), { meta: { statusCode: 403 } }),
    Object.assign(new Error("Too Many Requests"), { meta: { statusCode: 429 } }),
    Object.assign(new Error("Request timed out"), { name: "TimeoutError" }),
  ]) {
    const fake = fakeOpenSearchClient({ search() { throw err; } });
    await assert.rejects(
      new OpenSearchVectorStore(fake.client).search("fitness_evidence", { vector: [1], limit: 1 }),
      err,
    );
  }

  const bulkError = fakeOpenSearchClient({ bulk() { return { body: { errors: true } }; } });
  await assert.rejects(
    new OpenSearchVectorStore(bulkError.client).upsert("fitness_evidence", [
      { id: "v1", vector: [1], payload: {} },
    ]),
    /bulk upsert/,
  );
});

test("OpenSearch score normalization keeps RAG_MIN_SCORE on a 0..1 similarity contract", () => {
  assert.equal(normalizeOpenSearchCosineScore(1), 1);
  assert.equal(normalizeOpenSearchCosineScore(0), 0);
  assert.ok(normalizeOpenSearchCosineScore(0.5) >= 0);
  assert.ok(normalizeOpenSearchCosineScore(2) <= 1);
});
