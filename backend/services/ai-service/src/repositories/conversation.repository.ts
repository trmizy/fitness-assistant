import { PrismaClient, PlanStatus, Prisma } from "../generated/prisma";
import type { PlanContent } from "../schemas/plan.schemas";
import { runFenced, expectOneRowInWorker } from "../services/generation-lease-context";

export { PlanStatus };
export const prisma = new PrismaClient();

/**
 * Adjustment revision marker (no schema change — lives in the plan JSON): `plan._metadata.revision.previousPlanId` is the
 * plan this row is an adjusted version of. Present on the in-flight draft, the completed plan and (after a failure) the
 * hidden failed draft.
 */
export function readRevisionPreviousPlanId(plan: unknown): string | null {
  const id = (plan as { _metadata?: { revision?: { previousPlanId?: unknown } } } | null | undefined)?._metadata?.revision?.previousPlanId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Outcome of applying (or reverting) an in-place revision. Nothing is written for any outcome except "applied". */
export type PlanRevisionOutcome =
  | { kind: "applied"; resultVersion: number }
  | { kind: "already_applied"; resultVersion: number }
  | { kind: "version_conflict"; currentVersion: number | null }
  | { kind: "plan_missing" }
  | { kind: "plan_archived" }
  | { kind: "plan_not_ready" }
  | { kind: "plan_published" };

/** Run `fn` atomically: inside a worker's fenced transaction `db` is already one; otherwise open one. */
async function atomically<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  return typeof db.$transaction === "function" ? db.$transaction(fn) : fn(db);
}

