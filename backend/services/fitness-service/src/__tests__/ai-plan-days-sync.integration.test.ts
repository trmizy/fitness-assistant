import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * B1 — an AI plan revised IN PLACE with a DIFFERENT number of training days is applied to the SAME WorkoutProgram (no new program, no refusal).
 * Evidence label: BACKEND INTEGRATION on an isolated *_test Postgres (skipped, not failed, without one).
 *
 * Mapping rule (the one scheduling already uses): day i of the plan == dayNumber i of the program.
 *  more days  -> new program days are appended;  fewer days -> the LAST days are removed (exercises/prescriptions cascade);
 *  completed workouts/sessions are never deleted (a removed day only detaches them: WorkoutSchedule.programDayId is ON DELETE SET NULL);
 *  unstarted FUTURE sessions of removed days are deleted only when the client chose "replace the schedule", otherwise a structured 409 is returned and
 *  NOTHING is written; WorkoutProgram.version moves exactly once per applied change, atomically with it.
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.FITNESS_DISABLE_REDIS = process.env.FITNESS_DISABLE_REDIS || "true";
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 120_000 };

const RUN = randomUUID().slice(0, 8);
const CLIENT = `days-client-${RUN}`, PT = `days-pt-${RUN}`;
let prisma: (typeof import("../repositories/prisma"))["prisma"];
let ws: typeof import("../services/workout.service");
let planReview: (typeof import("../services/plan-review"))["planReviewService"];
let ids: string[] = [];

const client = { id: CLIENT, role: "CUSTOMER" }, pt = { id: PT, role: "PT" };
/** Exercise ids for "day k": n different catalog exercises, disjoint between days. */
const dayIds = (k: number, n = 3) => ids.slice(k * 4, k * 4 + n);
const planFrom = (sourcePlanId: string, version: number, lists: string[][], extra: Record<string, unknown> = {}) => ({
  sourcePlanId, sourcePlanVersion: version, sourcePlanName: "Kế hoạch đổi số buổi", goal: "MUSCLE_GAIN", durationWeeks: 1, daysPerWeek: lists.length,
  weeklySchedule: lists.map((list, d) => ({ day: `Day ${d + 1}`, goal: `Buổi ${d + 1}`, cardio: "Khởi động", exercises: list.map((id, i) => ({ exerciseId: id, order: i + 1, name: `X ${id.slice(0, 6)}`, sets: 3, reps: "10", restSeconds: 75, note: "ok" })) })),
  ...extra,
} as any);
const program = (id: string) => prisma.workoutProgram.findUniqueOrThrow({ where: { id }, include: { days: { orderBy: { dayNumber: "asc" }, include: { exercises: { orderBy: { order: "asc" }, include: { setPrescriptions: true } } } } } });
const shape = (p: any) => p.days.map((d: any) => d.exercises.map((e: any) => e.exerciseId));
const snapshot = async (programId: string, planId: string) =>
  JSON.stringify({ p: await program(programId), s: (await prisma.workoutSchedule.findMany({ where: { userId: CLIENT, sourcePlanId: planId }, orderBy: [{ date: "asc" }] })).map((x: any) => [x.id, x.programDayId, x.workoutId]) });

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  ws = await import("../services/workout.service");
  const pr = await import("../services/plan-review");
  planReview = pr.planReviewService;
  pr.planReviewDeps.fetchActiveClientIds = async (p) => (p === PT ? [CLIENT] : []);
  pr.planReviewDeps.notify = null;
  // Real catalog rows always carry a movementPattern; rows other (parallel) test files create temporarily do not.
  ids = (await prisma.exercise.findMany({ where: { status: "PUBLISHED", movementPattern: { not: null } }, orderBy: { exerciseName: "asc" }, take: 40, select: { id: true } })).map((e: any) => e.id);
  assert.ok(ids.length >= 40, "needs the seeded exercise catalog");
});
test.after(async () => {
  if (!canUseIntegrationDb) return;
  ws.programSyncTestHooks.afterContentSync = undefined;
  await prisma.planReviewRequest.deleteMany({ where: { clientUserId: CLIENT } });
  await prisma.workout.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutSchedule.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutProgram.deleteMany({ where: { userId: CLIENT } });
  if (ws.workoutQueue) await ws.workoutQueue.close();
  await prisma.$disconnect();
});

