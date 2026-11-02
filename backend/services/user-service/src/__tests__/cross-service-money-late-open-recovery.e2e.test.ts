/**
 * LATE-OPEN RECONCILIATION - RECOVERY after exhausted attempts, HAND-OVER of the person in charge, FOUR EYES and CONFLICT OF INTEREST (Quota & Recovery round, 01/11/2026). REAL payment-service.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service). TEST FIXTURES named where used: the OPEN obligation (real record-only door), failures (a wrapper on paymentClient that throws BEFORE the request
 * reaches the ledger, or AFTER the ledger committed), the obligation states set in the payment test DB, and auth-service's account lookup (a table of known accounts: the real auth-service is not running).
 *
 * Hand numbers (COMPLETED + L OPEN, running contract): after the money step: client 125,000, PT 112,500, platform 12,500, pending 750,000; L PAID_VIA_LEDGER 125,000.
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
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const BASE = "/admin/late-open-reconciliations";
const PAID = { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE };

let H: Harness;
const known = new Map<string, { role: string; isActive: boolean }>();
let restoreAuthLookup: () => void = () => {};
let lookupOutage = false;
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  H = await startHarness({ paymentAuth: true });
  // TEST FIXTURE: auth-service's account lookup answers from a table (the real auth-service is not running)
  restoreAuthLookup = H.m.base.patch(H.m.authServiceClient, "internalGet", async (p: string) => {
    if (lookupOutage) throw Object.assign(new Error("auth down"), { response: { status: 500, data: {} } });
    const id = decodeURIComponent(String(p).split("/").pop()!);
    const u = known.get(id);
    if (!u) throw Object.assign(new Error("not found"), { response: { status: 404, data: {} } });
    return { status: 200, data: { user: { id, role: u.role, isActive: u.isActive } } };
  });
});
test.after(async () => {
  restoreAuthLookup();
  if (H) await H.close();
});

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  lookupOutage = false;
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
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(`SELECT kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`, txnId);
  return rows.map((r) => ({ kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function settleEvents(txnId: string) {
  return num(((await H.payDb.$queryRawUnsafe(`SELECT count(*)::text AS n FROM contract_unpaid_obligation_events e JOIN contract_unpaid_obligations o ON o.id = e.obligation_id WHERE o.transaction_id = $1 AND e.action::text = 'SETTLE_VIA_LEDGER'`, txnId)) as any[])[0].n);
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const stepRow = async (contractId: string, kind: string) => (await H.m.prisma.sessionSettlement.findMany({ where: { contractId } })).find((r) => r.kind === kind);

/** COMPLETED session of an ordinary contract with L OPEN; the client's confirmation was refused by the ledger -> SESSION_RELEASE parked NEEDS_HUMAN. */
async function buildParked(): Promise<{ c: PaidContract; S: { id: string }; rowId: string }> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  known.set(c.clientUserId, { role: "CUSTOMER", isActive: true });
  known.set(c.ptUserId, { role: "PT", isActive: true });
  const S = await lateSession(c);
  await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
  assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  assert.equal((await H.call("POST", `/sessions/${S.id}/confirm`, c.clientToken)).status, 200);
  const step = (await stepRow(c.id, "SESSION_RELEASE"))!;
  assert.equal(step.status, "NEEDS_HUMAN");
  return { c, S, rowId: step.id };
}

const admin = () => {
  const id = `adm-${randomUUID()}`;
  known.set(id, { role: "ADMIN", isActive: true });
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
  verificationNote: "Đã đối chiếu nhật ký phòng học: PT vào phòng sau 16 phút",
  evidenceRefs: ["room-log:session-room-joins"],
  policyBasis: "Khoản L của đúng buổi này là nghĩa vụ OPEN trong sổ cái; người đề xuất xác nhận việc đi muộn bằng nhật ký phòng",
};
const APPROVE = { reason: "Đã kiểm tra lại bằng chứng, đồng ý", conflictOfInterestDeclaredNone: true };
const RECOVERY = { reason: "Đề xuất đã duyệt nhưng hết lượt thực thi; cần xem lại sổ cái" };

