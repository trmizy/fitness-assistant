/**
 * Product Completeness pass — Muscle Library detail page's "related
 * exercises" (exerciseService.listExercisesByMuscle, backed by the real
 * ExerciseMuscle/Muscle tables). Same dev-DB convention as
 * exercise-muscle-map.integration.test.ts — the real seeded catalog only
 * exists in gymcoach_fitness, not the _test DB.
 * Run inside the fitness-service container:
 *   npx tsx --test src/__tests__/muscle-library.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { redisClient } from "../repositories/redis";
import { exerciseService } from "../services/exercise.service";

test.before(async () => {
  await redisClient.connect();
});

test.after(async () => {
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // already closed
  }
});

test("listExercisesByMuscle: resolves by canonical code and returns only PUBLISHED/SYSTEM exercises that really map to it", async () => {
  const result = await exerciseService.listExercisesByMuscle("chest", {});
  assert.equal(result.muscle.code, "chest");
  assert.ok(result.exercises.length > 0, "expected at least one chest exercise in the seeded catalog");
  for (const ex of result.exercises) {
    assert.equal(ex.status, "PUBLISHED");
    assert.equal(ex.source, "SYSTEM");
    assert.ok(ex.muscleRole === "primary" || ex.muscleRole === "secondary");
  }
  assert.ok(result.pagination.total >= result.exercises.length);
});

test("listExercisesByMuscle: resolves by the Muscle row's uuid id too, not only its code", async () => {
  const muscle = await prisma.muscle.findFirst({ where: { code: "quads" } });
  assert.ok(muscle, "expected a 'quads' row in the seeded Muscle taxonomy");
  const result = await exerciseService.listExercisesByMuscle(muscle!.id, {});
  assert.equal(result.muscle.code, "quads");
  assert.ok(result.exercises.length > 0);
});

test("listExercisesByMuscle: paginates (limit respected, total reflects the full match count)", async () => {
  const full = await exerciseService.listExercisesByMuscle("lats", {});
  const paged = await exerciseService.listExercisesByMuscle("lats", { limit: 1 });
  assert.equal(paged.exercises.length, 1);
  assert.equal(paged.pagination.total, full.pagination.total);
});

test("listExercisesByMuscle: an unknown muscle id/code throws 404, not an empty silent result", async () => {
  await assert.rejects(
    () => exerciseService.listExercisesByMuscle("not-a-real-muscle", {}),
    (err: any) => err.status === 404,
  );
});
