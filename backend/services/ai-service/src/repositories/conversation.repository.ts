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
  // ── Observability fields ──────────────────────────────────────────────────
  traceId?: string;
  usedFallback?: boolean;
  usedDeterministicFallback?: boolean;
  responseLanguage?: string;
  routeIntent?: string;
  warningCount?: number;
};

// ── Admin observability types ─────────────────────────────────────────────────

export type AdminRequestsFilter = 'all' | 'fallback' | 'slow' | 'warnings' | 'failed';

export type AdminRequestsQuery = {
  filter?: AdminRequestsFilter;
  intent?: string;
  page?: number;
  limit?: number;
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

  // ── Admin observability queries ───────────────────────────────────────────

  /**
   * Aggregate stats for the overview card: totals, averages, distributions.
   * Uses two raw queries (for AVG and distribution) plus standard count calls.
   */
  async adminGetOverviewStats() {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

    const [
      total,
      total24h,
      fallbackCount,
      deterministicFallbackCount,
      warningCount,
      avgResult,
      slowCount,
      intentRows,
      langRows,
      planStats,
    ] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { createdAt: { gte: since24h } } }),
      prisma.conversation.count({ where: { usedFallback: true } }),
      prisma.conversation.count({ where: { usedDeterministicFallback: true } }),
      prisma.conversation.count({ where: { warningCount: { gt: 0 } } }),
      prisma.$queryRaw<Array<{ avg: number | null; p95: number | null }>>`
        SELECT
          AVG("response_time")                                                                   AS avg,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "response_time")                         AS p95
        FROM "conversations"
        WHERE "created_at" >= ${since7d}
      `,
      prisma.conversation.count({ where: { responseTime: { gt: 10 }, createdAt: { gte: since7d } } }),
      prisma.$queryRaw<Array<{ route_intent: string | null; cnt: bigint }>>`
        SELECT "route_intent", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "route_intent" IS NOT NULL
        GROUP BY "route_intent"
        ORDER BY cnt DESC
        LIMIT 10
      `,
      prisma.$queryRaw<Array<{ response_language: string | null; cnt: bigint }>>`
        SELECT "response_language", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "response_language" IS NOT NULL
        GROUP BY "response_language"
      `,
      prisma.workoutPlan.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const avgLatency = avgResult[0]?.avg ?? null;
    const p95Latency = avgResult[0]?.p95 ?? null;

    const intentDistribution = intentRows.map((r) => ({
      intent: r.route_intent ?? 'unknown',
      count: Number(r.cnt),
    }));

    const languageDistribution = langRows.map((r) => ({
      language: r.response_language ?? 'unknown',
      count: Number(r.cnt),
    }));

    const planStatusMap: Record<string, number> = {};
    for (const row of planStats) {
      planStatusMap[row.status] = row._count._all;
    }

    return {
      conversations: {
        total,
        last24h: total24h,
        fallbackRate: total > 0 ? Number(((fallbackCount / total) * 100).toFixed(1)) : 0,
        deterministicFallbackRate: total > 0 ? Number(((deterministicFallbackCount / total) * 100).toFixed(1)) : 0,
        warningRate: total > 0 ? Number(((warningCount / total) * 100).toFixed(1)) : 0,
        avgLatencySeconds: avgLatency !== null ? Number(Number(avgLatency).toFixed(3)) : null,
        p95LatencySeconds: p95Latency !== null ? Number(Number(p95Latency).toFixed(3)) : null,
        slowCount,
      },
      intents: intentDistribution,
      languages: languageDistribution,
      plans: {
        queued:     planStatusMap['QUEUED']     ?? 0,
        processing: planStatusMap['PROCESSING'] ?? 0,
        completed:  planStatusMap['COMPLETED']  ?? 0,
        failed:     planStatusMap['FAILED']     ?? 0,
      },
    };
  },

  /**
   * Paginated list of conversations for the admin request table.
   */
  async adminListRequests(query: AdminRequestsQuery) {
    const { filter = 'all', intent, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Parameters<typeof prisma.conversation.findMany>[0]['where'] = {};
    if (filter === 'fallback') where.usedFallback = true;
    if (filter === 'slow')     where.responseTime = { gt: 10 };
    if (filter === 'warnings') where.warningCount = { gt: 0 };
    if (intent)                where.routeIntent = intent;

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          question: true,
          modelUsed: true,
          responseTime: true,
          responseLanguage: true,
          routeIntent: true,
          usedFallback: true,
          usedDeterministicFallback: true,
          warningCount: true,
          traceId: true,
          totalTokens: true,
          feedback: true,
          relevance: true,
          createdAt: true,
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  },

  /**
   * Full conversation detail for the trace drawer.
   */
  adminGetRequest(id: string) {
    return prisma.conversation.findUnique({ where: { id } });
  },

  /**
   * Recent workout plans for the queue panel.
   */
  async adminListPlans(limit = 30) {
    return prisma.workoutPlan.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        name: true,
        goal: true,
        status: true,
        version: true,
        jobId: true,
        failReason: true,
        createdAt: true,
        updatedAt: true,
        duration: true,
        daysPerWeek: true,
      },
    });
  },

  /**
   * Recent failures: failed plans + high-warning conversations.
   */
  async adminGetErrors() {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [failedPlans, highWarnConversations] = await Promise.all([
      prisma.workoutPlan.findMany({
        where:     { status: PlanStatus.FAILED },
        orderBy:   { updatedAt: 'desc' },
        take:      20,
        select:    { id: true, userId: true, name: true, goal: true, failReason: true, updatedAt: true, jobId: true, version: true },
      }),
      prisma.conversation.findMany({
        where:     { warningCount: { gt: 0 }, createdAt: { gte: since7d } },
        orderBy:   { createdAt: 'desc' },
        take:      20,
        select:    { id: true, userId: true, question: true, routeIntent: true, warningCount: true, responseTime: true, createdAt: true, traceId: true },
      }),
    ]);

    return { failedPlans, highWarnConversations };
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
