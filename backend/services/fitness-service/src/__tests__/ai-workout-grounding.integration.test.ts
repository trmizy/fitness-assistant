import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/prisma";
import { workoutService } from "../services/workout.service";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test|localhost:55433)/i.test(fitnessDatabaseUrl);
const integrationTest = canUseIntegrationDb ? test : test.skip;
const cleanupUserIds: string[] = [];
const cleanupExerciseIds: string[] = [];
const cleanupEquipmentIds: string[] = [];

async function createBodyweightExercise(name: string) {
  const exercise = await prisma.exercise.create({
    data: {
      exerciseName: name,
      bodyPart: "FULL_BODY",
      type: "PUSH",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      difficultyLevel: "BEGINNER",
      muscleGroupsActivated: ["full_body"],
      instructions: "test",
      source: "SYSTEM",
      status: "PUBLISHED",
    },
  });
  cleanupExerciseIds.push(exercise.id);
  return exercise;
}

/** An exercise whose confirm-time availability (validateAiPlanExerciseEquipment
 * -> planEquipmentValidatorService.validate -> isExerciseAvailable) depends on
 * a real REQUIRED ExerciseEquipment link, for AC17/AC28/EX06 — the equipment
 * half of FR17, which (per docs/research/workout-plan-bpm/10-traceability-
 * matrix.md) had no test covering it before this one. */
async function createExerciseRequiringEquipment(name: string) {
  const exercise = await prisma.exercise.create({
    data: {
      exerciseName: name,
      bodyPart: "FULL_BODY",
      type: "PUSH",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "MACHINE",
      difficultyLevel: "BEGINNER",
      muscleGroupsActivated: ["full_body"],
      instructions: "test",
      source: "SYSTEM",
      status: "PUBLISHED",
    },
  });
  cleanupExerciseIds.push(exercise.id);
  const requiredEquipment = await prisma.equipment.create({
    data: { slug: `ai-grounding-required-${randomUUID()}`, name: "AI Grounding Required Equipment", category: "OTHER" },
  });
  cleanupEquipmentIds.push(requiredEquipment.id);
  await prisma.exerciseEquipment.create({
    data: { exerciseId: exercise.id, equipmentId: requiredEquipment.id, requirementType: "REQUIRED" },
  });
  return { exercise, requiredEquipment };
}

test.after(async () => {
  if (canUseIntegrationDb) {
    await prisma.workoutSchedule.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.workoutProgram.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.userEquipment.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.equipment.deleteMany({ where: { id: { in: cleanupEquipmentIds } } });
    await prisma.exercise.deleteMany({ where: { id: { in: cleanupExerciseIds } } });
  }
  await prisma.$disconnect();
});

integrationTest("AI plan import persists the canonical exerciseId returned by the resolver", async () => {
  const userId = `ai-grounding-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const exercise = await createBodyweightExercise(`AI Grounding Valid ${randomUUID()}`);

  const result = await workoutService.importAiPlanToSchedule(userId, {
    sourcePlanId: randomUUID(),
    sourcePlanName: "Grounded AI Plan",
    goal: "strength",
    durationWeeks: 1,
    daysPerWeek: 1,
    weeklySchedule: [
      {
        day: 1,
        goal: "Strength",
        exercises: [
          {
            exerciseId: exercise.id,
            name: "LLM renamed this, but ID is canonical",
            sets: 3,
            reps: "8",
            restSeconds: 90,
          },
        ],
      },
    ],
  });

  const persisted = await prisma.workoutProgramExercise.findFirstOrThrow({
    where: { programDay: { programId: result.createdProgramId } },
  });
  assert.equal(persisted.exerciseId, exercise.id);
});

integrationTest("AI plan import rejects a bad explicit exerciseId even when the name is valid", async () => {
  const userId = `ai-grounding-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const exercise = await createBodyweightExercise(`AI Grounding No Fallback ${randomUUID()}`);
  const sourcePlanId = randomUUID();

  await assert.rejects(
    () =>
      workoutService.importAiPlanToSchedule(userId, {
        sourcePlanId,
        sourcePlanName: "Bad ID AI Plan",
        goal: "strength",
        durationWeeks: 1,
        daysPerWeek: 1,
        weeklySchedule: [
          {
            day: 1,
            goal: "Strength",
            exercises: [
              {
                exerciseId: `missing-${randomUUID()}`,
                name: exercise.exerciseName,
                sets: 3,
                reps: "8",
                restSeconds: 90,
              },
            ],
          },
        ],
      }),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Unable to map AI exercises to exercise master/);
      assert.match(err.message, /not_found/);
      return true;
    },
  );

  const program = await prisma.workoutProgram.findFirst({ where: { userId, sourcePlanId } });
  assert.equal(program, null);
});

