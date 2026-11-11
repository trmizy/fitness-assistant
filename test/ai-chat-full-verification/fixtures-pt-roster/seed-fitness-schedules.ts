// TEST FIXTURE: workout schedule rows for the roster probe in the ISOLATED fitness test DB. Args: <userId>:<status,status,...> ...
import { prisma } from "C:/D_Backup/project_personal/fitness-assistant/backend/services/fitness-service/src/repositories/prisma";
if (!/localhost:55433\/[a-z_]*_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: not the isolated test DB");
(async () => {
for (const spec of process.argv.slice(2)) {
  const [userId, list] = spec.split(":");
  let i = 1;
  for (const status of list.split(",")) {
    const date = new Date(Date.now() - i++ * 86_400_000); date.setUTCHours(6, 0, 0, 0);
    await prisma.workoutSchedule.create({ data: { userId, date, status, ...(status === "COMPLETED" ? { completedAt: date } : {}) } });
  }
}
console.log("schedules seeded");
await prisma.$disconnect();
})();
