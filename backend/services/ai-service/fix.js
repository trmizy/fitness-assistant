process.env.DATABASE_URL = 'postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_ai';
const { PrismaClient } = require('./src/generated/prisma');

async function main() {
  const prisma = new PrismaClient();
  try {
    const plans = await prisma.workoutPlan.findMany({ select: { id: true, status: true, name: true, createdAt: true } });
    console.log('Workout plans in DB:', JSON.stringify(plans, null, 2));

    const res = await prisma.workoutPlan.updateMany({
      where: { status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'FAILED', failReason: 'System restarted during generation' }
    });
    console.log('Workout plans updated:', res);
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
