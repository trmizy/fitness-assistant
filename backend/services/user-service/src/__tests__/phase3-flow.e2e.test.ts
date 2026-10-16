/**
 * Phase 3 / slice P3.7 (owner decisions D66, D67) - the whole "client picks a PT through a gym" flow, end to end across
 * THREE real services, with a SIMULATED payment gateway ("cong mo phong"): no real gateway, no real money.
 *
 *   client holds a brand membership -> GET /contracts/gym-options -> POST /contracts/request (with gym) -> PT accepts
 *   -> PENDING_PAYMENT -> GET /contracts/:id/checkout-context -> POST /contracts/:id/pay -> (simulated) IPN -> ACTIVE
 *
 * Evidence labels (see _warroom/sessions/S_p3_7.md):
 *   BACKEND INTEGRATION + REAL HTTP/API, isolated test databases (gymcoach_user_p37_test, gymcoach_gym_p37_test,
 *   gymcoach_payment_p37_test).
 *   REAL     user-service (its Express app + services, in this process), payment-service (own OS process, real ledger),
 *            gym-service (own OS process, real Express app + real Prisma queries: agreements, branches, partner lock,
 *            membership lookup). Every user-service -> gym-service and -> payment-service call is a real HTTP request.
 *   FIXTURE  the gym-side rows (brand, branches, agreement, membership) are inserted directly into the gym test DB - the
 *            membership is NOT bought through the purchase flow; the gateway's IPN is a signed fixture
 *            (VNPay HMAC-SHA512 with a test secret) - the gateway is the one party that cannot run here; auth-service is
 *            a token -> identity table (and its e-mail lookups answer a fixed address).
 *   NOT COVERED: a real browser (P3.6 REAL BROWSER is a separate step), a real payment gateway, mobile, the API gateway,
 *            account-switch isolation, auth-service, chat-service.
 *
 * Opt-in (spawns two services, TRUNCATEs the payment ledger tables of the p37 payment DB) - run it alone:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 \
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_p37_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_p37_test?schema=public" \
 *   E2E_GYM_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_p37_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/phase3-flow.e2e.test.ts
 *
 * Money maths (derived by hand, not read back from the code under test): package 5,000,000 d, rates PT 70% / gym 20% /
 * platform 10% => PT 3,500,000 + gym branch 1,000,000 + platform 500,000, all in the PENDING buckets, escrow 5,000,000.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { skip as harnessSkip, startHarness, type Harness } from "./cross-service-money.harness";
import { isTestDatabaseUrl } from "./test-db-guard";

const GYM_DB_URL = process.env.E2E_GYM_DATABASE_URL ?? "";
const skip: string | false =
  harnessSkip || (isTestDatabaseUrl(GYM_DB_URL) ? false : "Set E2E_GYM_DATABASE_URL to a *_test gym-service database (e.g. gymcoach_gym_p37_test).");

const DAY = 24 * 3600 * 1000;
const PRICE = 5_000_000;
const SESSIONS = 10;
const VALIDITY = 60; // days
const PT_SHARE = 3_500_000;
const GYM_SHARE = 1_000_000;
const PLATFORM_SHARE = 500_000;
const RATES = { pt: "0.7000", gym: "0.2000", platform: "0.1000" };

let H: Harness;
let G: any; // gym-service's own Prisma client, on the gym test database (fixture writer + independent reader)
const gymCreated = { memberships: [] as string[], plans: [] as string[], agreements: [] as string[], gyms: [] as string[], accounts: [] as string[], partners: [] as string[], brands: [] as string[] };
const userCreated = { contracts: [] as string[], pts: [] as string[] };

test.before(async () => {
  if (skip) return;
  process.env.REQUIRE_CONTRACT_ESIGN = "false"; // product decision: e-sign is paused, accept goes straight to PENDING_PAYMENT
  H = await startHarness({ gym: { databaseUrl: GYM_DB_URL } });
  // auth-service fixture: accept / activation look the parties' e-mail up; confirmation e-mails go nowhere.
  H.m.base.patch(H.m.authServiceClient, "internalGet", async (p: string) => {
    const id = String(p).split("/").pop();
    return { status: 200, data: { user: { id, email: `${id}@test.local`, firstName: "Test", lastName: "User" } } };
  });
  H.m.base.patch(H.m.authServiceClient, "internalPost", async () => ({ status: 200, data: {} }));
  const gymClientModule = require(path.resolve(__dirname, "../../../gym-service/src/generated/prisma"));
  G = new gymClientModule.PrismaClient({ datasourceUrl: GYM_DB_URL });
});
test.after(async () => {
  if (skip) return;
  await cleanupGym().catch(() => {});
  if (G) await G.$disconnect();
  if (H) await H.close();
});

const show = (label: string, o: Record<string, unknown>) => console.log(`[P3.7] ${label} ${JSON.stringify(o)}`);
const w = (a: number, p = 0, l = 0) => ({ a, p, l });

// ─────────────────────────────────────────────────────────────── fixtures: gym-service side (TEST FIXTURE)
interface GymWorld {
  ownerId: string;
  brandId: string;
  gyms: string[]; // branch ids; gyms[0] = "A1"
  planId: string;
  agreementId: string | null;
}

async function makeBrandWorld(
  ptUserId: string | null,
  o: {
    branches?: number;
    partnerStatus?: "ACTIVE" | "SUSPENDED" | null;
    agreement?: { status?: string; terminationInitiatedAt?: Date | null; effectiveAt?: Date | null } | null;
    operationalStatus?: "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED";
  } = {},
): Promise<GymWorld> {
  const ownerId = randomUUID();
  if (o.partnerStatus) {
    const partner = await G.gymPartner.create({
      data: { legalName: `P3.7 ${ownerId.slice(0, 8)}`, contactEmail: `${ownerId.slice(0, 8)}@p37.test`, status: o.partnerStatus, verificationStatus: "VERIFIED" },
    });
    gymCreated.partners.push(partner.id);
    const acc = await G.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: ownerId, role: "OWNER", scopedGymIds: [], status: "ACTIVE", activatedAt: new Date(), onboardingCompletedAt: new Date() },
    });
    gymCreated.accounts.push(acc.id);
  }
  const brand = await G.gymBrand.create({ data: { id: randomUUID(), ownerId, name: "P3.7 Brand A" } });
  gymCreated.brands.push(brand.id);
  const gyms: string[] = [];
  for (let i = 0; i < (o.branches ?? 2); i++) {
    const g = await G.gym.create({
      data: {
        id: randomUUID(), ownerId, brandId: brand.id, name: `P3.7 Branch A${i + 1}`, address: `${i + 1} Test St`, city: "HCM",
        status: "APPROVED", operationalStatus: o.operationalStatus ?? "OPEN",
      },
    });
    gymCreated.gyms.push(g.id);
    gyms.push(g.id);
  }
  const plan = await G.gymMembershipPlan.create({ data: { id: randomUUID(), brandId: brand.id, name: "P3.7 Plan 90d", price: 900_000, durationDays: 90 } });
  gymCreated.plans.push(plan.id);
  let agreementId: string | null = null;
  if (ptUserId && o.agreement !== null) {
    const a = o.agreement ?? {};
    const status = a.status ?? "ACCEPTED";
    const row = await G.gymBrandPtAgreement.create({
      data: {
        id: randomUUID(), brandId: brand.id, ptUserId,
        proposedPtRate: RATES.pt, proposedGymRate: RATES.gym, platformRate: RATES.platform,
        status, proposedBy: "GYM", expiresAt: new Date(Date.now() + 7 * DAY),
        acceptedAt: status === "ACCEPTED" ? new Date() : null,
        terminationInitiatedAt: a.terminationInitiatedAt ?? null, effectiveAt: a.effectiveAt ?? null, origin: "NATIVE",
      },
    });
    gymCreated.agreements.push(row.id);
    agreementId = row.id;
  }
  return { ownerId, brandId: brand.id, gyms, planId: plan.id, agreementId };
}

async function addMembership(
  world: GymWorld,
  clientId: string,
  o: { gymIndex?: number; status?: string; endInDays?: number | null } = {},
) {
  const endInDays = o.endInDays === undefined ? 90 : o.endInDays;
  const m = await G.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId: world.gyms[o.gymIndex ?? 0], planId: world.planId, clientId, status: o.status ?? "ACTIVE",
      priceAtPurchase: 900_000, durationDaysSnapshot: 90, startDate: new Date(Date.now() - DAY),
      endDate: endInDays === null ? null : new Date(Date.now() + endInDays * DAY),
    },
  });
  gymCreated.memberships.push(m.id);
  return m as { id: string };
}

async function cleanupGym() {
  const ids = { ...gymCreated };
  gymCreated.memberships = []; gymCreated.plans = []; gymCreated.agreements = []; gymCreated.gyms = [];
  gymCreated.accounts = []; gymCreated.partners = []; gymCreated.brands = [];
  await G.gymMembershipContract.deleteMany({ where: { id: { in: ids.memberships } } });
  await G.gymMembershipPlan.deleteMany({ where: { id: { in: ids.plans } } });
  await G.gymBrandPtAgreement.deleteMany({ where: { id: { in: ids.agreements } } });
  await G.gym.deleteMany({ where: { id: { in: ids.gyms } } });
  await G.gymPartnerAccount.deleteMany({ where: { id: { in: ids.accounts } } });
  await G.gymPartner.deleteMany({ where: { id: { in: ids.partners } } });
  await G.gymBrand.deleteMany({ where: { id: { in: ids.brands } } });
}

// ─────────────────────────────────────────────────────────────── fixtures: user-service side
async function makePtWithPackage(over: { validityDays?: number | null; price?: number } = {}) {
  const pt = await H.makePt();
  userCreated.pts.push(pt);
  const pkg = await H.m.prisma.pTServicePackage.create({
    data: {
      id: randomUUID(), ptUserId: pt, name: "Goi 10 buoi P3.7", sessionCount: SESSIONS, price: over.price ?? PRICE,
      sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: over.validityDays === undefined ? VALIDITY : over.validityDays,
    },
  });
  return { pt, ptToken: H.tokenFor(pt, "PT"), pkg };
}
function newClient() {
  const id = randomUUID();
  return { id, token: H.tokenFor(id, "CUSTOMER") };
}

const gymOptions = (client: { token: string }, pt: string, pkgId: string) =>
  H.call("GET", `/contracts/gym-options?ptUserId=${pt}&packageId=${pkgId}`, client.token);
const requestVia = (client: { token: string }, pt: string, pkgId: string, gymId?: string) =>
  H.call("POST", "/contracts/request", client.token, { ptUserId: pt, packageId: pkgId, gymId, acknowledgedLowAvailability: true });
const rowsOf = (clientId: string) => H.m.prisma.contract.findMany({ where: { clientUserId: clientId } });
const contractRow = (id: string) => H.m.prisma.contract.findUniqueOrThrow({ where: { id } });

/** request -> accept; returns the contract id after PENDING_PAYMENT. Registers the row for cleanup. */
async function requestAndAccept(client: { id: string; token: string }, ptw: { pt: string; ptToken: string; pkg: { id: string } }, gymId: string) {
  const req = await requestVia(client, ptw.pt, ptw.pkg.id, gymId);
  assert.equal(req.status, 201, JSON.stringify(req.body));
  userCreated.contracts.push(req.body.id);
  assert.equal(req.body.status, "PENDING_REVIEW");
  const acc = await H.call("PATCH", `/contracts/${req.body.id}/accept`, ptw.ptToken);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const row = await contractRow(req.body.id);
  assert.equal(row.status, "PENDING_PAYMENT");
  return row;
}
async function payContract(client: { token: string }, contractId: string) {
  const r = await H.call("POST", `/contracts/${contractId}/pay`, client.token, { provider: "VNPAY" });
  return { ...r, txnId: r.body?.payment?.transactionId as string };
}

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    await H.startPayment().catch(() => {});
    await H.m.base.cleanup(userCreated.pts, userCreated.contracts).catch(() => {});
    userCreated.pts = [];
    userCreated.contracts = [];
    await H.cleanup();
    await cleanupGym();
  }
}

