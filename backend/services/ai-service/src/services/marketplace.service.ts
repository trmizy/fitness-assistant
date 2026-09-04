import { randomUUID } from "crypto";
import axios from "axios";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { PlanStatus } from "../generated/prisma";
import { ApiError } from "../errors/api-error";
import { hasCompletedCycleForPlan, validateMarketplaceSchedulesMappable } from "../clients/fitness.client";
import { paymentClient } from "../clients/payment.client";
import { computePlanQualityScore, type PlanReviewLike } from "./plan-quality-scorer";
import { planImprovementService } from "./plan-improvement.service";
import { analyzePlanContent, type PlanContentLike } from "./plan-content-analyzer";
import { findSimilarPlans, type SimilarityCandidate } from "./plan-similarity";
import { planModerationAnalysisService } from "./plan-moderation-analysis.service";
import { fetchPtMarketplaceEligibility, fetchUserGoalAndLevel } from "../clients/user.client";

/** Indirection point for tests — same rationale as fitness-service's
 * coachDeps (coach.service.ts): a bare named-import binding can't be
 * reassigned from a test (ESM namespace properties are getter-only), so
 * this plain mutable object exists specifically so marketplace-phase8
 * .integration.test.ts can stub the cross-service eligibility check. */
export const marketplaceDeps = {
  hasCompletedCycleForPlan,
  fetchPtMarketplaceEligibility,
  validateMarketplaceSchedulesMappable,
};

// Root cause of the reported "Apply -> 500" blocker: a marketplace listing
// could be published/approved with a weeklySchedule that has one or more
// days with ZERO exercises (leftover test/seed WorkoutPlan rows, or a plan
// abandoned mid-generation). fitness-service's aiPlanDaySchema legitimately
// rejects that with "each day must have at least one exercise" the moment a
// real user tries to Apply it — by then it's too late, the listing is
// already live and un-adoptable. A live audit found 86 of 112 currently
// APPROVED listings affected. Fixed at the source: this same predicate now
// gates publishPlan/republishVersion (a plan can never enter the moderation
// queue with unusable content) and filters browse() (existing broken
// listings, none of which have ever been successfully adopted, stop being
// shown/adoptable without deleting the rows — no destructive migration).
// §XLIV — never expose an internal id as a listing's display title. Some
// existing listings (test/seed WorkoutPlan rows published without a real
// title ever being set by a human) literally have `title = "Listing
// <uuid>"` — this derives a meaningful fallback from the plan's own real
// data instead, matching the example in the spec ("Muscle Gain •
// Intermediate • 4 Days/Week"). Applied at read time (browse/detail/mine),
// never rewrites the stored row — no migration needed, and a publisher who
// genuinely titled their plan "Listing ABC" (however unlikely) keeps it.
const GOAL_LABEL_VI: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì vóc dáng",
  ATHLETIC_PERFORMANCE: "Hiệu suất thể thao",
};
const PLACEHOLDER_TITLE_RE = /^Listing [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deriveDisplayTitle(item: { title: string; goal: string; sourcePlan?: { daysPerWeek?: number; duration?: number } | null }): string {
  if (!PLACEHOLDER_TITLE_RE.test(item.title)) return item.title;
  const parts: string[] = [];
  parts.push(GOAL_LABEL_VI[item.goal] ?? item.goal);
  if (item.sourcePlan?.duration) parts.push(`${item.sourcePlan.duration} tuần`);
  if (item.sourcePlan?.daysPerWeek) parts.push(`${item.sourcePlan.daysPerWeek} buổi/tuần`);
  return parts.join(" • ");
}

function isWeeklyScheduleAdoptable(plan: any): boolean {
  const weeklySchedule = plan?.weeklySchedule;
  if (!Array.isArray(weeklySchedule) || weeklySchedule.length === 0) return false;
  return weeklySchedule.every(
    (day: any) => Array.isArray(day?.exercises) && day.exercises.length > 0,
  );
}

/** Second gate, on top of isWeeklyScheduleAdoptable's structural check: a day can have
 * exercises and still be un-adoptable if those exercises don't resolve against
 * fitness-service's real exercise catalog — e.g. leftover E2E-fixture content
 * ("Fixture Exercise 1", a day titled "Full body" with no real exercises, etc.), which
 * importAiPlanToSchedule rejects at apply-time with "Unable to map AI exercises to
 * exercise master". Found live while testing the marketplace flow — same "fixed at the
 * source, filters browse(), never a destructive migration" approach as the structural
 * check above. One batched cross-service call for the whole candidate pool, not one per
 * listing; fails open (keeps everything) if fitness-service can't be reached. */
async function filterExerciseCatalogMappable<T extends { id: string; sourcePlan: { plan: any } }>(
  items: T[],
): Promise<T[]> {
  if (items.length === 0) return items;
  const mappableIds = await marketplaceDeps.validateMarketplaceSchedulesMappable(
    items.map((item) => ({ listingId: item.id, weeklySchedule: item.sourcePlan.plan?.weeklySchedule })),
  );
  return items.filter((item) => mappableIds.has(item.id));
}

async function assertApprovedPtSeller(sellerId: string) {
  const eligibility = await marketplaceDeps.fetchPtMarketplaceEligibility(sellerId);
  if (!eligibility?.isApprovedPt) {
    throw new ApiError(
      "TRAINING_PACKAGE_FORBIDDEN",
      "Only approved Personal Trainer accounts can publish paid training plans",
      403,
    );
  }
  return eligibility;
}

function downstreamMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback;
  const body = error.response?.data as any;
  return body?.error?.message ?? body?.error ?? body?.message ?? fallback;
}

