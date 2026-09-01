/**
 * Marketplace rework — Personalized PT Service (spec sections VI-XXII).
 *
 * The other half of the marketplace, structurally distinct from
 * marketplace.service.ts's PublishedPlan/TrainingPackage (which sells a
 * FIXED plan unchanged to every buyer): here the PT sells
 * time/expertise/personalization capacity, and the actual plan is created
 * per-buyer, after Intake, through Draft -> Revision -> Accept.
 *
 * Deliberately reuses rather than duplicates:
 *  - assertApprovedPtSeller-equivalent gating (fetchPtMarketplaceEligibility)
 *  - Contract (user-service) as the PT-client authorization container, via
 *    createMarketplaceContract — once an order's Intake is submitted, the
 *    ENTIRE existing PT-client surface (coach.service.ts, chat eligibility)
 *    works for this buyer/seller pair with zero new authorization code.
 *  - workoutService.createManualProgram (fitness-service), via the new
 *    internal /workouts/manual-program endpoint, to commit an ACCEPTED
 *    draft into the buyer's real training cycle — the same commit path
 *    Contract-based PT coaching already uses.
 *  - Real gateway checkout + escrow (P0 cluster C2/C3), the same pipeline PT_CONTRACT and
 *    GYM_MEMBERSHIP already use: paymentClient.checkout starts the gateway payment, the
 *    price lands in the PT/platform's PENDING buckets on payment-service's webhook
 *    (settleContractPayment — purpose-agnostic, no personalized-service-specific code needed
 *    for this step), and personalized-service-ledger.service.ts's releaseOrder/refundOrder
 *    (payment-service) move it to AVAILABLE on acceptance or back to the client on
 *    cancellation/admin refund. Earlier revisions of this file used a plain wallet-to-wallet
 *    transfer that settled to the seller's AVAILABLE balance instantly — broken twice over:
 *    it required the buyer's wallet to already hold a balance (wallet top-up is disabled), and
 *    it paid the seller in full before the buyer had accepted anything.
 */
import { randomUUID } from "crypto";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { ApiError } from "../errors/api-error";
import { fetchPtMarketplaceEligibility } from "../clients/user.client";
import { createMarketplaceContract } from "../clients/user.client";
import { paymentClient, PaymentClientError } from "../clients/payment.client";
import { commitPersonalizedPlan } from "../clients/fitness.client";

/** Indirection point for tests — same rationale as marketplaceDeps
 * (marketplace.service.ts). Payment methods included here too (unlike
 * marketplace.service.ts, which calls paymentClient directly and has no
 * purchase-path tests) so tests never depend on a real gateway/wallet. */
export const personalizedServiceDeps = {
  fetchPtMarketplaceEligibility,
  createMarketplaceContract,
  commitPersonalizedPlan,
  checkout: paymentClient.checkout,
  getTransaction: paymentClient.getTransaction,
  releaseOrder: paymentClient.releaseOrder,
  refundOrder: paymentClient.refundOrder,
};

/** P0 cluster C3 — the platform's cut of a Personalized Service order. Floored at 10%, same
 * as PT contracts and gym memberships. */
const PLATFORM_RATE = (() => {
  const raw = Number(process.env.PLATFORM_COMMISSION_RATE ?? "0.10");
  return (Number.isFinite(raw) && raw >= 0.1 && raw <= 1 ? raw : 0.1).toFixed(4);
})();

/** How long a buyer has to accept or request a revision before a delivered draft
 * auto-accepts on their behalf — mirrors SESSION_AUTO_CONFIRM_DAYS in user-service, same
 * rationale: a PT must not be left uncredited forever by silence. */
export const AUTO_ACCEPT_DAYS = Number(process.env.PERSONALIZED_SERVICE_AUTO_ACCEPT_DAYS ?? "3");
const AUTO_ACCEPT_MS = AUTO_ACCEPT_DAYS * 24 * 60 * 60 * 1000;

async function assertApprovedPt(sellerId: string) {
  const eligibility = await personalizedServiceDeps.fetchPtMarketplaceEligibility(sellerId);
  if (!eligibility?.isApprovedPt) {
    throw new ApiError(
      "PERSONALIZED_SERVICE_FORBIDDEN",
      "Only approved Personal Trainer accounts can create a Personalized PT Service",
      403,
    );
  }
  return eligibility;
}

// §XIV — the FIXED, closed set of consent categories a buyer can opt into.
// Never free-form: an arbitrary string here would mean the backend can't
// enforce "the PT only ever sees what was actually consented to".
export const CONSENT_CATEGORIES = [
  "basic_info",
  "training_goals",
  "experience",
  "equipment",
  "injuries_limitations",
  "workout_history",
  "inbody",
  "training_cycle",
  "session_feedback",
  "nutrition_preferences",
] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

function assertValidConsentCategories(categories: unknown): asserts categories is ConsentCategory[] {
  if (!Array.isArray(categories) || categories.some((c) => !CONSENT_CATEGORIES.includes(c))) {
    throw new ApiError("VALIDATION_ERROR", "consentCategories must be a subset of the known categories", 400);
  }
}

