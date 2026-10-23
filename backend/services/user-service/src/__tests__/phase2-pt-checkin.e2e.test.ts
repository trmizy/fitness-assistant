/**
 * Phase 2 / slice P2.4 (owner decisions D16, D17, D70) - PT QR check-in across THREE real services, with the money
 * proven untouched. PT scans the BRANCH QR -> gym-service (POST /me/pt-gym-checkins) -> user-service
 * (GET /internal/pt/:id/gym-sessions) -> one row in gym_pt_check_ins; nothing else may move.
 *
 * Evidence labels (see _warroom/sessions/S_p2_4.md):
 *   BACKEND INTEGRATION + REAL HTTP/API on isolated test databases (gymcoach_user_p24_test, gymcoach_gym_p24_test,
 *   gymcoach_payment_p24_test).
 *   REAL     user-service (its Express app + services, in this process, serving the P2.1 internal API over real HTTP),
 *            gym-service (own OS process: real Express app, real Prisma, real PT check-in service and real user.client
 *            calling user-service over HTTP), payment-service (own OS process, real ledger). The contracts the tests use
 *            are REALLY bought: request -> accept -> checkout -> (simulated) IPN -> ACTIVE, so the ledger holds real
 *            numbers (5,000,000 d / 10 sessions, 70/20/10: PT 3,500,000 + branch 1,000,000 + platform 500,000).
 *            Restrictions, bans, terminations, session completion/confirmation and the branch QR are the real services.
 *   FIXTURE  (TEST FIXTURE) auth: gym-service verifies bearer tokens against a tiny auth-service stand-in that answers
 *            from the harness token table (tokenFor); the gateway IPN is signed by the harness (VNPay HMAC, test secret);
 *            session rows are inserted at the state a scenario starts from (e.g. CONFIRMED earlier today - a check-in is
 *            driven by the session SCHEDULE, the clock is never faked); gym-side brand/branch/agreement/membership rows
 *            are inserted into the gym test DB; in Q-B/Q18 the PREVIOUS day's gym_pt_check_ins row is inserted (the real
 *            clock cannot be at yesterday) and a rescheduled session is a direct update of its times.
 *   NOT COVERED: a real browser, the API gateway, a real payment gateway, mobile, account-switch isolation, chat-service.
 *
 * Opt-in (spawns two services, TRUNCATEs the payment ledger tables of the p24 payment DB) - run it alone:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 \
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_p24_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_p24_test?schema=public" \
 *   E2E_GYM_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_p24_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/phase2-pt-checkin.e2e.test.ts
 *
 * Invariance: around EVERY check-in (successful or refused) the test takes a fingerprint = a full-row md5 of the user
 * tables sessions / contracts / session_settlements, of the payment tables wallets / wallet_ledger_entries /
 * ledger_operations / payment_transactions / partner_receivables / platform_commissions, and of the gym tables
 * gym_membership_contracts / gym_check_ins (so updatedAt and every counter are inside it), plus readable summaries
 * (session status+updatedAt, contract status/usedSessions/compensatedSessions/releasedTo*, balances). Equality is asserted
 * with deepEqual. Only gym_pt_check_ins is allowed to change.
 *
 * Money maths (by hand): 5,000,000 / 10 sessions = 500,000 a session = PT 350,000 + branch 100,000 + platform 50,000.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { skip as harnessSkip, startHarness, type Harness } from "./cross-service-money.harness";
import { isTestDatabaseUrl } from "./test-db-guard";

const GYM_DB_URL = process.env.E2E_GYM_DATABASE_URL ?? "";
const skip: string | false =
  harnessSkip || (isTestDatabaseUrl(GYM_DB_URL) ? false : "Set E2E_GYM_DATABASE_URL to a *_test gym-service database (e.g. gymcoach_gym_p24_test).");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const VN = 7 * HOUR; // Asia/Ho_Chi_Minh, no DST
const PRICE = 5_000_000;
const SESSIONS = 10;
const PER_SESSION = { pt: 350_000, gym: 100_000, platform: 50_000 };
const PT_SHARE = 3_500_000;
const GYM_SHARE = 1_000_000;
const PLATFORM_SHARE = 500_000;
const RATES = { pt: "0.7000", gym: "0.2000", platform: "0.1000" };
const ADMIN = "admin-p24";

let H: Harness;
let G: any; // gym-service's own Prisma client on the gym test DB (fixture writer + independent reader)
const gymCreated = { memberships: [] as string[], plans: [] as string[], agreements: [] as string[], gyms: [] as string[], accounts: [] as string[], partners: [] as string[], brands: [] as string[] };
const userCreated = { contracts: [] as string[], pts: [] as string[] };

test.before(async () => {
  if (skip) return;
  process.env.REQUIRE_CONTRACT_ESIGN = "false"; // product decision: e-sign is paused, accept goes straight to PENDING_PAYMENT
  H = await startHarness({ gym: { databaseUrl: GYM_DB_URL, bridge: true } });
  // user-service's own auth-service lookups (e-mails of the parties) answer a fixed address; mails go nowhere
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

const show = (label: string, o: Record<string, unknown>) => console.log(`[P2.4] ${label} ${JSON.stringify(o)}`);
const w = (a: number, p = 0, l = 0) => ({ a, p, l });

// ─────────────────────────────────────────────────────────────── the local day (Asia/Ho_Chi_Minh), computed independently
const dayStartOf = (t: number) => Math.floor((t + VN) / DAY) * DAY - VN;
const dayStart = () => dayStartOf(Date.now());
const localDateOf = (dayStartMs: number) => new Date(dayStartMs + VN).toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────── fixtures: gym-service side (TEST FIXTURE)
interface GymWorld {
  ownerId: string;
  ownerToken: string;
  brandId: string;
  gyms: string[]; // branch ids; gyms[0] = "G", gyms[1] = "H"
  planId: string;
  agreementId: string | null;
}

async function makeBrandWorld(ptUserIds: string[], o: { branches?: number } = {}): Promise<GymWorld> {
  const ownerId = randomUUID();
  const partner = await G.gymPartner.create({
    data: { legalName: `P2.4 ${ownerId.slice(0, 8)}`, contactEmail: `${ownerId.slice(0, 8)}@p24.test`, status: "ACTIVE", verificationStatus: "VERIFIED" },
  });
  gymCreated.partners.push(partner.id);
  const acc = await G.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: ownerId, role: "OWNER", scopedGymIds: [], status: "ACTIVE", activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  gymCreated.accounts.push(acc.id);
  const brand = await G.gymBrand.create({ data: { id: randomUUID(), ownerId, name: "P2.4 Brand" } });
  gymCreated.brands.push(brand.id);
  const gyms: string[] = [];
  for (let i = 0; i < (o.branches ?? 2); i++) {
    const g = await G.gym.create({
      data: { id: randomUUID(), ownerId, brandId: brand.id, name: `P2.4 Branch ${i + 1}`, address: `${i + 1} Test St`, city: "HCM", status: "APPROVED", operationalStatus: "OPEN" },
    });
    gymCreated.gyms.push(g.id);
    gyms.push(g.id);
  }
  const plan = await G.gymMembershipPlan.create({ data: { id: randomUUID(), brandId: brand.id, name: "P2.4 Plan 90d", price: 900_000, durationDays: 90 } });
  gymCreated.plans.push(plan.id);
  let agreementId: string | null = null;
  for (const ptUserId of ptUserIds) {
    const row = await G.gymBrandPtAgreement.create({
      data: {
        id: randomUUID(), brandId: brand.id, ptUserId, proposedPtRate: RATES.pt, proposedGymRate: RATES.gym, platformRate: RATES.platform,
        status: "ACCEPTED", proposedBy: "GYM", expiresAt: new Date(Date.now() + 7 * DAY), acceptedAt: new Date(), origin: "NATIVE",
      },
    });
    gymCreated.agreements.push(row.id);
    agreementId = row.id;
  }
  return { ownerId, ownerToken: H.tokenFor(ownerId, "GYM_OWNER"), brandId: brand.id, gyms, planId: plan.id, agreementId };
}

async function addMembership(world: GymWorld, clientId: string, o: { gymIndex?: number } = {}) {
  const m = await G.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId: world.gyms[o.gymIndex ?? 0], planId: world.planId, clientId, status: "ACTIVE",
      priceAtPurchase: 900_000, durationDaysSnapshot: 90, startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + 90 * DAY),
    },
  });
  gymCreated.memberships.push(m.id);
  return m as { id: string };
}

async function cleanupGym() {
  const ids = { ...gymCreated };
  gymCreated.memberships = []; gymCreated.plans = []; gymCreated.agreements = []; gymCreated.gyms = [];
  gymCreated.accounts = []; gymCreated.partners = []; gymCreated.brands = [];
  await G.$executeRawUnsafe("DELETE FROM gym_pt_check_ins WHERE gym_id = ANY($1::text[])", ids.gyms);
  await G.$executeRawUnsafe("DELETE FROM gym_check_ins WHERE membership_id = ANY($1::text[])", ids.memberships).catch(() => {});
  await G.gymMembershipContract.deleteMany({ where: { id: { in: ids.memberships } } });
  await G.gymMembershipPlan.deleteMany({ where: { id: { in: ids.plans } } });
  await G.gymBrandPtAgreement.deleteMany({ where: { id: { in: ids.agreements } } });
  await G.gym.deleteMany({ where: { id: { in: ids.gyms } } });
  await G.gymPartnerAccount.deleteMany({ where: { id: { in: ids.accounts } } });
  await G.gymPartner.deleteMany({ where: { id: { in: ids.partners } } });
  await G.gymBrand.deleteMany({ where: { id: { in: ids.brands } } });
}

// ─────────────────────────────────────────────────────────────── fixtures: user-service side
interface Ptw { pt: string; ptToken: string; pkg: { id: string } }
async function makePtWithPackage(): Promise<Ptw> {
  const pt = await H.makePt();
  userCreated.pts.push(pt);
  const pkg = await H.m.prisma.pTServicePackage.create({
    data: { id: randomUUID(), ptUserId: pt, name: "Goi 10 buoi P2.4", sessionCount: SESSIONS, price: PRICE, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 60 },
  });
  return { pt, ptToken: H.tokenFor(pt, "PT"), pkg };
}
const newClient = () => {
  const id = randomUUID();
  return { id, token: H.tokenFor(id, "CUSTOMER") };
};
const contractRow = (id: string) => H.m.prisma.contract.findUniqueOrThrow({ where: { id } });

interface PaidContract { id: string; ptUserId: string; clientUserId: string; clientToken: string; ptToken: string; txnId: string; gymId: string }

/** A contract REALLY bought through user-service + gym-service + payment-service: request -> accept -> pay -> simulated IPN -> ACTIVE. */
async function buyContract(world: GymWorld, ptw: Ptw, gymIndex = 0): Promise<PaidContract> {
  const client = newClient();
  await addMembership(world, client.id, { gymIndex });
  const gymId = world.gyms[gymIndex];
  const req = await H.call("POST", "/contracts/request", client.token, { ptUserId: ptw.pt, packageId: ptw.pkg.id, gymId, acknowledgedLowAvailability: true });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  userCreated.contracts.push(req.body.id);
  const acc = await H.call("PATCH", `/contracts/${req.body.id}/accept`, ptw.ptToken);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const pay = await H.call("POST", `/contracts/${req.body.id}/pay`, client.token, { provider: "VNPAY" });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const txnId = pay.body.payment.transactionId as string;
  const ipn = await H.gatewayIpn(txnId, PRICE);
  assert.equal(ipn.RspCode, "00", JSON.stringify(ipn));
  const row = await contractRow(req.body.id);
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.gymId, gymId);
  assert.deepEqual([Number(row.ptRate), Number(row.gymRate), Number(row.platformRate)], [0.7, 0.2, 0.1]);
  return { id: row.id, ptUserId: ptw.pt, clientUserId: client.id, clientToken: client.token, ptToken: ptw.ptToken, txnId, gymId };
}

