/**
 * QUOTA A+ - EVERY PATH that ends a session in NO_SHOW by the PT's fault (or must NOT), and the visibility of an exhausted late-open recovery. REAL payment-service.
 *
 *   P1  client reports the PT no-show, the PT AGREES        (POST /sessions/:id/report-no-show -> POST /sessions/:id/respond-no-show)
 *   P2  the PT cancels a CONFIRMED session under 24h before the start   (PATCH /sessions/:id/cancel)
 *   P3  the PT blocks a date holding a CONFIRMED session under 24h away (POST /availability/me/exceptions)
 *       each: session NO_SHOW + noShowQuotaBookedAt, compensated 1, used 0, remaining 3, client +250,000, PT 0; a settlement sweep and a replay of the action change nothing.
 *   P4 / P4b  the PT cancels / blocks at 24h or more: CANCELLED, no quota, no money
 *   P5  the CLIENT cancels late: CANCELLED, NO compensation, no mark (the session is charged to the client as today)
 *   P6  nobody joined the room (room-close sweep): CANCELLED, no quota, no money
 *   P7  the PT accuses the CLIENT of no-show: PENDING_CLIENT_CONFIRMATION, no quota, no money while pending
 *   R5  an exhausted recovery (RECOVERY_LIMIT_REACHED) stays visible: the late-open LIST, and the FH-4 read-only reconciliation report
 *
 * Evidence label: BACKEND INTEGRATION (cross-service), every action driven through the REAL HTTP route of the real user-service app. TEST FIXTURES named where used (session rows born CONFIRMED at the wanted
 * time, the OPEN obligation of R5 through the real record-only door, a wrapper on paymentClient that fails the money step, auth-service's account lookup). Hand numbers: 1,000,000 / 4 sessions, V = 250,000, 90/10.
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
const BASE = "/admin/late-open-reconciliations";

let H: Harness;
const known = new Map<string, { role: string; isActive: boolean }>();
let restoreAuthLookup: () => void = () => {};
const ptsOfScenario: string[] = [];
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  H = await startHarness({ paymentAuth: true });
  // TEST FIXTURE (R5 only): auth-service's account lookup answers from a table (the real auth-service is not running)
  restoreAuthLookup = H.m.base.patch(H.m.authServiceClient, "internalGet", async (p: string) => {
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
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.m.prisma.pTScheduleException.deleteMany({ where: { ptUserId: { in: ptsOfScenario } } }).catch(() => {});
    ptsOfScenario.length = 0;
    await H.cleanup();
  }
}
const newPt = async () => {
  const pt = await H.makePt();
  ptsOfScenario.push(pt);
  return pt;
};
const newContract = async () => H.paidContract(await newPt(), { price: PRICE, totalSessions: 4, eligibility: false });

const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const stepRow = async (contractId: string, kind: string) => (await H.m.prisma.sessionSettlement.findMany({ where: { contractId } })).find((r) => r.kind === kind);
const entitlement = async (c: PaidContract) => {
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const { getRemainingEntitlements } = await import("../services/contract.service");
  return { status: k.status, total: k.totalSessions, used: k.usedSessions, compensated: k.compensatedSessions, remaining: getRemainingEntitlements(k) };
};
const sessionOf = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });

/** TEST FIXTURE: a CONFIRMED ONLINE session that started 2h ago and nobody joined (the grace window is over, the room is closed). */
const confirmedPast = (c: PaidContract) => H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE" });
/** TEST FIXTURE: a CONFIRMED session that starts `hours` from now (the booking flow cannot be driven to a specific lead time). */
const confirmedAhead = (c: PaidContract, hours: number) => H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() + hours * HOUR), { sessionMode: "ONLINE" });

const FRESH = { status: "ACTIVE", total: 4, used: 0, compensated: 0, remaining: 4 };
const ONE_NO_SHOW = { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 };
const V_PAID = { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE };
const UNTOUCHED = { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE };

