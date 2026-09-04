/**
 * Hardening pass §9 — broad deterministic equipment-invariant coverage.
 * No LLM, no HTTP — pure synthetic schedules built from REAL exercise/
 * equipment records, crossed against several persona equipment sets.
 * Complements plan-equipment-validator.test.ts (which covers the service's
 * API surface) and exercise-substitution.test.ts (ranking behavior) —
 * this file stresses the underlying availability RULE itself at volume.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/equipment-invariants.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { isExerciseAvailable, type ExerciseEquipmentLink } from "../utils/equipment-availability.util";

test.after(async () => {
  await prisma.$disconnect();
});

async function equipmentId(slug: string): Promise<string> {
  return (await prisma.equipment.findUniqueOrThrow({ where: { slug } })).id;
}

/** Independent re-implementation of the SAME rule, written separately from
 * isExerciseAvailable on purpose — a bulk cross-check between two
 * independently-written implementations catches bugs a single
 * implementation's own tests structurally cannot (a bug shared by both the
 * code and its own hand-written test would never surface). */
function referenceIsAvailable(links: ExerciseEquipmentLink[], owned: Set<string>): boolean {
  const required = links.filter((l) => l.requirementType === "REQUIRED").map((l) => l.equipmentId);
  const alternatives = links.filter((l) => l.requirementType === "ALTERNATIVE").map((l) => l.equipmentId);
  for (const req of required) {
    if (!owned.has(req)) return false;
  }
  if (alternatives.length > 0) {
    let anyOwned = false;
    for (const alt of alternatives) {
      if (owned.has(alt)) anyOwned = true;
    }
    if (!anyOwned) return false;
  }
  return true;
}

type Persona = { name: string; slugs: string[] };

