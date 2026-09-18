import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agentProgramService, agentProgramDeps } from "../services/agent-program.service";
import { prisma } from "../repositories/prisma";

/**
 * DB-backed idempotency + stale-fingerprint evidence for Apply-Plan
 * automation — named a BLOCKED item in Codex's independent evaluation
 * (docs/codex-ai-agent-evaluation-report.md §15/§21: "duplicate apply-plan
 * confirmation ... Code inspection found the expected mechanisms
 * (agentActionId, deterministic draft id, advisory locks), but this
 * evaluator did not run DB-backed duplicate-write tests" /
 * "stale plan fingerprint confirmation").
 *
 * Real DB (own isolated Exercise/WorkoutProgramTemplate/WorkoutProgram
 * rows — created and torn down by this file, never touches unrelated
 * data). `fetchUserProfile` is stubbed via the existing injectable
 * `agentProgramDeps` (same pattern the production code already uses for
 * exactly this reason), since it's a real HTTP call to user-service this
 * test does not need to exercise.
 */

const originalFetchUserProfile = agentProgramDeps.fetchUserProfile;
test.afterEach(() => {
  agentProgramDeps.fetchUserProfile = originalFetchUserProfile;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedBodyweightExercise(id: string) {
  return prisma.exercise.create({
    data: {
      id, exerciseName: `Idempotency test push-up ${id}`, typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT", bodyPart: "UPPER_BODY", type: "PUSH",
      muscleGroupsActivated: ["chest"], instructions: "Test exercise for idempotency suite.",
      difficultyLevel: "beginner", status: "PUBLISHED", contraindications: [],
    },
  });
}

async function seedTemplate(id: string, exerciseId: string, userId: string) {
  return prisma.workoutProgramTemplate.create({
    data: {
      id, createdByUserId: userId, name: `Idempotency test template ${id}`,
      goal: "WEIGHT_LOSS", durationWeeks: 4, daysPerWeek: 1, experienceLevel: "BEGINNER",
      isPublic: true, dataOrigin: "REAL",
      daysJson: [{ dayNumber: 1, title: "Day 1", exercises: [{ exerciseId, sets: 3, reps: 10, restSeconds: 60 }] }],
    },
  });
}

function stubProfile() {
  agentProgramDeps.fetchUserProfile = async () => ({
    goal: "WEIGHT_LOSS", targetWeight: null, currentWeight: 75, experienceLevel: "BEGINNER",
    competesInSport: false, injuries: [], age: 30, gender: "MALE", heightCm: 175,
    activityLevel: "MODERATELY_ACTIVE", startingWeight: null,
  } as any);
}

async function cleanup(userId: string, templateId: string, exerciseId: string) {
  await prisma.workoutSchedule.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.workoutProgram.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.workoutProgramTemplate.deleteMany({ where: { id: templateId } }).catch(() => {});
  await prisma.exercise.deleteMany({ where: { id: exerciseId } }).catch(() => {});
  await prisma.trainingCycle.deleteMany({ where: { userId } }).catch(() => {});
}

test("agentProgramService.apply: confirming the same action twice creates exactly one WorkoutProgram, never two", async () => {
  const userId = `idem-apply-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  const actionId = `idem-apply-action-${randomUUID()}`;
  stubProfile();
  await seedBodyweightExercise(exerciseId);
  await seedTemplate(templateId, exerciseId, userId);
  try {
    const candidates = await agentProgramService.candidates(userId, { goal: "WEIGHT_LOSS", days: [1], sessionMinutes: 60, demo: false });
    const candidate = candidates.programs.find((p) => p.id === templateId);
    assert.ok(candidate, "seeded template must be a real eligible candidate — if this fails, the test fixture itself doesn't satisfy candidates()' filters");

    const input = {
      templateId, actionId, fingerprint: candidate!.fingerprint,
      startDate: new Intl.DateTimeFormat("en-CA").format(new Date()),
      preferences: { goal: "WEIGHT_LOSS", days: [1], sessionMinutes: 60, demo: false },
      confirmed: true as const,
    };
    const result1 = await agentProgramService.apply(userId, input);
    const result2 = await agentProgramService.apply(userId, input);
    assert.equal(result1.createdProgramId, result2.createdProgramId, "same actionId confirmed twice must return the SAME program id, not create a second one");

    const programs = await prisma.workoutProgram.findMany({ where: { userId } });
    assert.equal(programs.length, 1, `expected exactly 1 WorkoutProgram row after double-confirm, found ${programs.length}`);
    assert.equal(programs[0].agentActionId, actionId);
  } finally {
    await cleanup(userId, templateId, exerciseId);
  }
});

test("agentProgramService.apply: a stale fingerprint (state changed since propose) is rejected with 409, no partial write", async () => {
  const userId = `idem-apply-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  const actionId = `idem-apply-stale-${randomUUID()}`;
  stubProfile();
  await seedBodyweightExercise(exerciseId);
  await seedTemplate(templateId, exerciseId, userId);
  try {
    const input = {
      templateId, actionId, fingerprint: "this-fingerprint-does-not-match-the-real-candidate",
      startDate: new Intl.DateTimeFormat("en-CA").format(new Date()),
      preferences: { goal: "WEIGHT_LOSS", days: [1], sessionMinutes: 60, demo: false },
      confirmed: true as const,
    };
    await assert.rejects(
      () => agentProgramService.apply(userId, input),
      (err: any) => {
        assert.equal(err.status, 409);
        return true;
      },
      "a mismatched fingerprint must reject with 409, not silently apply a different program than what was previewed",
    );
    const programs = await prisma.workoutProgram.findMany({ where: { userId } });
    assert.equal(programs.length, 0, "a rejected stale-fingerprint apply must leave zero WorkoutProgram rows — no partial write");
  } finally {
    await cleanup(userId, templateId, exerciseId);
  }
});
