/**
 * Phase 3 Batch 3 — executor tests. Stubs only the injected BoundedTurnDeps (the structural shim
 * the executor actually depends on — see executor.ts's own doc comment on why it's injected, not
 * imported) plus readerDeps.get (the one real HTTP boundary the READ side still goes through).
 * LLM-call count is asserted directly via a counting spy on narrateRecommendations — required for
 * this batch, unlike Batch 2 (brief §19/§35).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeBoundedTurn, type BoundedTurnDeps } from "../services/bounded-turn/executor";
import type { BoundedTurnPlan } from "../services/bounded-turn/types";
import { readerDeps } from "../conversational-intelligence/global/readers";
import { prisma } from "../repositories/conversation.repository";

const originalReaderGet = readerDeps.get;
test.afterEach(async () => { readerDeps.get = originalReaderGet; await prisma.fitnessRecommendation.deleteMany({ where: { sessionId: "bounded-turn-executor-test" } }); });
test.after(async () => { await prisma.$disconnect(); });

function stubReaderGetForPtContracts(contracts: any[] = [{ status: "ACTIVE", packageName: "PT cơ bản", ptProfile: { firstName: "Minh" } }]) {
  readerDeps.get = async (url: string) => {
    if (url.endsWith("/contracts/client")) return { status: 200, data: contracts };
    return { status: 404, data: {} };
  };
}

/** Minimal but COMPLETE PTCandidate shape — scorePT (@gym-coach/shared/fitness-agent-scoring.ts)
 * reads specialties/availableDays/packages/reviewCount/averageRating/history.count; a candidate
 * missing any of these throws inside the real scoring function, not a fixture shortcut. */
function ptCandidate(id: string, name: string, historyCount = 0) {
  return { id, name, specialties: ["Tăng cơ", "MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5, history: { count: historyCount } };
}

const ptPlan: BoundedTurnPlan = { compositionType: "READ_RECOMMEND", reads: [{ kind: "PT_STATUS" }], recommendation: { kind: "PT" }, handledBy: "BOUNDED_EXECUTOR", supported: true };

test("T11: PT composite — current PT comes from the real READ, recommendation is real, no hire action, exactly one narration call", async () => {
  stubReaderGetForPtContracts();
  let narrationCalls = 0;
  const deps: BoundedTurnDeps = {
    tools: {
      getUserFitnessContext: async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000 }, coach: {} }),
      findPTCandidates: async () => ({ candidates: [ptCandidate("pt-1", "PT Lan", 2), ptCandidate("pt-2", "PT Khoa", 0)] }),
      findTrainingPrograms: async () => ({ programs: [] }),
      getScientificEvidence: () => [],
    },
    narrateRecommendations: async (ranked: any[]) => {
      narrationCalls += 1;
      return { narrations: ranked.map((r) => ({ candidateId: r.candidate.id, summary: "phù hợp mục tiêu tăng cơ", strengths: [] })), usedFallback: false };
    },
    narrateProgramRecommendations: async () => ({ narrations: [], usedFallback: false }),
  };
  const result = await executeBoundedTurn(ptPlan, { userId: "u1", authorizationHeader: "Bearer t" } as any, "PT hiện tại của tôi là ai và có ai phù hợp hơn không?", "bounded-turn-executor-test", deps);
  assert.ok(result, "must produce a composite answer");
  assert.match(result!.answer, /Minh/, "the current-PT fact must come from the real READ result, not be fabricated");
  assert.match(result!.answer, /PT Lan|PT Khoa/, "the recommendation must name real candidates from findPTCandidates");
  assert.equal(narrationCalls, 1, "exactly one LLM narration call — canonicalization/planning adds zero extra calls");
  assert.equal(result!.blocks.length, 0, "no PT_RECOMMENDATIONS card, no action block — this is an inline answer, not a new action");
});

test("incomplete preferences (no budgetVnd) safely falls back to null — never guesses a budget", async () => {
  stubReaderGetForPtContracts();
  const deps: BoundedTurnDeps = {
    tools: {
      getUserFitnessContext: async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null }, coach: {} }),
      findPTCandidates: async () => ({ candidates: [ptCandidate("pt-1", "PT Lan", 2)] }),
      findTrainingPrograms: async () => ({ programs: [] }),
      getScientificEvidence: () => [],
    },
    narrateRecommendations: async () => ({ narrations: [], usedFallback: false }),
    narrateProgramRecommendations: async () => ({ narrations: [], usedFallback: false }),
  };
  const result = await executeBoundedTurn(ptPlan, { userId: "u2" } as any, "PT hiện tại của tôi là ai và có ai phù hợp hơn không?", "bounded-turn-executor-test", deps);
  assert.equal(result, null, "incomplete preferences -> null, caller falls back to the existing offer-only text");
});

test("T21/partial failure: the READ fails but the recommendation still succeeds — truthful partial answer, never silently drops the real recommendation", async () => {
  readerDeps.get = async () => { throw new Error("user-service unavailable"); };
  const deps: BoundedTurnDeps = {
    tools: {
      getUserFitnessContext: async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000 }, coach: {} }),
      findPTCandidates: async () => ({ candidates: [ptCandidate("pt-1", "PT Lan", 2)] }),
      findTrainingPrograms: async () => ({ programs: [] }),
      getScientificEvidence: () => [],
    },
    narrateRecommendations: async (ranked: any[]) => ({ narrations: ranked.map((r) => ({ candidateId: r.candidate.id, summary: "phù hợp", strengths: [] })), usedFallback: false }),
    narrateProgramRecommendations: async () => ({ narrations: [], usedFallback: false }),
  };
  const result = await executeBoundedTurn(ptPlan, { userId: "u3" } as any, "...", "bounded-turn-executor-test", deps);
  assert.ok(result, "a failed READ must not discard an otherwise-successful recommendation");
  assert.match(result!.answer, /PT Lan/);
});

test("T22: the recommendation engine itself failing (findPTCandidates throws) returns null — never a hallucinated recommendation", async () => {
  stubReaderGetForPtContracts();
  const deps: BoundedTurnDeps = {
    tools: {
      getUserFitnessContext: async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000 }, coach: {} }),
      findPTCandidates: async () => { throw new Error("user-service unavailable"); },
      findTrainingPrograms: async () => ({ programs: [] }),
      getScientificEvidence: () => [],
    },
    narrateRecommendations: async () => ({ narrations: [], usedFallback: false }),
    narrateProgramRecommendations: async () => ({ narrations: [], usedFallback: false }),
  };
  const result = await executeBoundedTurn(ptPlan, { userId: "u4" } as any, "...", "bounded-turn-executor-test", deps);
  assert.equal(result, null);
});

test("a plan not marked BOUNDED_EXECUTOR is never executed (defensive — the caller should not call this, but the function itself must still refuse)", async () => {
  const deps: BoundedTurnDeps = {
    tools: { getUserFitnessContext: async () => ({ profile: {}, coach: {} }), findPTCandidates: async () => ({ candidates: [] }), findTrainingPrograms: async () => ({ programs: [] }), getScientificEvidence: () => [] },
    narrateRecommendations: async () => ({ narrations: [], usedFallback: false }),
    narrateProgramRecommendations: async () => ({ narrations: [], usedFallback: false }),
  };
  const result = await executeBoundedTurn({ compositionType: "READ_READ", reads: [], handledBy: "EXISTING_MULTI", supported: true }, { userId: "u5" } as any, "...", "bounded-turn-executor-test", deps);
  assert.equal(result, null);
});
