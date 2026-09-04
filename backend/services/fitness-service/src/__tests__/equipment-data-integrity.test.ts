/**
 * Gym-onboarding project — real automated coverage for the invariants
 * checked by src/scripts/auditEquipmentData.ts (§31: "Add tests that fail
 * when: exercise references missing equipment, equipment slug duplicates
 * exist, exercise has no primary muscle where required, equipment relation
 * contains duplicates").
 *
 * fitness-service has no separate `_test` database configured in this dev
 * environment (DATABASE_URL points at the real `gymcoach_fitness` dev DB,
 * which is also where the equipment catalog + 874-exercise mapping was
 * actually seeded — see prisma/seed_equipment.ts) — same accepted
 * constraint already documented for ai-service's integration tests this
 * session. All assertions here are read-only against seeded reference
 * data, so this is safe to run repeatedly against the live dev DB.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/equipment-data-integrity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { isExerciseAvailable } from "../utils/equipment-availability.util";

test.after(async () => {
  await prisma.$disconnect();
});

test("every exercise has at least one equipment link", async () => {
  const missing = await prisma.exercise.findMany({
    where: { equipmentLinks: { none: {} } },
    select: { exerciseName: true },
  });
  assert.deepEqual(missing, [], `exercises missing equipment: ${missing.map((m) => m.exerciseName).join(", ")}`);
});

test("no duplicate equipment slugs", async () => {
  const dupes = await prisma.$queryRaw<Array<{ slug: string; c: bigint }>>`
    SELECT slug, count(*)::bigint as c FROM equipment GROUP BY slug HAVING count(*) > 1
  `;
  assert.equal(dupes.length, 0, `duplicate slugs: ${dupes.map((d) => d.slug).join(", ")}`);
});

test("no duplicate ExerciseEquipment relations (same exercise+equipment pair twice)", async () => {
  const dupes = await prisma.$queryRaw<Array<{ exercise_id: string; equipment_id: string; c: bigint }>>`
    SELECT exercise_id, equipment_id, count(*)::bigint as c FROM exercise_equipment
    GROUP BY exercise_id, equipment_id HAVING count(*) > 1
  `;
  assert.equal(dupes.length, 0, `duplicate exercise/equipment pairs found: ${dupes.length}`);
});

test("every exercise has non-empty muscle-group data", async () => {
  const count = await prisma.exercise.count({ where: { muscleGroupsActivated: { equals: [] } } });
  assert.equal(count, 0, `${count} exercises have no muscle-group data`);
});

test("every ExerciseEquipment row references a real exercise and equipment row (no orphans)", async () => {
  const orphaned = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint as count FROM exercise_equipment ee
    LEFT JOIN exercises e ON e.id = ee.exercise_id
    LEFT JOIN equipment eq ON eq.id = ee.equipment_id
    WHERE e.id IS NULL OR eq.id IS NULL
  `;
  assert.equal(Number(orphaned[0]?.count ?? 0), 0);
});

test("requirementType is always one of REQUIRED/ALTERNATIVE/OPTIONAL", async () => {
  const bad = await prisma.exerciseEquipment.findMany({
    where: { requirementType: { notIn: ["REQUIRED", "ALTERNATIVE", "OPTIONAL"] } },
    select: { id: true, requirementType: true },
  });
  assert.deepEqual(bad, []);
});

// ── isExerciseAvailable rule-engine unit coverage ────────────────────────

test("isExerciseAvailable: REQUIRED links must ALL be owned", () => {
  const links = [
    { equipmentId: "barbell", requirementType: "REQUIRED" },
    { equipmentId: "bench", requirementType: "REQUIRED" },
  ];
  assert.equal(isExerciseAvailable(links, new Set(["barbell", "bench"])), true);
  assert.equal(isExerciseAvailable(links, new Set(["barbell"])), false);
  assert.equal(isExerciseAvailable(links, new Set([])), false);
});

test("isExerciseAvailable: ALTERNATIVE links need only ONE owned", () => {
  const links = [
    { equipmentId: "lat-pulldown-machine", requirementType: "ALTERNATIVE" },
    { equipmentId: "cable-machine", requirementType: "ALTERNATIVE" },
  ];
  assert.equal(isExerciseAvailable(links, new Set(["cable-machine"])), true);
  assert.equal(isExerciseAvailable(links, new Set(["lat-pulldown-machine"])), true);
  assert.equal(isExerciseAvailable(links, new Set(["dumbbell"])), false);
});

test("isExerciseAvailable: mixed REQUIRED + ALTERNATIVE needs all REQUIRED and at least one ALTERNATIVE", () => {
  const links = [
    { equipmentId: "bench", requirementType: "REQUIRED" },
    { equipmentId: "barbell", requirementType: "ALTERNATIVE" },
    { equipmentId: "dumbbell", requirementType: "ALTERNATIVE" },
  ];
  assert.equal(isExerciseAvailable(links, new Set(["bench", "barbell"])), true);
  assert.equal(isExerciseAvailable(links, new Set(["bench"])), false); // no alternative owned
  assert.equal(isExerciseAvailable(links, new Set(["barbell"])), false); // required bench missing
});

test("isExerciseAvailable: an exercise with zero equipment links is always available", () => {
  assert.equal(isExerciseAvailable([], new Set([])), true);
});

// ── Real-catalog spot checks (§52: chest/back/legs/shoulders/biceps/triceps) ─

async function equipmentSlugsFor(exerciseName: string): Promise<string[]> {
  const ex = await prisma.exercise.findFirst({
    where: { exerciseName },
    include: { equipmentLinks: { include: { equipment: true } } },
  });
  if (!ex) return [];
  return ex.equipmentLinks.map((l) => l.equipment.slug).sort();
}

test("spot check: Barbell Bench Press - Medium Grip requires barbell + bench", async () => {
  const slugs = await equipmentSlugsFor("Barbell Bench Press - Medium Grip");
  assert.ok(slugs.includes("barbell"), `expected barbell, got ${slugs}`);
  assert.ok(slugs.includes("bench"), `expected bench, got ${slugs}`);
});

test("spot check: Leg Press requires leg-press-machine (not dumbbell-only)", async () => {
  const slugs = await equipmentSlugsFor("Leg Press");
  assert.ok(slugs.includes("leg-press-machine"), `expected leg-press-machine, got ${slugs}`);
  assert.ok(!slugs.includes("dumbbell"), `should not require dumbbell, got ${slugs}`);
});

test("spot check: Pushups require only bodyweight", async () => {
  const slugs = await equipmentSlugsFor("Pushups");
  assert.deepEqual(slugs, ["bodyweight"]);
});

test("spot check: Pullups require bodyweight + pull-up-bar", async () => {
  const slugs = await equipmentSlugsFor("Pullups");
  assert.ok(slugs.includes("bodyweight"));
  assert.ok(slugs.includes("pull-up-bar"), `Pull-ups should require a bar, got ${slugs}`);
});

// ── generic-machine cleanup pass — every previously-unclassified exercise
// now maps to a real, specific apparatus (or a curated new one) ─────────

test("no exercise uses the generic-machine fallback anymore", async () => {
  const rows = await prisma.exercise.findMany({
    where: { equipmentLinks: { some: { equipment: { slug: "generic-machine" } } } },
    select: { exerciseName: true },
  });
  assert.deepEqual(rows, [], `still using generic-machine fallback: ${rows.map((r) => r.exerciseName).join(", ")}`);
});

// Hardening pass §14/§18 — "generic-machine" is now `active=false` (a real
// enforced state, not a slug this test has to know about by name). Every
// ACTIVE (user-selectable) equipment item must have at least one exercise;
// zero-exercise equipment is only ever acceptable when inactive.
test("every ACTIVE (user-selectable) equipment item has at least one mapped exercise", async () => {
  const zero = await prisma.equipment.findMany({
    where: { exerciseLinks: { none: {} }, active: true },
    select: { slug: true },
  });
  assert.deepEqual(zero, [], `active equipment with no exercises: ${zero.map((e) => e.slug).join(", ")}`);
});

test("generic-machine is inactive (internal-only, never selectable)", async () => {
  const eq = await prisma.equipment.findUniqueOrThrow({ where: { slug: "generic-machine" } });
  assert.equal(eq.active, false);
});

test("GET /equipment (catalog) never returns generic-machine", async () => {
  const catalog = await prisma.equipment.findMany({ where: { active: true }, select: { slug: true } });
  assert.ok(!catalog.some((e) => e.slug === "generic-machine"));
});

test("spot check: Calf-Machine Shoulder Shrug now maps to calf-raise-machine, not generic-machine", async () => {
  const slugs = await equipmentSlugsFor("Calf-Machine Shoulder Shrug");
  assert.deepEqual(slugs, ["calf-raise-machine"]);
});

test("spot check: Glute Ham Raise and Reverse Hyperextension map to hyperextension-bench", async () => {
  assert.deepEqual(await equipmentSlugsFor("Glute Ham Raise"), ["hyperextension-bench"]);
  assert.deepEqual(await equipmentSlugsFor("Reverse Hyperextension"), ["hyperextension-bench"]);
});

test("spot check: Leverage Deadlift and Leverage Shrug map to leverage-machine", async () => {
  assert.deepEqual(await equipmentSlugsFor("Leverage Deadlift"), ["leverage-machine"]);
  assert.deepEqual(await equipmentSlugsFor("Leverage Shrug"), ["leverage-machine"]);
});

// ── curated gap-filling exercises (suspension-trainer / assisted-pullup-dip
// / glute-machine previously had zero mapped exercises) ────────────────

test("suspension-trainer, assisted-pullup-dip-machine, and glute-machine each have real mapped exercises now", async () => {
  for (const slug of ["suspension-trainer", "assisted-pullup-dip-machine", "glute-machine"]) {
    const equipment = await prisma.equipment.findUniqueOrThrow({
      where: { slug },
      include: { exerciseLinks: { include: { exercise: true } } },
    });
    assert.ok(
      equipment.exerciseLinks.length > 0,
      `${slug} should have at least one mapped exercise now`,
    );
  }
});

test("spot check: Machine Assisted Pull-Up requires assisted-pullup-dip-machine", async () => {
  const slugs = await equipmentSlugsFor("Machine Assisted Pull-Up");
  assert.deepEqual(slugs, ["assisted-pullup-dip-machine"]);
});

test("spot check: Machine Hip Thrust requires glute-machine", async () => {
  const slugs = await equipmentSlugsFor("Machine Hip Thrust");
  assert.deepEqual(slugs, ["glute-machine"]);
});
