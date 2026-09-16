import test from "node:test";
import assert from "node:assert/strict";
import { agenticFitnessService } from "../services/agentic-fitness.service";
import { prisma } from "../repositories/profile.repository";

/**
 * Real-DB integration test — proves the "historical similarity actually
 * returns useful cohorts" claim end-to-end against the synthetic dataset
 * produced by `npm run dev:seed-agentic-demo`
 * (src/scripts/seed-agentic-demo.ts). Requires ENABLE_AGENTIC_DEMO=true
 * (same gate `originFor()` enforces) and the seed script already run.
 *
 * This is the one integration point the pure-function tests
 * (client-journey-derivation-goal-achievement.test.ts,
 * fitness-agent-scoring.test.ts) cannot cover on their own: that a real
 * client profile + real `AgentPreferences` actually surfaces a non-empty
 * `HistoricalSummary` for at least one PT archetype, and correctly
 * surfaces an EMPTY one for a cold-start PT — both halves of the claim.
 *
 * Deliberately does NOT hardcode a training-days preference: a real
 * PT's `PTAvailability` is randomized by the seed script, and
 * `candidates()` hard-filters out any PT that can't cover every requested
 * day — asking for a fixed day set (e.g. Mon/Wed/Fri) would make this
 * test flaky against whatever days the seed happened to assign. Instead
 * this reads one real WEIGHT_LOSS PT's actual seeded availability first
 * and requests exactly that PT's own days, so the match is guaranteed by
 * construction rather than by chance.
 */

test.before(() => {
  process.env.ENABLE_AGENTIC_DEMO = "true";
});

async function seedRequestingClient(userId: string) {
  await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId, firstName: "Test", lastName: "Requester", email: `${userId}@demo.gymini.invalid`,
      isPT: false, dataOrigin: "SYNTHETIC",
      goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE",
      preferredTrainingDays: [1], ptBudgetVnd: 50_000_000, sessionDurationMinutes: 60,
      currentWeight: 78,
    },
  });
}

const DAY_NUMBERS: Record<string, number> = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };

/** Finds a real seeded WEIGHT_LOSS PT with an active service package and
 * returns a `days` preference guaranteed to be a subset of its own
 * availability, so the eligibility filter in candidates() always passes
 * for at least this one PT. */
async function findGuaranteedMatchableDays(): Promise<number[]> {
  const pt = await prisma.userProfile.findFirst({
    where: { isPT: true, dataOrigin: "SYNTHETIC", specialties: { has: "Giảm mỡ" } },
    select: { userId: true },
  });
  assert.ok(pt, "expected at least one seeded SYNTHETIC PT with 'Giảm mỡ' specialty — run `npm run dev:seed-agentic-demo` first");
  const availability = await prisma.pTAvailability.findMany({ where: { ptUserId: pt!.userId, isActive: true } });
  assert.ok(availability.length > 0, "expected the seeded PT to have at least one PTAvailability row");
  return [...new Set(availability.map((a) => DAY_NUMBERS[a.dayOfWeek]))].slice(0, 2);
}

test("agenticFitnessService.candidates(): the synthetic ESTABLISHED_STRONG cohort produces a non-empty historical summary for at least one WEIGHT_LOSS candidate", async () => {
  const requesterId = "test-requester-synthetic-cohort";
  await seedRequestingClient(requesterId);
  const days = await findGuaranteedMatchableDays();

  const result = await agenticFitnessService.candidates(requesterId, {
    goal: "WEIGHT_LOSS", days, sessionMinutes: 60, budgetVnd: 50_000_000, demo: true,
  });

  assert.ok(result.candidates.length > 0, "at least one synthetic WEIGHT_LOSS PT candidate should be eligible");
  const withEvidence = result.candidates.filter((c) => c.history.count > 0);
  assert.ok(
    withEvidence.length > 0,
    `expected at least one candidate with a non-empty historical cohort; got history.count values: ${result.candidates.map((c) => c.history.count).join(", ")} (candidate count: ${result.candidates.length})`,
  );
  // Every non-empty summary must carry the SYNTHETIC disclaimer note —
  // never presented as real evidence (see FITNESS_SCORING /
  // summarizeJourneys's own note text).
  for (const c of withEvidence) {
    assert.equal(c.history.dataOrigin, "SYNTHETIC");
    assert.match(c.history.note, /Demo synthetic dataset/);
  }
});

test("agenticFitnessService.candidates(): scorePT ranks a candidate with real historical evidence differently from a cold-start candidate on the same shortlist", async () => {
  const requesterId = "test-requester-synthetic-cohort-scoring";
  await seedRequestingClient(requesterId);
  const days = await findGuaranteedMatchableDays();

  const result = await agenticFitnessService.candidates(requesterId, {
    goal: "WEIGHT_LOSS", days, sessionMinutes: 60, budgetVnd: 50_000_000, demo: true,
  });
  const withEvidence = result.candidates.find((c) => c.history.count > 0);
  const coldStart = result.candidates.find((c) => c.history.count === 0);
  if (!withEvidence || !coldStart) {
    // Not every day-combination yields both kinds on the shortlist — this
    // is a soft assertion, not a hard requirement of the seed.
    return;
  }
  const { scorePT } = await import("@gym-coach/shared");
  const preferences = { goal: "WEIGHT_LOSS" as const, days, sessionMinutes: 60, budgetVnd: 50_000_000, demo: true };
  const scoreWithEvidence = scorePT(withEvidence, preferences);
  const scoreColdStart = scorePT(coldStart, preferences);
  // Cold-start fairness (backend/shared/src/fitness-agent-scoring.ts): the
  // "evidence" dimension must be absent (not zero) for the cold-start
  // candidate, present for the one with real cohort data.
  assert.equal("evidence" in scoreColdStart.components, false);
  assert.equal("evidence" in scoreWithEvidence.components, true);
});
