import "./env-no-esign"; // must stay first: REQUIRE_CONTRACT_ESIGN=false before contract.service is loaded
import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";
import { contractService } from "../services/contract.service";
import { ptTermsService } from "../services/pt-terms.service";

/**
 * Codex #4 - contract creation / acceptance must FAIL CLOSED on the account-status check.
 *
 * isUserActive (86dec221) already failed closed for chat eligibility and call permission. The CONTRACT paths did not ask
 * auth-service about the other party at all: only the caller's own token was verified by the auth middleware. requestContract
 * and acceptContract now ask auth-service whether BOTH accounts are active, before anything is written:
 *   auth-service unreachable / 5xx / secret rejected -> 503 ACCOUNT_STATUS_UNAVAILABLE, no contract row, nothing claimed
 *   an account is deactivated (banned)               -> 403 ACCOUNT_INACTIVE, no contract row, nothing claimed
 *   auth-service says active (or has no such user)   -> works as before
 * createMarketplaceContract is NOT gated: the order is already PAID when it runs, refusing there would strand the money.
 *
 * Evidence: BACKEND INTEGRATION on an isolated *_test database (service functions, then the REAL Express app over HTTP). TEST FIXTURE:
 * auth-service is a stub at the authServiceClient boundary; package / PT-profile / availability / notification reads are stubbed as in
 * contract-duplicate-pair-guard.integration.test.ts. The contract INSERT, the pair lock and the status claim are real.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

type AuthAnswer = { isActive?: boolean } | Error | "notfound";
let authAnswers = new Map<string, AuthAnswer>();
let authLookups: string[] = [];
const httpError = (status: number) => Object.assign(new Error(`auth-service responded ${status}`), { response: { status, data: {} } });
const DOWN = () => new AuthServiceUnavailableError(new Error("ECONNREFUSED"));

const createdIds: string[] = [];
const restores: Array<() => void> = [];
const identities = new Map<string, { id: string; email: string; role: string }>();
let verifyDown: Error | null = null;
let server: http.Server;
let base = "";

function installAuth() {
  restores.push(
    patch(authServiceClient, "internalGet", async (p: string) => {
      const id = p.split("/").pop()!;
      authLookups.push(id);
      const a = authAnswers.get(id) ?? { isActive: true };
      if (a instanceof Error) throw a;
      if (a === "notfound") throw httpError(404);
      return { status: 200, data: { user: { id, email: `${id}@test.local`, firstName: "T", lastName: "User", ...a } } };
    }),
    patch(authServiceClient, "verifyToken", async (header: string) => {
      if (verifyDown) throw verifyDown;
      const user = identities.get(String(header).replace(/^Bearer /, ""));
      if (!user) throw httpError(401);
      return { status: 200, data: { user } };
    }),
  );
}

function stubRequestDeps(ptUserId: string) {
  const packageId = randomUUID();
  const pkg = {
    id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
    sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: 90,
    isActive: true, archivedAt: null, version: 1,
  };
  const r = [
    patch(ptServicePackageRepository, "findById", async () => pkg),
    patch(ptServicePackageRepository, "findByIdForShare", async () => pkg),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
  ];
  return { packageId, restore: () => r.forEach((x) => x()) };
}

async function seed(ptUserId: string, clientUserId: string, status: ContractStatus, source: ContractSource = ContractSource.INDEPENDENT) {
  const row = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, price: 1_000_000, status, source },
  });
  createdIds.push(row.id);
  return row;
}

const count = (ptUserId: string, clientUserId: string) => prisma.contract.count({ where: { ptUserId, clientUserId } });

dbTest.before(async () => {
  if (skip) return;
  installAuth();
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
dbTest.beforeEach(() => {
  authAnswers = new Map();
  authLookups = [];
  verifyDown = null;
});
dbTest.after(async () => {
  restores.reverse().forEach((r) => r());
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  await prisma.notification.deleteMany({ where: { entityId: { in: createdIds } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
  // contract PDFs written by acceptContract
  for (const id of createdIds) fs.rmSync(path.join(process.cwd(), "uploads", "contracts", `${id}.pdf`), { force: true });
  await prisma.$disconnect();
});

// ── requestContract ───────────────────────────────────────────────────────────────────────────────

dbTest("requestContract: auth-service unreachable -> 503 ACCOUNT_STATUS_UNAVAILABLE and NO contract row", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { packageId, restore } = stubRequestDeps(ptUserId);
  try {
    for (const failure of [DOWN(), httpError(500), httpError(502), httpError(401), httpError(403)]) {
      authAnswers = new Map<string, AuthAnswer>([[ptUserId, failure], [clientUserId, { isActive: true }]]);
      await assert.rejects(
        () => contractService.requestContract(clientUserId, { ptUserId, packageId }),
        (e: any) => e.status === 503 && e.code === "ACCOUNT_STATUS_UNAVAILABLE",
        String(failure.message),
      );
      assert.equal(await count(ptUserId, clientUserId), 0, "no contract row after a failed account check");
    }
    // either side being unverifiable is enough
    authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: true }], [clientUserId, DOWN()]]);
    await assert.rejects(() => contractService.requestContract(clientUserId, { ptUserId, packageId }), (e: any) => e.status === 503);
    assert.equal(await count(ptUserId, clientUserId), 0);
  } finally {
    restore();
  }
});

dbTest("requestContract: a deactivated (banned) client or PT is refused 403 ACCOUNT_INACTIVE, no contract row", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { packageId, restore } = stubRequestDeps(ptUserId);
  try {
    for (const [who, inactive] of [["client", clientUserId], ["pt", ptUserId]] as const) {
      authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: true }], [clientUserId, { isActive: true }], [inactive, { isActive: false }]]);
      await assert.rejects(
        () => contractService.requestContract(clientUserId, { ptUserId, packageId }),
        (e: any) => e.status === 403 && e.code === "ACCOUNT_INACTIVE",
        who,
      );
      assert.equal(await count(ptUserId, clientUserId), 0, who);
    }
  } finally {
    restore();
  }
});

dbTest("requestContract: auth-service says both are active (or has no such user) -> the contract is created", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { packageId, restore } = stubRequestDeps(ptUserId);
  try {
    authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: true }], [clientUserId, "notfound"]]);
    const c = await contractService.requestContract(clientUserId, { ptUserId, packageId });
    createdIds.push(c.id);
    assert.equal(c.status, ContractStatus.PENDING_REVIEW);
    assert.ok(authLookups.includes(ptUserId) && authLookups.includes(clientUserId), "both accounts were asked about");
  } finally {
    restore();
  }
});

// ── acceptContract ────────────────────────────────────────────────────────────────────────────────

async function pendingReview(ptUserId: string, clientUserId: string) {
  // a PT who has confirmed the current terms, so the terms gate (D25) is not what these tests are about
  const stubTerms = patch(ptTermsService, "assertAcceptedCurrent", async () => undefined);
  const c = await seed(ptUserId, clientUserId, ContractStatus.PENDING_REVIEW);
  return { c, restore: stubTerms };
}

dbTest("acceptContract: auth-service down -> 503, the contract is NOT claimed (still PENDING_REVIEW), no PDF", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { c, restore } = await pendingReview(ptUserId, clientUserId);
  const restoreProfile = patch(profileRepository, "findByUserId", async () => ({ isPT: true }));
  try {
    for (const failure of [DOWN(), httpError(500)]) {
      authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: true }], [clientUserId, failure]]);
      await assert.rejects(
        () => contractService.acceptContract(c.id, ptUserId),
        (e: any) => e.status === 503 && e.code === "ACCOUNT_STATUS_UNAVAILABLE",
      );
      const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(row.status, ContractStatus.PENDING_REVIEW);
      assert.equal(row.contractPdfPath, null);
      assert.equal(row.paymentDueAt, null);
    }
  } finally {
    restoreProfile();
    restore();
  }
});

dbTest("acceptContract: a deactivated client or PT -> 403 ACCOUNT_INACTIVE, the contract stays PENDING_REVIEW", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { c, restore } = await pendingReview(ptUserId, clientUserId);
  const restoreProfile = patch(profileRepository, "findByUserId", async () => ({ isPT: true }));
  try {
    for (const inactive of [clientUserId, ptUserId]) {
      authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: true }], [clientUserId, { isActive: true }], [inactive, { isActive: false }]]);
      await assert.rejects(() => contractService.acceptContract(c.id, ptUserId), (e: any) => e.status === 403 && e.code === "ACCOUNT_INACTIVE");
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, ContractStatus.PENDING_REVIEW);
    }
  } finally {
    restoreProfile();
    restore();
  }
});

dbTest("acceptContract: both accounts active -> PENDING_PAYMENT with a payment deadline (works as before)", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { c, restore } = await pendingReview(ptUserId, clientUserId);
  const restoreProfile = patch(profileRepository, "findByUserId", async () => ({ isPT: true }));
  const restoreNotify = patch(notificationService, "create", async () => ({}));
  try {
    const accepted = await contractService.acceptContract(c.id, ptUserId);
    assert.equal(accepted?.status, ContractStatus.PENDING_PAYMENT);
    assert.ok(accepted?.paymentDueAt);
  } finally {
    restoreNotify();
    restoreProfile();
    restore();
  }
});

// ── marketplace (paid first) ──────────────────────────────────────────────────────────────────────

dbTest("createMarketplaceContract is never gated by auth-service: the order is already paid, so an outage must not strand it", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  authAnswers = new Map<string, AuthAnswer>([[ptUserId, DOWN()], [clientUserId, DOWN()]]);
  const c = await contractService.createMarketplaceContract({ ptUserId, clientUserId, packageName: "Tu van", price: 500000, paymentTransactionId: randomUUID() });
  createdIds.push(c.id);
  assert.equal(c.status, ContractStatus.ACTIVE);
  assert.equal(authLookups.length, 0, "no account lookup on the paid path");
});

// ── over real HTTP: the gateway-facing routes ─────────────────────────────────────────────────────

async function http_(method: string, p: string, token: string | null, body?: unknown) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

dbTest("REAL HTTP POST /contracts/request: auth down -> 503 and no row; banned -> refused; active -> 201", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const token = `tok-${clientUserId}`;
  identities.set(token, { id: clientUserId, email: `${clientUserId}@test.local`, role: "CUSTOMER" });
  const { packageId, restore } = stubRequestDeps(ptUserId);
  try {
    // (a) the caller's own token cannot be verified (auth-service down) -> the middleware answers 503
    verifyDown = DOWN();
    let r = await http_("POST", "/contracts/request", token, { ptUserId, packageId });
    assert.equal(r.status, 503);
    assert.equal(await count(ptUserId, clientUserId), 0);
    verifyDown = null;

    // (b) token fine, but the account-status lookup fails -> 503 from the contract path itself
    authAnswers = new Map<string, AuthAnswer>([[ptUserId, DOWN()]]);
    r = await http_("POST", "/contracts/request", token, { ptUserId, packageId });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "ACCOUNT_STATUS_UNAVAILABLE");
    assert.equal(await count(ptUserId, clientUserId), 0);

    // (c) auth-service says the PT account is deactivated -> refused, no row
    authAnswers = new Map<string, AuthAnswer>([[ptUserId, { isActive: false }]]);
    r = await http_("POST", "/contracts/request", token, { ptUserId, packageId });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ACCOUNT_INACTIVE");
    assert.equal(await count(ptUserId, clientUserId), 0);

    // (d) the caller's own token says the account is disabled (auth-service 403) -> propagated by the middleware
    verifyDown = httpError(403);
    r = await http_("POST", "/contracts/request", token, { ptUserId, packageId });
    assert.equal(r.status, 403);
    assert.equal(await count(ptUserId, clientUserId), 0);
    verifyDown = null;

    // (e) everything healthy -> 201
    authAnswers = new Map();
    r = await http_("POST", "/contracts/request", token, { ptUserId, packageId, acknowledgedLowAvailability: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    createdIds.push(r.body.id);
    assert.equal(await count(ptUserId, clientUserId), 1);
  } finally {
    restore();
  }
});

dbTest("REAL HTTP PATCH /contracts/:id/accept: auth down -> 503 and the contract is not claimed; active -> PENDING_PAYMENT", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const token = `tok-${ptUserId}`;
  identities.set(token, { id: ptUserId, email: `${ptUserId}@test.local`, role: "PT" });
  const { c, restore } = await pendingReview(ptUserId, clientUserId);
  const restoreProfile = patch(profileRepository, "findByUserId", async () => ({ isPT: true }));
  const restoreNotify = patch(notificationService, "create", async () => ({}));
  try {
    authAnswers = new Map<string, AuthAnswer>([[clientUserId, DOWN()]]);
    let r = await http_("PATCH", `/contracts/${c.id}/accept`, token);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "ACCOUNT_STATUS_UNAVAILABLE");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, ContractStatus.PENDING_REVIEW);

    authAnswers = new Map<string, AuthAnswer>([[clientUserId, { isActive: false }]]);
    r = await http_("PATCH", `/contracts/${c.id}/accept`, token);
    assert.equal(r.status, 403);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, ContractStatus.PENDING_REVIEW);

    authAnswers = new Map();
    r = await http_("PATCH", `/contracts/${c.id}/accept`, token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, ContractStatus.PENDING_PAYMENT);
  } finally {
    restoreNotify();
    restoreProfile();
    restore();
  }
});
