/**
 * Hardening pass §7-9 — deterministic coverage for
 * plan-equipment-validator.service.ts, the final safety net checked right
 * before a generated plan is persisted. No LLM involved — real DB, real
 * exercise/equipment records, synthetic plan payloads.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/plan-equipment-validator.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/prisma";
import { planEquipmentValidatorService, type PlanDayRef } from "../services/plan-equipment-validator.service";

const cleanupUserIds: string[] = [];
test.after(async () => {
  await prisma.userEquipment.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.$disconnect();
});

async function idOf(exerciseName: string): Promise<string> {
  return (await prisma.exercise.findFirstOrThrow({ where: { exerciseName } })).id;
}

async function equipmentId(slug: string): Promise<string> {
  return (await prisma.equipment.findUniqueOrThrow({ where: { slug } })).id;
}

async function setEquipment(userId: string, slugs: string[]) {
  const ids = await Promise.all(slugs.map(equipmentId));
  await prisma.userEquipment.deleteMany({ where: { userId } });
  await prisma.userEquipment.createMany({ data: ids.map((equipmentId) => ({ userId, equipmentId })) });
}

function scheduleFor(exerciseIds: string[]): PlanDayRef[] {
  return [{ day: "Day 1", exercises: exerciseIds.map((exerciseId) => ({ exerciseId })) }];
}

test("a plan is valid when the user owns every required exercise's equipment", async () => {
  const userId = `validator-${randomUUID()}`;
  cleanupUserIds.push(userId);
  await setEquipment(userId, ["barbell", "bench"]);
  const benchPressId = await idOf("Barbell Bench Press - Medium Grip");

  const result = await planEquipmentValidatorService.validate(scheduleFor([benchPressId]), userId);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("a plan is INVALID when it contains an exercise the user's equipment doesn't cover", async () => {
  const userId = `validator-${randomUUID()}`;
  cleanupUserIds.push(userId);
  await setEquipment(userId, ["bodyweight", "pull-up-bar"]); // no leg-press-machine
  const legPressId = await idOf("Leg Press");

  const result = await planEquipmentValidatorService.validate(scheduleFor([legPressId]), userId);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].exerciseId, legPressId);
  assert.ok(result.violations[0].required.includes("leg-press-machine"));
  assert.deepEqual(result.violations[0].available.sort(), ["bodyweight", "pull-up-bar"].sort());
});

test("skips validation entirely (valid=true) when the user has no saved UserEquipment rows — matches the candidate-endpoint's own backward-compatible fallback", async () => {
  const userId = `validator-${randomUUID()}`; // deliberately never call setEquipment
  const legPressId = await idOf("Leg Press");

  const result = await planEquipmentValidatorService.validate(scheduleFor([legPressId]), userId);
  assert.equal(result.valid, true);
  assert.equal(result.skippedNoUserEquipment, true);
});

test("violation reports the correct day index for a multi-day plan", async () => {
  const userId = `validator-${randomUUID()}`;
  cleanupUserIds.push(userId);
  await setEquipment(userId, ["dumbbell", "bench"]); // Dumbbell Bench Press requires both — see seed_equipment.ts's impliedSecondaryEquipment
  const dumbbellBenchId = await idOf("Dumbbell Bench Press");
  const legPressId = await idOf("Leg Press");

  const schedule: PlanDayRef[] = [
    { day: "Day 1", exercises: [{ exerciseId: dumbbellBenchId }] },
    { day: "Day 2", exercises: [{ exerciseId: legPressId }] },
  ];
  const result = await planEquipmentValidatorService.validate(schedule, userId);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].dayIndex, 1);
  assert.equal(result.violations[0].day, "Day 2");
});

test("an ALTERNATIVE-family exercise (lat pulldown) passes when the user owns EITHER alternative", async () => {
  const userId = `validator-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const pulldownId = await idOf("Wide-Grip Lat Pulldown");

  await setEquipment(userId, ["cable-machine"]);
  let result = await planEquipmentValidatorService.validate(scheduleFor([pulldownId]), userId);
  assert.equal(result.valid, true, "cable-machine alone should satisfy the ALTERNATIVE group");

  await setEquipment(userId, ["lat-pulldown-machine"]);
  result = await planEquipmentValidatorService.validate(scheduleFor([pulldownId]), userId);
  assert.equal(result.valid, true, "lat-pulldown-machine alone should also satisfy the ALTERNATIVE group");

  await setEquipment(userId, ["dumbbell"]);
  result = await planEquipmentValidatorService.validate(scheduleFor([pulldownId]), userId);
  assert.equal(result.valid, false, "neither alternative owned should fail");
});

test("a multi-required exercise (barbell bench press: barbell + bench) fails when only ONE of the two is owned", async () => {
  const userId = `validator-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const benchPressId = await idOf("Barbell Bench Press - Medium Grip");

  await setEquipment(userId, ["barbell"]); // missing bench
  const result = await planEquipmentValidatorService.validate(scheduleFor([benchPressId]), userId);
  assert.equal(result.valid, false);
  assert.deepEqual(result.violations[0].required.sort(), ["barbell", "bench"].sort());
});