integrationTest("AI plan import rejects a draft containing an exercise the user's own equipment can't satisfy (AC17/AC28/EX06 — the equipment half of FR17)", async () => {
  const userId = `ai-grounding-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const sourcePlanId = randomUUID();
  const { exercise } = await createExerciseRequiringEquipment(`AI Grounding Equipment-Gated ${randomUUID()}`);
  // The user has SOME real equipment on file (so this isn't the
  // skippedNoUserEquipment backward-compat no-rows-at-all case) — just not
  // the one this exercise actually requires.
  const ownedEquipment = await prisma.equipment.create({
    data: { slug: `ai-grounding-owned-${randomUUID()}`, name: "AI Grounding Owned Equipment", category: "OTHER" },
  });
  cleanupEquipmentIds.push(ownedEquipment.id);
  await prisma.userEquipment.create({ data: { userId, equipmentId: ownedEquipment.id } });

  await assert.rejects(
    () =>
      workoutService.importAiPlanToSchedule(userId, {
        sourcePlanId,
        sourcePlanName: "Equipment-Gated AI Plan",
        goal: "strength",
        durationWeeks: 1,
        daysPerWeek: 1,
        weeklySchedule: [
          {
            day: 1,
            goal: "Strength",
            exercises: [
              { exerciseId: exercise.id, name: exercise.exerciseName, sets: 3, reps: "8", restSeconds: 90 },
            ],
          },
        ],
      }),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /equipment/i);
      return true;
    },
  );

  const program = await prisma.workoutProgram.findFirst({ where: { userId, sourcePlanId } });
  assert.equal(program, null, "a rejected equipment check must leave zero WorkoutProgram rows, same as a bad exerciseId rejection");
});

// ───────────────────────── Phase 2B GAP-B: exactly-once persistence ─────────────────────────
// FR19/AC19/AC36/EX14, real DB-row-count evidence at the ACTUAL persistence boundary
// importAiPlanToSchedule owns, bypassing ai-service's own atomic PENDING->EXECUTING claim
// (fitness-agent.service.ts::execute) on purpose — this tests fitness-service's OWN independent
// defense, not ai-service's (already covered by the existing golden-flow test's stubbed
// double-confirm assertion). Mechanism actually found by reading importAiPlanToSchedule (NOT what
// the traceability matrix previously assumed): a pre-transaction `findFirst({userId, sourcePlanId})`
// check-then-act (update the existing program if found, else create), backed by a REAL DB
// `@@unique([userId, sourcePlanId])` constraint (schema.prisma:556) as the final backstop — NOT
// `WorkoutProgram.agentActionId` (that field is never even set by this function; it is `null` on
// every row this code path creates, so its own `@unique` constraint is irrelevant here).

integrationTest("Sequential double confirm: importAiPlanToSchedule called twice with the SAME sourcePlanId updates the existing program in place, never creates a second row (AC19/AC36/FR19)", async () => {
  const userId = `ai-grounding-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const sourcePlanId = randomUUID();
  const exercise = await createBodyweightExercise(`AI Grounding Double-Confirm Seq ${randomUUID()}`);
  const input = {
    sourcePlanId, sourcePlanName: "Double-Confirm Sequential Plan", goal: "strength", durationWeeks: 1, daysPerWeek: 1,
    weeklySchedule: [{ day: 1, goal: "Strength", exercises: [{ exerciseId: exercise.id, name: exercise.exerciseName, sets: 3, reps: "8", restSeconds: 90 }] }],
  };

  const before = await prisma.workoutProgram.count({ where: { userId, sourcePlanId } });
  assert.equal(before, 0, "zero persisted program before either confirm");

  const first = await workoutService.importAiPlanToSchedule(userId, input);
  const afterFirst = await prisma.workoutProgram.findMany({ where: { userId, sourcePlanId } });
  assert.equal(afterFirst.length, 1, "exactly one program after the first confirm");
  const programId = afterFirst[0].id;

  // Second confirmation of THE SAME draft/sourcePlanId — per the API contract this is NOT an
  // error (importAiPlanToSchedule's own found-existing-program branch updates in place); the
  // invariant under test is row count, not HTTP/exception shape.
  const second = await workoutService.importAiPlanToSchedule(userId, input);
  assert.equal((second as any).createdProgramId ?? (second as any).programId ?? programId, programId, "the second confirm must act on the SAME program, never a new one");

  const afterSecond = await prisma.workoutProgram.findMany({ where: { userId, sourcePlanId } });
  assert.equal(afterSecond.length, 1, "still exactly ONE program after the second confirm — no duplicate row");
  assert.equal(afterSecond[0].id, programId, "same program id both times");
  void first;
});