/**
 * A session of the contract on the PT's LOCAL TODAY (TEST FIXTURE row; the check-in is driven by this schedule, not by a faked
 * clock): it starts at the beginning of the local day and ends at most an hour later / just before now, so it overlaps today's
 * window whatever time the suite runs and is already over (so the PT can report it done in the money-continuation test).
 */
async function todaySession(c: { id: string; ptUserId: string; clientUserId: string }, status = "CONFIRMED", extra: Record<string, unknown> = {}) {
  const ds = dayStart();
  return H.m.base.addSession(c, status, new Date(ds), { scheduledEndAt: new Date(Math.min(ds + HOUR, Date.now() - 5000)), ...extra });
}
const sessionAt = (c: { id: string; ptUserId: string; clientUserId: string }, status: string, startMs: number, endMs: number, extra: Record<string, unknown> = {}) =>
  H.m.base.addSession(c, status, new Date(startMs), { scheduledEndAt: new Date(endMs), ...extra });

// ─────────────────────────────────────────────────────────────── the invariance fingerprint
async function tableHash(db: any, table: string) {
  const r: any[] = await db.$queryRawUnsafe(`SELECT count(*)::text AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${table} t`);
  return `${r[0].n}:${r[0].h}`;
}
async function fingerprint() {
  const P = H.m.prisma;
  const sessions = (await P.session.findMany({ select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } })).map((s) => `${s.id}|${s.status}|${s.updatedAt.toISOString()}`);
  const contracts = (
    await P.contract.findMany({
      select: { id: true, status: true, usedSessions: true, compensatedSessions: true, releasedToPt: true, releasedToGym: true, releasedToPlatform: true },
      orderBy: { id: "asc" },
    })
  ).map((c) => `${c.id}|${c.status}|${c.usedSessions}|${c.compensatedSessions}|${c.releasedToPt}|${c.releasedToGym}|${c.releasedToPlatform}`);
  const settlements = (await P.sessionSettlement.findMany({ select: { id: true, kind: true, status: true }, orderBy: { id: "asc" } })).map((s) => `${s.id}|${s.kind}|${s.status}`);
  return {
    sessions,
    contracts,
    settlements,
    userTables: {
      sessions: await tableHash(P, "sessions"),
      contracts: await tableHash(P, "contracts"),
      session_settlements: await tableHash(P, "session_settlements"),
    },
    ledger: await H.snapshot(), // non-zero balances + row counts
    payTables: {
      wallets: await tableHash(H.payDb, "wallets"),
      wallet_ledger_entries: await tableHash(H.payDb, "wallet_ledger_entries"),
      ledger_operations: await tableHash(H.payDb, "ledger_operations"),
      payment_transactions: await tableHash(H.payDb, "payment_transactions"),
      partner_receivables: await tableHash(H.payDb, "partner_receivables"),
      platform_commissions: await tableHash(H.payDb, "platform_commissions"),
    },
    gymTables: {
      gym_membership_contracts: await tableHash(G, "gym_membership_contracts"),
      gym_check_ins: await tableHash(G, "gym_check_ins"),
    },
  };
}

