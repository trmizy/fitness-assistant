/**
 * FH-5 / R2 - ai-service half. A buyer cancels a personalized-service order while it is still PENDING_PAYMENT, THEN
 * the gateway's PAID callback reaches payment-service, which (having already put the price in escrow) calls
 * /internal/personalized-service/orders/:id/activate-after-payment.
 *
 * Before: updateMany(where PENDING_PAYMENT) matched nothing for the CANCELLED order and the route still answered
 * 200 { success: true } -> payment-service marked the transaction ACTIVATED and the money sat in escrow forever.
 * Now: 409 { error: { code: "NOT_ACTIVATABLE" } }, which payment-service turns into a full refund
 * (payment-service/src/__tests__/fh5-cancelled-target-refund.integration.test.ts pins that side).
 *
 * BACKEND INTEGRATION against the isolated ai test DB, with a REAL express app serving the real internal router.
 * Run (from backend/services/ai-service):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_fhc_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true INTERNAL_SERVICE_SECRET=fh5-test-secret npx tsx --test src/__tests__/personalized-service-fh5-not-activatable.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const dbName = (() => {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
})();
const skipOpts = { skip: /_test$/.test(dbName) ? false : `Refusing to touch a database not ending in _test (got "${dbName || "<unset>"}")` };

process.env.INTERNAL_SERVICE_SECRET ||= "fh5-test-secret";
const SECRET = process.env.INTERNAL_SERVICE_SECRET;

type Mods = {
  prisma: (typeof import("../repositories/conversation.repository"))["prisma"];
  svc: (typeof import("../services/personalized-service.service"))["personalizedServiceService"];
  deps: (typeof import("../services/personalized-service.service"))["personalizedServiceDeps"];
  router: (typeof import("../routes/internal.routes"))["default"];
};
let mods: Mods | undefined;
let server: http.Server | undefined;
let baseUrl = "";

async function load(): Promise<Mods> {
  if (mods) return mods;
  const service = await import("../services/personalized-service.service");
  mods = {
    prisma: (await import("../repositories/conversation.repository")).prisma,
    svc: service.personalizedServiceService,
    deps: service.personalizedServiceDeps,
    router: (await import("../routes/internal.routes")).default,
  };
  const app = express();
  app.use(express.json());
  app.use("/internal", mods.router);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code, message: err.message } }));
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return mods;
}

test.after(async () => {
  server?.close();
  if (mods) await mods.prisma.$disconnect();
});

async function activateOverHttp(orderId: string, transactionId: string) {
  const res = await fetch(`${baseUrl}/internal/personalized-service/orders/${orderId}/activate-after-payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-secret": SECRET! },
    body: JSON.stringify({ transactionId }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** A fresh order straight from purchaseService (checkout stubbed, as in personalized-service.test.ts). */
async function newOrder(m: Mods) {
  const sellerId = `pt-${randomUUID()}`;
  m.deps.fetchPtMarketplaceEligibility = async (id: string) => ({
    userId: id, isApprovedPt: true, isPT: true, ptApplicationStatus: "APPROVED", displayName: "Coach Test",
  }) as any;
  const service = await m.svc.createService(sellerId, {
    serviceType: "PERSONALIZED_WORKOUT",
    title: "FH5 service",
    description: "Test service",
    price: 100000,
    deliverables: ["Plan"],
    revisionLimit: 2,
    initialDeliveryDays: 2,
    supportWeeks: 12,
  } as any);
  const buyerId = `buyer-${randomUUID()}`;
  m.deps.hasStandingPtContract = async () => false; // BR-27 pre-payment check: no standing PT contract in these tests
  m.deps.checkout = async (params: any) => ({
    transactionId: `mock-txn-${params.orderId}`, status: "PENDING", redirectUrl: "https://mock-gateway.test/pay", qrCodeUrl: null, provider: "MOCK",
  }) as any;
  m.deps.getTransaction = async (transactionId: string) => ({
    id: transactionId, status: "PAID", relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE", relatedEntityId: transactionId.replace("mock-txn-", ""),
  }) as any;
  m.deps.refundOrder = async (params: any) => ({ refund: params.refundAmount.toFixed(2), clawedBack: { pt: "0.00", platform: "0.00" }, shortfall: "0.00" }) as any;
  const { order, payment } = await m.svc.purchaseService(service.id, buyerId);
  return { order, txn: payment.transactionId as string, buyerId };
}

