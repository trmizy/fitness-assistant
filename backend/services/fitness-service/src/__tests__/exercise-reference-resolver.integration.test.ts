import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/prisma";
import { exerciseReferenceResolver } from "../services/exercise-reference-resolver.service";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test|localhost:55433)/i.test(fitnessDatabaseUrl);
const integrationTest = canUseIntegrationDb ? test : test.skip;

async function publicExercise(name = `Resolver Public ${randomUUID()}`) {
  return prisma.exercise.create({
    data: {
      exerciseName: name,
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      difficultyLevel: "BEGINNER",
      muscleGroupsActivated: ["chest"],
      instructions: "test",
      source: "SYSTEM",
      status: "PUBLISHED",
    },
  });
}

test.after(async () => {
  if (canUseIntegrationDb) {
    await prisma.exercise.deleteMany({
      where: { exerciseName: { startsWith: "Resolver " } },
    });
  }
  await prisma.$disconnect();
});

integrationTest("explicit exerciseId resolves canonically and ignores a mismatched name", async () => {
  const exercise = await publicExercise();

  const resolved = await exerciseReferenceResolver.resolve(
    { exerciseId: exercise.id, name: "Some Other Exercise" },
    { kind: "user", userId: `resolver-user-${randomUUID()}` },
  );

  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok && resolved.exercise.id, exercise.id);
  assert.equal(resolved.ok && resolved.matchedBy, "exerciseId");
});

integrationTest("invalid explicit exerciseId is rejected and does not fallback to a valid name", async () => {
  const exercise = await publicExercise();

  const resolved = await exerciseReferenceResolver.resolve(
    { exerciseId: `missing-${randomUUID()}`, name: exercise.exerciseName },
    { kind: "user", userId: `resolver-user-${randomUUID()}` },
  );

  assert.equal(resolved.ok, false);
  assert.equal(!resolved.ok && resolved.code, "not_found");
});

integrationTest("name-only references must resolve to exactly one visible canonical exercise", async () => {
  const duplicateName = `Resolver Duplicate ${randomUUID()}`;
  await publicExercise(duplicateName);
  await publicExercise(duplicateName);

  const resolved = await exerciseReferenceResolver.resolve(
    { name: duplicateName },
    { kind: "public" },
  );

  assert.equal(resolved.ok, false);
  assert.equal(!resolved.ok && resolved.code, "ambiguous");
  assert.equal(!resolved.ok && resolved.candidates?.length, 2);
});

integrationTest("user scope can resolve owned custom exercises but public scope cannot", async () => {
  const ownerId = `resolver-owner-${randomUUID()}`;
  const custom = await prisma.exercise.create({
    data: {
      exerciseName: `Resolver Custom ${randomUUID()}`,
      bodyPart: "CORE",
      type: "HOLD",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      difficultyLevel: "BEGINNER",
      muscleGroupsActivated: ["core"],
      instructions: "test",
      source: "USER_CUSTOM",
      ownerId,
    },
  });

  const owned = await exerciseReferenceResolver.resolve(
    { exerciseId: custom.id },
    { kind: "user", userId: ownerId },
  );
  const publicResult = await exerciseReferenceResolver.resolve(
    { exerciseId: custom.id },
    { kind: "public" },
  );

  assert.equal(owned.ok, true);
  assert.equal(publicResult.ok, false);
});
