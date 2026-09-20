import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, conversationRepository } from '../../backend/services/ai-service/src/repositories/conversation.repository';
import axios from 'axios';
import { processNutritionPlanJob } from '../../backend/services/ai-service/src/services/nutrition.processor';
import { fitnessAgent, fitnessAgentDeps } from '../../backend/services/ai-service/src/services/fitness-agent.service';
import { conversationService } from '../../backend/services/ai-service/src/services/conversation.service';
import { llmService } from '../../backend/services/ai-service/src/services/llm.service';
import { extractNutritionConstraints } from '../../backend/services/ai-service/src/services/nutrition-food-constraints';

// Real workflow/action persistence; controlled external context, queue and imports.
// Assertions document observed defects, not desired product behavior.
const users: string[] = [];
const queues: any[] = [], imports: any[] = [];
async function session() {
  const userId = `codex-final-${randomUUID()}`;
  users.push(userId);
  return { identity: { userId } as any, row: await prisma.chatSession.create({ data: { userId, title: 'Isolated final recheck' } }) };
}
const emit = (id: string, result: unknown) => console.log(JSON.stringify({ id, result }));
async function main() {
  const health = await llmService.getHealthStatus(2000);
  emit('provider', { available: health.llmAvailable, provider: health.llmProvider, error: health.error });
  const profile = { goal: 'WEIGHT_LOSS', days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000 };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { ...profile, age: 28, heightCm: 170, currentWeightKg: 75, gender: 'FEMALE', activityLevel: 'MODERATE', experienceLevel: 'BEGINNER', training: { trainingDaysPerWeek: 3, availableEquipment: ['barbell', 'dumbbell', 'cable', 'rack'], injuries: ['knee pain'], preferredTrainingDays: [1, 3, 5] } } } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_i: any, name: string) => ({ id: `fixture-${name}`, exerciseName: name });
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: 'ACTIVE_GOAL', goalId: 'fixture-goal', calories: 1800, protein: 150, carbs: 160, fat: 55 } as any);
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, p: any) => { imports.push(p); return { message: 'saved fixture' } as any; };
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  conversationService.queueNutritionPlanGeneration = async (p: any) => { queues.push(p); return { planId: randomUUID(), jobId: randomUUID(), status: 'QUEUED' } as any; };
  const a = await session();
  const first = await fitnessAgent.tryTurn('Tạo thực đơn, tôi không ăn cá.', a.identity, a.row.id);
  const second = await fitnessAgent.tryTurn('À tôi cũng không ăn thịt bò.', a.identity, a.row.id);
  await fitnessAgent.tryTurn('4 bữa', a.identity, a.row.id);
  assert.equal(queues.length, 1);
  assert.deepEqual(queues[0].excludedFoodKeys, ['fish']);
  emit('M1-three-turn', { first: first?.blocks[0], second: second?.blocks[0], excludedFoodKeys: queues[0].excludedFoodKeys, mealsPerDay: queues[0].mealsPerDay });
  const b = await session();
  const preview = await fitnessAgent.tryTurn('Tạo lịch tập cho tôi', b.identity, b.row.id);
  const id = (preview!.blocks[0] as any).actionId;
  await fitnessAgent.dismissDraft(b.identity, id);
  const cancelled = await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id } });
  assert.equal(cancelled.status, 'CANCELLED');
  const result = await fitnessAgent.execute(b.identity, id, true);
  const executed = await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id } });
  assert.equal(imports.length, 1);
  assert.equal(executed.status, 'COMPLETED');
  emit('L1-cancelled-confirm', { before: cancelled.status, after: executed.status, importCalls: imports.length, result });
  const unknown = extractNutritionConstraints('Tôi không ăn cá và không ăn cay.');
  emit('M2-combined-unknown', unknown);
  const c = await session();
  const beforeQueue = queues.length;
  const unknownReply = await fitnessAgent.tryTurn('Tạo thực đơn 4 bữa, tôi không ăn cá và không ăn cay.', c.identity, c.row.id);
  assert.equal(queues.length, beforeQueue + 1);
  emit('M2-unknown-accepted', { answer: unknownReply?.answer, excludedFoodKeys: queues.at(-1).excludedFoodKeys, restrictions: queues.at(-1).restrictions });
  const d = await session();
  await fitnessAgent.tryTurn('Tạo thực đơn 4 bữa, tôi không ăn cá.', d.identity, d.row.id);
  const action = await prisma.fitnessAgentAction.findFirstOrThrow({ where: { userId: d.identity.userId } });
  const planId = (action.payload as any).planId;
  let content: any;
  axios.get = (async (url: string) => {
    if (!url.includes('for-ai-nutrition')) throw new Error('optional fixture context unavailable');
    return { data: { success: true, data: { foods: [
      { id: 'chicken', name: 'Chicken breast', calories: 165, protein: 31, carbs: 0, fat: 4 },
      { id: 'rice', name: 'Rice cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      { id: 'salmon', name: 'Salmon fish', calories: 208, protein: 20, carbs: 0, fat: 13 },
      { id: 'peanut', name: 'Peanut butter', calories: 588, protein: 25, carbs: 20, fat: 50 },
      { id: 'eggplant', name: 'Eggplant, cooked', calories: 35, protein: 0.8, carbs: 8.7, fat: 0.2 },
      { id: 'oats', name: 'Oats, dry', calories: 379, protein: 13, carbs: 67, fat: 6.5 },
    ] } } };
  }) as any;
  llmService.callLLM = (async () => ({ answer: JSON.stringify({ dailyCaloriesTarget: 200, meals: [{ mealType: 'BREAKFAST', title: 'Chicken', items: [{ foodId: 'chicken', quantity: 150 }] }] }) })) as any;
  conversationRepository.updateNutritionPlanStatus = (async () => ({})) as any;
  conversationRepository.updateNutritionPlanCompletion = (async (_id: string, value: any) => { content = value; return {}; }) as any;
  conversationRepository.updateNutritionPlanFailed = (async (_id: string, reason: string) => { throw new Error(reason); }) as any;
  await processNutritionPlanJob({ id: 'codex-final', data: { ...queues.at(-1), planId } } as any);
  assert.equal(content.dailyCaloriesTarget, 1800);
  assert.ok(!JSON.stringify(content.weeklySchedule).includes('Salmon'));
  conversationRepository.findNutritionPlanById = (async () => ({ id: planId, userId: d.identity.userId, name: 'Codex final', goal: 'WEIGHT_LOSS', durationWeeks: 1, mealsPerDay: 4, status: 'COMPLETED', plan: content })) as any;
  const np = await fitnessAgent.tryTurn('Thực đơn của tôi xong chưa?', d.identity, d.row.id);
  assert.equal(np?.blocks[0].type, 'NUTRITION_PLAN_PREVIEW');
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = (async (_i: any, payload: any) => {
    assert.deepEqual(payload.weeklySchedule, content.weeklySchedule);
    assert.equal(payload.dailyCaloriesTarget, 1800);
    emit('nutrition-save-payload', payload);
    return { message: 'captured authoritative import payload' };
  }) as any;
  await fitnessAgent.execute(d.identity, action.id, true);
  emit('processor-preview-confirm', { calories: content.dailyCaloriesTarget, fishItems: 0, sameSchedule: true });
}
main().finally(async () => {
  for (const userId of users) {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.deleteMany({ where: { userId } });
  }
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
