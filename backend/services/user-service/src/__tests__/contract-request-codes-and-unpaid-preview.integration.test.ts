import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient } from "../clients/gym.client";
import { paymentClient } from "../clients/payment.client";
import { contractService } from "../services/contract.service";
import { contractController } from "../controllers/contract.controller";
import { previewClientExit } from "../services/client-exit.service";
import { redactBreakdownForViewer } from "../services/contract-dto";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
installAccountsActive();
stubPtRestrictionReads();

/**
 * B33 / B44 / B32 (contract request refusals) and B31 (money preview of an unpaid contract).
 *
 * BACKEND INTEGRATION on an isolated *_test database for the real requestContract / previewClientExit code paths;
 * package / profile / gym-service / payment-service reads are TEST FIXTURES stubbed at their boundaries (as in the other contract-* suites).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function world(over: { accepting?: boolean; collaboration?: unknown; existingContract?: boolean; gymId?: string } = {}) {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const packageId = randomUUID();
  const pkgRow = {
    id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
    sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: 60, isActive: true, archivedAt: null, version: 1,
  };
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => pkgRow),
    patch(ptServicePackageRepository, "findByIdForShare", async () => pkgRow),
    patch(profileRepository, "findByUserId", async () => ({
      isPT: true, ptSuspended: false, isAcceptingClients: over.accepting ?? true, referralCode: null,
    })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    patch(gymClient, "getActiveCollaboration", async () => (over.collaboration === undefined ? null : over.collaboration)),
    patch(contractRepository, "findActiveByPair", async () => (over.existingContract ? ({ id: "existing" } as any) : null)),
  ];
  return {
    ptUserId,
    clientUserId,
    packageId,
    restore: () => restores.forEach((r) => r()),
    body: (extra: Record<string, unknown> = {}) => ({ ptUserId, packageId, expectedPackageVersion: 1, ...(over.gymId ? { gymId: over.gymId } : {}), ...extra }),
  };
}

dbTest("B33: a PT who is not accepting clients -> 422 with code PT_NOT_ACCEPTING_CLIENTS (status unchanged), also on the HTTP body", async () => {
  const w = world({ accepting: false });
  try {
    await assert.rejects(
      contractService.requestContract(w.clientUserId, w.body() as any),
      (e: any) => e.status === 422 && e.code === "PT_NOT_ACCEPTING_CLIENTS" && e.message === "PT hiện đang tạm ngưng nhận khách mới",
    );
    const res = fakeRes();
    await contractController.requestContract({ headers: { "x-user-id": w.clientUserId }, body: w.body() } as any, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, "PT_NOT_ACCEPTING_CLIENTS");
  } finally {
    w.restore();
  }
});

dbTest("B44: the PT has no (or a terminating) agreement with the gym's brand -> 400 with code GYM_AGREEMENT_NOT_ACTIVE and a Vietnamese message", async () => {
  const w = world({ collaboration: null, gymId: "gym-a1" });
  try {
    const res = fakeRes();
    await contractController.requestContract({ headers: { "x-user-id": w.clientUserId }, body: w.body() } as any, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "GYM_AGREEMENT_NOT_ACTIVE");
    assert.match(res.body.error, /thoả thuận hợp tác còn hiệu lực/);
    assert.match(res.body.error, /đang được chấm dứt/);
    assert.doesNotMatch(res.body.error, /^PT chưa có/);
  } finally {
    w.restore();
  }
});

dbTest("B32: the duplicate-contract refusal (409) is Vietnamese", async () => {
  const w = world({ existingContract: true });
  try {
    await assert.rejects(
      contractService.requestContract(w.clientUserId, w.body() as any),
      (e: any) => e.status === 409 && e.message === "Bạn đang có hợp đồng hoặc yêu cầu hợp đồng còn hiệu lực với huấn luyện viên này",
    );
  } finally {
    w.restore();
  }
});

// ── B31 ────────────────────────────────────────────────────────────────────────────────────────────────────────

function previewWorld(opts: { paid: boolean; status?: string }) {
  const id = randomUUID();
  const contract: any = {
    id,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: opts.status ?? "PENDING_PAYMENT",
    price: new Prisma.Decimal("3000000"),
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
    // payment-service prices the formula whether or not money moved: this is the 2.700.000 the app saw on an unpaid contract.
    patch(paymentClient, "moneyBreakdown", async () => ({
      price: "3000000.00", totalSessions: 10, usedSessions: 0, compensatedSessions: 0, unit: "300000.00",
      remaining: "3000000.00", refundIfCancelledNow: "2700000.00", reasonUsed: "CLIENT_CANCELLED",
    })),
  ];
  return { id, restore: () => restores.forEach((r) => r()) };
}

dbTest("B31: an UNPAID contract reports no refund estimate (null + refundEstimateAvailable:false); nothing else changes", async () => {
  const w = previewWorld({ paid: false });
  try {
    const data: any = await previewClientExit(w.id);
    assert.equal(data.paid, false);
    assert.equal(data.refundIfCancelledNow, null);
    assert.equal(data.refundEstimateAvailable, false);
    assert.equal(data.price, "3000000.00", "the rest of the breakdown is untouched");
    assert.equal(data.remaining, "3000000.00");
    // The client viewer's whitelist keeps the flag, so the app can tell "no estimate" from a missing field.
    const client: any = redactBreakdownForViewer(data, { userId: "client-1", role: "CLIENT" }, "pt-1");
    assert.equal(client.refundIfCancelledNow, null);
    assert.equal(client.refundEstimateAvailable, false);
  } finally {
    w.restore();
  }
});

dbTest("B31: a PAID contract keeps its refund estimate exactly as before", async () => {
  const w = previewWorld({ paid: true });
  try {
    const data: any = await previewClientExit(w.id);
    assert.equal(data.paid, true);
    assert.equal(data.refundIfCancelledNow, "2700000.00");
    assert.equal("refundEstimateAvailable" in data, false, "no new field on a paid contract");
  } finally {
    w.restore();
  }
});

dbTest("B32: cancelling a contract notifies the other party in Vietnamese", async () => {
  const contractId = randomUUID();
  const notes: any[] = [];
  const contract: any = { id: contractId, clientUserId: "client-1", ptUserId: "pt-1", status: "PENDING_REVIEW" };
  const restores = [
    patch(contractRepository, "findById", async () => contract),
    patch(contractRepository, "updateStatusIfCurrent", async () => ({ ...contract, status: "CANCELLED" })),
    patch(notificationService, "create", async (n: any) => {
      notes.push(n);
      return {} as any;
    }),
  ];
  try {
    await contractService.cancelContract(contractId, "client-1", "Đổi ý");
    await contractService.cancelContract(contractId, "pt-1", "Bận");
  } finally {
    restores.forEach((r) => r());
  }
  assert.deepEqual(notes.map((n) => n.text), ["Khách đã huỷ hợp đồng.", "Huấn luyện viên đã huỷ hợp đồng."]);
});