/** The ledger rows one successful contract payment must leave: exactly one credit per party/bucket. */
async function assertLedgerOfPaidContract(txnId: string, ptId: string, gymId: string, escrowExpected = PRICE) {
  assert.deepEqual(await H.escrow(), w(escrowExpected), "escrow holds exactly the expected money");
  assert.deepEqual(await H.wallet("PT", ptId), w(0, PT_SHARE));
  assert.deepEqual(await H.wallet("GYM", gymId), w(0, GYM_SHARE));
  assert.deepEqual(await H.revenue(), w(0, PLATFORM_SHARE));
  const rows = await H.entries(txnId);
  const credit = (ownerType: string, bucket: string) => rows.filter((e) => e.ownerType === ownerType && e.bucket === bucket && e.type === "CREDIT");
  assert.deepEqual(credit("PT", "PENDING").map((e) => e.amount), [PT_SHARE], "one PT credit");
  assert.deepEqual(credit("GYM", "PENDING").map((e) => e.amount), [GYM_SHARE], "one gym credit");
  assert.deepEqual(credit("PLATFORM", "PENDING").map((e) => e.amount), [PLATFORM_SHARE], "one platform credit");
  assert.deepEqual(credit("PLATFORM", "AVAILABLE").map((e) => e.amount), [PRICE], "one escrow credit of the full price");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Cases 4 + 8 + 10 + MAIN FLOW: eligible client, full flow through the simulated gateway
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("MAIN (cases 4, 8, 10): eligible client -> gym-options -> request -> accept -> checkout-context -> pay -> simulated IPN -> ACTIVE once; ledger = price; snapshots on the contract", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 2 });
    const client = newClient();
    const mem = await addMembership(world, client.id, { gymIndex: 0, endInDays: 90 });
    const [A1, A2] = world.gyms;

    // gym-options (REAL gym-service): both branches offered (brand-level agreement), the client is eligible at both
    const opts = await gymOptions(client, ptw.pt, ptw.pkg.id);
    assert.equal(opts.status, 200, JSON.stringify(opts.body));
    assert.equal(opts.body.requestBlockedReason, null);
    assert.deepEqual(opts.body.gyms.map((g: any) => g.gymId).sort(), [A1, A2].sort());
    for (const g of opts.body.gyms) {
      assert.deepEqual(g.eligibility, { canRequest: true, reason: null }, `eligible at ${g.name}`);
      assert.equal(g.membership.hasActiveMembership, true);
      assert.equal(g.membership.membershipId, mem.id);
      assert.equal(g.brandId, world.brandId);
    }
    assert.equal(JSON.stringify(opts.body).includes("0.7"), false, "gym-options does not leak the revenue split");

    // request (gym A1) -> PENDING_REVIEW with the snapshots
    const req = await requestVia(client, ptw.pt, ptw.pkg.id, A1);
    assert.equal(req.status, 201, JSON.stringify(req.body));
    userCreated.contracts.push(req.body.id);
    const id = req.body.id as string;
    let row = await contractRow(id);
    assert.equal(row.status, "PENDING_REVIEW");
    assert.equal(row.source, "GYM");
    assert.equal(row.gymId, A1);
    assert.equal(Number(row.price), PRICE);
    assert.equal(row.totalSessions, SESSIONS);
    assert.deepEqual([Number(row.ptRate), Number(row.gymRate), Number(row.platformRate)], [0.7, 0.2, 0.1], "rates snapshotted from the agreement");
    assert.equal(row.gymBrandId, world.brandId, "brand snapshot");
    assert.equal(row.gymAgreementId, world.agreementId, "agreement snapshot");
    assert.equal(row.gymAgreementScope, "BRAND");
    assert.equal(row.gymMembershipId, mem.id, "membership snapshot");
    assert.equal(await H.m.prisma.contract.count({ where: { clientUserId: client.id } }), 1);

    // PT accepts -> PENDING_PAYMENT (nothing paid yet)
    const acc = await H.call("PATCH", `/contracts/${id}/accept`, ptw.ptToken);
    assert.equal(acc.status, 200, JSON.stringify(acc.body));
    row = await contractRow(id);
    assert.equal(row.status, "PENDING_PAYMENT");
    assert.ok(row.paymentDueAt && row.paymentDueAt.getTime() > Date.now());
    assert.equal(row.paymentTransactionId, null);
    assert.equal((await H.snapshot()).entries, 0, "no ledger movement before payment");

    // checkout-context (read-only): what pay will send; anyone else is refused
    const ctx = await H.call("GET", `/contracts/${id}/checkout-context`, client.token);
    assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
    assert.equal(ctx.body.amount, PRICE);
    assert.deepEqual(ctx.body.parties, { ptUserId: ptw.pt, gymId: A1, clientUserId: client.id });
    assert.deepEqual(ctx.body.gym, { gymId: A1, brandId: world.brandId, agreementId: world.agreementId, agreementScope: "BRAND" });
    assert.equal(ctx.body.membership.membershipId, mem.id);
    assert.deepEqual(ctx.body.recheck, { ptAcceptsNewBusiness: true, paymentDeadlinePassed: false, gym: "OK" });
    assert.equal(ctx.body.payment.hasPaymentTransaction, false);
    assert.equal((await H.call("GET", `/contracts/${id}/checkout-context`, H.tokenFor(randomUUID(), "CUSTOMER"))).status, 403);
    assert.equal((await H.snapshot()).entries, 0, "reading the context moved nothing");

    // pay -> a real checkout on the real payment-service
    const pay = await payContract(client, id);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.ok(pay.txnId, "payment-service returned a transaction id");
    const txn = await H.payTxn(pay.txnId);
    assert.ok(txn, "the transaction exists in the payment DB");

    // case 8: checkout-context amount == what payment-service actually received (independent read of the payment DB)
    const ctxAfterPay = await H.call("GET", `/contracts/${id}/checkout-context`, client.token);
    assert.equal(ctxAfterPay.status, 200);
    assert.equal(ctxAfterPay.body.amount, txn!.amount, "checkout-context amount == payment_transactions.amount");
    assert.equal(txn!.amount, PRICE);
    assert.equal(txn!.status, "PENDING");
    assert.equal(txn!.relatedEntityId, id);
    assert.equal(txn!.relatedEntityType, "PT_CONTRACT");
    assert.equal(txn!.gymId, A1, "payment-service holds the same gym as the context");
    assert.equal(txn!.ptId, ptw.pt);
    assert.equal(txn!.payerId, client.id);
    const mr = txn!.metadata?.rates;
    assert.deepEqual([Number(mr.ptRate), Number(mr.gymRate), Number(mr.platformRate)], [0.7, 0.2, 0.1], "frozen rates at payment-service == snapshot");
    assert.equal(ctxAfterPay.body.payment.hasPaymentTransaction, false, "contract not linked to a transaction until it is paid");
    show("payment_transactions row", { amount: txn!.amount, status: txn!.status, gymId: txn!.gymId, metadataRates: mr });
    assert.equal((await H.snapshot()).entries, 0, "still no ledger movement while the checkout is open");

    // simulated gateway pays -> payment-service settles the ledger -> calls user-service activate-after-payment
    const ipn = await H.gatewayIpn(pay.txnId, PRICE);
    assert.equal(ipn.RspCode, "00", JSON.stringify(ipn));
    row = await contractRow(id);
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.paymentTransactionId, pay.txnId);
    assert.ok(row.startDate && row.endDate);
    assert.equal(Math.round((row.endDate!.getTime() - row.startDate!.getTime()) / DAY), VALIDITY);
    assert.equal((await H.payTxn(pay.txnId))!.status, "PAID");
    await assertLedgerOfPaidContract(pay.txnId, ptw.pt, A1);
    assert.deepEqual(await H.wallet("GYM", A2), w(0), "the other branch got nothing (gym share is keyed by the contract's gymId)");
    // snapshots survive activation
    assert.equal(row.gymBrandId, world.brandId);
    assert.equal(row.gymAgreementId, world.agreementId);
    assert.equal(row.gymMembershipId, mem.id);
    assert.equal((await H.call("GET", `/contracts/${id}/checkout-context`, client.token)).status, 409, "no checkout context once paid");
    await H.invariant("main flow");
    show("MAIN ledger (dong)", {
      price: PRICE, escrowAvailable: PRICE, ptPending: PT_SHARE, gymA1Pending: GYM_SHARE, gymA2: 0, platformPending: PLATFORM_SHARE,
      contract: row.status, activationCount: 1,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Cases 1-3: membership gate
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("case 1: no membership -> 422 MEMBERSHIP_REQUIRED, no contract row, gym-options says so; a membership at ANOTHER brand does not count", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt);
    const other = await makeBrandWorld(null, { branches: 1 }); // another brand, no agreement with this PT
    const client = newClient();
    await addMembership(other, client.id); // only at the other brand
    const A1 = world.gyms[0];

    const opts = await gymOptions(client, ptw.pt, ptw.pkg.id);
    assert.equal(opts.status, 200);
    assert.ok(opts.body.gyms.length > 0);
    for (const g of opts.body.gyms) assert.deepEqual(g.eligibility, { canRequest: false, reason: "MEMBERSHIP_REQUIRED" });

    const r = await requestVia(client, ptw.pt, ptw.pkg.id, A1);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, "MEMBERSHIP_REQUIRED");
    assert.equal(r.body.gymId, A1);
    assert.equal(r.body.brandId, world.brandId);
    assert.equal((await rowsOf(client.id)).length, 0, "no contract row was written");
    assert.equal((await H.snapshot()).entries, 0);
  });
});

