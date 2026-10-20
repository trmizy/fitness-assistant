import { PrismaClient, PlanStatus } from "../generated/prisma";
import type { PlanContent } from "../schemas/plan.schemas";
import { runFenced, expectOneRowInWorker } from "../services/generation-lease-context";

export { PlanStatus };
export const prisma = new PrismaClient();

// ── Conversation ──────────────────────────────────────────────────────────────

export type CreateConversationInput = {
  structuredBlocks?: import("../generated/prisma").Prisma.InputJsonValue;
  userId?: string;
  sessionId?: string;
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
  clientRequestId?: string | null;
};

// ── Admin observability types ─────────────────────────────────────────────────

export type AdminRequestsFilter =
  | "all"
  | "fallback"
  | "slow"
  | "warnings"
  | "failed";

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

  /** The persisted turn of one deliberate user action (unique per user); null when none exists yet. */
  findByClientRequestId(userId: string, clientRequestId: string) {
    return prisma.conversation.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } } });
  },

  findMany(
    where: {
      userId?: string;
      sessionId?: string;
      usedFallback?: boolean;
      /** Excludes thumbs-downed turns (feedback === -1) so a rejected answer
       * isn't fed back into future context identically to an accepted one. */
      excludeThumbsDown?: boolean;
    },
    limit = 10,
  ) {
    const { excludeThumbsDown, ...rest } = where;
    return prisma.conversation.findMany({
      where: {
        ...rest,
        // `feedback: { not: -1 }` alone also excludes never-rated (NULL) rows
        // under Postgres NULL-comparison semantics — only unrated or
        // thumbs-up turns should stay in the history window.
        ...(excludeThumbsDown
          ? { OR: [{ feedback: null }, { feedback: { not: -1 } }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
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

  // ── Chat sessions ──────────────────────────────────────────────────────────

  createSession(data: { userId: string; title: string }) {
    return prisma.chatSession.create({
      data: { ...data, lastMessageAt: new Date() },
    });
  },

  findSessionById(sessionId: string) {
    return prisma.chatSession.findUnique({ where: { id: sessionId } });
  },

  /** Removes a session ONLY if it has no turn at all (the leftover of an attempt that lost a same-action race). Best effort, never throws. */
  async deleteSessionIfEmpty(sessionId: string): Promise<void> {
    try {
      const turns = await prisma.conversation.count({ where: { sessionId } });
      if (turns === 0) await prisma.chatSession.deleteMany({ where: { id: sessionId } });
    } catch {
      /* an orphan empty session is harmless */
    }
  },

  findSessionsByUser(userId: string, limit = 50) {
    return prisma.chatSession.findMany({
      where: { userId, archivedAt: null },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
    });
  },

  renameSession(sessionId: string, title: string) {
    return prisma.chatSession.update({
      where: { id: sessionId },
      data: { title },
    });
  },

  archiveSession(sessionId: string) {
    return prisma.chatSession.update({
      where: { id: sessionId },
      data: { archivedAt: new Date() },
    });
  },

  touchSessionLastMessage(sessionId: string) {
    return prisma.chatSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: new Date() },
    });
  },

  findSessionMessages(userId: string, sessionId: string, limit = 200) {
    return prisma.conversation.findMany({
      where: { userId, sessionId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  },

  // ── User memory (Phase 3: cross-session personalization) ───────────────────

  createUserMemory(data: { userId: string; content: string; category?: string }) {
    return prisma.userMemory.create({ data });
  },

  findMemoriesByUser(userId: string, limit = 20) {
    return prisma.userMemory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  findMemoryById(memoryId: string) {
    return prisma.userMemory.findUnique({ where: { id: memoryId } });
  },

  deleteUserMemory(memoryId: string) {
    return prisma.userMemory.delete({ where: { id: memoryId } });
  },

  /** Keeps only the newest `keepCount` memories for a user so the prompt block stays bounded. */
  async pruneOldestMemories(userId: string, keepCount = 20) {
    const excess = await prisma.userMemory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: keepCount,
      select: { id: true },
    });
    if (excess.length === 0) return;
    await prisma.userMemory.deleteMany({
      where: { id: { in: excess.map((m) => m.id) } },
    });
  },

  // ── Admin observability queries ───────────────────────────────────────────

  /**
   * Aggregate stats for the overview card: totals, averages, distributions.
   * Uses two raw queries (for AVG and distribution) plus standard count calls.
   */
  async adminGetOverviewStats() {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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
      prisma.conversation.count({
        where: { responseTime: { gt: 10 }, createdAt: { gte: since7d } },
      }),
      prisma.$queryRaw<Array<{ route_intent: string | null; cnt: bigint }>>`
        SELECT "route_intent", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "route_intent" IS NOT NULL
        GROUP BY "route_intent"
        ORDER BY cnt DESC
        LIMIT 10
      `,
      prisma.$queryRaw<
        Array<{ response_language: string | null; cnt: bigint }>
      >`
        SELECT "response_language", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "response_language" IS NOT NULL
        GROUP BY "response_language"
      `,
      prisma.workoutPlan.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const avgLatency = avgResult[0]?.avg ?? null;
    const p95Latency = avgResult[0]?.p95 ?? null;

    const intentDistribution = intentRows.map((r) => ({
      intent: r.route_intent ?? "unknown",
      count: Number(r.cnt),
    }));

    const languageDistribution = langRows.map((r) => ({
      language: r.response_language ?? "unknown",
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
        fallbackRate:
          total > 0 ? Number(((fallbackCount / total) * 100).toFixed(1)) : 0,
        deterministicFallbackRate:
          total > 0
            ? Number(((deterministicFallbackCount / total) * 100).toFixed(1))
            : 0,
        warningRate:
          total > 0 ? Number(((warningCount / total) * 100).toFixed(1)) : 0,
        avgLatencySeconds:
          avgLatency !== null ? Number(Number(avgLatency).toFixed(3)) : null,
        p95LatencySeconds:
          p95Latency !== null ? Number(Number(p95Latency).toFixed(3)) : null,
        slowCount,
      },
      intents: intentDistribution,
      languages: languageDistribution,
      plans: {
        queued: planStatusMap["QUEUED"] ?? 0,
        processing: planStatusMap["PROCESSING"] ?? 0,
        completed: planStatusMap["COMPLETED"] ?? 0,
        failed: planStatusMap["FAILED"] ?? 0,
      },
    };
  },

  /**
   * Paginated list of conversations for the admin request table.
   */
  async adminListRequests(query: AdminRequestsQuery) {
    const { filter = "all", intent, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter === "fallback") where.usedFallback = true;
    if (filter === "slow") where.responseTime = { gt: 10 };
    if (filter === "warnings") where.warningCount = { gt: 0 };
    if (intent) where.routeIntent = intent;

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
   * BR-34A: question, answer, userId excluded from admin response.
   */
  adminGetRequest(id: string) {
    return prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        question: true,
        answer: true,
        modelUsed: true,
        responseTime: true,
        responseLanguage: true,
        routeIntent: true,
        usedFallback: true,
        usedDeterministicFallback: true,
        warningCount: true,
        traceId: true,
        totalTokens: true,
        promptTokens: true,
        completionTokens: true,
        cost: true,
        feedback: true,
        feedbackTimestamp: true,
        relevance: true,
        relevanceExplanation: true,
        createdAt: true,
      },
    });
  },

  /** BR-34B: Delete all conversations + chat sessions + memories for a user (cascade on account deletion) */
  deleteByUserId: async (userId: string) => {
    await prisma.chatSession.deleteMany({ where: { userId } });
    await prisma.userMemory.deleteMany({ where: { userId } });
    return prisma.conversation.deleteMany({ where: { userId } });
  },

  /**
   * Recent workout plans for the queue panel.
   */
  async adminListPlans(limit = 30) {
    return prisma.workoutPlan.findMany({
      orderBy: { createdAt: "desc" },
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
        archivedAt: true,
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
        where: { status: PlanStatus.FAILED },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          userId: true,
          name: true,
          goal: true,
          failReason: true,
          updatedAt: true,
          jobId: true,
          version: true,
        },
      }),
      prisma.conversation.findMany({
        where: { warningCount: { gt: 0 }, createdAt: { gte: since7d } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          userId: true,
          question: true,
          routeIntent: true,
          warningCount: true,
          responseTime: true,
          createdAt: true,
          traceId: true,
        },
      }),
    ]);

    return { failedPlans, highWarnConversations };
  },

  // ── WorkoutPlan ─────────────────────────────────────────────────────────────

  createWorkoutPlan(data: {
    id?: string;
    jobId?: string;
    userId: string;
    name: string;
    description: string;
    goal: string;
    duration: number;
    daysPerWeek: number;
    ptUserId?: string | null;
    clientName?: string | null;
  }) {
    return prisma.workoutPlan.create({
      data: {
        ...data,
        plan: {},
        status: PlanStatus.QUEUED,
        version: 1,
        archivedAt: null,
      },
    });
  },

  /** Store the BullMQ jobId on the plan record right after enqueueing. */
  updatePlanJob(planId: string, jobId: string) {
    return prisma.workoutPlan.updateMany({
      where: { id: planId },
      data: { jobId },
    });
  },

  // The six worker-facing plan writers below run through runFenced: inside a claimed generation attempt each is ONE
  // short transaction that takes the operation row lock with the ownership predicate first (see
  // generation-lease-context.ts), so a stale attempt can neither pass a check and write later nor overwrite a newer
  // attempt's committed result. Outside a worker they behave exactly as before.
  updatePlanStatus(planId: string, status: PlanStatus) {
    return runFenced(prisma, planId, async (db) => {
      const r = await db.workoutPlan.updateMany({
        where: { id: planId },
        data: {
          status,
          ...(status !== PlanStatus.FAILED ? { failReason: null } : {}),
        },
      });
      expectOneRowInWorker(r.count, "workout status");
      return r;
    });
  },

  updatePlanCompletion(planId: string, content: PlanContent) {
    return runFenced(prisma, planId, async (db) => {
      // Read ptUserId first — worker reads from DB, not job data, to prevent job-data tampering.
      const existing = await db.workoutPlan.findUnique({
        where: { id: planId },
        select: { ptUserId: true },
      });
      return db.workoutPlan.update({
        where: { id: planId },
        data: {
          status: PlanStatus.COMPLETED,
          failReason: null,
          // PlanContent is a plain JS object — cast via unknown to satisfy Prisma's JsonValue
          plan: content as unknown as Parameters<
            (typeof prisma.workoutPlan)["update"]
          >[0]["data"]["plan"],
          ...(existing?.ptUserId ? { ptReviewStatus: "PENDING_PT_REVIEW" } : {}),
        },
      });
    });
  },

  updatePlanFailed(planId: string, reason: string) {
    return runFenced(prisma, planId, async (db) => {
      const r = await db.workoutPlan.updateMany({
        where: { id: planId },
        data: { status: PlanStatus.FAILED, failReason: reason },
      });
      expectOneRowInWorker(r.count, "workout failed");
      return r;
    });
  },

  findPlansByUser(userId: string, status?: PlanStatus, limit = 10) {
    return prisma.workoutPlan.findMany({
      where: {
        userId,
        ...(status !== undefined ? { status } : {}),
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  findPlansByUserIncludingArchived(
    userId: string,
    status?: PlanStatus,
    limit = 10,
  ) {
    return prisma.workoutPlan.findMany({
      where: { userId, ...(status !== undefined ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  findPlanById(planId: string) {
    return prisma.workoutPlan.findUnique({ where: { id: planId } });
  },

  archivePlan(planId: string) {
    return prisma.workoutPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
  },

  findPlanByJobId(jobId: string) {
    return prisma.workoutPlan.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
  },

  /** Create a v2+ plan for the adjust flow. */
  createAdjustedPlan(data: {
    id?: string;
    jobId?: string;
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
        ...(data.id ? { id: data.id } : {}),
        ...(data.jobId ? { jobId: data.jobId } : {}),
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

  // ── NutritionPlan ────────────────────────────────────────────────────────────

  createNutritionPlan(data: {
    id?: string;
    jobId?: string;
    userId: string;
    name: string;
    goal: string;
    durationWeeks: number;
    mealsPerDay: number;
  }) {
    return prisma.nutritionPlan.create({
      data: { ...data, plan: {}, status: PlanStatus.QUEUED },
    });
  },

  updateNutritionPlanJob(planId: string, jobId: string) {
    return prisma.nutritionPlan.updateMany({
      where: { id: planId },
      data: { jobId },
    });
  },

  updateNutritionPlanStatus(planId: string, status: PlanStatus) {
    return runFenced(prisma, planId, async (db) => {
      const r = await db.nutritionPlan.updateMany({
        where: { id: planId },
        data: { status },
      });
      expectOneRowInWorker(r.count, "nutrition status");
      return r;
    });
  },

  updateNutritionPlanCompletion(planId: string, content: unknown) {
    return runFenced(prisma, planId, (db) =>
      db.nutritionPlan.update({
        where: { id: planId },
        data: {
          status: PlanStatus.COMPLETED,
          plan: content as Parameters<
            (typeof prisma.nutritionPlan)["update"]
          >[0]["data"]["plan"],
        },
      }),
    );
  },

  updateNutritionPlanFailed(planId: string, reason: string) {
    return runFenced(prisma, planId, async (db) => {
      const r = await db.nutritionPlan.updateMany({
        where: { id: planId },
        data: { status: PlanStatus.FAILED, failReason: reason },
      });
      expectOneRowInWorker(r.count, "nutrition failed");
      return r;
    });
  },

  findNutritionPlansByUser(userId: string, status?: PlanStatus, limit = 10) {
    return prisma.nutritionPlan.findMany({
      where: {
        userId,
        ...(status !== undefined ? { status } : {}),
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  findNutritionPlanById(planId: string) {
    return prisma.nutritionPlan.findUnique({ where: { id: planId } });
  },

  archiveNutritionPlan(planId: string) {
    return prisma.nutritionPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
  },

  findNutritionPlanByJobId(jobId: string) {
    return prisma.nutritionPlan.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
  },
};
