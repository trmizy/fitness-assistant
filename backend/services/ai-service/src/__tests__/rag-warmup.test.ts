/**
 * M9.6-T8 — OpenSearch pre-warm check. TEST FIXTURE: in-memory fakes, no AWS, no Bedrock / Cohere, no network. Proves that a timed-out round is never evidence of readiness, that readiness needs
 * consecutive passing rounds with real documents, that polling is bounded and pays for ONE embedding, and that the result never carries vectors or document text beyond a short snippet.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/rag-warmup.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runWarmup, type WarmupStore } from "../datasets/seed/rag-warmup";

const INDEXES = ["exercises", "fitness_knowledge", "fitness_evidence", "fitness_faq"];
const hit = (id: string) => ({ id, similarity: 0.8123456, payload: { exerciseName: `Doc ${id}`, instructions: "x".repeat(400), source_type: "exercise_catalog" } });
const never = <T>() => new Promise<T>(() => undefined);

interface Plan { slowRounds?: Record<string, number>; failMappingRounds?: Record<string, number>; empty?: string[]; failPassAtRound?: number }
function fake(plan: Plan = {}) {
  const calls = { describe: 0, search: 0, embed: 0, sleeps: 0 }; const seen: Record<string, number> = {};
  const store: WarmupStore = {
    async describeIndex(index) {
      calls.describe++; seen[index] = (seen[index] ?? 0) + 1; const r = seen[index];
      if (r <= (plan.failMappingRounds?.[index] ?? 0)) return { ok: false, dimension: null, error: { status: 401, type: "authentication_exception" } };
      if (r <= (plan.slowRounds?.[index] ?? 0)) return never();
      return { ok: true, dimension: 1024 };
    },
    async search(index) { calls.search++; return (plan.empty ?? ["fitness_faq"]).includes(index) ? [] : [hit(`${index}-1`), hit(`${index}-2`)]; },
  };
  let clock = 0;
  const deps = { store, embedQuery: async () => { calls.embed++; return [0.1, 0.2, 0.3]; }, now: () => clock, sleep: async (ms: number) => { calls.sleeps++; clock += ms; } };
  return { deps, calls, tick: (ms: number) => { clock += ms; } };
}
const base = { indexes: INDEXES, emptyOkIndexes: ["fitness_faq"], query: "q", attemptTimeoutMs: 20, pollIntervalMs: 250 };

test("WARM-1 already warm: ready after the required consecutive passes, wasCold=false, ONE embedding, real documents verified in every non-empty index (the empty faq index is accepted)", async () => {
  const f = fake(); const r = await runWarmup({ ...base, requiredConsecutivePasses: 2 }, f.deps);
  assert.equal(r.ok, true); assert.equal(r.reason, "ready"); assert.equal(r.wasCold, false); assert.equal(r.rounds.length, 2); assert.equal(r.failedRounds, 0); assert.equal(f.calls.embed, 1);
  assert.deepEqual(r.verification.map((v) => [v.index, v.ok, v.hits.length]), [["exercises", true, 2], ["fitness_knowledge", true, 2], ["fitness_evidence", true, 2], ["fitness_faq", true, 0]]);
  assert.ok(r.readyAtMs !== null && r.firstPassAtMs === 0);
});
test("WARM-2 cold then warm: rounds that time out are recorded as FAILED evidence-free rounds, readiness only after consecutive passes AFTER them, and the warm-up time is reported", async () => {
  const f = fake({ slowRounds: { fitness_evidence: 2 } }); const r = await runWarmup({ ...base, requiredConsecutivePasses: 2 }, f.deps);
  assert.equal(r.ok, true); assert.equal(r.wasCold, true); assert.equal(r.failedRounds, 2);
  assert.deepEqual(r.rounds.map((x) => x.pass), [false, false, true, true]);
  const failed = r.rounds[0].indexes.find((i) => i.index === "fitness_evidence")!; assert.equal(failed.mapping, "timeout"); assert.equal(failed.pass, false);
  assert.equal(f.calls.embed, 1, "polling never pays for another embedding");
  assert.ok(r.firstPassAtMs !== null && r.firstPassAtMs >= 500, `first pass only after two 250 ms pauses, got ${r.firstPassAtMs}`); assert.ok(r.readyAtMs! > r.firstPassAtMs!);
  assert.ok(r.verification.every((v) => v.ok), "the verification comes from a PASSING round, never from the timed-out one");
});
test("WARM-3 a pass followed by a failure resets the consecutive counter (one lucky request is not readiness)", async () => {
  let round = 0; const f = fake(); const orig = f.deps.store.describeIndex.bind(f.deps.store);
  f.deps.store.describeIndex = async (index) => { if (index === "exercises") round++; return round === 2 ? never() : orig(index); };
  const r = await runWarmup({ ...base, requiredConsecutivePasses: 2 }, f.deps);
  assert.deepEqual(r.rounds.map((x) => x.pass), [true, false, true, true]); assert.equal(r.ok, true); assert.equal(r.rounds.length, 4);
});
test("WARM-4 never warms: polling stops at the bound, ok=false, reason max_wait_exceeded, no verification claimed", async () => {
  const f = fake({ slowRounds: { exercises: 999 } }); const r = await runWarmup({ ...base, maxWaitMs: 1000, requiredConsecutivePasses: 2 }, f.deps);
  assert.equal(r.ok, false); assert.equal(r.reason, "max_wait_exceeded"); assert.equal(r.readyAtMs, null); assert.deepEqual(r.verification, []);
  assert.ok(r.rounds.length >= 2 && r.rounds.length <= 5, `bounded, got ${r.rounds.length} rounds`); assert.ok(r.rounds.every((x) => !x.pass)); assert.equal(f.calls.embed, 1);
});
test("WARM-5 an index that answers but returns NO documents fails the round unless it is declared empty-by-design; a mapping error (e.g. 401) fails with its status only", async () => {
  const a = await runWarmup({ ...base, maxWaitMs: 500 }, fake({ empty: ["fitness_faq", "exercises"] }).deps);
  assert.equal(a.ok, false); assert.equal(a.rounds[0].indexes.find((i) => i.index === "exercises")!.hits, 0);
  const b = await runWarmup({ ...base, maxWaitMs: 500 }, fake({ failMappingRounds: { exercises: 99 } }).deps);
  assert.equal(b.ok, false); assert.deepEqual(b.rounds[0].indexes.find((i) => i.index === "exercises")!.error, { status: 401, type: "authentication_exception" });
});
test("WARM-6 embedding failure stops before any OpenSearch call; the result carries only the error type", async () => {
  const f = fake(); f.deps.embedQuery = async () => { throw new Error("ThrottlingException: Rate exceeded SECRET-BODY"); };
  const r = await runWarmup({ ...base }, f.deps);
  assert.equal(r.ok, false); assert.equal(r.reason, "embedding_failed"); assert.deepEqual(r.embeddingError, { type: "ThrottlingException" }); assert.equal(f.calls.describe + f.calls.search, 0); assert.ok(!JSON.stringify(r).includes("SECRET-BODY"));
});
test("WARM-7 the result is evidence-safe: hit metadata with a snippet of at most 160 characters, no vector, no full payload text", async () => {
  const r = await runWarmup({ ...base, requiredConsecutivePasses: 1 }, fake().deps); const text = JSON.stringify(r);
  assert.ok(!text.includes("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "snippet is cut at 160");
  assert.ok(!text.includes("0.1,0.2,0.3") && !/"vector"/.test(text));
  const h = r.verification[0].hits[0]; assert.deepEqual([h.rank, h.id, h.similarity, h.title, h.sourceType], [1, "exercises-1", 0.8123, "Doc exercises-1", "exercise_catalog"]); assert.ok(h.snippet.length <= 160);
});
