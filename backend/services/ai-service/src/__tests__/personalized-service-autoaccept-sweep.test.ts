/**
 * P0 cluster C3 — the auto-accept sweep must (a) find orders whose review window has lapsed
 * and auto-accept them through the exact same commitAcceptance logic the buyer's own click
 * uses, (b) leave orders whose deadline has not passed alone, (c) isolate one bad order's
 * failure from the rest of the batch, and (d) retry a release that failed on its first
 * attempt for an already-ACCEPTED order.
 *
 * Real DB (ai-service has no separate *_test database — see personalized-service.test.ts's
 * own header comment for why).
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/__tests__/personalized-service-autoaccept-sweep.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { personalizedServiceService, personalizedServiceDeps } from "../services/personalized-service.service";
import { runAutoAcceptSweep } from "../services/personalized-service-autoaccept-sweep.service";

const originalFetch = personalizedServiceDeps.fetchPtMarketplaceEligibility;
const originalCommit = personalizedServiceDeps.commitPersonalizedPlan;
const originalRelease = personalizedServiceDeps.releaseOrder;
const originalCheckout = personalizedServiceDeps.checkout;
const originalGetTransaction = personalizedServiceDeps.getTransaction;

function stubApprovedPt(userId: string) {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = async (id: string) =>
    id === userId
      ? { userId, isApprovedPt: true, isPT: true, ptApplicationStatus: "APPROVED", displayName: "Coach Test" }
      : { userId: id, isApprovedPt: false, isPT: false, ptApplicationStatus: null };
}

test.before(() => {
  personalizedServiceDeps.checkout = async (params) => ({
    transactionId: `mock-txn-${params.orderId}`,
    status: "PENDING",
    redirectUrl: "https://mock-gateway.test/pay",
    qrCodeUrl: null,
    provider: "MOCK",
  });
  personalizedServiceDeps.getTransaction = async (transactionId: string) => ({
    id: transactionId,
    status: "PAID",
    relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE",
    relatedEntityId: transactionId.replace("mock-txn-", ""),
  });
});

test.after(async () => {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = originalFetch;
  personalizedServiceDeps.commitPersonalizedPlan = originalCommit;
  personalizedServiceDeps.releaseOrder = originalRelease;
  personalizedServiceDeps.checkout = originalCheckout;
  personalizedServiceDeps.getTransaction = originalGetTransaction;
  await prisma.$disconnect();
});

const validServiceInput = {
  serviceType: "PERSONALIZED_WORKOUT",
  title: "Sweep test coaching",
  description: "x",
  price: 100000,
  deliverables: ["Plan"],
  revisionLimit: 2,
  initialDeliveryDays: 2,
  supportWeeks: null,
};

const sampleDraft = {
  name: "Draft plan",
  goal: "MUSCLE_GAIN",
  durationWeeks: 4,
  daysPerWeek: 1,
  startDate: "2026-09-01",
  selectedWeekdays: [1],
  days: [{ dayNumber: 1, title: "Day 1", exercises: [{ exerciseId: "ex-1", sets: 3, reps: 8, restSeconds: 90 }] }],
};

/** A DRAFT_DELIVERED order whose autoAcceptDeadline is forced into the past (or future) —
 * bypasses deliverDraft's own "now + AUTO_ACCEPT_DAYS" so tests do not need to wait real days. */
async function makeDraftDeliveredOrder(sellerId: string, deadline: Date) {
  stubApprovedPt(sellerId);
  const service = await personalizedServiceService.createService(sellerId, validServiceInput);
  const buyerId = `buyer-${randomUUID()}`;
  const { order, payment } = await personalizedServiceService.purchaseService(service.id, buyerId);
  await personalizedServiceService.activateAfterPayment(order.id, payment.transactionId);
  personalizedServiceDeps.createMarketplaceContract = async () => `contract-${randomUUID()}`;
  await personalizedServiceService.submitIntake(order.id, buyerId, { intakeData: {}, consentCategories: ["basic_info"] });
  await personalizedServiceService.startReview(order.id, sellerId);
  await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);
  const backdated = await prisma.personalizedServiceOrder.update({ where: { id: order.id }, data: { autoAcceptDeadline: deadline } });
  return { order: backdated, buyerId, sellerId };
}

