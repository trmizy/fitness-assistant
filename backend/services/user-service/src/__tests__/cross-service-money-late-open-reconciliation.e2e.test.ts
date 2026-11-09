/**
 * LATE-OPEN RECONCILIATION (final safety gate) - the four-eyes way out for a D77-OPEN step of an ORDINARY session (no Case, no policy review), REAL payment-service.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): this process runs the real user-service app (real HTTP, real admin tokens); payment-service is a real child process on an isolated *_test
 * database; every money figure is read from the REAL ledger and checked against a HAND computation (1,000,000 / 4 sessions, V = 250,000, L = 125,000, 90/10 split, CLIENT_CANCELLED ending refunds 90% of the
 * three unused sessions). Contracts are made with `eligibility: false` (the harness spelling of `eligibility: "none"`): NO D-NEW-12 review. TEST FIXTURES are named where used:
 *   - the OPEN obligation: the REAL record-only door writes it (the UNCONFIRMED status of the sweep row only lets that door run);
 *   - the NO_SHOW outcome: the session is put back to CONFIRMED before the PT admits the absence;
 *   - BLOCKED obligation states / outside payment / insufficient source: set in the payment test DB (the FH-8 paths that really produce them are covered by their own suites);
 *   - failures: a wrapper on paymentClient (throws before the call, or after the ledger committed).
 *
 * Opt-in; run ALONE:  RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... SETTLEMENT_INFLIGHT_WAIT_MS=300 \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-late-open-reconciliation.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";
import { insertPolicyReviewFixture } from "./dispute-policy-eligibility.fixture";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true"; // feature flag of the late-open path (fail-closed, effective only in the isolated test environment)
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const BASE = "/admin/late-open-reconciliations";

let H: Harness;
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
  if (H) await H.close();
});

// ── kit ──────────────────────────────────────────────────────────────────────

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}
const lateSession = (c: PaidContract) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
};
const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function settleEvents(txnId: string) {
  return num(((await H.payDb.$queryRawUnsafe(`SELECT count(*)::text AS n FROM contract_unpaid_obligation_events e JOIN contract_unpaid_obligations o ON o.id = e.obligation_id WHERE o.transaction_id = $1 AND e.action::text = 'SETTLE_VIA_LEDGER'`, txnId)) as any[])[0].n);
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = {
    client: await at("CLIENT", "AVAILABLE"),
    pt: await at("PT", "AVAILABLE"),
    platform: await at("PLATFORM", "AVAILABLE", "REVENUE"),
    pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")),
  };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const rowsOf = (contractId: string) => H.m.prisma.sessionSettlement.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
const stepRow = async (contractId: string, kind: string) => (await rowsOf(contractId)).find((r) => r.kind === kind);
const endContract = (c: PaidContract) => H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });

type Outcome = "COMPLETED" | "NO_SHOW";
const STEP: Record<Outcome, string> = { COMPLETED: "SESSION_RELEASE", NO_SHOW: "PT_NO_SHOW_COMPENSATION" };
const LEDGER_METHOD: Record<Outcome, "releaseSession" | "noShow"> = { COMPLETED: "releaseSession", NO_SHOW: "noShow" };
interface Fx {
  c: PaidContract;
  S: { id: string };
  outcome: Outcome;
}
/** An ORDINARY contract (no review), one session whose D77 L is OPEN at the ledger and whose ordinary action (client confirms / PT admits the absence) was refused by the ledger: the step is NEEDS_HUMAN. */
async function buildParked(outcome: Outcome): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  assert.equal(await H.m.prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: c.id } }), 0, "the contract has no policy review");
  const S = await lateSession(c);
  await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
  assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  if (outcome === "NO_SHOW") await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } });
  const r = outcome === "COMPLETED" ? await H.call("POST", `/sessions/${S.id}/confirm`, c.clientToken) : await H.call("PATCH", `/sessions/${S.id}/no-show`, c.ptToken, {});
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const step = (await stepRow(c.id, STEP[outcome]))!;
  assert.equal(step.status, "NEEDS_HUMAN");
  assert.match(step.lastError ?? "", /LATE_OPEN_FLAG_REQUIRED/);
  return { c, S, outcome };
}
async function counters(fx: Fx) {
  const s = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
  return { session: s.status, contract: k.status, used: k.usedSessions, compensated: k.compensatedSessions };
}

// ── admins and HTTP with headers ─────────────────────────────────────────────