// ─────────────────────────────────────────────────────────────── gym-service over HTTP (real process)
async function gymCall(method: string, p: string, token: string | null, body?: unknown) {
  const res = await fetch(H.gymUrl + p, {
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
async function qrOf(world: GymWorld, gymId: string): Promise<string> {
  const r = await gymCall("GET", `/owner/gyms/${gymId}/checkin-qr`, world.ownerToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token as string;
}
const scanRaw = (ptToken: string, qr: string) => gymCall("POST", "/me/pt-gym-checkins", ptToken, { token: qr });

/** One scan with the fingerprint taken right before and right after: NOTHING but gym_pt_check_ins may differ. */
async function scan(ptToken: string, qr: string, label: string) {
  const before = await fingerprint();
  const r = await scanRaw(ptToken, qr);
  const after = await fingerprint();
  assert.deepEqual(after, before, `${label}: a PT check-in (${r.status} ${r.body?.error?.code ?? "ok"}) must not move one byte of sessions/contracts/settlements/ledger/membership`);
  return r;
}
async function ptRows(ptId: string) {
  const rows: any[] = await G.$queryRawUnsafe(
    `SELECT id, gym_id, to_char(local_date,'YYYY-MM-DD') AS local_date, scan_count, qualifying_session_ids, contract_ids
       FROM gym_pt_check_ins WHERE pt_user_id = $1 ORDER BY gym_id, local_date`,
    ptId,
  );
  return rows.map((r) => ({ id: r.id as string, gymId: r.gym_id as string, localDate: r.local_date as string, scanCount: Number(r.scan_count), sessions: [...r.qualifying_session_ids].sort() as string[], contracts: [...r.contract_ids].sort() as string[] }));
}
/** TEST FIXTURE: the row a real scan on an earlier day would have left (the real clock cannot be at "yesterday"). */
async function insertPastCheckIn(gymId: string, brandId: string, ptId: string, localDate: string, sessionIds: string[], contractIds: string[]) {
  await G.$executeRawUnsafe(
    `INSERT INTO gym_pt_check_ins (id, gym_id, brand_id, pt_user_id, local_date, first_scan_at, last_scan_at, scan_count, qualifying_session_ids, contract_ids)
     VALUES ($1,$2,$3,$4,$5::date, now() - interval '1 day', now() - interval '1 day', 1, $6::text[], $7::text[])`,
    randomUUID(), gymId, brandId, ptId, localDate, sessionIds, contractIds,
  );
}
const code = (r: { body: any }) => r.body?.error?.code;

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    await H.startUser().catch(() => {});
    await H.startPayment().catch(() => {});
    await H.m.base.cleanup(userCreated.pts, userCreated.contracts).catch(() => {});
    userCreated.pts = [];
    userCreated.contracts = [];
    await H.cleanup();
    await cleanupGym();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. MAIN: success, re-scan, 10 concurrent; invariance; then the NORMAL flow still releases money exactly once
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("MAIN: CONFIRMED session today at branch G of an ACTIVE paid contract -> 200 + one row; re-scan and 10 concurrent -> still one row; nothing moves; then the normal complete/confirm releases exactly once", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt]);
    const [G1] = world.gyms;
    const c = await buyContract(world, ptw, 0);
    const s1 = await todaySession(c);
    const qr = await qrOf(world, G1);

    // the real purchase left exactly this in the ledger (by hand: 5,000,000 -> 3,500,000 / 1,000,000 / 500,000, all pending)
    assert.deepEqual(await H.escrow(), w(PRICE));
    assert.deepEqual(await H.wallet("PT", ptw.pt), w(0, PT_SHARE));
    assert.deepEqual(await H.wallet("GYM", G1), w(0, GYM_SHARE));
    assert.deepEqual(await H.revenue(), w(0, PLATFORM_SHARE));

    // first scan
    const first = await scan(ptw.ptToken, qr, "first scan");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.kind, "PT");
    assert.equal(first.body.data.scanCount, 1);
    assert.equal(first.body.data.localDate, localDateOf(dayStart()));
    assert.ok(!JSON.stringify(first.body).includes(c.clientUserId), "the PT's answer carries no client identity");
    let rows = await ptRows(ptw.pt);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].gymId, rows[0].localDate, rows[0].scanCount, rows[0].sessions, rows[0].contracts], [G1, localDateOf(dayStart()), 1, [s1.id], [c.id]]);
    assert.equal(rows[0].id, first.body.data.checkinId);

    // same scan again
    const again = await scan(ptw.ptToken, qr, "re-scan");
    assert.equal(again.status, 200);
    assert.equal(again.body.data.checkinId, first.body.data.checkinId, "same record");
    assert.equal(again.body.data.scanCount, 2);
    assert.equal((await ptRows(ptw.pt)).length, 1);

    // 10 concurrent scans of the same QR
    const before = await fingerprint();
    const burst = await Promise.all(Array.from({ length: 10 }, () => scanRaw(ptw.ptToken, qr)));
    assert.deepEqual(await fingerprint(), before, "10 concurrent check-ins moved nothing");
    assert.ok(burst.every((r) => r.status === 200), JSON.stringify(burst.map((r) => r.status)));
    assert.equal(new Set(burst.map((r) => r.body.data.checkinId)).size, 1, "all ten answered with the same record");
    assert.equal(burst[0].body.data.checkinId, first.body.data.checkinId);
    rows = await ptRows(ptw.pt);
    assert.equal(rows.length, 1, "still ONE row for this PT/branch/day");
    assert.equal(rows[0].scanCount, 12, "1 + 1 + 10 scans counted on the one row");

    // the owner sees the PT entry, never the client
    const list = await gymCall("GET", `/owner/gyms/${G1}/pt-checkins`, world.ownerToken);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].ptUserId, ptw.pt);
    assert.ok(!JSON.stringify(list.body).includes(c.clientUserId) && !JSON.stringify(list.body).includes(c.id), "owner list: no client identity, no contract id");

    // ── the normal flow still works after the check-in, through the existing path ──
    const ledgerBefore = await fingerprint();
    const done = await H.call("PATCH", `/sessions/${s1.id}/complete`, c.ptToken, { ptNotes: "ok" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await H.m.prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status, "PENDING_CLIENT_CONFIRMATION");
    const afterDone = await fingerprint();
    assert.deepEqual(afterDone.payTables, ledgerBefore.payTables, "the PT reporting the session done moves no money");
    assert.notEqual(afterDone.userTables.sessions, ledgerBefore.userTables.sessions, "(the fingerprint does see a real session change)");

    // a check-in while the session awaits confirmation (Q14: still a basis) changes nothing either
    const mid = await scan(ptw.ptToken, qr, "scan while awaiting confirmation");
    assert.equal(mid.status, 200);

    const conf = await H.call("POST", `/sessions/${s1.id}/confirm`, c.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    const afterConf = await fingerprint();
    assert.notEqual(afterConf.payTables.wallets, afterDone.payTables.wallets, "(the fingerprint does see a real release)");
    assert.notEqual(afterConf.userTables.contracts, afterDone.userTables.contracts);
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: s1.id } });
    assert.equal(sess.status, "COMPLETED");
    const k = await contractRow(c.id);
    assert.deepEqual([k.usedSessions, k.compensatedSessions, Number(k.releasedToPt), Number(k.releasedToGym), Number(k.releasedToPlatform)], [1, 0, PER_SESSION.pt, PER_SESSION.gym, PER_SESSION.platform]);
    assert.deepEqual(await H.wallet("PT", ptw.pt), w(PER_SESSION.pt, PT_SHARE - PER_SESSION.pt));
    assert.deepEqual(await H.wallet("GYM", G1), w(PER_SESSION.gym, GYM_SHARE - PER_SESSION.gym));
    assert.deepEqual(await H.revenue(), w(PER_SESSION.platform, PLATFORM_SHARE - PER_SESSION.platform));
    assert.deepEqual(await H.escrow(), w(PRICE), "the escrow still backs every claim");
    const release = await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: s1.id, kind: "SESSION_RELEASE" } });
    assert.equal(release.length, 1);
    assert.equal(release[0].status, "SETTLED");
    const credits = (await H.entries(c.txnId)).filter((e) => e.type === "CREDIT" && e.bucket === "AVAILABLE" && e.ownerId !== "ESCROW");
    assert.deepEqual(credits.map((e) => [e.ownerType, e.amount]).sort(), [["GYM", PER_SESSION.gym], ["PLATFORM", PER_SESSION.platform], ["PT", PER_SESSION.pt]].sort(), "one release credit per party, once");

    // a late retry of the confirm and a check-in after COMPLETED: nothing more is released, nothing moves
    const afterRelease = await fingerprint();
    const retry = await H.call("POST", `/sessions/${s1.id}/confirm`, c.clientToken);
    show("repeat confirm", { status: retry.status });
    assert.deepEqual((await fingerprint()).payTables, afterRelease.payTables, "a repeated confirmation releases nothing more");
    const late = await scan(ptw.ptToken, qr, "scan after COMPLETED");
    assert.equal(late.status, 200, "Q14: a COMPLETED session still is a basis for the day");
    assert.deepEqual(await H.wallet("PT", ptw.pt), w(PER_SESSION.pt, PT_SHARE - PER_SESSION.pt));
    await H.invariant("after release");

    show("MAIN ledger (dong)", {
      price: PRICE, escrowAvailable: PRICE, afterCheckin: { ptPending: PT_SHARE, gymPending: GYM_SHARE, platformPending: PLATFORM_SHARE },
      afterRelease: { ptAvailable: PER_SESSION.pt, ptPending: PT_SHARE - PER_SESSION.pt, gymAvailable: PER_SESSION.gym, gymPending: GYM_SHARE - PER_SESSION.gym, platformAvailable: PER_SESSION.platform, platformPending: PLATFORM_SHARE - PER_SESSION.platform },
      releaseSettlements: release.length, ptCheckinRows: (await ptRows(ptw.pt)).length, scanCount: (await ptRows(ptw.pt))[0].scanCount,
    });
  });
});

