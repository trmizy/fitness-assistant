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

test.after(async () => {
  if (canUseIntegrationDb) {
    await prisma.workoutSchedule.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.workoutProgram.deleteMany({ where: { userId: { in: cleanupUserIds } } });
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
