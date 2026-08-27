import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";
import { createPersistentNotification } from "../clients/notification.client";

/**
 * Roadmap P4.1 "Notifications/reminders" (§27) — "upcoming workout" and
 * "unfinished active workout". Structurally mirrors user-service's own
 * proven sweep-job pattern (session-autoconfirm.service.ts,
 * reschedule-expiry.service.ts): plain `setInterval`, a module-level
 * `running` overlap guard, per-batch error isolation, an injectable
 * `deps` object for testability — the first background job this
 * particular service has needed, but not a new PATTERN in this
 * codebase.
 *
 * §27: "Need preference controls. Do not spam." Anti-spam here is
 * idempotency, not a rate limiter: each `WorkoutSchedule` row can only
 * ever trigger ONE upcoming-reminder and ONE unfinished-reminder, ever
 * (tracked by `upcomingReminderSentAt`/`unfinishedReminderSentAt`, set
 * once and never cleared). Preference controls themselves live entirely
 * in user-service's `notificationService.create` (already reused
 * unchanged via `createPersistentNotification`) — this job does not
 * duplicate that check.
 *
 * Real schema constraint, disclosed rather than worked around:
 * `WorkoutSchedule.date` is a day-granularity label (UTC midnight), with
 * no time-of-day field anywhere in this schema. "Upcoming workout" is
 * therefore necessarily day-granularity too — "you have a workout
 * scheduled today, not yet started" — not a precise "in 2 hours"
 * reminder, which this schema cannot express.
 */

const UPCOMING_INTERVAL_MS = Number(process.env.WORKOUT_UPCOMING_REMINDER_INTERVAL_MS ?? 30 * 60 * 1000);
const UNFINISHED_INTERVAL_MS = Number(process.env.WORKOUT_UNFINISHED_REMINDER_INTERVAL_MS ?? 30 * 60 * 1000);
// A session left IN_PROGRESS this long without being completed/abandoned
// is realistically stale, not just "still training" — 3 hours is well
// beyond any real single session's duration.
const UNFINISHED_THRESHOLD_MS = Number(process.env.WORKOUT_UNFINISHED_THRESHOLD_MS ?? 3 * 60 * 60 * 1000);
const BATCH_SIZE = 100;

export interface UpcomingReminderRow {
  id: string;
  userId: string;
}
export interface UnfinishedReminderRow {
  id: string;
  userId: string;
}

export interface WorkoutReminderDeps {
  findUpcomingCandidates: (todayStart: Date, limit: number) => Promise<UpcomingReminderRow[]>;
  markUpcomingReminderSent: (id: string) => Promise<unknown>;
  findUnfinishedCandidates: (staleBefore: Date, limit: number) => Promise<UnfinishedReminderRow[]>;
  markUnfinishedReminderSent: (id: string) => Promise<unknown>;
  notify: (params: { userId: string; text: string; eventType: "WORKOUT_UPCOMING" | "WORKOUT_UNFINISHED"; entityId: string; link: string }) => Promise<unknown>;
}

export const defaultWorkoutReminderDeps: WorkoutReminderDeps = {
  findUpcomingCandidates: (todayStart, limit) =>
    prisma.workoutSchedule.findMany({
      where: { date: todayStart, status: "NOT_STARTED", upcomingReminderSentAt: null },
      take: limit,
      select: { id: true, userId: true },
    }),
  markUpcomingReminderSent: (id) =>
    prisma.workoutSchedule.update({ where: { id }, data: { upcomingReminderSentAt: new Date() } }),
  findUnfinishedCandidates: (staleBefore, limit) =>
    prisma.workoutSchedule.findMany({
      where: {
        status: "IN_PROGRESS",
        startedAt: { not: null, lte: staleBefore },
        unfinishedReminderSentAt: null,
      },
      take: limit,
      select: { id: true, userId: true },
    }),
  markUnfinishedReminderSent: (id) =>
    prisma.workoutSchedule.update({ where: { id }, data: { unfinishedReminderSentAt: new Date() } }),
  notify: (params) => createPersistentNotification(params),
};

let upcomingRunning = false;
let unfinishedRunning = false;

export function startWorkoutUpcomingReminderJob(): void {
  logger.info(`Workout upcoming-reminder job started (interval: ${Math.round(UPCOMING_INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runUpcomingReminderSweep();
  }, UPCOMING_INTERVAL_MS);
}

export function startWorkoutUnfinishedReminderJob(): void {
  logger.info(`Workout unfinished-reminder job started (interval: ${Math.round(UNFINISHED_INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runUnfinishedReminderSweep();
  }, UNFINISHED_INTERVAL_MS);
}

export async function runUpcomingReminderSweep(
  deps: WorkoutReminderDeps = defaultWorkoutReminderDeps,
): Promise<{ scanned: number; notified: number }> {
  if (upcomingRunning) {
    logger.info("[WorkoutUpcomingReminder] Previous run still in progress — skipping tick");
    return { scanned: 0, notified: 0 };
  }
  upcomingRunning = true;
  try {
    const todayStart = todayAsScheduleDate();
    const candidates = await deps.findUpcomingCandidates(todayStart, BATCH_SIZE);
    let notified = 0;
    for (const row of candidates) {
      try {
        await deps.notify({
          userId: row.userId,
          text: "Bạn có một buổi tập được lên lịch hôm nay, chưa bắt đầu.",
          eventType: "WORKOUT_UPCOMING",
          entityId: row.id,
          link: "/client/workout",
        });
        await deps.markUpcomingReminderSent(row.id);
        notified += 1;
      } catch (err) {
        // Isolated per-row — one failure must never stop the rest of the batch.
        logger.warn({ err: (err as Error).message, scheduleId: row.id }, "[WorkoutUpcomingReminder] row failed");
      }
    }
    if (candidates.length > 0) {
      logger.info(`[WorkoutUpcomingReminder] Notified ${notified}/${candidates.length}`);
    }
    return { scanned: candidates.length, notified };
  } finally {
    upcomingRunning = false;
  }
}

export async function runUnfinishedReminderSweep(
  deps: WorkoutReminderDeps = defaultWorkoutReminderDeps,
): Promise<{ scanned: number; notified: number }> {
  if (unfinishedRunning) {
    logger.info("[WorkoutUnfinishedReminder] Previous run still in progress — skipping tick");
    return { scanned: 0, notified: 0 };
  }
  unfinishedRunning = true;
  try {
    const staleBefore = new Date(Date.now() - UNFINISHED_THRESHOLD_MS);
    const candidates = await deps.findUnfinishedCandidates(staleBefore, BATCH_SIZE);
    let notified = 0;
    for (const row of candidates) {
      try {
        await deps.notify({
          userId: row.userId,
          text: "Bạn có một buổi tập đang dang dở, chưa được hoàn thành.",
          eventType: "WORKOUT_UNFINISHED",
          entityId: row.id,
          link: "/client/workout",
        });
        await deps.markUnfinishedReminderSent(row.id);
        notified += 1;
      } catch (err) {
        logger.warn({ err: (err as Error).message, scheduleId: row.id }, "[WorkoutUnfinishedReminder] row failed");
      }
    }
    if (candidates.length > 0) {
      logger.info(`[WorkoutUnfinishedReminder] Notified ${notified}/${candidates.length}`);
    }
    return { scanned: candidates.length, notified };
  } finally {
    unfinishedRunning = false;
  }
}