test("runAutoAcceptSweep: auto-accepts a DRAFT_DELIVERED order past its deadline — same commitAcceptance path acceptOrder uses", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await makeDraftDeliveredOrder(sellerId, new Date(Date.now() - 60_000)); // 1 min past deadline

  let commitCalledWith: any = null;
  personalizedServiceDeps.commitPersonalizedPlan = async (userId, draft) => {
    commitCalledWith = { userId, draft };
    return { createdProgramId: "auto-program", createdScheduleCount: 1 };
  };
  let releaseCalled = false;
  personalizedServiceDeps.releaseOrder = async () => {
    releaseCalled = true;
    return { released: { pt: "90000.00", platform: "10000.00" } };
  };

  const result = await runAutoAcceptSweep();
  assert.ok(result.autoAccepted >= 1);

  const reread = await prisma.personalizedServiceOrder.findUnique({ where: { id: order.id } });
  assert.equal(reread!.status, "ACCEPTED");
  assert.ok(reread!.acceptedAt);
  assert.ok(reread!.releasedAt);
  assert.equal(reread!.autoAcceptDeadline, null);
  assert.equal(commitCalledWith.userId, order.buyerId);
  assert.equal(releaseCalled, true);
});

test("runAutoAcceptSweep: leaves a DRAFT_DELIVERED order whose deadline has not passed yet alone", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await makeDraftDeliveredOrder(sellerId, new Date(Date.now() + 60 * 60 * 1000)); // 1h in the future
  personalizedServiceDeps.commitPersonalizedPlan = async () => ({ createdProgramId: "should-not-run", createdScheduleCount: 1 });

  await runAutoAcceptSweep();

  const reread = await prisma.personalizedServiceOrder.findUnique({ where: { id: order.id } });
  assert.equal(reread!.status, "DRAFT_DELIVERED", "must not touch an order still inside its review window");
});

test("runAutoAcceptSweep: one order's auto-accept failure does not block the rest of the batch", async () => {
  const sellerA = `pt-${randomUUID()}`;
  const sellerB = `pt-${randomUUID()}`;
  const { order: orderA } = await makeDraftDeliveredOrder(sellerA, new Date(Date.now() - 60_000));
  const { order: orderB } = await makeDraftDeliveredOrder(sellerB, new Date(Date.now() - 60_000));

  personalizedServiceDeps.commitPersonalizedPlan = async (userId) => {
    if (userId === orderA.buyerId) throw new Error("fitness-service unreachable");
    return { createdProgramId: "program-b", createdScheduleCount: 1 };
  };
  personalizedServiceDeps.releaseOrder = async () => ({ released: { pt: "90000.00", platform: "10000.00" } });

  await runAutoAcceptSweep();

  const rereadA = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderA.id } });
  const rereadB = await prisma.personalizedServiceOrder.findUnique({ where: { id: orderB.id } });
  assert.equal(rereadA!.status, "DRAFT_DELIVERED", "the failing order stays put for the next tick, not silently dropped");
  assert.equal(rereadB!.status, "ACCEPTED", "a sibling order's failure must not block this one");
});

test("runAutoAcceptSweep: retries release for an ACCEPTED order whose first release attempt failed", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await makeDraftDeliveredOrder(sellerId, new Date(Date.now() - 60_000));
  personalizedServiceDeps.commitPersonalizedPlan = async () => ({ createdProgramId: "p", createdScheduleCount: 1 });
  personalizedServiceDeps.releaseOrder = async () => {
    throw new Error("payment-service unreachable");
  };

  await runAutoAcceptSweep(); // auto-accepts, but release fails and is swallowed
  const midway = await prisma.personalizedServiceOrder.findUnique({ where: { id: order.id } });
  assert.equal(midway!.status, "ACCEPTED");
  assert.equal(midway!.releasedAt, null, "release genuinely failed on the first attempt");

  let releaseRetryCalled = false;
  personalizedServiceDeps.releaseOrder = async () => {
    releaseRetryCalled = true;
    return { released: { pt: "90000.00", platform: "10000.00" } };
  };
  const result = await runAutoAcceptSweep();
  assert.ok(result.releaseRetried >= 1);
  assert.equal(releaseRetryCalled, true);

  const final = await prisma.personalizedServiceOrder.findUnique({ where: { id: order.id } });
  assert.ok(final!.releasedAt, "the sweep's retry pass must pick up the unreleased order on its own");
});