// §XIV — "PT chỉ xem dữ liệu trong relationship/order hợp lệ" applies at the
// FIELD level, not just "consent was given for at least one category":
// intakeData is one free-form JSON blob (the intake form spans many
// sections, see submitIntake's doc comment on why it's not a fixed
// relational shape), so returning the whole thing to the PT regardless of
// which categories were actually checked would silently leak fields the
// client never consented to share. This maps each known intake field to
// the consent category that covers it; anything NOT in this map is treated
// as ungoverned and stripped for the PT (fail closed, never fail open).
const INTAKE_FIELD_TO_CONSENT_CATEGORY: Record<string, ConsentCategory> = {
  age: "basic_info",
  gender: "basic_info",
  heightCm: "basic_info",
  weight: "basic_info",
  targetWeight: "basic_info",
  notes: "basic_info",
  goal: "training_goals",
  experienceLevel: "experience",
  daysPerWeek: "training_goals",
  sessionDuration: "training_goals",
  trainingLocation: "equipment",
  equipment: "equipment",
  injuries: "injuries_limitations",
  currentPerformance: "experience",
  workoutHistory: "workout_history",
  inbody: "inbody",
  trainingCycle: "training_cycle",
  sessionFeedback: "session_feedback",
  nutritionPreferences: "nutrition_preferences",
  foodAllergies: "nutrition_preferences",
  dislikedFoods: "nutrition_preferences",
  mealsPerDay: "nutrition_preferences",
};

function filterIntakeDataForPt(intakeData: unknown, consentCategories: unknown): Record<string, unknown> | null {
  if (!intakeData || typeof intakeData !== "object") return null;
  const consented = new Set(Array.isArray(consentCategories) ? consentCategories : []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intakeData as Record<string, unknown>)) {
    const category = INTAKE_FIELD_TO_CONSENT_CATEGORY[key];
    if (category && consented.has(category)) out[key] = value;
  }
  return out;
}

