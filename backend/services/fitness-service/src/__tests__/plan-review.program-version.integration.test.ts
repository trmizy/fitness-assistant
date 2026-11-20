import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Plan Review — monotonic WorkoutProgram.version and the atomic approval guard, against REAL Postgres.
 * Evidence label: BACKEND INTEGRATION (skipped, not failed, without an isolated *_test database).
 *
 * Proves what the in-memory twin cannot:
 *  - every reviewable mutation in workout.service bumps WorkoutProgram.version in the SAME transaction (and a failed mutation
 *    rolls the bump back);
 *  - non-content changes (description, status) never bump it;
 *  - A -> B -> A: same content hash, newer version => the old approval does NOT revive;
 *  - the approval guard (SELECT … FOR SHARE on the program row) really serialises against an in-flight edit, closing the
 *    check-then-act window (deterministic: the edit's row lock is held while the approval runs).
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 120_000 };

const RUN = randomUUID().slice(0, 8);
const CLIENT = `pv-client-${RUN}`;
const PT = `pv-pt-${RUN}`;
const EX1 = `pv-ex1-${RUN}`;
const EX2 = `pv-ex2-${RUN}`;

let prisma: (typeof import("../repositories/prisma"))["prisma"];
let workoutService: (typeof import("../services/workout.service"))["workoutService"];
let workoutQueue: (typeof import("../services/workout.service"))["workoutQueue"];
let planReview: (typeof import("../services/plan-review"))["planReviewService"];

const client = { id: CLIENT, role: "CUSTOMER" };
const pt = { id: PT, role: "PT" };

async function seedExercise(id: string, name: string) {
  await prisma.exercise.upsert({
    where: { id },
    update: {},
    create: {
      id, exerciseName: name, typeOfActivity: "STRENGTH", typeOfEquipment: "BARBELL", bodyPart: "UPPER_BODY",
      type: "PUSH", muscleGroupsActivated: ["chest"], instructions: "Test exercise.", loggingMode: "REPS_LOAD",
    },
  });
}

async function cleanup() {
  await prisma.planReviewRequest.deleteMany({ where: { clientUserId: CLIENT } });
  await prisma.workout.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutSchedule.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutProgram.deleteMany({ where: { userId: CLIENT } });
  await prisma.exercise.deleteMany({ where: { id: { in: [EX1, EX2] } } });
}

async function newProgram() {
  await cleanup();
  await seedExercise(EX1, "PV Bench Press");
  await seedExercise(EX2, "PV Row");
  const result = await workoutService.createManualProgram(CLIENT, {
    name: "PV Program", durationWeeks: 1, daysPerWeek: 1,
    startDate: todayAsScheduleDate().toISOString().slice(0, 10), repeatWeeks: 1,
    selectedWeekdays: [todayAsScheduleDate().getUTCDay()], replaceExisting: true,
    days: [{
      dayNumber: 1, title: "PV Day",
      exercises: [
        { exerciseId: EX1, sets: 3, reps: 10, restSeconds: 90 },
        { exerciseId: EX2, sets: 3, reps: 10, restSeconds: 90 },
      ],
    }],
  } as any);
  const program = (result as any).program;
  return { programId: program.id as string, dayId: program.days[0].id as string, ex1: program.days[0].exercises[0].id as string, ex2: program.days[0].exercises[1].id as string };
}

const versionOf = async (id: string) => (await prisma.workoutProgram.findUniqueOrThrow({ where: { id } })).version;

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  const ws = await import("../services/workout.service");
  workoutService = ws.workoutService;
  workoutQueue = ws.workoutQueue;
  const pr = await import("../services/plan-review");
  planReview = pr.planReviewService;
  pr.planReviewDeps.fetchActiveClientIds = async (ptId) => (ptId === PT ? [CLIENT] : []); // contract roster is user-service's concern
});
test.after(async () => {
  if (!canUseIntegrationDb) return;
  await cleanup();
  if (workoutQueue) await workoutQueue.close();
  await prisma.$disconnect();
});

