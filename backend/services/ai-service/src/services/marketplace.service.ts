import { prisma } from "../repositories/conversation.repository";
import { PlanStatus } from "../generated/prisma";
import { ApiError } from "../errors/api-error";

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
};
