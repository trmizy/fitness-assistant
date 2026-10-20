/**
 * Phase 2 (AI plan): "move a session", "replace a session's focus" and body-part/pain statements against a pending WORKOUT draft.
 * Reproduced first through the REAL stack (REAL HTTP/API probe, test/ai-chat-full-verification/probe-workout-revisions.mjs):
 *   "Đổi buổi thứ 6 sang thứ 7"      -> "đổi lịch tập sang 2 buổi/tuần vào: Thứ 6, Thứ 7" (4 sessions destroyed)
 *   "Thay buổi thứ 7 thành tập chân"  -> "sang 1 buổi/tuần vào: Thứ 7"                       (4 sessions destroyed)
 *   "Tôi bị đau chân, bỏ bài tập chân" -> 'không có bài nào liên quan đến "bi dau chan chan"' (false reassurance)
 * Part 1 is pure (parser phrasing coverage). Part 2 uses the ai test DB + real fitnessAgent.tryTurn like
 * fitness-agent-chat-verification-fixes.test.ts (only the profile snapshot is stubbed).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { normalizeAgentText } from "../services/fitness-agent-intent";
import { parseWorkoutSessionRequest, detectBodyPartConstraint } from "../services/revision/workout-draft-intents";

const parse = (t: string) => parseWorkoutSessionRequest(normalizeAgentText(t));
const MOVE = (from: number, to: number) => ({ kind: "MOVE_SESSION", from, to });

// ── Part 1: phrasing coverage (weekday numbering: 0=Sun, 1=Mon … 6=Sat) ────────────────────────────────────
test("MOVE_SESSION: many independent phrasings of 'move the Friday session to Saturday'", () => {
  for (const t of [
    "Đổi buổi thứ 6 sang thứ 7",
    "Chuyển buổi thứ 6 qua thứ 7 giúp mình",
    "doi buoi thu 6 sang thu 7",
    "Dời buổi tập thứ 6 sang thứ 7 nhé",
    "dịch buổi thứ 6 sang thứ 7",
    "Đổi lịch thứ 6 thành thứ 7",
    "đổi ngày tập thứ 6 sang ngày thứ 7",
    "Thay buổi thứ 6 bằng thứ 7",
    "chuyen thu 6 sang thu 7 duoc khong",
    "Đổi T6 sang T7",
    "Đổi buổi thứ 6 -> thứ 7",
  ]) {
    const r = parse(t);
    assert.deepEqual(r, MOVE(5, 6), `"${t}" -> ${JSON.stringify(r)}`);
  }
});

test("MOVE_SESSION: Sunday as source or destination, and Monday..Saturday numbering", () => {
  assert.deepEqual(parse("Đổi buổi chủ nhật sang thứ 2"), MOVE(0, 1));
  assert.deepEqual(parse("Chuyển buổi thứ 2 sang chủ nhật"), MOVE(1, 0));
  assert.deepEqual(parse("đổi buổi CN sang thứ 3"), MOVE(0, 2));
  assert.deepEqual(parse("doi buoi thu 2 sang thu 5"), MOVE(1, 4));
});

test("REPLACE_SESSION_FOCUS: 'make Saturday something else' is recognised as such (never as a weekday selection)", () => {
  for (const t of ["Thay buổi thứ 7 thành tập chân", "đổi buổi thứ 7 sang tập ngực", "doi buoi thu 7 thanh buoi tap lung"]) {
    const r = parse(t);
    assert.equal(r?.kind, "REPLACE_SESSION_FOCUS", t);
    assert.equal((r as any).from, 6);
    assert.ok((r as any).focus.length > 0);
  }
});

test("NOT a session request: selection, unavailability, counts, durations, questions and other revisions stay untouched", () => {
  for (const t of [
    "Tôi tập được thứ 3, 5, 7",
    "Thứ 4 tôi bận.",
    "Tôi không tập được thứ 6",
    "Đổi sang 3 buổi mỗi tuần",
    "Giảm xuống 4 buổi",
    "Đổi thứ 6 sang 45 phút",
    "Buổi thứ 7 tăng lên 8 bài tập",
    "Đổi squat",
    "Thứ 6 tập gì vậy?",
    "Protein giúp gì cho cơ bắp?",
    "Tạo lịch tập 4 buổi mỗi tuần",
  ]) assert.equal(parse(t), null, t);
});

test("body part / pain cue: recognised for pain statements and body-part removals, ignored for questions and plain exercise names", () => {
  const cue = (t: string) => detectBodyPartConstraint(t, normalizeAgentText(t));
  for (const [t, part] of [
    ["Tôi bị đau chân, bỏ bài tập chân", "chân"],
    ["Tôi bị đau gối", "gối"],
    ["bỏ bài tập chân đi", "chân"],
    ["Đừng tập lưng", "lưng"],
    ["tôi đang chấn thương vai", "vai"],
    ["không tập chân nữa", "chân"],
    ["toi bi dau lung", "lưng"],
  ] as const) assert.equal(cue(t)?.part, part, t);
  for (const t of ["Chân đau có nên tập không?", "Đổi squat", "bỏ deadlift", "Tôi không có máy cable", "Tạo lịch tập cho tôi", "Thứ 4 tôi bận"]) assert.equal(cue(t), null, t);
  assert.equal(cue("Tôi bị đau chân, bỏ bài tập chân")?.pain, true);
  assert.equal(cue("bỏ bài tập chân đi")?.pain, false);
});

// ── Part 2: through the real agent turn (ai test DB) ───────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

type HarnessOpts = { mixed?: boolean; muscleDataDown?: boolean };
async function harness(opts: HarnessOpts = {}) {
  const { prisma } = await import("../repositories/conversation.repository");
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const ex = (name: string) => ({ exerciseId: randomUUID(), name, sets: 3, reps: 10, restSeconds: 60 });
  const schedule = () => opts.mixed ? [
    { day: "Thứ 2 Toàn thân A", goal: "Full", exercises: [ex("Barbell Squat"), ex("Barbell Bench Press"), ex("Dumbbell Row")] },
    { day: "Thứ 4 Toàn thân B", goal: "Full", exercises: [ex("Lunge"), ex("Dumbbell Shoulder Press"), ex("Lat Pulldown Wide")] },
    { day: "Thứ 6 Toàn thân C", goal: "Full", exercises: [ex("Push-Up"), ex("Lateral Raise"), ex("Barbell Squat")] },
    { day: "Chủ nhật Vai", goal: "Vai", exercises: [ex("Dumbbell Shoulder Press"), ex("Lateral Raise")] },
  ] : [
    { day: "Thứ 2 Ngực", goal: "Ngực", exercises: [ex("Barbell Bench Press"), ex("Push-Up")] },
    { day: "Thứ 4 Lưng", goal: "Lưng", exercises: [ex("Dumbbell Row"), ex("Lat Pulldown Wide")] },
    { day: "Thứ 6 Chân", goal: "Chân", exercises: [ex("Barbell Squat"), ex("Lunge")] },
    { day: "Chủ nhật Vai", goal: "Vai", exercises: [ex("Dumbbell Shoulder Press"), ex("Lateral Raise")] },
  ];
  // Catalog muscle data in the shape fitness-service returns it (the real endpoint is covered by its own integration test).
  const CATALOG: Record<string, { bodyPart: string; muscleGroups: string[] }> = {
    "Barbell Squat": { bodyPart: "LOWER_BODY", muscleGroups: ["quadriceps", "calves", "glutes", "hamstrings", "lower back"] },
    "Lunge": { bodyPart: "LOWER_BODY", muscleGroups: ["quadriceps", "glutes", "hamstrings"] },
    "Barbell Bench Press": { bodyPart: "UPPER_BODY", muscleGroups: ["chest", "triceps", "shoulders"] },
    "Push-Up": { bodyPart: "UPPER_BODY", muscleGroups: ["chest"] },
    "Dumbbell Row": { bodyPart: "UPPER_BODY", muscleGroups: ["lats", "middle back", "biceps"] },
    "Lat Pulldown Wide": { bodyPart: "UPPER_BODY", muscleGroups: ["lats", "biceps"] },
    "Dumbbell Shoulder Press": { bodyPart: "UPPER_BODY", muscleGroups: ["shoulders", "triceps"] },
    "Lateral Raise": { bodyPart: "UPPER_BODY", muscleGroups: ["shoulders"] },
  };
  const original = fitnessAgentDeps.profileExtractor.extract;
  const userId = `sess-req-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "session requests" } });
  fitnessAgentDeps.profileExtractor.extract = (async () => ({
    profile: { userId, goal: "MUSCLE_GAIN", age: 30, gender: "MALE", heightCm: 175, currentWeightKg: 78, training: { trainingDaysPerWeek: 4, availableEquipment: [], injuries: [], preferredTrainingDays: [] } },
    inBodyHistory: [], workoutHistory: [], nutritionHistory: [],
  })) as any;
  const payload = { goal: "MUSCLE_GAIN", sessionMinutes: 60, weeklySchedule: schedule(), selectedWeekdays: [1, 3, 5, 0], exclusions: ["cable"] as string[] };
  const nameById = new Map<string, string>(payload.weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => [e.exerciseId, e.name] as [string, string])));
  const originalProfiles = fitnessAgentDeps.tools.getExerciseMuscleProfiles;
  fitnessAgentDeps.tools.getExerciseMuscleProfiles = (async (_i: any, ids: string[]) => {
    if (opts.muscleDataDown) throw new Error("fitness-service unavailable");
    return ids.filter((id) => nameById.has(id)).map((id) => ({ id, name: nameById.get(id), ...CATALOG[nameById.get(id)!] }));
  }) as any;
  const action = await prisma.fitnessAgentAction.create({
    data: { userId, sessionId: session.id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: payload as any, status: "PENDING", expiresAt: new Date(Date.now() + 15 * 60000) },
  });
  const turn = (text: string) => fitnessAgent.tryTurn(text, { userId, authorizationHeader: "Bearer test" } as any, session.id);
  const draft = async () => (await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: action.id } }));
  const restore = () => { fitnessAgentDeps.profileExtractor.extract = original; fitnessAgentDeps.tools.getExerciseMuscleProfiles = originalProfiles; };
  return { prisma, turn, draft, restore, original: payload };
}
const names = (p: any) => p.weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.name));

test("TURN: 'Đổi buổi thứ 6 sang thứ 7' moves ONLY that session; 4 sessions, same exercises, exclusions kept, still PENDING", dbOpts, async () => {
  const h = await harness();
  try {
    const r = await h.turn("Đổi buổi thứ 6 sang thứ 7");
    assert.ok(r, "handled as a draft revision");
    const after = await h.draft();
    const p = after.payload as any;
    assert.equal(p.weeklySchedule.length, 4, "session count preserved");
    assert.deepEqual(p.selectedWeekdays, [1, 3, 6, 0], "Mon, Wed, Sat, Sun");
    assert.deepEqual(p.weeklySchedule.map((d: any) => String(d.day).split(" ").slice(0, 2).join(" ")), ["Thứ 2", "Thứ 4", "Thứ 7", "Chủ nhật"]);
    assert.deepEqual(names(p), names(h.original), "no exercise added, removed or reordered");
    assert.equal(p.weeklySchedule[2].goal, "Chân", "the moved session is the Friday (legs) session");
    assert.deepEqual(p.exclusions, ["cable"], "earlier constraints survive the move");
    assert.equal(after.status, "PENDING", "a revision never writes");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("TURN: move to a day that wraps order (Friday -> Tuesday) re-sorts chronologically without losing any session", dbOpts, async () => {
  const h = await harness();
  try {
    await h.turn("Chuyển buổi thứ 6 sang thứ 3");
    const p = (await h.draft()).payload as any;
    assert.deepEqual(p.selectedWeekdays, [1, 2, 3, 0], "Mon, Tue, Wed, Sun");
    assert.equal(p.weeklySchedule[1].goal, "Chân", "Friday's legs session now sits on Tuesday");
    assert.equal(p.weeklySchedule.length, 4);
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("TURN: unsafe/ambiguous moves change nothing and say why (source missing, destination taken, same day)", dbOpts, async () => {
  const h = await harness();
  try {
    const before = JSON.stringify((await h.draft()).payload);
    for (const [msg, re] of [
      ["Đổi buổi thứ 3 sang thứ 7", /chưa thấy buổi Thứ 3/],
      ["Đổi buổi thứ 6 sang thứ 4", /đã có buổi vào Thứ 4/],
      ["Đổi buổi thứ 6 sang thứ 6", /vốn đã ở ngày đó/],
    ] as const) {
      const r: any = await h.turn(msg);
      assert.match(r.answer, re, msg);
      assert.equal(JSON.stringify((await h.draft()).payload), before, `${msg}: draft untouched`);
    }
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("TURN: 'Thay buổi thứ 7 thành tập chân' does NOT collapse the plan; the draft is kept and the limitation is stated", dbOpts, async () => {
  const h = await harness();
  try {
    const before = JSON.stringify((await h.draft()).payload);
    const r: any = await h.turn("Thay buổi chủ nhật thành tập chân");
    assert.match(r.answer, /chưa đổi được nội dung của riêng buổi/);
    assert.equal(JSON.stringify((await h.draft()).payload), before);
    assert.equal(((await h.draft()).payload as any).weeklySchedule.length, 4);
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART (all-leg Friday): 'Tôi bị đau chân, bỏ bài tập chân' asks first — nothing changes, no fake exercise name, the question is stored", dbOpts, async () => {
  const h = await harness();
  try {
    const before = (await h.draft()).payload as any;
    const r: any = await h.turn("Tôi bị đau chân, bỏ bài tập chân");
    assert.ok(r);
    assert.doesNotMatch(r.answer, /không có bài nào liên quan|bi dau chan/i);
    assert.match(r.answer, /2 bài tác động lên chân/);
    assert.match(r.answer, /chỉ gồm bài chân/);
    assert.match(r.answer, /Mình chưa thay đổi gì/);
    const after = (await h.draft()).payload as any;
    assert.deepEqual(after.weeklySchedule, before.weeklySchedule, "exercises untouched until the user agrees");
    assert.equal(after.pendingBodyPartDecision?.key, "LEGS");
    assert.equal(after.pendingBodyPartDecision?.reason, "PAIN");
    assert.equal(r.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART lifecycle: ask -> 'đồng ý' removes ONLY leg exercises and the all-leg session; the constraint survives a later move; 'hết đau chân' lifts it", dbOpts, async () => {
  const h = await harness();
  try {
    await h.turn("Tôi bị đau chân, bỏ bài tập chân");
    const r: any = await h.turn("đồng ý");
    assert.match(r.answer, /bỏ 2 bài có tác động tới chân/);
    assert.match(r.answer, /lịch còn 3 buổi\/tuần/);
    let p = (await h.draft()).payload as any;
    assert.equal(p.weeklySchedule.length, 3);
    assert.deepEqual(p.selectedWeekdays, [1, 3, 0], "weekdays stay aligned with the surviving sessions");
    assert.ok(!names(p).some((n: string) => /Squat|Lunge/.test(n)), "no leg exercise left");
    assert.equal(names(p).length, 6, "every non-leg exercise kept");
    assert.deepEqual(p.bodyPartExclusions.map((b: any) => [b.key, b.reason]), [["LEGS", "PAIN"]]);
    assert.equal(p.pendingBodyPartDecision, undefined, "question closed");
    assert.deepEqual(p.exclusions, ["cable"], "earlier named exclusions untouched");

    await h.turn("Đổi buổi thứ 4 sang thứ 5");
    p = (await h.draft()).payload as any;
    assert.equal(p.weeklySchedule.length, 3, "a later move keeps the count");
    assert.deepEqual(p.bodyPartExclusions.map((b: any) => b.key), ["LEGS"], "the constraint survives other revisions");

    const lifted: any = await h.turn("Hết đau chân rồi");
    assert.match(lifted.answer, /không tránh chân nữa/);
    assert.match(lifted.answer, /không tự quay lại/);
    p = (await h.draft()).payload as any;
    assert.deepEqual(p.bodyPartExclusions, []);
    assert.equal(p.weeklySchedule.length, 3, "lifting never restores or changes exercises by itself");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART: 'giữ nguyên' to the question changes nothing, closes it, and keeps the safety reminder for a pain statement", dbOpts, async () => {
  const h = await harness();
  try {
    const before = (await h.draft()).payload as any;
    await h.turn("Tôi bị đau chân, bỏ bài tập chân");
    const r: any = await h.turn("giữ nguyên");
    assert.match(r.answer, /giữ nguyên lịch/);
    assert.match(r.answer, /đừng lưu lịch này/);
    const p = (await h.draft()).payload as any;
    assert.deepEqual(p.weeklySchedule, before.weeklySchedule);
    assert.equal(p.pendingBodyPartDecision, undefined);
    assert.deepEqual(p.bodyPartExclusions ?? [], []);
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART (leg exercises inside mixed sessions): an explicit removal is applied at once and keeps all 4 sessions", dbOpts, async () => {
  const h = await harness({ mixed: true });
  try {
    const r: any = await h.turn("Bỏ bài tập chân đi");
    assert.match(r.answer, /bỏ 3 bài có tác động tới chân/);
    assert.match(r.answer, /Vẫn giữ 4 buổi\/tuần/);
    const p = (await h.draft()).payload as any;
    assert.equal(p.weeklySchedule.length, 4);
    assert.deepEqual(p.selectedWeekdays, [1, 3, 5, 0]);
    assert.ok(!names(p).some((n: string) => /Squat|Lunge/.test(n)));
    assert.equal(names(p).length, 8, "11 exercises - 3 leg ones = 8");
    assert.deepEqual(p.weeklySchedule.map((d: any) => d.exercises.map((e: any) => e.order)), [[1, 2], [1, 2], [1, 2], [1, 2]], "order renumbered");
    assert.deepEqual(p.bodyPartExclusions.map((b: any) => [b.key, b.reason]), [["LEGS", "PREFERENCE"]]);
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART: a pain-only statement asks before changing; chest removal matches by muscle data, not by wording", dbOpts, async () => {
  const h = await harness({ mixed: true });
  try {
    const before = (await h.draft()).payload as any;
    const q: any = await h.turn("Tôi bị đau gối");
    assert.match(q.answer, /Bạn muốn mình bỏ các bài đó/);
    assert.deepEqual(((await h.draft()).payload as any).weeklySchedule, before.weeklySchedule);
    await h.turn("không");
    const r: any = await h.turn("Không tập ngực nữa");
    assert.match(r.answer, /bỏ 2 bài có tác động tới ngực/);
    const p = (await h.draft()).payload as any;
    assert.ok(!names(p).some((n: string) => /Bench|Push-Up/.test(n)));
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART: muscle data unavailable -> nothing changes and the reply says so (no false 'safe')", dbOpts, async () => {
  const h = await harness({ muscleDataDown: true });
  try {
    const before = (await h.draft()).payload as any;
    const r: any = await h.turn("Tôi bị đau chân, bỏ bài tập chân");
    assert.match(r.answer, /chưa kiểm tra được nhóm cơ/);
    assert.match(r.answer, /không khẳng định lịch này an toàn/);
    assert.deepEqual(((await h.draft()).payload as any).weeklySchedule, before.weeklySchedule, "draft unchanged");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("BODY PART: when no exercise loads the avoided part the reply says it checked, and still records the avoidance for regenerations", dbOpts, async () => {
  const h = await harness();
  try {
    const r: any = await h.turn("Tôi không tập bụng nữa");
    assert.match(r.answer, /hiện không có bài nào trong lịch tác động lên bụng/);
    const p = (await h.draft()).payload as any;
    assert.deepEqual(p.bodyPartExclusions.map((b: any) => b.key), ["CORE"]);
    assert.equal(p.weeklySchedule.length, 4);
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("TURN: existing revisions are unchanged — unavailability and an explicit named-exercise exclusion still work", dbOpts, async () => {
  const h = await harness();
  try {
    await h.turn("Thứ 4 tôi bận.");
    const p = (await h.draft()).payload as any;
    assert.equal(p.weeklySchedule.length, 4);
    assert.ok(!p.selectedWeekdays.includes(3));
    const r: any = await h.turn("Tôi không có máy cable");
    assert.ok(r, "named-exercise exclusion still handled by the original branch");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); await h.prisma.chatSession.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); await h.prisma.$disconnect(); }
});

// ── Part 3: pure body-part planning over catalog muscle data ───────────────────────────────────────────────
import { exerciseLoadsGroup, planBodyPartRemoval, detectBodyPartClear, parseBodyPartDecisionAnswer } from "../services/revision/workout-draft-intents";

const P = (id: string, bodyPart: string, muscleGroups: string[]) => [id, { id, bodyPart, muscleGroups }] as const;

test("exerciseLoadsGroup: primary or secondary muscle OR body-part enum counts; unrelated and empty data do not", () => {
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "LOWER_BODY", muscleGroups: [] }, "LEGS"), true, "bodyPart enum alone");
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "UPPER_BODY", muscleGroups: ["Quadriceps"] }, "LEGS"), true, "case-insensitive muscle");
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "FULL_BODY", muscleGroups: ["glutes"] }, "LEGS"), true);
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "UPPER_BODY", muscleGroups: ["chest", "triceps"] }, "LEGS"), false);
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "UPPER_BODY", muscleGroups: ["chest"] }, "CHEST"), true);
  assert.equal(exerciseLoadsGroup({ id: "a", muscleGroups: ["lower back"] }, "BACK"), true, "squat/deadlift load the lower back: conservative");
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: "CORE", muscleGroups: null }, "CORE"), true);
  assert.equal(exerciseLoadsGroup({ id: "a", bodyPart: null, muscleGroups: null }, "LEGS"), false);
  for (const m of ["biceps", "triceps", "forearms"]) assert.equal(exerciseLoadsGroup({ id: "a", muscleGroups: [m] }, "ARMS"), true, m);
  for (const m of ["shoulders", "rear_delts", "rotator_cuff"]) assert.equal(exerciseLoadsGroup({ id: "a", muscleGroups: [m] }, "SHOULDERS"), true, m);
});

test("planBodyPartRemoval: removes only matching exercises, reports emptied sessions and unknown exercises, never mutates its input", () => {
  const sched = [
    { day: "Thứ 2 A", exercises: [{ exerciseId: "sq", name: "Squat", order: 1 }, { exerciseId: "bp", name: "Bench", order: 2 }, { exerciseId: "zz", name: "Mystery", order: 3 }] },
    { day: "Thứ 4 B", exercises: [{ exerciseId: "sq2", name: "Squat 2", order: 1 }, { exerciseId: "lg", name: "Lunge", order: 2 }] },
  ];
  const snapshot = JSON.stringify(sched);
  const profiles = new Map([P("sq", "LOWER_BODY", ["quadriceps"]), P("bp", "UPPER_BODY", ["chest"]), P("sq2", "LOWER_BODY", ["glutes"]), P("lg", "LOWER_BODY", ["hamstrings"])]);
  const plan = planBodyPartRemoval(sched, profiles, "LEGS");
  assert.equal(JSON.stringify(sched), snapshot, "input untouched");
  assert.deepEqual(plan.removed.map((r) => r.name), ["Squat", "Squat 2", "Lunge"]);
  assert.deepEqual(plan.unknown.map((r) => r.name), ["Mystery"], "an exercise with no catalog data is kept AND reported, never assumed safe");
  assert.deepEqual(plan.emptiedDays, ["Thứ 4 B"]);
  assert.deepEqual(plan.keptIndexes, [0]);
  assert.deepEqual(plan.keptSchedule[0].exercises.map((e: any) => [e.name, e.order]), [["Bench", 1], ["Mystery", 2]], "order renumbered");
});

test("planBodyPartRemoval: nothing matches -> nothing removed, every session kept", () => {
  const sched = [{ day: "Thứ 2 A", exercises: [{ exerciseId: "bp", name: "Bench" }] }];
  const plan = planBodyPartRemoval(sched, new Map([P("bp", "UPPER_BODY", ["chest"])]), "LEGS");
  assert.equal(plan.removed.length, 0);
  assert.equal(plan.keptSchedule.length, 1);
  assert.deepEqual(plan.emptiedDays, []);
});

test("detectBodyPartClear: 'hết đau chân' variants lift the avoidance; questions and unrelated text do not; 'chấn thương' is not 'chân'", () => {
  const clear = (t: string) => detectBodyPartClear(t, normalizeAgentText(t));
  for (const [t, key] of [
    ["Hết đau chân rồi", "LEGS"], ["het dau chan roi", "LEGS"], ["Tôi tập chân lại được rồi", "LEGS"], ["khỏi đau lưng rồi", "BACK"], ["Hết chấn thương vai", "SHOULDERS"],
  ] as const) assert.equal(clear(t)?.key, key, t);
  for (const t of ["Hết đau chân chưa?", "Tôi bị đau chân", "Đổi buổi thứ 6 sang thứ 7", "Hết rồi"]) assert.equal(clear(t), null, t);
});

test("parseBodyPartDecisionAnswer: only short explicit yes/no count; anything else is not an answer", () => {
  const ans = (t: string) => parseBodyPartDecisionAnswer(normalizeAgentText(t));
  for (const t of ["đồng ý", "ok", "OK nhé", "được", "Vâng", "bỏ đi", "bỏ các buổi đó đi"]) assert.equal(ans(t), "YES", t);
  for (const t of ["không", "giữ nguyên", "Thôi không cần", "không cần đâu"]) assert.equal(ans(t), "NO", t);
  for (const t of ["Đổi buổi thứ 6 sang thứ 7", "Protein giúp gì cho cơ bắp", "tôi nghĩ là nên bỏ nhưng mà để mình suy nghĩ thêm một chút đã nhé", ""]) assert.equal(ans(t), null, t);
});

test("BODY PART safety: while the agent's question is open, 'ok lưu đi' still saves NOTHING and removes NOTHING (confirmation boundary intact)", dbOpts, async () => {
  const h = await harness();
  try {
    await h.turn("Tôi bị đau chân, bỏ bài tập chân");
    const before = (await h.draft()).payload as any;
    const r: any = await h.turn("ok lưu đi");
    assert.match(r.answer, /Mình chưa lưu gì cả/);
    const after = await h.draft();
    assert.equal(after.status, "PENDING", "nothing executed");
    assert.deepEqual((after.payload as any).weeklySchedule, before.weeklySchedule, "no exercise removed by a save-wording message");
    assert.ok((after.payload as any).pendingBodyPartDecision, "the question is still open");
  } finally { h.restore(); await h.prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "sess-req-" } } }); }
});

test("parseBodyPartDecisionAnswer: messages about saving are never a decision answer", () => {
  for (const t of ["ok lưu đi", "đồng ý lưu", "xác nhận", "ok chốt", "đồng ý cập nhật"]) assert.equal(parseBodyPartDecisionAnswer(normalizeAgentText(t)), null, t);
});

// ── Independent-review findings (code-review, high): precision of the Vietnamese understanding ───────────────
test("review: 'đúng rồi' is YES (not 'đừng'); 'đừng bỏ' is NO; 'thôi bỏ luôn đi' is YES; 'thôi' alone is NO", () => {
  const ans = (t: string) => parseBodyPartDecisionAnswer(normalizeAgentText(t));
  for (const t of ["Đúng rồi", "đúng vậy", "chính xác", "Thôi bỏ luôn đi", "bỏ đi"]) assert.equal(ans(t), "YES", t);
  for (const t of ["Đừng bỏ", "đừng xóa", "thôi", "thôi không cần", "giữ nguyên"]) assert.equal(ans(t), "NO", t);
});

test("review: look-alike words are not body parts — 'vài ngày' (a few days), 'mong là' (hope), recovery 'hết đau chân', plain 'đầu tiên'", () => {
  const cue = (t: string) => detectBodyPartConstraint(t, normalizeAgentText(t));
  for (const t of [
    "Tôi hơi đau, vài ngày nữa mới tập lại", "Tôi bị đau, mong là bớt", "Hết đau chân rồi", "khỏi đau lưng rồi", "Bớt đau gối rồi",
    "Cho tôi vài buổi tập vai", "Mong bạn tạo lịch mới", "đau đầu quá, ngày mai tập sau",
  ]) assert.equal(cue(t), null, t);
  // and the intended hits keep working
  assert.equal(cue("Tôi bị đau vai")?.key, "SHOULDERS");
  assert.equal(cue("đau nhức ở lưng dưới")?.key, "BACK");
  assert.equal(cue("Tôi bị chấn thương gối")?.key, "LEGS");
  assert.equal(cue("Tôi đang đau, bỏ bài tập ngực")?.part, "ngực", "removal object, not an unrelated word");
});

test("review: 'đổi buổi thứ 4 sang buổi tối' / 'đổi ngày thứ 5 sang nhẹ hơn' never collapse the plan — recognised as a per-session change and refused", () => {
  assert.equal(parse("Đổi buổi thứ 4 sang buổi tối")?.kind, "REPLACE_SESSION_FOCUS");
  assert.equal(parse("đổi ngày thứ 5 sang nhẹ hơn")?.kind, "REPLACE_SESSION_FOCUS");
});
