/**
 * Throwaway read-only audit script for the exercise/nutrition data
 * expansion roadmap (Gate 1/2). Run inside the fitness-service container:
 *   npx tsx src/scripts/auditExercisesAndFoods.ts
 * Read-only — does not write anything.
 */
import { prisma } from "../repositories/prisma";

async function main() {
  const totalExercises = await prisma.exercise.count();
  const withMovementPattern = await prisma.exercise.count({ where: { movementPattern: { not: null } } });
  const withMechanics = await prisma.exercise.count({ where: { mechanics: { not: null } } });
  const withDifficulty = await prisma.exercise.count({ where: { difficultyLevel: { not: null } } });
  const withVideo = await prisma.exercise.count({ where: { videoUrl: { not: null } } });
  const withContraindications = await prisma.exercise.count({ where: { NOT: { contraindications: { equals: [] } } } });

  const earliestFive = await prisma.exercise.findMany({ orderBy: { createdAt: "asc" }, take: 5, select: { id: true, exerciseName: true, createdAt: true } });
  const sampleKnownSqlIds = await prisma.exercise.findMany({
    where: { id: { in: ["94f3832d-582d-4a03-a940-6fae6d7fb81f", "c6b382c9-b2ea-4649-9cdd-76d4e9c0b74c", "0bfce319-c414-42af-ace1-9e704f697679"] } },
    select: { id: true, exerciseName: true },
  });

  const allNames = await prisma.exercise.findMany({ select: { exerciseName: true } });
  const vnRegex = /[À-ỹ]/;
  const vietnameseNamed = allNames.filter((e) => vnRegex.test(e.exerciseName)).length;

  // Exact duplicate name detection (case-insensitive)
  const nameCounts = new Map<string, number>();
  for (const e of allNames) {
    const key = e.exerciseName.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const exactDuplicateNames = [...nameCounts.entries()].filter(([, count]) => count > 1);

  const totalEquipment = await prisma.equipment.count();
  const totalExerciseEquipment = await prisma.exerciseEquipment.count();

  const totalFoods = await prisma.food.count();
  const foodsBySource = await prisma.food.groupBy({ by: ["source"], _count: { _all: true } });
  const totalFoodAliases = await prisma.foodAlias.count();
  const foodsWithForm = await prisma.food.count({ where: { foodForm: { not: null } } });
  const foodsSupplement = await prisma.food.count({ where: { isSupplement: true } });

  // Consumer reference counts — which exercises are actually referenced by
  // WorkoutExercise / WorkoutProgramExercise (workout history + plan
  // templates) vs never used at all.
  const referencedInWorkoutExercise = await prisma.workoutExercise.groupBy({ by: ["exerciseId"] });
  const referencedInProgramExercise = await prisma.workoutProgramExercise.groupBy({ by: ["exerciseId"] });
  const referencedExerciseIds = new Set([
    ...referencedInWorkoutExercise.map((r) => r.exerciseId),
    ...referencedInProgramExercise.map((r) => r.exerciseId),
  ]);

  const referencedFoodsInMealItems = await prisma.nutritionProgramMealItem.groupBy({ by: ["foodId"], where: { foodId: { not: null } } });
  const referencedFoodIds = new Set(referencedFoodsInMealItems.map((r) => r.foodId));

  const report = {
    exercises: {
      totalExercises,
      withMovementPattern,
      withMechanics,
      withDifficulty,
      withVideo,
      withContraindications,
      vietnameseNamed,
      englishOnlyNamed: totalExercises - vietnameseNamed,
      exactDuplicateNameGroups: exactDuplicateNames.length,
      exactDuplicateNameSamples: exactDuplicateNames.slice(0, 20),
      earliestFive,
      sampleKnownSqlSeedIdsFound: sampleKnownSqlIds,
      referencedByWorkoutHistoryOrPrograms: referencedExerciseIds.size,
      neverReferenced: totalExercises - referencedExerciseIds.size,
    },
    equipment: { totalEquipment, totalExerciseEquipment },
    foods: {
      totalFoods,
      foodsBySource,
      totalFoodAliases,
      foodsWithForm,
      foodsSupplement,
      referencedInMealItems: referencedFoodIds.size,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