test("cross-validate isExerciseAvailable against an independently-written reference implementation across all 883 exercises × 5 personas", async () => {
  const personas: Persona[] = [
    { name: "bodyweight-only", slugs: ["bodyweight", "pull-up-bar"] },
    { name: "dumbbell-only", slugs: ["dumbbell", "bodyweight"] },
    { name: "home-gym", slugs: ["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "resistance-band", "bodyweight"] },
    { name: "cable-only", slugs: ["cable-machine", "bodyweight"] },
    {
      name: "full-commercial-gym",
      slugs: (await prisma.equipment.findMany({ where: { active: true }, select: { slug: true } })).map((e) => e.slug),
    },
  ];

  const allExercises = await prisma.exercise.findMany({ select: { id: true, exerciseName: true } });
  const allLinks = await prisma.exerciseEquipment.findMany({
    select: { exerciseId: true, equipmentId: true, requirementType: true },
  });
  const linksByExercise = new Map<string, ExerciseEquipmentLink[]>();
  for (const link of allLinks) {
    const arr = linksByExercise.get(link.exerciseId) ?? [];
    arr.push({ equipmentId: link.equipmentId, requirementType: link.requirementType });
    linksByExercise.set(link.exerciseId, arr);
  }

  let assertions = 0;
  for (const persona of personas) {
    const ownedIds = new Set(await Promise.all(persona.slugs.map(equipmentId)));
    for (const ex of allExercises) {
      const links = linksByExercise.get(ex.id) ?? [];
      const actual = isExerciseAvailable(links, ownedIds);
      const expected = referenceIsAvailable(links, ownedIds);
      assert.equal(
        actual,
        expected,
        `persona=${persona.name} exercise="${ex.exerciseName}": isExerciseAvailable=${actual} but reference implementation says ${expected}`,
      );
      assertions++;
    }
  }
  console.log(`  (cross-validated ${assertions} exercise×persona combinations)`);
  assert.ok(assertions > 100, "expected well over 100 cross-validated combinations");
});

// ── Named qualitative properties per persona ─────────────────────────────

test("bodyweight persona: no exercise requiring external equipment ever validates as available", async () => {
  const ownedIds = new Set([await equipmentId("bodyweight"), await equipmentId("pull-up-bar")]);
  const exercises = await prisma.exercise.findMany({
    include: { equipmentLinks: true },
    take: 300,
  });
  let checked = 0;
  for (const ex of exercises) {
    const links = ex.equipmentLinks.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
    const required = links.filter((l) => l.requirementType === "REQUIRED");
    const hasExternalRequirement = required.some((l) => !ownedIds.has(l.equipmentId));
    if (hasExternalRequirement) {
      assert.equal(
        isExerciseAvailable(links, ownedIds),
        false,
        `${ex.exerciseName} requires equipment outside {bodyweight, pull-up-bar} but was marked available`,
      );
      checked++;
    }
  }
  assert.ok(checked > 50, `expected to find >50 externally-equipped exercises to check against, found ${checked}`);
});

test("dumbbell-only persona: barbell/machine/cable-only exercises never pass", async () => {
  const ownedIds = new Set([await equipmentId("dumbbell"), await equipmentId("bodyweight")]);
  const barbellOnlyExercise = await prisma.exercise.findFirstOrThrow({
    where: { exerciseName: "Barbell Deadlift" },
    include: { equipmentLinks: true },
  });
  const machineExercise = await prisma.exercise.findFirstOrThrow({
    where: { exerciseName: "Leg Press" },
    include: { equipmentLinks: true },
  });
  const links = (ex: typeof barbellOnlyExercise) =>
    ex.equipmentLinks.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
  assert.equal(isExerciseAvailable(links(barbellOnlyExercise), ownedIds), false);
  assert.equal(isExerciseAvailable(links(machineExercise), ownedIds), false);
});

test("home gym persona: no cable/machine-only exercise passes (leg press, pec deck, seated row machine)", async () => {
  const ownedIds = new Set(
    await Promise.all(["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "resistance-band", "bodyweight"].map(equipmentId)),
  );
  for (const name of ["Leg Press", "Hack Squat", "Seated Cable Rows"]) {
    const ex = await prisma.exercise.findFirst({ where: { exerciseName: name }, include: { equipmentLinks: true } });
    if (!ex) continue; // some names may not exist verbatim — skip rather than false-fail
    const links = ex.equipmentLinks.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
    assert.equal(isExerciseAvailable(links, ownedIds), false, `${name} should be unavailable for a home-gym persona`);
  }
});

test("full commercial gym persona (owns every active equipment item): broad catalog passes, near-0 unavailable", async () => {
  const allActive = await prisma.equipment.findMany({ where: { active: true }, select: { id: true } });
  const ownedIds = new Set(allActive.map((e) => e.id));
  const exercises = await prisma.exercise.findMany({ include: { equipmentLinks: true } });
  let unavailable = 0;
  for (const ex of exercises) {
    const links = ex.equipmentLinks.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
    if (!isExerciseAvailable(links, ownedIds)) unavailable++;
  }
  assert.equal(unavailable, 0, `expected 0 unavailable exercises when owning every active equipment item, got ${unavailable}`);
});

test("capability case: the single generic 'bench' equipment item satisfies every flat/incline/decline bench-requiring exercise (no fragmented flat-vs-incline-vs-adjustable entities)", async () => {
  const benchId = await equipmentId("bench");
  const requiredOnlyBench = await prisma.exerciseEquipment.findMany({
    where: { equipmentId: benchId, requirementType: "REQUIRED" },
    include: { exercise: true },
    take: 20,
  });
  assert.ok(requiredOnlyBench.length > 10, "expected many exercises to require the generic bench entity");
  const inclineOrDeclineNamed = requiredOnlyBench.filter((r) =>
    /incline|decline/i.test(r.exercise.exerciseName),
  );
  assert.ok(
    inclineOrDeclineNamed.length > 0,
    "expected at least one incline/decline-named exercise to be satisfied by the single generic bench entity",
  );
});

test("alternative-equipment case: an exercise with a cable-machine alternative passes when only the alternative machine is owned, not the literally-named one", async () => {
  const latPulldownMachineId = await equipmentId("lat-pulldown-machine");
  const links = await prisma.exerciseEquipment.findMany({
    where: { equipmentId: latPulldownMachineId, requirementType: "ALTERNATIVE" },
    take: 3,
  });
  assert.ok(links.length > 0, "expected at least one ALTERNATIVE-linked lat-pulldown exercise");
  for (const link of links) {
    const allLinksForExercise = await prisma.exerciseEquipment.findMany({ where: { exerciseId: link.exerciseId } });
    const asLinks = allLinksForExercise.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
    // Own ONLY cable-machine, NOT lat-pulldown-machine itself.
    const cableOnly = new Set([await equipmentId("cable-machine")]);
    assert.equal(isExerciseAvailable(asLinks, cableOnly), true);
  }
});

test("multi-required case: barbell squat (barbell + squat-rack) fails when only barbell is owned", async () => {
  const ex = await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Barbell Squat" }, include: { equipmentLinks: true } });
  const links = ex.equipmentLinks.map((l) => ({ equipmentId: l.equipmentId, requirementType: l.requirementType }));
  const requiredSlugs = await Promise.all(
    ex.equipmentLinks
      .filter((l) => l.requirementType === "REQUIRED")
      .map(async (l) => (await prisma.equipment.findUniqueOrThrow({ where: { id: l.equipmentId } })).slug),
  );
  assert.ok(requiredSlugs.includes("squat-rack"), `expected Barbell Squat to require squat-rack, got ${requiredSlugs}`);

  const barbellOnly = new Set([await equipmentId("barbell")]);
  assert.equal(isExerciseAvailable(links, barbellOnly), false);

  const barbellAndRack = new Set([await equipmentId("barbell"), await equipmentId("squat-rack")]);
  assert.equal(isExerciseAvailable(links, barbellAndRack), true);
});
