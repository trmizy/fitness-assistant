const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const schedules = await prisma.workoutSchedule.findMany({
    orderBy: { date: 'asc' },
    include: { programDay: true }
  });
  console.log('=== SCHEDULES ===');
  schedules.forEach(s => {
    console.log(`${s.date.toISOString()} | progDay: ${s.programDayId ? s.programDay.dayNumber : 'null'} | workout: ${s.workoutId}`);
  });
}
main().finally(() => prisma.$disconnect());
