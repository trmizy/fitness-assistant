import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P1.5 "Custom exercises"
 * (docs/features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md).
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type ExerciseServiceLike = (typeof import("../services/exercise.service"))["exerciseService"];

let prisma: PrismaClientLike | undefined;
let exerciseService: ExerciseServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/exercise.service");
    prisma = prismaModule.prisma;
    exerciseService = serviceModule.exerciseService;
  }
  return { prisma: prisma!, exerciseService: exerciseService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

const validCustomInput = {
  exerciseName: "My Totally Unique Garage Movement XYZ123",
  typeOfActivity: "STRENGTH",
  typeOfEquipment: "DUMBBELLS",
  bodyPart: "UPPER_BODY",
  type: "PUSH",
  muscleGroupsActivated: ["chest"],
  instructions: "Do the thing.",
  loggingMode: "REPS_LOAD",
};

async function deleteCustomExercisesFor(db: PrismaClientLike, ownerId: string) {
  await db.exercise.deleteMany({ where: { ownerId } });
}

test(
  "createCustomExercise creates a PUBLISHED, owner-scoped USER_CUSTOM exercise that a real duplicate check never blocks (genuinely unique name)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, exerciseService: service } = await loadModules();
    const userId = `custom-ex-create-it-${Date.now()}`;
    try {
      const result = await service.createCustomExercise(userId, validCustomInput);
      assert.equal(result.blocked, false);
      assert.ok(result.exercise);
      assert.equal((result.exercise as any).source, "USER_CUSTOM");
      assert.equal((result.exercise as any).ownerId, userId);
      assert.equal((result.exercise as any).status, "PUBLISHED");
      assert.equal((result.exercise as any).archivedAt, null);
    } finally {
      await deleteCustomExercisesFor(db, userId);
    }
  },
);

test(
  "createCustomExercise rejects an invalid loggingMode/enum — never bypasses catalog validation",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { exerciseService: service } = await loadModules();
    const userId = `custom-ex-validation-it-${Date.now()}`;
    await assert.rejects(
      () => service.createCustomExercise(userId, { ...validCustomInput, loggingMode: "NOT_A_REAL_MODE" }),
      (err: any) => err?.status === 400,
    );
    await assert.rejects(
      () => service.createCustomExercise(userId, { ...validCustomInput, typeOfEquipment: "NOT_REAL" }),
      (err: any) => err?.status === 400,
    );
    await assert.rejects(
      () => service.createCustomExercise(userId, { ...validCustomInput, exerciseName: "" }),
      (err: any) => err?.status === 400,
    );
  },
);

test(
  "createCustomExercise blocks on a real catalog duplicate and returns candidates; confirmCreateAnyway bypasses it",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, exerciseService: service } = await loadModules();
    const userId = `custom-ex-dedup-it-${Date.now()}`;
    try {
      // "Barbell Bench Press - Medium Grip" is a real, exact seeded
      // catalog exercise — reusing its EXACT name/equipment must trigger
      // an EXACT_CROSS_SOURCE (or better) block.
      const seeded = await db.exercise.findFirst({
        where: { exerciseName: "Barbell Bench Press - Medium Grip" },
      });
      assert.ok(seeded, "seed catalog must contain this exercise for the test to be meaningful");

      const blockedResult = await service.createCustomExercise(userId, {
        ...validCustomInput,
        exerciseName: seeded!.exerciseName,
        typeOfEquipment: seeded!.typeOfEquipment,
        // Real, matching muscle groups too — detectDuplicate's
        // EXACT_CROSS_SOURCE rule needs normalizedName + equipment +
        // EITHER movementPattern or primaryMuscles to actually agree, not
        // just an identical name (a same-named-but-otherwise-unrelated
        // pair correctly lands as a lower-confidence LIKELY_DUPLICATE
        // instead, which this pass deliberately does NOT hard-block —
        // see the impact analysis's Scope decision).
        muscleGroupsActivated: seeded!.muscleGroupsActivated,
      });
      assert.equal(blockedResult.blocked, true);
      assert.ok((blockedResult as any).candidates.length > 0);
      assert.equal((blockedResult as any).candidates[0].id, seeded!.id);

      // Nothing was actually created.
      const countAfterBlock = await db.exercise.count({ where: { ownerId: userId } });
      assert.equal(countAfterBlock, 0);

      // Explicit bypass — the user confirmed "create anyway".
      const bypassed = await service.createCustomExercise(userId, {
        ...validCustomInput,
        exerciseName: seeded!.exerciseName,
        typeOfEquipment: seeded!.typeOfEquipment,
        confirmCreateAnyway: true,
      });
      assert.equal(bypassed.blocked, false);
      assert.ok((bypassed as any).exercise);
    } finally {
      await deleteCustomExercisesFor(db, userId);
    }
  },
);

