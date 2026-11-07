/**
 * NO_SHOW + D77 OPEN under QUOTA A+ (Ngai's decision, 01/11/2026): a validly confirmed PT no-show consumes ONE entitlement (compensatedSessions + 1) in the transaction that makes the session NO_SHOW, under the
 * contract lock, WITHOUT waiting for payment. This file is the end-to-end acceptance of that rule on the hardest case (the refund is blocked because L is OPEN), with the money checked against a HAND computation.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service), real payment-service on an isolated *_test database. TEST FIXTURES named where used (the OPEN obligation via the real record-only door; the CONFIRMED
 * status put back by SQL before the absence is reported; the delivered sessions made by the harness `deliver`).
 *
 * Hand numbers: 1,000,000 / 4 sessions, V = 250,000, L = 125,000 (inside V), 90/10.
 *
 * Opt-in; run ALONE (same command shape as the other cross-service files).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true"; // feature flag of the late-open path (fail-closed, effective only in the isolated test environment)
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
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
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(`SELECT kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`, txnId);
  return rows.map((r) => ({ kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
const admin = () => {
  const id = `adm-${randomUUID()}`;
  return { id, token: H.tokenFor(id, "ADMIN") };
};
async function req(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(H.userUrl + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const PROPOSAL = {
  reason: "PT vào muộn, khoản bồi thường chưa được sổ cái thực hiện",
  verificationNote: "Đã đối chiếu nhật ký phòng học",
  evidenceRefs: ["room-log:joins"],
  policyBasis: "Khoản L của đúng buổi này là nghĩa vụ OPEN trong sổ cái; việc đi muộn xác nhận bằng nhật ký phòng",
};
const APPROVE = { reason: "đồng ý", conflictOfInterestDeclaredNone: true };
const stepRow = async (contractId: string, kind: string) => (await H.m.prisma.sessionSettlement.findMany({ where: { contractId } })).find((r) => r.kind === kind);
const entitlement = async (c: PaidContract) => {
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const { getRemainingEntitlements } = await import("../services/contract.service");
  return { status: k.status, total: k.totalSessions, used: k.usedSessions, compensated: k.compensatedSessions, remaining: getRemainingEntitlements(k) };
};
const mark = async (sessionId: string) => (await H.m.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).noShowQuotaBookedAt;

/** A session of an ordinary contract with L OPEN, back to CONFIRMED (TEST FIXTURE), absence reported by the CLIENT and AGREED by the PT. */
async function reportedAndAgreed() {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  const S = await lateSession(c);
  await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
  assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } });
  const statuses: Record<string, string> = {};
  const status = async () => (await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } })).status;
  const rep = await H.call("POST", `/sessions/${S.id}/report-no-show`, c.clientToken, { reason: "PT không đến" });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  statuses.afterClientReport = await status();
  assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 0, remaining: 4 }, "a REPORT alone consumes nothing");
  const agree = await H.call("POST", `/sessions/${S.id}/respond-no-show`, c.ptToken, { response: "AGREE" });
  assert.equal(agree.status, 200, JSON.stringify(agree.body));
  statuses.afterPtAgrees = await status();
  return { c, S, statuses };
}

test("Q1 the quota is booked AT the terminal change, without waiting for payment: NO_SHOW, compensated 1, remaining 3, the mark is set; the refund waits NEEDS_HUMAN", { skip }, async () => {
  await scenario(async () => {
    const { c, S, statuses } = await reportedAndAgreed();
    assert.deepEqual(statuses, { afterClientReport: "PT_NO_SHOW_REPORTED", afterPtAgrees: "NO_SHOW" });
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.deepEqual([sess.status, sess.sessionDeducted, sess.ptAtFault], ["NO_SHOW", false, true], "ptAtFault is set exactly as before (B-5: the three-times rule is untouched)");
    assert.ok(sess.noShowQuotaBookedAt, "the per-session mark is set");
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "NEEDS_HUMAN");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE }, "no money moved; the refund is not reported as done");
  });
});

test("Q2 exactly 3 more sessions can be booked with the remaining entitlement; the 4th is refused", { skip }, async () => {
  await scenario(async () => {
    const { c } = await reportedAndAgreed();
    for (const day of [30, 31, 32]) {
      const slot = await H.m.scope.openSlotFor(c.ptUserId, day);
      const booked = await H.call("POST", "/sessions", c.clientToken, { contractId: c.id, ...slot });
      assert.equal(booked.status, 201, JSON.stringify(booked.body));
    }
    const slot4 = await H.m.scope.openSlotFor(c.ptUserId, 33);
    const fourth = await H.call("POST", "/sessions", c.clientToken, { contractId: c.id, ...slot4 });
    assert.equal(fourth.status, 400, JSON.stringify(fourth.body));
    assert.match(String(fourth.body?.error ?? ""), /đã dùng hết số buổi/);
  });
});

