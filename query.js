const { PrismaClient } = require('./backend/services/ai-service/src/generated/prisma');

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_ai?schema=public'
      }
    }
  });

  try {
    const p = await prisma.workoutPlan.findUnique({ where: { id: 'ba8605c8-c64a-4c22-9b37-53b34f065b7f' } });
    console.log('Found workoutPlan ba8605c8...:', p);

    // Also let's check how many total workout plans exist to ensure we are looking at the right DB
    const count = await prisma.workoutPlan.count();
    console.log('Total workoutPlans in DB:', count);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