test("B1-01 + B1-10: 4 -> 5 days/week is applied to the SAME program (same plan/program ids, one version bump, new day appended, surviving rows keep their ids)", skipOpts, async () => {
  const planId = randomUUID();
  const four = [0, 1, 2, 3].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, four));
  const programId: string = first.createdProgramId;
  const before = await program(programId);
  assert.equal(before.version, 1); assert.equal(before.days.length, 4); assert.equal(before.daysPerWeek, 4);

  const r: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, [...four, dayIds(4)]));
  assert.equal(r.createdProgramId, programId, "same program id"); assert.equal(r.alreadyExists, true);
  assert.equal(r.contentSynced, true); assert.equal(r.programVersion, 2); assert.deepEqual(r.daysChange, { from: 4, to: 5 });
  const after = await program(programId);
  assert.equal(after.version, 2, "exactly ONE bump"); assert.equal(after.aiPlanVersion, 2); assert.equal(after.sourcePlanId, planId); assert.equal(after.daysPerWeek, 5);
  assert.deepEqual(after.days.map((d: any) => d.dayNumber), [1, 2, 3, 4, 5], "no duplicate / missing day numbers");
  assert.deepEqual(after.days.slice(0, 4).map((d: any) => d.id), before.days.map((d: any) => d.id), "existing day rows keep their ids");
  assert.deepEqual(after.days.slice(0, 4).map((d: any) => d.exercises.map((e: any) => e.id)), before.days.map((d: any) => d.exercises.map((e: any) => e.id)), "existing exercise rows keep their ids");
  assert.deepEqual(shape(after)[4], dayIds(4));
  assert.equal(await prisma.workoutProgram.count({ where: { userId: CLIENT, sourcePlanId: planId } }), 1, "never a second program");
});

test("B1-02 + B1-04: 5 -> 3 days/week (replace schedule): removed days go away, completed history + completed session survive untouched, future sessions follow the new days", skipOpts, async () => {
  const planId = randomUUID();
  const five = [0, 1, 2, 3, 4].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, five));
  const programId: string = first.createdProgramId;
  const p0 = await program(programId);
  const removedDay = p0.days[4];
  // a COMPLETED session of the day that is about to disappear + its workout log
  const wk = await prisma.workout.create({ data: { userId: CLIENT, name: "Đã tập buổi 5", exercises: { create: [{ exerciseId: removedDay.exercises[0].exerciseId, programExerciseId: removedDay.exercises[0].id, sets: 3, reps: 10, weight: 50, order: 1 }] } } });
  const done = await prisma.workoutSchedule.create({ data: { userId: CLIENT, date: new Date("2026-01-05T00:00:00.000Z"), programDayId: removedDay.id, workoutId: wk.id, sourcePlanId: planId, sourceType: "AI_PLAN", status: "COMPLETED" as any } });
  const historyBefore = JSON.stringify(await prisma.workout.findUniqueOrThrow({ where: { id: wk.id }, include: { exercises: true } }));

  const r: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3)));
  assert.equal(r.createdProgramId, programId); assert.equal(r.contentSynced, true); assert.equal(r.programVersion, 2); assert.deepEqual(r.daysChange, { from: 5, to: 3 });
  const p = await program(programId);
  assert.equal(p.days.length, 3); assert.equal(p.daysPerWeek, 3); assert.equal(p.version, 2);
  assert.equal(await prisma.workoutProgramDay.count({ where: { id: { in: [p0.days[3].id, p0.days[4].id] } } }), 0, "removed days are gone (exercises cascade)");
  assert.equal(await prisma.workoutProgramExercise.count({ where: { programDayId: { in: [p0.days[3].id, p0.days[4].id] } } }), 0);
  // B1-04: history is byte-identical; the completed session still exists, still points at its workout, merely detached from the removed day
  assert.equal(JSON.stringify(await prisma.workout.findUniqueOrThrow({ where: { id: wk.id }, include: { exercises: true } })), historyBefore, "workout log untouched");
  const doneAfter = await prisma.workoutSchedule.findUniqueOrThrow({ where: { id: done.id } });
  assert.equal(doneAfter.workoutId, wk.id); assert.equal(doneAfter.programDayId, null);
  // unstarted sessions only reference days that still exist
  const live = await prisma.workoutSchedule.findMany({ where: { userId: CLIENT, sourcePlanId: planId, workoutId: null } });
  assert.ok(live.length > 0 && live.every((s: any) => p.days.some((d: any) => d.id === s.programDayId)), "no unstarted session points at a removed day");
});

test("B1-03: reordering the days follows the plan position; ids stay, version moves once, PT approval of the old order is stale (B1-06)", skipOpts, async () => {
  const planId = randomUUID();
  const A = dayIds(0), B = dayIds(1), C = dayIds(2);
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, [A, B, C]));
  const programId: string = first.createdProgramId;
  const p0 = await program(programId);
  const req = (await planReview.submit(client, { ptUserId: PT })).request;
  assert.equal((await planReview.approve(pt, req.id, { note: "ok" })).request.effectiveState, "APPROVED_CURRENT");

  const r: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, [B, A, C]));
  assert.equal(r.contentSynced, true); assert.equal(r.programVersion, 2); assert.equal(r.daysChange, undefined, "same number of days");
  const p = await program(programId);
  assert.deepEqual(shape(p), [B, A, C]);
  assert.deepEqual(p.days.map((d: any) => d.id), p0.days.map((d: any) => d.id), "day rows keep their ids and numbers");
  assert.equal((await planReview.get(client, req.id)).effectiveState, "APPROVED_OUTDATED", "B1-06: approval of the old order does not apply");
});