test("Q3 the four-eyes reconciliation after the quota is booked: money right, quota NOT counted twice, a replay / retry moves nothing", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await reportedAndAgreed();
    const A = admin();
    const B = admin();
    const row = (await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))!;
    await req("POST", `${BASE}/${row.id}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    const approved = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/approve`, B.token, APPROVE);
    assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));
    // hand: the no-show owes V = 250,000 in all (L 125,000 inside it): client 250,000, pending 750,000; the quota was booked at the terminal change and stays 1
    assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: 125_000, paid: 125_000, unpaid: 0 }]);
    const markBefore = await mark(S.id);
    const again = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/retry`, B.token, {});
    assert.equal(again.body.execution.status, "EXECUTED");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.equal((await mark(S.id))?.getTime(), markBefore?.getTime());
    await H.invariant("Q3");
  });
});

test("Q4 the contract ENDS while the claim is OPEN: quota already 1 at the terminal change and unchanged by the ending and by the reconciliation; money before / after by hand", { skip }, async () => {
  await scenario(async () => {
    const { c } = await reportedAndAgreed();
    assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
    // BEFORE: 3 unused sessions at 90% -> client 675,000, PT 67,500, platform 7,500; the no-show session's V 250,000 is HELD (pending); L OPEN. Quota: used 0, compensated 1 (booked at the terminal change, once).
    assert.deepEqual(await totals(c), { client: 675_000, pt: 67_500, platform: 7_500, pending: 250_000, sum: PRICE });
    const before = await entitlement(c);
    assert.deepEqual(before, { status: "CANCELLED", total: 4, used: 0, compensated: 1, remaining: 3 });
    const A = admin();
    const row = (await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))!;
    assert.equal(row.status, "UNCONFIRMED");
    const proposed = await req("POST", `${BASE}/${row.id}/proposals`, A.token, PROPOSAL);
    const approved = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/approve`, admin().token, APPROVE);
    assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));
    // AFTER: the held V (250,000, L inside) goes back to the client -> 925,000; PT 67,500; platform 7,500; nothing pending. Quota unchanged.
    assert.deepEqual(await totals(c), { client: 925_000, pt: 67_500, platform: 7_500, pending: 0, sum: PRICE });
    assert.deepEqual(await entitlement(c), before);
    await H.invariant("Q4");
  });
});

test("Q5 (was a BLOCKER, closed by A+): the client can only use the 3 remaining entitlements, the contract completes with the no-show refund HELD, and the reconciliation pays it - by hand 1,000,000", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await reportedAndAgreed();
    const A = admin();
    const B = admin();
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    await H.deliver(c, 3); // TEST FIXTURE: 3 past sessions delivered through the real complete + confirm (the 3 entitlements the no-show left)
    // used 3 + compensated 1 = 4 -> the contract is COMPLETE. Hand: PT 3 x 225,000 = 675,000, platform 3 x 25,000 = 75,000, the no-show session's V 250,000 is HELD (PT 225,000 + platform 25,000 pending), L OPEN 125,000
    assert.deepEqual(await entitlement(c), { status: "COMPLETED", total: 4, used: 3, compensated: 1, remaining: 0 });
    assert.deepEqual(await totals(c), { client: 0, pt: 675_000, platform: 75_000, pending: 250_000, sum: PRICE });
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: 125_000, paid: 0, unpaid: 125_000 }]);
    // the refund is VISIBLE as the settlement row still waiting for a person (never reported as done)
    const waiting = (await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))!;
    assert.ok(["NEEDS_HUMAN", "UNCONFIRMED"].includes(waiting.status), waiting.status);
    const terminateOps = ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `CONTRACT_TERMINATE:${c.id}`)) as any[])[0].n;
    assert.equal(terminateOps, 1, "the natural completion ended the contract once");

    // the reconciliation (the contract is ENDED: the resolution of the hold, same key)
    await req("POST", `${BASE}/${waiting.id}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${waiting.id}/proposals`, A.token, PROPOSAL);
    assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
    const approved = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/approve`, B.token, APPROVE);
    assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));
    const after = { client: 250_000, pt: 675_000, platform: 75_000, pending: 0, sum: PRICE };
    assert.deepEqual(await totals(c), after);
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: 125_000, paid: 125_000, unpaid: 0 }]);
    assert.deepEqual(await entitlement(c), { status: "COMPLETED", total: 4, used: 3, compensated: 1, remaining: 0 });
    // replay / retry: nothing changes
    const again = await req("POST", `${BASE}/proposals/${proposed.body.reconciliationId}/retry`, B.token, {});
    assert.equal(again.body.execution.status, "EXECUTED");
    assert.deepEqual(await totals(c), after);
    assert.deepEqual(await entitlement(c), { status: "COMPLETED", total: 4, used: 3, compensated: 1, remaining: 0 });
    assert.ok(await mark(S.id));
    await H.invariant("Q5");
  });
});
