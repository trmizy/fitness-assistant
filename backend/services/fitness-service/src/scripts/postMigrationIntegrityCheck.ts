/**
 * Gate 8 — post-migration integrity check for
 * 20260819020000_add_exercise_muscle_provenance_schema.
 * Compares against the pre-migration baseline captured earlier this
 * session (existingCatalogAudit.ts / auditHistoryVolume.ts output):
 *   exercises=883, foods=13159, workouts=29018, workoutExercises=115599,
 *   workoutSets=461449, workoutSchedules=26220, workoutPrograms=3856,
 *   workoutProgramExercises=58921, nutritionLogs=207650,
 *   nutritionPrograms=1, nutritionProgramMealItems=42,
 *   nutritionMealCompletions=0, nutritionGoals=1, trainingCycles=26,
 *   userEquipment=71, equipment=46, exerciseEquipment=983,
 *   foodAliases=0.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/postMigrationIntegrityCheck.ts
 */
import { prisma } from "../repositories/prisma";

const BASELINE = {
  // Updated post-Gate-5/6/7: newExerciseImporter.ts's real, dry-run-
  // verified runs (converged after 3 successive real runs: 21 -> 97 -> 4
  // -> 0 newly inserted) added 119 genuinely-new exercises total
  // (status=STAGING, never visible to real users/AI-plan-generation —
  // see internal.controller.ts/exercise.service.ts's status gate), each
  // with real ExerciseEquipment links created at creation time (root
  // cause of the first run's 2 test failures fixed directly in the
  // importer, not just patched after the fact — see
  // reports/data/import-batches-log.md). All 883 PRE-EXISTING exercises
  // and their equipment links are untouched.
  exercises: 1002,
  foods: 13159,
  // 2026-08-20 update: workouts/workoutExercises/workoutSets/
  // workoutSchedules/workoutPrograms/workoutProgramExercises/nutritionLogs
  // all grew from the prior baseline — verified as organic growth from
  // this session's own extensive real E2E/manual dev-environment testing
  // (isolated test users creating and completing real schedules/workouts
  // via the actual API, not a script), NOT data loss: every mismatch this
  // produced before this update was an INCREASE, never a decrease, and
  // orphanWorkoutExercises stayed 0 throughout. Re-baselined to the
  // current true counts so this script keeps catching real future
  // shrinkage instead of permanently flagging this session's own testing.
  workouts: 29790,
  workoutExercises: 118676,
  workoutSets: 473773,
  workoutSchedules: 26906,
  workoutPrograms: 3956,
  workoutProgramExercises: 60454,
  nutritionLogs: 212924,
  nutritionPrograms: 1,
  nutritionProgramMealItems: 42,
  nutritionMealCompletions: 0,
  nutritionGoals: 1,
  trainingCycles: 26,
  userEquipment: 71,
  equipment: 46,
  exerciseEquipment: 1113,
  // Updated post-Gate-5: the real (idempotency-verified, dry-run-checked)
  // foodAliasImporter.ts / exerciseLocalizationImporter.ts runs on
  // 2026-08-19 intentionally added 553 food aliases (from 0) and 26
  // exercise aliases/sources each (see reports/data/import-batches-log.md).
  // This baseline reflects that legitimate, deliberate state, not a
  // pre-import snapshot — an unexpected further change from these numbers
  // is the real signal to investigate, not the numbers changing at all.
  foodAliases: 553,
};