function failing(method: string, mode: "before" | "after", times: number) {
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

/** claim + propose by A, approve by B while the seam fails `times` times: the first execution is the first failure; two retries exhaust the first epoch (3 attempts). */
async function exhaust(rowId: string, seam: ReturnType<typeof failing>, A = admin(), B = admin()) {
  assert.equal((await req("POST", `${BASE}/${rowId}/claim`, A.token, {})).status, 200);
  const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  const id = proposed.body.reconciliationId as string;
  const approved = await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE);
  assert.equal(approved.body.execution.status, "FAILED", JSON.stringify(approved.body));
  for (let i = 0; i < 2; i++) assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {})).body.execution.status, "FAILED");
  const exhausted = await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {});
  assert.deepEqual([exhausted.status, exhausted.body.code], [409, "EXECUTION_ATTEMPTS_EXHAUSTED"]);
  assert.equal(seam.calls() >= 3, true);
  return { A, B, id };
}

// ═════════════════════ A. recovery after exhaustion ═════════════════════
test("R1 REPLAY: the ledger WROTE the payment (crash after commit, three times) and the attempts are exhausted -> recovery reads the ledger, second admin approves, the SAME key replays: money exactly once, row and quota catch up", { skip }, async () => {
  await scenario(async () => {
    const { c, S, rowId } = await buildParked();
    const seam = failing("releaseSession", "after", 3);
    const { A, B, id } = await exhaust(rowId, seam);
    // the ledger booked it ONCE; this side never recorded it
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    assert.deepEqual(await totals(c), PAID);
    assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 1);
    assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "NEEDS_HUMAN");
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, 1);
    seam.restore();

    const X = admin();
    const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.deepEqual([opened.body.classification, opened.body.haltCode], ["REPLAY", null]);
    const recoveryId = opened.body.recoveryId as string;
    const Y = admin();
    const approved = await req("POST", `${BASE}/recoveries/${recoveryId}/approve`, Y.token, APPROVE);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual([approved.body.status, approved.body.execution.status, approved.body.classification], ["APPLIED", "EXECUTED", "REPLAY"]);
    // nothing new moved; everything caught up exactly once
    assert.deepEqual(await totals(c), PAID);
    assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 1);
    assert.equal(await settleEvents(c.txnId), 1);
    assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, 1, "the quota is not booked twice");
    const rec = await H.m.prisma.lateOpenRecovery.findUniqueOrThrow({ where: { id: recoveryId } });
    assert.deepEqual([rec.openedBy, rec.approvedBy, rec.outcome], [X.id, Y.id, "APPLIED"]);
    const p = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } });
    assert.equal(p.outcome, "EXECUTED");
    const actions = (await H.m.prisma.lateOpenReconciliationEvent.findMany({ where: { reconciliationId: id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    assert.ok(["RECOVERY_OPENED", "RECOVERY_APPROVED", "RECOVERY_APPLIED"].every((a) => actions.includes(a)), actions.join(","));
    // replay of the approval changes nothing
    const again = await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {});
    assert.equal(again.body.execution.status, "EXECUTED");
    assert.deepEqual(await totals(c), PAID);
    void A;
    await H.invariant("R1");
  });
});

test("R2 GRANT: the ledger did NOT write (three failures before it), the obligation is a clean OPEN -> recovery grants a bounded number of extra executions on the SAME key; a second recovery is possible, a third is refused", { skip }, async () => {
  await scenario(async () => {
    const { c, S, rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 99);
    const { id } = await exhaust(rowId, seam);
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
    const calls0 = seam.calls();

    // recovery 1: GRANT, but the cause is still there -> the 2 extra executions fail too
    const X = admin();
    const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.equal(opened.body.classification, "GRANT");
    const Y = admin();
    const approved = await req("POST", `${BASE}/recoveries/${opened.body.recoveryId}/approve`, Y.token, APPROVE);
    assert.deepEqual([approved.status, approved.body.status, approved.body.execution.status], [200, "APPLIED", "FAILED"]);
    assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {})).body.execution.status, "FAILED");
    const stop = await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {});
    assert.deepEqual([stop.status, stop.body.code], [409, "EXECUTION_ATTEMPTS_EXHAUSTED"]);
    assert.equal(seam.calls(), calls0 + 2, "exactly 2 extra executions were granted");

    // recovery 2: the cause is fixed -> executed, money once
    seam.restore();
    const opened2 = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
    assert.deepEqual([opened2.status, opened2.body.classification], [201, "GRANT"]);
    const approved2 = await req("POST", `${BASE}/recoveries/${opened2.body.recoveryId}/approve`, Y.token, APPROVE);
    assert.deepEqual([approved2.body.status, approved2.body.execution.status], ["APPLIED", "EXECUTED"], JSON.stringify(approved2.body));
    assert.deepEqual(await totals(c), PAID);
    assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 1);
    assert.equal(await settleEvents(c.txnId), 1);
    await H.invariant("R2");
  });
});