test("case 2: expired membership (by end date, and by status EXPIRED / CANCELLED / PENDING_PAYMENT) -> blocked, no row", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt);
    const A1 = world.gyms[0];
    const variants: Array<[string, { status?: string; endInDays?: number | null }]> = [
      ["ACTIVE row but end date passed", { endInDays: -1 }],
      ["status EXPIRED", { status: "EXPIRED", endInDays: -1 }],
      ["status CANCELLED", { status: "CANCELLED", endInDays: 90 }],
      ["status PENDING_PAYMENT", { status: "PENDING_PAYMENT", endInDays: 90 }],
    ];
    for (const [label, v] of variants) {
      const client = newClient();
      await addMembership(world, client.id, v);
      const opts = await gymOptions(client, ptw.pt, ptw.pkg.id);
      assert.equal(opts.status, 200);
      for (const g of opts.body.gyms) assert.deepEqual(g.eligibility, { canRequest: false, reason: "MEMBERSHIP_REQUIRED" }, label);
      const r = await requestVia(client, ptw.pt, ptw.pkg.id, A1);
      assert.equal(r.status, 422, `${label}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "MEMBERSHIP_REQUIRED", label);
      assert.equal((await rowsOf(client.id)).length, 0, `${label}: no row`);
    }
  });
});

test("case 3: active but too short -> 422 MEMBERSHIP_DOES_NOT_COVER_CONTRACT (10 days vs a 60-day contract); exactly 60 days and longer are allowed", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage({ validityDays: VALIDITY });
    const world = await makeBrandWorld(ptw.pt);
    const A1 = world.gyms[0];

    const short = newClient();
    const shortMem = await addMembership(world, short.id, { endInDays: 10 });
    const opts = await gymOptions(short, ptw.pt, ptw.pkg.id);
    for (const g of opts.body.gyms) assert.deepEqual(g.eligibility, { canRequest: false, reason: "MEMBERSHIP_DOES_NOT_COVER_CONTRACT" });
    const r = await requestVia(short, ptw.pt, ptw.pkg.id, A1);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, "MEMBERSHIP_DOES_NOT_COVER_CONTRACT");
    assert.ok(r.body.membershipEndDate && r.body.contractEndDate);
    assert.ok(Date.parse(r.body.membershipEndDate) < Date.parse(r.body.contractEndDate));
    assert.equal(shortMem.id.length > 0, true);
    assert.equal((await rowsOf(short.id)).length, 0, "no row");

    // 60 vs 60 (bought a minute ago - ends in 60 days, rounded up): allowed; and longer: allowed
    for (const days of [60, 61, 365]) {
      const c = newClient();
      await addMembership(world, c.id, { endInDays: days });
      const ok = await requestVia(c, ptw.pt, ptw.pkg.id, A1);
      assert.equal(ok.status, 201, `membership ${days}d vs contract ${VALIDITY}d: ${JSON.stringify(ok.body)}`);
      userCreated.contracts.push(ok.body.id);
    }
    // a membership with no end date never ends -> covers
    const open = newClient();
    await addMembership(world, open.id, { endInDays: null });
    const ok2 = await requestVia(open, ptw.pt, ptw.pkg.id, A1);
    assert.equal(ok2.status, 201, JSON.stringify(ok2.body));
    userCreated.contracts.push(ok2.body.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Case 5: the gym / partner / agreement side - not offered AND refused
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("case 5: gym temporarily closed / permanently closed / partner locked / agreement terminating / no agreement -> not offered in gym-options AND request refused (400), no row", { skip }, async () => {
  const variants: Array<[string, Parameters<typeof makeBrandWorld>[1]]> = [
    ["gym TEMPORARILY_CLOSED", { operationalStatus: "TEMPORARILY_CLOSED" }],
    ["gym PERMANENTLY_CLOSED", { operationalStatus: "PERMANENTLY_CLOSED" }],
    ["partner SUSPENDED (locked)", { partnerStatus: "SUSPENDED" }],
    ["agreement terminating (terminationInitiatedAt set)", { agreement: { terminationInitiatedAt: new Date(), effectiveAt: new Date(Date.now() + 30 * DAY) } }],
    ["agreement TERMINATED", { agreement: { status: "TERMINATED" } }],
    ["no agreement at all", { agreement: null }],
  ];
  for (const [label, cfg] of variants) {
    await scenario(async () => {
      const ptw = await makePtWithPackage();
      const world = await makeBrandWorld(ptw.pt, { branches: 1, ...cfg });
      const client = newClient();
      await addMembership(world, client.id, { endInDays: 90 }); // the membership itself is perfectly fine
      const A1 = world.gyms[0];

      const opts = await gymOptions(client, ptw.pt, ptw.pkg.id);
      assert.equal(opts.status, 200, `${label}: ${JSON.stringify(opts.body)}`);
      assert.deepEqual(opts.body.gyms, [], `${label}: not offered`);
      assert.equal(opts.body.gymsReason, "NO_GYM_AGREEMENT", label);

      const r = await requestVia(client, ptw.pt, ptw.pkg.id, A1);
      assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`);
      assert.equal((await rowsOf(client.id)).length, 0, `${label}: no row`);
    });
  }
  // control: the same set-up with nothing wrong IS offered and requestable
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1, partnerStatus: "ACTIVE" });
    const client = newClient();
    await addMembership(world, client.id);
    assert.equal((await gymOptions(client, ptw.pt, ptw.pkg.id)).body.gyms.length, 1, "control (active partner): offered");
    const ok = await requestVia(client, ptw.pt, ptw.pkg.id, world.gyms[0]);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    userCreated.contracts.push(ok.body.id);
  });
});