// The PT's legacy review (status, note, time) is part of what a revision replaces: it is kept in the history row so it is never lost.
const planSnapshot = (p: { name: string; description: string | null; goal: string; duration: number; daysPerWeek: number; plan: unknown; ptUserId?: string | null; ptReviewStatus?: unknown; ptNote?: string | null; ptReviewedAt?: Date | null }) => ({
  name: p.name, description: p.description, goal: p.goal, duration: p.duration, daysPerWeek: p.daysPerWeek, plan: p.plan,
  ptUserId: p.ptUserId ?? null, ptReviewStatus: (p.ptReviewStatus as string | null | undefined) ?? null, ptNote: p.ptNote ?? null, ptReviewedAt: p.ptReviewedAt ?? null,
});

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
   * Raw SQL only (counts, AVG/p95, distributions, plan statuses): the test-account exclusion list can be tens of thousands
   * of ids and must reach Postgres as one array parameter, never one bind variable per id.
   */
  async adminGetOverviewStats(excludeUserIds: string[] | null = null) {
    const now = new Date();
    // Test/seed/eval accounts left out on the server (2026-11-08). Anonymous rows (user_id NULL) are kept.
    const ex = excludeUserIds ?? [];
    // The exclusion list can hold tens of thousands of ids (seed-scale data). Prisma's `notIn` binds ONE variable per id and
    // Postgres caps a statement at 32767, so every query in this function is raw SQL where the whole list is a single
    // text[] parameter (`= ANY($n)`). Do not reintroduce `notIn: ex` here (GET /admin/ai/overview returned 500, 2026-11-27).
    const rawNot = ex.length ? Prisma.sql` AND ("user_id" IS NULL OR NOT ("user_id" = ANY(${ex})))` : Prisma.empty;
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [countRows, avgResult, intentRows, langRows, planStats] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          total: bigint;
          last24h: bigint;
          fallback: bigint;
          deterministic_fallback: bigint;
          warning: bigint;
          slow: bigint;
        }>
      >`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE "created_at" >= ${since24h})                         AS last24h,
          COUNT(*) FILTER (WHERE "used_fallback" = true)                              AS fallback,
          COUNT(*) FILTER (WHERE "used_deterministic_fallback" = true)                AS deterministic_fallback,
          COUNT(*) FILTER (WHERE "warning_count" > 0)                                 AS warning,
          COUNT(*) FILTER (WHERE "response_time" > 10 AND "created_at" >= ${since7d}) AS slow
        FROM "conversations"
        WHERE TRUE${rawNot}
      `,
      prisma.$queryRaw<Array<{ avg: number | null; p95: number | null }>>`
        SELECT
          AVG("response_time")                                                                   AS avg,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "response_time")                         AS p95
        FROM "conversations"
        WHERE "created_at" >= ${since7d}${rawNot}
      `,
      prisma.$queryRaw<Array<{ route_intent: string | null; cnt: bigint }>>`
        SELECT "route_intent", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "route_intent" IS NOT NULL${rawNot}
        GROUP BY "route_intent"
        ORDER BY cnt DESC
        LIMIT 10
      `,
      prisma.$queryRaw<
        Array<{ response_language: string | null; cnt: bigint }>
      >`
        SELECT "response_language", COUNT(*) AS cnt
        FROM "conversations"
        WHERE "created_at" >= ${since7d} AND "response_language" IS NOT NULL${rawNot}
        GROUP BY "response_language"
      `,
      prisma.$queryRaw<Array<{ status: string; cnt: bigint }>>`
        SELECT "status"::text AS status, COUNT(*) AS cnt
        FROM "workout_plans"
        WHERE TRUE${rawNot}
        GROUP BY "status"
      `,
    ]);

    const counts = countRows[0];
    const total = Number(counts?.total ?? 0);
    const total24h = Number(counts?.last24h ?? 0);
    const fallbackCount = Number(counts?.fallback ?? 0);
    const deterministicFallbackCount = Number(counts?.deterministic_fallback ?? 0);
    const warningCount = Number(counts?.warning ?? 0);
    const slowCount = Number(counts?.slow ?? 0);

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
      planStatusMap[row.status] = Number(row.cnt);
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
      /** test accounts left out (null = no filter: local stack, or auth-service unreadable) */
      excludedTestAccounts: excludeUserIds ? excludeUserIds.length : null,
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
        select: { ptUserId: true, userId: true, plan: true },
      });
      // An adjustment draft carries its revision marker through to the final content and replaces the plan it adjusted.
      const previousId = readRevisionPreviousPlanId(existing?.plan);
      if (previousId) {
        const meta = ((content as any)._metadata ??= {});
        meta.revision = {
          ...(((existing?.plan as any)?._metadata?.revision) ?? {}),
          previousPlanId: previousId,
          adjustedAt: new Date().toISOString(),
        };
      }
      const updated = await db.workoutPlan.update({
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
      if (previousId && existing?.userId) {
        // Same transaction as the completion; idempotent on retry. The previous plan is archived (restorable), not deleted.
        await db.workoutPlan.updateMany({
          where: { id: previousId, userId: existing.userId, archivedAt: null },
          data: { archivedAt: new Date() },
        });
      }
      return updated;
    });
  },

  updatePlanFailed(planId: string, reason: string) {
    return runFenced(prisma, planId, async (db) => {
      // A failed adjustment draft must not litter the list as a "failed plan": hide it, the previous plan is untouched.
      const existing = await db.workoutPlan.findUnique({ where: { id: planId }, select: { plan: true } });
      const isAdjustmentDraft = Boolean(readRevisionPreviousPlanId(existing?.plan));
      const r = await db.workoutPlan.updateMany({
        where: { id: planId },
        data: {
          status: PlanStatus.FAILED,
          failReason: reason,
          ...(isAdjustmentDraft ? { archivedAt: new Date() } : {}),
        },
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
    /** The adjusted plan keeps the name the user already knows (no "(v2)" suffix, no raw goal enum). */
    name?: string;
  }) {
    return prisma.workoutPlan.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        ...(data.jobId ? { jobId: data.jobId } : {}),
        userId: data.userId,
        name: data.name?.trim() || `${data.goal} Plan`,
        description: `Đã điều chỉnh theo yêu cầu: ${String(data.adjustments ?? "").slice(0, 300)}`,
        goal: data.goal,
        duration: data.duration,
        daysPerWeek: data.daysPerWeek,
        // Revision marker: this row is a DRAFT of `previousPlanId`. On success it replaces that plan (which is archived, and
        // can be restored via revertToPreviousVersion); on failure it archives itself and the previous plan stays untouched.
        plan: {
          _metadata: {
            revision: {
              previousPlanId: data.originalPlanId,
              adjustments: String(data.adjustments ?? "").slice(0, 300),
            },
          },
        },
        status: PlanStatus.QUEUED,
        version: data.version,
      },
    });
  },

  /**
   * Apply an AI revision IN PLACE: the WorkoutPlan keeps its id; version goes baseVersion -> baseVersion+1 exactly once.
   * Atomic (one transaction; inside a worker it is the lease-fenced one) and optimistic: the write only happens while the plan is
   * still COMPLETED, not archived and still at `expectedVersion`; anything else returns an outcome and writes NOTHING.
   * Idempotent per operation: workout_plan_revisions.operation_id is UNIQUE, so a retry/redelivery of the same operation
   * reports "already_applied" and never applies or records a second revision.
   * A previously recorded legacy PT review (ptReviewStatus) is reset: an approval never carries over to new content.
   */
  async commitPlanRevision(input: {
    planId: string;
    userId: string;
    operationId: string | null;
    expectedVersion: number;
    content: unknown;
    daysPerWeek: number;
    adjustments?: string | null;
    kind?: "ADJUST" | "REVERT";
  }): Promise<PlanRevisionOutcome> {
    const run = () => runFenced(prisma, input.planId, (db) => atomically(db, async (tx): Promise<PlanRevisionOutcome> => {
      if (input.operationId) {
        const done = await tx.workoutPlanRevision.findUnique({ where: { operationId: input.operationId } });
        if (done) return { kind: "already_applied", resultVersion: done.resultVersion };
      }
      const plan = await tx.workoutPlan.findUnique({ where: { id: input.planId } });
      if (!plan || plan.userId !== input.userId) return { kind: "plan_missing" };
      if (plan.archivedAt) return { kind: "plan_archived" };
      if (plan.status !== PlanStatus.COMPLETED) return { kind: "plan_not_ready" };
      if (plan.version !== input.expectedVersion) return { kind: "version_conflict", currentVersion: plan.version };
      // A plan with a SUBMITTED/APPROVED marketplace listing is a moderated product whose buyers read THIS row's content live: never edit it in place.
      if (await tx.publishedPlan.count({ where: { sourcePlanId: plan.id, moderationStatus: { in: ["SUBMITTED", "APPROVED"] } } })) return { kind: "plan_published" };
      const content: any = input.content;
      // `revision.previousPlanId` is the flag existing clients (web: the "Quay lại bản trước" button) read; in an in-place revision the plan is its own predecessor.
      content._metadata = { ...(content._metadata ?? {}), revision: { previousPlanId: plan.id, inPlace: true, adjustedAt: new Date().toISOString() }, lastRevision: { operationId: input.operationId, baseVersion: plan.version, resultVersion: plan.version + 1, at: new Date().toISOString() } };
      const updated = await tx.workoutPlan.updateMany({
        where: { id: plan.id, version: plan.version, status: PlanStatus.COMPLETED, archivedAt: null },
        data: {
          plan: content as Prisma.InputJsonValue,
          daysPerWeek: input.daysPerWeek,
          version: { increment: 1 },
          ...(plan.ptUserId ? { ptReviewStatus: null, ptNote: null, ptReviewedAt: null } : {}),
        },
      });
      if (updated.count !== 1) return { kind: "version_conflict", currentVersion: null };
      await tx.workoutPlanRevision.create({
        data: {
          planId: plan.id, userId: plan.userId, operationId: input.operationId, kind: input.kind ?? "ADJUST",
          baseVersion: plan.version, resultVersion: plan.version + 1,
          adjustments: input.adjustments ? String(input.adjustments).slice(0, 500) : null,
          previous: planSnapshot(plan) as unknown as Prisma.InputJsonValue,
        },
      });
      return { kind: "applied", resultVersion: plan.version + 1 };
    }));
    try {
      return await run();
    } catch (err) {
      // Two deliveries of the SAME operation racing: the loser hits the operation_id / (plan, version) UNIQUE index.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.operationId) {
        const done = await prisma.workoutPlanRevision.findUnique({ where: { operationId: input.operationId } });
        if (done) return { kind: "already_applied", resultVersion: done.resultVersion };
        return { kind: "version_conflict", currentVersion: null };
      }
      throw err;
    }
  },

  /** Marketplace listings (SUBMITTED/APPROVED) that read this plan's content live. */
  countActiveListings(planId: string) {
    return prisma.publishedPlan.count({ where: { sourcePlanId: planId, moderationStatus: { in: ["SUBMITTED", "APPROVED"] } } });
  },

  /** Was this operation's revision committed? (the durable "success" fact for a revision job) */
  findRevisionByOperation(operationId: string) {
    return prisma.workoutPlanRevision.findUnique({ where: { operationId } });
  },

  /** Revision history of a plan the caller owns, newest first (content snapshots are not returned here). */
  async listPlanRevisions(planId: string, userId: string, take = 50) {
    const rows = await prisma.workoutPlanRevision.findMany({
      where: { planId, userId },
      orderBy: { resultVersion: "desc" },
      take,
      select: { id: true, kind: true, baseVersion: true, resultVersion: true, adjustments: true, operationId: true, createdAt: true, previous: true },
    });
    // The PT review that applied to the REPLACED version (baseVersion) — history only, never an approval of the newer content.
    return rows.map(({ previous, ...r }) => {
      const prev = (previous ?? {}) as { ptUserId?: string | null; ptReviewStatus?: string | null; ptNote?: string | null; ptReviewedAt?: string | null };
      const ptReview = prev.ptReviewStatus || prev.ptNote
        ? { version: r.baseVersion, ptUserId: prev.ptUserId ?? null, status: prev.ptReviewStatus ?? null, note: prev.ptNote ?? null, reviewedAt: prev.ptReviewedAt ?? null }
        : null;
      return { ...r, ptReview };
    });
  },

  /**
   * Undo the latest applied revision IN PLACE: the plan returns to the content it had before, but the version still moves FORWARD
   * (monotonic — an old version number is never reused), and the undo is itself recorded as a REVERT revision.
   */
  async revertPlanRevisionInPlace(planId: string, userId: string, expectedVersion?: number): Promise<
    | { kind: "ok"; resultVersion: number }
    | { kind: "not_found" }
    | { kind: "no_previous" }
    | { kind: "plan_published" }
    | { kind: "version_conflict"; currentVersion: number }
  > {
    return atomically(prisma, async (tx) => {
      const plan = await tx.workoutPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.userId !== userId) return { kind: "not_found" } as const;
      if (expectedVersion !== undefined && plan.version !== expectedVersion) return { kind: "version_conflict", currentVersion: plan.version } as const;
      const last = await tx.workoutPlanRevision.findUnique({ where: { planId_resultVersion: { planId, resultVersion: plan.version } } });
      // Undo undoes an ADJUSTMENT. The latest history row being a REVERT means the undo already happened (client retry / double click): doing it again
      // would silently bring the adjusted content back (independent review R2).
      if (!last || last.kind === "REVERT") return { kind: "no_previous" } as const;
      // Same rule as commitPlanRevision: buyers of a SUBMITTED/APPROVED listing read this row live, so it is never rewritten in place (review R1).
      if (await tx.publishedPlan.count({ where: { sourcePlanId: plan.id, moderationStatus: { in: ["SUBMITTED", "APPROVED"] } } })) return { kind: "plan_published" } as const;
      const prev: any = last.previous;
      const updated = await tx.workoutPlan.updateMany({
        where: { id: planId, version: plan.version, archivedAt: null },
        data: {
          name: prev.name, description: prev.description ?? null, goal: prev.goal, duration: prev.duration, daysPerWeek: prev.daysPerWeek,
          plan: prev.plan as Prisma.InputJsonValue, version: { increment: 1 },
          ...(plan.ptUserId ? { ptReviewStatus: null, ptNote: null, ptReviewedAt: null } : {}),
        },
      });
      if (updated.count !== 1) return { kind: "version_conflict", currentVersion: plan.version } as const;
      await tx.workoutPlanRevision.create({
        data: { planId, userId, operationId: null, kind: "REVERT", baseVersion: plan.version, resultVersion: plan.version + 1, adjustments: null, previous: planSnapshot(plan) as unknown as Prisma.InputJsonValue },
      });
      return { kind: "ok", resultVersion: plan.version + 1 } as const;
    });
  },

  /** Undo an adjustment: restore the plan that the given (adjusted) plan replaced and archive the adjusted one. */
  async revertToPreviousVersion(
    planId: string,
    userId: string,
  ): Promise<
    | { kind: "ok"; restoredPlanId: string }
    | { kind: "not_found" }
    | { kind: "no_previous" }
  > {
    return prisma.$transaction(async (db) => {
      const current = await db.workoutPlan.findUnique({ where: { id: planId } });
      if (!current || current.userId !== userId) return { kind: "not_found" } as const;
      const previousId = readRevisionPreviousPlanId(current.plan);
      if (!previousId || previousId === planId) return { kind: "no_previous" } as const; // in-place revisions have their own undo
      const previous = await db.workoutPlan.findUnique({ where: { id: previousId } });
      if (!previous || previous.userId !== userId || previous.status !== PlanStatus.COMPLETED) {
        return { kind: "no_previous" } as const;
      }
      await db.workoutPlan.update({ where: { id: previousId }, data: { archivedAt: null } });
      await db.workoutPlan.update({ where: { id: planId }, data: { archivedAt: new Date() } });
      return { kind: "ok", restoredPlanId: previousId } as const;
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