const admin = () => {
  const id = `adm-${randomUUID()}`;
  return { id, token: H.tokenFor(id, "ADMIN") };
};
async function req(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(H.userUrl + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}
const PROPOSAL = {
  reason: "Khách xác nhận PT vào muộn, khoản bồi thường chưa được sổ cái thực hiện",
  verificationNote: "Đã đối chiếu nhật ký phòng học và lịch sử buổi tập: PT vào phòng sau 16 phút",
  evidenceRefs: ["room-log:session-room-joins", "session-history:confirm"],
  policyBasis: "Khoản bồi thường đi muộn L của đúng buổi này đã được sổ cái ghi nhận là nghĩa vụ OPEN; người đề xuất xác nhận việc đi muộn bằng nhật ký phòng",
};
const APPROVE = { reason: "Đã kiểm tra lại bằng chứng, đồng ý", conflictOfInterestDeclaredNone: true };

/** claim -> propose (A) -> approve (B): returns the pieces of the answer. */
async function fourEyes(rowId: string, A = admin(), B = admin()) {
  assert.equal((await req("POST", `${BASE}/${rowId}/claim`, A.token, {})).status, 200);
  const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  const approved = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/approve`, B.token, APPROVE);
  return { A, B, proposalId: proposed.body.reconciliationId as string, approved };
}

/** Wraps paymentClient[method]: the first `times` calls fail - before the request reaches the ledger, or AFTER the ledger committed. */
function failing(method: string, mode: "before" | "after", times = 1) {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  let n = 0;
  pc[method] = async function (...args: unknown[]) {
    n++;
    if (n <= times) {
      if (mode === "before") throw new Error("simulated: payment-service never saw the request");
      await original.apply(this, args);
      throw new Error("simulated crash after the ledger committed");
    }
    return original.apply(this, args);
  };
  return { calls: () => n, restore: () => (pc[method] = original) };
}

// ═════════════════════ 1. the whole path, running contract ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`P1 ${outcome}, RUNNING contract: queue -> claim -> propose -> approve by a second admin -> executed through the existing step; obligation PAID_VIA_LEDGER once; quota and money hand-computed; D-NEW-12 untouched`, { skip }, async () => {
    await scenario(async () => {
      const fx = await buildParked(outcome);
      const before = await totals(fx.c);
      const beforeCounters = await counters(fx);
      assert.deepEqual(before, { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE }, "nothing has moved");
      const row = (await stepRow(fx.c.id, STEP[outcome]))!;

      // the queue shows it, with reason, status and the ledger observation
      const A = admin();
      const queue = await req("GET", BASE, A.token);
      assert.equal(queue.status, 200, JSON.stringify(queue.body));
      const item = queue.body.items.find((i: any) => i.rowId === row.id);
      assert.ok(item, "the parked step is in the queue");
      assert.deepEqual([item.status, item.assignee, item.kind, item.settlementStatus, item.sessionStatus, item.assessment.eligible], ["UNCLAIMED", null, STEP[outcome], "NEEDS_HUMAN", outcome, true]);
      assert.equal(item.ledger.obligation.status, "OPEN");
      assert.equal(item.ledger.obligation.unpaid, "125000.00");

      const B = admin();
      const { proposalId, approved } = await fourEyes(row.id, A, B);
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.approved, true);
      assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));

      // the REAL ledger: L closed by a ledger entry, exactly one SETTLE_VIA_LEDGER, the step in the ledger once
      assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
      assert.equal(await settleEvents(fx.c.txnId), 1);
      assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 1);
      // hand-computed: COMPLETED -> L (125,000) to the client out of V, the other 125,000 split 90/10; NO_SHOW -> the whole V (250,000, L inside it) to the client
      const expected = outcome === "COMPLETED" ? { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE } : { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE };
      assert.deepEqual(await totals(fx.c), expected);
      // quota booked once by the step's own bookkeeping
      assert.deepEqual(await counters(fx), outcome === "COMPLETED" ? { ...beforeCounters, used: 1, compensated: 0 } : { ...beforeCounters, used: 0, compensated: 1 });
      assert.equal((await stepRow(fx.c.id, STEP[outcome]))?.status, "SETTLED");

      // the proposal is consumed; the history says it all, in order
      const p = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id: proposalId } });
      assert.deepEqual([p.proposedBy, p.approvedBy, p.outcome], [A.id, B.id, "EXECUTED"]);
      const actions = (await H.m.prisma.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: row.id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
      assert.deepEqual(actions, ["CLAIMED", "PROPOSED", "APPROVED", "EXECUTION_STARTED", "EXECUTED", "NOTIFIED"]);
      // ONE confirmation to the client, from the real ledger state; a replay of the retry endpoint sends no second one and moves nothing
      const notes = await H.m.prisma.notification.findMany({ where: { entityId: fx.S.id, userId: fx.c.clientUserId, text: { contains: "đã được ghi nhận vào ví Gymini" } } });
      assert.equal(notes.length, 1, notes.map((n) => n.text).join(" | "));
      if (outcome === "COMPLETED") assert.match(notes[0].text, /125\.000đ/);
      const again = await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {});
      assert.deepEqual([again.status, again.body.execution.status, again.body.execution.replayed], [200, "EXECUTED", true]);
      assert.deepEqual(await totals(fx.c), expected);
      assert.equal(await H.m.prisma.notification.count({ where: { entityId: fx.S.id, userId: fx.c.clientUserId, text: { contains: "đã được ghi nhận vào ví Gymini" } } }), 1);
      // the approval is consumed: the gate no longer sends a flag for this session
      assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: false });

      // D-NEW-12 untouched: no review was written, and a DISPUTE ruling on this contract is still refused
      assert.equal(await H.m.prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: fx.c.id } }), 0);
      const T = Date.now();
      const D = await H.m.base.addSession(fx.c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
      assert.equal((await H.call("POST", `/sessions/${D.id}/dispute`, fx.c.clientToken, { reason: "Buổi tập không như đã báo" })).status, 200);
      const snap = await H.snapshot();
      const ruled = await H.call("POST", `/admin/sessions/${D.id}/resolve`, A.token, { resolution: "COMPLETED", note: "after reconciliation" });
      assert.equal(ruled.status, 409, JSON.stringify(ruled.body));
      assert.match(JSON.stringify(ruled.body), /POLICY_ELIGIBILITY_UNVERIFIED/);
      assert.deepEqual(await H.snapshot(), snap, "the refused ruling wrote nothing");
      await H.invariant(`P1 ${outcome}`);
    });
  });
}

// ═════════════════════ 2. the whole path, contract ENDED while the step waited ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`P2 ${outcome}, ENDED contract (the session is HELD): propose -> approve -> the resolution of the hold runs through the existing step; before / after figures hand-computed`, { skip }, async () => {
    await scenario(async () => {
      const fx = await buildParked(outcome);
      assert.equal((await endContract(fx.c)).status, 200);
      const row = (await stepRow(fx.c.id, STEP[outcome]))!;
      assert.equal(row.status, "UNCONFIRMED", "held by the ending");
      // BEFORE: 3 unused sessions refunded at 90% (675,000 client; PT 67,500; platform 7,500), the held session's 250,000 pending, L OPEN
      const before = await totals(fx.c);
      assert.deepEqual(before, { client: 675_000, pt: 67_500, platform: 7_500, pending: 250_000, sum: PRICE });
      const beforeCounters = await counters(fx);
      assert.deepEqual(beforeCounters, outcome === "COMPLETED" ? { session: "COMPLETED", contract: "CANCELLED", used: 1, compensated: 0 } : { session: "NO_SHOW", contract: "CANCELLED", used: 0, compensated: 1 }); // QUOTA A+: booked at the terminal change (the contract was ACTIVE), once; the ending and the reconciliation do not touch it

      const A = admin();
      const queue = await req("GET", BASE, A.token);
      const item = queue.body.items.find((i: any) => i.rowId === row.id);
      assert.ok(item, "the held step is in the queue");
      assert.deepEqual([item.settlementStatus, item.contractStatus, item.assessment.eligible], ["UNCONFIRMED", "CANCELLED", true]);

      const { approved } = await fourEyes(row.id, A, admin());
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));
      // AFTER (hand): COMPLETED -> held V 250,000 delivered: L 125,000 to the client, 125,000 split 112,500 / 12,500 => client 800,000, PT 180,000, platform 20,000.
      //               NO_SHOW   -> held V 250,000 refunded to the client (L inside it) => client 925,000, PT 67,500, platform 7,500.
      assert.deepEqual(await totals(fx.c), outcome === "COMPLETED" ? { client: 800_000, pt: 180_000, platform: 20_000, pending: 0, sum: PRICE } : { client: 925_000, pt: 67_500, platform: 7_500, pending: 0, sum: PRICE });
      assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
      assert.equal(await settleEvents(fx.c.txnId), 1);
      assert.equal(await opCount(`UNRESOLVED_SESSION:${fx.S.id}`), 1);
      assert.equal((await stepRow(fx.c.id, STEP[outcome]))?.status, "SETTLED", "the held row is closed in the resolution's own transaction");
      assert.equal((await stepRow(fx.c.id, "UNRESOLVED_SESSION_RESOLUTION"))?.status, "SETTLED");
      // quota after: unchanged (COMPLETED: used 1; NO_SHOW: compensated 1 was booked at the terminal change under Quota A+ and the resolution of the hold adds nothing)
      assert.deepEqual(await counters(fx), beforeCounters);
      await H.invariant(`P2 ${outcome}`);
    });
  });
}

// ═════════════════════ 3. authority, identity, body ═════════════════════
test("S1 self-approval, a non-admin, a body with amount / approvedBy / settleLateOpen / userId, a missing conflict declaration: all refused, nothing executed", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    const before = await totals(fx.c);

    // non-admin tokens are refused on every route
    for (const [role, who] of [["CUSTOMER", fx.c.clientToken], ["PT", fx.c.ptToken]] as const) {
      assert.equal((await req("GET", BASE, who)).status, 403, role);
      assert.equal((await req("POST", `${BASE}/${row.id}/claim`, who, {})).status, 403, role);
      assert.equal((await req("POST", `${BASE}/${row.id}/proposals`, who, PROPOSAL)).status, 403, role);
    }
    assert.equal((await req("GET", BASE, null)).status, 401);

    // strict bodies: a field nobody declared is refused, never ignored
    for (const extra of [{ amount: 125000 }, { approvedBy: "someone" }, { settleLateOpen: true }, { userId: "x" }, { proposedBy: "x" }, { outcome: "EXECUTED" }]) {
      const r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, { ...PROPOSAL, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal(r.body.code, "INVALID_INPUT");
    }
    assert.equal((await req("POST", `${BASE}/${row.id}/claim`, A.token, { amount: 1 })).status, 400);
    assert.equal((await req("POST", `${BASE}/${row.id}/proposals`, A.token, { ...PROPOSAL, evidenceRefs: [] })).status, 400);
    assert.equal((await req("POST", `${BASE}/${row.id}/proposals`, A.token, { ...PROPOSAL, policyBasis: "   " })).status, 400);
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 0, "no proposal was created by any of the refused calls");

    const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.equal(proposed.status, 201);
    const id = proposed.body.reconciliationId;
    // approval: self, bad body, no conflict declaration, a non-admin
    const self = await req("POST", `${BASE}/proposals/${id}/approve`, A.token, APPROVE);
    assert.deepEqual([self.status, self.body.code], [403, "SELF_APPROVAL_FORBIDDEN"]);
    const B = admin();
    for (const extra of [{ amount: 1 }, { approvedBy: B.id }, { settleLateOpen: true }]) assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, B.token, { ...APPROVE, ...extra })).status, 400, JSON.stringify(extra));
    const noCoi = await req("POST", `${BASE}/proposals/${id}/approve`, B.token, { reason: "ok", conflictOfInterestDeclaredNone: false });
    assert.deepEqual([noCoi.status, noCoi.body.code], [403, "CONFLICT_OF_INTEREST"]);
    assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, fx.c.clientToken, APPROVE)).status, 403);
    // a second proposal while one is live
    assert.equal((await req("POST", `${BASE}/${row.id}/proposals`, B.token, PROPOSAL)).status, 409);

    const p = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([p.approvedBy, p.approvedAt, p.outcome], [null, null, null]);
    assert.deepEqual(await totals(fx.c), before, "nothing moved");
    assert.equal((await stepRow(fx.c.id, STEP.COMPLETED))?.status, "NEEDS_HUMAN");
    assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: false }, "an unapproved proposal sends no flag");
    // the proposer cannot reject-and-approve their way around: rejecting works, a new proposal is then possible, the old one cannot be approved
    assert.equal((await req("POST", `${BASE}/proposals/${id}/reject`, A.token, { reason: "rút lại" })).status, 200);
    assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE)).status, 409);
    assert.equal((await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL)).status, 201, "after a rejection a new proposal is allowed");
    await H.invariant("S1");
  });
});

// ═════════════════════ 4. a Case / a dispute cannot use this route ═════════════════════
test("C1 a session in dispute, with an open Case, or with a contested late finding cannot use this route; nothing is written", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    const svc = (await import("../services/dispute-case/dispute-case.service")).disputeCaseService;
    const helpers = await import("./dispute-case-exec.test-helpers");
    const before = await totals(fx.c);
    // (a) the session is DISPUTED (TEST FIXTURE: status changed by SQL)
    await H.m.prisma.session.update({ where: { id: fx.S.id }, data: { status: "DISPUTED" } });
    let r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.deepEqual([r.status, r.body.code], [409, "SESSION_IN_DISPUTE"]);
    // (b) a Case is open for the session, the session itself looks ordinary again (fixture)
    const opened = await svc.openCase(helpers.admin(), fx.S.id);
    await H.m.prisma.session.update({ where: { id: fx.S.id }, data: { status: "COMPLETED" } });
    r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.deepEqual([r.status, r.body.code], [409, "OPEN_CASE_EXISTS"]);
    // (c) the late arrival is contested in that Case
    const inv = { id: (await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: opened.result.case.id } })).investigatorId ?? "inv", role: "ADMIN" };
    await H.m.prisma.disputeCaseIssue.create({ data: { caseId: opened.result.case.id, kind: "PT_LATE", finding: "LATE_CONTESTED", note: "PT nói đúng giờ", recordedBy: inv.id } });
    r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.equal(r.status, 409);
    assert.ok(["OPEN_CASE_EXISTS", "LATE_CONTESTED"].includes(r.body.code), r.body.code);
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 0);
    const blocked = await H.m.prisma.lateOpenReconciliationEvent.count({ where: { settlementRowId: row.id, action: "BLOCKED" } });
    assert.equal(blocked, 3, "each refusal left a BLOCKED event");
    assert.deepEqual(await totals(fx.c), before);
    assert.equal((await stepRow(fx.c.id, STEP.COMPLETED))?.status, "NEEDS_HUMAN");
    assert.equal(await H.m.prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: fx.c.id } }), 0, "this path never writes a policy review");
  });
});

// ═════════════════════ 5. BLOCKED states ═════════════════════
test("B1 every obligation state that is not a clean OPEN is BLOCKED (row stays NEEDS_HUMAN, event written, no proposal): UNDER_REVIEW, APPROVED_FOR_PAYMENT, AWAITING_EVIDENCE, PAID_VERIFIED, RESOLVED_OTHER, WAIVED, PAID_EXTERNALLY, PAID_VIA_LEDGER; OPEN with verified outside money", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    const setObligation = (sql: string) => H.payDb.$executeRawUnsafe(`UPDATE contract_unpaid_obligations SET ${sql} WHERE transaction_id = $1`, fx.c.txnId);
    for (const status of ["UNDER_REVIEW", "APPROVED_FOR_PAYMENT", "AWAITING_EVIDENCE", "PAID_VERIFIED", "RESOLVED_OTHER", "WAIVED", "PAID_EXTERNALLY", "PAID_VIA_LEDGER"]) {
      await setObligation(`status = '${status}'::"ContractUnpaidObligationStatus"`);
      const r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
      assert.deepEqual([r.status, r.body.code], [409, `OBLIGATION_${status}`], status);
      const q = await req("GET", `${BASE}/${row.id}`, A.token);
      assert.deepEqual([q.body.assessment.eligible, q.body.assessment.code], [false, `OBLIGATION_${status}`]);
    }
    await setObligation(`status = 'OPEN'::"ContractUnpaidObligationStatus", verified_paid = 1000`);
    let r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.deepEqual([r.status, r.body.code], [409, "OBLIGATION_HAS_OUTSIDE_PAYMENT"]);
    await setObligation(`verified_paid = 0`);
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 0, "no proposal for any BLOCKED state");
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { settlementRowId: row.id, action: "BLOCKED" } }), 9);
    assert.equal((await stepRow(fx.c.id, STEP.COMPLETED))?.status, "NEEDS_HUMAN");
    // the same obligation, clean again: the path opens
    r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
});

test("B2 an approved EXCEPTION_APPLIES review of the contract BLOCKS the path; an ELIGIBLE one does not block it", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    const contract = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
    await insertPolicyReviewFixture(H.m.prisma, contract, { result: "EXCEPTION_APPLIES" });
    const r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.deepEqual([r.status, r.body.code], [409, "POLICY_EXCEPTION_APPLIES"]);
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 0);
  });
});

test("B3 INSUFFICIENT SOURCE: the contract's own pending money cannot cover the amount -> BLOCKED (TEST FIXTURE: PENDING debits written into the payment test DB)", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    for (const [type, id, amount] of [["PT", fx.c.ptUserId, 899_000], ["PLATFORM", "REVENUE", 99_000]] as const) {
      await H.payDb.$executeRawUnsafe(
        `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, entry_type, bucket, amount, balance_before, balance_after, description)
         SELECT gen_random_uuid()::text, w.id, $1, 'DEBIT'::"LedgerEntryType", 'PENDING'::"LedgerBucket", ${amount}, 0, 0, 'B3 fixture' FROM wallets w WHERE w.owner_type = $2::"WalletOwnerType" AND w.owner_id = $3`,
        fx.c.txnId,
        type,
        id,
      );
    }
    const r = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.deepEqual([r.status, r.body.code], [409, "INSUFFICIENT_SOURCE"], JSON.stringify(r.body));
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 0);
    assert.equal((await stepRow(fx.c.id, STEP.COMPLETED))?.status, "NEEDS_HUMAN");
  });
});

// ═════════════════════ 6. failures, retries, crash, concurrency, races ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`F1 ${outcome}: the ledger call fails BEFORE reaching payment-service (twice), then works: bounded retry, the row stays NEEDS_HUMAN between attempts, money exactly once, the sweep does not touch it`, { skip }, async () => {
    await scenario(async () => {
      const fx = await buildParked(outcome);
      const row = (await stepRow(fx.c.id, STEP[outcome]))!;
      const seam = failing(LEDGER_METHOD[outcome], "before", 2);
      try {
        const { proposalId, approved, B } = await fourEyes(row.id);
        assert.equal(approved.status, 200);
        assert.equal(approved.body.approved, true, "the approval stands");
        assert.deepEqual([approved.body.execution.status, approved.body.execution.code], ["FAILED", "EXECUTION_DID_NOT_SETTLE"]);
        assert.equal((await stepRow(fx.c.id, STEP[outcome]))?.status, "NEEDS_HUMAN", "parked again for a person, not left FAILED for the sweep to loop on");
        assert.deepEqual(await totals(fx.c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
        // the sweep never retries it by itself
        await drain(fx.c.id, 2);
        assert.equal(seam.calls(), 1, "the sweep made no call");
        const second = await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {});
        assert.equal(second.body.execution.status, "FAILED");
        assert.equal(seam.calls(), 2);
        const third = await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {});
        assert.equal(third.body.execution.status, "EXECUTED", JSON.stringify(third.body));
        assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 1);
        assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
        assert.equal(await settleEvents(fx.c.txnId), 1);
        const fails = await H.m.prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: proposalId, action: "EXECUTION_FAILED" } });
        assert.equal(fails, 2);
        await H.invariant(`F1 ${outcome}`);
      } finally {
        seam.restore();
      }
    });
  });
}

test("F2 bounded: three failed executions exhaust the approval (409 EXECUTION_ATTEMPTS_EXHAUSTED); nothing moved; the fourth call does not even reach the ledger", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const seam = failing("releaseSession", "before", 99);
    try {
      const { proposalId, approved, B } = await fourEyes(row.id);
      assert.equal(approved.body.execution.status, "FAILED");
      for (let i = 0; i < 2; i++) assert.equal((await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {})).body.execution.status, "FAILED");
      assert.equal(seam.calls(), 3);
      const exhausted = await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {});
      assert.deepEqual([exhausted.status, exhausted.body.code], [409, "EXECUTION_ATTEMPTS_EXHAUSTED"]);
      assert.equal(seam.calls(), 3, "no fourth call");
      assert.deepEqual(await totals(fx.c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
      assert.equal((await req("GET", `${BASE}/${row.id}`, B.token)).body.status, "EXECUTION_EXHAUSTED");
      await H.invariant("F2");
    } finally {
      seam.restore();
    }
  });
});

for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`F3 ${outcome}: CRASH AFTER the ledger committed (the payment is booked, this side never recorded it): the retry replays by the same key - the obligation is paid ONCE, the row and the quota catch up once`, { skip }, async () => {
    await scenario(async () => {
      const fx = await buildParked(outcome);
      const row = (await stepRow(fx.c.id, STEP[outcome]))!;
      const seam = failing(LEDGER_METHOD[outcome], "after", 1);
      try {
        const { proposalId, approved, B } = await fourEyes(row.id);
        assert.equal(approved.body.execution.status, "FAILED");
        // the ledger DID book it
        assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
        const mid = await totals(fx.c);
        assert.equal((await stepRow(fx.c.id, STEP[outcome]))?.status, "NEEDS_HUMAN", "this side did not record it");
        const retry = await req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {});
        assert.equal(retry.body.execution.status, "EXECUTED", JSON.stringify(retry.body));
        assert.deepEqual(await totals(fx.c), mid, "the replay moved NOTHING more");
        assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 1);
        assert.equal(await settleEvents(fx.c.txnId), 1);
        assert.deepEqual(await counters(fx), outcome === "COMPLETED" ? { session: "COMPLETED", contract: "ACTIVE", used: 1, compensated: 0 } : { session: "NO_SHOW", contract: "ACTIVE", used: 0, compensated: 1 });
        await H.invariant(`F3 ${outcome}`);
      } finally {
        seam.restore();
      }
    });
  });
}

test("K1 two admins approve the SAME proposal at once: exactly one stamp wins, the other is refused, the money moves once", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    await req("POST", `${BASE}/${row.id}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    const id = proposed.body.reconciliationId;
    const [B, C] = [admin(), admin()];
    const results = await Promise.all([req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE), req("POST", `${BASE}/proposals/${id}/approve`, C.token, APPROVE)]);
    const ok = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status !== 200);
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => [r.status, r.body.code])));
    assert.equal(lost.length, 1);
    assert.equal(lost[0].status, 409);
    assert.equal(ok[0].body.execution.status, "EXECUTED");
    const p = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } });
    assert.ok([B.id, C.id].includes(p.approvedBy!));
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: id, action: "APPROVED" } }), 1);
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    assert.deepEqual(await totals(fx.c), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE });
    await H.invariant("K1");
  });
});