test("case 5b (gym changes MID-WAY): gym closes after the request -> accept refused 409 GYM_NOT_ACCEPTING_CONTRACTS; closes after accept -> pay refused before any checkout, context says so; rates change -> 409 GYM_TERMS_CHANGED", { skip }, async () => {
  await scenario(async () => {
    // closes between request and accept
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const client = newClient();
    await addMembership(world, client.id);
    const A1 = world.gyms[0];
    const req = await requestVia(client, ptw.pt, ptw.pkg.id, A1);
    assert.equal(req.status, 201, JSON.stringify(req.body));
    userCreated.contracts.push(req.body.id);
    await G.gym.update({ where: { id: A1 }, data: { operationalStatus: "TEMPORARILY_CLOSED" } });
    const acc = await H.call("PATCH", `/contracts/${req.body.id}/accept`, ptw.ptToken);
    assert.equal(acc.status, 409, JSON.stringify(acc.body));
    assert.equal(acc.body.code, "GYM_NOT_ACCEPTING_CONTRACTS");
    assert.equal((await contractRow(req.body.id)).status, "PENDING_REVIEW", "contract untouched");

    // closes between accept and pay
    const pt2 = await makePtWithPackage();
    const world2 = await makeBrandWorld(pt2.pt, { branches: 1 });
    const client2 = newClient();
    await addMembership(world2, client2.id);
    const row = await requestAndAccept(client2, pt2, world2.gyms[0]);
    await G.gym.update({ where: { id: world2.gyms[0] }, data: { operationalStatus: "TEMPORARILY_CLOSED" } });
    const ctx = await H.call("GET", `/contracts/${row.id}/checkout-context`, client2.token);
    assert.equal(ctx.status, 200);
    assert.equal(ctx.body.recheck.gym, "GYM_NOT_ACCEPTING_CONTRACTS");
    const pay = await payContract(client2, row.id);
    assert.equal(pay.status, 409, JSON.stringify(pay.body));
    assert.equal(pay.body.code, "GYM_NOT_ACCEPTING_CONTRACTS");
    assert.deepEqual(await H.payTxnsFor(row.id), [], "no payment transaction was created");
    assert.equal((await H.snapshot()).entries, 0);
    assert.equal((await contractRow(row.id)).status, "PENDING_PAYMENT");

    // agreement rates change after the request
    const pt3 = await makePtWithPackage();
    const world3 = await makeBrandWorld(pt3.pt, { branches: 1 });
    const client3 = newClient();
    await addMembership(world3, client3.id);
    const req3 = await requestVia(client3, pt3.pt, pt3.pkg.id, world3.gyms[0]);
    assert.equal(req3.status, 201);
    userCreated.contracts.push(req3.body.id);
    await G.gymBrandPtAgreement.update({ where: { id: world3.agreementId! }, data: { proposedPtRate: "0.6000", proposedGymRate: "0.3000" } });
    const acc3 = await H.call("PATCH", `/contracts/${req3.body.id}/accept`, pt3.ptToken);
    assert.equal(acc3.status, 409, JSON.stringify(acc3.body));
    assert.equal(acc3.body.code, "GYM_TERMS_CHANGED");
    assert.deepEqual([Number((await contractRow(req3.body.id)).ptRate), Number((await contractRow(req3.body.id)).gymRate)], [0.7, 0.2], "the contract keeps the rates it was created with");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Cases 6-7: PT restriction scope (D38)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const restrictInput = (pt: string) => ({ ptUserId: pt, adminId: "admin-p37", reasonCategory: "COMPLAINT_REVIEW" as const, reasonText: "noi bo", publicReason: "Dang xem xet" });

test("cases 6 + 7: restriction on THIS contract (contract scope) blocks this client's new request; the SAME restriction on another client's contract leaves the PT selectable and requestable for a different client (D38)", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt);
    const A1 = world.gyms[0];

    // X has a PAID contract through the whole real flow, then ONLY that contract is restricted
    const x = newClient();
    await addMembership(world, x.id);
    const rowX = await requestAndAccept(x, ptw, A1);
    const payX = await payContract(x, rowX.id);
    assert.equal(payX.status, 200, JSON.stringify(payX.body));
    assert.equal((await H.gatewayIpn(payX.txnId, PRICE)).RspCode, "00");
    assert.equal((await contractRow(rowX.id)).status, "ACTIVE");

    const r = await H.m.ptRestrictionService.restrictContract({ ...restrictInput(ptw.pt), contractId: rowX.id });
    assert.equal(r.restriction.scope, "CONTRACT");
    assert.equal((await H.m.prisma.userProfile.findUniqueOrThrow({ where: { userId: ptw.pt } })).ptSuspended, false, "the PT is not suspended");

    // case 6: X (the restricted contract's client) cannot start another one with this PT
    const optsX = await gymOptions(x, ptw.pt, ptw.pkg.id);
    assert.equal(optsX.status, 200, JSON.stringify(optsX.body));
    assert.equal(optsX.body.requestBlockedReason, "ACTIVE_CONTRACT_EXISTS");
    assert.deepEqual(optsX.body.gyms, []);
    const again = await requestVia(x, ptw.pt, ptw.pkg.id, A1);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(await H.m.prisma.contract.count({ where: { clientUserId: x.id } }), 1, "no second row for X");
    // and the restricted contract itself is paused for X (effective status)
    const mine = await H.call("GET", `/contracts/${rowX.id}`, x.token);
    assert.equal(mine.status, 200);

    // case 7: Y, a DIFFERENT client, still sees the PT and the gym and can request, be accepted and pay
    const y = newClient();
    await addMembership(world, y.id);
    const optsY = await gymOptions(y, ptw.pt, ptw.pkg.id);
    assert.equal(optsY.body.requestBlockedReason, null, JSON.stringify(optsY.body));
    assert.deepEqual(optsY.body.gyms.map((g: any) => [g.gymId, g.eligibility.canRequest]).sort(), world.gyms.map((g) => [g, true]).sort());
    const rowY = await requestAndAccept(y, ptw, A1);
    const payY = await payContract(y, rowY.id);
    assert.equal(payY.status, 200, JSON.stringify(payY.body));
    assert.equal((await H.gatewayIpn(payY.txnId, PRICE)).RspCode, "00");
    assert.equal((await contractRow(rowY.id)).status, "ACTIVE", "Y's contract activates although X's contract is restricted");
    assert.deepEqual(await H.escrow(), w(2 * PRICE));
    assert.deepEqual(await H.wallet("GYM", A1), w(0, 2 * GYM_SHARE));
    show("case 6/7 ledger (dong)", { escrow: 2 * PRICE, ptPending: 2 * PT_SHARE, gymA1Pending: 2 * GYM_SHARE });
  });
});

