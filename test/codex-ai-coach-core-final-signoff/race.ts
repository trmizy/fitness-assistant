import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, conversationRepository } from '../../backend/services/ai-service/src/repositories/conversation.repository';
import { fitnessAgent, fitnessAgentDeps } from '../../backend/services/ai-service/src/services/fitness-agent.service';
import { conversationService } from '../../backend/services/ai-service/src/services/conversation.service';
import { llmService } from '../../backend/services/ai-service/src/services/llm.service';

const users: string[] = [];
const plans = new Map<string, any>();
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function run(kind: 'workout' | 'nutrition') {
  const userId = `codex-signoff-race-${randomUUID()}`;
  users.push(userId);
  const identity = { userId } as any;
  const session = await prisma.chatSession.create({ data: { userId, title: 'Isolated confirm-dismiss race' } });
  let preview = await fitnessAgent.tryTurn(kind === 'workout' ? 'Tạo lịch tập cho tôi' : 'Tạo thực đơn 4 bữa', identity, session.id);
  if (kind === 'nutrition') preview = await fitnessAgent.tryTurn('Thực đơn của tôi xong chưa?', identity, session.id);
  const id = (preview!.blocks[0] as any).actionId;
  assert.ok(id);
  const entered = deferred(), release = deferred();
  let writes = 0;
  // Delay only the external success response. No production guard or DB operation is mocked.
  const delayedImport = async () => { entered.resolve(); await release.promise; writes++; return { message: 'fixture import succeeded' } as any; };
  if (kind === 'workout') fitnessAgentDeps.tools.importAiPlanToSchedule = delayedImport;
  else fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = delayedImport;
  const results = await Promise.all([
    fitnessAgent.execute(identity, id, true),
    (async () => {
      await entered.promise;
      try { return await fitnessAgent.dismissDraft(identity, id); }
      finally { release.resolve(); }
    })(),
  ]);
  const action = await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id } });
  assert.equal(writes, 1);
  assert.equal(action.status, 'COMPLETED');
  assert.match(String((results[1] as any).message), /chưa lưu gì/);
  console.log(JSON.stringify({ kind, writes, finalStatus: action.status, confirm: results[0], dismiss: results[1], contradictorySuccessfulReplies: true }));
}
async function main() {
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: 'WEIGHT_LOSS', days: [1,3,5], sessionMinutes: 60 }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: 'WEIGHT_LOSS', experienceLevel: 'BEGINNER', training: { trainingDaysPerWeek: 3, availableEquipment: ['barbell','dumbbell','cable','rack'], injuries: [], preferredTrainingDays: [1,3,5] } } } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_i: any, name: string) => ({ id: `fixture-${name}`, exerciseName: name });
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: 'ACTIVE_GOAL', goalId: 'fixture-goal', calories: 1800, protein: 150, carbs: 160, fat: 55 } as any);
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  conversationService.queueNutritionPlanGeneration = async (params: any) => {
    const id = randomUUID();
    plans.set(id, { id, userId: params.userId, name: 'Fixture', goal: 'WEIGHT_LOSS', durationWeeks: 1, mealsPerDay: 4, status: 'COMPLETED', plan: {
      goal: 'WEIGHT_LOSS', mealsPerDay: 4, dailyCaloriesTarget: 1800, proteinTargetGrams: 150, carbTargetGrams: 160, fatTargetGrams: 55,
      weeklySchedule: [{ dayNumber: 1, title: 'Fixture', meals: [{ mealType: 'BREAKFAST', title: 'Fixture', items: [{ name: 'Chicken breast', quantity: 100, unit: 'g' }] }] }],
    } });
    return { planId: id, jobId: id, status: 'QUEUED' } as any;
  };
  conversationRepository.findNutritionPlanById = (async (id: string) => plans.get(id)) as any;
  await run('workout');
  await run('nutrition');
}
main().finally(async () => {
  for (const userId of users) {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.deleteMany({ where: { userId } });
  }
  await prisma.$disconnect();
}).catch(e => { console.error(e); process.exitCode = 1; });
