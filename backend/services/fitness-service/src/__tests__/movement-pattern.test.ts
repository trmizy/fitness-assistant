/**
 * Gym-onboarding project follow-up — coverage for Exercise.movementPattern
 * (prisma/seed_movement_patterns.ts), previously 100% NULL. Real DB, same
 * accepted convention as this project's other equipment tests.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/movement-pattern.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { MOVEMENT_PATTERNS } from "../constants/movement-patterns";

test.after(async () => {
  await prisma.$disconnect();
});

test("every exercise has a movementPattern set", async () => {
  const count = await prisma.exercise.count({ where: { movementPattern: null } });
  assert.equal(count, 0);
});

test("every populated movementPattern value is a real taxonomy member (no stray/typo values)", async () => {
  const rows = await prisma.exercise.findMany({
    where: { movementPattern: { not: null } },
    select: { movementPattern: true },
    distinct: ["movementPattern"],
  });
  const valid = new Set<string>(MOVEMENT_PATTERNS);
  const invalid = rows.map((r) => r.movementPattern).filter((p) => p && !valid.has(p));
  assert.deepEqual(invalid, []);
});

async function patternOf(exerciseName: string): Promise<string | null> {
  const ex = await prisma.exercise.findFirst({ where: { exerciseName }, select: { movementPattern: true } });
  return ex?.movementPattern ?? null;
}

test("spot check: canonical compound lifts classify correctly", async () => {
  assert.equal(await patternOf("Barbell Bench Press - Medium Grip"), "HORIZONTAL_PUSH");
  assert.equal(await patternOf("Barbell Squat"), "SQUAT");
  assert.equal(await patternOf("Barbell Deadlift"), "HINGE");
  assert.equal(await patternOf("Pullups"), "VERTICAL_PULL");
  assert.equal(await patternOf("Wide-Grip Lat Pulldown"), "VERTICAL_PULL");
  assert.equal(await patternOf("Leg Press"), "SQUAT");
  assert.equal(await patternOf("Standing Military Press"), "VERTICAL_PUSH");
  assert.equal(await patternOf("Seated Cable Rows"), "HORIZONTAL_PULL");
  assert.equal(await patternOf("Barbell Curl"), "ELBOW_FLEXION");
  assert.equal(await patternOf("Triceps Pushdown"), "ELBOW_EXTENSION");
});

test("spot check: word-boundary regressions stay fixed (plural curls, spaced step ups)", async () => {
  // These previously mis-classified due to \bcurl\b (singular-only) and
  // step-?up (no space) regex bugs found and fixed during this pass.
  const anyCurlsPlural = await prisma.exercise.findFirst({ where: { exerciseName: { contains: "Curls" } } });
  if (anyCurlsPlural) {
    assert.equal(anyCurlsPlural.movementPattern, "ELBOW_FLEXION", `${anyCurlsPlural.exerciseName} should be ELBOW_FLEXION`);
  }
  const stepUps = await prisma.exercise.findFirst({ where: { exerciseName: "Barbell Step Ups" } });
  if (stepUps) {
    assert.equal(stepUps.movementPattern, "LUNGE");
  }
});