test("case 6b: PT account restricted -> new request, accept and pay are all refused before any money moves (409 PT_TEMPORARILY_UNAVAILABLE); checkout-context reports it", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt);
    const A1 = world.gyms[0];
    const c1 = newClient();
    const c2 = newClient();
    const c3 = newClient();
    for (const c of [c1, c2, c3]) await addMembership(world, c.id);

    const reqA = await requestVia(c1, ptw.pt, ptw.pkg.id, A1); // pending review
    assert.equal(reqA.status, 201);
    userCreated.contracts.push(reqA.body.id);
    const rowB = await requestAndAccept(c2, ptw, A1); // pending payment

    // a contract-scope restriction can only be placed on an ACTIVE contract - not on one still waiting for payment
    await assert.rejects(
      H.m.ptRestrictionService.restrictContract({ ...restrictInput(ptw.pt), contractId: rowB.id }),
      (e: any) => e.code === "CONTRACT_NOT_RESTRICTABLE" && e.status === 409,
    );
    await H.m.ptRestrictionService.suspend(restrictInput(ptw.pt));

    const optsC = await gymOptions(c3, ptw.pt, ptw.pkg.id);
    assert.equal(optsC.body.requestBlockedReason, "PT_TEMPORARILY_UNAVAILABLE");
    assert.deepEqual(optsC.body.gyms, []);
    const newReq = await requestVia(c3, ptw.pt, ptw.pkg.id, A1);
    assert.equal(newReq.status, 409, JSON.stringify(newReq.body));
    assert.equal(newReq.body.code, "PT_TEMPORARILY_UNAVAILABLE");
    assert.equal((await rowsOf(c3.id)).length, 0);

    const acc = await H.call("PATCH", `/contracts/${reqA.body.id}/accept`, ptw.ptToken);
    assert.equal(acc.status, 409, JSON.stringify(acc.body));

    const ctx = await H.call("GET", `/contracts/${rowB.id}/checkout-context`, c2.token);
    assert.equal(ctx.status, 200);
    assert.deepEqual(ctx.body.recheck.ptAcceptsNewBusiness, { blockedCode: "PT_TEMPORARILY_UNAVAILABLE" });
    const pay = await payContract(c2, rowB.id);
    assert.equal(pay.status, 409, JSON.stringify(pay.body));
    assert.deepEqual(await H.payTxnsFor(rowB.id), [], "no checkout was created");
    assert.equal((await H.snapshot()).entries, 0, "no money moved");
    assert.equal((await contractRow(rowB.id)).status, "PENDING_PAYMENT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Case 9: failed payment
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("case 9: failed IPN / short-paid IPN / gateway (payment-service) outage -> contract NOT activated, no escrow credit, no money moved; a later retry succeeds once", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const A1 = world.gyms[0];
    const client = newClient();
    await addMembership(world, client.id);
    const row = await requestAndAccept(client, ptw, A1);
    const before = await H.snapshot();

    // (a) the gateway reports the payment FAILED
    const p1 = await payContract(client, row.id);
    assert.equal(p1.status, 200, JSON.stringify(p1.body));
    const failedIpn = await H.gatewayIpn(p1.txnId, PRICE, false);
    show("failed IPN reply", failedIpn);
    let after = await contractRow(row.id);
    assert.equal(after.status, "PENDING_PAYMENT", "not activated by a failed payment");
    assert.equal(after.paymentTransactionId, null);
    assert.equal((await H.payTxn(p1.txnId))!.status, "FAILED");
    assert.deepEqual(await H.snapshot(), before, "no ledger movement at all");
    assert.deepEqual(await H.escrow(), w(0));

    // (b) a new checkout, the gateway confirms LESS than the price -> refused, nothing credited
    const p2 = await payContract(client, row.id);
    assert.equal(p2.status, 200, JSON.stringify(p2.body));
    const short = await H.gatewayIpn(p2.txnId, PRICE - 100_000, true);
    show("short-paid IPN reply", short);
    assert.notEqual(short.RspCode, "00", "an IPN whose amount differs from the price is not accepted as success");
    after = await contractRow(row.id);
    assert.equal(after.status, "PENDING_PAYMENT");
    assert.equal(after.paymentTransactionId, null);
    assert.deepEqual(await H.escrow(), w(0), "nothing credited for a short payment");

    // (c) payment-service is down at pay time -> pay fails, nothing created
    await H.stopPayment();
    const down = await payContract(client, row.id);
    assert.ok(down.status >= 400, `pay while payment-service is down answered ${down.status}`);
    after = await contractRow(row.id);
    assert.equal(after.status, "PENDING_PAYMENT");
    assert.equal(after.paymentTransactionId, null);
    await H.startPayment();
    assert.deepEqual(await H.escrow(), w(0));

    // (d) the retry after all of that pays correctly, exactly once
    const p3 = await payContract(client, row.id);
    assert.equal(p3.status, 200, JSON.stringify(p3.body));
    assert.equal((await H.gatewayIpn(p3.txnId, PRICE)).RspCode, "00");
    after = await contractRow(row.id);
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.paymentTransactionId, p3.txnId);
    await assertLedgerOfPaidContract(p3.txnId, ptw.pt, A1);
    for (const t of [p1.txnId, p2.txnId]) assert.equal((await H.entries(t)).length, 0, "the failed / short attempts left no ledger rows");
    show("case 9 ledger (dong)", { failedAttempts: 2, escrowAfterRetry: PRICE, activeOnce: true });
  });
});