test("K2 two executions at once (retry x2 after a failed first attempt): the money moves once, one EXECUTED, no second notice, the loser is told EXECUTED(replayed) or IN_FLIGHT", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const seam = failing("releaseSession", "before", 1);
    try {
      const { proposalId, approved, B } = await fourEyes(row.id);
      assert.equal(approved.body.execution.status, "FAILED");
      const [x, y] = await Promise.all([req("POST", `${BASE}/proposals/${proposalId}/retry`, B.token, {}), req("POST", `${BASE}/proposals/${proposalId}/retry`, admin().token, {})]);
      const statuses = [x.body.execution?.status, y.body.execution?.status].sort();
      assert.ok(statuses.includes("EXECUTED"), JSON.stringify([x.body, y.body]));
      assert.ok(statuses.every((s) => s === "EXECUTED" || s === "IN_FLIGHT"), JSON.stringify(statuses));
      assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
      assert.equal(await settleEvents(fx.c.txnId), 1);
      assert.deepEqual(await totals(fx.c), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE });
      assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: proposalId, action: "EXECUTED" } }), 1);
      assert.equal(await H.m.prisma.notification.count({ where: { entityId: fx.S.id, userId: fx.c.clientUserId, text: { contains: "đã được ghi nhận vào ví Gymini" } } }), 1);
      await H.invariant("K2");
    } finally {
      seam.restore();
    }
  });
});

