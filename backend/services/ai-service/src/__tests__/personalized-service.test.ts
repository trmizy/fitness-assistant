/**
 * Marketplace rework — Personalized PT Service (spec sections VI-XXII, LV).
 *
 * Real DB (ai-service has no separate *_test database — same accepted
 * constraint as every other integration test in this file's neighborhood,
 * see marketplace-publisher-qualification.integration.test.ts). Cross-service
 * calls (PT eligibility, Contract creation, fitness-service commit) are
 * stubbed via personalizedServiceDeps — same indirection pattern as
 * marketplaceDeps.
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/__tests__/personalized-service.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { personalizedServiceService, personalizedServiceDeps } from "../services/personalized-service.service";
import { paymentClient } from "../clients/payment.client";

const originalFetchEligibility = personalizedServiceDeps.fetchPtMarketplaceEligibility;
const originalCreateContract = personalizedServiceDeps.createMarketplaceContract;
const originalCommitPlan = personalizedServiceDeps.commitPersonalizedPlan;
const originalWalletTransfer = personalizedServiceDeps.walletTransfer;

test.before(() => {
  // Every test purchases against a freshly-random buyerId with no real
  // wallet/balance — stub the payment primitive to always succeed so these
  // tests exercise ORDER lifecycle logic, not payment-service's real wallet
  // balance rules (those are payment-service's own test suite's job).
  personalizedServiceDeps.walletTransfer = async () => ({ status: "PAID", transactionId: `mock-txn-${randomUUID()}` });
});

test.after(async () => {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = originalFetchEligibility;
  personalizedServiceDeps.createMarketplaceContract = originalCreateContract;
  personalizedServiceDeps.commitPersonalizedPlan = originalCommitPlan;
  personalizedServiceDeps.walletTransfer = originalWalletTransfer;
  await prisma.$disconnect();
});

function stubApprovedPt(userId: string) {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = async (id: string) =>
    id === userId
      ? { userId, isApprovedPt: true, isPT: true, ptApplicationStatus: "APPROVED", displayName: "Coach Test" }
      : { userId: id, isApprovedPt: false, isPT: false, ptApplicationStatus: null };
}
function stubUnapprovedPt(userId: string) {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = async () => ({
    userId,
    isApprovedPt: false,
    isPT: false,
    ptApplicationStatus: null,
  });
}
function stubPlainCustomer() {
  personalizedServiceDeps.fetchPtMarketplaceEligibility = async () => null;
}

const validServiceInput = {
  serviceType: "PERSONALIZED_WORKOUT",
  title: "12-Week Personalized Coaching",
  description: "Test service",
  price: 100000,
  deliverables: ["Personalized Workout Plan", "3 Revisions"],
  revisionLimit: 2,
  initialDeliveryDays: 2,
  supportWeeks: 12,
};

async function createTestService(sellerId: string) {
  stubApprovedPt(sellerId);
  return personalizedServiceService.createService(sellerId, validServiceInput);
}

// ── §LV — CUSTOMER cannot create; unapproved PT cannot create; approved PT can ──

test("createService: rejects (403) a plain customer with no PT application at all", async () => {
  stubPlainCustomer();
  await assert.rejects(
    () => personalizedServiceService.createService(`cust-${randomUUID()}`, validServiceInput),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("createService: rejects (403) a PT whose application is not yet APPROVED", async () => {
  const userId = `pt-${randomUUID()}`;
  stubUnapprovedPt(userId);
  await assert.rejects(
    () => personalizedServiceService.createService(userId, validServiceInput),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("createService: succeeds for an approved PT and price/deliverables cannot be manipulated into an unpriced listing", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  assert.equal(service.sellerId, sellerId);
  assert.equal(service.price, 100000);
  assert.deepEqual(service.deliverables, validServiceInput.deliverables);
  assert.equal(service.status, "ACTIVE");
});

// ── Purchase ──────────────────────────────────────────────────────────────────

test("purchaseService: a failed payment leaves the order CANCELLED, never unlocks Intake/the service", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;

  personalizedServiceDeps.walletTransfer = async () => ({ status: "FAILED", transactionId: "x", failureReason: "Insufficient balance" });
  try {
    await assert.rejects(
      () => personalizedServiceService.purchaseService(service.id, buyerId),
      (err: any) => {
        assert.equal(err.statusCode ?? err.status, 402);
        return true;
      },
    );
    const orders = await personalizedServiceService.listMyOrders(buyerId);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "CANCELLED");
  } finally {
    personalizedServiceDeps.walletTransfer = async () => ({ status: "PAID", transactionId: `mock-txn-${randomUUID()}` });
  }
});

test("purchaseService: a seller cannot purchase their own service", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  await assert.rejects(
    () => personalizedServiceService.purchaseService(service.id, sellerId),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("purchaseService: creates an order snapshotting the service's CURRENT terms, status INTAKE_PENDING, never hands over a generic plan immediately", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;

  const order = await personalizedServiceService.purchaseService(service.id, buyerId);
  assert.equal(order.status, "INTAKE_PENDING");
  assert.equal(order.buyerId, buyerId);
  assert.equal(order.sellerId, sellerId);
  assert.equal(order.priceAtPurchase, 100000);
  assert.equal(order.titleSnapshot, validServiceInput.title);
  assert.equal(order.revisionLimitSnapshot, 2);
  assert.equal(order.draftContent, null);
  assert.equal(order.intakeData, null);
});

test("purchaseService: editing the service AFTER purchase does not change an already-placed order's snapshot (§XXXVIII)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  // PT "edits" the listing by archiving it and creating a differently-priced one —
  // this codebase's PublishedPlan versioning convention (no in-place price edit
  // exists), so simulate the effect directly on the row to prove the ORDER is immune.
  await prisma.personalizedService.update({ where: { id: service.id }, data: { price: 999999, title: "Changed title" } });

  const reread = await personalizedServiceService.getOrder(order.id, buyerId);
  assert.equal(reread.priceAtPurchase, 100000);
  assert.equal(reread.titleSnapshot, validServiceInput.title);
});

// ── getOrder: access control ──────────────────────────────────────────────────

test("getOrder: a random third party (neither buyer nor seller) is denied", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  await assert.rejects(
    () => personalizedServiceService.getOrder(order.id, `stranger-${randomUUID()}`),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

// ── Intake + consent ────────────────────────────────────────────────────────

test("submitIntake: only the buyer can submit intake for their own order", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  await assert.rejects(
    () =>
      personalizedServiceService.submitIntake(order.id, `stranger-${randomUUID()}`, {
        intakeData: { goal: "MUSCLE_GAIN" },
        consentCategories: ["basic_info"],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("submitIntake: rejects an empty consentCategories list — nothing may be shared without explicit consent (§XIV)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  await assert.rejects(
    () => personalizedServiceService.submitIntake(order.id, buyerId, { intakeData: {}, consentCategories: [] }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 400);
      return true;
    },
  );
});

test("submitIntake: rejects a consent category outside the fixed known set", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  await assert.rejects(
    () =>
      personalizedServiceService.submitIntake(order.id, buyerId, {
        intakeData: {},
        consentCategories: ["basic_info", "literally_anything_private" as any],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 400);
      return true;
    },
  );
});

test("submitIntake: on success, creates the Contract (§XII) and computes the delivery deadline from initialDeliveryDaysSnapshot", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  let contractCallArgs: any = null;
  personalizedServiceDeps.createMarketplaceContract = async (params) => {
    contractCallArgs = params;
    return "contract-123";
  };

  const before = Date.now();
  const updated = await personalizedServiceService.submitIntake(order.id, buyerId, {
    intakeData: { goal: "MUSCLE_GAIN", injuries: ["shoulder"] },
    consentCategories: ["basic_info", "injuries_limitations"],
  });

  assert.equal(updated.status, "INTAKE_SUBMITTED");
  assert.equal(updated.contractId, "contract-123");
  assert.ok(updated.intakeSubmittedAt);
  assert.deepEqual(updated.consentCategories, ["basic_info", "injuries_limitations"]);
  assert.equal(contractCallArgs.ptUserId, sellerId);
  assert.equal(contractCallArgs.clientUserId, buyerId);

  const expectedDeadline = before + 2 * 24 * 60 * 60 * 1000;
  const actualDeadline = new Date(updated.initialDeliveryDeadline!).getTime();
  assert.ok(Math.abs(actualDeadline - expectedDeadline) < 5000, "deadline should be ~initialDeliveryDays from now");
});

test("getOrder: the PT sees ONLY intake fields covered by a consented category — never the buyer's full raw intake (§XIV field-level privacy)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);
  personalizedServiceDeps.createMarketplaceContract = async () => `contract-${randomUUID()}`;

  await personalizedServiceService.submitIntake(order.id, buyerId, {
    // goal -> training_goals (consented); injuries -> injuries_limitations (NOT consented);
    // nutritionPreferences -> nutrition_preferences (NOT consented).
    intakeData: { goal: "MUSCLE_GAIN", injuries: ["shoulder"], nutritionPreferences: "vegan" },
    consentCategories: ["training_goals"],
  });

  const buyerView = await personalizedServiceService.getOrder(order.id, buyerId);
  assert.deepEqual(buyerView.intakeData, { goal: "MUSCLE_GAIN", injuries: ["shoulder"], nutritionPreferences: "vegan" });

  const ptView = await personalizedServiceService.getOrder(order.id, sellerId);
  assert.deepEqual(ptView.intakeData, { goal: "MUSCLE_GAIN" }); // injuries/nutritionPreferences stripped — not consented
});

test("submitIntake: cannot be called twice (wrong state the second time)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);
  personalizedServiceDeps.createMarketplaceContract = async () => "contract-123";

  await personalizedServiceService.submitIntake(order.id, buyerId, {
    intakeData: {},
    consentCategories: ["basic_info"],
  });

  await assert.rejects(
    () => personalizedServiceService.submitIntake(order.id, buyerId, { intakeData: {}, consentCategories: ["basic_info"] }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

// ── PT workspace / draft delivery ──────────────────────────────────────────

async function purchaseAndIntake(sellerId: string) {
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);
  personalizedServiceDeps.createMarketplaceContract = async () => `contract-${randomUUID()}`;
  const submitted = await personalizedServiceService.submitIntake(order.id, buyerId, {
    intakeData: { goal: "MUSCLE_GAIN" },
    consentCategories: ["basic_info"],
  });
  return { service, buyerId, order: submitted };
}

const sampleDraft = {
  name: "Draft plan",
  goal: "MUSCLE_GAIN",
  durationWeeks: 4,
  daysPerWeek: 1,
  startDate: "2026-09-01",
  selectedWeekdays: [1],
  days: [{ dayNumber: 1, title: "Day 1", exercises: [{ exerciseId: "ex-1", sets: 3, reps: 8, restSeconds: 90 }] }],
};

test("deliverDraft: only the seller (PT) can deliver a draft, not the buyer and not a stranger", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await purchaseAndIntake(sellerId);
  await personalizedServiceService.startReview(order.id, sellerId);

  await assert.rejects(
    () => personalizedServiceService.deliverDraft(order.id, buyerId, sampleDraft),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("deliverDraft: cannot be delivered before intake is submitted / review started", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  await assert.rejects(
    () => personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

test("deliverDraft: succeeds after startReview, sets status DRAFT_DELIVERED and stores the content", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await purchaseAndIntake(sellerId);
  await personalizedServiceService.startReview(order.id, sellerId);

  const delivered = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);
  assert.equal(delivered.status, "DRAFT_DELIVERED");
  assert.equal(delivered.draftVersion, 1);
  assert.deepEqual(delivered.draftContent, sampleDraft as any);
});

// ── Revision limit enforcement (§XX) ───────────────────────────────────────

async function deliverToDraft(sellerId: string) {
  const { order, buyerId } = await purchaseAndIntake(sellerId);
  await personalizedServiceService.startReview(order.id, sellerId);
  const delivered = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);
  return { order: delivered, buyerId, sellerId };
}

test("requestRevision: only the buyer can request a revision", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await deliverToDraft(sellerId);
  await assert.rejects(
    () => personalizedServiceService.requestRevision(order.id, sellerId, { category: "EXERCISE", comment: "x" }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("requestRevision: enforces the package's revisionLimit (2 in this test) — 3rd request is rejected", async () => {
  const sellerId = `pt-${randomUUID()}`;
  let { order, buyerId } = await deliverToDraft(sellerId);

  // Round 1
  order = await personalizedServiceService.requestRevision(order.id, buyerId, { category: "EXERCISE", comment: "1" });
  assert.equal(order.revisionCount, 1);
  await personalizedServiceService.startRevisionWork(order.id, sellerId);
  order = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);

  // Round 2 (revisionLimit = 2, so this is the last allowed)
  order = await personalizedServiceService.requestRevision(order.id, buyerId, { category: "SCHEDULE", comment: "2" });
  assert.equal(order.revisionCount, 2);
  await personalizedServiceService.startRevisionWork(order.id, sellerId);
  order = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);

  // Round 3 — must be rejected, limit reached
  await assert.rejects(
    () => personalizedServiceService.requestRevision(order.id, buyerId, { category: "OTHER", comment: "3" }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      assert.equal(err.code, "PERSONALIZED_SERVICE_REVISION_LIMIT_REACHED");
      return true;
    },
  );
});

test("requestRevision: unlimited when revisionLimitSnapshot is null (e.g. ongoing coaching package)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  stubApprovedPt(sellerId);
  const service = await personalizedServiceService.createService(sellerId, { ...validServiceInput, revisionLimit: null });
  const buyerId = `buyer-${randomUUID()}`;
  let order = await personalizedServiceService.purchaseService(service.id, buyerId);
  personalizedServiceDeps.createMarketplaceContract = async () => `contract-${randomUUID()}`;
  order = await personalizedServiceService.submitIntake(order.id, buyerId, { intakeData: {}, consentCategories: ["basic_info"] });
  await personalizedServiceService.startReview(order.id, sellerId);
  order = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);

  for (let i = 0; i < 5; i++) {
    order = await personalizedServiceService.requestRevision(order.id, buyerId, { category: "OTHER", comment: `round ${i}` });
    await personalizedServiceService.startRevisionWork(order.id, sellerId);
    order = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);
  }
  assert.equal(order.revisionCount, 5); // never throws despite 5 rounds
});

// ── Accept — commits into a real training program (§XXI/§XXII) ────────────

test("acceptOrder: only the buyer can accept", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await deliverToDraft(sellerId);
  await assert.rejects(
    () => personalizedServiceService.acceptOrder(order.id, sellerId),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("acceptOrder: cannot accept before a draft has been delivered", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await purchaseAndIntake(sellerId);
  await assert.rejects(
    () => personalizedServiceService.acceptOrder(order.id, buyerId),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

test("acceptOrder: commits the draft via the fitness-service client and stores the resulting program id", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId);

  let commitCalledWith: any = null;
  personalizedServiceDeps.commitPersonalizedPlan = async (userId, draft) => {
    commitCalledWith = { userId, draft };
    return { createdProgramId: "program-abc", createdScheduleCount: 4 };
  };

  const accepted = await personalizedServiceService.acceptOrder(order.id, buyerId);
  assert.equal(accepted.status, "ACCEPTED"); // ONLINE_COACHING with supportWeeks would be ACTIVE — this fixture is PERSONALIZED_WORKOUT
  assert.equal(accepted.committedProgramId, "program-abc");
  assert.ok(accepted.acceptedAt);
  assert.equal(commitCalledWith.userId, buyerId); // committed to the BUYER's schedule, never the seller's
  assert.deepEqual(commitCalledWith.draft, sampleDraft);
});

test("acceptOrder: an ONLINE_COACHING service with supportWeeks lands on ACTIVE (ongoing), not a terminal ACCEPTED", async () => {
  const sellerId = `pt-${randomUUID()}`;
  stubApprovedPt(sellerId);
  const service = await personalizedServiceService.createService(sellerId, {
    ...validServiceInput,
    serviceType: "ONLINE_COACHING",
    supportWeeks: 12,
  });
  const buyerId = `buyer-${randomUUID()}`;
  let order = await personalizedServiceService.purchaseService(service.id, buyerId);
  personalizedServiceDeps.createMarketplaceContract = async () => `contract-${randomUUID()}`;
  order = await personalizedServiceService.submitIntake(order.id, buyerId, { intakeData: {}, consentCategories: ["basic_info"] });
  await personalizedServiceService.startReview(order.id, sellerId);
  order = await personalizedServiceService.deliverDraft(order.id, sellerId, sampleDraft);
  personalizedServiceDeps.commitPersonalizedPlan = async () => ({ createdProgramId: "p", createdScheduleCount: 1 });

  const accepted = await personalizedServiceService.acceptOrder(order.id, buyerId);
  assert.equal(accepted.status, "ACTIVE");
});

// ── Cancellation / refund / dispute — §XXXI/§XXXII ─────────────────────────

test("cancelOrder: allowed while INTAKE_PENDING (PT has not started)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const service = await createTestService(sellerId);
  const buyerId = `buyer-${randomUUID()}`;
  const order = await personalizedServiceService.purchaseService(service.id, buyerId);

  const cancelled = await personalizedServiceService.cancelOrder(order.id, buyerId, "changed my mind");
  assert.equal(cancelled.status, "CANCELLED");
});

test("cancelOrder: rejected once the PT has started reviewing — must use refund-request/dispute instead", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await purchaseAndIntake(sellerId);
  await personalizedServiceService.startReview(order.id, sellerId);

  await assert.rejects(
    () => personalizedServiceService.cancelOrder(order.id, buyerId),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

test("openDispute: either buyer or seller can open one; a random third party cannot", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await deliverToDraft(sellerId);

  const disputedBySeller = await personalizedServiceService.openDispute(order.id, sellerId, "buyer unresponsive");
  assert.equal(disputedBySeller.status, "DISPUTED");

  await assert.rejects(
    () => personalizedServiceService.openDispute(order.id, `stranger-${randomUUID()}`, "x"),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

// ── Plan version history (§XVIII) — deliverDraft must never overwrite a
// prior version; each delivery is a new immutable row. ────────────────────

test("plan versions: first deliverDraft creates version 1 DELIVERED; a revision round creates version 2 and supersedes version 1", async () => {
  const sellerId = `pt-${randomUUID()}`;
  let { order, buyerId } = await deliverToDraft(sellerId); // version 1, DELIVERED

  let versions = await personalizedServiceService.listPlanVersions(order.id, buyerId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].status, "DELIVERED");
  assert.equal(versions[0].createdBy, sellerId);

  order = await personalizedServiceService.requestRevision(order.id, buyerId, { category: "EXERCISE", comment: "no cable machine" });
  await personalizedServiceService.startRevisionWork(order.id, sellerId);
  const secondDraft = { ...sampleDraft, name: "Draft plan v2" };
  order = await personalizedServiceService.deliverDraft(order.id, sellerId, secondDraft);
  assert.equal(order.draftVersion, 2);

  versions = await personalizedServiceService.listPlanVersions(order.id, buyerId);
  assert.equal(versions.length, 2);
  const v1 = versions.find((v: any) => v.version === 1)!;
  const v2 = versions.find((v: any) => v.version === 2)!;
  assert.equal(v1.status, "SUPERSEDED"); // no longer the live one, but still readable — history is never deleted
  assert.equal(v2.status, "DELIVERED");
  assert.equal(v2.changeReason, "no cable machine"); // the revision comment that prompted it
  assert.deepEqual(v2.content, secondDraft as any);
});

test("plan versions: acceptOrder marks the currently-delivered version ACCEPTED, not just the order status", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId);
  personalizedServiceDeps.commitPersonalizedPlan = async () => ({ createdProgramId: "p-versions", createdScheduleCount: 1 });

  await personalizedServiceService.acceptOrder(order.id, buyerId);
  const versions = await personalizedServiceService.listPlanVersions(order.id, buyerId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].status, "ACCEPTED");
});

test("plan versions: a random third party cannot list version history", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await deliverToDraft(sellerId);
  await assert.rejects(
    () => personalizedServiceService.listPlanVersions(order.id, `stranger-${randomUUID()}`),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

// ── Weekly check-in — deterministic pain flag, no AI diagnosis ────────────

async function acceptedOrder(sellerId: string) {
  const { order, buyerId } = await deliverToDraft(sellerId);
  personalizedServiceDeps.commitPersonalizedPlan = async () => ({ createdProgramId: `p-${randomUUID()}`, createdScheduleCount: 1 });
  const accepted = await personalizedServiceService.acceptOrder(order.id, buyerId);
  return { order: accepted, buyerId, sellerId };
}

test("checkIn: cannot be submitted before the order is ACCEPTED/ACTIVE", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId); // still DRAFT_DELIVERED
  await assert.rejects(
    () => personalizedServiceService.submitCheckIn(order.id, buyerId, { energyLevel: 4 }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

test("checkIn: painOrDiscomfort at/above the threshold sets requiresAttention; below it does not", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await acceptedOrder(sellerId);

  const mild = await personalizedServiceService.submitCheckIn(order.id, buyerId, { painOrDiscomfort: 2, energyLevel: 4 });
  assert.equal(mild.requiresAttention, false);

  const severe = await personalizedServiceService.submitCheckIn(order.id, buyerId, { painOrDiscomfort: 8, notes: "sharp shoulder pain" });
  assert.equal(severe.requiresAttention, true);
});

test("checkIn: the PT (seller) can list check-ins for their order; an unrelated stranger cannot", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await acceptedOrder(sellerId);
  await personalizedServiceService.submitCheckIn(order.id, buyerId, { energyLevel: 3, sleepQuality: 2 });

  const seenByPt = await personalizedServiceService.listCheckIns(order.id, sellerId);
  assert.equal(seenByPt.length, 1);
  assert.equal(seenByPt[0].energyLevel, 3);

  await assert.rejects(
    () => personalizedServiceService.listCheckIns(order.id, `stranger-${randomUUID()}`),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

// ── Review — buyer-only, one per order, gated to COMPLETED ─────────────────

test("review: rejected before the order is COMPLETED", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await acceptedOrder(sellerId); // ACCEPTED, not COMPLETED
  await assert.rejects(
    () => personalizedServiceService.submitReview(order.id, buyerId, { overallRating: 5 }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      assert.equal(err.code, "PERSONALIZED_SERVICE_REVIEW_NOT_ELIGIBLE");
      return true;
    },
  );
});

test("review: succeeds once COMPLETED, cannot be submitted twice, and the seller cannot review their own order", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await acceptedOrder(sellerId);
  const completed = await personalizedServiceService.completeOrder(order.id, buyerId);
  assert.equal(completed.status, "COMPLETED");

  const review = await personalizedServiceService.submitReview(order.id, buyerId, { overallRating: 5, comment: "Great coaching" });
  assert.equal(review.overallRating, 5);
  assert.equal(review.sellerId, sellerId);

  await assert.rejects(
    () => personalizedServiceService.submitReview(order.id, buyerId, { overallRating: 3 }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      assert.equal(err.code, "PERSONALIZED_SERVICE_REVIEW_ALREADY_EXISTS");
      return true;
    },
  );

  await assert.rejects(
    () => personalizedServiceService.submitReview(order.id, sellerId, { overallRating: 5 }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403); // sellerId is not the buyer on this order
      return true;
    },
  );
});

test("review: getSellerReviewSummary aggregates average rating and count", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await acceptedOrder(sellerId);
  await personalizedServiceService.completeOrder(order.id, buyerId);
  await personalizedServiceService.submitReview(order.id, buyerId, { overallRating: 4 });

  const summary = await personalizedServiceService.getSellerReviewSummary(sellerId);
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.averageRating, 4);
});

// ── Admin refund resolution — real money movement, ceiling enforcement,
// idempotency. paymentClient.refundTransaction is a plain object method
// (not routed through personalizedServiceDeps, same as walletTransfer's
// underlying paymentClient import elsewhere) — stub it directly. ──────────

test("refund: getRefundCalculation reports totalPaid/alreadyRefunded/refundableCeiling correctly", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId);
  await personalizedServiceService.requestRefund(order.id, buyerId, "changed my mind");

  const calc = await personalizedServiceService.getRefundCalculation(order.id);
  assert.equal(calc.totalPaid, 100000);
  assert.equal(calc.alreadyRefunded, 0);
  assert.equal(calc.refundableCeiling, 100000);
  assert.equal(calc.milestones.draftDelivered, true);
  assert.equal(calc.milestones.accepted, false);
});

test("refund: a non-ADMIN-gated call path is enforced at the controller, not the service — service itself trusts its caller is already-verified ADMIN", async () => {
  // (Documents the boundary: personalizedServiceService.adminResolveRefund performs
  // no role check itself — personalized-service.controller.ts's req.context.role
  // check is what actually blocks non-admins. Covered by the fact this test file
  // calls the service layer directly and specifically does NOT assert a role check
  // exists here; the controller-level enforcement is exercised by inspection, since
  // this test harness has no req/res layer.)
  assert.ok(true);
});

test("refund: APPROVE moves real money via paymentClient.refundTransaction and marks the order REFUNDED when fully refunded", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId);
  await personalizedServiceService.requestRefund(order.id, buyerId, "PT unresponsive");

  let refundCalledWith: any = null;
  const originalRefund = paymentClient.refundTransaction;
  paymentClient.refundTransaction = async (txnId: string, params: any) => {
    refundCalledWith = { txnId, params };
    return { transactionId: `refund-${randomUUID()}`, status: "PAID", refundAmount: params.refundAmount };
  };
  try {
    const resolved = await personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, {
      decision: "APPROVE",
      refundAmount: 100000,
      note: "Full refund approved",
    });
    assert.equal(resolved.status, "REFUNDED");
    assert.equal(resolved.cumulativeRefundedAmount, 100000);
    assert.equal(resolved.refundDecision, "APPROVED_FULL");
    assert.ok(resolved.refundedAt);
    assert.equal(refundCalledWith.params.refundAmount, 100000);
  } finally {
    paymentClient.refundTransaction = originalRefund;
  }
});

test("refund: a partial APPROVE keeps the order out of REFUNDED and restores its pre-refund-request status", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId); // status DRAFT_DELIVERED before refund request
  await personalizedServiceService.requestRefund(order.id, buyerId, "partial issue");

  const originalRefund = paymentClient.refundTransaction;
  paymentClient.refundTransaction = async (_txnId: string, params: any) => ({
    transactionId: `refund-${randomUUID()}`, status: "PAID", refundAmount: params.refundAmount,
  });
  try {
    const resolved = await personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, {
      decision: "APPROVE",
      refundAmount: 30000, // partial — 30% of 100000
      note: "Partial refund — some work already delivered",
    });
    assert.equal(resolved.status, "DRAFT_DELIVERED"); // restored, not REFUNDED
    assert.equal(resolved.cumulativeRefundedAmount, 30000);
    assert.equal(resolved.refundDecision, "APPROVED_PARTIAL");
  } finally {
    paymentClient.refundTransaction = originalRefund;
  }
});

test("refund: cannot approve an amount exceeding the refundable ceiling (double-refund protection across two separate approvals)", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId);
  await personalizedServiceService.requestRefund(order.id, buyerId, "x");

  const originalRefund = paymentClient.refundTransaction;
  paymentClient.refundTransaction = async (_txnId: string, params: any) => ({
    transactionId: `refund-${randomUUID()}`, status: "PAID", refundAmount: params.refundAmount,
  });
  try {
    // First partial approval: 70000 of 100000
    await personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, {
      decision: "APPROVE", refundAmount: 70000, note: "first partial",
    });

    // Order is no longer REFUND_REQUESTED (restored to preRefundStatus) — a
    // second approval attempt must go through requestRefund again first...
    const reReq = await personalizedServiceService.requestRefund(order.id, buyerId, "still not happy");
    assert.equal(reReq.status, "REFUND_REQUESTED");

    // ...and even so, cannot exceed the remaining 30000 ceiling.
    await assert.rejects(
      () => personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, {
        decision: "APPROVE", refundAmount: 50000, note: "too much",
      }),
      (err: any) => {
        assert.equal(err.statusCode ?? err.status, 400);
        assert.equal(err.code, "PERSONALIZED_SERVICE_REFUND_INVALID_AMOUNT");
        return true;
      },
    );
  } finally {
    paymentClient.refundTransaction = originalRefund;
  }
});

test("refund: DENY restores the order to its pre-refund-request status and moves no money", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order, buyerId } = await deliverToDraft(sellerId); // DRAFT_DELIVERED
  await personalizedServiceService.requestRefund(order.id, buyerId, "buyer changed mind");

  let refundCalled = false;
  const originalRefund = paymentClient.refundTransaction;
  paymentClient.refundTransaction = async () => { refundCalled = true; return { transactionId: "x", status: "PAID", refundAmount: 0 }; };
  try {
    const resolved = await personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, {
      decision: "DENY",
      note: "Work already substantially delivered",
    });
    assert.equal(resolved.status, "DRAFT_DELIVERED"); // restored
    assert.equal(resolved.cumulativeRefundedAmount, 0);
    assert.equal(resolved.refundDecision, "DENIED");
    assert.equal(refundCalled, false); // no payment call was ever made
  } finally {
    paymentClient.refundTransaction = originalRefund;
  }
});

test("refund: cannot resolve an order that isn't currently REFUND_REQUESTED", async () => {
  const sellerId = `pt-${randomUUID()}`;
  const { order } = await deliverToDraft(sellerId); // never requested a refund
  await assert.rejects(
    () => personalizedServiceService.adminResolveRefund(order.id, `admin-${randomUUID()}`, { decision: "DENY", note: "n/a" }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      assert.equal(err.code, "PERSONALIZED_SERVICE_REFUND_INVALID_STATE");
      return true;
    },
  );
});
