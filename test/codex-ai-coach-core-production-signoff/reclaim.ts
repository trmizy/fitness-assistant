import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, conversationRepository } from '../../backend/services/ai-service/src/repositories/conversation.repository';
import { fitnessAgent, fitnessAgentDeps } from '../../backend/services/ai-service/src/services/fitness-agent.service';

const userId = `codex-reclaim-${randomUUID()}`;
const identity = { userId } as any;
async function main() {
  const session = await prisma.chatSession.create({ data: { userId, title: 'Isolated reclaim verification' } });
  const target = { source: 'ACTIVE_GOAL', goalId: 'fixture', calories: 1800, protein: 150, carbs: 160, fat: 55 };
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ ...target, status: 'ACTIVE_GOAL' } as any);
  for (const kind of ['CREATE_WORKOUT_PLAN', 'CREATE_NUTRITION_PLAN']) {
    const planId = randomUUID();
    const content = { weeklySchedule: [], dailyCaloriesTarget: 1800, proteinTargetGrams: 150, carbTargetGrams: 160, fatTargetGrams: 55 };
    conversationRepository.findNutritionPlanById = (async () => ({ id: planId, userId, status: 'COMPLETED', plan: content, durationWeeks: 1, mealsPerDay: 4 })) as any;
    const action = await prisma.fitnessAgentAction.create({ data: {
      userId, sessionId: session.id, kind, risk: 'HIGH', status: 'EXECUTING',
      expiresAt: new Date(Date.now() + 600000), result: { executingSince: new Date().toISOString() },
      payload: kind === 'CREATE_WORKOUT_PLAN' ? { weeklySchedule: [], selectedWeekdays: [] } : { phase: 'PREVIEW', planId, target, constraints: { exclusions: [], unsupported: [], hints: [] } },
    } });
    let calls = 0;
    const sourceIds: string[] = [];
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(r => { entered = r; });
    const barrier = new Promise<void>(r => { release = r; });
    const business = async (_i: any, payload: any) => { calls++; sourceIds.push(payload.sourcePlanId); entered(); await barrier; return { message: 'saved fixture' } as any; };
    if (kind === 'CREATE_WORKOUT_PLAN') fitnessAgentDeps.tools.importAiPlanToSchedule = business;
    else fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = business;
    await assert.rejects(() => fitnessAgent.execute(identity, action.id, true), /already being executed/);
    assert.equal(calls, 0);
    const stranger = { userId: `stranger-${randomUUID()}` } as any;
    await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { result: { executingSince: new Date(Date.now() - 180000).toISOString() } } });
    await assert.rejects(() => fitnessAgent.execute(stranger, action.id, true), /not found/i);
    await assert.rejects(() => fitnessAgent.dismissDraft(stranger, action.id), /not found/i);
    const requests = [fitnessAgent.execute(identity, action.id, true), fitnessAgent.execute(identity, action.id, true)];
    const settled = Promise.allSettled(requests);
    await inside;
    // Keep the winning external call in flight until the competing request has lost.
    const firstSettled = await Promise.race(requests.map(p => p.then(() => 'success', () => 'rejected')));
    assert.equal(firstSettled, 'rejected');
    assert.equal(calls, 1);
    assert.match(String((await fitnessAgent.dismissDraft(identity, action.id) as any).message), /đang được lưu/);
    release();
    const results = await settled;
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: action.id } })).status, 'COMPLETED');
    await fitnessAgent.execute(identity, action.id, true);
    assert.equal(calls, 1);
    assert.deepEqual(sourceIds, [kind === 'CREATE_WORKOUT_PLAN' ? action.id : planId]);
    console.log(JSON.stringify({ kind, freshRejected: true, staleReclaimers: 2, businessCalls: calls, sourceIdentityStable: true, foreignReclaimRejected: true, final: 'COMPLETED' }));
  }
}
main().finally(async () => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.chatSession.deleteMany({ where: { userId } });
  await prisma.$disconnect();
}).catch(e => { console.error(e); process.exitCode = 1; });