for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`K3 ${outcome}: the execution RACES the contract ending (the approved call is HELD before payment-service, the ending runs, then the call arrives): the money is paid once and the books balance`, { skip }, async () => {
    await scenario(async () => {
      const fx = await buildParked(outcome);
      const row = (await stepRow(fx.c.id, STEP[outcome]))!;
      const A = admin();
      const B = admin();
      await req("POST", `${BASE}/${row.id}/claim`, A.token, {});
      const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
      const id = proposed.body.reconciliationId;
      // hold the first ledger call of the method
      const pc = H.m.paymentClient as any;
      const method = LEDGER_METHOD[outcome];
      const original = pc[method];
      let calls = 0;
      let enter!: () => void;
      const entered = new Promise<void>((r) => (enter = r));
      let go!: () => void;
      const proceed = new Promise<void>((r) => (go = r));
      pc[method] = async function (...args: unknown[]) {
        calls++;
        if (calls === 1) {
          enter();
          await proceed;
        }
        return original.apply(this, args);
      };
      try {
        const approving = req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE);
        await entered;
        const ended = await endContract(fx.c); // the ending drains / holds the row the approved call is processing
        const endStatus = ended.status;
        go();
        const approved = await approving;
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        await drain(fx.c.id, 3);
        // whatever order the two took: the obligation is paid at most once, every ledger operation key is written at most once, and the books balance
        const obs = await obligations(fx.c.txnId);
        assert.equal(obs.length, 1);
        assert.ok((await settleEvents(fx.c.txnId)) <= 1);
        assert.ok((await opCount(`SESSION_RELEASE:${fx.S.id}`)) + (await opCount(`PT_NO_SHOW:${fx.S.id}`)) + (await opCount(`UNRESOLVED_SESSION:${fx.S.id}`)) <= 1);
        assert.ok([200, 409].includes(endStatus), `ending answered ${endStatus}`);
        await H.invariant(`K3 ${outcome}`);
        // measured, deterministic with the held call: the ending takes the live row over and the converged state equals the one pinned by the b1-race suite (same hand numbers)
        assert.equal(endStatus, 200);
        assert.equal(approved.body.execution.status, "EXECUTED");
        assert.deepEqual(obs, [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
        assert.deepEqual(await totals(fx.c), outcome === "COMPLETED" ? { client: 800_000, pt: 180_000, platform: 20_000, pending: 0, sum: PRICE } : { client: 925_000, pt: 67_500, platform: 7_500, pending: 0, sum: PRICE });
        assert.deepEqual(await counters(fx), outcome === "COMPLETED" ? { session: "COMPLETED", contract: "CANCELLED", used: 1, compensated: 0 } : { session: "NO_SHOW", contract: "CANCELLED", used: 0, compensated: 1 });
        assert.equal(await settleEvents(fx.c.txnId), 1);
      } finally {
        go();
        pc[method] = original;
      }
    });
  });
}