integrationTest("Concurrent double confirm: two simultaneous importAiPlanToSchedule calls with the SAME NEW sourcePlanId still leave exactly one authoritative WorkoutProgram row (AC19/AC36/FR19, real race)", async () => {
  const userId = `ai-grounding-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const sourcePlanId = randomUUID();
  const exercise = await createBodyweightExercise(`AI Grounding Double-Confirm Concurrent ${randomUUID()}`);
  const input = {
    sourcePlanId, sourcePlanName: "Double-Confirm Concurrent Plan", goal: "strength", durationWeeks: 1, daysPerWeek: 1,
    weeklySchedule: [{ day: 1, goal: "Strength", exercises: [{ exerciseId: exercise.id, name: exercise.exerciseName, sets: 3, reps: "8", restSeconds: 90 }] }],
  };

  // Genuinely concurrent: both calls start before either's pre-transaction findFirst check can
  // observe the other's write — real two-execution-path race, not serialized.
  const results = await Promise.allSettled([
    workoutService.importAiPlanToSchedule(userId, input),
    workoutService.importAiPlanToSchedule(userId, input),
  ]);

  const programs = await prisma.workoutProgram.findMany({ where: { userId, sourcePlanId } });
  assert.equal(programs.length, 1, "at most one authoritative WorkoutProgram row must exist after both concurrent attempts settle — this is the actual invariant, regardless of which path won");

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  assert.ok(fulfilled >= 1, "at least one of the two concurrent attempts must succeed — a real confirm must not be able to fail outright under this race");
  // Document (not assert a specific count) which pattern this run exhibited, for the Phase 2B
  // report's CASE A/CASE B determination — both patterns are consistent with the real invariant:
  //  - both fulfilled: the pre-transaction findFirst happened to serialize (no true overlap this run)
  //  - one fulfilled, one rejected: a true race occurred and the DB's own
  //    @@unique([userId, sourcePlanId]) constraint (not application logic) is what stopped the
  //    second writer — a genuine defense-in-depth backstop, not a dead one.
  if (rejected > 0) {
    const rejection = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejection.reason?.message ?? rejection.reason), /unique|constraint|P2002/i, "a losing concurrent writer must fail BECAUSE of the real DB uniqueness constraint, not some unrelated error");
  }
});