test("cancelled while PENDING_PAYMENT, then paid: activate answers 409 NOT_ACTIVATABLE (not 200), order stays CANCELLED", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  await m.svc.cancelOrder(order.id, buyerId, "changed my mind"); // pure status flip - nothing was charged yet

  const res = await activateOverHttp(order.id, txn);

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, "NOT_ACTIVATABLE");
  assert.equal(res.body.error.currentStatus, "CANCELLED");
  const reread = await m.prisma.personalizedServiceOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(reread.status, "CANCELLED", "must not resurrect a cancelled order");

  // payment-service retries / a concurrent callback get the same definite answer, still no activation.
  const again = await activateOverHttp(order.id, txn);
  assert.equal(again.status, 409);
});

test("normal payment: 200, INTAKE_PENDING; a redelivered callback is still an idempotent 200", skipOpts, async () => {
  const m = await load();
  const { order, txn } = await newOrder(m);

  const first = await activateOverHttp(order.id, txn);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, "INTAKE_PENDING");

  const replay = await activateOverHttp(order.id, txn);
  assert.equal(replay.status, 200, "replay of the same activation is not a 'no'");
  assert.equal(replay.body.data.status, "INTAKE_PENDING");
});

test("paid-then-cancelled (money already returned through the ledger): a late replay is NOT 'not activatable' - no second refund", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  assert.equal((await activateOverHttp(order.id, txn)).status, 200);
  await m.svc.cancelOrder(order.id, buyerId, "cancelled before work started"); // INTAKE_PENDING -> refundOrder + cumulativeRefundedAmount

  const replay = await activateOverHttp(order.id, txn);
  assert.equal(replay.status, 200, "refund already happened through cancelOrder; payment-service must not refund again");
});