test("B1-05: dropping days that still have UNSTARTED FUTURE sessions WITHOUT 'replace schedule' -> structured 409, nothing written; with replace it applies", skipOpts, async () => {
  const planId = randomUUID();
  const five = [0, 1, 2, 3, 4].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, five));
  const programId: string = first.createdProgramId;
  const before = await snapshot(programId, planId);
  const sessionsOnLastTwo = await prisma.workoutSchedule.count({ where: { userId: CLIENT, sourcePlanId: planId, workoutId: null } });
  assert.ok(sessionsOnLastTwo >= 5, "fixture: the import scheduled sessions for every day");

  await assert.rejects(
    ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3), { replaceExisting: false })),
    (e: any) => e.status === 409 && e.code === "PROGRAM_SYNC_SCHEDULE_CONFLICT" && e.details.resolution === "REPLACE_EXISTING_SCHEDULE" && e.details.daysFrom === 5 && e.details.daysTo === 3 && e.details.removedDays.length === 2 && e.details.futureScheduleCount >= 2,
  );
  assert.equal(await snapshot(programId, planId), before, "program, days, exercises, version and sessions are exactly as before");
  const ok: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3), { replaceExisting: true }));
  assert.equal(ok.contentSynced, true); assert.equal(ok.programVersion, 2); assert.equal((await program(programId)).days.length, 3);
});

test("B1-07: concurrent applies are serialised — the same revision twice bumps the version ONCE; two different revisions end on the newer one with unique day numbers", skipOpts, async () => {
  const planId = randomUUID();
  const four = [0, 1, 2, 3].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, four));
  const programId: string = first.createdProgramId;
  const v2 = planFrom(planId, 2, [...four, dayIds(4)]);
  const [a, b]: any[] = await Promise.all([ws.workoutService.importAiPlanToSchedule(CLIENT, v2), ws.workoutService.importAiPlanToSchedule(CLIENT, v2)]);
  assert.deepEqual([a.contentSynced, b.contentSynced].sort(), [false, true], "exactly one of the two applied the revision");
  let p = await program(programId);
  assert.equal(p.version, 2); assert.equal(p.days.length, 5); assert.deepEqual(p.days.map((d: any) => d.dayNumber), [1, 2, 3, 4, 5]);

  const v3 = planFrom(planId, 3, four.slice(0, 3)), v4 = planFrom(planId, 4, [...four, dayIds(4), dayIds(5)]);
  await Promise.all([ws.workoutService.importAiPlanToSchedule(CLIENT, v3), ws.workoutService.importAiPlanToSchedule(CLIENT, v4)]);
  p = await program(programId);
  assert.equal(p.aiPlanVersion, 4, "the newer plan version wins whatever the arrival order"); assert.equal(p.days.length, 6);
  assert.deepEqual(p.days.map((d: any) => d.dayNumber), [1, 2, 3, 4, 5, 6]);
  assert.equal(await prisma.workoutProgram.count({ where: { userId: CLIENT, sourcePlanId: planId } }), 1);
});

test("B1-08: a failure after the content was rewritten rolls EVERYTHING back (days, exercises, prescriptions, schedules, version); a clean retry then applies once (B1-09)", skipOpts, async () => {
  const planId = randomUUID();
  const five = [0, 1, 2, 3, 4].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, five));
  const programId: string = first.createdProgramId;
  const before = await snapshot(programId, planId);
  ws.programSyncTestHooks.afterContentSync = () => { throw new Error("injected failure after the content sync"); };
  try {
    await assert.rejects(ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3))), /injected failure/);
  } finally { ws.programSyncTestHooks.afterContentSync = undefined; }
  assert.equal(await snapshot(programId, planId), before, "no partial write");

  const ok: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3)));
  assert.equal(ok.contentSynced, true); assert.equal(ok.programVersion, 2);
  const again: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, five.slice(0, 3)));
  assert.equal(again.contentSynced, false); assert.equal(again.programVersion, 2, "B1-09: retry is a no-op");
  const p = await program(programId);
  assert.equal(p.days.length, 3); assert.deepEqual(p.days.map((d: any) => d.dayNumber), [1, 2, 3]);
  assert.equal(new Set(p.days.flatMap((d: any) => d.exercises.map((e: any) => `${d.id}:${e.exerciseId}`))).size, p.days.flatMap((d: any) => d.exercises).length, "no duplicated exercise rows");
});