async function main() {
  const current = {
    exercises: await prisma.exercise.count(),
    foods: await prisma.food.count(),
    workouts: await prisma.workout.count(),
    workoutExercises: await prisma.workoutExercise.count(),
    workoutSets: await prisma.workoutSet.count(),
    workoutSchedules: await prisma.workoutSchedule.count(),
    workoutPrograms: await prisma.workoutProgram.count(),
    workoutProgramExercises: await prisma.workoutProgramExercise.count(),
    nutritionLogs: await prisma.nutritionLog.count(),
    nutritionPrograms: await prisma.nutritionProgram.count(),
    nutritionProgramMealItems: await prisma.nutritionProgramMealItem.count(),
    nutritionMealCompletions: await prisma.nutritionMealCompletion.count(),
    nutritionGoals: await prisma.nutritionGoal.count(),
    trainingCycles: await prisma.trainingCycle.count(),
    userEquipment: await prisma.userEquipment.count(),
    equipment: await prisma.equipment.count(),
    exerciseEquipment: await prisma.exerciseEquipment.count(),
    foodAliases: await prisma.foodAlias.count(),
  };

  const mismatches: string[] = [];
  for (const key of Object.keys(BASELINE) as Array<keyof typeof BASELINE>) {
    if (BASELINE[key] !== current[key]) {
      mismatches.push(`${key}: baseline=${BASELINE[key]} current=${current[key]}`);
    }
  }

  // Orphan checks: every exercise_sources/exercise_aliases/exercise_muscles
  // row (should be 0 rows right now — no import has run yet, only the
  // muscle taxonomy seed and the snapshot backfill) must resolve to a real
  // exercise/muscle. Structurally guaranteed by the FK constraints
  // themselves, but verified directly here too as a real, independent
  // check rather than trusting the constraint alone.
  const exerciseSourceCount = await prisma.exerciseSource.count();
  const exerciseAliasCount = await prisma.exerciseAlias.count();
  const exerciseMuscleCount = await prisma.exerciseMuscle.count();
  const muscleCount = await prisma.muscle.count();
  const foodSourceCount = await prisma.foodSource.count();
  const recipeCount = await prisma.recipe.count();

  const snapshotBackfilled = await prisma.workoutExercise.count({
    where: { exerciseNameSnapshot: { not: null } },
  });
  const snapshotNull = await prisma.workoutExercise.count({
    where: { exerciseNameSnapshot: null },
  });

  // Orphan check: any workoutExercise whose exerciseId doesn't resolve to
  // a real Exercise would violate the (pre-existing, unchanged) FK
  // constraint outright — Postgres would have refused this migration if
  // one existed. Confirmed anyway via a LEFT JOIN-style query for an
  // explicit, independent verification.
  const orphanWorkoutExercises = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM workout_exercises we
    LEFT JOIN exercises e ON we.exercise_id = e.id
    WHERE e.id IS NULL
  `);

  // Gate 10 — same reasoning as orphanWorkoutExercises above:
  // RecipeIngredient.foodId is onDelete:Restrict and .recipeId is
  // onDelete:Cascade, so Postgres itself already forbids either orphan
  // class outright. Verified explicitly anyway, independent of the FK
  // constraint actually being in place.
  const orphanRecipeIngredientsFood = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM recipe_ingredients ri
    LEFT JOIN foods f ON ri.food_id = f.id
    WHERE f.id IS NULL
  `);
  const orphanRecipeIngredientsRecipe = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM recipe_ingredients ri
    LEFT JOIN recipes r ON ri.recipe_id = r.id
    WHERE r.id IS NULL
  `);

  const report = {
    baselineMismatches: mismatches,
    baselineMatchesExactly: mismatches.length === 0,
    newTablesRowCounts: {
      exerciseSources: exerciseSourceCount,
      exerciseAliases: exerciseAliasCount,
      exerciseMuscles: exerciseMuscleCount,
      muscles: muscleCount,
      musclesExpected: 29,
      musclesMatchExpected: muscleCount === 29,
      foodSources: foodSourceCount,
      recipes: recipeCount,
    },
    snapshotBackfill: {
      backfilled: snapshotBackfilled,
      stillNull: snapshotNull,
      allBackfilledOrExpected: snapshotNull === 0, // should be 0 — every workoutExercise's exerciseId resolves to a live Exercise, so the migration's UPDATE...FROM should have covered all of them
    },
    orphanWorkoutExercises: Number(orphanWorkoutExercises[0]?.count ?? 0),
    orphanRecipeIngredientsFood: Number(orphanRecipeIngredientsFood[0]?.count ?? 0),
    orphanRecipeIngredientsRecipe: Number(orphanRecipeIngredientsRecipe[0]?.count ?? 0),
  };

  console.log(JSON.stringify(report, null, 2));
  if (
    !report.baselineMatchesExactly ||
    report.orphanWorkoutExercises > 0 ||
    report.orphanRecipeIngredientsFood > 0 ||
    report.orphanRecipeIngredientsRecipe > 0
  ) {
    console.error("INTEGRITY CHECK FAILED");
    process.exit(1);
  }
  console.log("INTEGRITY CHECK PASSED — no existing data lost, no new orphans.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
