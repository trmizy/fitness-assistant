/**
 * Embedding dimension configuration and the Qdrant collection guard that
 * keeps 768-dim (Ollama nomic-embed-text) and 1024-dim (Bedrock Cohere Embed
 * Multilingual v3) vectors from ever sharing a collection. Pure functions and
 * an in-memory fake Qdrant client — no network, no AWS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EmbeddingDimensionError,
  assertEmbeddingDimension,
  resolveEmbeddingProvider,
  resolveEmbeddingVectorSize,
} from "../services/embedding-config";
import {
  VectorDimensionMismatchError,
  ensureCollectionDimension,
  getCollectionDimensionStatus,
  readCollectionVectorSize,
} from "../repositories/qdrant-collection";

function fakeClient(collections: Record<string, number>) {
  const created: Array<{ name: string; size: number }> = [];
  const client = {
    async getCollection(name: string) {
      if (!(name in collections)) {
        throw Object.assign(new Error(`Not found: Collection \`${name}\` doesn't exist!`), { status: 404 });
      }
      return { config: { params: { vectors: { size: collections[name], distance: "Cosine" } } } };
    },
    async createCollection(name: string, body: any) {
      created.push({ name, size: body.vectors.size });
      collections[name] = body.vectors.size;
      return true;
    },
  };
  return { client: client as any, created };
}

test("provider defaults preserve pre-existing behaviour", () => {
  assert.equal(resolveEmbeddingProvider({}), "ollama");
  assert.equal(resolveEmbeddingProvider({ LLM_PROVIDER: "mock" }), "mock");
  assert.equal(resolveEmbeddingProvider({ LLM_PROVIDER: "anthropic" }), "ollama");
  assert.equal(resolveEmbeddingProvider({ EMBEDDING_PROVIDER: "bedrock" }), "bedrock");
  assert.throws(() => resolveEmbeddingProvider({ EMBEDDING_PROVIDER: "openai" }), /Unsupported EMBEDDING_PROVIDER/);
});

test("vector size: 1024 for Bedrock Cohere, 768 for Ollama, configurable", () => {
  assert.equal(resolveEmbeddingVectorSize({ EMBEDDING_PROVIDER: "bedrock" }), 1024);
  assert.equal(resolveEmbeddingVectorSize({ EMBEDDING_PROVIDER: "ollama" }), 768);
  assert.equal(resolveEmbeddingVectorSize({}), 768);
  assert.equal(resolveEmbeddingVectorSize({ EMBEDDING_PROVIDER: "ollama", KNOWLEDGE_VECTOR_SIZE: "1024" }), 1024);
  assert.equal(
    resolveEmbeddingVectorSize({ EMBEDDING_PROVIDER: "bedrock", KNOWLEDGE_VECTOR_SIZE: "1024" }),
    1024,
  );
});

test("vector size: a 768 setting with Bedrock Cohere is rejected up front", () => {
  assert.throws(
    () => resolveEmbeddingVectorSize({ EMBEDDING_PROVIDER: "bedrock", KNOWLEDGE_VECTOR_SIZE: "768" }),
    /does not match cohere\.embed-multilingual-v3, which always returns 1024/,
  );
  assert.throws(() => resolveEmbeddingVectorSize({ KNOWLEDGE_VECTOR_SIZE: "abc" }), /positive integer/);
});

test("assertEmbeddingDimension rejects a vector of the wrong size", () => {
  assert.doesNotThrow(() => assertEmbeddingDimension(new Array(1024).fill(0), 1024));
  assert.throws(() => assertEmbeddingDimension(new Array(768).fill(0), 1024), EmbeddingDimensionError);
});

test("readCollectionVectorSize reads Qdrant's unnamed-vector config", () => {
  assert.equal(readCollectionVectorSize({ config: { params: { vectors: { size: 1024 } } } }), 1024);
  assert.equal(readCollectionVectorSize({ config: { params: { vectors: { dense: { size: 768 } } } } }), null);
  assert.equal(readCollectionVectorSize({}), null);
});

test("ensureCollectionDimension creates a missing collection at the configured size", async () => {
  const { client, created } = fakeClient({});
  const result = await ensureCollectionDimension("fitness_evidence", { client, expectedSize: 1024 });
  assert.deepEqual(result, { size: 1024, created: true });
  assert.deepEqual(created, [{ name: "fitness_evidence", size: 1024 }]);
});

test("ensureCollectionDimension verifies a matching collection without touching it", async () => {
  const { client, created } = fakeClient({ fitness_evidence: 1024 });
  const result = await ensureCollectionDimension("fitness_evidence", { client, expectedSize: 1024 });
  assert.deepEqual(result, { size: 1024, created: false });
  assert.equal(created.length, 0);
});

test("ensureCollectionDimension refuses a 768-dim collection when 1024 is configured, and never recreates it", async () => {
  const collections = { fitness_evidence: 768 };
  const { client, created } = fakeClient(collections);
  await assert.rejects(
    ensureCollectionDimension("fitness_evidence", { client, expectedSize: 1024 }),
    (err: unknown) => {
      assert.ok(err instanceof VectorDimensionMismatchError);
      assert.equal(err.actual, 768);
      assert.equal(err.expected, 1024);
      assert.match(err.message, /Reindex is required/);
      return true;
    },
  );
  assert.equal(created.length, 0);
  assert.equal(collections.fitness_evidence, 768, "existing collection left unmodified");
});

test("a transient Qdrant error is rethrown, never mistaken for a missing collection", async () => {
  const client = {
    async getCollection() {
      throw Object.assign(new Error("connect ECONNREFUSED"), { status: undefined });
    },
    async createCollection() {
      throw new Error("must not be called");
    },
  };
  await assert.rejects(
    getCollectionDimensionStatus("fitness_evidence", { client: client as any, expectedSize: 1024 }),
    /ECONNREFUSED/,
  );
});