// ═════════════════════ 7. the sweep, history, idempotency, append-only ═════════════════════
test("H1 the sweep never runs the parked row without an approval; idempotency-key replay of propose / approve; the new tables are append-only (real triggers)", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    await drain(fx.c.id, 3);
    assert.deepEqual([(await stepRow(fx.c.id, STEP.COMPLETED))?.status, (await stepRow(fx.c.id, STEP.COMPLETED))?.attempts], ["NEEDS_HUMAN", 1], "no approval: the sweep leaves it");

    const A = admin();
    const B = admin();
    const key = `k-${randomUUID()}`;
    const p1 = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL, { "Idempotency-Key": key });
    const p2 = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL, { "Idempotency-Key": key });
    assert.deepEqual([p1.status, p2.status], [201, 201]);
    assert.equal(p2.headers.get("idempotent-replay"), "true");
    assert.equal(p1.body.reconciliationId, p2.body.reconciliationId);
    const reuse = await req("POST", `${BASE}/${row.id}/proposals`, A.token, { ...PROPOSAL, reason: "khác" }, { "Idempotency-Key": key });
    assert.deepEqual([reuse.status, reuse.body.code], [409, "IDEMPOTENCY_KEY_REUSED"]);
    assert.equal(await H.m.prisma.lateOpenReconciliation.count({ where: { settlementRowId: row.id } }), 1);

    const id = p1.body.reconciliationId;
    const akey = `a-${randomUUID()}`;
    const a1 = await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE, { "Idempotency-Key": akey });
    assert.equal(a1.status, 200);
    const a2 = await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE, { "Idempotency-Key": akey });
    assert.equal(a2.status, 200);
    assert.equal(a2.headers.get("idempotent-replay"), "true");
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: id, action: "APPROVED" } }), 1);

    // append-only: the immutable columns, the stamps (once), delete - on both tables
    const sql = (q: string) => H.m.prisma.$executeRawUnsafe(q);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET reason = 'changed' WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET approved_by = 'x' WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET approved_by = NULL, approved_at = NULL WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET outcome = 'REJECTED' WHERE id = '${id}'::uuid`), /append-only|violates check/);
    await assert.rejects(() => sql(`DELETE FROM late_open_reconciliations WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliation_events SET note = 'x' WHERE reconciliation_id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`DELETE FROM late_open_reconciliation_events WHERE reconciliation_id = '${id}'::uuid`), /append-only/);
    // four eyes in the database too: the proposer cannot be the approver even by SQL
    const second = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    assert.equal(second.status, 409, "the first proposal is consumed (EXECUTED) and still counts as live for this row");
  });
});