/** What a PT-fault NO_SHOW must look like, wherever it came from. ptAtFault is pinned as the code sets it TODAY: only markNoShow (P1) sets true; cancelSession (P2) / addException (P3) never touch it (schema default false). */
async function assertBookedNoShow(label: string, c: PaidContract, sessionId: string, expectedPtAtFault: boolean) {
  const s = await sessionOf(sessionId);
  console.log(`[nsp] ${label} ptAtFault observed = ${s.ptAtFault}`);
  assert.equal(s.status, "NO_SHOW", `${label}: status`);
  assert.ok(s.noShowQuotaBookedAt, `${label}: noShowQuotaBookedAt is set`);
  assert.equal(s.sessionDeducted, false, `${label}: the session is not deducted from the client`);
  assert.equal(s.ptAtFault, expectedPtAtFault, `${label}: ptAtFault as the code sets it today`);
  assert.deepEqual(await entitlement(c), ONE_NO_SHOW, `${label}: entitlement`);
  assert.deepEqual(await totals(c), V_PAID, `${label}: money - the client got V = 250,000, the PT nothing`);
  assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED", `${label}: money step settled`);
  assert.equal(await opCount(`PT_NO_SHOW:${sessionId}`), 1, `${label}: ledger op once`);
}
/** Nothing may move: a settlement sweep (3 ticks), and the re-play of the very action. */
async function assertStable(label: string, c: PaidContract, sessionId: string, replay: () => Promise<{ status: number }>, replayStatus: number) {
  const before = await H.snapshot();
  const markBefore = (await sessionOf(sessionId)).noShowQuotaBookedAt?.getTime();
  await drain(c.id, 3);
  assert.deepEqual(await entitlement(c), ONE_NO_SHOW, `${label}: after the sweep`);
  assert.deepEqual(await H.snapshot(), before, `${label}: the sweep moved nothing at the ledger`);
  const again = await replay();
  assert.equal(again.status, replayStatus, `${label}: the replay answers ${replayStatus}`);
  await drain(c.id, 3);
  assert.deepEqual(await entitlement(c), ONE_NO_SHOW, `${label}: after the replay`);
  assert.equal((await sessionOf(sessionId)).noShowQuotaBookedAt?.getTime(), markBefore, `${label}: the mark is unchanged`);
  assert.equal(await opCount(`PT_NO_SHOW:${sessionId}`), 1, `${label}: ledger op still once`);
  assert.deepEqual(await H.snapshot(), before, `${label}: the replay moved nothing at the ledger`);
  assert.deepEqual(await totals(c), V_PAID, `${label}: money after`);
  await H.invariant(label);
}
/** A session that must stay out of the quota and the money. */
async function assertNoQuotaNoMoney(label: string, c: PaidContract, sessionId: string) {
  const s = await sessionOf(sessionId);
  assert.equal(s.noShowQuotaBookedAt, null, `${label}: no mark`);
  assert.equal(await opCount(`PT_NO_SHOW:${sessionId}`), 0, `${label}: no compensation op`);
  assert.equal(await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"), undefined, `${label}: no compensation step`);
  assert.equal((await entitlement(c)).compensated, 0, `${label}: compensated 0`);
}

// ═════════════════════ the three paths that book the PT no-show ═════════════════════
test("P1 the client reports the PT no-show (POST report-no-show), the PT AGREES (POST respond-no-show): NO_SHOW, mark, compensated 1, client +250,000; sweep and replay change nothing", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedPast(c);
    const reported = await H.call("POST", `/sessions/${S.id}/report-no-show`, c.clientToken, { reason: "PT không đến buổi tập" });
    assert.equal(reported.status, 200, JSON.stringify(reported.body));
    const parked = await sessionOf(S.id);
    assert.deepEqual([parked.status, parked.noShowQuotaBookedAt], ["PT_NO_SHOW_REPORTED", null], "a report alone books nothing");
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);

    const agree = () => H.call("POST", `/sessions/${S.id}/respond-no-show`, c.ptToken, { response: "AGREE" });
    const answered = await agree();
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    await assertBookedNoShow("P1", c, S.id, true);
    await assertStable("P1", c, S.id, agree, 400);
  });
});

test("P2 the PT cancels a CONFIRMED session 23h before the start (PATCH cancel): NO_SHOW, mark, compensated 1, client +250,000; sweep and replay change nothing", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedAhead(c, 23);
    const cancel = () => H.call("PATCH", `/sessions/${S.id}/cancel`, c.ptToken, { reason: "PT bận đột xuất" });
    const res = await cancel();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await assertBookedNoShow("P2", c, S.id, false);
    await assertStable("P2", c, S.id, cancel, 400);
  });
});

test("P3 the PT blocks a date holding a CONFIRMED session 6h away (POST availability/me/exceptions): NO_SHOW, mark, compensated 1, client +250,000; sweep and replay change nothing", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedAhead(c, 6);
    // the full instant of the session's start: the service reads it as the day to block (its local day), whatever the machine's time zone
    const block = () => H.call("POST", "/availability/me/exceptions", c.ptToken, { date: S.scheduledStartAt.toISOString(), reason: "PT bận" });
    const res = await block();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await assertBookedNoShow("P3", c, S.id, false);
    // replay: the same block again finds no CONFIRMED session on that day any more (the route answers 201 and moves nothing)
    await assertStable("P3", c, S.id, block, 201);
  });
});

