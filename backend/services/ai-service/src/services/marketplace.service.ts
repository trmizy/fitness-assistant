import { randomUUID } from "crypto";
import { prisma } from "../repositories/conversation.repository";
import { PlanStatus } from "../generated/prisma";
import { ApiError } from "../errors/api-error";
import { hasCompletedCycleForPlan } from "../clients/fitness.client";
import { paymentClient } from "../clients/payment.client";

export const marketplaceService = {
  async publishPlan(
    userId: string,
    sourcePlanId: string,
    title: string,
    description?: string,
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

    return prisma.publishedPlan.create({
      data: {
        sourcePlanId,
        publisherId: userId,
        title,
        description,
        goal: plan.goal,
        moderationStatus: "SUBMITTED",
        publishedAt: new Date(),
      },
    });
  },

  async listMine(userId: string) {
    return prisma.publishedPlan.findMany({
      where: { publisherId: userId },
      orderBy: { createdAt: "desc" },
    });
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
  async browse(params: { goal?: string; sort?: "rating" | "recent"; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const where = {
      moderationStatus: "APPROVED" as const,
      ...(params.goal ? { goal: params.goal } : {}),
    };
    const orderBy =
      params.sort === "rating"
        ? [{ avgRating: "desc" as const }, { ratingCount: "desc" as const }]
        : [{ publishedAt: "desc" as const }];

    const [items, total] = await Promise.all([
      prisma.publishedPlan.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.publishedPlan.count({ where }),
    ]);

    return { items, total, page, limit };
  },

  async getApprovedDetail(id: string) {
    const listing = await prisma.publishedPlan.findFirst({
      where: { id, moderationStatus: "APPROVED" },
      include: {
        reviews: { orderBy: { createdAt: "desc" }, take: 50 },
        sourcePlan: { select: { plan: true, duration: true, daysPerWeek: true } },
      },
    });
    if (!listing) {
      throw new ApiError("PUBLISHED_PLAN_NOT_FOUND", "Listing not found", 404);
    }
    return listing;
  },

  async submitReview(
    listingId: string,
    reviewerId: string,
    rating: number,
    comment?: string,
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

    const eligible = await hasCompletedCycleForPlan(
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

    return prisma.$transaction(async (tx) => {
      const review = await tx.planReview.create({
        data: { publishedPlanId: listingId, reviewerId, rating, comment },
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
      return review;
    });
  },

  // ── Admin moderation ────────────────────────────────────────────────────
  async listForModeration(status?: string) {
    return prisma.publishedPlan.findMany({
      where: status ? { moderationStatus: status as any } : undefined,
      orderBy: { createdAt: "asc" },
    });
  },

  async reviewAction(
    id: string,
    action: "APPROVE" | "REJECT",
    note?: string,
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
};
