import { prisma } from "../repositories/prisma";
import {
  fetchLatestInBodyOnOrBefore,
  fetchUserProfile,
} from "../clients/user.client";

const ADHERENCE_HIGH = 70;
const ADHERENCE_LOW = 40;
const ADHERENCE_ONLY_ACHIEVED = 80;
const ADHERENCE_ONLY_PARTIAL = 50;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

async function computeAdherence(
  userId: string,
  sourcePlanId: string | null,
  startDate: Date,
  endDate: Date,
) {
  const schedules = await prisma.workoutSchedule.findMany({
    where: {
      userId,
      ...(sourcePlanId ? { sourcePlanId } : {}),
      date: { gte: startOfDay(startDate), lte: endOfDay(endDate) },
    },
    select: { status: true },
  });
  const total = schedules.length;
  const completed = schedules.filter((s) => s.status === "COMPLETED").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percent };
}

type GoalTier = "full" | "partial" | "none" | "unknown";

function goalTierFromDelta(
  goal: string | null | undefined,
  weightDeltaKg: number | null,
  muscleMassDeltaKg: number | null,
): GoalTier {
  if (goal === "WEIGHT_LOSS") {
    if (weightDeltaKg == null) return "unknown";
    if (weightDeltaKg <= -0.5) return "full";
    if (weightDeltaKg <= 0) return "partial";
    return "none";
  }
  if (goal === "MUSCLE_GAIN") {
    if (muscleMassDeltaKg == null) return "unknown";
    if (muscleMassDeltaKg >= 0.3) return "full";
    if (muscleMassDeltaKg >= 0) return "partial";
    return "none";
  }
  if (goal === "MAINTENANCE") {
    if (weightDeltaKg == null) return "unknown";
    const abs = Math.abs(weightDeltaKg);
    if (abs <= 1.0) return "full";
    if (abs <= 2.0) return "partial";
    return "none";
  }
  // ATHLETIC_PERFORMANCE or unset — no reliable InBody signal for this goal type.
  return "unknown";
}

function classify(
  adherencePercent: number,
  goalTier: GoalTier,
): { outcome: string; reason: string } {
  if (goalTier === "unknown") {
    if (adherencePercent >= ADHERENCE_ONLY_ACHIEVED) {
      return {
        outcome: "ACHIEVED",
        reason: "InBody data insufficient — classified on adherence only",
      };
    }
    if (adherencePercent >= ADHERENCE_ONLY_PARTIAL) {
      return {
        outcome: "PARTIAL",
        reason: "InBody data insufficient — classified on adherence only",
      };
    }
    return {
      outcome: "NOT_ACHIEVED",
      reason: "InBody data insufficient — classified on adherence only",
    };
  }

  if (goalTier === "full" && adherencePercent >= ADHERENCE_HIGH) {
    return {
      outcome: "ACHIEVED",
      reason: `Adherence ${adherencePercent}% and body metrics moved toward goal`,
    };
  }
  if (
    (goalTier === "full" || goalTier === "partial") &&
    adherencePercent >= ADHERENCE_LOW
  ) {
    return {
      outcome: "PARTIAL",
      reason: `Adherence ${adherencePercent}%, body metrics moved partially toward goal`,
    };
  }
  return {
    outcome: "NOT_ACHIEVED",
    reason: `Adherence ${adherencePercent}%, body metrics did not move toward goal`,
  };
}

export const trainingCycleService = {
  async startCycle(
    userId: string,
    sourcePlanId?: string | null,
    startDate?: string,
  ) {
    const existing = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (existing) {
      throw {
        status: 409,
        message: "An active training cycle already exists",
      };
    }

    const start = startDate ? new Date(startDate) : new Date();
    if (Number.isNaN(start.getTime())) {
      throw { status: 400, message: "startDate must be a valid date" };
    }

    const [profile, startInBody] = await Promise.all([
      fetchUserProfile(userId),
      fetchLatestInBodyOnOrBefore(userId, start),
    ]);

    return prisma.trainingCycle.create({
      data: {
        userId,
        sourcePlanId: sourcePlanId ?? null,
        startDate: start,
        status: "ACTIVE",
        goalAtStart: profile?.goal ?? null,
        targetWeightAtStart: profile?.targetWeight ?? null,
        startWeightKg: startInBody?.weight ?? null,
        startBodyFatPct: startInBody?.bodyFatPct ?? null,
        startMuscleMassKg: startInBody?.muscleMass ?? null,
        startInBodyDate: startInBody ? new Date(startInBody.date) : null,
      },
    });
  },

  async getCurrentCycle(userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    if (!cycle) {
      throw { status: 404, message: "No active training cycle" };
    }

    const windowEnd = cycle.endDate ?? new Date();
    const adherence = await computeAdherence(
      userId,
      cycle.sourcePlanId,
      cycle.startDate,
      windowEnd,
    );

    return { cycle, adherencePreview: adherence };
  },

  async closeCycle(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({
      where: { id: cycleId, userId },
    });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    if (cycle.status !== "ACTIVE") {
      throw { status: 409, message: "Training cycle is already closed" };
    }

    const endDate = new Date();
    const endInBody = await fetchLatestInBodyOnOrBefore(userId, endDate);

    const adherence = await computeAdherence(
      userId,
      cycle.sourcePlanId,
      cycle.startDate,
      endDate,
    );

    const weightDeltaKg =
      endInBody?.weight != null && cycle.startWeightKg != null
        ? endInBody.weight - cycle.startWeightKg
        : null;
    const muscleMassDeltaKg =
      endInBody?.muscleMass != null && cycle.startMuscleMassKg != null
        ? endInBody.muscleMass - cycle.startMuscleMassKg
        : null;

    const goalTier = goalTierFromDelta(
      cycle.goalAtStart,
      weightDeltaKg,
      muscleMassDeltaKg,
    );
    const { outcome, reason } = classify(adherence.percent, goalTier);

    return prisma.trainingCycle.update({
      where: { id: cycleId },
      data: {
        status: "CLOSED",
        endDate,
        adherencePercent: adherence.percent,
        endWeightKg: endInBody?.weight ?? null,
        endBodyFatPct: endInBody?.bodyFatPct ?? null,
        endMuscleMassKg: endInBody?.muscleMass ?? null,
        endInBodyDate: endInBody ? new Date(endInBody.date) : null,
        outcome,
        outcomeReason: reason,
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
};

// Exported for tests only.
export const __internal = { computeAdherence, goalTierFromDelta, classify };