// ═════════════════════ negative controls ═════════════════════
test("P4 the PT cancels at 24h or more (24h02): CANCELLED, compensated 0, no mark, remaining 4, no money", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedAhead(c, 24 + 2 / 60);
    const res = await H.call("PATCH", `/sessions/${S.id}/cancel`, c.ptToken, { reason: "PT đổi lịch" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.sessionDeducted, s.cancelledBy, s.ptAtFault], ["CANCELLED", false, c.ptUserId, false]);
    await assertNoQuotaNoMoney("P4", c, S.id);
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await drain(c.id, 3);
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await H.invariant("P4");
  });
});

test("P4b the PT blocks a date holding a CONFIRMED session 30h away: CANCELLED, compensated 0, no mark, remaining 4, no money", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedAhead(c, 30);
    const res = await H.call("POST", "/availability/me/exceptions", c.ptToken, { date: S.scheduledStartAt.toISOString(), reason: "PT bận" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.sessionDeducted, s.cancelledBy, s.ptAtFault], ["CANCELLED", false, c.ptUserId, false]);
    await assertNoQuotaNoMoney("P4b", c, S.id);
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await H.invariant("P4b");
  });
});

test("P5 the CLIENT cancels late (5h): CANCELLED, NO compensation, no mark; the session is charged to the client as today (used 1), the PT is paid for it", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedAhead(c, 5);
    const res = await H.call("PATCH", `/sessions/${S.id}/cancel`, c.clientToken, { reason: "Khách bận" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.sessionDeducted, s.cancelledBy, s.ptAtFault], ["CANCELLED", true, c.clientUserId, false]);
    await assertNoQuotaNoMoney("P5", c, S.id);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 1, compensated: 0, remaining: 3 }, "used counts as today");
    const t = await totals(c);
    assert.equal(t.client, 0, "the client gets nothing back");
    assert.equal(t.sum, PRICE);
    assert.deepEqual(t, { client: 0, pt: 225_000, platform: 25_000, pending: 750_000, sum: PRICE }, "the PT is paid for the late-cancelled session (90/10 of 250,000)");
    await drain(c.id, 3);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 1, compensated: 0, remaining: 3 });
    assert.deepEqual(await totals(c), t);
    await H.invariant("P5");
  });
});

test("P6 nobody joined the room (room-close sweep): CANCELLED by SYSTEM, compensated 0, no mark, remaining 4, no money", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedPast(c); // no roomPtJoinedAt, no roomClientJoinedAt
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.sessionDeducted, s.cancelledBy, s.ptAtFault], ["CANCELLED", false, "SYSTEM", false]);
    await assertNoQuotaNoMoney("P6", c, S.id);
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await drain(c.id, 3);
    assert.deepEqual(await runSweep(), { scanned: 0, resolved: 0 });
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await H.invariant("P6");
  });
});

test("P7 the PT accuses the CLIENT of no-show (PATCH no-show, noShowBy CLIENT): PENDING_CLIENT_CONFIRMATION, compensated 0, no mark, no money while pending", { skip }, async () => {
  await scenario(async () => {
    const c = await newContract();
    const S = await confirmedPast(c);
    const res = await H.call("PATCH", `/sessions/${S.id}/no-show`, c.ptToken, { noShowBy: "CLIENT" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.sessionDeducted, s.ptAtFault], ["PENDING_CLIENT_CONFIRMATION", false, false]);
    await assertNoQuotaNoMoney("P7", c, S.id);
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await drain(c.id, 3);
    assert.equal((await sessionOf(S.id)).status, "PENDING_CLIENT_CONFIRMATION");
    assert.deepEqual(await entitlement(c), FRESH);
    assert.deepEqual(await totals(c), UNTOUCHED);
    await H.invariant("P7");
  });
});