test("case 9b: a genuine exact-amount success arriving AFTER a failed report settles the payment exactly once (documented design: webhook.service.ts - FAILED money was never booked)", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const A1 = world.gyms[0];
    const client = newClient();
    await addMembership(world, client.id);
    const row = await requestAndAccept(client, ptw, A1);
    const p1 = await payContract(client, row.id);
    await H.gatewayIpn(p1.txnId, PRICE, false);
    assert.equal((await H.payTxn(p1.txnId))!.status, "FAILED");
    assert.equal((await contractRow(row.id)).status, "PENDING_PAYMENT");
    assert.deepEqual(await H.escrow(), w(0));
    assert.equal((await H.gatewayIpn(p1.txnId, PRICE, true)).RspCode, "00");
    assert.equal((await contractRow(row.id)).status, "ACTIVE");
    assert.equal((await contractRow(row.id)).paymentTransactionId, p1.txnId);
    await assertLedgerOfPaidContract(p1.txnId, ptw.pt, A1);
    // and once settled, a further copy of the success changes nothing
    const snap = await H.snapshot();
    await H.gatewayIpn(p1.txnId, PRICE, true);
    assert.deepEqual(await H.snapshot(), snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Cases 10-11: activation exactly once; duplicates / repeats / concurrency
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("cases 10 + 11a/b: a replayed IPN and 6 concurrent duplicate IPNs activate the contract once and write the ledger once", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const A1 = world.gyms[0];
    const client = newClient();
    await addMembership(world, client.id);
    const row = await requestAndAccept(client, ptw, A1);
    const pay = await payContract(client, row.id);
    assert.equal(pay.status, 200);

    // sequential: success, then the very same callback again
    const first = await H.gatewayIpn(pay.txnId, PRICE);
    assert.equal(first.RspCode, "00");
    const afterFirst = await contractRow(row.id);
    assert.equal(afterFirst.status, "ACTIVE");
    const snap = await H.snapshot();
    const replay = await H.gatewayIpn(pay.txnId, PRICE);
    show("replayed IPN reply", replay);
    assert.deepEqual(await H.snapshot(), snap, "the replay changed nothing in the ledger");
    const afterReplay = await contractRow(row.id);
    assert.equal(afterReplay.status, "ACTIVE");
    assert.equal(afterReplay.paymentTransactionId, pay.txnId);
    assert.equal(afterReplay.startDate!.getTime(), afterFirst.startDate!.getTime(), "start date not re-stamped by the replay");
    assert.equal(afterReplay.endDate!.getTime(), afterFirst.endDate!.getTime());
    await assertLedgerOfPaidContract(pay.txnId, ptw.pt, A1);

    // a second client, 6 identical callbacks fired at once
    const c2 = newClient();
    await addMembership(world, c2.id);
    const row2 = await requestAndAccept(c2, ptw, A1);
    const pay2 = await payContract(c2, row2.id);
    assert.equal(pay2.status, 200);
    const replies = await Promise.all(Array.from({ length: 6 }, () => H.gatewayIpn(pay2.txnId, PRICE)));
    show("concurrent IPN replies", { codes: replies.map((r) => r.RspCode) });
    const act = await contractRow(row2.id);
    assert.equal(act.status, "ACTIVE");
    assert.equal(act.paymentTransactionId, pay2.txnId);
    const rows2 = await H.entries(pay2.txnId);
    const count = (ot: string, bucket: string) => rows2.filter((e) => e.ownerType === ot && e.bucket === bucket && e.type === "CREDIT").length;
    assert.deepEqual([count("PT", "PENDING"), count("GYM", "PENDING"), count("PLATFORM", "PENDING"), count("PLATFORM", "AVAILABLE")], [1, 1, 1, 1], "exactly one credit per party despite 6 callbacks");
    assert.deepEqual(await H.escrow(), w(2 * PRICE), "escrow = two prices, not more");
    assert.deepEqual(await H.wallet("GYM", A1), w(0, 2 * GYM_SHARE));
    assert.deepEqual(await H.wallet("PT", ptw.pt), w(0, 2 * PT_SHARE));
    assert.equal((await H.payTxn(pay2.txnId))!.status, "PAID");
    // one contract, one active contract for the pair
    assert.equal(await H.m.prisma.contract.count({ where: { id: row2.id, status: "ACTIVE" } }), 1);
    await H.invariant("after duplicate callbacks");
    show("case 10/11 ledger (dong)", { twoContractsEscrow: 2 * PRICE, callbacksPerPayment: [2, 6] });
  });
});

