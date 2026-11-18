/**
 * M9.6-T6 — the one-document canary logic and the OpenSearch store helpers it uses. TEST FIXTURE: in-memory fakes, no AWS, no Bedrock / Cohere, no network. These tests prove the canary
 * STOPS at its first failing step, polls with a bound instead of a fixed sleep, and cannot report idempotency without evidence; the AWS run itself is a separate, approved window.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/rag-canary.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runCanary, type CanaryStore } from "../datasets/seed/rag-canary";
import { LOADERS, resolveDataRoot, selectDocs, sha256 } from "../datasets/seed/rag-ingest-core";
import { OpenSearchVectorStore } from "../vector-store/opensearch-vector-store";

const DIM = 1024;
const ROOT = resolveDataRoot(__dirname);
const doc = selectDocs(LOADERS.exercises(ROOT), "demo").docs.find((d) => d.key === "Hanging Knee Tucks")!;
const vec = (text: string): number[] => { const h = sha256(text); return Array.from({ length: DIM }, (_, i) => (parseInt(h[i % 64], 16) - 7.5) / 8); };
const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };

interface FakeOpts { dimension?: number; visibleAfterMs?: number; appendOnReupsert?: boolean; failUpsert?: boolean; searchWrongId?: boolean; failEnsure?: boolean; neverVisible?: boolean }
function fake(o: FakeOpts = {}) {
  let clock = 0; const rows: Array<{ id: string; vector: number[]; payload: Record<string, unknown>; at: number }> = []; const calls = { ensure: 0, upsert: 0, embed: 0, sleep: 0 };
  const visible = () => (o.neverVisible ? [] : rows.filter((r) => clock - r.at >= (o.visibleAfterMs ?? 0)));
  const store: CanaryStore = {
    async ensureIndex() { calls.ensure++; if (o.failEnsure) throw Object.assign(new Error("mapper_parsing_exception: unknown parameter [engine]"), { statusCode: 400 }); return { size: o.dimension ?? DIM, created: true }; },
    async describeIndex() { return { ok: true, dimension: o.dimension ?? DIM, vector: { type: "knn_vector", dimension: o.dimension ?? DIM }, knn: "true" }; },
    async upsert(_i, pts) { calls.upsert++; if (o.failUpsert) throw Object.assign(new Error("illegal_argument_exception: custom ids unsupported"), { statusCode: 400 }); for (const p of pts) { if (!o.appendOnReupsert) { const k = rows.findIndex((r) => r.id === p.id); if (k >= 0) rows.splice(k, 1); } rows.push({ id: p.id, vector: p.vector, payload: p.payload, at: clock }); } },
    async countDocuments() { return visible().length; },
    async getDocument(_i, id) { const r = visible().filter((x) => x.id === id).pop(); return r ? { found: true, id, via: "get" as const, payload: r.payload } : { found: false, id: null, via: "get" as const, payload: null }; },
    async search(_i, { vector, limit }) { if (o.searchWrongId) return [{ id: "other", similarity: 0.4 }]; return visible().map((r) => ({ id: r.id, similarity: cos(vector, r.vector) })).sort((a, b) => b.similarity - a.similarity).slice(0, limit); },
  };
  const deps = { store, embed: async (t: string[]) => { calls.embed++; return t.map((x) => (o.dimension && o.dimension !== DIM ? vec(x).slice(0, 8) : vec(x))); }, sleep: async (ms: number) => { calls.sleep++; clock += ms; }, now: () => clock, pollIntervalMs: 1000, pollMaxMs: 10_000 };
  return { deps, calls, rows, advance: (ms: number) => { clock += ms; } };
}

test("CANARY-1 happy path: every step passes, ONE embedding call, one document id, revision 2 after the re-upsert, count stays 1", async () => {
  const f = fake({ visibleAfterMs: 5000 }); const r = await runCanary(doc, "_canary", f.deps);
  assert.equal(r.ok, true, JSON.stringify(r.steps.filter((s) => !s.ok))); assert.equal(r.failedStep, null); assert.equal(r.index, "exercises_canary");
  assert.deepEqual(r.steps.map((s) => s.step), ["mapping_accepted", "embedding_1024", "upsert_bulk_custom_id", "searchable", "vector_retrieval", "metadata_roundtrip", "reupsert_same_id", "idempotent_update"]);
  assert.equal(r.embedCalls, 1); assert.equal(f.calls.upsert, 2); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].id, doc.id);
  const idem = r.steps.find((s) => s.step === "idempotent_update")!.detail as { countBefore: number; countAfter: number; revisionAfter: number; sameIdOnly: boolean };
  assert.deepEqual([idem.countBefore, idem.countAfter, idem.revisionAfter, idem.sameIdOnly], [1, 1, 2, true]);
  const searchable = r.steps.find((s) => s.step === "searchable")!.detail as { waitedMs: number; attempts: number }; assert.ok(searchable.waitedMs >= 5000 && searchable.attempts > 1, "polled until visible instead of assuming a fixed wait");
  const meta = r.steps.find((s) => s.step === "metadata_roundtrip")!.detail as Record<string, unknown>; assert.equal(meta._id, doc.id); assert.equal(meta.document_id, "Hanging Knee Tucks");
  const text = JSON.stringify(r); assert.ok(!text.includes(doc.text.slice(0, 40)) && !text.includes("instructions"), "the result never carries document text or the vector");
});
test("CANARY-2 the canary STOPS at the first failure and never reaches later steps (mapping rejected / wrong dimension / wrong embedding size / custom id or bulk rejected)", async () => {
  const a = fake({ failEnsure: true }); const ra = await runCanary(doc, "_canary", a.deps); assert.equal(ra.ok, false); assert.equal(ra.failedStep, "mapping_accepted"); assert.deepEqual([a.calls.embed, a.calls.upsert], [0, 0]); assert.deepEqual(ra.steps[0].error, { status: 400, type: "mapper_parsing_exception" });
  const b = fake({ dimension: 768 }); const rb = await runCanary(doc, "_canary", b.deps); assert.equal(rb.failedStep, "mapping_accepted"); assert.equal(b.calls.embed, 0, "no embedding is paid for when the mapping is wrong");
  const c = fake({ dimension: DIM }); c.deps.embed = async (t) => t.map(() => [1, 2, 3]); const rc = await runCanary(doc, "_canary", c.deps); assert.equal(rc.failedStep, "embedding_1024"); assert.equal(c.calls.upsert, 0);
  const d = fake({ failUpsert: true }); const rd = await runCanary(doc, "_canary", d.deps); assert.equal(rd.failedStep, "upsert_bulk_custom_id"); assert.equal(rd.steps.length, 3); assert.equal(rd.steps[2].error?.status, 400);
});
test("CANARY-3 a document that never becomes searchable fails after the BOUNDED wait (no endless loop, no fixed-sleep assumption)", async () => {
  const f = fake({ neverVisible: true }); const r = await runCanary(doc, "_canary", f.deps); assert.equal(r.failedStep, "searchable"); const d = r.steps.at(-1)!.detail as { waitedMs: number; attempts: number; maxWaitMs: number };
  assert.ok(d.waitedMs >= 10_000 && d.waitedMs <= 12_000 && d.attempts >= 5 && d.maxWaitMs === 10_000, JSON.stringify(d)); assert.equal(f.calls.upsert, 1, "no re-upsert after a failed step");
});
test("CANARY-4 a vector search that returns another id, or a store that APPENDS instead of replacing on the same id, is a FAILURE — idempotency is never reported without the count proof", async () => {
  const a = fake({ searchWrongId: true }); const ra = await runCanary(doc, "_canary", a.deps); assert.equal(ra.failedStep, "vector_retrieval"); assert.equal(a.calls.upsert, 1);
  const b = fake({ appendOnReupsert: true }); const rb = await runCanary(doc, "_canary", b.deps); assert.equal(rb.ok, false); assert.equal(rb.failedStep, "idempotent_update"); assert.equal(b.rows.length, 2, "the fake really duplicated");
  const idem = rb.steps.at(-1)!.detail as { countAfter: number; sameIdOnly: boolean }; assert.equal(idem.countAfter, 2); assert.equal(idem.sameIdOnly, false);
});

// ── the OpenSearch store helpers used by the canary ────────────────────────────────────────────────────────────────────────────────────
const asStore = (client: unknown) => new OpenSearchVectorStore(client as never);
test("CANARY-5 describeIndex reports what the collection accepted (dimension / method / knn) and, on failure, only status + error type", async () => {
  const ok = asStore({ indices: { getMapping: async ({ index }: any) => ({ body: { [index]: { mappings: { properties: { vector: { type: "knn_vector", dimension: 1024, method: { name: "hnsw" } } } } } } }), getSettings: async ({ index }: any) => ({ body: { [index]: { settings: { index: { knn: "true" } } } } }) } });
  const d = await ok.describeIndex("exercises_canary"); assert.deepEqual([d.ok, d.dimension, d.knn], [true, 1024, "true"]); assert.deepEqual(d.vector, { type: "knn_vector", dimension: 1024, method: { name: "hnsw" } });
  const bad = asStore({ indices: { getMapping: async () => { throw Object.assign(new Error("index_not_found_exception: no such index [x] SECRET-BODY"), { statusCode: 404 }); } } });
  const e = await bad.describeIndex("x"); assert.deepEqual([e.ok, e.dimension, e.error], [false, null, { status: 404, type: "index_not_found_exception" }]);
});
test("CANARY-6 getDocument: GET _doc/<id> when served, falls back to an `ids` search, returns found:false for a missing id and never throws", async () => {
  const viaGet = await asStore({ get: async () => ({ body: { found: true, _id: "A", _source: { payload: { k: 1 } } } }) }).getDocument("i", "A"); assert.deepEqual([viaGet.found, viaGet.id, viaGet.via, viaGet.payload], [true, "A", "get", { k: 1 }]);
  const fb = await asStore({ get: async () => { throw Object.assign(new Error("not supported"), { statusCode: 400 }); }, search: async () => ({ body: { hits: { hits: [{ _id: "A", _source: { payload: { k: 2 } } }] } } }) }).getDocument("i", "A"); assert.deepEqual([fb.found, fb.via, fb.payload], [true, "search", { k: 2 }]);
  const missing = await asStore({ get: async () => { throw Object.assign(new Error("nf"), { statusCode: 404 }); } }).getDocument("i", "A"); assert.deepEqual([missing.found, missing.via], [false, "get"]);
  const none = await asStore({ get: async () => { throw new Error("x"); }, search: async () => { throw new Error("y"); } }).getDocument("i", "A"); assert.deepEqual([none.found, none.via], [false, "none"]);
});
test("CANARY-7 countDocuments: _count, else the total hits of a size-0 search, else null", async () => {
  assert.equal(await asStore({ count: async () => ({ body: { count: 4 } }) }).countDocuments("i"), 4);
  assert.equal(await asStore({ count: async () => { throw new Error("no _count"); }, search: async () => ({ body: { hits: { total: { value: 3 } } } }) }).countDocuments("i"), 3);
  assert.equal(await asStore({ count: async () => { throw new Error("a"); }, search: async () => { throw new Error("b"); } }).countDocuments("i"), null);
});
test("CANARY-8 the temp-runner handler validates a canary event before touching AWS (missing / tampered corpus, unknown key)", async () => {
  const { handler } = await import("../ingest-lambda");
  await assert.rejects(handler({ mode: "canary" }), /needs event\.corpusJsonl/);
  await assert.rejects(handler({ mode: "canary", corpusJsonl: JSON.stringify({ ...doc, text: doc.text + " x" }) }), /content hash mismatch/);
  await assert.rejects(handler({ mode: "canary", corpusJsonl: JSON.stringify(doc), canaryKey: "No Such Exercise" }), /not in the supplied corpus/);
});