test("R2b LIMIT: after two recoveries that did not fix it, a third is refused 409 RECOVERY_LIMIT_REACHED; nothing moves; the row stays NEEDS_HUMAN", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 999);
    try {
      const { id } = await exhaust(rowId, seam);
      const X = admin();
      const Y = admin();
      for (let i = 0; i < 2; i++) {
        const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
        assert.equal(opened.status, 201, `recovery ${i + 1}: ${JSON.stringify(opened.body)}`);
        const approved = await req("POST", `${BASE}/recoveries/${opened.body.recoveryId}/approve`, Y.token, APPROVE);
        assert.equal(approved.body.execution.status, "FAILED");
        assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {})).body.execution.status, "FAILED");
        assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {})).status, 409);
      }
      const third = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
      assert.deepEqual([third.status, third.body.code], [409, "RECOVERY_LIMIT_REACHED"]);
      assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
      assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "NEEDS_HUMAN");
      const item = await req("GET", `${BASE}/${rowId}`, X.token);
      assert.equal(item.body.status, "EXECUTION_EXHAUSTED");
      assert.equal(item.body.attempts.recoveriesLeft, 0);
    } finally {
      seam.restore();
    }
  });
});

test("R3 HALT: exhausted, the obligation is no longer a clean OPEN (UNDER_REVIEW) -> the recovery is classified HALT with a code; approving it runs NOTHING; the row stays NEEDS_HUMAN", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 3);
    const { id } = await exhaust(rowId, seam);
    await H.payDb.$executeRawUnsafe(`UPDATE contract_unpaid_obligations SET status = 'UNDER_REVIEW'::"ContractUnpaidObligationStatus" WHERE transaction_id = $1`, c.txnId);
    const callsBefore = seam.calls();
    const X = admin();
    const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.deepEqual([opened.body.classification, opened.body.haltCode], ["HALT", "OBLIGATION_UNDER_REVIEW"]);
    const approved = await req("POST", `${BASE}/recoveries/${opened.body.recoveryId}/approve`, admin().token, APPROVE);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual([approved.body.status, approved.body.haltCode], ["HALTED", "OBLIGATION_UNDER_REVIEW"]);
    assert.equal(seam.calls(), callsBefore, "nothing was run");
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
    assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "NEEDS_HUMAN");
    const rec = await H.m.prisma.lateOpenRecovery.findUniqueOrThrow({ where: { id: opened.body.recoveryId } });
    assert.equal(rec.outcome, "HALTED");
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: id, action: "RECOVERY_HALTED" } }), 1);
    seam.restore();
  });
});

test("R3b HALT when the ledger cannot be read (payment-service down): classified LEDGER_UNREADABLE, approval halts, nothing runs", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 3);
    const { id } = await exhaust(rowId, seam);
    seam.restore();
    await H.stopPayment();
    const X = admin();
    const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.deepEqual([opened.body.classification, opened.body.haltCode], ["HALT", "LEDGER_UNREADABLE"]);
    const approved = await req("POST", `${BASE}/recoveries/${opened.body.recoveryId}/approve`, admin().token, APPROVE);
    assert.deepEqual([approved.body.status, approved.body.haltCode], ["HALTED", "LEDGER_UNREADABLE"]);
    await H.startPayment();
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
    assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "NEEDS_HUMAN");
  });
});