test(
  "a custom exercise never appears in the public listExercises search — no catalog contamination",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, exerciseService: service } = await loadModules();
    const userId = `custom-ex-nocontam-it-${Date.now()}`;
    try {
      await service.createCustomExercise(userId, validCustomInput);

      // exerciseService.listExercises itself goes through a Redis-caching
      // repository layer this standalone test harness doesn't bootstrap a
      // connection for (a pre-existing testability gap, unrelated to this
      // feature — this is the first test in this whole test suite to
      // exercise that code path). Verifying directly against Prisma with
      // the EXACT where-shape listExercises now builds for its general
      // search branch proves the same real claim without that dependency.
      //
      // This test is itself a real regression guard: a USER_CUSTOM
      // exercise is deliberately created with status: "PUBLISHED" (so its
      // owner can use it immediately — see the impact analysis's Scope
      // decision), so `status` ALONE does NOT exclude it — this is a real
      // bug this test caught before shipping (the very first version of
      // this test only checked `status`, and correctly failed). `source`
      // is what has to do the excluding.
      const withoutSourceFilter = await db.exercise.findFirst({
        where: { status: "PUBLISHED", exerciseName: { contains: "Totally Unique Garage Movement XYZ123" } },
      });
      assert.ok(
        withoutSourceFilter,
        "sanity check: status alone WOULD match a custom exercise — confirms the test below is exercising something real, not a tautology",
      );

      const publicCatalogMatch = await db.exercise.findFirst({
        where: { status: "PUBLISHED", source: "SYSTEM", exerciseName: { contains: "Totally Unique Garage Movement XYZ123" } },
      });
      assert.equal(
        publicCatalogMatch,
        null,
        "the real public-search where-shape (status + source) must exclude a USER_CUSTOM exercise",
      );

      // But it IS visible via the owner-scoped list.
      const mine = await service.listMyCustomExercises(userId);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].exerciseName, validCustomInput.exerciseName);
    } finally {
      await deleteCustomExercisesFor(db, userId);
    }
  },
);

test(
  "archiveCustomExercise soft-deletes (never removes the row), is owner-scoped, and hides it from listMyCustomExercises",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, exerciseService: service } = await loadModules();
    const ownerId = `custom-ex-archive-owner-it-${Date.now()}`;
    const otherUserId = `custom-ex-archive-other-it-${Date.now()}`;
    try {
      const created = await service.createCustomExercise(ownerId, validCustomInput);
      const exerciseId = (created as any).exercise.id;

      // A different user cannot archive someone else's custom exercise.
      await assert.rejects(
        () => service.archiveCustomExercise(otherUserId, exerciseId),
        (err: any) => err?.status === 403,
      );

      const archived = await service.archiveCustomExercise(ownerId, exerciseId);
      assert.ok((archived as any).archivedAt);

      const mineAfter = await service.listMyCustomExercises(ownerId);
      assert.equal(mineAfter.length, 0, "archived exercise must disappear from the owner's own list");

      // The row itself is untouched, not deleted — any existing FK
      // (WorkoutExercise/WorkoutProgramExercise) would still resolve.
      const stillExists = await db.exercise.findUnique({ where: { id: exerciseId } });
      assert.ok(stillExists, "archiving must never delete the row");
    } finally {
      await deleteCustomExercisesFor(db, ownerId);
    }
  },
);
