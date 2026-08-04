import { prisma } from "../repositories/prisma";
import { redisClient } from "../repositories/redis";
import { logger } from "@gym-coach/shared";
import {
  fetchInBodySeries,
  fetchInBodyById,
  fetchLatestInBodyOnOrBefore,
  fetchUserProfile,
  type InBodyEntrySnapshot,
} from "../clients/user.client";
import { analyzeCycleSafe, assessCycleSafe } from "../clients/ai.client";
import { pushCycleAssessmentNotification } from "../clients/notification.client";
import {
  computeAdherence,
  computeWorkoutMetrics,
  computeNewPRs,
} from "./training-cycle-metrics.service";
import { evaluateAlerts, type CycleAlert } from "./training-cycle-alerts.service";
import type { ProgressSignals } from "./training-cycle-classification.service";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import { computeCycleMetrics } from "./cycle-metrics.engine";
import { evaluateCycle as runDecisionEngine, type CycleDecision, type ActionScope } from "./cycle-decision.engine";
import { assertScheduleDateEditable, APP_SCHEDULE_TIME_ZONE } from "../utils/schedule-lock.util";
import { systemClock, type Clock } from "../utils/clock";
import type { CreateTrainingCycleInput, UpdateTrainingCycleInput, SessionFeedbackInput } from "../models/training-cycle.models";

const PROGRESS_CACHE_TTL_SECONDS = 120;

function progressCacheKey(cycleId: string): string {
  return `cycle-progress:${cycleId}`;
}

/** Best-effort Redis cache invalidation — never fails the caller if Redis is down. */
export async function invalidateCycleProgressCache(cycleId: string): Promise<void> {
  try {
    await redisClient.del(progressCacheKey(cycleId));
  } catch (err) {
    logger.warn({ err: (err as Error).message, cycleId }, "[training-cycle] cache invalidation failed");
  }
}

const ACTION_SCOPE_TO_ALLOWED_CHANGES: Record<ActionScope, string[]> = {
  none: [],
  minor_adjustment: ["VOLUME", "LOAD", "REPS", "EXERCISE", "FREQUENCY"],
  deload: ["DELOAD", "VOLUME", "LOAD"],
  full_rebuild: ["VOLUME", "LOAD", "REPS", "EXERCISE", "FREQUENCY", "DELOAD"],
};

/** Truncates to UTC midnight of the same calendar day — matches how
 * WorkoutSchedule.date is stored (date-only, no time-of-day). Using the raw
 * `new Date()`/`new Date(startDate)` instant (with hour/minute) as the cycle
 * start previously excluded that SAME DAY's already-logged sessions from
 * adherence queries (`date >= startDate`), since a schedule row stored at
 * 00:00:00 sits before a start instant captured mid-day. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Prisma error shape for a unique-constraint violation (P2002), without a
 * hard dependency on @prisma/client's error class export. */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