test("R4 recovery is only for an EXHAUSTED proposal; a rejected recovery frees the slot; replays by Idempotency-Key", { skip }, async () => {
  await scenario(async () => {
    const { rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 3);
    try {
      const A = admin();
      const B = admin();
      await req("POST", `${BASE}/${rowId}/claim`, A.token, {});
      const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
      const id = proposed.body.reconciliationId;
      const X = admin();
      // not approved yet / not exhausted yet
      assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY)).body.code], ["NOT_APPROVED"]);
      assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE)).body.execution.status, "FAILED");
      assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY)).body.code], ["NOT_EXHAUSTED"]);
      for (let i = 0; i < 2; i++) await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {});
      const key = `rk-${randomUUID()}`;
      const o1 = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY, { "Idempotency-Key": key });
      const o2 = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY, { "Idempotency-Key": key });
      assert.deepEqual([o1.status, o2.status, o2.headers.get("idempotent-replay")], [201, 201, "true"]);
      assert.equal(o1.body.recoveryId, o2.body.recoveryId);
      assert.equal((await req("POST", `${BASE}/proposals/${id}/recoveries`, admin().token, RECOVERY)).body.code, "RECOVERY_ALREADY_OPEN");
      // reject frees the slot
      assert.equal((await req("POST", `${BASE}/recoveries/${o1.body.recoveryId}/reject`, admin().token, { reason: "không cần" })).status, 200);
      const o3 = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
      assert.equal(o3.status, 201);
      assert.equal(await H.m.prisma.lateOpenRecovery.count({ where: { reconciliationId: id } }), 2);
    } finally {
      seam.restore();
    }
  });
});

// ═════════════════════ B. hand-over ═════════════════════
test("H1 hand-over: one append-only event with previous / new / reason; the proposal's assignee column never changes; the NEW person in charge cannot approve; a third admin can", { skip }, async () => {
  await scenario(async () => {
    const { c, S, rowId } = await buildParked();
    const A = admin();
    const B = admin();
    const C = admin();
    await req("POST", `${BASE}/${rowId}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
    const id = proposed.body.reconciliationId;

    const handed = await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: B.id, reason: "A nghỉ phép" });
    assert.equal(handed.status, 200, JSON.stringify(handed.body));
    assert.deepEqual([handed.body.assignee, handed.body.previous], [B.id, A.id]);
    const item = await req("GET", `${BASE}/${rowId}`, C.token);
    assert.equal(item.body.assignee, B.id, "the current person in charge comes from the latest event");
    assert.equal(item.body.proposals[0].assignee, A.id, "the proposal's own column is immutable");
    const ev = await H.m.prisma.lateOpenReconciliationEvent.findFirstOrThrow({ where: { settlementRowId: rowId, action: "HANDED_OVER" } });
    assert.deepEqual([ev.actorUserId, (ev.payload as any).detail.from, (ev.payload as any).detail.to, (ev.payload as any).detail.reason], [A.id, A.id, B.id, "A nghỉ phép"]);

    // the new person in charge cannot approve (four eyes), nor can the proposer
    assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE)).body.code], ["APPROVER_IS_ASSIGNEE"]);
    assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/approve`, A.token, APPROVE)).body.code], ["SELF_APPROVAL_FORBIDDEN"]);
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
    // a third admin approves
    const approved = await req("POST", `${BASE}/proposals/${id}/approve`, C.token, APPROVE);
    assert.equal(approved.body.execution.status, "EXECUTED", JSON.stringify(approved.body));
    assert.deepEqual(await totals(c), PAID);
    assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 1);
    await H.invariant("H1");
  });
});

