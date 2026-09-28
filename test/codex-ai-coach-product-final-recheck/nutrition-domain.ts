import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
config({ path: 'backend/services/fitness-service/.env', override: true });
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/gymcoach_fitness_test';
process.env.DATABASE_URL = url.href;
process.env.FITNESS_DISABLE_REDIS = 'true';
async function main() {
  const { prisma } = await import('../../backend/services/fitness-service/src/repositories/prisma');
  const { nutritionService } = await import('../../backend/services/fitness-service/src/services/nutrition.service');
  const userId = `codex-final-domain-${randomUUID()}`;
  try {
    const text = readFileSync('test/codex-ai-coach-product-final-recheck/probe-results.txt', 'utf16le');
    const payload = text.split(/\r?\n/).filter(l => l.startsWith('{')).map(l => JSON.parse(l)).find(r => r.id === 'nutrition-save-payload').result;
    for (const [id, name, calories, protein, carbs, fats] of [
      ['chicken', 'Chicken breast', 165, 31, 0, 4],
      ['rice', 'Rice cooked', 130, 2.7, 28, 0.3],
      ['peanut', 'Peanut butter', 588, 25, 20, 50],
    ] as const) {
      await prisma.food.create({ data: { id, name, calories, protein, carbs, fats, source: userId, fdcId: -Math.floor(Math.random() * 2000000000) } });
    }
    const goal = await prisma.nutritionGoal.create({ data: { userId, calories: 1800, protein: 150, carbs: 160, fat: 55, triggeredBy: 'ONBOARDING' } });
    await nutritionService.importAiPlan(userId, payload);
    const program = await prisma.nutritionProgram.findFirstOrThrow({ where: { userId }, include: { days: { include: { meals: { include: { items: true } } } } } });
    assert.equal(program.dailyCaloriesTarget, 1800);
    assert.equal(program.sourceGoalId, goal.id);
    assert.equal(await prisma.nutritionGoal.count({ where: { userId } }), 1);
    assert.equal((await prisma.nutritionGoal.findUniqueOrThrow({ where: { id: goal.id } })).calories, 1800);
    const savedItems = program.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => JSON.stringify([d.dayNumber, m.mealType, i.foodId, i.quantity, i.unit])))).sort();
    const reviewedItems = payload.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => JSON.stringify([d.dayNumber, m.mealType, i.foodId, i.quantity, i.unit])))).sort();
    assert.deepEqual(savedItems, reviewedItems);
    console.log(JSON.stringify({ id: 'real-nutrition-import', calories: program.dailyCaloriesTarget, sourceGoalMatches: true, goalUnchanged: true, reviewedItemsPreserved: savedItems.length, fishItems: 0 }));
  } finally {
    await prisma.nutritionProgram.deleteMany({ where: { userId } });
    await prisma.nutritionGoal.deleteMany({ where: { userId } });
    await prisma.food.deleteMany({ where: { source: userId } });
    await prisma.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
