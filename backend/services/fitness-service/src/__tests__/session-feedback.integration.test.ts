/**
 * Phase 2 (docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) integration coverage
 * for sessionFeedbackService — real DB, no mocks, matching the established
 * pattern in training-cycle-unification.integration.test.ts.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/session-feedback.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
  timeout: 60_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type ServiceLike = (typeof import("../services/session-feedback.service"))["sessionFeedbackService"];

let prisma: PrismaClientLike | undefined;
let sessionFeedbackService: ServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    sessionFeedbackService = (await import("../services/session-feedback.service")).sessionFeedbackService;
  }
  return { prisma: prisma!, sessionFeedbackService: sessionFeedbackService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function makeSchedule(
  db: PrismaClientLike,
  userId: string,
  status: string,
  // Ho_Chi_Minh-aware "today" (todayAsScheduleDate), not a raw current
  // instant — assertScheduleDateEditable reads a schedule's date as a bare
  // UTC calendar-day label (schedule-lock.util.ts), and a raw `new Date()`
  // "now" carries a real time-of-day that reads as "yesterday" in UTC
  // terms for ~7 hours of every 24 (UTC 17:00-23:59 vs Ho_Chi_Minh, UTC+7)
  // — a real, previously-latent SCHEDULE_DATE_LOCKED failure in this exact
  // default (verified reproducing), not in the lock logic itself.
  date: Date = todayAsScheduleDate(),
) {
  return db.workoutSchedule.create({
    data: { userId, date, status, totalExercises: 1, completedExercises: status === "COMPLETED" ? 1 : 0 },
  });
}

test("completed session: submit + read back feedback with all fields", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "COMPLETED");

  const saved = await svc.upsertFeedback(schedule.id, userId, {
    sessionRating: 4,
    difficulty: "just_right",
    painScore: 2,
  } as any);
  assert.equal(saved.sessionRating, 4);
  assert.equal(saved.feedbackMissing, false);

  const { feedback, feedbackMissing } = await svc.getFeedback(schedule.id, userId);
  assert.equal(feedbackMissing, false);
  assert.equal(feedback?.sessionRating, 4);
});

test("partial session: completion-form feedback accepted", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "PARTIALLY_COMPLETED");
  const saved = await svc.upsertFeedback(schedule.id, userId, { sessionRating: 3 } as any);
  assert.equal(saved.sessionRating, 3);
});

test("skipped session: requires skipReason, rejects completion-only submission missing it", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "SKIPPED");

  await assert.rejects(() => svc.upsertFeedback(schedule.id, userId, { notes: "no reason" } as any), (err: any) => {
    assert.equal(err.status, 400);
    return true;
  });

  const saved = await svc.upsertFeedback(schedule.id, userId, {
    skipReason: "fatigue",
    shouldAdjustPlan: true,
  } as any);
  assert.equal(saved.skipReason, "fatigue");
  assert.equal(saved.shouldAdjustPlan, true);
});

test("cancelled session: skip/cancel form works the same as skipped", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "CANCELLED");
  const saved = await svc.upsertFeedback(schedule.id, userId, { skipReason: "schedule_conflict" } as any);
  assert.equal(saved.skipReason, "schedule_conflict");
});

test("missing feedback: getFeedback reports feedbackMissing=true when no row exists yet", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "COMPLETED");
  const { feedback, feedbackMissing } = await svc.getFeedback(schedule.id, userId);
  assert.equal(feedback, null);
  assert.equal(feedbackMissing, true);
});

test("dismissFeedback sets the explicit feedbackMissing sentinel, distinct from 'never prompted'", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "COMPLETED");
  await svc.dismissFeedback(schedule.id, userId);
  const { feedback, feedbackMissing } = await svc.getFeedback(schedule.id, userId);
  assert.ok(feedback, "a row now exists (upserted by dismiss)");
  assert.equal(feedbackMissing, true);
});

test("update feedback: a second submission overwrites the first (upsert, not append)", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "COMPLETED");
  await svc.upsertFeedback(schedule.id, userId, { sessionRating: 2 } as any);
  const updated = await svc.upsertFeedback(schedule.id, userId, { sessionRating: 5 } as any);
  assert.equal(updated.sessionRating, 5);
  const { feedback } = await svc.getFeedback(schedule.id, userId);
  assert.equal(feedback?.sessionRating, 5);
});

test("ownership: a user cannot read or write feedback for a session that isn't theirs", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const ownerId = `feedback-test-${randomUUID()}`;
  const otherId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, ownerId, "COMPLETED");

  await assert.rejects(() => svc.getFeedback(schedule.id, otherId), (err: any) => {
    assert.equal(err.status, 404);
    return true;
  });
  await assert.rejects(
    () => svc.upsertFeedback(schedule.id, otherId, { sessionRating: 5 } as any),
    (err: any) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test("ineligible status: NOT_STARTED session rejects feedback submission (409)", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "NOT_STARTED");
  await assert.rejects(
    () => svc.upsertFeedback(schedule.id, userId, { sessionRating: 3 } as any),
    (err: any) => {
      assert.equal(err.status, 409);
      return true;
    },
  );
});

test("exercise feedback children are replaced (not appended) on resubmission", skipOpts, async () => {
  const { prisma: db, sessionFeedbackService: svc } = await loadModules();
  const userId = `feedback-test-${randomUUID()}`;
  const schedule = await makeSchedule(db, userId, "COMPLETED");
  await svc.upsertFeedback(schedule.id, userId, {
    sessionRating: 4,
    exerciseFeedback: [{ exerciseId: "ex-a", rating: 5, issueType: "liked" }],
  } as any);
  const second = await svc.upsertFeedback(schedule.id, userId, {
    sessionRating: 4,
    exerciseFeedback: [{ exerciseId: "ex-b", rating: 2, issueType: "too_heavy" }],
  } as any);
  assert.equal(second.exerciseFeedback.length, 1);
  assert.equal(second.exerciseFeedback[0].exerciseId, "ex-b");
});