/** Recomputes and persists the deterministic quality score for a listing —
 * called after every review submission. Never invoked from anywhere
 * AI-related; this is pure rule-based aggregation (Phase 8). */
async function recomputeQualityScore(publishedPlanId: string) {
  const reviews = await prisma.planReview.findMany({ where: { publishedPlanId } });
  const result = computePlanQualityScore(reviews as unknown as PlanReviewLike[]);
  await prisma.publishedPlan.update({
    where: { id: publishedPlanId },
    data: { qualityScore: result.qualityScore, qualityScoreComputedAt: new Date() },
  });
  return result;
}

function exerciseIdsOf(planContent: unknown): Set<string> {
  const schedule = (planContent as any)?.weeklySchedule;
  if (!Array.isArray(schedule)) return new Set();
  const ids = schedule.flatMap((day: any) => (Array.isArray(day?.exercises) ? day.exercises.map((ex: any) => ex.exerciseId) : []));
  return new Set(ids.filter(Boolean));
}

function daySummariesOf(planContent: unknown): string[] {
  const schedule = (planContent as any)?.weeklySchedule;
  if (!Array.isArray(schedule)) return [];
  return schedule.slice(0, 7).map((day: any) => {
    const exNames = Array.isArray(day.exercises) ? day.exercises.map((ex: any) => `${ex.name} (${ex.sets}x${ex.reps})`).join(", ") : "";
    return `${day.day}: ${exNames}`;
  });
}

/** Runs automatically right after a plan is submitted (publishPlan /
 * republishVersion), BEFORE any admin sees it — deterministic content
 * analysis + deterministic similarity check + AI interpretation, persisted
 * as a PlanModerationAnalysis row. Never changes moderationStatus itself;
 * purely a report attached for the admin to read (see reviewAction, which
 * remains the only place that actually approves/rejects). Failures here
 * must never block a publish/republish from succeeding — a missing
 * analysis just means the admin reviews without it, same tolerance as
 * every other best-effort audit write in this codebase. */
async function runModerationAnalysis(publishedPlanId: string, publisherId: string, title: string, goal: string, sourcePlanId: string) {
  try {
    const plan = await prisma.workoutPlan.findUnique({ where: { id: sourcePlanId } });
    const planContent = (plan?.plan ?? {}) as unknown as PlanContentLike;

    const { computedStats, ruleFlags } = analyzePlanContent(planContent);

    const targetExerciseIds = exerciseIdsOf(plan?.plan);
    const candidateListings = await prisma.publishedPlan.findMany({
      where: {
        id: { not: publishedPlanId },
        moderationStatus: { in: ["SUBMITTED", "APPROVED"] },
        goal,
      },
      select: { id: true, title: true, sourcePlan: { select: { daysPerWeek: true, plan: true } } },
      take: 50,
    });
    const candidates: SimilarityCandidate[] = candidateListings.map((c) => ({
      publishedPlanId: c.id,
      title: c.title,
      exerciseIds: exerciseIdsOf(c.sourcePlan?.plan),
      daysPerWeek: c.sourcePlan?.daysPerWeek ?? 0,
      goal,
    }));
    const similarListings = findSimilarPlans(
      { exerciseIds: targetExerciseIds, daysPerWeek: computedStats.daysPerWeek, goal },
      candidates,
    );

    const aiResult = await planModerationAnalysisService.analyze({
      userId: publisherId,
      planTitle: title,
      planGoal: goal,
      computedStats,
      ruleFlags,
      similarListings: similarListings.map((s) => ({ title: s.title, similarityScore: s.similarityScore })),
      daySummaries: daySummariesOf(plan?.plan),
    });

    await prisma.planModerationAnalysis.create({
      data: {
        publishedPlanId,
        computedStats: computedStats as any,
        ruleFlags: ruleFlags as any,
        similarListings: similarListings as any,
        aiConcerns: aiResult.concerns as any,
        aiConfidenceScore: aiResult.confidenceScore,
        aiRecommendation: aiResult.recommendation,
        explanationForAdmin: aiResult.explanationForAdmin,
        usedFallback: aiResult.usedFallback,
      },
    });
  } catch (err) {
    logger.error({ err, publishedPlanId }, "[marketplace] moderation analysis failed (non-blocking)");
  }
}