test("B1-11: undo (plan v3 = the original 4-day content) re-syncs the SAME program back to 4 days; the old approval never revives", skipOpts, async () => {
  const planId = randomUUID();
  const four = [0, 1, 2, 3].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, four));
  const programId: string = first.createdProgramId;
  const original = shape(await program(programId));
  const req = (await planReview.submit(client, { ptUserId: PT })).request;
  await planReview.approve(pt, req.id, { note: "ok" });
  await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, [...four, dayIds(4)]));
  const back: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 3, four)); // the plan's undo: version moves FORWARD, content is the old one
  assert.equal(back.createdProgramId, programId); assert.equal(back.programVersion, 3); assert.deepEqual(back.daysChange, { from: 5, to: 4 });
  const p = await program(programId);
  assert.deepEqual(shape(p), original, "content equals what was approved");
  assert.equal(p.daysPerWeek, 4);
  assert.equal((await planReview.get(client, req.id)).effectiveState, "APPROVED_OUTDATED", "A -> B -> A does not revive the approval");
});

test("review B3: fewer sets drop the per-set prescriptions beyond the new set count (no prescription for a set that no longer exists)", skipOpts, async () => {
  const planId = randomUUID();
  const two = [0, 1].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, two));
  const programId: string = first.createdProgramId;
  const p0 = await program(programId);
  const target = p0.days[0].exercises[0];
  for (const n of [1, 2, 3]) await prisma.workoutProgramExerciseSetPrescription.create({ data: { programExerciseId: target.id, setNumber: n, targetReps: 10 } });
  const lessSets = planFrom(planId, 2, two); lessSets.weeklySchedule[0].exercises[0].sets = 2;
  await ws.workoutService.importAiPlanToSchedule(CLIENT, lessSets);
  const left = await prisma.workoutProgramExerciseSetPrescription.findMany({ where: { programExerciseId: target.id }, orderBy: { setNumber: "asc" } });
  assert.deepEqual(left.map((x: any) => x.setNumber), [1, 2]);
});

test("review B1-F1: a STALE client re-sending an older plan version never lowers the program's aiPlanVersion marker (a later replay of the newer version must not overwrite manual edits)", skipOpts, async () => {
  const planId = randomUUID();
  const two = [0, 1].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, two));
  const programId: string = first.createdProgramId;
  const v3 = planFrom(planId, 3, [dayIds(0, 4), dayIds(1, 4)]);
  await ws.workoutService.importAiPlanToSchedule(CLIENT, v3);
  assert.equal((await program(programId)).aiPlanVersion, 3);
  // the user then edits a rep count by hand (version bump + content change)
  const target = (await program(programId)).days[0].exercises[0];
  await prisma.$transaction(async (tx: any) => { await tx.workoutProgramExercise.update({ where: { id: target.id }, data: { reps: 12 } }); await tx.workoutProgram.update({ where: { id: programId }, data: { version: { increment: 1 } } }); });
  const versionAfterManual = (await program(programId)).version;
  const stale: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, two)); // older client
  assert.equal(stale.contentSynced, false);
  const p = await program(programId);
  assert.equal(p.aiPlanVersion, 3, "marker did NOT go back to 2");
  const replay: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, v3);
  assert.equal(replay.contentSynced, false, "replaying v3 is a no-op, it does not overwrite the manual edit");
  const after = await program(programId);
  assert.equal(after.version, versionAfterManual); assert.equal(after.days[0].exercises[0].reps, 12);
});

test("review B1-F2: a session that is IN PROGRESS blocks the apply (structured 409, nothing written); once it is finished the apply goes through", skipOpts, async () => {
  const planId = randomUUID();
  const three = [0, 1, 2].map((k) => dayIds(k));
  const first: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 1, three));
  const programId: string = first.createdProgramId;
  const p0 = await program(programId);
  const live = await prisma.workoutSchedule.findFirstOrThrow({ where: { userId: CLIENT, sourcePlanId: planId, programDayId: p0.days[2].id } });
  await prisma.workoutSchedule.update({ where: { id: live.id }, data: { status: "IN_PROGRESS" as any, date: new Date(Date.now()), workoutId: (await prisma.workout.create({ data: { userId: CLIENT, name: "Đang tập" } })).id } });
  const before = await snapshot(programId, planId);
  await assert.rejects(ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, three.slice(0, 2))), (e: any) => e.status === 409 && e.code === "PROGRAM_SYNC_SESSION_IN_PROGRESS" && e.details.sessionsInProgress >= 1);
  assert.equal(await snapshot(programId, planId), before, "nothing written");
  await prisma.workoutSchedule.update({ where: { id: live.id }, data: { status: "COMPLETED" as any } });
  const ok: any = await ws.workoutService.importAiPlanToSchedule(CLIENT, planFrom(planId, 2, three.slice(0, 2)));
  assert.equal(ok.contentSynced, true); assert.equal(ok.programVersion, 2);
});
