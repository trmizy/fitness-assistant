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
import { classifyProgress, type ProgressSignals } from "./training-cycle-classification.service";
import { computeCycleMetrics } from "./cycle-metrics.engine";
import { evaluateCycle as runDecisionEngine, type CycleDecision, type ActionScope } from "./cycle-decision.engine";
import type { CreateTrainingCycleInput, UpdateTrainingCycleInput } from "../models/training-cycle.models";

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
    computeWorkoutMetrics(userId, startDate, asOf),
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
  ) {
    const requestedStatus = extra?.status ?? "ACTIVE";

    if (requestedStatus === "ACTIVE") {
      const existing = await prisma.trainingCycle.findFirst({
        where: { userId, status: "ACTIVE" },
      });
      if (existing) {
        throw { status: 409, message: "An active training cycle already exists" };
      }
    }

    const start = startDate ? new Date(startDate) : new Date();
    if (Number.isNaN(start.getTime())) {
      throw { status: 400, message: "startDate must be a valid date" };
    }
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

    return prisma.trainingCycle.create({
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
      },
    });
  },

  /** DRAFT -> ACTIVE transition — sets startDate/endDate/startInbodyId at
   * the moment of activation (not at creation time), since a DRAFT cycle
   * may sit unstarted for a while. */
  async startDraftCycle(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "DRAFT") {
      throw { status: 409, message: "Only a DRAFT cycle can be started" };
    }
    const existingActive = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (existingActive) {
      throw { status: 409, message: "An active training cycle already exists" };
    }

    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + cycle.durationDays);
    const startInBody = await fetchLatestInBodyOnOrBefore(userId, start);

    return prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "ACTIVE",
        startDate: start,
        endDate: end,
        startInbodyId: startInBody?.id ?? null,
      },
    });
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

  /** Rolling metrics for the ACTIVE cycle, computed fresh (not the cached final summary). */
  async getActiveCycle(userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    if (!cycle) throw { status: 404, message: "No active training cycle" };

    const summary = await buildRollingSummary(
      userId,
      cycle.planId,
      cycle.startDate,
      new Date(),
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
  async completeCycle(cycleId: string, userId: string, endInbodyId?: string) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { id: cycleId, userId },
    });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "ACTIVE") {
      throw { status: 409, message: "Training cycle is already completed" };
    }

    const now = new Date();
    let endInBody = endInbodyId ? await fetchInBodyById(userId, endInbodyId) : null;
    let lowConfidence = false;
    if (!endInBody) {
      endInBody = await fetchLatestInBodyOnOrBefore(userId, now);
      lowConfidence = true; // completed without a fresh, explicitly-chosen end measurement
    }

    const rolling = await buildRollingSummary(userId, cycle.planId, cycle.startDate, now, cycle.goal);
    const startInBody = cycle.startInbodyId
      ? await fetchInBodyById(userId, cycle.startInbodyId)
      : null;

    const progressSignals: ProgressSignals = classifyProgress({
      goal: cycle.goal,
      startInBody,
      endInBody,
      volumeByWeek: rolling.volumeByWeek,
      volumeChangePct: rolling.volumeChangePct,
      newPRs: rolling.newPRs,
      adherence: rolling.adherence,
      rpeTrend: rolling.rpeTrend,
      e1rmTrend: rolling.e1rmTrend,
    });

    const finalSummary = {
      ...rolling,
      progressSignals,
      closedAt: now.toISOString(),
    };

    const updated = await prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "COMPLETED",
        endDate: now,
        endInbodyId: endInBody?.id ?? null,
        lowConfidence,
        summary: finalSummary as any,
      },
    });

    // Fire-and-forget: do not await, the HTTP response returns immediately
    // with status=COMPLETED. UI shows "đang phân tích" until this resolves.
    void this.runAnalysis(updated.id, userId, updated, startInBody, endInBody, progressSignals).catch(() => {});

    return updated;
  },

  /** Calls ai-service, then persists the decision. Exported for the fire-and-forget call above. */
  async runAnalysis(
    cycleId: string,
    userId: string,
    cycle: { cycleIndex: number; goal: string | null; startDate: Date; endDate: Date; durationDays: number; lowConfidence: boolean; planId: string | null },
    startInBody: Awaited<ReturnType<typeof fetchInBodyById>>,
    endInBody: Awaited<ReturnType<typeof fetchInBodyById>>,
    progressSignals: ProgressSignals,
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
      where: { userId },
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
  async getCycleProgress(cycleId: string, userId: string) {
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
      asOf: new Date(),
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
      const cycleDurationDays = Math.max(
        1,
        Math.ceil((new Date().getTime() - cycle.startDate.getTime()) / 86_400_000),
      );
      const priorityExercises = ((cycle.configuration as any)?.priorityExercises ?? []) as string[];
      const inBodyEntries = await this.collectCycleInBodyEntries(cycleId, userId, cycle);

      const metrics = await computeCycleMetrics({
        cycleId,
        userId,
        planId: cycle.planId,
        goal: cycle.goal,
        startDate: cycle.startDate,
        asOf: new Date(),
        inBodyEntries,
        priorityExercises,
      });

      const priorCycleDecisions = await this.getPriorCycleDecisions(userId, cycleId);

      const engineResult = runDecisionEngine({
        cycleDurationDays,
        completedSessions,
        metrics,
        priorCycleDecisions,
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
          endDate: cycle.endDate,
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
    return prisma.cycleAssessment.update({
      where: { id: assessment.id },
      data: { userDecision, reviewedAt: new Date() },
    });
  },
};
