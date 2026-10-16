import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { ContractSource, Prisma, SessionMode } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { contractService } from "../services/contract.service";
import { contractCheckoutContextService } from "../services/contract-checkout-context.service";
import contractRoutes from "../routes/contract.routes";

/**
 * Phase 3 / slice P3.5 - GET /contracts/:id/checkout-context (read-only).
 *
 * BACKEND INTEGRATION on an isolated `*_test` database: contracts and the pt-restriction reads are
 * real. gym-service is a TEST FIXTURE stubbed at the gymClient boundary; payment-service is stubbed
 * at the paymentClient boundary (`checkout` here is a recorder - the endpoint under test must never
 * call it; the one place it is called is `contractService.pay`, to compare what pay sends with what
 * the context reports). The HTTP tests mount the real contract.routes behind a stubbed auth verdict.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const RATES = { platformRate: "0.1000", ptRate: "0.7000", gymRate: "0.2000" };
// Decimal(6,4) columns read back through Decimal.toString() (trailing zeros dropped) - the same text pay sends.
const STORED_RATES = { platformRate: "0.1", ptRate: "0.7", gymRate: "0.2" };
const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);

type Collab = null | "UNAVAILABLE" | { platformRate: string; ptRate: string; gymRate: string };

/** Fixture: gym-service answers `collab` for the accept-time view; payment `checkout` is recorded. */
function installGym(collab: Collab) {
  const calls = { gym: 0, checkout: [] as any[] };
  const restores = [
    patch(gymClient, "getActiveCollaboration", async () => {
      calls.gym++;
      if (collab === "UNAVAILABLE") throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return collab === null ? null : { collaborationId: "agr-1", ...collab, brandId: "brand-a", agreementScope: "BRAND" };
    }),
    patch(paymentClient, "checkout", async (params: any) => {
      calls.checkout.push(params);
      return { transactionId: randomUUID(), status: "PENDING", redirectUrl: null, qrCodeUrl: null, provider: "MOCK" };
    }),
  ];
  return { calls, restore: () => restores.reverse().forEach((r) => r()) };
}

async function makeContract(over: Record<string, unknown> = {}) {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const c = await prisma.contract.create({
    data: {
      ptUserId,
      clientUserId,
      status: "PENDING_PAYMENT",
      packageName: "Goi 10 buoi",
      totalSessions: 10,
      price: new Prisma.Decimal("5000000"),
      sessionMode: SessionMode.OFFLINE,
      sessionDurationMinutes: 60,
      validityDays: 90,
      paymentDueAt: IN_ONE_HOUR(),
      ...over,
    } as any,
  });
  return c;
}

const GYM_SNAPSHOT = {
  gymId: "gym-a1",
  source: ContractSource.GYM,
  ...RATES,
  gymBrandId: "brand-a",
  gymAgreementId: "agr-1",
  gymAgreementScope: "BRAND",
};