test("H2 hand-over to oneself does not bypass four eyes; the recipient must be a REAL active ADMIN and not a party of the contract; only an ADMIN may hand over; an account lookup outage fails closed", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const A = admin();
    const C = admin();
    await req("POST", `${BASE}/${rowId}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
    const id = proposed.body.reconciliationId;

    // C (the intended approver) takes the file for himself, then tries to approve it: refused
    const self = await req("POST", `${BASE}/${rowId}/handover`, C.token, { newAssigneeId: C.id, reason: "tôi nhận hồ sơ" });
    assert.equal(self.status, 200, JSON.stringify(self.body));
    assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/approve`, C.token, APPROVE)).body.code], ["APPROVER_IS_ASSIGNEE"]);

    // recipient: not an admin / unknown / a party / inactive
    const notAdmin = await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: c.clientUserId, reason: "x" });
    assert.ok([403, 422].includes(notAdmin.status), JSON.stringify(notAdmin.body)); // the client is a party AND not an admin: COI is checked first
    assert.equal(notAdmin.body.code, "CONFLICT_OF_INTEREST");
    const plainUser = `user-${randomUUID()}`;
    known.set(plainUser, { role: "CUSTOMER", isActive: true });
    assert.deepEqual([(await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: plainUser, reason: "x" })).body.code], ["ASSIGNEE_NOT_ADMIN"]);
    assert.deepEqual([(await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: `ghost-${randomUUID()}`, reason: "x" })).body.code], ["ASSIGNEE_NOT_FOUND"]);
    const inactive = `adm-off-${randomUUID()}`;
    known.set(inactive, { role: "ADMIN", isActive: false });
    assert.deepEqual([(await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: inactive, reason: "x" })).body.code], ["ASSIGNEE_NOT_ADMIN"]);
    lookupOutage = true;
    const outage = await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: C.id, reason: "x" });
    assert.deepEqual([outage.status, outage.body.code], [503, "ACCOUNT_LOOKUP_UNAVAILABLE"]);
    lookupOutage = false;
    // only an ADMIN may hand over; the body is strict
    assert.equal((await req("POST", `${BASE}/${rowId}/handover`, c.clientToken, { newAssigneeId: C.id, reason: "x" })).status, 403);
    assert.equal((await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: C.id, reason: "x", assignee: "someone", userId: "x", approvedBy: "y" })).status, 400);
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { settlementRowId: rowId, action: "HANDED_OVER" } }), 1, "only the one valid hand-over left an event");
  });
});

// ═════════════════════ C. four eyes and conflict of interest ═════════════════════
test("K1 the parties of the contract (client, PT) cannot do ANY step even with an ADMIN role: claim, propose, approve, reject, hand-over, open and approve a recovery", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const A = admin();
    const partyClient = H.tokenFor(c.clientUserId, "ADMIN");
    const partyPt = H.tokenFor(c.ptUserId, "ADMIN");
    for (const [name, token] of [["client", partyClient], ["pt", partyPt]] as const) {
      const claim = await req("POST", `${BASE}/${rowId}/claim`, token, {});
      assert.deepEqual([claim.status, claim.body.code], [403, "CONFLICT_OF_INTEREST"], name);
      const prop = await req("POST", `${BASE}/${rowId}/proposals`, token, PROPOSAL);
      assert.deepEqual([prop.status, prop.body.code], [403, "CONFLICT_OF_INTEREST"], name);
    }
    await req("POST", `${BASE}/${rowId}/claim`, A.token, {});
    const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
    const id = proposed.body.reconciliationId;
    for (const [name, token] of [["client", partyClient], ["pt", partyPt]] as const) {
      assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, token, APPROVE)).body.code, "CONFLICT_OF_INTEREST", name);
      assert.equal((await req("POST", `${BASE}/proposals/${id}/reject`, token, { reason: "x" })).body.code, "CONFLICT_OF_INTEREST", name);
      assert.equal((await req("POST", `${BASE}/${rowId}/handover`, token, { newAssigneeId: A.id, reason: "x" })).body.code, "CONFLICT_OF_INTEREST", name);
    }
    // a party cannot be the RECIPIENT of a hand-over either (even if the account says ADMIN)
    known.set(c.clientUserId, { role: "ADMIN", isActive: true });
    assert.equal((await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: c.clientUserId, reason: "x" })).body.code, "CONFLICT_OF_INTEREST");
    known.set(c.clientUserId, { role: "CUSTOMER", isActive: true });
    assert.equal(await H.m.prisma.lateOpenReconciliationEvent.count({ where: { settlementRowId: rowId, action: { in: ["APPROVED", "REJECTED", "HANDED_OVER"] } } }), 0);
    const p = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([p.approvedBy, p.outcome], [null, null]);
  });
});