test("order that does not exist, or a transaction that does not verify: NOT a definite 'no' (retryable, never refunded)", skipOpts, async () => {
  const m = await load();
  const { order, txn } = await newOrder(m);

  const missing = await activateOverHttp(randomUUID(), `mock-txn-${randomUUID()}`);
  assert.notEqual(missing.status, 409);
  assert.ok(missing.status >= 400);
  assert.notEqual(missing.body.error?.code, "NOT_ACTIVATABLE");

  m.deps.getTransaction = async () => ({ id: "x", status: "FAILED", relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE", relatedEntityId: order.id }) as any;
  const unverified = await activateOverHttp(order.id, txn);
  assert.equal(unverified.status, 400);
  assert.notEqual(unverified.body.error?.code, "NOT_ACTIVATABLE");
});

test("two concurrent activations of a cancelled order: both get the 409, neither flips it", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  await m.svc.cancelOrder(order.id, buyerId);
  const [a, b] = await Promise.all([activateOverHttp(order.id, txn), activateOverHttp(order.id, txn)]);
  assert.deepEqual([a.status, b.status], [409, 409]);
  assert.equal((await m.prisma.personalizedServiceOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELLED");
});

// ── FH-5: cancel vs activate race, interleaved deterministically (both orders) + Promise.all ──────────────────

/**
 * The invariant that matters for money. `refunds` counts every way the client got the money back: payment-service's
 * refund on a 409 NOT_ACTIVATABLE, or cancelOrder's paid-cancel refundOrder call.
 *   CANCELLED  => the client was refunded exactly once (never cancelled-without-refund)
 *   not CANCELLED => activated (INTAKE_PENDING) and nobody was refunded
 */
async function settleOutcome(m: Mods, orderId: string, activation: PromiseSettledResult<unknown>, refundOrderCalls: number) {
  const row = await m.prisma.personalizedServiceOrder.findUniqueOrThrow({ where: { id: orderId } });
  const refundedByPaymentService =
    activation.status === "rejected" && (activation.reason as any)?.code === "NOT_ACTIVATABLE" ? 1 : 0;
  const refunds = refundedByPaymentService + refundOrderCalls;
  if (row.status === "CANCELLED") {
    assert.equal(refunds, 1, "cancelled => the client must have been refunded exactly once");
  } else {
    assert.equal(row.status, "INTAKE_PENDING", "otherwise the paid order is activated");
    assert.equal(activation.status, "fulfilled");
    assert.equal(refunds, 0);
  }
  // An activation failure other than the definite 'no' would be retried, never swallowed as success.
  if (activation.status === "rejected") assert.equal((activation.reason as any)?.code, "NOT_ACTIVATABLE");
  return { row, refunds };
}

function countRefunds(m: Mods) {
  const state = { n: 0 };
  m.deps.refundOrder = async (params: any) => {
    state.n++;
    return { refund: params.refundAmount.toFixed(2), clawedBack: { pt: "0.00", platform: "0.00" }, shortfall: "0.00" } as any;
  };
  return state;
}

test("race A: the buyer's cancel completes BETWEEN activation's verification and its write -> activation 409, cancelled, refunded once", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  const refunds = countRefunds(m);
  const verify = m.deps.getTransaction;
  m.deps.getTransaction = async (id: string) => {
    const t = await verify(id);
    await m.svc.cancelOrder(order.id, buyerId, "cancel during activation"); // runs to completion first
    return t;
  };
  const activation = await Promise.allSettled([m.svc.activateAfterPayment(order.id, txn)]);
  m.deps.getTransaction = verify;
  const { row } = await settleOutcome(m, order.id, activation[0], refunds.n);
  assert.equal(row.status, "CANCELLED");
  assert.equal(refunds.n, 0, "an unpaid cancel moves no money itself; payment-service refunds on the 409");
});

test("race B: activation completes BETWEEN the buyer's read and its cancel write -> cancel does NOT overwrite the paid order without a refund", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  const refunds = countRefunds(m);
  const realAssert = m.svc.assertBuyerOwnsOrder.bind(m.svc);
  let first = true;
  (m.svc as any).assertBuyerOwnsOrder = async (orderId: string, uid: string) => {
    const stale = await realAssert(orderId, uid); // PENDING_PAYMENT snapshot
    if (first) {
      first = false;
      await m.svc.activateAfterPayment(order.id, txn); // payment lands before the cancel writes
    }
    return stale;
  };
  let cancelled: any;
  try {
    cancelled = await m.svc.cancelOrder(order.id, buyerId, "late cancel");
  } finally {
    (m.svc as any).assertBuyerOwnsOrder = realAssert;
  }
  // The stale read said PENDING_PAYMENT; the conditional write matched nothing; the re-read saw the PAID order and took
  // the paid-cancel refund path.
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(refunds.n, 1, "the paid order was cancelled THROUGH the refund path");
  const { row } = await settleOutcome(m, order.id, { status: "fulfilled", value: null }, refunds.n);
  assert.equal(row.cumulativeRefundedAmount, row.priceAtPurchase);
});

test("race B': activation lands and the order moves past the cancellable states -> clear 409, order untouched, no refund call", skipOpts, async () => {
  const m = await load();
  const { order, txn, buyerId } = await newOrder(m);
  const refunds = countRefunds(m);
  const realAssert = m.svc.assertBuyerOwnsOrder.bind(m.svc);
  let first = true;
  (m.svc as any).assertBuyerOwnsOrder = async (orderId: string, uid: string) => {
    const stale = await realAssert(orderId, uid);
    if (first) {
      first = false;
      await m.svc.activateAfterPayment(order.id, txn);
      await m.prisma.personalizedServiceOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
    }
    return stale;
  };
  try {
    await assert.rejects(() => m.svc.cancelOrder(order.id, buyerId), (e: any) => e.statusCode === 409);
  } finally {
    (m.svc as any).assertBuyerOwnsOrder = realAssert;
  }
  assert.equal((await m.prisma.personalizedServiceOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "IN_PROGRESS");
  assert.equal(refunds.n, 0);
});

test("race C: Promise.all(cancel, activate) x 25 -> every outcome is 'activated & not cancelled' or 'cancelled & refunded once'", skipOpts, async () => {
  const m = await load();
  const outcomes = { activated: 0, cancelledRefunded: 0 };
  for (let i = 0; i < 25; i++) {
    const { order, txn, buyerId } = await newOrder(m);
    const refunds = countRefunds(m);
    const [cancel, activation] = await Promise.allSettled([m.svc.cancelOrder(order.id, buyerId), m.svc.activateAfterPayment(order.id, txn)]);
    if (cancel.status === "rejected") assert.equal((cancel.reason as any).statusCode, 409, "a losing cancel fails cleanly");
    const { row } = await settleOutcome(m, order.id, activation, refunds.n);
    if (row.status === "CANCELLED") outcomes.cancelledRefunded++;
    else outcomes.activated++;
  }
  assert.equal(outcomes.activated + outcomes.cancelledRefunded, 25);
  console.log(`race C outcomes over 25 runs: ${JSON.stringify(outcomes)}`);
});
