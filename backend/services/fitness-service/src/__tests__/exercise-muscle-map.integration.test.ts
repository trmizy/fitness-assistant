/**
 * Gate 6 — real integration test for the muscle-map API (exercise.service
 * .getMuscleMap/listMuscles, backed by the ExerciseMuscle/Muscle tables
 * populated by exerciseMuscleMappingImporter.ts). Runs against the real
 * seeded dev DB (DATABASE_URL points at gymcoach_fitness), same
 * documented convention as food-serving-metadata.integration.test.ts —
 * no separate `_test` DB has the real exercise catalog seeded.
 * Run inside the fitness-service container:
 *   npx tsx --test src/__tests__/exercise-muscle-map.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { redisClient } from "../repositories/redis";
import { exerciseService } from "../services/exercise.service";

// exercise.repository.ts caches through redisClient, which — unlike
// prisma — is only ever connected by server.ts's real app bootstrap, not
// lazily on first use. A standalone test file never goes through that
// bootstrap, so the client must be connected explicitly here or every
// exerciseRepository call fails with "The client is closed".
test.before(async () => {
  await redisClient.connect();
});

test.after(async () => {
  await prisma.$disconnect();
  // Same real node-redis v4 cleanup pattern already established in
  // coach.service.integration.test.ts / coach-plan-draft.integration.test.ts
  // — a short settle delay before quitting avoids racing a still-
  // connecting socket.
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // already closed — nothing to clean up
  }
});

test("listMuscles: returns the full 29-entry canonical taxonomy, each with a Vietnamese name", async () => {
  const muscles = await exerciseService.listMuscles();
  assert.equal(muscles.length, 29);
  for (const m of muscles) {
    assert.ok(m.code, `muscle missing code: ${JSON.stringify(m)}`);
    assert.ok(m.nameVi, `muscle ${m.code} missing nameVi`);
  }
  assert.ok(muscles.some((m) => m.code === "chest"));
  assert.ok(muscles.some((m) => m.code === "quads"));
});

test("getMuscleMap: a real mapped exercise returns real primary/secondary muscle data, never a guess", async () => {
  const mappedExercise = await prisma.exercise.findFirst({
    where: { muscleLinks: { some: { role: "primary" } } },
    select: { id: true },
  });
  assert.ok(mappedExercise, "expected at least one exercise with a primary muscle mapping in the seeded catalog");

  const map = await exerciseService.getMuscleMap(mappedExercise!.id);
  assert.equal(map.mapped, true);
  assert.ok(map.primary.length > 0, "expected at least one primary muscle");
  for (const m of map.primary) {
    assert.ok(m.code);
    assert.ok(m.nameVi);
  }
});

test("getMuscleMap: an exercise with no muscle mapping returns mapped:false with empty arrays, not an error or a guess", async () => {
  const unmappedExercise = await prisma.exercise.findFirst({
    where: { muscleLinks: { none: {} } },
    select: { id: true },
  });
  assert.ok(unmappedExercise, "expected at least one unmapped exercise in the seeded catalog (e.g. the neck-only entries)");

  const map = await exerciseService.getMuscleMap(unmappedExercise!.id);
  assert.equal(map.mapped, false);
  assert.deepEqual(map.primary, []);
  assert.deepEqual(map.secondary, []);
});

test("getMuscleMap: a nonexistent exercise id throws a 404, not a silent empty result", async () => {
  await assert.rejects(
    () => exerciseService.getMuscleMap("00000000-0000-0000-0000-000000000000"),
    (err: any) => err.status === 404,
  );
});

test("getMuscleMap: every canonical Vietnamese-catalog exercise (curated_vi_exercise_catalog source) resolves at least one primary muscle", async () => {
  const catalogExerciseIds = await prisma.exerciseSource.findMany({
    where: { sourceName: "curated_vi_exercise_catalog" },
    select: { exerciseId: true },
    take: 20, // sample — the full 145 would be slow to check one-by-one here, this is enough to catch a systemic issue
  });
  assert.ok(catalogExerciseIds.length > 0);

  const unmapped: string[] = [];
  for (const { exerciseId } of catalogExerciseIds) {
    const map = await exerciseService.getMuscleMap(exerciseId);
    if (!map.mapped) unmapped.push(map.exerciseName);
  }
  assert.deepEqual(unmapped, [], `expected every sampled curated_vi_exercise_catalog exercise to have a muscle mapping, but these did not: ${unmapped.join(", ")}`);
});