function weekOfCycle(startDate: Date, asOf: Date): number {
  const days = Math.floor((asOf.getTime() - startDate.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

async function buildRollingSummary(
  userId: string,
  planId: string | null,
  startDate: Date,
  asOf: Date,
  goal: string | null,
) {
  const [adherence, workoutMetrics, inBodySeries] = await Promise.all([
    computeAdherence(userId, planId, startDate, asOf),
    computeWorkoutMetrics(userId, startDate, asOf, planId),
    fetchInBodySeries(userId, startDate, asOf),
  ]);

  const newPRs = await computeNewPRs(userId, workoutMetrics.sets, startDate);

  const alerts: CycleAlert[] = evaluateAlerts({
    goal,
    inBodySeries,
    adherence,
    rpeTrend: workoutMetrics.rpeTrend,
    weekOfCycle: weekOfCycle(startDate, asOf),
  });

  return {
    adherence,
    volumeByWeek: workoutMetrics.volumeByWeek,
    volumeChangePct: workoutMetrics.volumeChangePct,
    e1rmTrend: workoutMetrics.e1rmTrend,
    rpeTrend: workoutMetrics.rpeTrend,
    newPRs,
    inBodySeries,
    alerts,
    computedAt: new Date().toISOString(),
  };
}

export const trainingCycleService = {
  /** Backward-compatible: called with just (userId, planId, startDate,
   * durationDays) this behaves EXACTLY as before (creates and immediately
   * activates). Passing `extra.status: "DRAFT"` is new — creates without
   * activating, for the new POST /:id/start flow. */
  async startCycle(
    userId: string,
    planId: string | null,
    startDate?: string,
    durationDays = 30,
    extra?: Pick<CreateTrainingCycleInput, "name" | "status" | "targetMetrics" | "configuration">,
    clock: Clock = systemClock,
  ) {
    const requestedStatus = extra?.status ?? "ACTIVE";

    if (requestedStatus === "ACTIVE") {
      const existing = await prisma.trainingCycle.findFirst({
        where: { userId, status: "ACTIVE", archivedAt: null },
      });
      if (existing) {
        throw { status: 409, message: "An active training cycle already exists" };
      }
    }

    const rawStart = startDate ? new Date(startDate) : clock.now();
    if (Number.isNaN(rawStart.getTime())) {
      throw { status: 400, message: "startDate must be a valid date" };
    }
    // Date-only, not an instant — see startOfUtcDay's doc comment. Using the
    // raw instant here excluded the cycle's own start-day sessions from
    // every subsequent adherence/metrics query.
    const start = startOfUtcDay(rawStart);
    const end = new Date(start);
    end.setDate(end.getDate() + durationDays);

    const [profile, startInBody, lastCycle] = await Promise.all([
      fetchUserProfile(userId),
      fetchLatestInBodyOnOrBefore(userId, start),
      prisma.trainingCycle.findFirst({
        where: { userId },
        orderBy: { cycleIndex: "desc" },
        select: { cycleIndex: true },
      }),
    ]);

    try {
      return await prisma.trainingCycle.create({
        data: {
          userId,
          planId,
          cycleIndex: (lastCycle?.cycleIndex ?? 0) + 1,
          startDate: start,
          endDate: end,
          durationDays,
          goal: profile?.goal ?? null,
          status: requestedStatus,
          startInbodyId: requestedStatus === "ACTIVE" ? (startInBody?.id ?? null) : null,
          name: extra?.name,
          targetMetrics: extra?.targetMetrics as any,
          configuration: extra?.configuration as any,
          timezoneAtStart: APP_SCHEDULE_TIME_ZONE,
        },
      });
    } catch (err) {
      // The findFirst check above is a fast-path/nice-error only — it does
      // NOT close the race window (two concurrent requests can both pass it
      // before either commits). The actual guarantee is the DB's partial
      // unique index on (user_id) WHERE status='ACTIVE' AND archived_at IS
      // NULL (see migration add_training_cycle_active_unique_constraint):
      // the loser's insert hits P2002 here and is turned into the same
      // clean 409 instead of a raw 500, so two simultaneous "start cycle"
      // requests always end with exactly one ACTIVE cycle.
      if (requestedStatus === "ACTIVE" && isUniqueConstraintError(err)) {
        throw { status: 409, message: "An active training cycle already exists" };
      }
      throw err;
    }
  },

  /** DRAFT -> ACTIVE transition — sets startDate/endDate/startInbodyId at
   * the moment of activation (not at creation time), since a DRAFT cycle
   * may sit unstarted for a while. */
  async startDraftCycle(cycleId: string, userId: string, clock: Clock = systemClock) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "DRAFT") {
      throw { status: 409, message: "Only a DRAFT cycle can be started" };
    }
    const existingActive = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
    });
    if (existingActive) {
      throw { status: 409, message: "An active training cycle already exists" };
    }

    const start = startOfUtcDay(clock.now());
    const end = new Date(start);
    end.setDate(end.getDate() + cycle.durationDays);
    const startInBody = await fetchLatestInBodyOnOrBefore(userId, start);

    try {
      return await prisma.trainingCycle.update({
        where: { id: cycleId },
        data: {
          status: "ACTIVE",
          startDate: start,
          endDate: end,
          startInbodyId: startInBody?.id ?? null,
          timezoneAtStart: APP_SCHEDULE_TIME_ZONE,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw { status: 409, message: "An active training cycle already exists" };
      }
      throw err;
    }
  },

  async updateCycle(cycleId: string, userId: string, updates: UpdateTrainingCycleInput) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (!["DRAFT", "ACTIVE"].includes(cycle.status)) {
      throw { status: 409, message: "Cannot update a cycle that has already been closed" };
    }
    return prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.targetMetrics !== undefined ? { targetMetrics: updates.targetMetrics as any } : {}),
        ...(updates.configuration !== undefined ? { configuration: updates.configuration as any } : {}),
      },
    });
  },

  /**
   * Explicit user-initiated abandonment — distinct from completeCycle's
   * INSUFFICIENT_DATA outcome. "Kết thúc chu kỳ" (completeCycle) still
   * represents the user asking for an evaluation attempt, which is gated on
   * data sufficiency; cancelCycle is for a user who wants to abandon the
   * cycle outright with NO evaluation attempted at all, regardless of how
   * much data exists (e.g. started by mistake, changed plans, changed
   * their mind). Never computes progressSignals, never calls the AI.
   * A DRAFT cycle can also be cancelled (abandoned before ever activating).
   */
  async cancelCycle(cycleId: string, userId: string, clock: Clock = systemClock) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (!["ACTIVE", "DRAFT"].includes(cycle.status)) {
      throw { status: 409, message: "Only an ACTIVE or DRAFT cycle can be cancelled" };
    }
    const now = clock.now();
    const updated = await prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "CANCELLED",
        endDate: now,
        actualEndDate: now,
      },
    });
    await invalidateCycleProgressCache(cycleId);
    return updated;
  },

  /**
   * Soft-deletes a cycle (sets archivedAt, never a real row delete — keeps
   * CycleAssessment/CycleSessionFeedback/CycleInBodyLink history intact for
   * audit, same reasoning as ai-service's archivePlan/archiveNutritionPlan).
   * Excluded from listCycles/getActiveCycle (and the ACTIVE-duplicate guard
   * in startCycle/startDraftCycle) once archived, but still directly
   * fetchable via getCycle/:id — same as the plan precedent. Idempotent:
   * archiving an already-archived cycle returns the existing archivedAt
   * instead of erroring.
   */
  async deleteCycle(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.archivedAt) return cycle;

    const archived = await prisma.trainingCycle.update({
      where: { id: cycleId },
      data: { archivedAt: new Date() },
    });
    await invalidateCycleProgressCache(cycleId);
    return archived;
  },

  /** Rolling metrics for the ACTIVE cycle, computed fresh (not the cached final summary). */
  async getActiveCycle(userId: string, clock: Clock = systemClock) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { startDate: "desc" },
    });
    if (!cycle) throw { status: 404, message: "No active training cycle" };

    const summary = await buildRollingSummary(
      userId,
      cycle.planId,
      cycle.startDate,
      clock.now(),
      cycle.goal,
    );

    return { cycle, summary };
  },

  /**
   * Closes the cycle: computes final rolling summary + deterministic
   * progressSignals, sets COMPLETED. Then fires the AI analysis call
   * WITHOUT blocking the response (can take tens of seconds) — the row
   * moves to ANALYZED once it resolves, or stays COMPLETED with an
   * aiFallback decision if the call fails. Callers should poll
   * GET /training-cycles/:id for the ANALYZED transition.
   */
  async completeCycle(cycleId: string, userId: string, endInbodyId?: string, clock: Clock = systemClock) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { id: cycleId, userId },
    });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "ACTIVE") {
      throw { status: 409, message: "Training cycle is already completed" };
    }

    const now = clock.now();
    let endInBody = endInbodyId ? await fetchInBodyById(userId, endInbodyId) : null;
    let lowConfidence = false;
    if (!endInBody) {
      endInBody = await fetchLatestInBodyOnOrBefore(userId, now);
      lowConfidence = true; // completed without a fresh, explicitly-chosen end measurement
    }

    const rolling = await buildRollingSummary(userId, cycle.planId, cycle.startDate, now, cycle.goal);

    // Data-sufficiency gate — mirrors the newer /evaluate flow's
    // CYCLE_TOO_SHORT / TOO_FEW_COMPLETED_SESSIONS gates (cycle-decision.engine.ts),
    // applied here too since this legacy path previously had NO minimum-data
    // check at all and would confidently classify PROGRESSING/PLATEAU/DECLINING
    // (and trigger a real AI analysis + recommendation) even for a cycle closed
    // same-day with 0 completed sessions. Closing early is still allowed (the
    // cycle still moves to a closed state) — only the confident progress
    // classification and AI call are suppressed.
    const t = cycleThresholds.assessment;
    const daysElapsed = Math.floor((now.getTime() - cycle.startDate.getTime()) / 86_400_000);
    const insufficientReasons: string[] = [];
    if (daysElapsed < t.minimumCycleDays) insufficientReasons.push("CYCLE_TOO_SHORT");
    if (rolling.adherence.total === 0) insufficientReasons.push("NO_SCHEDULED_SESSIONS");
    else if (rolling.adherence.completed < t.minimumCompletedSessions) insufficientReasons.push("TOO_FEW_COMPLETED_SESSIONS");

    if (insufficientReasons.length > 0) {
      const finalSummary = { ...rolling, progressSignals: null, closedAt: now.toISOString() };
      return prisma.trainingCycle.update({
        where: { id: cycleId },
        data: {
          status: "ANALYZED",
          endDate: now,
          endInbodyId: endInBody?.id ?? null,
          lowConfidence,
          decision: "INSUFFICIENT_DATA",
          summary: finalSummary as any,
          aiAnalysis: { insufficientData: true, reasonCodes: insufficientReasons } as any,
        },
      });
    }

    // Unified path (Phase 7): closing a cycle now runs the SAME Adaptive
    // Decision Engine as POST /:id/evaluate (computeCycleMetrics ->
    // runDecisionEngine -> assessCycleSafe explanation -> versioned
    // CycleAssessment), instead of the old standalone
    // classifyProgress()+analyzeCycleSafe() 3-way pipeline. This makes
    // "close a cycle" and "evaluate a cycle" converge on one deterministic
    // engine and one audit trail (RecommendationAudit), so a route/UI built
    // against either endpoint sees consistent decisions. Legacy
    // classifyProgress/runAnalysis/analyzeCycleSafe are kept (not deleted)
    // since nothing else in this file calls completeCycle a second way, but
    // they're no longer reachable from either production flow — see the
    // deprecation note on runAnalysis below.
    const updated = await prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "COMPLETED",
        endDate: now,
        endInbodyId: endInBody?.id ?? null,
        lowConfidence,
      },
    });

    const assessment = await this.runVersionedAssessment(updated, userId, clock);

    return prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "ANALYZED",
        decision: assessment.decision,
        summary: { ...rolling, closedAt: now.toISOString(), unifiedAssessmentId: assessment.id } as any,
      },
    });
  },

  /**
   * @deprecated Superseded by runVersionedAssessment (the Adaptive Decision
   * Engine), which completeCycle() now calls directly. Kept in place,
   * unused by any route, only in case older analysis payloads/tests still
   * reference this shape — do not wire this back into completeCycle().
   * Calls ai-service, then persists the decision.
   */
  async runAnalysis(
    cycleId: string,
    userId: string,
    cycle: { cycleIndex: number; goal: string | null; startDate: Date; endDate: Date; durationDays: number; lowConfidence: boolean; planId: string | null },
    startInBody: Awaited<ReturnType<typeof fetchInBodyById>>,
    endInBody: Awaited<ReturnType<typeof fetchInBodyById>>,
    progressSignals: ProgressSignals,
    experienceLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "UNKNOWN" = "UNKNOWN",
  ) {
    const priorCycles = await prisma.trainingCycle.findMany({
      where: { userId, status: { in: ["COMPLETED", "ANALYZED"] }, id: { not: cycleId } },
      orderBy: { cycleIndex: "desc" },
      take: 3,
      select: { cycleIndex: true, decision: true, summary: true },
    });

    const payload = {
      userId,
      cycle: {
        cycleIndex: cycle.cycleIndex,
        goal: cycle.goal,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        durationDays: cycle.durationDays,
        lowConfidence: cycle.lowConfidence,
        experienceLevel,
      },
      progressSignals,
      inbody: { series: null, start: startInBody, end: endInBody },
      currentPlan: { planId: cycle.planId },
      priorCycles: priorCycles.map((c) => ({
        cycleIndex: c.cycleIndex,
        decision: c.decision,
        cycleReview: (c.summary as any)?.progressSignals ?? null,
      })),
    };

    const result = await analyzeCycleSafe(userId, payload);

    if (!result) {
      // ai-service unreachable/failed — deterministic fallback mapping, no LLM involved.
      const fallbackDecision =
        progressSignals.overallTrend === "PROGRESSING"
          ? "KEEP"
          : progressSignals.overallTrend === "PLATEAU"
            ? "ADJUST"
            : "NEW_PLAN";
      await prisma.trainingCycle.update({
        where: { id: cycleId },
        data: {
          status: "ANALYZED",
          decision: fallbackDecision,
          aiAnalysis: { aiFallback: true, reason: "analyze-cycle call failed" },
        },
      });
      return;
    }

    await prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "ANALYZED",
        decision: result.decision,
        aiAnalysis: result as any,
      },
    });
  },

  async listCycles(userId: string, limit = 20) {
    return prisma.trainingCycle.findMany({
      where: { userId, archivedAt: null },
      orderBy: { startDate: "desc" },
      take: limit,
    });
  },

  async getCycle(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { id: cycleId, userId },
    });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    return cycle;
  },

  /** User approves a decision — records the plan for cycle N+1 (opening it is a separate call). */
  async approveDecision(cycleId: string, userId: string, nextPlanId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "ANALYZED") {
      throw { status: 409, message: "Cycle must be analyzed before a decision can be approved" };
    }
    return prisma.trainingCycle.update({
      where: { id: cycleId },
      data: { nextPlanId },
    });
  },

  // ── Adaptive Training Cycle Evaluation additions below ──────────────────

  /** Links an InBody entry to a cycle once the user confirms it should
   * count toward this cycle's trend (spec event flow: "inbody.created ->
   * link with active cycle if user confirms -> invalidate progress
   * cache"). Idempotent — linking the same entry twice is a no-op, not an
   * error, since @@unique([cycleId, inbodyEntryId]) would otherwise 500. */
  async linkInBodyEntry(cycleId: string, userId: string, inbodyEntryId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (!["DRAFT", "ACTIVE"].includes(cycle.status)) {
      throw { status: 409, message: "Cannot link new measurements to a closed cycle" };
    }
    const entry = await fetchInBodyById(userId, inbodyEntryId);
    if (!entry) throw { status: 404, message: "InBody entry not found" };

    const link = await prisma.cycleInBodyLink.upsert({
      where: { cycleId_inbodyEntryId: { cycleId, inbodyEntryId } },
      create: { cycleId, inbodyEntryId },
      update: {},
    });
    await invalidateCycleProgressCache(cycleId);
    return link;
  },

  /**
   * Quick post-session readiness/RPE/pain capture, upserted per
   * WorkoutSchedule (1:1, @@unique on workoutScheduleId) — feeds the
   * Decision Engine's pain-safety flags and this report's training-load/
   * monotony section (Foster, 1998). Ownership is checked through the
   * WorkoutSchedule itself (userId), not just the cycle, since the schedule
   * is the thing the user actually completed.
   */
  async submitSessionFeedback(
    cycleId: string,
    userId: string,
    workoutScheduleId: string,
    input: SessionFeedbackInput,
  ) {
    const schedule = await prisma.workoutSchedule.findFirst({
      where: { id: workoutScheduleId, userId, trainingCycleId: cycleId },
    });
    if (!schedule) throw { status: 404, message: "Workout session not found for this cycle" };
    assertScheduleDateEditable(schedule.date);

    const feedback = await prisma.cycleSessionFeedback.upsert({
      where: { workoutScheduleId },
      create: { cycleId, workoutScheduleId, ...input },
      update: { ...input },
    });
    await invalidateCycleProgressCache(cycleId);
    return feedback;
  },

  /** All InBody entries relevant to a cycle's body-composition trend:
   * explicit CycleInBodyLink rows plus the cycle's own start/end snapshots
   * (deduplicated) — so quality/trend analysis works even before a user has
   * ever used the new "link an entry to this cycle" feature. */
  async collectCycleInBodyEntries(
    cycleId: string,
    userId: string,
    cycle: { startInbodyId: string | null; endInbodyId: string | null },
  ): Promise<InBodyEntrySnapshot[]> {
    const links = await prisma.cycleInBodyLink.findMany({
      where: { cycleId },
      select: { inbodyEntryId: true },
    });
    const ids = new Set<string>(links.map((l) => l.inbodyEntryId));
    if (cycle.startInbodyId) ids.add(cycle.startInbodyId);
    if (cycle.endInbodyId) ids.add(cycle.endInbodyId);

    const entries = await Promise.all([...ids].map((id) => fetchInBodyById(userId, id)));
    return entries.filter((e): e is InBodyEntrySnapshot => e != null);
  },

  /** Latest COMPLETED assessment decision for each of the user's most
   * recent prior cycles (most-recent-first) — feeds the Decision Engine's
   * REBUILD "two consecutive missed cycles" rule. Cycles that never got a
   * new-style assessment are skipped (not backfilled from the legacy
   * 3-state `decision` column — a false negative here is the safe
   * direction, it just delays REBUILD from firing until real history
   * accumulates under the new system). */
  async getPriorCycleDecisions(userId: string, excludeCycleId: string): Promise<CycleDecision[]> {
    const priorCycles = await prisma.trainingCycle.findMany({
      where: { userId, id: { not: excludeCycleId } },
      orderBy: { cycleIndex: "desc" },
      take: 2,
      select: { id: true },
    });
    const decisions: CycleDecision[] = [];
    for (const c of priorCycles) {
      const latest = await prisma.cycleAssessment.findFirst({
        where: { cycleId: c.id, status: "COMPLETED" },
        orderBy: { assessmentVersion: "desc" },
        select: { decision: true },
      });
      if (latest?.decision) decisions.push(latest.decision as CycleDecision);
    }
    return decisions;
  },

  /** Cached rolling progress for a specific cycle (by id, not just the
   * active one) using the richer Phase-1 metrics engine. Redis-cached with
   * a short TTL, invalidated on new workout completions / InBody links. */
  async getCycleProgress(cycleId: string, userId: string, clock: Clock = systemClock) {
    const cycle = await this.getCycle(cycleId, userId);

    const cacheKey = progressCacheKey(cycleId);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      logger.warn({ err: (err as Error).message, cycleId }, "[training-cycle] progress cache read failed");
    }

    const priorityExercises = ((cycle.configuration as any)?.priorityExercises ?? []) as string[];
    const inBodyEntries = await this.collectCycleInBodyEntries(cycleId, userId, cycle);
    const metrics = await computeCycleMetrics({
      cycleId,
      userId,
      planId: cycle.planId,
      goal: cycle.goal,
      startDate: cycle.startDate,
      asOf: clock.now(),
      inBodyEntries,
      priorityExercises,
    });

    const result = { cycle, metrics, computedAt: new Date().toISOString() };
    try {
      await redisClient.setEx(cacheKey, PROGRESS_CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch (err) {
      logger.warn({ err: (err as Error).message, cycleId }, "[training-cycle] progress cache write failed");
    }
    return result;
  },

  /**
   * Full "what happened during this cycle" report — workout sessions
   * completed/missed (with per-session readiness/RPE/pain feedback) and
   * nutrition adherence (protein/calories/carbs/fat actually logged via
   * NutritionMealCompletion vs. the user's NutritionGoal), plus the
   * already-computed body-composition/progress summary. All same-service
   * data (no cross-service calls needed, unlike InBody), so this is a
   * synchronous read, not cached — meant to be opened on demand from cycle
   * history, not polled.
   */
  async getCycleReport(cycleId: string, userId: string) {
    const cycle = await this.getCycle(cycleId, userId);
    const windowStart = cycle.startDate;
    const windowEnd = ["COMPLETED", "ANALYZED"].includes(cycle.status) ? cycle.endDate : new Date();
    const now = new Date();

    const [schedules, feedbackRows, mealCompletions, nutritionGoal] = await Promise.all([
      prisma.workoutSchedule.findMany({ where: { trainingCycleId: cycleId }, orderBy: { date: "asc" } }),
      prisma.cycleSessionFeedback.findMany({ where: { cycleId } }),
      prisma.nutritionMealCompletion.findMany({
        where: { userId, logDate: { gte: windowStart, lte: windowEnd } },
        orderBy: { logDate: "asc" },
      }),
      prisma.nutritionGoal.findUnique({ where: { userId } }),
    ]);

    const feedbackByScheduleId = new Map(feedbackRows.map((f) => [f.workoutScheduleId, f]));
    const completedSessions = schedules.filter((s) => s.status === "COMPLETED");
    // Any non-COMPLETED status (SKIPPED, CANCELLED, PARTIALLY_COMPLETED,
    // NOT_STARTED/IN_PROGRESS left stale) for a session whose date has
    // already passed counts as missed — deliberately not distinguishing
    // *why* it wasn't completed, since the Decision Engine only needs
    // "did the user do the planned session or not".
    const missedSessions = schedules.filter((s) => s.status !== "COMPLETED" && s.date < now);
    const upcomingSessions = schedules.filter((s) => s.status !== "COMPLETED" && s.date >= now);

    const sessionDetails = completedSessions.map((s) => {
      const feedback = feedbackByScheduleId.get(s.id);
      return {
        date: s.date,
        completedExercises: s.completedExercises,
        totalExercises: s.totalExercises,
        readinessScore: feedback?.readinessScore ?? null,
        sessionRpe: feedback?.sessionRpe ?? null,
        painScore: feedback?.painScore ?? null,
        notes: feedback?.notes ?? null,
      };
    });
    const highPainSessions = sessionDetails.filter((s) => (s.painScore ?? 0) >= 5);

    const byDay = new Map<string, { protein: number; calories: number; carbs: number; fat: number; loggedMeals: number }>();
    let skippedMeals = 0;
    let partialMeals = 0;
    let completedMeals = 0;
    for (const m of mealCompletions) {
      const key = m.logDate.toISOString().slice(0, 10);
      if (m.status === "SKIPPED") skippedMeals += 1;
      else if (m.status === "PARTIAL") partialMeals += 1;
      else if (m.status === "COMPLETED") completedMeals += 1;
      if (m.status === "COMPLETED" || m.status === "PARTIAL") {
        const day = byDay.get(key) ?? { protein: 0, calories: 0, carbs: 0, fat: 0, loggedMeals: 0 };
        day.protein += m.consumedProtein ?? 0;
        day.calories += m.consumedCalories ?? 0;
        day.carbs += m.consumedCarbs ?? 0;
        day.fat += m.consumedFat ?? 0;
        day.loggedMeals += 1;
        byDay.set(key, day);
      }
    }
    const loggedDays = [...byDay.values()];
    const avg = (key: "protein" | "calories" | "carbs" | "fat"): number | null =>
      loggedDays.length > 0 ? loggedDays.reduce((sum, d) => sum + d[key], 0) / loggedDays.length : null;

    const avgProtein = avg("protein");
    const avgCalories = avg("calories");
    const avgCarbs = avg("carbs");
    const avgFat = avg("fat");
    const proteinAdherencePct =
      avgProtein != null && nutritionGoal?.protein ? Math.round((avgProtein / nutritionGoal.protein) * 100) : null;
    const caloriesAdherencePct =
      avgCalories != null && nutritionGoal?.calories ? Math.round((avgCalories / nutritionGoal.calories) * 100) : null;

    // Protein per kg bodyweight, evidence-based range (not just the user's
    // own configurable NutritionGoal): meta-analyses on resistance-trained
    // adults converge on ~1.6-2.2 g/kg/day for hypertrophy, with diminishing
    // returns above that (Morton et al. 2018, Nutrition Reviews 2021 dose-
    // response review). Uses the cycle's own most recent InBody weight
    // (already in cycle.summary.inBodySeries), not a live cross-service
    // call — same reasoning as the rest of this report.
    const PROTEIN_EVIDENCE_RANGE_G_PER_KG = { min: 1.6, max: 2.2 };
    const inBodySeriesForWeight = ((cycle.summary as any)?.inBodySeries ?? []) as Array<{ date: string; weight: number }>;
    const latestKnownWeight =
      inBodySeriesForWeight.length > 0 ? inBodySeriesForWeight[inBodySeriesForWeight.length - 1].weight : null;
    const proteinPerKg =
      avgProtein != null && latestKnownWeight ? Math.round((avgProtein / latestKnownWeight) * 100) / 100 : null;

    // Session training load (sRPE x duration) and Foster monotony/strain —
    // day-to-day variability of training load within each 7-day block.
    // Monotony >= 2.0 is the widely-cited threshold associated with
    // elevated overtraining/illness/injury risk (Foster, 1998; confirmed in
    // later training-load-monitoring literature). Only computed for
    // sessions that have BOTH a logged sessionRpe and a recorded duration —
    // no invented data for sessions missing either.
    const reportWindowDays = Math.max(1, Math.ceil((windowEnd.getTime() - windowStart.getTime()) / 86_400_000));
    const dailyLoad = new Array(reportWindowDays).fill(0) as number[];
    for (const s of completedSessions) {
      const feedback = feedbackByScheduleId.get(s.id);
      if (feedback?.sessionRpe != null && s.durationSeconds != null) {
        const dayIndex = Math.floor((s.date.getTime() - windowStart.getTime()) / 86_400_000);
        if (dayIndex >= 0 && dayIndex < reportWindowDays) {
          dailyLoad[dayIndex] += feedback.sessionRpe * (s.durationSeconds / 60);
        }
      }
    }
    const hasTrainingLoadData = dailyLoad.some((v) => v > 0);
    const weeklyTrainingLoad: Array<{ week: number; totalLoad: number; monotony: number | null; strain: number | null }> = [];
    for (let i = 0, week = 1; i < dailyLoad.length; i += 7, week += 1) {
      const block = dailyLoad.slice(i, i + 7);
      const total = block.reduce((a, b) => a + b, 0);
      const mean = total / block.length;
      const variance = block.reduce((sum, v) => sum + (v - mean) ** 2, 0) / block.length;
      const sd = Math.sqrt(variance);
      const monotony = sd > 0 ? Math.round((mean / sd) * 100) / 100 : null;
      const strain = monotony != null ? Math.round(total * monotony) : null;
      weeklyTrainingLoad.push({ week, totalLoad: Math.round(total), monotony, strain });
    }
    const highMonotonyWeeks = weeklyTrainingLoad.filter((w) => w.monotony != null && w.monotony >= 2.0).length;

    // Week-over-week training-volume spikes, reusing the already-computed
    // volumeByWeek (no recompute) — large sudden jumps are the same
    // underlying concern training-load-monitoring guidelines flag via
    // acute:chronic workload ratio, kept here as a simple informational
    // week-over-week delta rather than a clinical claim.
    const volumeByWeek = ((cycle.summary as any)?.volumeByWeek ?? []) as Array<{ week: number; totalVolumeKg: number }>;
    const volumeWeekOverWeekPct = volumeByWeek.map((w, i) => {
      if (i === 0) return { week: w.week, changePct: null as number | null };
      const prev = volumeByWeek[i - 1].totalVolumeKg;
      if (!prev) return { week: w.week, changePct: null as number | null };
      return { week: w.week, changePct: Math.round(((w.totalVolumeKg - prev) / prev) * 100) };
    });
    const rapidVolumeIncrease = volumeWeekOverWeekPct.some((w) => w.changePct != null && w.changePct > 50);

    const totalDueSessions = completedSessions.length + missedSessions.length;

    const flags: string[] = [];
    if (proteinAdherencePct != null && proteinAdherencePct < 85) flags.push("PROTEIN_BELOW_TARGET");
    if (proteinPerKg != null && proteinPerKg < PROTEIN_EVIDENCE_RANGE_G_PER_KG.min) flags.push("PROTEIN_BELOW_EVIDENCE_RANGE");
    if (skippedMeals > 0 && skippedMeals >= completedMeals) flags.push("FREQUENT_SKIPPED_MEALS");
    if (totalDueSessions > 0 && missedSessions.length > completedSessions.length) flags.push("FREQUENT_MISSED_SESSIONS");
    if (highPainSessions.length > 0) flags.push("PAIN_REPORTED");
    if (hasTrainingLoadData && highMonotonyWeeks > 0) flags.push("HIGH_TRAINING_MONOTONY");
    if (rapidVolumeIncrease) flags.push("RAPID_VOLUME_INCREASE");

    return {
      cycle,
      window: { startDate: windowStart, endDate: windowEnd },
      workouts: {
        totalScheduled: schedules.length,
        completed: completedSessions.length,
        missed: missedSessions.length,
        upcoming: upcomingSessions.length,
        completionRate: totalDueSessions > 0 ? Math.round((completedSessions.length / totalDueSessions) * 100) : 0,
        missedSessions: missedSessions.map((s) => ({ date: s.date })),
        sessionDetails,
        highPainSessions,
      },
      trainingLoad: {
        hasData: hasTrainingLoadData,
        weeklyLoad: weeklyTrainingLoad,
        monotonyThreshold: 2.0,
      },
      nutrition: {
        daysLogged: loggedDays.length,
        totalDaysInWindow: reportWindowDays,
        avgProtein,
        targetProtein: nutritionGoal?.protein ?? null,
        proteinAdherencePct,
        proteinPerKgBodyWeight: proteinPerKg,
        proteinEvidenceRangeGPerKg: PROTEIN_EVIDENCE_RANGE_G_PER_KG,
        avgCalories,
        targetCalories: nutritionGoal?.calories ?? null,
        caloriesAdherencePct,
        avgCarbs,
        targetCarbs: nutritionGoal?.carbs ?? null,
        avgFat,
        targetFat: nutritionGoal?.fat ?? null,
        completedMeals,
        partialMeals,
        skippedMeals,
      },
      bodyComposition: (cycle.summary as any)?.inBodySeries ?? [],
      volumeWeekOverWeekPct,
      progressSignals: (cycle.summary as any)?.progressSignals ?? null,
      alerts: (cycle.summary as any)?.alerts ?? [],
      newPRs: (cycle.summary as any)?.newPRs ?? [],
      flags,
    };
  },

  /**
   * The new richer evaluation flow: deterministic metrics (Phase 1) ->
   * Decision Engine (Phase 2) -> LLM explanation only (Phase 3, ai-service
   * /ai/assess-cycle) -> persisted as a versioned CycleAssessment. Runs
   * SYNCHRONOUSLY (unlike the legacy /complete's fire-and-forget) since
   * this is a deliberate, on-demand user action expecting a fresh result,
   * not an automatic side effect of closing a cycle.
   *
   * Idempotent by (cycleId, assessmentVersion): if an evaluation is already
   * PENDING for this cycle, returns it immediately rather than starting a
   * second concurrent computation. The @@unique([cycleId, assessmentVersion])
   * DB constraint is the final safety net for the remaining race window.
   */
  async evaluateCycle(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status === "DRAFT") {
      throw { status: 409, message: "Cannot evaluate a draft cycle before it is started" };
    }
    return this.runVersionedAssessment(cycle, userId);
  },

  /**
   * Shared Adaptive Decision Engine runner (Phase 7 unification) — the ONE
   * place that calls computeCycleMetrics -> runDecisionEngine ->
   * assessCycleSafe -> persists a versioned CycleAssessment + audit row.
   * Called from both evaluateCycle() (POST /:id/evaluate, on an ACTIVE or
   * already-closed cycle) and completeCycle() (POST /:id/complete, right
   * after a cycle is closed) so "close a cycle" and "evaluate a cycle"
   * always produce the exact same kind of decision, from the exact same
   * engine, with the exact same audit trail — never two divergent
   * classifiers for what is conceptually one decision.
   */
  async runVersionedAssessment(
    cycle: {
      id: string;
      planId: string | null;
      goal: string | null;
      startDate: Date;
      endDate: Date | null;
      cycleIndex: number;
      durationDays: number;
      name: string | null;
      configuration: unknown;
      startInbodyId: string | null;
      endInbodyId: string | null;
    },
    userId: string,
    clock: Clock = systemClock,
  ) {
    const cycleId = cycle.id;
    const pending = await prisma.cycleAssessment.findFirst({
      where: { cycleId, status: "PENDING" },
      orderBy: { assessmentVersion: "desc" },
    });
    if (pending) return pending;

    const lastVersion = await prisma.cycleAssessment.findFirst({
      where: { cycleId },
      orderBy: { assessmentVersion: "desc" },
      select: { assessmentVersion: true },
    });
    const nextVersion = (lastVersion?.assessmentVersion ?? 0) + 1;

    let assessmentRow;
    try {
      assessmentRow = await prisma.cycleAssessment.create({
        data: { cycleId, assessmentVersion: nextVersion, status: "PENDING" },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const concurrent = await prisma.cycleAssessment.findUnique({
          where: { cycleId_assessmentVersion: { cycleId, assessmentVersion: nextVersion } },
        });
        if (concurrent) return concurrent;
      }
      throw err;
    }

    try {
      const completedSessions = await prisma.workoutSchedule.count({
        where: { trainingCycleId: cycleId, status: "COMPLETED" },
      });
      const now = clock.now();
      const cycleDurationDays = Math.max(1, Math.ceil((now.getTime() - cycle.startDate.getTime()) / 86_400_000));
      const priorityExercises = ((cycle.configuration as any)?.priorityExercises ?? []) as string[];
      const inBodyEntries = await this.collectCycleInBodyEntries(cycleId, userId, cycle);

      const metrics = await computeCycleMetrics({
        cycleId,
        userId,
        planId: cycle.planId,
        goal: cycle.goal,
        startDate: cycle.startDate,
        asOf: now,
        inBodyEntries,
        priorityExercises,
      });

      const priorCycleDecisions = await this.getPriorCycleDecisions(userId, cycleId);

      // Fetched fresh (not snapshotted at cycle start) since the user may
      // only set this after the cycle began — always an explicit "UNKNOWN"
      // to the Decision Engine/AI-service prompt when unset, never silently
      // defaulted to BEGINNER or inferred as INTERMEDIATE (see
      // docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0: advanced-technique
      // suggestions and progression-readiness calls must never be made
      // while experience level is unverified).
      const profile = await fetchUserProfile(userId);
      const experienceLevel = (profile?.experienceLevel ?? "UNKNOWN") as
        | "BEGINNER"
        | "INTERMEDIATE"
        | "ADVANCED"
        | "UNKNOWN";
      const competesInSport = profile?.competesInSport === true;

      const engineResult = runDecisionEngine({
        cycleDurationDays,
        completedSessions,
        metrics,
        priorCycleDecisions,
        experienceLevel,
        competesInSport,
      });

      const allowedChanges = ACTION_SCOPE_TO_ALLOWED_CHANGES[engineResult.recommendedActionScope];

      const aiResult = await assessCycleSafe(userId, {
        userId,
        cycle: {
          name: cycle.name,
          goalType: cycle.goal,
          cycleIndex: cycle.cycleIndex,
          durationDays: cycle.durationDays,
          startDate: cycle.startDate,
          endDate: cycle.endDate ?? now,
          experienceLevel,
          competesInSport,
        },
        dataQuality: {
          dataQualityScore: metrics.dataQualityScore,
          dataCompletenessScore: metrics.dataCompletenessScore,
          qualityFlags: metrics.inBodyQuality.qualityFlags,
        },
        computedMetrics: metrics,
        decision: {
          value: engineResult.decision,
          confidenceScore: engineResult.confidenceScore,
          recommendedActionScope: engineResult.recommendedActionScope,
        },
        reasonCodes: engineResult.reasonCodes,
        safetyFlags: engineResult.safetyFlags,
        currentPlanSummary: { planId: cycle.planId },
        allowedChanges,
      });

      const updated = await prisma.cycleAssessment.update({
        where: { id: assessmentRow.id },
        data: {
          status: "COMPLETED",
          decision: engineResult.decision,
          confidenceScore: engineResult.confidenceScore,
          dataQualityScore: metrics.dataQualityScore,
          computedMetrics: metrics as any,
          reasonCodes: engineResult.reasonCodes as any,
          conflictingSignals: engineResult.conflictingSignals as any,
          safetyFlags: engineResult.safetyFlags as any,
          recommendedActionScope: engineResult.recommendedActionScope as any,
          aiSummary: aiResult?.summary ?? null,
          proposedChanges: (aiResult?.proposedChanges ?? []) as any,
        },
      });
      void pushCycleAssessmentNotification(userId, cycleId, engineResult.decision).catch(() => {});
      // Awaited (unlike the notification push above): this is a fast,
      // single-table local DB write, not a slow external call, and a caller
      // querying GET /:id/audit right after this resolves must see the row
      // — a race here would make the audit trail unreliable exactly when
      // it's supposed to be authoritative. Still wrapped in try/catch so a
      // write failure never fails the evaluation result itself.
      try {
        await prisma.recommendationAudit.create({
          data: {
            userId,
            cycleId,
            assessmentId: updated.id,
            engineVersion: "adaptive-v1",
            decision: engineResult.decision,
            reasonCodes: engineResult.reasonCodes as any,
            metricsSnapshot: metrics as any,
            aiSummary: aiResult?.summary ?? null,
          },
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message, cycleId }, "[training-cycle] recommendation audit write failed");
      }
      return updated;
    } catch (err) {
      await prisma.cycleAssessment.update({ where: { id: assessmentRow.id }, data: { status: "FAILED" } });
      throw err;
    }
  },

  async listAssessments(cycleId: string, userId: string, page = 1, limit = 20) {
    await this.getCycle(cycleId, userId);
    const skip = (page - 1) * limit;
    const [assessments, total] = await Promise.all([
      prisma.cycleAssessment.findMany({
        where: { cycleId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.cycleAssessment.count({ where: { cycleId } }),
    ]);
    return { assessments, total, page, limit };
  },

  async getLatestAssessment(cycleId: string, userId: string) {
    await this.getCycle(cycleId, userId);
    const latest = await prisma.cycleAssessment.findFirst({
      where: { cycleId },
      orderBy: { assessmentVersion: "desc" },
    });
    if (!latest) throw { status: 404, message: "No assessment found for this cycle" };
    return latest;
  },

  /** Marks the recommendation ACCEPTED — does NOT itself create/activate a
   * new plan or cycle (matches spec: "Không tự động activate plan mới khi
   * người dùng chỉ mở assessment"). Actually opening cycle N+1 with a new
   * plan remains a separate, explicit step, same as the legacy
   * approveDecision above. */
  async acceptRecommendation(cycleId: string, userId: string, assessmentId?: string) {
    return this.reviewRecommendation(cycleId, userId, "ACCEPTED", assessmentId);
  },

  async rejectRecommendation(cycleId: string, userId: string, assessmentId?: string) {
    return this.reviewRecommendation(cycleId, userId, "REJECTED", assessmentId);
  },

  async reviewRecommendation(
    cycleId: string,
    userId: string,
    userDecision: "ACCEPTED" | "REJECTED",
    assessmentId?: string,
  ) {
    await this.getCycle(cycleId, userId);
    const assessment = assessmentId
      ? await prisma.cycleAssessment.findFirst({ where: { id: assessmentId, cycleId } })
      : await prisma.cycleAssessment.findFirst({
          where: { cycleId, status: "COMPLETED" },
          orderBy: { assessmentVersion: "desc" },
        });
    if (!assessment) throw { status: 404, message: "Assessment not found" };
    if (assessment.userDecision !== "PENDING") {
      throw { status: 409, message: "This recommendation has already been reviewed" };
    }
    const reviewed = await prisma.cycleAssessment.update({
      where: { id: assessment.id },
      data: { userDecision, reviewedAt: new Date() },
    });
    // Awaited for the same reason as the create() in evaluateCycle — a
    // caller checking the audit trail right after accepting/rejecting must
    // see it reflected. Not every assessment necessarily has a matching
    // RecommendationAudit row (e.g. one created before this feature
    // existed), so this only updates if one is found rather than failing
    // the whole review action.
    try {
      await prisma.recommendationAudit.updateMany({
        where: { assessmentId: assessment.id, userAction: null },
        data: {
          userAction: userDecision === "ACCEPTED" ? "accepted" : "rejected",
          userActionAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, cycleId }, "[training-cycle] recommendation audit update failed");
    }
    return reviewed;
  },

  /** Read-only interaction log for a cycle's recommendations — see
   * docs/TRAINING_CYCLE_DECISION_ENGINE.md §4. Ownership enforced via
   * getCycle (404s if the cycle isn't the caller's). */
  async listRecommendationAudits(cycleId: string, userId: string) {
    await this.getCycle(cycleId, userId);
    return prisma.recommendationAudit.findMany({
      where: { cycleId },
      orderBy: { presentedAt: "desc" },
    });
  },
};