test("K2 recovery: the party cannot open or approve it, the opener / the proposer / the person in charge cannot approve it, the declaration is required, the body is strict", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 3);
    try {
      const { A, B, id } = await exhaust(rowId, seam);
      const partyClient = H.tokenFor(c.clientUserId, "ADMIN");
      assert.equal((await req("POST", `${BASE}/proposals/${id}/recoveries`, partyClient, RECOVERY)).body.code, "CONFLICT_OF_INTEREST");
      for (const extra of [{ userId: "x" }, { assignee: "x" }, { approvedBy: "x" }, { classification: "REPLAY" }]) assert.equal((await req("POST", `${BASE}/proposals/${id}/recoveries`, A.token, { ...RECOVERY, ...extra })).status, 400, JSON.stringify(extra));
      const X = admin();
      const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
      const rid = opened.body.recoveryId;
      assert.deepEqual([(await req("POST", `${BASE}/recoveries/${rid}/approve`, X.token, APPROVE)).body.code], ["SELF_APPROVAL_FORBIDDEN"]);
      assert.deepEqual([(await req("POST", `${BASE}/recoveries/${rid}/approve`, A.token, APPROVE)).body.code], ["SELF_APPROVAL_FORBIDDEN"], "the proposer (also the person in charge)");
      await req("POST", `${BASE}/${rowId}/handover`, A.token, { newAssigneeId: B.id, reason: "chuyển" });
      assert.deepEqual([(await req("POST", `${BASE}/recoveries/${rid}/approve`, B.token, APPROVE)).body.code], ["APPROVER_IS_ASSIGNEE"]);
      assert.equal((await req("POST", `${BASE}/recoveries/${rid}/approve`, partyClient, APPROVE)).body.code, "CONFLICT_OF_INTEREST");
      assert.equal((await req("POST", `${BASE}/recoveries/${rid}/approve`, admin().token, { reason: "ok", conflictOfInterestDeclaredNone: false })).body.code, "CONFLICT_OF_INTEREST");
      for (const extra of [{ userId: "x" }, { approvedBy: "x" }, { assignee: "x" }, { settleLateOpen: true }, { amount: 1 }]) assert.equal((await req("POST", `${BASE}/recoveries/${rid}/approve`, admin().token, { ...APPROVE, ...extra })).status, 400, JSON.stringify(extra));
      assert.equal((await req("POST", `${BASE}/recoveries/${rid}/approve`, c.clientToken, APPROVE)).status, 403, "a non-admin token");
      const rec = await H.m.prisma.lateOpenRecovery.findUniqueOrThrow({ where: { id: rid } });
      assert.deepEqual([rec.approvedBy, rec.outcome], [null, null], "nothing above approved it");
      assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE });
    } finally {
      seam.restore();
    }
  });
});

test("K3 the recovery table is append-only with one-time stamps, four eyes in the DATABASE too", { skip }, async () => {
  await scenario(async () => {
    const { rowId } = await buildParked();
    const seam = failing("releaseSession", "before", 3);
    try {
      const { id } = await exhaust(rowId, seam);
      const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, admin().token, RECOVERY);
      const rid = opened.body.recoveryId;
      const sql = (q: string) => H.m.prisma.$executeRawUnsafe(q);
      await assert.rejects(() => sql(`UPDATE late_open_reconciliation_recoveries SET reason = 'x' WHERE id = '${rid}'::uuid`), /append-only/);
      await assert.rejects(() => sql(`UPDATE late_open_reconciliation_recoveries SET classification = 'REPLAY' WHERE id = '${rid}'::uuid`), /append-only|violates check/i);
      await assert.rejects(() => sql(`UPDATE late_open_reconciliation_recoveries SET approved_by = opened_by, approved_at = now() WHERE id = '${rid}'::uuid`), /four_eyes|violates check/i);
      await assert.rejects(() => sql(`UPDATE late_open_reconciliation_recoveries SET approved_by = 'x' WHERE id = '${rid}'::uuid`), /approval_pair|append-only|violates check/i);
      await assert.rejects(() => sql(`DELETE FROM late_open_reconciliation_recoveries WHERE id = '${rid}'::uuid`), /append-only/);
      await sql(`UPDATE late_open_reconciliation_recoveries SET approved_by = 'someone-else', approved_at = now() WHERE id = '${rid}'::uuid`);
      await assert.rejects(() => sql(`UPDATE late_open_reconciliation_recoveries SET approved_by = 'a-third', approved_at = now() WHERE id = '${rid}'::uuid`), /append-only/);
    } finally {
      seam.restore();
    }
  });
});
