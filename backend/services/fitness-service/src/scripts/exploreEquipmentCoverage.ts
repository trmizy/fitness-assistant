/**
 * Gym-onboarding project follow-up §18 — developer-facing explorability:
 * equipment -> mapped exercises, and exercise -> required equipment. Not
 * exposed to normal users (no HTTP route) — this is a data-maintenance
 * tool, run ad hoc by whoever is curating the catalog.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx src/scripts/exploreEquipmentCoverage.ts                # summary (all equipment)
 *   npx tsx src/scripts/exploreEquipmentCoverage.ts --equipment lat-pulldown-machine   # list its exercises
 *   npx tsx src/scripts/exploreEquipmentCoverage.ts --exercise "Barbell Bench Press - Medium Grip"  # list its equipment
 */
import { prisma } from "../repositories/prisma";

async function summary() {
  const equipment = await prisma.equipment.findMany({
    include: { exerciseLinks: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  console.log("Equipment -> mapped exercises");
  console.log("==============================");
  let currentCategory = "";
  for (const eq of equipment) {
    if (eq.category !== currentCategory) {
      currentCategory = eq.category;
      console.log(`\n[${currentCategory}]`);
    }
    console.log(`${eq.name} (${eq.slug})\n  ${eq.exerciseLinks.length} exercises`);
  }
}

async function forEquipment(slug: string) {
  const eq = await prisma.equipment.findUnique({
    where: { slug },
    include: { exerciseLinks: { include: { exercise: true }, orderBy: { exercise: { exerciseName: "asc" } } } },
  });
  if (!eq) {
    console.error(`No equipment with slug "${slug}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`${eq.name} (${eq.slug})`);
  console.log(`${eq.exerciseLinks.length} exercises`);
  for (const link of eq.exerciseLinks) {
    console.log(`  [${link.requirementType}] ${link.exercise.exerciseName}`);
  }
}

async function forExercise(name: string) {
  const ex = await prisma.exercise.findFirst({
    where: { exerciseName: name },
    include: { equipmentLinks: { include: { equipment: true } } },
  });
  if (!ex) {
    console.error(`No exercise named "${name}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`${ex.exerciseName}`);
  console.log(`bodyPart=${ex.bodyPart} movementPattern=${ex.movementPattern} mechanics=${ex.mechanics}`);
  console.log("Required/alternative equipment:");
  for (const link of ex.equipmentLinks) {
    console.log(`  [${link.requirementType}] ${link.equipment.name} (${link.equipment.slug})`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const eqIdx = args.indexOf("--equipment");
  const exIdx = args.indexOf("--exercise");
  if (eqIdx !== -1 && args[eqIdx + 1]) {
    await forEquipment(args[eqIdx + 1]);
  } else if (exIdx !== -1 && args[exIdx + 1]) {
    await forExercise(args[exIdx + 1]);
  } else {
    await summary();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
