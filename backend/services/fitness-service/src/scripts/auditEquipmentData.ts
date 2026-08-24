/**
 * Exercise / Equipment data-integrity audit — gym-onboarding project.
 * Prints a report and exits non-zero if any CRITICAL issue is found.
 *
 * Hardening pass §14/§18: "generic-machine" is now `active=false` (a real,
 * enforced state — see prisma/seed_equipment.ts) rather than a special-
 * cased slug this script had to know about by name. The only equipment
 * this script still expects to legitimately have zero exercises is
 * inactive equipment — every ACTIVE (user-selectable) item must have at
 * least one, with no exceptions and no hardcoded slug list.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx src/scripts/auditEquipmentData.ts
 */
import { prisma } from "../repositories/prisma";

async function main() {
  const [exerciseCount, equipmentCount, activeEquipmentCount, exerciseEquipmentCount] = await Promise.all([
    prisma.exercise.count(),
    prisma.equipment.count(),
    prisma.equipment.count({ where: { active: true } }),
    prisma.exerciseEquipment.count(),
  ]);
  const inactiveEquipmentCount = equipmentCount - activeEquipmentCount;

  const exercisesMissingEquipment = await prisma.exercise.findMany({
    where: { equipmentLinks: { none: {} } },
    select: { id: true, exerciseName: true },
  });

  const equipmentWithZeroExercises = await prisma.equipment.findMany({
    where: { exerciseLinks: { none: {} } },
    select: { slug: true, name: true, active: true },
  });
  const activeEquipmentWithZeroExercises = equipmentWithZeroExercises.filter((e) => e.active);

  const exercisesMissingMuscle = await prisma.exercise.count({
    where: { muscleGroupsActivated: { equals: [] } },
  });

  const exercisesMissingMovementPattern = await prisma.exercise.count({
    where: { movementPattern: null },
  });

  const exercisesMissingMechanics = await prisma.exercise.count({
    where: { mechanics: null },
  });

  const genericMachineExercises = await prisma.exercise.findMany({
    where: { equipmentLinks: { some: { equipment: { slug: "generic-machine" } } } },
    select: { exerciseName: true },
  });

  // Invalid references: ExerciseEquipment rows pointing at a missing
  // exercise/equipment row. FKs make this structurally impossible today,
  // but this is re-run after every reseed, so it stays a real check rather
  // than an assumption.
  const orphanedLinks = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint as count FROM exercise_equipment ee
    LEFT JOIN exercises e ON e.id = ee.exercise_id
    LEFT JOIN equipment eq ON eq.id = ee.equipment_id
    WHERE e.id IS NULL OR eq.id IS NULL
  `;
  const invalidReferences = Number(orphanedLinks[0]?.count ?? 0);

  // Duplicate equipment slugs (unique constraint makes this structurally
  // impossible too, but checked explicitly per the requested test list).
  const duplicateSlugs = await prisma.$queryRaw<Array<{ slug: string; count: bigint }>>`
    SELECT slug, count(*)::bigint as count FROM equipment GROUP BY slug HAVING count(*) > 1
  `;

  // Duplicate (exerciseId, equipmentId) pairs — the @@unique constraint
  // already prevents this structurally; checked explicitly anyway (§17).
  const duplicateLinks = await prisma.$queryRaw<Array<{ exercise_id: string; equipment_id: string; count: bigint }>>`
    SELECT exercise_id, equipment_id, count(*)::bigint as count FROM exercise_equipment
    GROUP BY exercise_id, equipment_id HAVING count(*) > 1
  `;

  console.log("Exercise Catalog Audit");
  console.log("======================");
  console.log(`Exercises: ${exerciseCount}`);
  console.log(`Equipment: ${equipmentCount}`);
  console.log(`Active user-selectable equipment: ${activeEquipmentCount}`);
  console.log(`Internal/inactive equipment: ${inactiveEquipmentCount}`);
  console.log(`Exercise<->Equipment links: ${exerciseEquipmentCount}`);
  console.log("");
  console.log(`Exercises missing equipment: ${exercisesMissingEquipment.length}`);
  if (exercisesMissingEquipment.length > 0) {
    console.log(`  → ${exercisesMissingEquipment.map((e) => e.exerciseName).join(", ")}`);
  }
  console.log("");
  console.log(`Equipment with zero exercises (any, incl. inactive): ${equipmentWithZeroExercises.length}`);
  console.log(`User-selectable equipment with zero exercises: ${activeEquipmentWithZeroExercises.length}`);
  for (const e of equipmentWithZeroExercises) {
    console.log(`  → ${e.name} (${e.slug}) — ${e.active ? "⚠ ACTIVE but unused" : "inactive (expected)"}`);
  }
  console.log("");
  console.log(`Generic-machine exercise mappings: ${genericMachineExercises.length} (accepted target: 0 — see seed_equipment.ts's EXPLICIT_EQUIPMENT_OVERRIDES)`);
  console.log(`Missing movementPattern: ${exercisesMissingMovementPattern}`);
  console.log(`Missing primary muscle: ${exercisesMissingMuscle}`);
  console.log(`Missing mechanics: ${exercisesMissingMechanics} (see src/scripts/auditMissingMechanics.ts — source-dataset gap for mobility/cardio/ambiguous drills, not guessed)`);
  console.log("");
  console.log(`Invalid references: ${invalidReferences}`);
  console.log(`Duplicate equipment slugs: ${duplicateSlugs.length}`);
  console.log(`Duplicate ExerciseEquipment links: ${duplicateLinks.length}`);

  const critical =
    exercisesMissingEquipment.length > 0 ||
    activeEquipmentWithZeroExercises.length > 0 ||
    genericMachineExercises.length > 0 ||
    exercisesMissingMuscle > 0 ||
    exercisesMissingMovementPattern > 0 ||
    invalidReferences > 0 ||
    duplicateSlugs.length > 0 ||
    duplicateLinks.length > 0;

  console.log("");
  console.log(critical ? "❌ CRITICAL issues found — see above." : "✅ No unexplained critical data-integrity issues.");
  process.exitCode = critical ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