export const personalizedServiceService = {
  // ── PT: create / manage listings ─────────────────────────────────────────
  async createService(
    sellerId: string,
    input: {
      serviceType: string;
      title: string;
      description?: string;
      price: number;
      deliverables: string[];
      revisionLimit?: number | null;
      initialDeliveryDays: number;
      supportWeeks?: number | null;
      targetGoal?: string;
      targetLevel?: string;
    },
  ) {
    await assertApprovedPt(sellerId);
    return prisma.personalizedService.create({
      data: {
        sellerId,
        serviceType: input.serviceType as any,
        title: input.title,
        description: input.description,
        price: input.price,
        deliverables: input.deliverables as any,
        revisionLimit: input.revisionLimit ?? null,
        initialDeliveryDays: input.initialDeliveryDays,
        supportWeeks: input.supportWeeks ?? null,
        targetGoal: input.targetGoal,
        targetLevel: input.targetLevel,
      },
    });
  },

  async listMyServices(sellerId: string) {
    return prisma.personalizedService.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
    });
  },

  async archiveService(id: string, sellerId: string) {
    const svc = await prisma.personalizedService.findUnique({ where: { id } });
    if (!svc) throw new ApiError("PERSONALIZED_SERVICE_NOT_FOUND", "Service not found", 404);
    if (svc.sellerId !== sellerId) throw new ApiError("PERSONALIZED_SERVICE_FORBIDDEN", "You do not own this service", 403);
    return prisma.personalizedService.update({ where: { id }, data: { status: "ARCHIVED" } });
  },

  // ── Browse + detail (public, buyer-facing) ───────────────────────────────
  async browseServices(params: { serviceType?: string; goal?: string; level?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const where = {
      status: "ACTIVE" as const,
      ...(params.serviceType ? { serviceType: params.serviceType as any } : {}),
      ...(params.goal ? { targetGoal: params.goal } : {}),
      ...(params.level ? { targetLevel: params.level } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.personalizedService.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.personalizedService.count({ where }),
    ]);
    // §IX — buyer needs to evaluate PT credibility from the card itself, not
    // just after clicking in. Batch-fetch eligibility/display info for the
    // distinct sellers on this page only (never the whole catalog).
    const sellerIds = [...new Set(items.map((i) => i.sellerId))];
    const sellers = await Promise.all(sellerIds.map((id) => personalizedServiceDeps.fetchPtMarketplaceEligibility(id)));
    const sellerById = new Map(sellerIds.map((id, i) => [id, sellers[i]]));
    // Defense in depth, same reasoning as isWeeklyScheduleAdoptable's
    // read-time filter in marketplace.service.ts: createService only checks
    // isApprovedPt at PUBLISH time. A seller's approval can be revoked
    // afterward, and this also guards against listings whose sellerId never
    // resolves to a real user at all (e.g. stale/orphaned rows) — either
    // way, browse() must never surface a paid listing from a seller who
    // isn't a currently-approved PT, even though it was legitimate when created.
    const eligibleItems = items.filter((i) => sellerById.get(i.sellerId)?.isApprovedPt);
    return {
      items: eligibleItems.map((i) => ({ ...i, seller: sellerById.get(i.sellerId) ?? null })),
      // `total` is the raw ACTIVE-row count across all pages (matches the
      // COUNT query above), not the eligible-only count — computing the
      // latter exactly would mean resolving every matching row's seller
      // eligibility up front instead of just this page's. Ineligible rows
      // are rare in practice (approval revocation) and are still excluded
      // from `items` on every page, which is what actually matters for
      // buyer-facing correctness; `total` may slightly overstate as a result.
      total,
      page,
      limit,
    };
  },

  async getServiceDetail(id: string) {
    const service = await prisma.personalizedService.findFirst({ where: { id, status: "ACTIVE" } });
    if (!service) throw new ApiError("PERSONALIZED_SERVICE_NOT_FOUND", "Service not found", 404);
    const seller = await personalizedServiceDeps.fetchPtMarketplaceEligibility(service.sellerId);
    return { ...service, seller };
  },

  // ── Purchase (P0 cluster C2/C3) ──────────────────────────────────────────
  /**
   * Starts a gateway checkout instead of an instant wallet-to-wallet transfer. The old path
   * required the buyer's CLIENT wallet to already hold enough balance — but wallet top-up is
   * disabled (the wallet only ever receives refunds/compensation now), so a buyer with a
   * genuinely empty wallet could never purchase at all. The order is created PENDING_PAYMENT
   * and only unlocks Intake once payment-service's webhook confirms payment and calls
   * activateAfterPayment — mirroring exactly how PT-contract and gym-membership purchases
   * already work.
   *
   * Returns the order alongside the gateway's redirect/QR info, not a settled purchase — the
   * caller must send the buyer to `payment.redirectUrl` (or show `payment.qrCodeUrl`), same
   * shape as gym-service's membershipService.purchase.
   */
  async purchaseService(
    serviceId: string, buyerId: string, provider?: string, platform?: "web" | "mobile", returnBaseUrl?: string,
  ) {
    const service = await prisma.personalizedService.findFirst({ where: { id: serviceId, status: "ACTIVE" } });
    if (!service) throw new ApiError("PERSONALIZED_SERVICE_NOT_FOUND", "Service not found or no longer for sale", 404);
    if (service.sellerId === buyerId) {
      throw new ApiError("PERSONALIZED_SERVICE_FORBIDDEN", "You cannot purchase your own service", 403);
    }
    // Defense in depth — createService already gates this, but a PT's
    // approval could theoretically have been revoked since listing.
    await assertApprovedPt(service.sellerId);

    // §XXXVIII — snapshot the service's terms NOW, immutably, onto the order. Rates too
    // (platformRateSnapshot/ptRateSnapshot): a later change to PLATFORM_COMMISSION_RATE must
    // never retroactively change an in-flight or already-settled order's split.
    const order = await prisma.personalizedServiceOrder.create({
      data: {
        serviceId: service.id,
        sellerId: service.sellerId,
        buyerId,
        status: "PENDING_PAYMENT",
        titleSnapshot: service.title,
        descriptionSnapshot: service.description,
        serviceTypeSnapshot: service.serviceType,
        deliverablesSnapshot: service.deliverables as any,
        revisionLimitSnapshot: service.revisionLimit,
        initialDeliveryDaysSnapshot: service.initialDeliveryDays,
        supportWeeksSnapshot: service.supportWeeks,
        priceAtPurchase: service.price,
        platformRateSnapshot: Number(PLATFORM_RATE),
        ptRateSnapshot: 1 - Number(PLATFORM_RATE),
      },
    });

    const idempotencyKey = `personalized-service:${order.id}:checkout:${randomUUID()}`;
    const payment = await personalizedServiceDeps.checkout({
      orderId: order.id,
      sellerId: service.sellerId,
      buyerId,
      amount: service.price,
      platformRate: PLATFORM_RATE,
      idempotencyKey,
      provider,
      orderInfo: `Personalized service ${order.id}`.slice(0, 100),
      platform,
      returnBaseUrl,
    });

    const updated = await prisma.personalizedServiceOrder.update({
      where: { id: order.id },
      data: { paymentTransactionId: payment.transactionId },
    });

    return { order: updated, payment };
  },

  /**
   * Called by payment-service once the gateway's signed webhook confirms payment (see
   * webhook.service.ts's settlePurchase → reconciliation.service.ts's callActivateEndpoint).
   * Verifies the transaction itself rather than trusting the caller blindly — matches
   * contractService.activateAfterPayment's exact discipline. Idempotent: a webhook retry (or
   * the reconciliation sweep) after the order already activated finds nothing PENDING_PAYMENT
   * left to flip and simply returns the current row.
   */
  async activateAfterPayment(orderId: string, transactionId: string) {
    const txn = await personalizedServiceDeps.getTransaction(transactionId);
    if (
      !txn ||
      txn.status !== "PAID" ||
      txn.relatedEntityType !== "PERSONALIZED_SERVICE_PURCHASE" ||
      txn.relatedEntityId !== orderId
    ) {
      throw new ApiError("PERSONALIZED_SERVICE_ACTIVATION_FAILED", "Transaction verification failed", 400);
    }

    // §XIII — never a generic plan handed over immediately: purchase only unlocks Intake,
    // nothing about the actual coaching content yet.
    await prisma.personalizedServiceOrder.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT" },
      data: { status: "INTAKE_PENDING" },
    });
    return prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
  },

  async listMyOrders(buyerId: string) {
    return prisma.personalizedServiceOrder.findMany({ where: { buyerId }, orderBy: { purchasedAt: "desc" } });
  },

  async listOrdersForSeller(sellerId: string) {
    await assertApprovedPt(sellerId);
    return prisma.personalizedServiceOrder.findMany({ where: { sellerId }, orderBy: { purchasedAt: "desc" } });
  },

  async getOrder(orderId: string, requesterId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({
      where: { id: orderId },
      include: { revisionRequests: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== requesterId && order.sellerId !== requesterId) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not part of this order", 403);
    }
    // The buyer always sees their own full intake as entered. The PT sees
    // ONLY fields covered by a category the buyer actually consented to —
    // see filterIntakeDataForPt's doc comment.
    if (requesterId === order.sellerId) {
      return { ...order, intakeData: filterIntakeDataForPt(order.intakeData, order.consentCategories) as any };
    }
    return order;
  },

  // ── Intake + consent (§XIII/§XIV) ────────────────────────────────────────
  async submitIntake(
    orderId: string,
    buyerId: string,
    input: { intakeData: Record<string, unknown>; consentCategories: string[] },
  ) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== buyerId) throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You do not own this order", 403);
    if (order.status !== "INTAKE_PENDING") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot submit intake in status ${order.status}`, 409);
    }
    assertValidConsentCategories(input.consentCategories);
    if (input.consentCategories.length === 0) {
      throw new ApiError("VALIDATION_ERROR", "At least one consent category must be selected to share data with the PT", 400);
    }

    // §XII — this is the ONE call that turns on the entire existing
    // PT-client authorization surface for this pair. If it fails, the whole
    // submission fails — an order must never sit "intake submitted" with no
    // way for the PT to actually be authorized to read it.
    const contractId = await personalizedServiceDeps.createMarketplaceContract({
      ptUserId: order.sellerId,
      clientUserId: order.buyerId,
      packageName: order.titleSnapshot,
      description: order.descriptionSnapshot ?? undefined,
      price: order.priceAtPurchase,
      paymentTransactionId: order.paymentTransactionId ?? undefined,
    });

    const now = new Date();
    const deadline = new Date(now.getTime() + order.initialDeliveryDaysSnapshot * 24 * 60 * 60 * 1000);

    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      data: {
        status: "INTAKE_SUBMITTED",
        intakeData: input.intakeData as any,
        consentCategories: input.consentCategories as any,
        intakeSubmittedAt: now,
        contractId,
        initialDeliveryDeadline: deadline,
      },
    });
  },

  // ── PT workspace (§XV) ───────────────────────────────────────────────────
  async startReview(orderId: string, sellerId: string) {
    const order = await this.assertSellerOwnsOrder(orderId, sellerId);
    if (order.status !== "INTAKE_SUBMITTED") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot start review in status ${order.status}`, 409);
    }
    return prisma.personalizedServiceOrder.update({ where: { id: orderId }, data: { status: "PT_REVIEWING" } });
  },

  async assertSellerOwnsOrder(orderId: string, sellerId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.sellerId !== sellerId) throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not the PT for this order", 403);
    return order;
  },

  async assertBuyerOwnsOrder(orderId: string, buyerId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== buyerId) throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You do not own this order", 403);
    return order;
  },

  // ── Draft delivery (§XVII/§XIX) ──────────────────────────────────────────
  // Every delivery is a NEW immutable version row (personalized_service_plan_versions),
  // never an overwrite — a redelivered revision must not erase what the buyer
  // saw and revised against. Order.draftContent/draftVersion stay as a cheap
  // "latest" pointer for the buyer/PT UIs that only need the current draft.
  async deliverDraft(orderId: string, sellerId: string, draftContent: unknown) {
    const order = await this.assertSellerOwnsOrder(orderId, sellerId);
    if (!["PT_REVIEWING", "IN_PROGRESS", "REVISION_IN_PROGRESS"].includes(order.status)) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot deliver a draft in status ${order.status}`, 409);
    }
    const nextVersion = order.draftVersion + 1;

    // The most recent unresolved revision request (if this delivery is a
    // response to one) becomes this version's changeReason and gets marked
    // resolved — concrete evidence of why v(n) differs from v(n-1).
    const pendingRevision = await prisma.personalizedServiceRevisionRequest.findFirst({
      where: { orderId, resolvedAt: null },
      orderBy: { createdAt: "desc" },
    });

    const [, , updated] = await prisma.$transaction([
      prisma.personalizedServicePlanVersion.updateMany({
        where: { orderId, status: "DELIVERED" },
        data: { status: "SUPERSEDED" },
      }),
      prisma.personalizedServicePlanVersion.create({
        data: {
          orderId,
          version: nextVersion,
          content: draftContent as any,
          status: "DELIVERED",
          createdBy: sellerId,
          changeReason: pendingRevision?.comment,
        },
      }),
      prisma.personalizedServiceOrder.update({
        where: { id: orderId },
        data: {
          status: "DRAFT_DELIVERED",
          draftContent: draftContent as any,
          draftVersion: nextVersion,
          // P0 cluster C3 — starts (or restarts, on a revision redelivery) the auto-accept
          // clock: a PT must not wait forever on a buyer who never responds.
          autoAcceptDeadline: new Date(Date.now() + AUTO_ACCEPT_MS),
        },
      }),
    ]);

    if (pendingRevision) {
      await prisma.personalizedServiceRevisionRequest.update({
        where: { id: pendingRevision.id },
        data: { resolvedAt: new Date() },
      });
    }

    return updated;
  },

  // §XVIII — full version history, buyer or seller only.
  async listPlanVersions(orderId: string, requesterId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== requesterId && order.sellerId !== requesterId) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not part of this order", 403);
    }
    return prisma.personalizedServicePlanVersion.findMany({
      where: { orderId },
      orderBy: { version: "desc" },
    });
  },

  // ── Revision (§XX) ────────────────────────────────────────────────────────
  async requestRevision(orderId: string, buyerId: string, input: { category: string; comment: string }) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    if (order.status !== "DRAFT_DELIVERED") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", "A revision can only be requested after a draft has been delivered", 409);
    }
    if (order.revisionLimitSnapshot != null && order.revisionCount >= order.revisionLimitSnapshot) {
      throw new ApiError(
        "PERSONALIZED_SERVICE_REVISION_LIMIT_REACHED",
        `This package includes ${order.revisionLimitSnapshot} revision(s), already used`,
        409,
      );
    }
    await prisma.personalizedServiceRevisionRequest.create({
      data: { orderId, category: input.category as any, comment: input.comment },
    });
    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      // Leaving DRAFT_DELIVERED under the buyer's own action — the auto-accept clock no
      // longer applies (it restarts fresh on the next deliverDraft).
      data: { status: "REVISION_REQUESTED", revisionCount: { increment: 1 }, autoAcceptDeadline: null },
    });
  },

  async startRevisionWork(orderId: string, sellerId: string) {
    const order = await this.assertSellerOwnsOrder(orderId, sellerId);
    if (order.status !== "REVISION_REQUESTED") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot start revision work in status ${order.status}`, 409);
    }
    return prisma.personalizedServiceOrder.update({ where: { id: orderId }, data: { status: "REVISION_IN_PROGRESS" } });
  },

  // ── Accept (§XXI/§XXII) — the ONE place a personalized plan actually
  // becomes a real, scheduled training program for the buyer. ──────────────
  async acceptOrder(orderId: string, buyerId: string) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    if (order.status !== "DRAFT_DELIVERED") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", "Only a delivered draft can be accepted", 409);
    }
    if (!order.draftContent) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", "No draft content to accept", 422);
    }
    return this.commitAcceptance(order);
  },

  /**
   * The actual "accepted" work: commit the plan, release the PT/platform's held money,
   * advance status. Shared by acceptOrder (the buyer's own click) and the auto-accept sweep
   * (personalized-service-autoaccept-sweep.service.ts, on the buyer's behalf after they went
   * silent past AUTO_ACCEPT_DAYS) — one implementation, so the two paths cannot drift apart
   * the way user-service's session auto-confirm sweep once did from its manual counterpart.
   */
  async commitAcceptance(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    draftContent: unknown;
    draftVersion: number;
    serviceTypeSnapshot: string;
    supportWeeksSnapshot: number | null;
    paymentTransactionId: string | null;
    priceAtPurchase: number;
    platformRateSnapshot: number;
  }) {
    const committed = await personalizedServiceDeps.commitPersonalizedPlan(order.buyerId, order.draftContent);

    const isOngoingCoaching = order.serviceTypeSnapshot === "ONLINE_COACHING" && !!order.supportWeeksSnapshot;
    let [, updated] = await prisma.$transaction([
      prisma.personalizedServicePlanVersion.updateMany({
        where: { orderId: order.id, version: order.draftVersion },
        data: { status: "ACCEPTED" },
      }),
      prisma.personalizedServiceOrder.update({
        where: { id: order.id },
        data: {
          status: isOngoingCoaching ? "ACTIVE" : "ACCEPTED",
          acceptedAt: new Date(),
          committedProgramId: committed.createdProgramId,
          autoAcceptDeadline: null,
        },
      }),
    ]);

    // P0 cluster C3 — release the PT/platform's held money now that delivery has been
    // accepted. Deliberately best-effort: a payment-service outage here must not undo the
    // acceptance the buyer already has (the plan is already committed to their real training
    // cycle) — same reasoning as releaseSessionMoney in user-service. See releaseOrderMoney's
    // own comment for the self-healing retry this feeds.
    const released = await this.releaseOrderMoney(updated);
    return released ?? updated;
  },

  /**
   * The actual money movement behind "accepted" — split out of commitAcceptance so
   * personalized-service-autoaccept-sweep.service.ts's retry pass (any ACCEPTED/ACTIVE order
   * with releasedAt still null) can call the exact same logic, not a second copy of it.
   * releaseOrder's idempotency key is stable per order, so calling this twice for the same
   * order is always safe. Returns the updated row on success, null if there was nothing to
   * release (no paymentTransactionId) or the release itself failed (logged, not thrown — the
   * sweep isolates failures per-row already, and the caller must not lose the acceptance that
   * already happened over a money-side hiccup).
   */
  async releaseOrderMoney(order: {
    id: string;
    sellerId: string;
    buyerId: string;
    paymentTransactionId: string | null;
    priceAtPurchase: number;
    platformRateSnapshot: number;
  }) {
    if (!order.paymentTransactionId) return null;
    try {
      await personalizedServiceDeps.releaseOrder({
        transactionId: order.paymentTransactionId,
        price: order.priceAtPurchase,
        platformRate: order.platformRateSnapshot.toFixed(4),
        parties: { ptUserId: order.sellerId, clientUserId: order.buyerId },
        label: `Personalized service order ${order.id} accepted`,
        idempotencyKey: `PERSONALIZED_RELEASE:${order.id}`,
      });
      return await prisma.personalizedServiceOrder.update({ where: { id: order.id }, data: { releasedAt: new Date() } });
    } catch (err) {
      logger.error({
        error: "Failed to release personalized-service order money after acceptance — will retry",
        orderId: order.id,
        message: (err as Error).message,
      });
      return null;
    }
  },

  /** Called only by the auto-accept sweep's retry pass — see releaseOrderMoney. */
  async retryRelease(order: {
    id: string;
    sellerId: string;
    buyerId: string;
    paymentTransactionId: string | null;
    priceAtPurchase: number;
    platformRateSnapshot: number;
  }) {
    return this.releaseOrderMoney(order);
  },

  async completeOrder(orderId: string, requesterId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== requesterId && order.sellerId !== requesterId) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not part of this order", 403);
    }
    if (!["ACCEPTED", "ACTIVE"].includes(order.status)) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot complete an order in status ${order.status}`, 409);
    }
    return prisma.personalizedServiceOrder.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
  },

  // ── Cancellation (§XXXI/§XXXII — UI must say "Huỷ đơn"/"Yêu cầu hoàn
  // tiền"/"Khiếu nại", never "Trả hàng"; policy enforcement lives here) ─────
  /**
   * P0 cluster C4: this used to just flip status with zero money movement — a buyer who
   * cancelled before the PT ever started work never got their money back at all, because the
   * old wallet-transfer purchase had already paid the seller in full, instantly, at purchase
   * time. Now that payment sits in escrow (pending) until acceptance, cancelling before work
   * starts triggers a full refund from pending back to the client — nothing has been earned
   * yet, so nothing is owed to the seller or the platform.
   */
  async cancelOrder(orderId: string, buyerId: string, reason?: string) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    // Full self-serve cancellation only before the PT has actually started
    // working — matches §XXXII's PURCHASED/INTAKE_PENDING/INTAKE_SUBMITTED
    // "PT chưa bắt đầu" rule (INTAKE_SUBMITTED is included: the PT hasn't
    // called startReview yet, so no work has begun). PENDING_PAYMENT (C2:
    // checkout started but the gateway has not confirmed yet) is included too —
    // nothing has been charged, so cancelling it is a pure status flip either way.
    if (!["PENDING_PAYMENT", "PURCHASED", "INTAKE_PENDING", "INTAKE_SUBMITTED"].includes(order.status)) {
      throw new ApiError(
        "PERSONALIZED_SERVICE_ORDER_INVALID_STATE",
        "This order is already in progress — request a refund or open a dispute instead of cancelling directly",
        409,
      );
    }

    if (order.status !== "PENDING_PAYMENT" && order.paymentTransactionId) {
      await personalizedServiceDeps.refundOrder({
        transactionId: order.paymentTransactionId,
        refundAmount: order.priceAtPurchase,
        platformRate: order.platformRateSnapshot.toFixed(4),
        parties: { ptUserId: order.sellerId, clientUserId: order.buyerId },
        label: `Personalized service order ${order.id} cancelled before work started`,
        idempotencyKey: `PERSONALIZED_REFUND:${order.id}:${order.priceAtPurchase.toFixed(2)}`,
      });
    }

    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
        cumulativeRefundedAmount: order.status === "PENDING_PAYMENT" ? order.cumulativeRefundedAmount : order.priceAtPurchase,
      },
    });
  },

  async requestRefund(orderId: string, buyerId: string, reason: string) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    if (["REFUNDED", "CANCELLED"].includes(order.status)) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", `Cannot request a refund for an order already ${order.status}`, 409);
    }
    if (order.status === "REFUND_REQUESTED") {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_INVALID_STATE", "A refund has already been requested for this order", 409);
    }
    // Recorded as a request, not an automatic instant refund — §XXXII: once
    // the PT has started (PT_REVIEWING onward), a refund is a policy/dispute
    // decision, not a self-serve button. Actually crediting the wallet back
    // reuses payment-service's existing generic POST /internal/payments/:id/refund
    // (see final report) — an explicit admin action (adminResolveRefund
    // below), since this codebase has no automated dispute-adjudication
    // workflow to decide the refund AMOUNT for partially-delivered work.
    // preRefundStatus records what to restore to if the admin denies.
    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      data: {
        status: "REFUND_REQUESTED",
        preRefundStatus: order.status,
        refundRequestedAt: new Date(),
        disputeReason: reason,
      },
    });
  },

  // Admin-only (role checked at controller) — every order currently awaiting
  // refund resolution, across all buyers/sellers. No pagination yet: refund
  // requests are expected to be a low-volume queue, not a firehose.
  async listRefundRequests() {
    return prisma.personalizedServiceOrder.findMany({
      where: { status: "REFUND_REQUESTED" },
      orderBy: { refundRequestedAt: "asc" },
    });
  },

  // §8/§9 of the refund spec — the numbers an admin needs to make an
  // informed, auditable decision. Deliberately does NOT compute a
  // suggested/auto refund amount: Personalized Service purchases settle
  // through the generic wallet-transfer path (AVAILABLE bucket, immediate —
  // see this file's header comment for why, and that payment-service DOES
  // have a real pending/ESCROW mechanism for OTHER purposes), so there is no
  // "amount already earned by the PT" the system can read off a ledger for
  // THIS purchase type — "how much of the PT's work is billable" is a
  // judgment call this system has no factual basis to make automatically
  // yet. What IS shown is real: total paid, already refunded (so the admin
  // can never approve past the ceiling), and delivery milestones reached
  // (draft delivered? accepted?) as descriptive context only.
  async getRefundCalculation(orderId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({
      where: { id: orderId },
      include: { planVersions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    const refundableCeiling = Math.max(0, order.priceAtPurchase - order.cumulativeRefundedAmount);
    return {
      orderId: order.id,
      status: order.status,
      totalPaid: order.priceAtPurchase,
      alreadyRefunded: order.cumulativeRefundedAmount,
      refundableCeiling,
      milestones: {
        intakeSubmitted: !!order.intakeSubmittedAt,
        draftDelivered: order.draftVersion > 0,
        latestVersionStatus: order.planVersions[0]?.status ?? null,
        accepted: !!order.acceptedAt,
      },
      disputeReason: order.disputeReason,
    };
  },

  // Admin-only (enforced at the controller via req.context.role) resolution
  // of a REFUND_REQUESTED order. APPROVE actually moves money through
  // payment-service's real refund endpoint — this is not a status-only
  // action. DENY restores the order to whatever it was before the refund
  // request (preRefundStatus) so coaching/whatever was in progress resumes.
  async adminResolveRefund(
    orderId: string,
    adminUserId: string,
    input: { decision: "APPROVE" | "DENY"; refundAmount?: number; note: string },
  ) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.status !== "REFUND_REQUESTED") {
      throw new ApiError("PERSONALIZED_SERVICE_REFUND_INVALID_STATE", `Order is not awaiting refund resolution (status ${order.status})`, 409);
    }

    if (input.decision === "DENY") {
      return prisma.personalizedServiceOrder.update({
        where: { id: orderId },
        data: {
          status: (order.preRefundStatus as any) ?? "ACTIVE",
          refundDecision: "DENIED",
          refundResolvedBy: adminUserId,
          refundResolvedAt: new Date(),
          refundResolutionNote: input.note,
        },
      });
    }

    // APPROVE
    const refundAmount = input.refundAmount;
    if (refundAmount == null || refundAmount <= 0) {
      throw new ApiError("PERSONALIZED_SERVICE_REFUND_INVALID_AMOUNT", "refundAmount must be a positive number", 400);
    }
    const ceiling = order.priceAtPurchase - order.cumulativeRefundedAmount;
    if (refundAmount > ceiling + 0.01) {
      throw new ApiError(
        "PERSONALIZED_SERVICE_REFUND_INVALID_AMOUNT",
        `refundAmount (${refundAmount}) exceeds the refundable ceiling (${ceiling}) — total paid ${order.priceAtPurchase}, already refunded ${order.cumulativeRefundedAmount}`,
        400,
      );
    }
    if (!order.paymentTransactionId) {
      throw new ApiError("PERSONALIZED_SERVICE_REFUND_FAILED", "This order has no payment transaction to refund", 409);
    }

    // Deterministic per (order, amount) — a duplicate click with the SAME
    // amount replays payment-service's cached result instead of refunding
    // twice; a genuinely different amount (e.g. an admin correcting a
    // mistake) is treated as a new attempt, not silently blocked forever.
    const idempotencyKey = `PERSONALIZED_REFUND:${orderId}:${refundAmount.toFixed(2)}`;

    // P0 cluster C5 — refundOrder (not the old generic refundTransaction) pulls first from
    // whatever the PT/platform still hold in PENDING, then claws back from AVAILABLE, then —
    // only if the PT has already withdrawn past what remains — books the shortfall as a
    // PartnerReceivable debt against them. The client is always made whole regardless of
    // where the money currently sits.
    let result;
    try {
      result = await personalizedServiceDeps.refundOrder({
        transactionId: order.paymentTransactionId,
        refundAmount,
        platformRate: order.platformRateSnapshot.toFixed(4),
        parties: { ptUserId: order.sellerId, clientUserId: order.buyerId },
        label: `Personalized service order ${order.id} admin refund`,
        idempotencyKey,
      });
    } catch (err) {
      if (err instanceof PaymentClientError) {
        throw new ApiError("PERSONALIZED_SERVICE_REFUND_FAILED", `payment-service refund failed: ${err.message}`, err.httpStatus >= 400 && err.httpStatus < 500 ? 409 : 502);
      }
      throw err;
    }

    const newCumulative = order.cumulativeRefundedAmount + refundAmount;
    const isFullyRefunded = newCumulative >= order.priceAtPurchase - 0.01;

    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      data: {
        status: isFullyRefunded ? "REFUNDED" : ((order.preRefundStatus as any) ?? "ACTIVE"),
        cumulativeRefundedAmount: newCumulative,
        refundedAt: isFullyRefunded ? new Date() : order.refundedAt,
        refundDecision: isFullyRefunded ? "APPROVED_FULL" : "APPROVED_PARTIAL",
        refundResolvedBy: adminUserId,
        refundResolvedAt: new Date(),
        refundResolutionNote: `${input.note} (refund ${result.refund}, clawed back pt=${result.clawedBack.pt} platform=${result.clawedBack.platform}${Number(result.shortfall) > 0 ? `, platform shortfall ${result.shortfall} — needs manual attention` : ""})`,
      },
    });
  },

  async openDispute(orderId: string, requesterId: string, reason: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== requesterId && order.sellerId !== requesterId) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not part of this order", 403);
    }
    return prisma.personalizedServiceOrder.update({
      where: { id: orderId },
      data: { status: "DISPUTED", disputedAt: new Date(), disputeReason: reason },
    });
  },

  // ── Weekly check-in (§14/§15) — deterministic only, no AI diagnosis. The
  // pain flag is a plain threshold computed server-side so the PT can trust
  // it without depending on a client-supplied boolean. ─────────────────────
  async submitCheckIn(
    orderId: string,
    buyerId: string,
    input: {
      weekNumber?: number; weight?: number; energyLevel?: number; sleepQuality?: number;
      stressLevel?: number; overallRpe?: number; workoutAdherence?: number; nutritionAdherence?: number;
      painOrDiscomfort?: number; notes?: string;
    },
  ) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    if (!["ACCEPTED", "ACTIVE"].includes(order.status)) {
      throw new ApiError("PERSONALIZED_SERVICE_CHECKIN_INVALID_STATE", "Check-ins are only available once a plan has been accepted", 409);
    }
    const PAIN_ATTENTION_THRESHOLD = 6; // 0-10 scale
    const requiresAttention = (input.painOrDiscomfort ?? 0) >= PAIN_ATTENTION_THRESHOLD;
    return prisma.personalizedServiceCheckIn.create({
      data: { orderId, buyerId, ...input, requiresAttention },
    });
  },

  async listCheckIns(orderId: string, requesterId: string) {
    const order = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("PERSONALIZED_SERVICE_ORDER_NOT_FOUND", "Order not found", 404);
    if (order.buyerId !== requesterId && order.sellerId !== requesterId) {
      throw new ApiError("PERSONALIZED_SERVICE_ORDER_FORBIDDEN", "You are not part of this order", 403);
    }
    return prisma.personalizedServiceCheckIn.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
  },

  // ── Review (§21-23) — buyer-only, one per order, gated to COMPLETED (the
  // safest, most auditable eligibility absent a stronger product rule). ────
  async submitReview(
    orderId: string,
    buyerId: string,
    input: { overallRating: number; communicationRating?: number; personalizationRating?: number; planQualityRating?: number; comment?: string },
  ) {
    const order = await this.assertBuyerOwnsOrder(orderId, buyerId);
    if (order.status !== "COMPLETED") {
      throw new ApiError("PERSONALIZED_SERVICE_REVIEW_NOT_ELIGIBLE", "You can only review a completed service", 409);
    }
    if (input.overallRating < 1 || input.overallRating > 5) {
      throw new ApiError("VALIDATION_ERROR", "overallRating must be between 1 and 5", 400);
    }
    const existing = await prisma.personalizedServiceReview.findUnique({ where: { orderId } });
    if (existing) {
      throw new ApiError("PERSONALIZED_SERVICE_REVIEW_ALREADY_EXISTS", "This order has already been reviewed", 409);
    }
    return prisma.personalizedServiceReview.create({
      data: { orderId, buyerId, sellerId: order.sellerId, ...input },
    });
  },

  async getSellerReviewSummary(sellerId: string) {
    const [agg, recent] = await Promise.all([
      prisma.personalizedServiceReview.aggregate({
        where: { sellerId },
        _avg: { overallRating: true },
        _count: { overallRating: true },
      }),
      prisma.personalizedServiceReview.findMany({
        where: { sellerId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    return {
      averageRating: agg._avg.overallRating ?? 0,
      reviewCount: agg._count.overallRating,
      recentReviews: recent,
    };
  },
};
