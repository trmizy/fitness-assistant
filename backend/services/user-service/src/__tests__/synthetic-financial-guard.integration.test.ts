import { guardedTest as dbTest, skip } from "./test-db-guard";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ContractStatus, Prisma, SessionMode, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { paymentClient } from "../clients/payment.client";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { resolveDisputeCore } from "../services/booking.service";
import { disputeCaseService } from "../services/dispute-case/dispute-case.service";
import { d65bResolutionService } from "../services/d65b-resolution.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { cleanup as helperCleanup, patch } from "./pt-restriction.test-helpers";

/**
 * Seed-discovery Dot X — SYNTHETIC isolation for `user-service`.
 * BACKEND INTEGRATION against isolated `gymcoach_user_test` DB + real Express `app` HTTP routes.
 * Auth-service & payment-service are stubbed at client boundaries (`authServiceClient` / `paymentClient`).
 */

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
const DAY = 24 * 3600 * 1000;

const tokens = new Map<string, { id: string; email: string; role: string }>();
const authUsers = new Map<string, { id: string; email: string; role: string; isActive: boolean; createdAt: string; updatedAt: string }>();

function registerUser(id: string, role: "CUSTOMER" | "PT" | "ADMIN", email?: string) {
  const rec = {
    id,
    email: email ?? `${id.slice(0, 8)}@scale.gymini.test`,
    role,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const tok = `tok-${id}`;
  tokens.set(tok, { id, email: rec.email, role });
  authUsers.set(id, rec);
  return tok;
}

const createdPtIds: string[] = [];
const createdUserIds: string[] = [];
const createdContractIds: string[] = [];

let server: http.Server | undefined;
let baseUrl = "";
const restores: Array<() => void> = [];
const paymentCalls: Array<{ method: string; body: unknown }> = [];

dbTest.before(async () => {
  if (skip) return;

  restores.push(
    patch(authServiceClient, "verifyToken", async (authHeader: string) => {
      const tok = String(authHeader).replace(/^Bearer /, "");
      const u = tokens.get(tok);
      if (!u) {
        throw Object.assign(new Error("invalid token"), { response: { status: 401, data: { error: "Invalid token" } } });
      }
      return { status: 200, data: { user: u } };
    }),
    patch(authServiceClient, "internalGet", async (reqPath: string) => {
      if (reqPath === "/auth/internal/admins") {
        return { status: 200, data: { admins: [] } };
      }
      const match = /^\/auth\/internal\/users\/([^/?]+)/.exec(reqPath);
      const userId = match ? decodeURIComponent(match[1]) : "";
      const user = authUsers.get(userId) ?? {
        id: userId,
        email: `${userId || "unknown"}@scale.gymini.test`,
        isActive: true,
        firstName: null,
        lastName: null,
      };
      return { status: 200, data: { user } };
    }),
    patch(authServiceClient, "internalPost", async () => ({ status: 200, data: { ok: true } })),
    patch(authServiceClient, "forward", async (_method: string, reqPath: string) => {
      if (reqPath === "/auth/users") {
        return { status: 200, data: { users: [...authUsers.values()] } };
      }
      return { status: 200, data: {} };
    }),
  );

  for (const method of [
    "checkout",
    "walletTransfer",
    "releaseSession",
    "noShow",
    "lateArrival",
    "recordNoShowObligation",
    "recordLateArrivalObligation",
    "resolveUnresolvedSession",
    "terminate",
    "releaseHoldback",
    "moneyBreakdown",
    "refund",
    "createAppealObligation",
  ] as const) {
    restores.push(
      patch(paymentClient, method, async (body: unknown) => {
        paymentCalls.push({ method, body });
        return {};
      }),
    );
  }

  const { default: app } = await import("../app");
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function scrubAll() {
  if (skip) return;
  if (createdContractIds.length) {
    await prisma.sessionReview.deleteMany({ where: { contractId: { in: createdContractIds } } }).catch(() => {});
    await prisma.clientReview.deleteMany({ where: { contractId: { in: createdContractIds } } }).catch(() => {});
    await prisma.disputeCase.deleteMany({ where: { contractId: { in: createdContractIds } } }).catch(() => {});
    await prisma.d65bResolution.deleteMany({ where: { contractId: { in: createdContractIds } } }).catch(() => {});
    await prisma.clientCompatEvent.deleteMany({ where: { actorUserId: { in: [...createdUserIds, ...createdPtIds] } } }).catch(() => {});
  }
  await helperCleanup([...createdPtIds, ...createdUserIds], createdContractIds);
  if (createdUserIds.length) {
    await prisma.userProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
  }
  createdContractIds.length = 0;
  createdPtIds.length = 0;
  createdUserIds.length = 0;
}

dbTest.after(async () => {
  await scrubAll();
  restores.reverse().forEach((r) => r());
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

async function callHttp(method: string, path: string, token?: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function seedPtProfile(dataOrigin: "REAL" | "SYNTHETIC", referralCode?: string) {
  const userId = randomUUID();
  createdPtIds.push(userId);
  const tok = registerUser(userId, "PT");
  const profile = await prisma.userProfile.create({
    data: {
      userId,
      isPT: true,
      isAcceptingClients: true,
      ptSuspended: false,
      dataOrigin,
      ...(referralCode ? { referralCode } : {}),
    },
  });
  await prisma.pTApplication.create({
    data: {
      userProfileId: profile.id,
      status: "APPROVED",
      approvedAt: new Date(Date.now() - 10 * DAY),
      mainSpecialties: ["Strength"],
    },
  });
  const pkg = await prisma.pTServicePackage.create({
    data: {
      ptUserId: userId,
      name: `Pkg ${dataOrigin}`,
      sessionCount: 10,
      price: new Prisma.Decimal("5000000"),
      sessionMode: SessionMode.ONLINE,
      sessionDurationMinutes: 60,
      isActive: true,
    },
  });
  return { userId, tok, profile, pkg };
}

async function seedClientProfile(dataOrigin: "REAL" | "SYNTHETIC") {
  const userId = randomUUID();
  createdUserIds.push(userId);
  const tok = registerUser(userId, "CUSTOMER");
  await prisma.userProfile.create({
    data: { userId, isPT: false, dataOrigin },
  });
  return { userId, tok };
}

async function rowCounts() {
  const [contracts, sessions, settlements, notifications, disputeCases, reviews, clientReviews, compatEvents] = await Promise.all([
    prisma.contract.count(),
    prisma.session.count(),
    prisma.sessionSettlement.count(),
    prisma.notification.count(),
    prisma.disputeCase.count(),
    prisma.sessionReview.count(),
    prisma.clientReview.count(),
    prisma.clientCompatEvent.count(),
  ]);
  return { contracts, sessions, settlements, notifications, disputeCases, reviews, clientReviews, compatEvents };
}

dbTest("Dot X: requesting/creating contracts, lifecycle mutations, payments, reviews, and disputes on SYNTHETIC return 409 and write zero rows", async () => {
  paymentCalls.length = 0;

  const synPt = await seedPtProfile("SYNTHETIC", `REF${randomUUID().slice(0, 6).toUpperCase()}`);
  const realPt = await seedPtProfile("REAL");
  const synClient = await seedClientProfile("SYNTHETIC");
  const realClient = await seedClientProfile("REAL");
  const adminId = randomUUID();
  const adminTok = registerUser(adminId, "ADMIN", "admin@gymini.test");

  // 1. POST /contracts/request -> 409 when PT is SYNTHETIC OR Client is SYNTHETIC
  const beforeReq = await rowCounts();
  const r1 = await callHttp("POST", "/contracts/request", realClient.tok, { ptUserId: synPt.userId, packageId: synPt.pkg.id });
  assert.equal(r1.status, 409);
  assert.equal(r1.body?.code, "SYNTHETIC_RECORD_NOT_TRANSACTABLE");

  const r2 = await callHttp("POST", "/contracts/request", synClient.tok, { ptUserId: realPt.userId, packageId: realPt.pkg.id });
  assert.equal(r2.status, 409);
  assert.equal(r2.body?.code, "SYNTHETIC_RECORD_NOT_TRANSACTABLE");

  // Direct legacy create & marketplace create refused too
  await assert.rejects(
    () => contractService.create(synPt.userId, { clientUserId: realClient.userId, packageName: "X", totalSessions: 5, price: 500000 }),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  await assert.rejects(
    () => contractService.createMarketplaceContract({ ptUserId: synPt.userId, clientUserId: realClient.userId, packageName: "PS", price: 300000 }),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  assert.deepEqual(await rowCounts(), beforeReq, "zero rows written across request/create attempts");

  // 2. Internal marketplace eligibility & referral code lookup surface SYNTHETIC
  const elig = await callHttp("GET", `/internal/pt-marketplace-eligibility/${synPt.userId}`, undefined, undefined, { "x-service-secret": INTERNAL_SECRET });
  assert.equal(elig.status, 200);
  assert.equal(elig.body.isApprovedPt, false);
  assert.equal(elig.body.isSynthetic, true);

  const ref = await callHttp("GET", `/internal/profile/by-referral-code/${synPt.profile.referralCode!}`, undefined, undefined, { "x-service-secret": INTERNAL_SECRET });
  assert.equal(ref.status, 200);
  assert.equal(ref.body.userId, synPt.userId);
  assert.equal(ref.body.dataOrigin, "SYNTHETIC");

  // 3. Chat pre-sale eligibility with approved SYNTHETIC PT remains ALLOWED
  const chat = await callHttp(
    "GET",
    `/internal/chat-eligibility?fromUserId=${encodeURIComponent(realClient.userId)}&toUserId=${encodeURIComponent(synPt.userId)}`,
    undefined,
    undefined,
    { "x-service-secret": INTERNAL_SECRET },
  );
  assert.equal(chat.status, 200);
  assert.equal(chat.body.allowed, true);
  assert.equal(chat.body.reason, "APPROVED_PT_DISCOVERY");

  // 4. Create S1-shaped SYNTHETIC COMPLETED contract/session + forced non-completed contracts to test every door
  const s1Completed = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient.userId,
      status: ContractStatus.COMPLETED,
      dataOrigin: "SYNTHETIC",
      packageName: "S1 Completed",
      totalSessions: 10,
      usedSessions: 10,
      price: new Prisma.Decimal("5000000"),
      paymentTransactionId: null,
      startDate: new Date(Date.now() - 40 * DAY),
      endDate: new Date(Date.now() - 10 * DAY),
      completedAt: new Date(Date.now() - 10 * DAY),
    },
  });
  createdContractIds.push(s1Completed.id);
  const s1Session = await prisma.session.create({
    data: {
      id: randomUUID(),
      contractId: s1Completed.id,
      ptUserId: synPt.userId,
      clientUserId: synClient.userId,
      status: SessionStatus.COMPLETED,
      sessionMode: SessionMode.ONLINE,
      scheduledStartAt: new Date(Date.now() - 12 * DAY),
      scheduledEndAt: new Date(Date.now() - 12 * DAY + 3600_000),
    },
  });
  const synPendingReview = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient.userId,
      status: ContractStatus.PENDING_REVIEW,
      dataOrigin: "SYNTHETIC",
      packageName: "S1 PendingReview",
      totalSessions: 5,
      price: new Prisma.Decimal("2000000"),
    },
  });
  createdContractIds.push(synPendingReview.id);
  const synClient2 = await seedClientProfile("SYNTHETIC");
  const synClient3 = await seedClientProfile("SYNTHETIC");
  const synClient4 = await seedClientProfile("SYNTHETIC");
  const synPendingPay = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient2.userId,
      status: ContractStatus.PENDING_PAYMENT,
      dataOrigin: "SYNTHETIC",
      packageName: "S1 PendingPay",
      totalSessions: 5,
      price: new Prisma.Decimal("2000000"),
      paymentDueAt: new Date(Date.now() + DAY),
    },
  });
  createdContractIds.push(synPendingPay.id);
  const synPendingSig = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient3.userId,
      status: ContractStatus.PENDING_SIGNATURE,
      eSignStatus: "ERROR",
      dataOrigin: "SYNTHETIC",
      packageName: "S1 PendingSig",
      totalSessions: 5,
      price: new Prisma.Decimal("2000000"),
    },
  });
  createdContractIds.push(synPendingSig.id);
  const synActive = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient4.userId,
      status: ContractStatus.ACTIVE,
      dataOrigin: "SYNTHETIC",
      packageName: "S1 Active",
      totalSessions: 5,
      price: new Prisma.Decimal("2000000"),
      paymentTransactionId: `fake-${randomUUID()}`,
    },
  });
  createdContractIds.push(synActive.id);

  const countsBeforeMutations = await rowCounts();

  // S1 COMPLETED doors: updateStatus(EXPIRED) via service, money-breakdown, terminate, reviews, disputes
  await assert.rejects(
    () => contractService.updateStatus(s1Completed.id, synPt.userId, "EXPIRED", "PT"),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  await assert.rejects(
    () => contractService.updateStatus(s1Completed.id, adminId, "EXPIRED", "ADMIN"),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );

  for (const [m, p, tok, body] of [
    ["GET", `/contracts/${s1Completed.id}/money-breakdown`, synClient.tok, undefined],
    ["POST", `/contracts/${s1Completed.id}/terminate`, synClient.tok, { reason: "CLIENT_CANCELLED" }],
    ["POST", `/contracts/${s1Completed.id}/terminate`, adminTok, { reason: "EXPIRED" }],
    ["POST", `/sessions/${s1Session.id}/review`, synClient.tok, { rating: 5, comment: "Nice" }],
    ["POST", `/sessions/${s1Session.id}/review-client`, synPt.tok, { rating: 5, comment: "Nice" }],
    ["PATCH", `/contracts/${synPendingReview.id}/accept`, synPt.tok, undefined],
    ["PATCH", `/contracts/${synPendingReview.id}/reject`, synPt.tok, { reason: "No" }],
    ["PATCH", `/contracts/${synPendingPay.id}/cancel`, synClient2.tok, { reason: "No" }],
    ["GET", `/contracts/${synPendingPay.id}/checkout-context`, synClient2.tok, undefined],
    ["POST", `/contracts/${synPendingPay.id}/pay`, synClient2.tok, {}],
    ["POST", `/contracts/${synPendingSig.id}/esign/send`, synPt.tok, {}],
    ["POST", `/contracts/${synActive.id}/feedback`, synPt.tok, { text: "Keep going" }],
    ["POST", "/sessions", synClient4.tok, { contractId: synActive.id, scheduledDate: "2099-01-01", scheduledTime: "09:00" }],
  ] as const) {
    const res = await callHttp(m, p, tok, body);
    assert.equal(res.status, 409, `${m} ${p} expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.code, "SYNTHETIC_RECORD_NOT_TRANSACTABLE", `${m} ${p} missing expected code`);
  }

  // Service-level update / incrementSession / disputes / d65b
  await assert.rejects(
    () => contractService.update(synPendingReview.id, synPt.userId, { notes: "mutated" }),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  await assert.rejects(
    () => contractService.incrementSession(synActive.id, synPt.userId),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  await assert.rejects(
    () => disputeCaseService.openCase({ id: adminId, role: "ADMIN" }, s1Session.id),
    (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
  );
  const prevExecFlag = process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  const prevD65bFlag = process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED;
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED = "true";
  try {
    await assert.rejects(
      () => resolveDisputeCore(s1Session.id, adminId, "CANCELLED", "Cannot resolve synthetic"),
      (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
    );
    await assert.rejects(
      () => d65bResolutionService.propose({ id: adminId, role: "ADMIN" }, s1Session.id, { reason: "Synthetic d65b check", evidenceRefs: [] }),
      (e: any) => e.status === 409 && e.code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE",
    );
  } finally {
    if (prevExecFlag !== undefined) process.env.DISPUTE_CASE_EXECUTION_ENABLED = prevExecFlag;
    if (prevD65bFlag === undefined) delete process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED;
    else process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED = prevD65bFlag;
  }

  assert.deepEqual(await rowCounts(), countsBeforeMutations, "zero mutations or new rows across all tables");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s1Completed.id } })).status, ContractStatus.COMPLETED);
  assert.equal(paymentCalls.length, 0, "zero paymentClient calls occurred");
});

dbTest("Dot X: background sweeps & PT deactivation leave S1 SYNTHETIC contracts/sessions untouched with 0 settlements", async () => {
  paymentCalls.length = 0;
  const synPt = await seedPtProfile("SYNTHETIC");
  const synClient = await seedClientProfile("SYNTHETIC");
  const s1Completed = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synPt.userId,
      clientUserId: synClient.userId,
      status: ContractStatus.COMPLETED,
      dataOrigin: "SYNTHETIC",
      packageName: "S1 Sweep Safe",
      totalSessions: 8,
      usedSessions: 8,
      price: new Prisma.Decimal("4000000"),
      paymentTransactionId: null,
      startDate: new Date(Date.now() - 30 * DAY),
      endDate: new Date(Date.now() - 5 * DAY),
      completedAt: new Date(Date.now() - 5 * DAY),
    },
  });
  createdContractIds.push(s1Completed.id);
  await prisma.session.create({
    data: {
      id: randomUUID(),
      contractId: s1Completed.id,
      ptUserId: synPt.userId,
      clientUserId: synClient.userId,
      status: SessionStatus.COMPLETED,
      sessionMode: SessionMode.OFFLINE,
      scheduledStartAt: new Date(Date.now() - 7 * DAY),
      scheduledEndAt: new Date(Date.now() - 7 * DAY + 3600_000),
    },
  });

  const before = await rowCounts();
  await runAutoConfirm();
  await runSettlementSweep();
  assert.equal(await contractService.expireContracts(), 0);
  assert.equal(await contractService.cancelOverduePaymentContracts(), 0);
  assert.equal(await contractService.releaseDueHoldbacks(), 0);
  const deact = await ptDeactivationService.deactivatePT({ ptUserId: synPt.userId, adminId: "admin-1", seq: BigInt(Date.now()), reason: "test" });
  assert.equal(deact.outcomes.length, 0);

  assert.deepEqual(await rowCounts(), before);
  assert.equal(paymentCalls.length, 0);
});

dbTest("Dot X: REAL + SYNTHETIC aggregations (earnings, admin contracts summary, active count, /admin/users) count REAL only", async () => {
  const mixedPt = await seedPtProfile("REAL");
  const synOnlyPt = await seedPtProfile("SYNTHETIC");
  const client = await seedClientProfile("REAL");
  const adminTok = registerUser(randomUUID(), "ADMIN", "admin@gymini.test");
  const activeBefore = (await callHttp("GET", "/profile/admin/stats", adminTok)).body.activeContracts as number;

  const realCompleted = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: mixedPt.userId,
      clientUserId: client.userId,
      status: ContractStatus.COMPLETED,
      dataOrigin: "REAL",
      packageName: "Real 1.2M",
      totalSessions: 6,
      price: new Prisma.Decimal("1200000"),
    },
  });
  const realActive = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: mixedPt.userId,
      clientUserId: client.userId,
      gymId: "gym-real-x",
      status: ContractStatus.ACTIVE,
      dataOrigin: "REAL",
      packageName: "Real Active",
      totalSessions: 6,
      price: new Prisma.Decimal("1800000"),
    },
  });
  const synCompleted = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: mixedPt.userId,
      clientUserId: client.userId,
      status: ContractStatus.COMPLETED,
      dataOrigin: "SYNTHETIC",
      packageName: "Syn 5M",
      totalSessions: 10,
      price: new Prisma.Decimal("5000000"),
    },
  });
  const synPtCompleted = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: synOnlyPt.userId,
      clientUserId: client.userId,
      gymId: "gym-real-x",
      status: ContractStatus.ACTIVE,
      dataOrigin: "SYNTHETIC",
      packageName: "Syn PT Active",
      totalSessions: 10,
      price: new Prisma.Decimal("9000000"),
    },
  });
  createdContractIds.push(realCompleted.id, realActive.id, synCompleted.id, synPtCompleted.id);

  // PT earnings: excludes SYNTHETIC
  const mixedEarnings = await callHttp("GET", "/contracts/pt/earnings", mixedPt.tok);
  assert.equal(mixedEarnings.status, 200);
  assert.equal(mixedEarnings.body.totalEarned, 1200000);
  assert.equal(mixedEarnings.body.activeRevenue, 1800000);
  assert.equal(mixedEarnings.body.completedContracts, 1);
  assert.equal(mixedEarnings.body.totalContracts, 2);

  const synEarnings = await callHttp("GET", "/contracts/pt/earnings", synOnlyPt.tok);
  assert.equal(synEarnings.status, 200);
  assert.equal(synEarnings.body.totalEarned, 0);
  assert.equal(synEarnings.body.activeRevenue, 0);
  assert.equal(synEarnings.body.totalContracts, 0);

  // Admin contracts summary & /admin/users & /profile/admin/stats & repository helpers
  const summaryRes = await callHttp("GET", "/profile/admin/contracts/summary", adminTok);
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.summary[mixedPt.userId], 2);
  assert.equal(summaryRes.body.summary[synOnlyPt.userId], undefined);

  const adminUsersRes = await callHttp("GET", "/admin/users", adminTok);
  assert.equal(adminUsersRes.status, 200);
  const synUserRow = adminUsersRes.body.data.users.find((u: any) => u.id === synOnlyPt.userId);
  assert.equal(synUserRow.contracts, 0);

  const adminStatsRes = await callHttp("GET", "/profile/admin/stats", adminTok);
  assert.equal(adminStatsRes.status, 200);
  assert.equal(adminStatsRes.body.activeContracts, activeBefore + 1);
  assert.equal(await contractRepository.countActiveByGyms(["gym-real-x"]), 1);
});