// ═════════════════════ R5: an exhausted recovery stays visible ═════════════════════
const PROPOSAL = {
  reason: "Khách xác nhận PT vào muộn, khoản bồi thường chưa được sổ cái thực hiện",
  verificationNote: "Đã đối chiếu nhật ký phòng học: PT vào phòng sau 16 phút",
  evidenceRefs: ["room-log:session-room-joins"],
  policyBasis: "Khoản L của đúng buổi này là nghĩa vụ OPEN trong sổ cái; người đề xuất xác nhận việc đi muộn bằng nhật ký phòng",
};
const APPROVE = { reason: "Đã kiểm tra lại bằng chứng, đồng ý", conflictOfInterestDeclaredNone: true };
const RECOVERY = { reason: "Đề xuất đã duyệt nhưng hết lượt thực thi; cần xem lại sổ cái" };
const admin = () => {
  const id = `adm-${randomUUID()}`;
  known.set(id, { role: "ADMIN", isActive: true });
  return { id, token: H.tokenFor(id, "ADMIN") };
};
async function req(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(H.userUrl + path, {
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
function failing(method: string, times: number) {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  let n = 0;
  pc[method] = async function (...args: unknown[]) {
    n++;
    if (n <= times) throw new Error("simulated: payment-service never saw the request");
    return original.apply(this, args);
  };
  return { calls: () => n, restore: () => (pc[method] = original) };
}
/** TEST FIXTURE (same as the late-open recovery suite): COMPLETED session of an ordinary contract with L OPEN (real record-only door); the client's confirmation was refused by the ledger -> SESSION_RELEASE parked NEEDS_HUMAN. */
async function buildParked() {
  const c = await newContract();
  known.set(c.clientUserId, { role: "CUSTOMER", isActive: true });
  known.set(c.ptUserId, { role: "PT", isActive: true });
  const start = new Date(Date.now() - 2 * HOUR);
  const S = await H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
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

test("R5 after RECOVERY_LIMIT_REACHED the row is STILL listed: late-open LIST (EXECUTION_EXHAUSTED, assignee, recoveriesLeft 0) and the FH-4 read-only reconciliation report (NEEDS_HUMAN); one more retry / recovery is refused; money unchanged", { skip }, async () => {
  await scenario(async () => {
    const { c, rowId } = await buildParked();
    const seam = failing("releaseSession", 999);
    try {
      // claim + propose by A, approve by B, 2 retries -> the first epoch is exhausted
      const A = admin();
      const B = admin();
      assert.equal((await req("POST", `${BASE}/${rowId}/claim`, A.token, {})).status, 200);
      const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
      assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
      const id = proposed.body.reconciliationId as string;
      assert.equal((await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE)).body.execution.status, "FAILED");
      for (let i = 0; i < 2; i++) assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {})).body.execution.status, "FAILED");
      assert.deepEqual([(await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {})).body.code], ["EXECUTION_ATTEMPTS_EXHAUSTED"]);
      // two recoveries that did not fix it, each followed by its exhausted retries
      const X = admin();
      const Y = admin();
      for (let i = 0; i < 2; i++) {
        const opened = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
        assert.equal(opened.status, 201, `recovery ${i + 1}: ${JSON.stringify(opened.body)}`);
        assert.equal((await req("POST", `${BASE}/recoveries/${opened.body.recoveryId}/approve`, Y.token, APPROVE)).body.execution.status, "FAILED");
        assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {})).body.execution.status, "FAILED");
        assert.equal((await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {})).status, 409);
      }
      const third = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
      assert.deepEqual([third.status, third.body.code], [409, "RECOVERY_LIMIT_REACHED"]);

      const moneyBefore = await H.snapshot();
      const reader = admin();

      // 1) the late-open LIST (not only the item)
      const list = await req("GET", BASE, reader.token);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      const listed = (list.body.items as any[]).filter((i) => i.rowId === rowId);
      assert.equal(listed.length, 1, `the row is listed exactly once (count ${list.body.count})`);
      assert.equal(listed[0].status, "EXECUTION_EXHAUSTED");
      assert.ok(listed[0].assignee, "a person in charge is still named");
      assert.equal(listed[0].assignee, A.id);
      assert.equal(listed[0].attempts.recoveriesLeft, 0);
      assert.equal(listed[0].settlementStatus, "NEEDS_HUMAN");
      assert.equal(listed[0].kind, "SESSION_RELEASE");

      // 2) the FH-4 read-only reconciliation report (GET /admin/sessions/reconciliation)
      const report = await req("GET", "/admin/sessions/reconciliation?limit=200", reader.token);
      assert.equal(report.status, 200, JSON.stringify(report.body));
      const flagged = (report.body.needsAttention.items as any[]).filter((i) => i.id === rowId);
      assert.equal(flagged.length, 1, "the row is in needsAttention exactly once");
      assert.deepEqual([flagged[0].reason, flagged[0].status, flagged[0].kind, flagged[0].contractId], ["NEEDS_HUMAN", "NEEDS_HUMAN", "SESSION_RELEASE", c.id]);

      // 3) one more execute / retry / recovery attempt is refused, and nothing moves
      const retry = await req("POST", `${BASE}/proposals/${id}/retry`, Y.token, {});
      assert.deepEqual([retry.status, retry.body.code], [409, "EXECUTION_ATTEMPTS_EXHAUSTED"]);
      const fourth = await req("POST", `${BASE}/proposals/${id}/recoveries`, X.token, RECOVERY);
      assert.deepEqual([fourth.status, fourth.body.code], [409, "RECOVERY_LIMIT_REACHED"]);
      assert.deepEqual(await H.snapshot(), moneyBefore, "the reads and the refused attempts moved nothing at the ledger");
      assert.deepEqual(await totals(c), UNTOUCHED);
      assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "NEEDS_HUMAN");

      // and the lists still show it after the refusals
      const again = await req("GET", BASE, reader.token);
      assert.equal((again.body.items as any[]).find((i) => i.rowId === rowId)?.status, "EXECUTION_EXHAUSTED");
      await H.invariant("R5");
    } finally {
      seam.restore();
    }
  });
});