async function cleanup(...contractIds: string[]) {
  await prisma.ptRestriction.deleteMany({ where: { OR: [{ contractId: { in: contractIds } }] } });
  const rows = await prisma.contract.findMany({ where: { id: { in: contractIds } }, select: { ptUserId: true } });
  await prisma.ptRestriction.deleteMany({ where: { ptUserId: { in: rows.map((r) => r.ptUserId) } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
}

const asClient = (c: { clientUserId: string }) => ({ userId: c.clientUserId, role: "CUSTOMER" });

// ── content ──────────────────────────────────────────────────────────────────────────────────────

dbTest("gym contract: price, split, brand/agreement/branch snapshot, deadline, membership reference (null until P3.3)", { skip }, async () => {
  const c = await makeContract(GYM_SNAPSHOT);
  const g = installGym(RATES);
  try {
    const ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.equal(ctx.contractId, c.id);
    assert.equal(ctx.status, "PENDING_PAYMENT");
    assert.deepEqual(ctx.package, { name: "Goi 10 buoi", totalSessions: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90 });
    assert.equal(ctx.amount, 5000000);
    assert.deepEqual(ctx.rates, STORED_RATES);
    assert.deepEqual(ctx.parties, { ptUserId: c.ptUserId, gymId: "gym-a1", clientUserId: c.clientUserId });
    assert.equal(ctx.source, "GYM");
    assert.deepEqual(ctx.gym, { gymId: "gym-a1", brandId: "brand-a", agreementId: "agr-1", agreementScope: "BRAND" });
    assert.deepEqual(ctx.membership, { membershipId: null });
    assert.equal(ctx.payment.paymentDueAt, c.paymentDueAt!.toISOString());
    assert.equal(ctx.payment.hasPaymentTransaction, false);
    assert.deepEqual(ctx.recheck, { ptAcceptsNewBusiness: true, paymentDeadlinePassed: false, gym: "OK" });
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

dbTest("membership reference is passed through once a later slice writes it", { skip }, async () => {
  const c = await makeContract({ ...GYM_SNAPSHOT, gymMembershipId: "mem-42" });
  const g = installGym(RATES);
  try {
    const ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.deepEqual(ctx.membership, { membershipId: "mem-42" });
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

dbTest("independent contract: no gym fields, gym recheck NOT_APPLICABLE, gym-service not asked", { skip }, async () => {
  const c = await makeContract({ source: ContractSource.INDEPENDENT, platformRate: "0.10", ptRate: "0.90", gymRate: "0" });
  const g = installGym(null);
  try {
    const ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.deepEqual(ctx.gym, { gymId: null, brandId: null, agreementId: null, agreementScope: null });
    assert.equal(ctx.parties.gymId, null);
    assert.equal(ctx.recheck.gym, "NOT_APPLICABLE");
    assert.equal(g.calls.gym, 0);
    assert.deepEqual(ctx.rates, { platformRate: "0.1", ptRate: "0.9", gymRate: "0" });
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

dbTest("legacy gym contract created before P3.2 (snapshot columns null): context still works, snapshot fields null", { skip }, async () => {
  const c = await makeContract({ gymId: "gym-old", source: ContractSource.GYM, ...RATES });
  const g = installGym(RATES);
  try {
    const ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.deepEqual(ctx.gym, { gymId: "gym-old", brandId: null, agreementId: null, agreementScope: null });
    assert.equal(ctx.recheck.gym, "OK");
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

// ── matches what pay sends; reads only ───────────────────────────────────────────────────────────

dbTest("MATCH: amount / rates / parties equal what contractService.pay sends to payment-service", { skip }, async () => {
  for (const variant of [GYM_SNAPSHOT, { source: ContractSource.INDEPENDENT, platformRate: "0.10", ptRate: "0.90", gymRate: "0" }]) {
    const c = await makeContract(variant);
    const g = installGym(RATES);
    try {
      const ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
      assert.equal(g.calls.checkout.length, 0, "the context call itself never touches payment-service");
      await contractService.pay(c.id, c.clientUserId, "MOCK");
      assert.equal(g.calls.checkout.length, 1);
      const sent = g.calls.checkout[0];
      assert.equal(sent.amount, ctx.amount);
      assert.deepEqual(sent.rates, ctx.rates);
      assert.deepEqual(sent.parties, ctx.parties);
      assert.equal(sent.relatedEntityId, ctx.contractId);
    } finally {
      g.restore();
      await cleanup(c.id);
    }
  }
});

dbTest("READ-ONLY: no payment call, no write (row byte-identical after repeated calls)", { skip }, async () => {
  const c = await makeContract(GYM_SNAPSHOT);
  const g = installGym(RATES);
  try {
    const before = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    for (let i = 0; i < 3; i++) await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual(after, before);
    assert.equal(g.calls.checkout.length, 0);
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

// ── recheck facts ────────────────────────────────────────────────────────────────────────────────

dbTest("recheck reports (never enforces): gym stopped accepting, terms changed, gym-service down, PT restricted, deadline passed", { skip }, async () => {
  const c = await makeContract({ ...GYM_SNAPSHOT, paymentDueAt: new Date(Date.now() - 1000) });
  let g = installGym(null);
  try {
    let ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.equal(ctx.recheck.gym, "GYM_NOT_ACCEPTING_CONTRACTS");
    assert.equal(ctx.recheck.paymentDeadlinePassed, true);
    g.restore();

    g = installGym({ platformRate: "0.1000", ptRate: "0.6000", gymRate: "0.3000" });
    ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.equal(ctx.recheck.gym, "GYM_TERMS_CHANGED");
    assert.deepEqual(ctx.rates, STORED_RATES, "the snapshot is reported as-is, never overwritten by the new terms");
    g.restore();

    g = installGym("UNAVAILABLE");
    ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.equal(ctx.recheck.gym, "UNKNOWN");
    g.restore();

    g = installGym(RATES);
    await prisma.ptRestriction.create({
      data: { ptUserId: c.ptUserId, type: "TEMPORARY_SUSPENSION", reasonCategory: "OTHER", imposedBy: "admin-test" },
    });
    ctx = await contractCheckoutContextService.getCheckoutContext(c.id, asClient(c));
    assert.deepEqual(ctx.recheck.ptAcceptsNewBusiness, { blockedCode: "PT_TEMPORARILY_UNAVAILABLE" });
    assert.equal(ctx.status, "PENDING_PAYMENT", "reporting a restriction changes nothing on the contract");
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

// ── authorization and status ─────────────────────────────────────────────────────────────────────

dbTest("authorization: the client, the PT and an ADMIN may read; another client / stranger 403; unknown id 404", { skip }, async () => {
  const c = await makeContract(GYM_SNAPSHOT);
  const g = installGym(RATES);
  try {
    const read = (actor: { userId: string; role?: string }, id = c.id) =>
      contractCheckoutContextService.getCheckoutContext(id, actor).then(() => 200, (e) => e.status);
    assert.equal(await read({ userId: c.clientUserId, role: "CUSTOMER" }), 200);
    assert.equal(await read({ userId: c.ptUserId, role: "PT" }), 200);
    assert.equal(await read({ userId: randomUUID(), role: "ADMIN" }), 200);
    assert.equal(await read({ userId: randomUUID(), role: "CUSTOMER" }), 403, "another client");
    assert.equal(await read({ userId: randomUUID(), role: "PT" }), 403, "another PT");
    assert.equal(await read({ userId: c.clientUserId, role: "CUSTOMER" }, randomUUID()), 404);
  } finally {
    g.restore();
    await cleanup(c.id);
  }
});

dbTest("wrong status: anything but PENDING_PAYMENT is 409 CHECKOUT_NOT_AVAILABLE (authorization is checked first)", { skip }, async () => {
  const g = installGym(RATES);
  const ids: string[] = [];
  try {
    for (const status of ["PENDING_REVIEW", "PENDING_SIGNATURE", "ACTIVE", "CANCELLED", "COMPLETED"]) {
      const c = await makeContract({ ...GYM_SNAPSHOT, status });
      ids.push(c.id);
      await assert.rejects(
        contractCheckoutContextService.getCheckoutContext(c.id, asClient(c)),
        (e: any) => e.status === 409 && e.code === "CHECKOUT_NOT_AVAILABLE",
        status,
      );
      await assert.rejects(
        contractCheckoutContextService.getCheckoutContext(c.id, { userId: randomUUID(), role: "CUSTOMER" }),
        (e: any) => e.status === 403,
        `${status}: a stranger learns nothing about the status`,
      );
    }
  } finally {
    g.restore();
    await cleanup(...ids);
  }
});

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const restoreAuth = patch(authServiceClient, "verifyToken", async (header: string) => {
    const [id, role] = header.replace("Bearer ", "").split("|");
    return { data: { user: { id, email: `${id}@test.local`, role: role || "CUSTOMER" } } };
  });
  const app = express();
  app.use(express.json());
  app.use("/contracts", contractRoutes);
  const server = app.listen(0);
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/contracts`);
  } finally {
    server.close();
    restoreAuth();
  }
}

dbTest("HTTP: GET /contracts/:id/checkout-context - 401 without token, 200 own, 403 other client, 409 wrong status, 404 unknown", { skip }, async () => {
  const c = await makeContract(GYM_SNAPSHOT);
  const cancelled = await makeContract({ ...GYM_SNAPSHOT, status: "CANCELLED" });
  const g = installGym(RATES);
  try {
    await withServer(async (base) => {
      const auth = (id: string, role = "CUSTOMER") => ({ headers: { Authorization: `Bearer ${id}|${role}` } });
      assert.equal((await fetch(`${base}/${c.id}/checkout-context`)).status, 401);

      const ok = await fetch(`${base}/${c.id}/checkout-context`, auth(c.clientUserId));
      assert.equal(ok.status, 200);
      const body: any = await ok.json();
      assert.equal(body.contractId, c.id);
      assert.equal(body.amount, 5000000);
      assert.equal(body.gym.brandId, "brand-a");

      assert.equal((await fetch(`${base}/${c.id}/checkout-context`, auth(randomUUID()))).status, 403);
      const wrong = await fetch(`${base}/${cancelled.id}/checkout-context`, auth(cancelled.clientUserId));
      assert.equal(wrong.status, 409);
      assert.equal(((await wrong.json()) as any).code, "CHECKOUT_NOT_AVAILABLE");
      assert.equal((await fetch(`${base}/${randomUUID()}/checkout-context`, auth(c.clientUserId))).status, 404);

      // the pre-existing GET /:id is unchanged (no checkoutContext field bolted on)
      const plain: any = await (await fetch(`${base}/${c.id}`, auth(c.clientUserId))).json();
      assert.equal(plain.id, c.id);
      assert.equal("checkoutContext" in plain, false);
    });
    assert.equal(g.calls.checkout.length, 0);
  } finally {
    g.restore();
    await cleanup(c.id, cancelled.id);
  }
});