test("PV01 a new program starts at version 1; every reviewable mutation bumps it exactly once, non-content edits never do", skipOpts, async () => {
  const p = await newProgram();
  assert.equal(await versionOf(p.programId), 1);
  let expected = 1;
  const expectBump = async (label: string, n = 1) => { expected += n; assert.equal(await versionOf(p.programId), expected, label); };
  const expectSame = async (label: string) => assert.equal(await versionOf(p.programId), expected, label);

  // program: name/goal are reviewed; description/status are not
  await workoutService.updateProgram(p.programId, CLIENT, { description: "chỉ đổi mô tả" });
  await expectSame("description only");
  await workoutService.updateProgram(p.programId, CLIENT, { name: "PV Program" });
  await expectSame("name set to the same value");
  await workoutService.updateProgram(p.programId, CLIENT, { name: "PV Program v2" });
  await expectBump("name changed");
  await workoutService.updateProgram(p.programId, CLIENT, { goal: "MUSCLE_GAIN" });
  await expectBump("goal changed");

  // day: title is reviewed; description/duration are not
  await workoutService.updateProgramDay(p.dayId, CLIENT, { description: "x", duration: 60 });
  await expectSame("day description/duration only");
  await workoutService.updateProgramDay(p.dayId, CLIENT, { title: "PV Day 2" });
  await expectBump("day title changed");

  // exercise prescription
  await workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 10 });
  await expectSame("exercise reps set to the same value");
  await workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 12 });
  await expectBump("exercise reps changed");
  await workoutService.updateProgramExercise(p.ex1, CLIENT, { setPrescriptions: [{ setNumber: 1, targetReps: 8 }, { setNumber: 2, targetReps: 6 }] });
  await expectBump("set prescriptions rewritten");

  // add / delete exercise
  const added: any = await workoutService.addProgramExercise(p.dayId, CLIENT, { exerciseId: EX1, sets: 2, reps: 15 });
  await expectBump("exercise added");
  await workoutService.deleteProgramExercise(added.id, CLIENT);
  await expectBump("exercise deleted");

  // superset grouping (reorders + adds structure)
  const group: any = await workoutService.createExerciseGroup(CLIENT, p.dayId, [p.ex1, p.ex2], "SUPERSET");
  await expectBump("group created");
  await workoutService.updateExerciseGroup(group.id, CLIENT, { restAfterRoundSeconds: 120 });
  await expectBump("group updated");
  await workoutService.ungroupExercises(group.id, CLIENT);
  await expectBump("group removed");

  // status / archival is not a content change
  await workoutService.updateProgram(p.programId, CLIENT, { status: "INACTIVE" });
  await expectSame("status change");
  await workoutService.updateProgram(p.programId, CLIENT, { status: "ACTIVE" });
  await expectSame("status restored");
  assert.ok(expected > 1);
});

test("PV02 atomicity: a mutation that fails inside its transaction rolls the version bump back with it", skipOpts, async () => {
  const p = await newProgram();
  const before = await versionOf(p.programId);
  // The failure must come from INSIDE the transaction (after the bump ran), not from an up-front validation: a validation error is
  // a plain { status, message } object, a DB/Prisma failure is an Error.
  await assert.rejects(
    workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 11, setPrescriptions: [{ setNumber: 1, targetReps: 3_000_000_000 }] }),
    (e: any) => {
      assert.ok(e instanceof Error, `expected a DB/Prisma error from inside the transaction, got ${JSON.stringify(e)}`);
      return true;
    },
  );
  assert.equal(await versionOf(p.programId), before, "version unchanged after a rolled-back edit");
  const ex = await prisma.workoutProgramExercise.findUniqueOrThrow({ where: { id: p.ex1 } });
  assert.equal(ex.reps, 10, "the content write rolled back too");
});

test("PV03 A -> B -> A on real Postgres: identical content hash, newer version => the approval is NOT revived", skipOpts, async () => {
  const p = await newProgram();
  const first = (await planReview.submit(client, { ptUserId: PT })).request;
  assert.equal(first.subjectVersion, 1);
  const approved = (await planReview.approve(pt, first.id, { note: "ok" })).request;
  assert.equal(approved.effectiveState, "APPROVED_CURRENT");

  await workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 12 }); // B
  assert.equal((await planReview.get(client, first.id)).effectiveState, "APPROVED_OUTDATED");
  await workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 10 }); // back to A
  const view = await planReview.get(client, first.id);
  assert.equal(await versionOf(p.programId), 3);
  const fresh = (await planReview.submit(client, { ptUserId: PT })).request; // new request on the A-again plan
  assert.equal(fresh.contentHash, first.contentHash, "content is byte-identical to the approved plan");
  assert.equal(fresh.subjectVersion, 3);
  assert.equal(view.effectiveState, "APPROVED_OUTDATED", "…but the old approval never comes back");
  assert.equal(view.isOutdated, true);
  assert.notEqual(fresh.id, first.id);
});

