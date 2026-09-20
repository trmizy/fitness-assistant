import { randomUUID } from 'node:crypto';
Object.assign(process.env, { NODE_ENV: 'test', FITNESS_DISABLE_REDIS: 'true', DATABASE_URL: 'postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test?schema=public' });
async function main() {
  const { prisma } = await import('../../backend/services/fitness-service/src/repositories/prisma');
  const bootstrap = await import('../../backend/services/fitness-service/src/services/nutrition-onboarding-bootstrap.service');
  Object.assign(bootstrap.nutritionBootstrapDeps, {
    fetchUserProfile: async () => ({ goal: 'WEIGHT_LOSS', currentWeight: 113.6, startingWeight: 113.6, targetWeight: 80, experienceLevel: 'BEGINNER', competesInSport: false, injuries: [], age: 22, gender: 'MALE', heightCm: 178, activityLevel: 'SEDENTARY', hasCompletedOnboarding: true, nutritionBudgetLevel: 'LOW' }),
    fetchLatestInBodyOnOrBefore: async () => null,
    queueInitialNutritionPlanSafe: async () => ({ planId: 'p', jobId: 'j', status: 'QUEUED' }),
    createPersistentNotification: async () => {},
  });
  let failures = 0;
  try {
    for (let round = 0; round < 30; round++) {
      const userId = randomUUID();
      try {
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => bootstrap.bootstrapNutritionForUser(userId)));
        const errors = results.filter(r => r.status === 'rejected').map(r => ({ message: r.reason.message, code: r.reason.code, meta: r.reason.meta, stack: r.reason.stack }));
        failures += errors.length;
        console.log(JSON.stringify({ round, errors, activeCycles: await prisma.trainingCycle.count({ where: { userId, status: 'ACTIVE' } }), goals: await prisma.$queryRaw`SELECT id FROM nutrition_goals WHERE user_id = ${userId} AND status = 'ACTIVE'` }));
      } finally {
        await prisma.recommendationAudit.deleteMany({ where: { userId } });
        await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
        await prisma.trainingCycle.deleteMany({ where: { userId } });
      }
    }
  } finally { await prisma.$disconnect(); }
  console.log(JSON.stringify({ rounds: 30, calls: 300, failures }));
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