test("SENSITIVITY: the invariance fingerprint really detects a one-row change in every family it guards (so its silence around check-ins means something)", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const c = await buyContract(world, ptw, 0);
    const s = await todaySession(c);
    const membership = await addMembership(world, ptw.pt, { gymIndex: 0 });
    const base = await fingerprint();
    const differs = (a: any, b: any) => JSON.stringify(a) !== JSON.stringify(b);

    await H.m.prisma.session.update({ where: { id: s.id }, data: { notes: "touched" } }); // bumps updatedAt
    const f1 = await fingerprint();
    assert.ok(differs(f1.sessions, base.sessions) && differs(f1.userTables, base.userTables), "a session touch is seen");
    await H.m.prisma.contract.update({ where: { id: c.id }, data: { usedSessions: 1 } });
    const f2 = await fingerprint();
    assert.ok(differs(f2.contracts, f1.contracts) && differs(f2.userTables, f1.userTables), "a contract counter change is seen");
    await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance + 0.01 WHERE owner_type = 'PT'::"WalletOwnerType" AND owner_id = $1`, ptw.pt);
    const f3 = await fingerprint();
    assert.ok(differs(f3.payTables, f2.payTables) && differs(f3.ledger, f2.ledger), "a one-cent wallet change is seen");
    await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - 0.01 WHERE owner_type = 'PT'::"WalletOwnerType" AND owner_id = $1`, ptw.pt);
    await G.gymMembershipContract.update({ where: { id: membership.id }, data: { usedVisits: 1 } });
    const f4 = await fingerprint();
    assert.ok(differs(f4.gymTables, f3.gymTables), "a membership visit count change is seen");
    await H.m.prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.id}`, contractId: c.id, sessionId: s.id, status: "PENDING" } });
    const f5 = await fingerprint();
    assert.ok(differs(f5.settlements, f4.settlements) && differs(f5.userTables, f4.userTables), "a new settlement row is seen");
    show("SENSITIVITY", { sessionTouch: true, contractCounter: true, oneCentWallet: true, membershipVisits: true, settlementRow: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Branch scope + "no basis today"
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("another branch -> 403 PT_NO_QUALIFYING_SESSION (and the right branch works); a session at the right branch but not today -> 403", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 3 });
    const [G1, H1, K1] = world.gyms;
    const atG = await buyContract(world, ptw, 0);
    const atH = await buyContract(world, ptw, 1);
    const sH = await todaySession(atH);
    await sessionAt(atG, "CONFIRMED", dayStart() + DAY + 2 * HOUR, dayStart() + DAY + 3 * HOUR); // G: tomorrow only
    const [qrG, qrH, qrK] = [await qrOf(world, G1), await qrOf(world, H1), await qrOf(world, K1)];

    const wrongBranch = await scan(ptw.ptToken, qrG, "scan G (session today is at H)");
    assert.deepEqual([wrongBranch.status, code(wrongBranch)], [403, "PT_NO_QUALIFYING_SESSION"]);
    const noContractBranch = await scan(ptw.ptToken, qrK, "scan K (no contract there)");
    assert.deepEqual([noContractBranch.status, code(noContractBranch)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 0, "refusals wrote nothing");

    const ok = await scan(ptw.ptToken, qrH, "scan H");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const rows = await ptRows(ptw.pt);
    assert.deepEqual(rows.map((r) => [r.gymId, r.sessions, r.contracts]), [[H1, [sH.id], [atH.id]]]);
    // G is still refused even after H worked: one branch's basis is not another's
    assert.equal(code(await scan(ptw.ptToken, qrG, "scan G again")), "PT_NO_QUALIFYING_SESSION");
    assert.equal((await ptRows(ptw.pt)).length, 1);
  });
});

test("no basis today -> 403: no session at all, sessions of other days, edge touching the day, and today's sessions that are not a basis (REQUESTED / DISPUTED / CANCELLED / ONLINE / HYBRID)", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const [G1] = world.gyms;
    const c = await buyContract(world, ptw, 0);
    const qr = await qrOf(world, G1);
    const ds = dayStart();

    assert.equal(code(await scan(ptw.ptToken, qr, "no session at all")), "PT_NO_QUALIFYING_SESSION");
    await sessionAt(c, "CONFIRMED", ds - DAY + 3 * HOUR, ds - DAY + 4 * HOUR); // yesterday
    await sessionAt(c, "CONFIRMED", ds + DAY + 3 * HOUR, ds + DAY + 4 * HOUR); // tomorrow
    await sessionAt(c, "CONFIRMED", ds - HOUR, ds); // ends exactly at 00:00 today: touches, does not overlap
    await sessionAt(c, "CONFIRMED", ds + DAY, ds + DAY + HOUR); // starts exactly at 00:00 tomorrow
    assert.equal(code(await scan(ptw.ptToken, qr, "sessions on other days only")), "PT_NO_QUALIFYING_SESSION");

    for (const st of ["REQUESTED", "DISPUTED", "PT_NO_SHOW_REPORTED", "CANCELLED"]) await todaySession(c, st);
    await todaySession(c, "CONFIRMED", { sessionMode: "ONLINE" });
    await todaySession(c, "CONFIRMED", { sessionMode: "HYBRID" });
    const r = await scan(ptw.ptToken, qr, "today, but nothing qualifies");
    assert.deepEqual([r.status, code(r)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 0);

    // the moment one real basis exists it works
    await todaySession(c, "PENDING_CLIENT_CONFIRMATION");
    assert.equal((await scan(ptw.ptToken, qr, "now with a PENDING_CLIENT_CONFIRMATION session")).status, 200);
  });
});

test("roles: a CUSTOMER token and a missing token cannot use the PT route; a bad QR is refused", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const c = await buyContract(world, ptw, 0);
    await todaySession(c);
    const qr = await qrOf(world, world.gyms[0]);
    assert.equal((await scan(c.clientToken, qr, "customer token")).status, 403);
    assert.equal((await scan("", qr, "no token")).status, 401);
    const bad = await scan(ptw.ptToken, qr.slice(0, -4) + "AAAA", "forged QR");
    assert.equal(bad.status, 400);
    assert.equal((await ptRows(ptw.pt)).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. D38: restriction at CONTRACT scope
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("D38: a contract-scope restriction on An-Binh removes only Binh's basis; An-Chi still allows check-in (real restrictContract)", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const [G1] = world.gyms;
    const binh = await buyContract(world, ptw, 0);
    const chi = await buyContract(world, ptw, 0);
    const binhPending = await todaySession(binh, "PENDING_CLIENT_CONFIRMATION"); // a restriction does not call this one off
    const binhConfirmed = await todaySession(binh, "CONFIRMED"); // already over (not "upcoming"), so the restriction does not call it off either
    const chiSession = await todaySession(chi, "CONFIRMED");
    const qr = await qrOf(world, G1);

    const r = await H.m.ptRestrictionService.restrictContract({ ptUserId: ptw.pt, contractId: binh.id, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW" as any, reasonText: "khiếu nại riêng lẻ", publicReason: "Đang xem xét" });
    assert.equal(r.changed, true);
    assert.equal((await H.m.prisma.session.findUniqueOrThrow({ where: { id: binhConfirmed.id } })).status, "CONFIRMED", "Binh's confirmed session is still CONFIRMED - only the restriction removes it as a basis");
    assert.equal((await H.m.prisma.session.findUniqueOrThrow({ where: { id: binhPending.id } })).status, "PENDING_CLIENT_CONFIRMATION", "Binh's awaiting session is left alone");
    assert.equal((await contractRow(chi.id)).status, "ACTIVE");

    const ok = await scan(ptw.ptToken, qr, "An still teaches Chi");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const rows = await ptRows(ptw.pt);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].sessions, rows[0].contracts], [[chiSession.id], [chi.id]], "the basis is Chi's session ONLY - neither of Binh's sessions (CONFIRMED / awaiting) is counted");
    show("D38 contract-scope", { basisSessions: rows[0].sessions.length, basisContracts: rows[0].contracts.length, binhExcluded: !rows[0].contracts.includes(binh.id) });
  });
});

test("D38 (other side): when only the restricted contract has a basis today -> 403; lifting the restriction brings it back", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const binh = await buyContract(world, ptw, 0);
    const chi = await buyContract(world, ptw, 0);
    await todaySession(binh, "PENDING_CLIENT_CONFIRMATION");
    await sessionAt(chi, "CONFIRMED", dayStart() + DAY + HOUR, dayStart() + DAY + 2 * HOUR); // Chi: tomorrow
    const qr = await qrOf(world, world.gyms[0]);
    await H.m.ptRestrictionService.restrictContract({ ptUserId: ptw.pt, contractId: binh.id, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW" as any, reasonText: "x", publicReason: "x" });
    const r = await scan(ptw.ptToken, qr, "only Binh has a session, and Binh is restricted");
    assert.deepEqual([r.status, code(r)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 0);
    await H.m.ptRestrictionService.liftContractRestriction({ ptUserId: ptw.pt, contractId: binh.id, adminId: ADMIN, reason: "đã xong" });
    assert.equal((await scan(ptw.ptToken, qr, "restriction lifted")).status, 200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. Account suspension / ban
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("account suspension (real service) -> 403 PT_RESTRICTED even after an earlier scan today (rights are evaluated at scan time); lift -> allowed again", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const c = await buyContract(world, ptw, 0);
    await todaySession(c, "PENDING_CLIENT_CONFIRMATION");
    const qr = await qrOf(world, world.gyms[0]);
    assert.equal((await scan(ptw.ptToken, qr, "before the suspension")).status, 200);

    await H.m.ptRestrictionService.suspend({ ptUserId: ptw.pt, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW" as any, reasonText: "nội bộ", publicReason: "Đang xem xét" });
    const blocked = await scan(ptw.ptToken, qr, "suspended PT");
    assert.deepEqual([blocked.status, code(blocked)], [403, "PT_RESTRICTED"]);
    assert.equal((await ptRows(ptw.pt))[0].scanCount, 1, "the refused scan did not touch the earlier record");

    await H.m.ptRestrictionService.lift({ ptUserId: ptw.pt, adminId: ADMIN, reason: "đã xong" });
    const back = await scan(ptw.ptToken, qr, "after the lift");
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal((await ptRows(ptw.pt))[0].scanCount, 2);
  });
});

test("permanent ban (real deactivatePT: contracts unwound, refunds through payment-service) -> 403 PT_BANNED, no row", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const c = await buyContract(world, ptw, 0);
    await todaySession(c, "PENDING_CLIENT_CONFIRMATION");
    const qr = await qrOf(world, world.gyms[0]);

    const res = await H.m.ptDeactivationService.deactivatePT({ ptUserId: ptw.pt, adminId: ADMIN, reason: "vi phạm", seq: BigInt(Date.now()) });
    assert.equal(res.complete, true, JSON.stringify(res.outcomes));
    await H.invariant("after the ban unwind");
    const blocked = await scan(ptw.ptToken, qr, "banned PT");
    assert.deepEqual([blocked.status, code(blocked)], [403, "PT_BANNED"]);
    assert.equal((await ptRows(ptw.pt)).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. Contract ending (unconfirmed / confirmed) and sessions called off
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("CONTRACT_ENDING: a recorded-but-unconfirmed ending is not a basis (payment-service really down); once settled the cancelled contract is not either; the PT's other contract still is", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const ending = await buyContract(world, ptw, 0);
    const fine = await buyContract(world, ptw, 0);
    await todaySession(ending, "PENDING_CLIENT_CONFIRMATION"); // held sessions survive the ending, so only the contract filter can exclude it
    await sessionAt(fine, "CONFIRMED", dayStart() + DAY + HOUR, dayStart() + DAY + 2 * HOUR); // the other contract: tomorrow
    const qr = await qrOf(world, world.gyms[0]);
    assert.equal((await scan(ptw.ptToken, qr, "sanity: an ACTIVE contract with an awaiting session today qualifies")).status, 200);
    await G.$executeRawUnsafe("DELETE FROM gym_pt_check_ins WHERE pt_user_id = $1", ptw.pt); // start the real scenario from a clean record

    await H.stopPayment(); // the one dependency the ending needs, really gone
    const failed = await H.call("POST", `/contracts/${ending.id}/terminate`, ending.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(failed.status, 409, JSON.stringify(failed.body));
    assert.equal(failed.body.code, "CONTRACT_ENDING");
    assert.equal((await contractRow(ending.id)).status, "ACTIVE", "recorded but not confirmed: still ACTIVE");
    const pend = await H.m.prisma.sessionSettlement.findMany({ where: { contractId: ending.id, kind: "CONTRACT_TERMINATION" } });
    assert.equal(pend.length, 1);
    assert.notEqual(pend[0].status, "SETTLED");

    const r1 = await scan(ptw.ptToken, qr, "ending recorded, payment-service down");
    assert.deepEqual([r1.status, code(r1)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 0);

    await H.startPayment();
    const retry = await H.call("POST", `/contracts/${ending.id}/terminate`, ending.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal((await contractRow(ending.id)).status, "CANCELLED");
    const r2 = await scan(ptw.ptToken, qr, "contract CANCELLED and settled");
    assert.deepEqual([r2.status, code(r2)], [403, "PT_NO_QUALIFYING_SESSION"]);

    // the other contract is untouched: give it a session today and the PT is let in on THAT contract alone
    const finSess = await todaySession(fine, "CONFIRMED");
    const ok = await scan(ptw.ptToken, qr, "the other contract");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const rows = await ptRows(ptw.pt);
    assert.deepEqual([rows[0].sessions, rows[0].contracts], [[finSess.id], [fine.id]]);
    await H.invariant("after the ending");
  });
});

test("sessions called off (PT cancels the session) -> no basis; a client cancelling the whole contract -> no basis", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const c = await buyContract(world, ptw, 0);
    const solo = await buyContract(world, ptw, 0);
    // a session that starts a little later today (it may run past midnight: it still overlaps today) so the REAL cancel endpoint accepts it
    const startsLater = Date.now() + 10 * 60_000;
    const stillToday = startsLater < dayStart() + DAY;
    const s = stillToday
      ? await sessionAt(c, "CONFIRMED", startsLater, startsLater + HOUR)
      : await todaySession(c, "CONFIRMED"); // in the last 10 minutes of the local day: cancelled by fixture below
    const qr = await qrOf(world, world.gyms[0]);
    if (stillToday) {
      assert.equal((await scan(ptw.ptToken, qr, "sanity: confirmed session later today")).status, 200);
      await G.$executeRawUnsafe("DELETE FROM gym_pt_check_ins WHERE pt_user_id = $1", ptw.pt);
      const cancel = await H.call("PATCH", `/sessions/${s.id}/cancel`, c.ptToken, { reason: "bận" });
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    } else {
      await H.m.prisma.session.update({ where: { id: s.id }, data: { status: "CANCELLED" } }); // TEST FIXTURE
    }
    // a PT cancelling less than 24h before the start is booked by the existing rules as a late/no-show outcome (money moves HERE, before any scan) - either way the session is called off
    const calledOff = (await H.m.prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status;
    assert.ok(["CANCELLED", "NO_SHOW"].includes(calledOff), calledOff);
    show("session called off", { status: calledOff, realEndpoint: stillToday });
    const r1 = await scan(ptw.ptToken, qr, "session called off");
    assert.deepEqual([r1.status, code(r1)], [403, "PT_NO_QUALIFYING_SESSION"]);

    // a second contract with an awaiting session today, then its client ends the contract for real (payment-service up)
    await todaySession(solo, "PENDING_CLIENT_CONFIRMATION");
    assert.equal((await scan(ptw.ptToken, qr, "sanity: awaiting session qualifies")).status, 200);
    await G.$executeRawUnsafe("DELETE FROM gym_pt_check_ins WHERE pt_user_id = $1", ptw.pt);
    const end = await H.call("POST", `/contracts/${solo.id}/terminate`, solo.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(end.status, 200, JSON.stringify(end.body));
    assert.equal((await contractRow(solo.id)).status, "CANCELLED");
    const r2 = await scan(ptw.ptToken, qr, "contract ended by the client");
    assert.deepEqual([r2.status, code(r2)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 0);
    await H.invariant("after the cancellations");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 6. Q-B (moved session) and Q18 (midnight-crossing) - driven by the session schedule
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("Q-B: a session that already was the basis of YESTERDAY and has since been moved to today is not a basis for today", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const [G1] = world.gyms;
    const c = await buyContract(world, ptw, 0);
    const ds = dayStart();
    const moved = await sessionAt(c, "CONFIRMED", ds - DAY + 9 * HOUR, ds - DAY + 10 * HOUR); // originally yesterday 09:00
    await insertPastCheckIn(G1, world.brandId, ptw.pt, localDateOf(ds - DAY), [moved.id], [c.id]); // the real scan of yesterday (fixture)
    // the reschedule is done: the session now sits on today (TEST FIXTURE: what a completed reschedule leaves behind)
    await H.m.prisma.session.update({ where: { id: moved.id }, data: { scheduledStartAt: new Date(ds), scheduledEndAt: new Date(Math.min(ds + HOUR, Date.now() - 5000)) } });
    const qr = await qrOf(world, G1);

    const r = await scan(ptw.ptToken, qr, "moved session");
    assert.deepEqual([r.status, code(r)], [403, "PT_NO_QUALIFYING_SESSION"]);
    assert.equal((await ptRows(ptw.pt)).length, 1, "only yesterday's record exists");

    // a genuinely new session today does qualify, and the moved one is NOT in its basis
    const fresh = await todaySession(c, "CONFIRMED");
    const ok = await scan(ptw.ptToken, qr, "with a fresh session");
    assert.equal(ok.status, 200);
    const today = (await ptRows(ptw.pt)).find((x) => x.localDate === localDateOf(ds))!;
    assert.deepEqual(today.sessions, [fresh.id]);
  });
});

test("Q18: a session across local midnight (yesterday 23:30 - today 00:30) counts for BOTH days: the record of yesterday exists and today's scan is allowed", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const [G1] = world.gyms;
    const c = await buyContract(world, ptw, 0);
    const ds = dayStart();
    const across = await sessionAt(c, "PENDING_CLIENT_CONFIRMATION", ds - 30 * 60_000, ds + 30 * 60_000);
    await insertPastCheckIn(G1, world.brandId, ptw.pt, localDateOf(ds - DAY), [across.id], [c.id]);
    const qr = await qrOf(world, G1);

    // user-service (real HTTP, the P2.1 internal API) reports it for both local days
    const ask = async (fromMs: number, toMs: number) => {
      const q = new URLSearchParams({ gymId: G1, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
      const r = await fetch(`${H.userUrl}/internal/pt/${ptw.pt}/gym-sessions?${q}`, { headers: { "x-service-secret": H.secret } });
      return ((await r.json()) as any).sessions.map((s: any) => s.sessionId) as string[];
    };
    assert.deepEqual(await ask(ds - DAY, ds), [across.id], "yesterday's window");
    assert.deepEqual(await ask(ds, ds + DAY), [across.id], "today's window");

    const r = await scan(ptw.ptToken, qr, "midnight-crossing session");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = await ptRows(ptw.pt);
    assert.deepEqual(rows.map((x) => [x.localDate, x.sessions]), [[localDateOf(ds - DAY), [across.id]], [localDateOf(ds), [across.id]]], "one record per day, same session on both");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7. user-service stopped
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("user-service stopped -> 503 PT_SESSION_CHECK_UNAVAILABLE, nothing written (not read as 'no session'); an earlier record is untouched; back up -> works", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const ptw2 = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt, ptw2.pt], { branches: 1 });
    const [G1] = world.gyms;
    const c = await buyContract(world, ptw, 0);
    const c2 = await buyContract(world, ptw2, 0);
    await todaySession(c);
    await todaySession(c2);
    const qr = await qrOf(world, G1);

    assert.equal((await scan(ptw.ptToken, qr, "first scan")).status, 200);
    const rowsBefore = await ptRows(ptw.pt);
    await G.$executeRawUnsafe("SELECT 1");

    await H.stopUser();
    try {
      // fingerprints are read straight from the DBs, so they work while the user-service listener is down
      const t0 = Date.now();
      const down1 = await scan(ptw.ptToken, qr, "re-scan while user-service is stopped");
      const down2 = await scan(ptw2.ptToken, qr, "first scan while user-service is stopped");
      show("user-service stopped", { statuses: [down1.status, down2.status], codes: [code(down1), code(down2)], ms: Date.now() - t0 });
      assert.deepEqual([down1.status, code(down1)], [503, "PT_SESSION_CHECK_UNAVAILABLE"]);
      assert.deepEqual([down2.status, code(down2)], [503, "PT_SESSION_CHECK_UNAVAILABLE"]);
      assert.deepEqual(await ptRows(ptw.pt), rowsBefore, "the earlier record is byte-for-byte what it was (scan_count unchanged)");
      assert.equal((await ptRows(ptw2.pt)).length, 0, "no record was written for the PT who had none");
    } finally {
      await H.startUser();
    }
    const up = await scan(ptw2.ptToken, qr, "user-service back");
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((await ptRows(ptw2.pt)).length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8. A PT who is also a member (Q15)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("Q15: a PT who is also a gym member uses the PT path: no visit deducted, no GymCheckIn, membership row untouched; no session -> refused without falling back to the member path", { skip }, async () => {
  await scenario(async () => {
    const ptw = await makePtWithPackage();
    const world = await makeBrandWorld([ptw.pt], { branches: 1 });
    const [G1] = world.gyms;
    const membership = await addMembership(world, ptw.pt, { gymIndex: 0 }); // the PT is ALSO a member of the brand
    const c = await buyContract(world, ptw, 0);
    const qr = await qrOf(world, G1);
    const snapMember = async () => ({
      row: JSON.stringify(await G.gymMembershipContract.findUnique({ where: { id: membership.id } })),
      visits: await G.$queryRawUnsafe("SELECT count(*)::int AS n FROM gym_check_ins WHERE client_id = $1", ptw.pt),
    });
    const m0 = await snapMember();

    const none = await scan(ptw.ptToken, qr, "member, but no session today");
    assert.deepEqual([none.status, code(none)], [403, "PT_NO_QUALIFYING_SESSION"]);
    await todaySession(c);
    const ok = await scan(ptw.ptToken, qr, "member with a session today");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.kind, "PT");
    const again = await scan(ptw.ptToken, qr, "member, second scan");
    assert.equal(again.status, 200);

    assert.deepEqual(await snapMember(), m0, "the membership row (usedVisits, updatedAt...) and the PT's visit rows are exactly as before");
    const usedVisits = (await G.gymMembershipContract.findUnique({ where: { id: membership.id } })).usedVisits;
    assert.equal(usedVisits, 0);
    assert.equal((await ptRows(ptw.pt)).length, 1);
  });
});
