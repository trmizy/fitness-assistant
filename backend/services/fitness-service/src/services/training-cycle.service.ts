import { prisma } from "../repositories/prisma";
import {
  fetchInBodySeries,
  fetchInBodyById,
  fetchLatestInBodyOnOrBefore,
  fetchUserProfile,
} from "../clients/user.client";
import { analyzeCycleSafe } from "../clients/ai.client";
import {
  computeAdherence,
  computeWorkoutMetrics,
  computeNewPRs,
} from "./training-cycle-metrics.service";
import { evaluateAlerts, type CycleAlert } from "./training-cycle-alerts.service";
import { classifyProgress, type ProgressSignals } from "./training-cycle-classification.service";

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
  async startCycle(
    userId: string,
    planId: string | null,
    startDate?: string,
    durationDays = 30,
  ) {
    const existing = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (existing) {
      throw { status: 409, message: "An active training cycle already exists" };
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
        status: "ACTIVE",
        startInbodyId: startInBody?.id ?? null,
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
};
