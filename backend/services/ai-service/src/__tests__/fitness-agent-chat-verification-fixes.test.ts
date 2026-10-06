/**
 * Regressions for three product defects found by the full conversational verification
 * (docs/ai-chat-multi-agent-full-verification.md), each reproduced first through the REAL stack (gateway + configured model):
 *   1. "Thứ 4 tôi bận." (unavailability) shrank a 4-day workout draft into ONE Wednesday session.
 *   2. "Tôi không có máy cable." (an explicit exclusion that matches nothing in the draft) fell to the generic LLM, which
 *      claimed "mình sẽ thay thế các bài tập" while the draft was unchanged.
 *   3. "Ổn rồi, lưu đi." / "Lưu đi" fell to the generic LLM, which answered "Lưu thành công!" although nothing was saved.
 * Real DB (ai test DB), real fitnessAgent.tryTurn; only the profile snapshot is stubbed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const originalExtract = fitnessAgentDeps.profileExtractor.extract;
test.afterEach(() => { fitnessAgentDeps.profileExtractor.extract = originalExtract; });
test.after(async () => { await prisma.$disconnect(); });

const identity = (userId: string) => ({ userId, authorizationHeader: "Bearer test" }) as any;
const ex = (name: string) => ({ exerciseId: randomUUID(), name, sets: 3, reps: 10, restSeconds: 60 });
const schedule = () => [
  { day: "Thứ 2 Ngực", goal: "Ngực", exercises: [ex("Barbell Bench Press"), ex("Push-Up")] },
  { day: "Thứ 3 Lưng", goal: "Lưng", exercises: [ex("Dumbbell Row"), ex("Lat Pulldown Wide")] },
  { day: "Thứ 5 Chân", goal: "Chân", exercises: [ex("Barbell Squat"), ex("Lunge")] },
  { day: "Thứ 6 Vai", goal: "Vai", exercises: [ex("Dumbbell Shoulder Press"), ex("Lateral Raise")] },
];

async function setup() {
  const userId = `verif-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "chat verification fixes" } });
  fitnessAgentDeps.profileExtractor.extract = (async () => ({
    profile: { userId, goal: "MUSCLE_GAIN", age: 30, gender: "MALE", heightCm: 175, currentWeightKg: 78, training: { trainingDaysPerWeek: 4, availableEquipment: [], injuries: [], preferredTrainingDays: [] } },
    inBodyHistory: [], workoutHistory: [], nutritionHistory: [],
  })) as any;
  const payload = { goal: "MUSCLE_GAIN", sessionMinutes: 60, weeklySchedule: schedule(), selectedWeekdays: [1, 2, 4, 5], exclusions: [] as string[] };
  const action = await prisma.fitnessAgentAction.create({
    data: { userId, sessionId: session.id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: payload as any, status: "PENDING", expiresAt: new Date(Date.now() + 15 * 60000) },
  });
  return { userId, sessionId: session.id, actionId: action.id };
}
const reload = (id: string) => prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id } });

test("unavailability: 'Thứ 4 tôi bận.' keeps 4 sessions and moves them OFF Wednesday (no longer a 1-day Wednesday plan)", async () => {
  const { userId, sessionId, actionId } = await setup();
  // The draft here trains Mon/Tue/Thu/Fri -> Wednesday is not even used; the fix must not collapse the plan.
  const before = await reload(actionId);
  const r = await fitnessAgent.tryTurn("Thứ 4 tôi bận.", identity(userId), sessionId);
  assert.ok(r, "handled as a draft revision, not generic chat");
  const after = await reload(actionId);
  const p = after.payload as any;
  assert.equal(p.weeklySchedule.length, 4, "still 4 sessions/week");
  assert.ok(!p.selectedWeekdays.includes(3), "Wednesday (3) must not be a training day");
  assert.equal(p.selectedWeekdays.length, 4);
  assert.equal(after.status, "PENDING", "a revision never writes");
  assert.notEqual(JSON.stringify((before.payload as any).weeklySchedule.length), "1");
});

test("unavailability on a USED day moves that session to another free weekday (same count)", async () => {
  const { userId, sessionId, actionId } = await setup();
  await fitnessAgent.tryTurn("Thứ 2 tôi bận.", identity(userId), sessionId);
  const p = (await reload(actionId)).payload as any;
  assert.equal(p.weeklySchedule.length, 4);
  assert.ok(!p.selectedWeekdays.includes(1), "Monday (1) removed");
  assert.equal(new Set(p.selectedWeekdays).size, 4);
});

test("selection wording is unchanged: 'Tôi tập được thứ 3, 5, 7' still SELECTS those days", async () => {
  const { userId, sessionId, actionId } = await setup();
  // regenerate() needs the exercise catalog over HTTP; only assert routing here (returns a draft revision, not chat).
  const orig = fitnessAgentDeps.tools.getExerciseSubstitute;
  try {
    const r = await fitnessAgent.tryTurn("Tôi tập được thứ 3, 5, 7", identity(userId), sessionId).catch(() => "threw");
    assert.ok(r !== null, "recognised as a weekday revision");
  } finally { fitnessAgentDeps.tools.getExerciseSubstitute = orig; }
  void actionId;
});

test("explicit exclusion that matches nothing: truthful answer, draft unchanged, exclusion remembered (no generic-LLM claim)", async () => {
  const { userId, sessionId, actionId } = await setup();
  const before = (await reload(actionId)).payload as any;
  const r = await fitnessAgent.tryTurn("Tôi không có máy cable.", identity(userId), sessionId);
  assert.ok(r, "must be handled here, not fall through to the LLM chat");
  assert.match(r!.answer, /không có bài nào liên quan/i);
  const after = (await reload(actionId)).payload as any;
  assert.deepEqual(after.weeklySchedule, before.weeklySchedule, "no exercise changed");
  assert.ok(after.exclusions.includes("cable"), "exclusion remembered for later regenerations");
});

test("pending draft + unrelated Q&A still falls through to normal chat (not hijacked by the exclusion handler)", async () => {
  const { userId, sessionId } = await setup();
  for (const q of ["Romanian deadlift tập cơ gì?", "Progressive overload là gì?", "Lưu ý khi tập squat là gì?"]) {
    assert.equal(await fitnessAgent.tryTurn(q, identity(userId), sessionId), null, q);
  }
});

test("'lưu đi' with a pending draft: deterministic 'nothing saved' answer (no LLM 'Lưu thành công!'), draft stays PENDING", async () => {
  const { userId, sessionId, actionId } = await setup();
  for (const q of ["Ổn rồi, lưu đi.", "Lưu đi", "xác nhận", "chốt luôn"]) {
    const r = await fitnessAgent.tryTurn(q, identity(userId), sessionId);
    assert.ok(r, q);
    assert.match(r!.answer, /chưa lưu gì cả/i, q);
    assert.doesNotMatch(r!.answer, /thành công/i, q);
  }
  assert.equal((await reload(actionId)).status, "PENDING");
});

test("'lưu đi' with NOTHING pending: honest 'nothing to save' answer", async () => {
  const userId = `verif-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "no pending" } });
  const r = await fitnessAgent.tryTurn("Lưu đi", identity(userId), session.id);
  assert.ok(r);
  assert.match(r!.answer, /chưa có bản nháp/i);
});

// ---- "Vì sao PT thứ nhất phù hợp?" is a question about the shown recommendation, not a new PT search (found live: it restarted FIND_PT)
async function seedRecommendation(userId: string, sessionId: string) {
  const candidates = [
    { id: randomUUID(), name: "PT Một", why: ["Chuyên môn của PT này khớp với mục tiêu bạn đã chọn.", "Có lịch trống phù hợp."], compatibility: { total: 82 } },
    { id: randomUUID(), name: "PT Hai", why: ["Mức giá nằm trong ngân sách."], compatibility: { total: 71 } },
  ];
  await prisma.fitnessRecommendation.create({ data: {
    userId, sessionId, type: "PT", contextSnapshot: {}, candidateIds: candidates.map((c) => c.id), scoringVersion: "t", similarityVersion: "t",
    evidenceIds: [], historicalJourneyIds: [], result: { type: "PT_RECOMMENDATIONS", candidates } as any,
  } });
  return candidates;
}

test("'Vì sao PT thứ nhất phù hợp?' is answered from the stored recommendation (why + score), not by restarting the PT search", async () => {
  const userId = `verif-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "why pt" } });
  await seedRecommendation(userId, session.id);
  const r1 = await fitnessAgent.tryTurn("Vì sao PT thứ nhất phù hợp?", identity(userId), session.id);
  assert.ok(r1);
  assert.match(r1!.answer, /PT Một/);
  assert.match(r1!.answer, /khớp với mục tiêu/);
  assert.match(r1!.answer, /82\/100/);
  assert.match(r1!.answer, /không phải cam kết/);
  assert.deepEqual(r1!.blocks, [], "no new workflow / no missing-data question");
  const r2 = await fitnessAgent.tryTurn("Tại sao PT thứ 2 lại được gợi ý?", identity(userId), session.id);
  assert.match(r2!.answer, /PT Hai/);
});

test("'why' question WITHOUT a stored recommendation is not intercepted (falls to the normal PT routing)", async () => {
  const userId = `verif-${randomUUID()}`;
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { userId, training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
  const session = await prisma.chatSession.create({ data: { userId, title: "why pt none" } });
  const orig = fitnessAgentDeps.tools.getUserFitnessContext;
  fitnessAgentDeps.tools.getUserFitnessContext = (async () => ({ profile: { goal: null, experience: null, days: [], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [] }, coach: {} })) as any;
  try {
    const r = await fitnessAgent.tryTurn("Vì sao PT thứ nhất phù hợp?", identity(userId), session.id);
    assert.ok(!r || !/được gợi ý vì/.test(r.answer));
  } finally { fitnessAgentDeps.tools.getUserFitnessContext = orig; }
});
