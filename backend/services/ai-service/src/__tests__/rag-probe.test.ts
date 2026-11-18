/**
 * M9.6-T7 — read-only RAG probes (status / search) and the --ensure-empty-indexes flag. TEST FIXTURE: in-memory fakes, no AWS, no model, no network.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/rag-probe.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { probeSearch, probeStatus, toProbeHit, type ProbeStore } from "../datasets/seed/rag-probe";
import { LOADERS, resolveDataRoot, selectDocs, sha256, type IngestDoc } from "../datasets/seed/rag-ingest-core";
import { parseIngestArgs, runIngest, type IngestStore } from "../datasets/seed/rag-ingest-runner";

const ROOT = resolveDataRoot(__dirname);
const docs: IngestDoc[] = [...selectDocs(LOADERS.exercises(ROOT), "demo").docs.slice(0, 4), ...selectDocs(LOADERS.evidence(ROOT), "demo").docs.slice(0, 3)];
const vec = (t: string) => { const h = sha256(t); return Array.from({ length: 1024 }, (_, i) => (parseInt(h[i % 64], 16) - 7.5) / 8); };

function fakeProbeStore(present: Set<string>, over: Partial<ProbeStore> = {}): ProbeStore {
  return {
    async countDocuments(index) { return docs.filter((d) => `${d.index}` === index && present.has(d.id)).length; },
    async getDocument(_i, id) { return present.has(id) ? { found: true, id, via: "get", payload: {} } : { found: false, id: null, via: "get", payload: null }; },
    async describeIndex() { return { ok: true, dimension: 1024 }; },
    async search() { return []; }, ...over,
  };
}
test("PROBE-1 status: reports per index expected / found / missing ids and count; a partially written bulk shows exactly which ids are missing (no blind retry)", async () => {
  const some = new Set(docs.filter((d) => d.dataset === "exercises").slice(0, 3).map((d) => d.id)); const r = await probeStatus(docs, fakeProbeStore(some));
  const ex = r.find((x) => x.index === "exercises")!, ev = r.find((x) => x.index === "fitness_evidence")!;
  assert.deepEqual([ex.expected, ex.found, ex.missingIds.length, ex.count, ex.countMatchesExpected], [4, 3, 1, 3, false]); assert.deepEqual([ev.expected, ev.found, ev.missingIds.length, ev.count], [3, 0, 3, 0]);
  const all = await probeStatus(docs, fakeProbeStore(new Set(docs.map((d) => d.id)))); assert.ok(all.every((x) => x.found === x.expected && x.countMatchesExpected === true && x.missingIds.length === 0));
  const dup = await probeStatus(docs, fakeProbeStore(new Set(docs.map((d) => d.id)), { async countDocuments(i) { return docs.filter((d) => d.index === i).length + 1; } })); assert.ok(dup.every((x) => x.countMatchesExpected === false), "a count above the expected number (duplicate) is flagged");
  const nomap = await probeStatus(docs, fakeProbeStore(new Set(), { async describeIndex() { return { ok: false, dimension: null, error: { status: 404, type: "index_not_found_exception" } }; } })); assert.ok(nomap.every((x) => !x.mappingOk && x.found === 0 && x.mappingError?.status === 404));
});
test("PROBE-2 search: embeds each question once, queries every index, returns ids / similarity / source metadata / a 160-char snippet and per-request timings; an index error is reported, not thrown", async () => {
  let clock = 0; const embedded: string[] = [];
  const store = fakeProbeStore(new Set(), { async search(index) { clock += index === "exercises" ? 7000 : 40; if (index === "fitness_faq") throw Object.assign(new Error("index_not_found_exception: nope SECRET"), { statusCode: 404 }); return [{ id: `${index}-1`, similarity: 0.83219, payload: { exerciseName: "Plank", instructions: "Hold   a straight line ".repeat(30), source_type: "exercise_catalog", document_id: "Plank", source_file: "x.csv" } }, { id: `${index}-2`, similarity: 0.5, payload: { title: "T", content: "C", source_url: "https://pubmed.ncbi.nlm.nih.gov/1/", evidence_level: "systematic_review" } }]; } });
  const r = await probeSearch([{ q: "q1", group: "g" }], ["exercises", "fitness_faq", "fitness_evidence"], 2, { store, embedQuery: async (q) => { embedded.push(q); clock += 100; return vec(q); }, now: () => clock });
  assert.deepEqual(embedded, ["q1"]); assert.equal(r[0].embedMs, 100); const [ex, faq, ev] = r[0].perIndex;
  assert.equal(ex.ms, 7000, "a slow (cold) index shows up in its timing"); assert.deepEqual(faq.error, { status: 404, type: "index_not_found_exception" }); assert.deepEqual(faq.hits, []);
  assert.deepEqual([ex.hits[0].rank, ex.hits[0].similarity, ex.hits[0].title, ex.hits[0].sourceType, ex.hits[0].documentId], [1, 0.8322, "Plank", "exercise_catalog", "Plank"]); assert.ok(ex.hits[0].snippet.length <= 160 && !/\s{2}/.test(ex.hits[0].snippet));
  assert.deepEqual([ev.hits[1].sourceUrl, ev.hits[1].evidenceLevel, ev.hits[1].title], ["https://pubmed.ncbi.nlm.nih.gov/1/", "systematic_review", "T"]); assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.equal(toProbeHit(1, { id: "a", similarity: 1 }).snippet, "");
});
test("PROBE-3 --ensure-empty-indexes creates the mapping-only index for a dataset with no documents (fitness_faq in the demo profile) and writes nothing to it; without the flag it does not", async () => {
  const made: string[] = []; const written: Record<string, number> = {};
  const store: IngestStore = { provider: "fake", async ensureIndex(i) { made.push(i); return { size: 1024, created: true }; }, async upsert(i, p) { written[i] = (written[i] ?? 0) + p.length; }, async getIndexStatus() { return { kind: "missing" }; } };
  const embed = async (t: string[]) => t.map(vec); const log = () => undefined;
  await runIngest(parseIngestArgs(["--profile=demo", "--dataset=exercises,faq", "--limit=2"]), { store, embed, log }); assert.deepEqual(made, ["exercises"]);
  made.length = 0; const r = await runIngest(parseIngestArgs(["--profile=demo", "--dataset=exercises,faq", "--limit=2", "--ensure-empty-indexes"]), { store, embed, log });
  assert.deepEqual(made.sort(), ["exercises", "fitness_faq"]); assert.equal(r.written.fitness_faq, 0); assert.equal(written.fitness_faq, undefined);
});
test("PROBE-4 the handler validates status / search events before touching AWS", async () => {
  const { handler } = await import("../ingest-lambda");
  await assert.rejects(handler({ mode: "status" }), /needs event\.corpusJsonl/);
  await assert.rejects(handler({ mode: "search" }), /1\.\.20 event\.queries/); await assert.rejects(handler({ mode: "search", queries: [] }), /1\.\.20/); await assert.rejects(handler({ mode: "search", queries: Array.from({ length: 21 }, () => ({ q: "x" })) }), /1\.\.20/);
});
