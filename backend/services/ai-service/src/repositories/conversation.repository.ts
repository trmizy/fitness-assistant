import { PrismaClient, PlanStatus } from '../generated/prisma';
import type { PlanContent } from '../schemas/plan.schemas';

export { PlanStatus };
export const prisma = new PrismaClient();

// ── Conversation ──────────────────────────────────────────────────────────────

export type CreateConversationInput = {
  userId?: string;
  question: string;
  answer: string;
  modelUsed: string;
  responseTime: number;
  relevance?: string | null;
  relevanceExplanation?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
};

export const conversationRepository = {
  create(data: CreateConversationInput) {
    return prisma.conversation.create({ data });
  },

  findMany(where: { userId?: string }, limit = 10) {
    return prisma.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  updateFeedback(id: string, feedback: number) {
    return prisma.conversation.update({
      where: { id },
      data: { feedback, feedbackTimestamp: new Date() },
    });
  },

  count(where?: { feedback?: number }) {
    return prisma.conversation.count({ where });
  },

  // ── WorkoutPlan ─────────────────────────────────────────────────────────────

  createWorkoutPlan(data: {
    userId: string;
    name: string;
    description: string;
    goal: string;
    duration: number;
    daysPerWeek: number;
  }) {
    return prisma.workoutPlan.create({
      data: { ...data, plan: {}, status: PlanStatus.QUEUED, version: 1 },
    });
  },

  /** Store the BullMQ jobId on the plan record right after enqueueing. */
  updatePlanJob(planId: string, jobId: string) {
    return prisma.workoutPlan.update({
      where: { id: planId },
      data: { jobId },
    });
  },

  updatePlanStatus(planId: string, status: PlanStatus) {
    return prisma.workoutPlan.update({
      where: { id: planId },
      data: { status },
    });
  },

  updatePlanCompletion(planId: string, content: PlanContent) {
    return prisma.workoutPlan.update({
      where: { id: planId },
      data: {
        status: PlanStatus.COMPLETED,
        // PlanContent is a plain JS object — cast via unknown to satisfy Prisma's JsonValue
        plan: content as unknown as Parameters<
          (typeof prisma.workoutPlan)['update']
        >[0]['data']['plan'],
      },
    });
  },

  updatePlanFailed(planId: string, reason: string) {
    return prisma.workoutPlan.update({
      where: { id: planId },
      data: { status: PlanStatus.FAILED, failReason: reason },
    });
  },

  findPlansByUser(userId: string, status?: PlanStatus, limit = 10) {
    return prisma.workoutPlan.findMany({
      where: { userId, ...(status !== undefined ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  findPlanById(planId: string) {
    return prisma.workoutPlan.findUnique({ where: { id: planId } });
  },

  findPlanByJobId(jobId: string) {
    return prisma.workoutPlan.findFirst({ where: { jobId } });
  },

  /** Create a v2+ plan for the adjust flow. */
  createAdjustedPlan(data: {
    userId: string;
    originalPlanId: string;
    goal: string;
    duration: number;
    daysPerWeek: number;
    adjustments: string;
    version: number;
  }) {
    return prisma.workoutPlan.create({
      data: {
        userId: data.userId,
        name: `${data.goal} Plan (v${data.version})`,
        description: `Adjusted from plan ${data.originalPlanId}: ${data.adjustments}`,
        goal: data.goal,
        duration: data.duration,
        daysPerWeek: data.daysPerWeek,
        plan: {},
        status: PlanStatus.QUEUED,
        version: data.version,
      },
    });
  },
};
