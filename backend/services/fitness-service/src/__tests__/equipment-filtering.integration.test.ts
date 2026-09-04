/**
 * Gym-onboarding project §32 — real persona-based coverage that
 * /internal/exercises/for-ai-plans (the actual candidate pool the AI plan
 * generator draws from) never returns an exercise a persona's saved
 * equipment can't support, once that persona has real UserEquipment rows.
 *
 * Hits the fitness-service's own already-running dev server over real HTTP
 * (same container, PORT=3002) rather than importing the Express app in-
 * process — this is the same code path ai.worker.ts calls in production,
 * so it exercises the real routing/middleware/controller wiring, not just
 * the underlying service function.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/equipment-filtering.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/prisma";

const BASE_URL = `http://localhost:${process.env.PORT || 3002}`;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

async function getEquipmentIdBySlug(slug: string): Promise<string> {
  const eq = await prisma.equipment.findUniqueOrThrow({ where: { slug } });
  return eq.id;
}

async function setPersonaEquipment(userId: string, slugs: string[]) {
  const ids = await Promise.all(slugs.map(getEquipmentIdBySlug));
  await prisma.userEquipment.createMany({
    data: ids.map((equipmentId) => ({ userId, equipmentId })),
    skipDuplicates: true,
  });
}

async function fetchAllowedExercises(userId: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ limit: "500", ...params }).toString();
  const res = await fetch(`${BASE_URL}/internal/exercises/for-ai-plans?${qs}`, {
    headers: { "x-internal-token": INTERNAL_SECRET, "x-user-id": userId },
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = (await res.json()) as { success: boolean; data: { exercises: Array<{ id: string; exerciseName: string }> } };
  assert.ok(body.success);
  return body.data.exercises;
}

async function equipmentSlugsRequiredBy(exerciseId: string): Promise<string[]> {
  const links = await prisma.exerciseEquipment.findMany({
    where: { exerciseId },
    include: { equipment: true },
  });
  return links.map((l) => l.equipment.slug);
}

const cleanupUserIds: string[] = [];
test.after(async () => {
  await prisma.userEquipment.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.$disconnect();
});

test("Persona A (bodyweight only + pull-up bar): no machine/barbell/dumbbell/cable exercise is ever returned", { timeout: 20_000 }, async () => {
  const userId = `persona-a-${randomUUID()}`;
  cleanupUserIds.push(userId);
  await setPersonaEquipment(userId, ["bodyweight", "pull-up-bar"]);

  const exercises = await fetchAllowedExercises(userId);
  assert.ok(exercises.length > 0, "expected at least some bodyweight exercises");

  for (const ex of exercises) {
    const required = await equipmentSlugsRequiredBy(ex.id);
    const owned = new Set(["bodyweight", "pull-up-bar"]);
    // every REQUIRED link must be owned by this persona
    const links = await prisma.exerciseEquipment.findMany({ where: { exerciseId: ex.id } });
    const requiredSlugs = links.filter((l) => l.requirementType === "REQUIRED");
    for (const link of requiredSlugs) {
      const eq = await prisma.equipment.findUniqueOrThrow({ where: { id: link.equipmentId } });
      assert.ok(owned.has(eq.slug), `Persona A got "${ex.exerciseName}" which requires "${eq.slug}" (required: ${required})`);
    }
  }
});

test("Persona B (home gym: dumbbell/barbell/bench/rack/pull-up bar): no machine/cable/leg-press-only exercise appears", { timeout: 20_000 }, async () => {
  const userId = `persona-b-${randomUUID()}`;
  cleanupUserIds.push(userId);
  await setPersonaEquipment(userId, ["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "bodyweight"]);

  const exercises = await fetchAllowedExercises(userId);
  assert.ok(exercises.length > 0);

  const forbiddenSlugs = new Set([
    "leg-press-machine",
    "cable-machine",
    "pec-deck-machine",
    "lat-pulldown-machine",
    "hack-squat-machine",
    "leg-extension-machine",
    "leg-curl-machine",
    "chest-press-machine",
    "seated-row-machine",
    "smith-machine",
    "generic-machine",
  ]);
  for (const ex of exercises) {
    const links = await prisma.exerciseEquipment.findMany({ where: { exerciseId: ex.id, requirementType: "REQUIRED" } });
    for (const link of links) {
      const eq = await prisma.equipment.findUniqueOrThrow({ where: { id: link.equipmentId } });
      assert.ok(!forbiddenSlugs.has(eq.slug), `Persona B (home gym) got "${ex.exerciseName}" which requires "${eq.slug}"`);
    }
  }
});

test("Persona C (full commercial gym: owns everything in the catalog): full pool available, at least one machine exercise present", { timeout: 20_000 }, async () => {
  const userId = `persona-c-${randomUUID()}`;
  cleanupUserIds.push(userId);
  const all = await prisma.equipment.findMany({ select: { slug: true } });
  await setPersonaEquipment(userId, all.map((e) => e.slug));

  const exercises = await fetchAllowedExercises(userId);
  assert.ok(exercises.length > 400, `expected a large pool for full equipment, got ${exercises.length}`);

  // The endpoint's candidate pool is server-side capped at 500 and shuffled
  // before truncation (deliberately, so a real plan-generation call doesn't
  // get an alphabetically-biased sample) — with 883 total exercises, a
  // single named exercise can legitimately be left out of one unfiltered
  // 500-sample by chance even when it's fully available. Narrow to
  // bodyPart=LOWER_BODY (a few hundred exercises, well under the cap) so
  // this specific assertion is deterministic rather than flaky.
  const leg = await equipmentSlugsRequiredBy((await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Leg Press" } })).id);
  assert.ok(leg.includes("leg-press-machine"));
  const legExercises = await fetchAllowedExercises(userId, { bodyPart: "LOWER_BODY" });
  const legPressReturned = legExercises.some((e) => e.exerciseName === "Leg Press");
  assert.ok(legPressReturned, "Persona C should see Leg Press since they own every machine");
});

test("Persona without any saved equipment falls back to the pre-existing coarse behavior (never 500s, still returns exercises)", { timeout: 20_000 }, async () => {
  const userId = `persona-none-${randomUUID()}`;
  // deliberately no setPersonaEquipment call — simulates every pre-existing user
  const exercises = await fetchAllowedExercises(userId, { equipmentPreference: "MIXED_GYM" });
  assert.ok(exercises.length > 0, "backward-compatible fallback should still return a pool");
});
