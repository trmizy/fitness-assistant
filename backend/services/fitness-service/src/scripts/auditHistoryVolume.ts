/**
 * Throwaway read-only audit script (Gate 1/2) — real workout/nutrition
 * HISTORY volume that any migration/import must not lose or alter.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/auditHistoryVolume.ts
 */
import { prisma } from "../repositories/prisma";

async function main() {
  const counts = {
    workouts: await prisma.workout.count(),
    workoutExercises: await prisma.workoutExercise.count(),
    workoutSets: await prisma.workoutSet.count(),
    workoutSchedules: await prisma.workoutSchedule.count(),
    workoutSchedulesCompleted: await prisma.workoutSchedule.count({ where: { status: "COMPLETED" } }),
    workoutPrograms: await prisma.workoutProgram.count(),
    workoutProgramExercises: await prisma.workoutProgramExercise.count(),
    nutritionLogs: await prisma.nutritionLog.count(),
    nutritionPrograms: await prisma.nutritionProgram.count(),
    nutritionProgramMealItems: await prisma.nutritionProgramMealItem.count(),
    nutritionMealCompletions: await prisma.nutritionMealCompletion.count(),
    nutritionGoals: await prisma.nutritionGoal.count(),
    trainingCycles: await prisma.trainingCycle.count(),
    userEquipment: await prisma.userEquipment.count(),
    distinctUsersWithWorkoutSets: (
      await prisma.workoutExercise.findMany({
        distinct: ["workoutId"],
        select: { workoutId: true },
      })
    ).length,
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