test("H2 four eyes and the one-time stamps are enforced by the DATABASE as well (CHECK + trigger), independent of the service", { skip }, async () => {
  await scenario(async () => {
    const fx = await buildParked("COMPLETED");
    const row = (await stepRow(fx.c.id, STEP.COMPLETED))!;
    const A = admin();
    const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    const id = proposed.body.reconciliationId;
    const sql = (q: string) => H.m.prisma.$executeRawUnsafe(q);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET approved_by = proposed_by, approved_at = now() WHERE id = '${id}'::uuid`), /four_eyes|lor_four_eyes|violates check/i);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET approved_by = 'x' WHERE id = '${id}'::uuid`), /approval_pair|append-only|violates check/i);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET outcome = 'EXECUTED', outcome_at = now() WHERE id = '${id}'::uuid`), /lor_outcome_vs_approval|violates check/i);
    await sql(`UPDATE late_open_reconciliations SET approved_by = 'someone-else', approved_at = now() WHERE id = '${id}'::uuid`);
    await assert.rejects(() => sql(`UPDATE late_open_reconciliations SET approved_by = 'a-third', approved_at = now() WHERE id = '${id}'::uuid`), /append-only/);
    // nothing was executed by the raw stamp: the flag would be sent by the gate (approved, not consumed), the money is the ledger's business
    assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: true });
  });
});
