import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { previewClientExit } from "../services/client-exit.service";
import { redactBreakdownForViewer } from "../services/contract-dto";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
installAccountsActive();
stubPtRestrictionReads();

/**
 * C2-04 / C2-07 - the money preview (GET /contracts/:id/money-breakdown) of an ENDED contract and of the PT's view
 * of an UNPAID one. Preview only: no settlement math is touched.
 *
 * BACKEND INTEGRATION on an isolated *_test database for the real previewClientExit path; the contract row and
 * payment-service's formula answer are TEST FIXTURES stubbed at their boundaries (same pattern as
 * contract-request-codes-and-unpaid-preview.integration.test.ts).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function world(opts: { paid: boolean; status: string }) {
  const id = randomUUID();
  const contract: any = {
    id,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: opts.status,
    price: new Prisma.Decimal("1000000"),
    totalSessions: 10,
    usedSessions: 0,
    compensatedSessions: 0,
    paymentTransactionId: opts.paid ? "txn-1" : null,
    platformRate: new Prisma.Decimal("0.1"),
    ptRate: new Prisma.Decimal("0.9"),
    gymRate: new Prisma.Decimal("0"),
    releasedToPt: new Prisma.Decimal(0),
    releasedToGym: new Prisma.Decimal(0),
    releasedToPlatform: new Prisma.Decimal(0),
  };
  const restores = [
    patch(contractRepository, "findById", async () => contract),
    patch(paymentClient, "moneyBreakdown", async () => ({
      price: "1000000.00",
      totalSessions: 10,
      usedSessions: 0,
      compensatedSessions: 0,
      unit: "100000.00",
      remaining: "920000.00",
      refundIfCancelledNow: "828000.00",
      reasonUsed: "CLIENT_CANCELLED",
      released: { pt: "0.00", platform: "0.00" },
      stillPending: { pt: "2700000.00", platform: "300000.00" },
    })),
  ];
  return { id, restore: () => restores.forEach((r) => r()) };
}

for (const status of ["CANCELLED", "COMPLETED", "EXPIRED"]) {
  dbTest(`C2-04: an ${status} contract reports no refundIfCancelledNow (null + refundEstimateAvailable:false + reason)`, async () => {
    const w = world({ paid: true, status });
    try {
      const data: any = await previewClientExit(w.id);
      assert.equal(data.refundIfCancelledNow, null);
      assert.equal(data.refundEstimateAvailable, false);
      assert.equal(data.refundEstimateUnavailableReason, "CONTRACT_ENDED");
      assert.equal(data.exitReasonIfCancelledNow, null);
      assert.equal(data.price, "1000000.00", "the rest of the breakdown is untouched");
      const client: any = redactBreakdownForViewer(data, { userId: "client-1", role: "CLIENT" }, "pt-1");
      assert.equal(client.refundIfCancelledNow, null);
      assert.equal(client.refundEstimateAvailable, false);
      assert.equal(client.refundEstimateUnavailableReason, "CONTRACT_ENDED", "the client app can tell why");
    } finally {
      w.restore();
    }
  });
}

dbTest("C2-07: the PT's view of an UNPAID contract shows no stillPending money (null + stillPendingAvailable:false)", async () => {
  const w = world({ paid: false, status: "PENDING_PAYMENT" });
  try {
    const data: any = await previewClientExit(w.id);
    assert.equal(data.paid, false);
    assert.equal(data.stillPending, null);
    assert.equal(data.stillPendingAvailable, false);
    const ptView: any = redactBreakdownForViewer(data, { userId: "pt-1", role: "PT" }, "pt-1");
    assert.equal(ptView.stillPending, null, "the PT (full view) gets the same answer");
    assert.equal(ptView.price, "1000000.00");
  } finally {
    w.restore();
  }
});

dbTest("C2-07 + B31: an unpaid, still-open contract keeps the existing 'no refund estimate' answer", async () => {
  const w = world({ paid: false, status: "PENDING_PAYMENT" });
  try {
    const data: any = await previewClientExit(w.id);
    assert.equal(data.refundIfCancelledNow, null);
    assert.equal(data.refundEstimateAvailable, false);
    assert.equal("refundEstimateUnavailableReason" in data, false, "only ended contracts carry the new reason");
  } finally {
    w.restore();
  }
});

dbTest("a PAID ACTIVE contract is unchanged: refund estimate and stillPending exactly as payment-service answered", async () => {
  const w = world({ paid: true, status: "ACTIVE" });
  try {
    const data: any = await previewClientExit(w.id);
    assert.equal(data.paid, true);
    assert.equal(data.refundIfCancelledNow, "828000.00");
    assert.deepEqual(data.stillPending, { pt: "2700000.00", platform: "300000.00" });
    assert.equal("refundEstimateAvailable" in data, false);
    assert.equal("stillPendingAvailable" in data, false);
    assert.equal("refundEstimateUnavailableReason" in data, false);
  } finally {
    w.restore();
  }
});