export const marketplaceService = {
  async publishPlan(
    userId: string,
    sourcePlanId: string,
    title: string,
    description?: string,
    publisherRole?: string,
  ) {
    const plan = await prisma.workoutPlan.findUnique({
      where: { id: sourcePlanId },
    });
    if (!plan || plan.userId !== userId) {
      throw new ApiError(
        "PLAN_NOT_FOUND",
        "Workout plan not found",
        404,
      );
    }
    if (plan.status !== PlanStatus.COMPLETED) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "Only a completed plan can be published",
        400,
      );
    }
    if (!isWeeklyScheduleAdoptable(plan.plan)) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "This plan has one or more days with no exercises and cannot be published — add at least one exercise to every day first",
        422,
      );
    }

    // Publisher qualification: "COMPLETED" above only means the AI finished
    // GENERATING the plan, not that anyone ever trained on it. Reuse the
    // exact same eligibility rule already required of REVIEWERS
    // (hasCompletedCycleForPlan) — a publisher must have real, completed
    // experience with a plan before sharing it, symmetric with the
    // existing "you must have trained it to review it" rule. Applies to
    // every publisher equally, PT or not — see publisherIsVerifiedPt's doc
    // comment, which is a label only, never a bypass of this check.
    const publisherHasTrainedIt = await marketplaceDeps.hasCompletedCycleForPlan(userId, sourcePlanId);
    if (!publisherHasTrainedIt) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You must complete a training cycle on this plan yourself before publishing it to the marketplace",
        403,
      );
    }

    const existing = await prisma.publishedPlan.findFirst({
      where: {
        sourcePlanId,
        moderationStatus: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
      },
    });
    if (existing) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "This plan has already been published",
        409,
      );
    }

    const created = await prisma.publishedPlan.create({
      data: {
        sourcePlanId,
        publisherId: userId,
        title,
        description,
        goal: plan.goal,
        moderationStatus: "SUBMITTED",
        publishedAt: new Date(),
        publisherIsVerifiedPt: publisherRole === "PT",
      },
    });

    // Runs before any admin ever sees this listing — see the function's own
    // doc comment. Awaited (not fire-and-forget) so the very first admin
    // view is never a race against an in-flight analysis; the LLM call is
    // synchronous elsewhere in this codebase for the same reason (e.g.
    // assessCycleSafe).
    await runModerationAnalysis(created.id, userId, title, plan.goal, sourcePlanId);

    return created;
  },

  async listMine(userId: string) {
    const listings = await prisma.publishedPlan.findMany({
      where: { publisherId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        packages: { where: { status: "ACTIVE" }, select: { id: true, name: true, price: true } },
        sourcePlan: { select: { duration: true, daysPerWeek: true } },
      },
    });
    return listings.map((l) => ({ ...l, title: deriveDisplayTitle(l) }));
  },

  async withdraw(id: string, userId: string) {
    const listing = await prisma.publishedPlan.findUnique({ where: { id } });
    if (!listing) {
      throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    }
    if (listing.publisherId !== userId) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You do not own this listing",
        403,
      );
    }
    await prisma.publishedPlan.delete({ where: { id } });
  },

  // ── Browse + rating ──────────────────────────────────────────────────────
  async browse(params: {
    goal?: string;
    sort?: "rating" | "recent" | "quality" | "recommended";
    daysPerWeek?: number;
    durationWeeksMax?: number;
    page?: number;
    limit?: number;
    /** Present only for sort="recommended" — the browsing user's own id,
     * used to fetch their goal/level for deterministic (no-AI) scoring. */
    viewerId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));

    // Hide a version once a NEWER version of the same lineage has been
    // APPROVED — otherwise both keep showing side by side as seemingly
    // unrelated duplicate listings. An older version stays visible for as
    // long as no newer one has cleared moderation yet.
    const superseded = await prisma.publishedPlan.findMany({
      where: { moderationStatus: "APPROVED", previousVersionId: { not: null } },
      select: { previousVersionId: true },
    });
    const supersededIds = superseded.map((s) => s.previousVersionId).filter((id): id is string => !!id);

    const where = {
      moderationStatus: "APPROVED" as const,
      ...(supersededIds.length > 0 ? { id: { notIn: supersededIds } } : {}),
      ...(params.goal ? { goal: params.goal } : {}),
      ...(params.daysPerWeek ? { sourcePlan: { daysPerWeek: params.daysPerWeek } } : {}),
      ...(params.durationWeeksMax ? { sourcePlan: { duration: { lte: params.durationWeeksMax } } } : {}),
    };

    if (params.sort === "recommended") {
      // Deterministic personalization (NOT AI): fetch a broader candidate
      // pool sorted by recency, then re-rank by goal-match + quality score
      // — explainable and cheap, matching this codebase's "no black box"
      // convention (same philosophy as plan-similarity.ts/plan-quality-scorer.ts).
      const viewerProfile = params.viewerId ? await fetchUserGoalAndLevel(params.viewerId) : null;
      const pool = await prisma.publishedPlan.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        take: 500,
        include: {
          packages: { where: { status: "ACTIVE" }, select: { id: true, name: true, price: true } },
          sourcePlan: { select: { plan: true, duration: true, daysPerWeek: true } },
        },
      });
      const structurallyAdoptable = pool.filter((item) => isWeeklyScheduleAdoptable(item.sourcePlan.plan));
      const adoptable = await filterExerciseCatalogMappable(structurallyAdoptable);
      const scored = adoptable.map((item) => {
        let score = (item.qualityScore ?? item.avgRating / 5) * 10;
        if (viewerProfile?.goal && item.goal === viewerProfile.goal) score += 5;
        score += Math.min(2, item.ratingCount * 0.1); // mild confidence bonus for more-reviewed plans
        return { item, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const total = scored.length;
      const items = scored
        .slice((page - 1) * limit, (page - 1) * limit + limit)
        .map((s) => ({ ...s.item, title: deriveDisplayTitle(s.item), sourcePlan: undefined }));
      return { items, total, page, limit };
    }

    const orderBy =
      params.sort === "rating"
        ? [{ avgRating: "desc" as const }, { ratingCount: "desc" as const }]
        : params.sort === "quality"
          ? [{ qualityScore: "desc" as const }, { ratingCount: "desc" as const }]
          : [{ publishedAt: "desc" as const }];

    // Root-cause fix for the "Apply -> 500" bug (see isWeeklyScheduleAdoptable's
    // doc comment): a listing with no adoptable content must never be shown
    // as browsable in the first place. Prisma can't filter on nested JSONB
    // array-of-objects content portably, so — same pattern as the
    // "recommended" branch above — fetch a bounded candidate pool already
    // DB-sorted, filter in-memory, then paginate the filtered result. 500 is
    // comfortably above the current total APPROVED count (see final report's
    // data audit); revisit with a raw-SQL JSONB predicate if the catalog
    // ever grows past that.
    const pool = await prisma.publishedPlan.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        packages: { where: { status: "ACTIVE" }, select: { id: true, name: true, price: true } },
        sourcePlan: { select: { plan: true, duration: true, daysPerWeek: true } },
      },
    });
    const structurallyAdoptable = pool.filter((item) => isWeeklyScheduleAdoptable(item.sourcePlan.plan));
    const adoptable = await filterExerciseCatalogMappable(structurallyAdoptable);
    const total = adoptable.length;
    const items = adoptable
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map((item) => ({ ...item, title: deriveDisplayTitle(item), sourcePlan: undefined }));

    return { items, total, page, limit };
  },

  async getApprovedDetail(id: string) {
    const listing = await prisma.publishedPlan.findFirst({
      where: { id, moderationStatus: "APPROVED" },
      include: {
        reviews: { orderBy: { createdAt: "desc" }, take: 50 },
        sourcePlan: { select: { plan: true, duration: true, daysPerWeek: true } },
        // Surfaced so the frontend can show "requires purchasing X" and the
        // price BEFORE the user tries to adopt, instead of only finding out
        // via a 402 from POST /plans/:id/adopt after already committing.
        packages: { where: { status: "ACTIVE" }, select: { id: true, name: true, price: true } },
      },
    });
    if (!listing) {
      throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    }
    return { ...listing, title: deriveDisplayTitle(listing) };
  },

  async submitReview(
    listingId: string,
    reviewerId: string,
    rating: number,
    comment?: string,
    // Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — additive
    // multi-dimensional fields, all optional (see PlanReview's schema
    // comment for why nulls are never treated as negative signals).
    dimensions?: {
      goalFit?: number;
      difficultyFit?: "too_easy" | "just_right" | "too_hard";
      enjoyment?: number;
      clarity?: number;
      equipmentFit?: number;
      timeFit?: number;
      resultsPerception?: "better_than_expected" | "as_expected" | "worse_than_expected" | "too_early_to_tell";
      wouldUseAgain?: boolean;
      complaintTags?: string[];
      freeText?: string;
    },
  ) {
    const listing = await prisma.publishedPlan.findUnique({
      where: { id: listingId },
    });
    if (!listing || listing.moderationStatus !== "APPROVED") {
      throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    }
    if (listing.publisherId === reviewerId) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You cannot review your own listing",
        403,
      );
    }

    const adoption = await prisma.planAdoption.findFirst({
      where: { publishedPlanId: listingId, adopterId: reviewerId },
      orderBy: { createdAt: "desc" },
    });
    if (!adoption) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You can review a marketplace plan only after applying it and completing a training cycle",
        403,
      );
    }

    const eligible = await marketplaceDeps.hasCompletedCycleForPlan(
      reviewerId,
      listing.sourcePlanId,
    );
    if (!eligible) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You must complete a training cycle on this plan before reviewing it",
        403,
      );
    }

    const existing = await prisma.planReview.findUnique({
      where: {
        publishedPlanId_reviewerId: {
          publishedPlanId: listingId,
          reviewerId,
        },
      },
    });
    if (existing) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "You already reviewed this listing",
        409,
      );
    }

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.planReview.create({
        data: {
          publishedPlanId: listingId,
          reviewerId,
          rating,
          comment,
          goalFit: dimensions?.goalFit,
          difficultyFit: dimensions?.difficultyFit,
          enjoyment: dimensions?.enjoyment,
          clarity: dimensions?.clarity,
          equipmentFit: dimensions?.equipmentFit,
          timeFit: dimensions?.timeFit,
          resultsPerception: dimensions?.resultsPerception,
          wouldUseAgain: dimensions?.wouldUseAgain,
          complaintTags: dimensions?.complaintTags as any,
          freeText: dimensions?.freeText,
        },
      });
      const agg = await tx.planReview.aggregate({
        where: { publishedPlanId: listingId },
        _avg: { rating: true },
        _count: true,
      });
      await tx.publishedPlan.update({
        where: { id: listingId },
        data: {
          avgRating: agg._avg.rating ?? 0,
          ratingCount: agg._count,
        },
      });
      return created;
    });

    // Deterministic quality score recompute — outside the transaction (it
    // does its own read+write and a failure here shouldn't roll back a
    // successfully-submitted review).
    await recomputeQualityScore(listingId).catch(() => {});

    return review;
  },

  // ── Phase 8: versioning — publishing an update creates a NEW row ────────
  async republishVersion(
    publisherId: string,
    previousPublishedPlanId: string,
    input: { sourcePlanId?: string; title?: string; description?: string; changelog: string; improvementReason?: string },
    publisherRole?: string,
  ) {
    const previous = await prisma.publishedPlan.findUnique({ where: { id: previousPublishedPlanId } });
    if (!previous) throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    if (previous.publisherId !== publisherId) {
      throw new ApiError("PUBLISHED_PLAN_FORBIDDEN", "You do not own this listing", 403);
    }

    const sourcePlanId = input.sourcePlanId ?? previous.sourcePlanId;
    const plan = await prisma.workoutPlan.findUnique({ where: { id: sourcePlanId } });
    if (!plan || plan.userId !== publisherId) {
      throw new ApiError("PLAN_NOT_FOUND", "Workout plan not found", 404);
    }
    if (!isWeeklyScheduleAdoptable(plan.plan)) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "This plan has one or more days with no exercises and cannot be published — add at least one exercise to every day first",
        422,
      );
    }

    // Same publisher-qualification rule as publishPlan — only re-checked
    // when this version points at a DIFFERENT underlying WorkoutPlan than
    // the previous version did (a pure title/changelog edit on the same
    // plan already satisfied this the first time it was published).
    if (sourcePlanId !== previous.sourcePlanId) {
      const publisherHasTrainedIt = await marketplaceDeps.hasCompletedCycleForPlan(publisherId, sourcePlanId);
      if (!publisherHasTrainedIt) {
        throw new ApiError(
          "PUBLISHED_PLAN_FORBIDDEN",
          "You must complete a training cycle on this plan yourself before publishing it to the marketplace",
          403,
        );
      }
    }

    // New version always re-enters moderation — never inherits the prior
    // version's APPROVED status (an edited plan hasn't been reviewed yet).
    const created = await prisma.publishedPlan.create({
      data: {
        sourcePlanId,
        publisherId,
        title: input.title ?? previous.title,
        description: input.description ?? previous.description,
        goal: plan.goal,
        moderationStatus: "SUBMITTED",
        publishedAt: new Date(),
        version: previous.version + 1,
        previousVersionId: previous.id,
        changelog: input.changelog,
        improvementReason: input.improvementReason,
        publisherIsVerifiedPt: publisherRole === "PT",
      },
    });

    await runModerationAnalysis(created.id, publisherId, created.title, plan.goal, sourcePlanId);

    return created;
  },

  async listVersionHistory(publishedPlanId: string) {
    // Walk backward via previousVersionId to build the full chain, then
    // also include any newer version that points back at this one (so the
    // caller sees the whole lineage regardless of which version id it has).
    const all = await prisma.publishedPlan.findMany({
      where: { OR: [{ id: publishedPlanId }] },
    });
    const anchor = all[0];
    if (!anchor) throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);

    const chain = await prisma.$queryRawUnsafe<any[]>(
      `WITH RECURSIVE lineage AS (
         SELECT * FROM published_plans WHERE id = $1
         UNION ALL
         SELECT p.* FROM published_plans p JOIN lineage l ON p.id = l.previous_version_id
       )
       SELECT id, version, title, moderation_status, changelog, improvement_reason, created_at FROM lineage ORDER BY version ASC`,
      publishedPlanId,
    );
    const newer = await prisma.publishedPlan.findMany({
      where: { previousVersionId: publishedPlanId },
      select: { id: true, version: true, title: true, moderationStatus: true, changelog: true, improvementReason: true, createdAt: true },
    });
    return [...chain, ...newer];
  },

  // ── Phase 8: adopt — closes the "no adopt action exists" gap ────────────
  async adoptPlan(
    adopterId: string,
    publishedPlanId: string,
    input: {
      startDate: string;
      repeatWeeks?: number;
      selectedWeekdays: number[];
      replaceExisting?: boolean;
      /** Phase 9 — lets the adopter trim exercises they can't do / adjust
       * sets before importing, instead of a rigid one-size-fits-all copy.
       * Must have the same number of days as the published plan (can't
       * add/remove whole days here — only edit within-day composition);
       * every exerciseId must already exist in the original plan (this is
       * a trim/adjust tool, not a way to inject arbitrary content). Falls
       * back to the published plan's own content unchanged when omitted. */
      customizedWeeklySchedule?: Array<{
        day: string;
        exercises: Array<{ exerciseId: string; name: string; sets: number; reps: string; restSeconds?: number }>;
      }>;
    },
  ) {
    const listing = await prisma.publishedPlan.findFirst({
      where: { id: publishedPlanId, moderationStatus: "APPROVED" },
      include: { sourcePlan: true, packages: { where: { status: "ACTIVE" } } },
    });
    if (!listing) throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);

    if (listing.packages.length > 0) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "Paid PT marketplace offers are personalized coaching services and cannot be applied as fixed plans. Purchase the package to request a custom plan from the PT.",
        409,
      );
      // At least one active paid package wraps this listing — adopting
      // requires a PAID purchase of one of them.
    }

    const planContent = listing.sourcePlan.plan as any;
    if (!planContent || !Array.isArray(planContent.weeklySchedule) || planContent.weeklySchedule.length === 0) {
      throw new ApiError("VALIDATION_ERROR", "This plan has no usable weekly schedule to adopt", 422);
    }
    // Defense in depth: publishPlan/republishVersion now reject this at
    // submission time and browse() no longer surfaces it, but a pre-existing
    // broken listing (published before this fix) could still be reached via
    // a direct/bookmarked URL. Fail here with an honest, user-facing message
    // instead of forwarding fitness-service's internal Zod validation error
    // ("each day must have at least one exercise") — that's the actual root
    // cause of the reported Apply -> 500/400, now caught before the
    // cross-service call is even made.
    if (!isWeeklyScheduleAdoptable(planContent)) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "This plan is currently unavailable — its content is incomplete. Please choose another plan.",
        422,
      );
    }
    // Same defense-in-depth reasoning as the structural check above, for the
    // exercise-catalog-mappability gate browse() now also applies: a listing reached via
    // a direct/bookmarked URL (or the brief window before this check existed) could still
    // slip through with un-mappable exercise names. Fail here with the same honest message
    // instead of letting fitness-service's "Unable to map AI exercises to exercise master"
    // reach the user below.
    const mappableIds = await marketplaceDeps.validateMarketplaceSchedulesMappable([
      { listingId: publishedPlanId, weeklySchedule: planContent.weeklySchedule },
    ]);
    if (!mappableIds.has(publishedPlanId)) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "This plan is currently unavailable — its content is incomplete. Please choose another plan.",
        422,
      );
    }

    let weeklySchedule = planContent.weeklySchedule;
    if (input.customizedWeeklySchedule) {
      if (input.customizedWeeklySchedule.length !== planContent.weeklySchedule.length) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `customizedWeeklySchedule must have exactly ${planContent.weeklySchedule.length} days, matching the published plan`,
          400,
        );
      }
      const originalExerciseIds = new Set(
        planContent.weeklySchedule.flatMap((d: any) => (d.exercises || []).map((e: any) => e.exerciseId)),
      );
      const hasInventedExercise = input.customizedWeeklySchedule.some((day) =>
        day.exercises.some((ex) => !originalExerciseIds.has(ex.exerciseId)),
      );
      if (hasInventedExercise) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "customizedWeeklySchedule can only trim/adjust exercises already in the published plan, not add new ones",
          400,
        );
      }
      const hasEmptyDay = input.customizedWeeklySchedule.some((day) => day.exercises.length === 0);
      if (hasEmptyDay) {
        throw new ApiError("VALIDATION_ERROR", "Every day must keep at least one exercise", 400);
      }
      weeklySchedule = input.customizedWeeklySchedule;
    }

    const fitnessServiceUrl = process.env.FITNESS_SERVICE_URL || "http://localhost:3002";
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    let response;
    try {
      response = await axios.post(
        `${fitnessServiceUrl}/workouts/from-ai-plan`,
        {
          sourcePlanId: listing.sourcePlan.id,
          sourcePlanVersion: listing.sourcePlan.version,
          sourcePlanName: listing.title,
          goal: listing.sourcePlan.goal,
          durationWeeks: listing.sourcePlan.duration,
          daysPerWeek: listing.sourcePlan.daysPerWeek,
          startDate: input.startDate,
          repeatWeeks: input.repeatWeeks ?? listing.sourcePlan.duration,
          selectedWeekdays: input.selectedWeekdays,
          weeklySchedule,
          replaceExisting: input.replaceExisting !== false,
        },
        {
          headers: { "x-internal-token": internalSecret, "x-user-id": adopterId },
          timeout: 15000,
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status >= 400 && error.response.status < 500 ? error.response.status : 502;
        throw new ApiError(
          status === 400 || status === 422 ? "VALIDATION_ERROR" : "PUBLISHED_PLAN_INVALID_STATE",
          downstreamMessage(error, "Fitness service could not import this plan"),
          status,
        );
      }
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "Fitness service did not respond while applying this plan",
        504,
      );
    }

    await prisma.planAdoption.create({
      data: {
        publishedPlanId,
        adopterId,
        accessBasis: "free",
        purchaseId: null,
        wasCustomized: !!input.customizedWeeklySchedule,
      },
    });

    return response.data;
  },

  // ── Admin moderation ────────────────────────────────────────────────────
  async listForModeration(status?: string) {
    // Includes the full plan content + the latest moderation analysis so
    // the admin decision is never made blind — see runModerationAnalysis's
    // doc comment. sourcePlan.plan carries the same weeklySchedule shape
    // the client-facing "Xem trước lịch tập" preview already renders.
    return prisma.publishedPlan.findMany({
      where: status ? { moderationStatus: status as any } : undefined,
      orderBy: { createdAt: "asc" },
      include: {
        sourcePlan: { select: { plan: true, duration: true, daysPerWeek: true } },
        moderationAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
  },

  async reviewAction(
    id: string,
    action: "APPROVE" | "REJECT",
    note?: string,
    adminUserId?: string,
  ) {
    const listing = await prisma.publishedPlan.findUnique({ where: { id } });
    if (!listing) {
      throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    }
    if (listing.moderationStatus !== "SUBMITTED") {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "Only a submitted listing can be reviewed",
        409,
      );
    }
    if (action === "REJECT" && !note) {
      throw new ApiError(
        "PUBLISHED_PLAN_INVALID_STATE",
        "A note is required when rejecting a listing",
        400,
      );
    }

    return prisma.publishedPlan.update({
      where: { id },
      data: {
        moderationStatus: action === "APPROVE" ? "APPROVED" : "REJECTED",
        moderationNote: note ?? null,
        approvedBy: action === "APPROVE" ? (adminUserId ?? null) : null,
      },
    });
  },

  // ── Selling packages ─────────────────────────────────────────────────────
  async createPackage(
    sellerId: string,
    publishedPlanId: string,
    name: string,
    price: number,
    description?: string,
    durationWeeks?: number,
  ) {
    const listing = await prisma.publishedPlan.findUnique({
      where: { id: publishedPlanId },
    });
    if (!listing || listing.moderationStatus !== "APPROVED") {
      throw new ApiError(
        "PUBLISHED_PLAN_NOT_FOUND",
        "Listing not found or not approved",
        404,
      );
    }
    if (listing.publisherId !== sellerId) {
      throw new ApiError(
        "PUBLISHED_PLAN_FORBIDDEN",
        "You can only sell packages for your own published plans",
        403,
      );
    }
    await assertApprovedPtSeller(sellerId);

    return prisma.trainingPackage.create({
      data: {
        sellerId,
        publishedPlanId,
        name,
        description,
        price,
        durationWeeks,
      },
    });
  },

  async listMyPackages(sellerId: string) {
    return prisma.trainingPackage.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
    });
  },

  async archivePackage(id: string, sellerId: string) {
    const pkg = await prisma.trainingPackage.findUnique({ where: { id } });
    if (!pkg) {
      throw new ApiError("TRAINING_PACKAGE_NOT_FOUND", "Package not found", 404);
    }
    if (pkg.sellerId !== sellerId) {
      throw new ApiError(
        "TRAINING_PACKAGE_FORBIDDEN",
        "You do not own this package",
        403,
      );
    }
    return prisma.trainingPackage.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
  },

  async browsePackages(params: { page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const where = { status: "ACTIVE" as const };

    const [items, total] = await Promise.all([
      prisma.trainingPackage.findMany({
        where,
        include: { publishedPlan: { select: { title: true, goal: true, avgRating: true, ratingCount: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trainingPackage.count({ where }),
    ]);

    return { items, total, page, limit };
  },

  async purchasePackage(packageId: string, buyerId: string) {
    const pkg = await prisma.trainingPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg || pkg.status !== "ACTIVE") {
      throw new ApiError(
        "TRAINING_PACKAGE_NOT_FOUND",
        "Package not found or no longer for sale",
        404,
      );
    }
    if (pkg.sellerId === buyerId) {
      throw new ApiError(
        "TRAINING_PACKAGE_FORBIDDEN",
        "You cannot purchase your own package",
        403,
      );
    }
    await assertApprovedPtSeller(pkg.sellerId);

    const existing = await prisma.trainingPackagePurchase.findUnique({
      where: { packageId_buyerId: { packageId, buyerId } },
    });
    if (existing && existing.status === "PAID") {
      throw new ApiError(
        "TRAINING_PACKAGE_INVALID_STATE",
        "You already purchased this package",
        409,
      );
    }

    const purchase =
      existing ??
      (await prisma.trainingPackagePurchase.create({
        data: {
          packageId,
          buyerId,
          priceAtPurchase: pkg.price,
        },
      }));

    const idempotencyKey = `training-package:${purchase.id}:attempt:${randomUUID()}`;
    const result = await paymentClient.walletTransfer({
      payerOwnerId: buyerId,
      receiverOwnerId: pkg.sellerId,
      amount: pkg.price,
      relatedEntityId: purchase.id,
      idempotencyKey,
      initiatedBy: buyerId,
    });

    if (result.status === "PAID") {
      return prisma.trainingPackagePurchase.update({
        where: { id: purchase.id },
        data: {
          status: "PAID",
          purchasedAt: new Date(),
          paymentTransactionId: result.transactionId,
        },
      });
    }

    await prisma.trainingPackagePurchase.update({
      where: { id: purchase.id },
      data: { status: "FAILED", paymentTransactionId: result.transactionId },
    });
    throw new ApiError(
      "PAYMENT_FAILED",
      result.failureReason ?? "Payment failed",
      402,
    );
  },

  async listMyPurchases(buyerId: string) {
    return prisma.trainingPackagePurchase.findMany({
      where: { buyerId, status: "PAID" },
      include: {
        package: {
          include: {
            publishedPlan: { select: { title: true, goal: true, sourcePlanId: true } },
          },
        },
      },
      orderBy: { purchasedAt: "desc" },
    });
  },

  // ── Phase 8: AI improvement suggestions (advisory only) ──────────────────
  async generateImprovementSuggestions(publisherId: string, publishedPlanId: string) {
    const listing = await prisma.publishedPlan.findUnique({ where: { id: publishedPlanId } });
    if (!listing) throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    if (listing.publisherId !== publisherId) {
      throw new ApiError("PUBLISHED_PLAN_FORBIDDEN", "You do not own this listing", 403);
    }

    const reviews = await prisma.planReview.findMany({ where: { publishedPlanId } });
    const qualityScoreResult = computePlanQualityScore(reviews as unknown as PlanReviewLike[]);
    const reviewFreeTextSample = reviews
      .map((r) => r.freeText || r.comment)
      .filter((t): t is string => !!t && t.trim().length > 0)
      .slice(0, 30);

    const aiOutput = await planImprovementService.generateSuggestions({
      userId: publisherId,
      planTitle: listing.title,
      planGoal: listing.goal,
      qualityScoreResult: qualityScoreResult as any,
      reviewFreeTextSample,
    });

    return prisma.planImprovementSuggestion.create({
      data: {
        publishedPlanId,
        basedOnReviewCount: qualityScoreResult.reviewCount,
        qualityScoreSnapshot: qualityScoreResult.qualityScore,
        suggestions: aiOutput.suggestions as any,
        commonComplaints: qualityScoreResult.commonComplaints as any,
        summary: aiOutput.summary,
      },
    });
  },

  async listImprovementSuggestions(publisherId: string, publishedPlanId: string) {
    const listing = await prisma.publishedPlan.findUnique({ where: { id: publishedPlanId } });
    if (!listing) throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    if (listing.publisherId !== publisherId) {
      throw new ApiError("PUBLISHED_PLAN_FORBIDDEN", "You do not own this listing", 403);
    }
    return prisma.planImprovementSuggestion.findMany({
      where: { publishedPlanId },
      orderBy: { generatedAt: "desc" },
    });
  },
};
