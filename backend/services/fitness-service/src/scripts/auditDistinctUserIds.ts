/**
 * Throwaway read-only audit script (Gate 1/2) — how many DISTINCT userIds
 * actually own the large workout/nutrition-log row counts, to tell real
 * usage concentration apart from raw row counts (which are inflated by
 * E2E test churn, per the auth-service user-count audit).
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/auditDistinctUserIds.ts
 */
import { prisma } from "../repositories/prisma";

async function main() {
  const distinctWorkoutUsers = await prisma.workout.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  const distinctNutritionLogUsers = await prisma.nutritionLog.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  const distinctScheduleUsers = await prisma.workoutSchedule.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });

  // Top 10 userIds by workout count — concentration check.
  const topWorkoutUsers = await prisma.workout.groupBy({
    by: ["userId"],
    _count: { _all: true },
    orderBy: { _count: { userId: "desc" } },
    take: 10,
  });
  const topNutritionLogUsers = await prisma.nutritionLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    orderBy: { _count: { userId: "desc" } },
    take: 10,
  });

  console.log(
    JSON.stringify(
      {
        distinctWorkoutUserCount: distinctWorkoutUsers.length,
        distinctNutritionLogUserCount: distinctNutritionLogUsers.length,
        distinctScheduleUserCount: distinctScheduleUsers.length,
        topWorkoutUsers,
        topNutritionLogUsers,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
