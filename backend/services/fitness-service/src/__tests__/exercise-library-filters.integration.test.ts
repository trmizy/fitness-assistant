/**
 * Product Completeness pass — Exercise Library's difficulty/logging-mode
 * filters (spec §16) and the exercise detail page's aliases/media-license
 * enrichment (spec §17). Same dev-DB convention as
 * exercise-muscle-map.integration.test.ts — needs the real seeded catalog.
 * Run inside the fitness-service container:
 *   npx tsx --test src/__tests__/exercise-library-filters.integration.test.ts
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

test("getFilterOptions: exposes real distinct difficultyLevel and loggingMode values from the seeded catalog", async () => {
  const options = await exerciseService.getFilterOptions();
  assert.ok(options.data.loggingModes.length > 0, "expected at least one loggingMode value");
  for (const mode of options.data.loggingModes) {
    assert.ok(
      ["REPS_LOAD", "BODYWEIGHT_REPS", "TIME", "TIME_LOAD", "DISTANCE_TIME"].includes(mode),
      `unexpected loggingMode value: ${mode}`,
    );
  }
  // difficultyLevel is advisory/nullable — assert the shape is right even
  // if the seeded catalog happens to have zero non-null rows.
  assert.ok(Array.isArray(options.data.difficultyLevels));
});

test("listExercises: loggingMode filter only returns exercises with that exact mode", async () => {
  const result = await exerciseService.listExercises({ loggingMode: "TIME", limit: 20 });
  assert.ok(result.data.exercises.length > 0, "expected at least one TIME-logged exercise in the seeded catalog");
  for (const ex of result.data.exercises) {
    assert.equal(ex.loggingMode, "TIME");
  }
});

test("listExercises: an unrecognized loggingMode value is ignored (no filter applied), not a 500", async () => {
  const withGarbage = await exerciseService.listExercises({ loggingMode: "NOT_A_REAL_MODE", limit: 5 });
  const withoutFilter = await exerciseService.listExercises({ limit: 5 });
  assert.equal(withGarbage.data.pagination.total, withoutFilter.data.pagination.total);
});

test("listExercises: difficulty filter matches case-insensitively", async () => {
  const sample = await prisma.exercise.findFirst({
    where: { difficultyLevel: { not: null }, status: "PUBLISHED", source: "SYSTEM" },
    select: { difficultyLevel: true },
  });
  if (!sample?.difficultyLevel) return; // no difficulty data seeded — nothing to assert
  const lower = await exerciseService.listExercises({ difficulty: sample.difficultyLevel.toLowerCase(), limit: 5 });
  const upper = await exerciseService.listExercises({ difficulty: sample.difficultyLevel.toUpperCase(), limit: 5 });
  assert.ok(lower.data.pagination.total > 0);
  assert.equal(lower.data.pagination.total, upper.data.pagination.total);
});

test("listExercises: hasVideo=true only returns exercises with media URLs", async () => {
  const result = await exerciseService.listExercises({ hasVideo: "true", limit: 10 });
  assert.ok(result.data.exercises.length > 0, "expected media-backed exercises in the seeded catalog");
  assert.ok(result.data.pagination.total > 0);
  for (const ex of result.data.exercises) {
    assert.ok(ex.videoUrl, `expected ${ex.exerciseName} to have videoUrl`);
  }
});

test("getExercise: includes aliases and sources (media/data license) alongside the existing scalar fields", async () => {
  const aliasedExercise = await prisma.exerciseAlias.findFirst({ select: { exerciseId: true } });
  assert.ok(aliasedExercise, "expected at least one ExerciseAlias row in the seeded catalog");

  const detail = await exerciseService.getExercise(aliasedExercise!.exerciseId);
  assert.ok(detail.exerciseName, "existing scalar fields must still be present");
  assert.ok(Array.isArray(detail.aliases));
  assert.ok(detail.aliases.length > 0);
  assert.ok(Array.isArray(detail.sources));
});

test("getExercise: a nonexistent id still throws 404 with the enriched lookup", async () => {
  await assert.rejects(
    () => exerciseService.getExercise("00000000-0000-0000-0000-000000000000"),
    (err: any) => err.status === 404,
  );
});