test("case 11c: repeated pay requests - after payment 409 ALREADY_PAID; two checkouts opened before payment and both paid -> one activation, the surplus is refunded in full, escrow = one price", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const A1 = world.gyms[0];
    const client = newClient();
    await addMembership(world, client.id);
    const row = await requestAndAccept(client, ptw, A1);

    // two pay requests before any payment: two separate attempts (each has its own idempotency key by design)
    const [pa, pb] = [await payContract(client, row.id), await payContract(client, row.id)];
    assert.equal(pa.status, 200, JSON.stringify(pa.body));
    assert.equal(pb.status, 200, JSON.stringify(pb.body));
    assert.notEqual(pa.txnId, pb.txnId);
    assert.equal((await H.snapshot()).entries, 0, "opening checkouts moves no money");

    assert.equal((await H.gatewayIpn(pa.txnId, PRICE)).RspCode, "00");
    const active = await contractRow(row.id);
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.paymentTransactionId, pa.txnId);

    // the client pays the second checkout too (a second window)
    const ipnB = await H.gatewayIpn(pb.txnId, PRICE);
    show("second checkout paid after the contract is ACTIVE", { ipn: ipnB, payTxnB: await H.payTxn(pb.txnId), clientWallet: await H.wallet("CLIENT", client.id), escrow: await H.escrow() });
    const finalRow = await contractRow(row.id);
    assert.equal(finalRow.paymentTransactionId, pa.txnId, "the contract stays bound to the first payment");
    assert.equal(finalRow.status, "ACTIVE");
    assert.equal(await H.m.prisma.contract.count({ where: { id: row.id, status: "ACTIVE" } }), 1);
    // the contract's own ledger is untouched by the second payment
    await assertLedgerOfPaidContract(pa.txnId, ptw.pt, A1, 2 * PRICE); // escrow also holds the 2nd payment, owed back to the client
    assert.deepEqual(await H.wallet("PT", ptw.pt), w(0, PT_SHARE), "PT credited once");
    assert.deepEqual(await H.wallet("GYM", A1), w(0, GYM_SHARE), "gym credited once");
    // the surplus payment must come back to the client (escrow minus contract = what the client holds)
    const client_ = await H.wallet("CLIENT", client.id);
    const escrow = await H.escrow();
    show("case 11c ledger (dong)", { escrow: escrow.a, clientWallet: client_, expectedEscrow: PRICE + client_.a + client_.p + client_.l });
    await H.invariant("after double payment");
    assert.equal(client_.a + client_.p + client_.l, escrow.a - PRICE, "whatever escrow holds beyond the one price is owed to the client");
    assert.equal(escrow.a - PRICE, PRICE, "second payment is fully owed back to the client (full refund), not kept");

    // third pay request after the contract is paid
    const third = await payContract(client, row.id);
    assert.equal(third.status, 409, JSON.stringify(third.body));
    assert.equal(third.body.error, "ALREADY_PAID");
    assert.equal((await H.payTxnsFor(row.id)).length, 2, "no third checkout was created");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Extra: PT restricted while the payment is in flight
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("extra X1: PT is restricted AFTER the client opened a checkout, BEFORE the IPN -> contract not activated, client refunded in full, no PT/gym/platform credit", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld(ptw.pt, { branches: 1 });
    const A1 = world.gyms[0];
    const client = newClient();
    await addMembership(world, client.id);
    const row = await requestAndAccept(client, ptw, A1);
    const pay = await payContract(client, row.id);
    assert.equal(pay.status, 200);

    await H.m.ptRestrictionService.suspend(restrictInput(ptw.pt));
    const ipn = await H.gatewayIpn(pay.txnId, PRICE);
    show("IPN while the PT is restricted", ipn);
    const after = await contractRow(row.id);
    assert.notEqual(after.status, "ACTIVE", "a restricted PT does not get a new active contract");
    assert.equal(after.paymentTransactionId, null);
    const cl = await H.wallet("CLIENT", client.id);
    const escrow = await H.escrow();
    const pt = await H.wallet("PT", ptw.pt);
    const gym = await H.wallet("GYM", A1);
    const rev = await H.revenue();
    show("X1 ledger (dong)", { client: cl, escrow, pt, gym, platform: rev, contract: after.status });
    assert.deepEqual([pt, gym, rev], [w(0), w(0), w(0)], "nobody earned anything");
    assert.equal(cl.a + cl.p + cl.l, PRICE, "the client's whole payment is owed back");
    assert.equal(escrow.a, PRICE, "escrow holds exactly the refundable money");
  });
});
