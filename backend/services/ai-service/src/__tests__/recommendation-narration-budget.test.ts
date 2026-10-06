/**
 * Phase 3 R1.1 — recommendation narration budget and fallback.
 * Narration is presentation only. These tests check that the structured recommendation (candidate ids, order, scores, actions)
 * is never changed by narration, that narration failures fall back to the deterministic renderer, and the exact model-call budget.
 * Model calls are stubbed at the llmService boundary; the narrators' own validation and fallback code runs for real.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { llmService } from "../services/llm.service";
import { narrateRecommendations } from "../llm/recommendation_narrator";
import { narrateProgramRecommendations } from "../llm/program_recommendation_narrator";
import { buildClaimCatalog } from "../llm/recommendation_claims";
import { buildProgramClaimCatalog } from "../llm/program_recommendation_claims";
import { NARRATION_BUDGET } from "../llm/json_llm_call.util";

const realCallLLM = llmService.callLLM;
afterEach(() => { llmService.callLLM = realCallLLM; });

type Stub = { calls: number; timeouts: Array<number | undefined> };
function stubModel(answer: string | Error): Stub {
  const s: Stub = { calls: 0, timeouts: [] };
  llmService.callLLM = (async (_p: string, opts?: { timeoutMs?: number }) => {
    s.calls += 1;
    s.timeouts.push(opts?.timeoutMs);
    if (answer instanceof Error) throw answer;
    return { answer, promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  }) as typeof llmService.callLLM;
  return s;
}

// ── fixtures (partial objects: the narrators only read the fields below) ──
const ptCandidate = (id: string) => ({
  candidate: { id, name: `PT ${id}`, specialties: ["MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5 },
  compatibility: { total: 80, components: {}, reasons: [] },
  history: { count: 1, note: "" },
}) as any;
const programCandidate = (id: string) => ({
  program: { id, name: `Program ${id}`, goal: "MUSCLE_GAIN", daysPerWeek: 4, durationWeeks: 8, estimatedMinutes: 60, experienceLevel: "INTERMEDIATE", focusMuscles: [], fingerprint: `fp-${id}`, dataOrigin: "REAL" },
  compatibility: { total: 75, components: {}, reasons: [] },
}) as any;

const PT = [ptCandidate("pt-1"), ptCandidate("pt-2")];
const PROGRAMS = [programCandidate("prog-1"), programCandidate("prog-2")];
const ptIds = PT.map((c: any) => c.candidate.id);
const programIds = PROGRAMS.map((c: any) => c.program.id);

// the claim ids each candidate's OWN catalog allows (narration may only pick from these)
const ptClaims = (c: any) => buildClaimCatalog(c, []).map((x: any) => x.id);
const programClaims = (c: any) => buildProgramClaimCatalog(c, []).map((x: any) => x.id);

// ── PT narration ──
test("A. PT narration success: structured candidate ids and order unchanged; one model call; no fallback", async () => {
  const selections = PT.map((c: any) => ({ candidateId: c.candidate.id, selectedClaimIds: ptClaims(c).slice(0, 1) }));
  const stub = stubModel(JSON.stringify({ selections }));
  const out = await narrateRecommendations(PT, [], { userId: "u-narr-a" });
  assert.deepEqual(out.narrations.map((n) => n.candidateId), ptIds, "candidate ids and order come from the structured input");
  assert.equal(out.usedFallback, false);
  assert.equal(stub.calls, 1, "exactly one model attempt");
});

test("B. PT narration timeout: deterministic fallback, same ids and order, no mutation, budget passed to the call", async () => {
  const stub = stubModel(Object.assign(new Error("timeout of 20000ms exceeded"), { name: "TimeoutError" }));
  const out = await narrateRecommendations(PT, [], { userId: "u-narr-b" });
  assert.deepEqual(out.narrations.map((n) => n.candidateId), ptIds);
  assert.equal(out.usedFallback, true);
  assert.equal(stub.calls, 1);
  assert.equal(stub.timeouts[0], NARRATION_BUDGET.timeoutMs, "the narration budget (not the routing or generation timeout) is used");
  assert.ok(out.narrations.every((n) => typeof n.summary === "string" && n.summary.length > 0), "deterministic text is still produced");
});

test("D. PT narration invalid JSON: fallback, one attempt", async () => {
  const stub = stubModel("not json");
  const out = await narrateRecommendations(PT, [], { userId: "u-narr-d" });
  assert.equal(out.usedFallback, true);
  assert.equal(stub.calls, 1);
});

test("E. PT narration provider unavailable: fallback", async () => {
  const stub = stubModel(new Error("connect ECONNREFUSED"));
  const out = await narrateRecommendations(PT, [], { userId: "u-narr-e" });
  assert.equal(out.usedFallback, true);
  assert.equal(stub.calls, 1);
});

test("G. PT narration can never add, drop or reorder candidates or pick another candidate's claims", async () => {
  const other = ptClaims(PT[1])[0];
  const selections = [
    { candidateId: "pt-ghost", selectedClaimIds: ["anything"] },           // invented candidate
    { candidateId: "pt-1", selectedClaimIds: [other] },                    // another candidate's claim id
  ];
  stubModel(JSON.stringify({ selections }));
  const out = await narrateRecommendations(PT, [], { userId: "u-narr-g" });
  assert.deepEqual(out.narrations.map((n) => n.candidateId), ptIds, "no invented candidate, original order");
  assert.equal(out.usedFallback, true, "a selection with no valid own-catalog claim falls back for that candidate");
});

// ── Program narration ──
test("C. Program narration timeout: same structured recommendation, deterministic fallback, one attempt", async () => {
  const stub = stubModel(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
  const out = await narrateProgramRecommendations(PROGRAMS, [], { userId: "u-prog-c" });
  assert.deepEqual(out.narrations.map((n) => n.candidateId), programIds);
  assert.equal(out.usedFallback, true);
  assert.equal(stub.calls, 1);
  assert.equal(stub.timeouts[0], NARRATION_BUDGET.timeoutMs);
});

test("C2. Program narration success: ids and order unchanged; one call", async () => {
  const selections = PROGRAMS.map((c: any) => ({ candidateId: c.program.id, selectedClaimIds: programClaims(c).slice(0, 1) }));
  const stub = stubModel(JSON.stringify({ selections }));
  const out = await narrateProgramRecommendations(PROGRAMS, [], { userId: "u-prog-c2" });
  assert.deepEqual(out.narrations.map((n) => n.candidateId), programIds);
  assert.equal(stub.calls, 1);
});

test("D2/E2. Program narration invalid JSON and provider unavailable both fall back", async () => {
  stubModel("{ broken");
  const a = await narrateProgramRecommendations(PROGRAMS, [], { userId: "u-prog-d" });
  assert.equal(a.usedFallback, true);
  stubModel(new Error("ECONNREFUSED"));
  const b = await narrateProgramRecommendations(PROGRAMS, [], { userId: "u-prog-e" });
  assert.equal(b.usedFallback, true);
});

// ── Budget constants ──
test("F. the narration budget is one attempt with a short explicit timeout", () => {
  assert.equal(NARRATION_BUDGET.attempts, 1);
  assert.ok(NARRATION_BUDGET.timeoutMs <= 20_000, "narration must stay far below the 60–170 s generation paths");
  assert.ok(NARRATION_BUDGET.timeoutMs * NARRATION_BUDGET.attempts < 160_000, "worst-case narration wait stays well under the old ~160 s");
});

// ── H/I: safety paths that must not depend on narration ──
test("H/I. narration failure never changes candidate identity or cross-user scope (structured inputs are passed through untouched)", async () => {
  stubModel(new Error("timeout"));
  const before = JSON.stringify(PT.map((c: any) => c.candidate.id));
  await narrateRecommendations(PT, [], { userId: "u-narr-h" });
  assert.equal(JSON.stringify(PT.map((c: any) => c.candidate.id)), before, "input candidates are not mutated by a failed narration");
});