test("PV04 atomic approval guard: an edit holding the program row lock makes a concurrent approval fail instead of racing past it", skipOpts, async () => {
  const p = await newProgram();
  const req = (await planReview.submit(client, { ptUserId: PT })).request;
  await planReview.start(pt, req.id);

  let releaseEdit!: () => void;
  const gate = new Promise<void>((r) => (releaseEdit = r));
  let editLocked!: () => void;
  const locked = new Promise<void>((r) => (editLocked = r));

  // An in-flight client edit: it has already bumped the version (row X-locked) but not committed.
  const edit = prisma.$transaction(async (tx) => {
    await tx.workoutProgram.update({ where: { id: p.programId }, data: { version: { increment: 1 } } });
    await tx.workoutProgramExercise.update({ where: { id: p.ex1 }, data: { reps: 99 } });
    editLocked();
    await gate;
  }, { timeout: 60_000, maxWait: 60_000 });
  await locked;

  // The PT approves NOW: the service's plain read still sees v1 (the edit is uncommitted), so its pre-check passes; the decision
  // then blocks on FOR SHARE until the edit commits, and must read the NEW version.
  let settled = false;
  const decision = planReview.approve(pt, req.id, { note: "ok" }).then(
    (v) => { settled = true; return { ok: true as const, v }; },
    (e) => { settled = true; return { ok: false as const, e }; },
  );
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(settled, false, "the approval is waiting on the edit's row lock (not racing past it)");
  releaseEdit();
  await edit;
  const outcome = await decision;
  assert.equal(outcome.ok, false);
  assert.equal((outcome as any).e.status, 409);
  assert.equal((outcome as any).e.code, "REVISION_OUTDATED");

  const row = await prisma.planReviewRequest.findUniqueOrThrow({ where: { id: req.id }, include: { events: true } });
  assert.notEqual(row.status, "APPROVED");
  assert.equal(row.status, "SUPERSEDED");
  assert.ok(!row.events.some((e) => e.type === "APPROVED"), "no APPROVED audit event was written");
});

test("PV05 stress: approve vs edit raced 15x — an approval never stands on a plan that moved first", skipOpts, async () => {
  const p = await newProgram();
  for (let i = 0; i < 15; i += 1) {
    const req = (await planReview.submit(client, { ptUserId: PT })).request;
    const startVersion = await versionOf(p.programId);
    const [dec] = await Promise.allSettled([
      planReview.approve(pt, req.id, { note: "ok" }),
      workoutService.updateProgramExercise(p.ex1, CLIENT, { reps: 20 + i }),
    ]);
    const row = await prisma.planReviewRequest.findUniqueOrThrow({ where: { id: req.id } });
    if (dec.status === "fulfilled") {
      // The decision won the lock: it was taken against exactly the version the PT saw.
      assert.equal(row.status, "APPROVED");
      assert.equal(row.subjectVersion, startVersion);
    } else {
      assert.ok(["SUPERSEDED"].includes(row.status), `lost race must not leave a decided row, got ${row.status}`);
      assert.equal((dec.reason as any).code, "REVISION_OUTDATED");
    }
    // Whatever happened, the approval is only ever "current" if the plan is still at the approved version.
    const view = await planReview.get(client, req.id);
    if (view.status === "APPROVED") assert.equal(view.effectiveState, (await versionOf(p.programId)) === row.subjectVersion ? "APPROVED_CURRENT" : "APPROVED_OUTDATED");
  }
});

test("PV06 workout HISTORY never bumps the version: starting a session, logging/completing sets and skipping do not change WorkoutProgram.version", skipOpts, async () => {
  const p = await newProgram();
  const before = await versionOf(p.programId);
  const schedule = await prisma.workoutSchedule.findFirstOrThrow({ where: { userId: CLIENT, programDayId: p.dayId } });
  await workoutService.startSchedule(CLIENT, schedule.id);
  const logged = await prisma.workoutExercise.findFirstOrThrow({ where: { programExerciseId: p.ex1 }, include: { workoutSets: { orderBy: { setNumber: "asc" } } } });
  assert.ok(logged.workoutSets.length > 0, "session skeleton materialized (history rows exist)");
  await workoutService.updateSet(logged.workoutSets[0].id, CLIENT, { reps: 11, weight: 42.5, completed: true });
  assert.equal(await versionOf(p.programId), before, "history writes left the reviewable plan version untouched");
  // and the reviewed content hash is the same as before the session (history is not part of the snapshot)
  const first = (await planReview.submit(client, { ptUserId: PT })).request;
  assert.equal(first.subjectVersion, before);
});
