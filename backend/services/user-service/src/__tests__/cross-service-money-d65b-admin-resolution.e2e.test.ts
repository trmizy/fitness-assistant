/**
 * D65-B - the four-eyes ADMIN RESOLUTION of the money HELD for a NO_SHOW session (propose + approve), REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION (real HTTP between user-service's Express app in this process and a spawned payment-service child, real ledger, isolated *_test databases).
 * TEST FIXTURE (named where used): the contract row, the signed gateway IPN, session rows at their starting state, the token -> identity table that replaces auth-service, the SQL that
 * poses an ineligible state (D77 row, Case row, ...) and the fault injection on paymentClient (a lost answer / a refused call). Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=".../gymcoach_user_bcd65_test?schema=public" E2E_PAYMENT_DATABASE_URL=".../gymcoach_payment_bcd65_test?schema=public" \
 *     ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-d65b-admin-resolution.e2e.test.ts
 *
 * HAND-COMPUTED MONEY (written BEFORE the tests), contract 1,000,000đ / 4 sessions, rates platform 10% / PT 90% / gym 0, no holdback:
 *   one session V = 1,000,000 / 4 = 250,000  = PT 225,000 + platform 25,000.      Escrow at payment: PT pending 900,000, platform pending 100,000.
 *   The PT absence of session 1 was NOT paid (payment-service down) and the contract is then ended with that row held:
 *   (a) PT_CANCELLED (client made whole): refund = (4 - used 0 - paid-compensated 0 - held 1) x 250,000 = 750,000 NOW, no fee.
 *         client 750,000 | PT available 0 | platform available 0 | HELD: PT pending 225,000 + platform pending 25,000 = 250,000.   Sum = 750,000 + 250,000 = 1,000,000.
 *       D65-B (NOT_DELIVERED): client +250,000 -> 1,000,000 | pending -250,000 -> 0.                                                   Sum = 1,000,000.
 *   (b) CLIENT_CANCELLED: refund = 90% x 750,000 = 675,000; fee 75,000 -> PT 67,500 / platform 7,500 available; the held 250,000 is unchanged.
 *         client 675,000 | PT 67,500 | platform 7,500 | pending 250,000.   Sum = 1,000,000.
 *       D65-B: client +250,000 -> 925,000 | PT 67,500 | platform 7,500 | pending 0.                                                    Sum = 1,000,000.
 *   The quota is the same before and after: compensatedSessions 1, usedSessions 0, no_show_quota_booked_at unchanged, ptAtFault true.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const PRICE = 1_000_000;
const FLAG = "DISPUTE_CASE_D65B_RESOLUTION_ENABLED";

let H: Harness;
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  H = await startHarness();
});
test.after(async () => {
  delete process.env[FLAG];
  if (H) await H.close();
});
test.beforeEach(() => {
  process.env[FLAG] = "true"; // effective only because NODE_ENV=test and the preload accepted the isolated database
});

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  await H.m.prisma.$executeRawUnsafe("TRUNCATE d65b_resolution_events, d65b_resolutions"); // TRUNCATE does not fire the row triggers
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

const BASE = () => H.userUrl + "/admin/unconfirmed-session-resolutions";
async function api(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE() + path, {
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
/** the verifiable references of the CURRENT scenario (set by heldNoShow): a stored case-evidence row of this session + the ledger operation of this contract's ending */
let evid: { id: string; hash: string; ledgerKey: string } = { id: "", hash: "", ledgerKey: "" };
const proposeBody = (over: Record<string, unknown> = {}) => ({
  reason: "PT vắng, hoàn tiền chưa trả được, hợp đồng đã kết thúc",
  evidenceRefs: [
    { type: "EVIDENCE", id: evid.id, contentHash: evid.hash },
    { type: "LEDGER_OP", key: evid.ledgerKey },
  ],
  ...over,
});
const approveBody = (over: Record<string, unknown> = {}) => ({ reason: "Đã đối chiếu bằng chứng, đồng ý hoàn", conflictOfInterestDeclaredNone: true, ...over });
const propose = (token: string, sessionId: string, body: unknown = proposeBody(), headers: Record<string, string> = {}) => api("POST", `/sessions/${sessionId}/proposals`, token, body, headers);
const approve = (token: string, id: string, body: unknown = approveBody(), headers: Record<string, string> = {}) => api("POST", `/${id}/approve`, token, body, headers);

const adminA = () => H.tokenFor("adm-d65b-A", "ADMIN");
const adminB = () => H.tokenFor("adm-d65b-B", "ADMIN");
const adminC = () => H.tokenFor("adm-d65b-C", "ADMIN");

const confirmedPast = (c: PaidContract) => H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE" });
const ptAdmits = (c: PaidContract, sid: string) => H.call("PATCH", `/sessions/${sid}/no-show`, c.ptToken, {});
const sessionOf = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });
const rowOf = (key: string) => H.m.prisma.sessionSettlement.findUnique({ where: { idempotencyKey: key } });
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
async function quota(c: PaidContract, sid: string) {
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const s = await sessionOf(sid);
  return { status: k.status, used: k.usedSessions, compensated: k.compensatedSessions, mark: s.noShowQuotaBookedAt?.toISOString() ?? null, ptAtFault: s.ptAtFault, sessionStatus: s.status, sessionDeducted: s.sessionDeducted };
}
/** everything a refused call could have written */
async function footprint(c: PaidContract) {
  return {
    resolutions: await H.m.prisma.d65bResolution.count(),
    events: await H.m.prisma.d65bResolutionEvent.count(),
    settlements: (await H.m.prisma.sessionSettlement.findMany({ where: { contractId: c.id }, orderBy: { idempotencyKey: "asc" } })).map((r) => `${r.idempotencyKey}:${r.status}:${r.attempts}`),
    ledger: await H.snapshot(),
  };
}
const notices = (userId: string, sid: string) => H.m.prisma.notification.count({ where: { userId, entityId: sid, text: { contains: "đã được quản trị viên đối soát" } } });

/**
 * The scenario every test starts from: session 1 of a 1,000,000 / 4 contract is a PT NO_SHOW whose refund the ledger NEVER performed (payment-service was down); the contract is then
 * ended by `by` for `reason`; the ending HOLDS the session's value and the compensation row is UNCONFIRMED.
 */
async function heldNoShow(reason: "PT_CANCELLED" | "CLIENT_CANCELLED" = "PT_CANCELLED") {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
  const S = await confirmedPast(c);
  await H.stopPayment();
  assert.equal((await ptAdmits(c, S.id)).status, 200);
  await H.startPayment();
  const row0 = await rowOf(`PT_NO_SHOW:${S.id}`);
  assert.equal(row0?.status, "FAILED", "payment-service was down: the refund was not paid, the step is recorded and unsettled");
  // TEST FIXTURE: 12 failed attempts later the step is parked for a person (same fixture as cross-service-money-fh6-fh3c.e2e.test.ts) - the ending then asks the ledger, finds nothing, and HOLDS the value
  await H.m.prisma.sessionSettlement.update({ where: { id: row0!.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
  const end = await H.call("POST", `/contracts/${c.id}/terminate`, reason === "PT_CANCELLED" ? c.ptToken : c.clientToken, { reason });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  const held = await rowOf(`PT_NO_SHOW:${S.id}`);
  assert.equal(held?.status, "UNCONFIRMED", "the ending HELD the session's value");
  // TEST FIXTURE: a stored evidence row of THIS session (in a case that was closed at intake - no live Case) + the ledger operation of the ending, as verifiable references
  const kase = await H.m.prisma.disputeCase.create({
    data: { id: crypto.randomUUID(), sessionId: S.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId, type: "PT_NO_SHOW_CLAIM", status: "REJECTED_INTAKE", createdBy: "fixture" },
  });
  const hash = `sha256-${crypto.randomUUID()}`;
  const ev = await H.m.prisma.disputeCaseEvidence.create({
    data: { caseId: kase.id, provenanceType: "NOT_APPLICABLE", source: "FIXTURE", subject: "room-log", scopeSessionId: S.id, scopeContractId: c.id, captureStatus: "NOT_APPLICABLE", contentHash: hash, payload: {} },
  });
  evid = { id: ev.id, hash, ledgerKey: `CONTRACT_TERMINATE:${c.id}` };
  return { pt, c, S, held: held! };
}

// ═════════════════════ 1. the money, for BOTH ending reasons ═════════════════════
for (const [reason, before, after] of [
  ["PT_CANCELLED", { client: 750_000, pt: 0, platform: 0, pending: 250_000, sum: PRICE }, { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE }],
  ["CLIENT_CANCELLED", { client: 675_000, pt: 67_500, platform: 7_500, pending: 250_000, sum: PRICE }, { client: 925_000, pt: 67_500, platform: 7_500, pending: 0, sum: PRICE }],
] as const) {
  test(`T1 ${reason}: 1,000,000 / 4 sessions -> the client gets EXACTLY 250,000 more, pending drops EXACTLY 250,000, the sum stays 1,000,000, the quota is untouched`, { skip }, async () => {
    await scenario(async () => {
      const { c, S, held } = await heldNoShow(reason);
      assert.deepEqual(await totals(c), before, "hand-computed state after the ending");
      const q0 = await quota(c, S.id);
      assert.deepEqual([q0.compensated, q0.used, q0.ptAtFault, q0.sessionStatus, q0.sessionDeducted], [1, 0, true, "NO_SHOW", false]);
      assert.ok(q0.mark, "the quota was booked at the terminal change");

      const p = await propose(adminA(), S.id);
      assert.equal(p.status, 201, JSON.stringify(p.body));
      assert.deepEqual([p.body.status, p.body.sessionId, p.body.proposedBy], ["PROPOSED", S.id, "adm-d65b-A"]);
      assert.deepEqual(await totals(c), before, "a proposal moves no money");

      const a = await approve(adminB(), p.body.id);
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.deepEqual([a.body.status, a.body.execution.status, a.body.execution.creditedToClient], ["EXECUTED", "EXECUTED", "250000.00"]);
      assert.deepEqual(await totals(c), after);
      assert.equal(after.client - before.client, 250_000);
      assert.equal(before.pending - after.pending, 250_000);
      assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1, "the money moved once, under the existing key");
      assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "SETTLED", "the held row closed in the resolution's own transaction");
      assert.deepEqual([(await rowOf(`UNRESOLVED_SESSION:${S.id}`))?.status, (await rowOf(`UNRESOLVED_SESSION:${S.id}`))?.reason], ["SETTLED", "NOT_DELIVERED"]);
      assert.deepEqual(await quota(c, S.id), q0, "T8: compensatedSessions, used, the quota mark and ptAtFault are exactly what they were");
      assert.equal(await notices(c.clientUserId, S.id), 1, "the client is told once, after the ledger credit");
      await H.invariant("T1");

      // the audit: who, when, why, evidence, the ledger read before and after
      const d = await api("GET", `/${p.body.id}`, adminC());
      assert.equal(d.status, 200);
      assert.deepEqual(d.body.history.map((e: any) => e.action), ["PROPOSED", "APPROVED", "EXECUTION_STARTED", "EXECUTED"]);
      assert.deepEqual([d.body.proposedBy, d.body.approvedBy, d.body.outcome, d.body.heldRowStatus, d.body.resolutionRowStatus], ["adm-d65b-A", "adm-d65b-B", "EXECUTED", "SETTLED", "SETTLED"]);
      assert.deepEqual(d.body.evidenceRefs, [`EVIDENCE:${evid.id}:${evid.hash}`, `LEDGER_OP:${evid.ledgerKey}`], "stored as the VERIFIED canonical references");
      assert.equal(d.body.ledgerBefore.ledger.pendingTotal, "250000.00");
      assert.equal(d.body.ledgerAfter.ledger.pendingTotal, "0.00");
      assert.equal(d.body.ledgerAfter.creditedToClient, "250000.00");
      assert.equal(d.body.ledgerAfter.quotaAfter.compensatedSessions, 1);
      const list = await api("GET", "", adminC());
      assert.deepEqual(list.body.items.map((i: any) => [i.sessionId, i.status]), [[S.id, "EXECUTED"]]);
      void held;
    });
  });
}

// ═════════════════════ 2. replay, double-click, concurrent approval ═════════════════════
test("T2 replay / double-click / two admins approving at the same instant: ONE credit of 250,000, one approver, one ledger operation", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    assert.equal(p.status, 201);
    const rs = await Promise.all([approve(adminB(), p.body.id), approve(adminB(), p.body.id), approve(adminC(), p.body.id), approve(adminC(), p.body.id)]);
    const ok = rs.filter((r) => r.status === 200 || r.status === 202);
    const refused = rs.filter((r) => r.status === 409);
    assert.equal(ok.length + refused.length, 4, JSON.stringify(rs.map((r) => [r.status, r.body?.code])));
    assert.ok(ok.length >= 1);
    assert.ok(refused.every((r) => r.body.code === "PROPOSAL_ALREADY_APPROVED"), "the admin who did not win is refused");
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE }, "250,000 credited ONCE");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    const winner = (await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } })).approvedBy;
    assert.ok(winner === "adm-d65b-B" || winner === "adm-d65b-C");
    // replay by the recorded approver: nothing more is paid, it reports the finished execution
    const again = await approve(winner === "adm-d65b-B" ? adminB() : adminC(), p.body.id);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([again.body.execution.status, again.body.execution.replayed], ["EXECUTED", true]);
    // the other admin cannot approve it again
    const other = await approve(winner === "adm-d65b-B" ? adminC() : adminB(), p.body.id);
    assert.deepEqual([other.status, other.body.code], [409, "PROPOSAL_ALREADY_APPROVED"]);
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE });
    assert.equal((await H.m.prisma.d65bResolutionEvent.findMany({ where: { resolutionId: p.body.id, action: "EXECUTED" } })).length, 1, "one EXECUTED event");
    assert.equal(await notices(c.clientUserId, S.id), 1);
    await H.invariant("T2");
  });
});

test("T2b a second proposal for the same session is refused (one proposal per session, ever); two admins proposing at once -> exactly one; an Idempotency-Key retry returns the same proposal", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const rs = await Promise.all([propose(adminA(), S.id), propose(adminC(), S.id)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal(rs.find((r) => r.status === 409)!.body.code, "PROPOSAL_ALREADY_EXISTS");
    assert.equal(await H.m.prisma.d65bResolution.count(), 1);
    const again = await propose(adminB(), S.id);
    assert.deepEqual([again.status, again.body.code], [409, "PROPOSAL_ALREADY_EXISTS"]);
    // Idempotency-Key: same admin, same body -> the same proposal, flagged as a replay
    await scenario(async () => {
      const x = await heldNoShow();
      const k = { "idempotency-key": "k-d65b-1" };
      const first = await propose(adminA(), x.S.id, proposeBody(), k);
      const second = await propose(adminA(), x.S.id, proposeBody(), k);
      assert.deepEqual([first.status, second.status, second.headers.get("idempotent-replay"), second.body.id === first.body.id], [201, 201, "true", true]);
      const reused = await propose(adminA(), x.S.id, proposeBody({ reason: "khác" }), k);
      assert.deepEqual([reused.status, reused.body.code], [409, "IDEMPOTENCY_KEY_REUSED"]);
      assert.equal(await H.m.prisma.d65bResolution.count(), 1);
    });
    void c;
  });
});

// ═════════════════════ 3. crash after the ledger wrote, before user-service closed its rows ═════════════════════
test("T3 CRASH after the ledger credited, before user-service settled: nothing is marked paid, the sweep does not touch it, the approver's replay finishes it with NO second credit", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    const q0 = await quota(c, S.id);
    const original = H.m.paymentClient.resolveUnresolvedSession.bind(H.m.paymentClient);
    const saved = H.m.paymentClient.resolveUnresolvedSession;
    (H.m.paymentClient as any).resolveUnresolvedSession = async (body: any) => {
      await original(body); // the ledger performs it ...
      throw new Error("timeout of 15000ms exceeded"); // ... and the process "dies" before it can record anything
    };
    let a;
    try {
      a = await approve(adminB(), p.body.id);
    } finally {
      (H.m.paymentClient as any).resolveUnresolvedSession = saved;
    }
    assert.equal(a.status, 202, JSON.stringify(a.body));
    assert.equal(a.body.execution.status, "NOT_EXECUTED");
    assert.equal(a.body.status, "APPROVED_NOT_EXECUTED");
    assert.equal(await notices(c.clientUserId, S.id), 0, "nothing is said to the client before the confirmed credit is recorded");
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "UNCONFIRMED", "the held row is not closed");
    assert.equal((await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } })).outcome, null, "no EXECUTED stamp");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1, "the ledger did write it");
    const mid = await totals(c);
    assert.deepEqual(mid, { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE });

    // the settlement sweep (and the ending's drain) must not run a D65-B row: nothing changes
    await H.m.prisma.sessionSettlement.updateMany({ where: { contractId: c.id, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
    const sweep = await import("../services/session-settlement-sweep.service");
    for (let i = 0; i < 3; i++) await sweep.runSettlementSweep();
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "UNCONFIRMED");
    assert.notEqual((await rowOf(`UNRESOLVED_SESSION:${S.id}`))?.status, "SETTLED", "the sweep did not settle the D65-B resolution row on its own");
    assert.deepEqual(await totals(c), mid);

    // another admin cannot finish it; the recorded approver can: no further money
    assert.deepEqual([(await approve(adminC(), p.body.id)).status], [409]);
    const resumed = await approve(adminB(), p.body.id);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.deepEqual([resumed.body.status, resumed.body.resumed, resumed.body.execution.status, resumed.body.execution.creditedToClient], ["EXECUTED", true, "EXECUTED", "250000.00"]);
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE }, "still ONE credit of 250,000");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "SETTLED");
    assert.deepEqual(await quota(c, S.id), q0);
    assert.equal(await notices(c.clientUserId, S.id), 1);
    await H.invariant("T3");
  });
});

// ═════════════════════ 4. payment-service failing / timing out ═════════════════════
test("T4 payment-service REFUSES the call (down) or the answer times out BEFORE the ledger acts: the row stays held, nothing is paid or announced, the sweep does not pay; the replay pays once", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    const before = await totals(c);
    const q0 = await quota(c, S.id);
    const original = H.m.paymentClient.resolveUnresolvedSession.bind(H.m.paymentClient);
    const saved = H.m.paymentClient.resolveUnresolvedSession;
    (H.m.paymentClient as any).resolveUnresolvedSession = async (body: any) => {
      await H.stopPayment(); // payment-service really goes down in the middle of the approval
      return original(body); // -> connection refused
    };
    let a;
    try {
      a = await approve(adminB(), p.body.id);
    } finally {
      (H.m.paymentClient as any).resolveUnresolvedSession = saved;
      await H.startPayment();
    }
    assert.equal(a.status, 202, JSON.stringify(a.body));
    assert.equal(a.body.execution.status, "NOT_EXECUTED");
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "UNCONFIRMED", "the held row stays held");
    assert.equal((await rowOf(`UNRESOLVED_SESSION:${S.id}`))?.status, "FAILED");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 0);
    assert.deepEqual(await totals(c), before, "no money moved");
    assert.equal(await notices(c.clientUserId, S.id), 0, "no 'refunded' notice without a ledger credit");
    assert.equal((await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } })).outcome, null, "not marked executed");
    const d = await api("GET", `/${p.body.id}`, adminC());
    assert.equal(d.body.status, "APPROVED_NOT_EXECUTED");
    assert.equal(d.body.history.at(-1).action, "EXECUTION_FAILED");

    // the settlement sweep, several ticks: it never pays a D65-B row
    await H.m.prisma.sessionSettlement.updateMany({ where: { contractId: c.id, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
    const sweep = await import("../services/session-settlement-sweep.service");
    for (let i = 0; i < 3; i++) await sweep.runSettlementSweep();
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 0, "the sweep did not call the ledger for it");
    assert.deepEqual(await totals(c), before);
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "UNCONFIRMED");

    // payment-service down at PROPOSAL / APPROVAL time: 503, nothing written at all
    await H.stopPayment();
    const p2 = await api("GET", `/sessions/${S.id}`, adminC());
    assert.equal(p2.status, 200, "reads stay available");
    assert.equal(p2.body.assessment.eligible, false, "and say plainly that the ledger cannot be read");
    const eventsBefore = await H.m.prisma.d65bResolutionEvent.count();
    const dead = await approve(adminB(), p.body.id); // already approved by B -> resume -> needs the ledger
    await H.startPayment();
    assert.deepEqual([dead.status, dead.body.code], [503, "LEDGER_UNAVAILABLE"]);
    assert.equal(await H.m.prisma.d65bResolutionEvent.count(), eventsBefore, "an unreadable ledger writes nothing");

    // the approver's replay with the ledger back: paid once
    const resumed = await approve(adminB(), p.body.id);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE });
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    assert.deepEqual(await quota(c, S.id), q0);
    await H.invariant("T4");
  });
});

test("T4b payment-service down BEFORE the approval: 503 LEDGER_UNAVAILABLE and NOTHING is written (no stamp, no event)", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    const snap = await footprint(c);
    await H.stopPayment();
    const a = await approve(adminB(), p.body.id);
    await H.startPayment();
    assert.deepEqual([a.status, a.body.code], [503, "LEDGER_UNAVAILABLE"]);
    assert.deepEqual(await footprint(c), snap);
    assert.equal((await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } })).approvedAt, null);
  });
});

// ═════════════════════ 5. identity, four eyes, conflict of interest, forged bodies ═════════════════════
test("T5 self-approval, a party of the contract (even holding ADMIN), a forged identity / amount / outcome in the body, a non-admin: ALL refused, NOTHING written", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const snap0 = await footprint(c);
    // proposing as the client / the PT of the contract, both holding ADMIN
    const clientAdmin = H.tokenFor(c.clientUserId, "ADMIN");
    const ptAdmin = H.tokenFor(c.ptUserId, "ADMIN");
    for (const t of [clientAdmin, ptAdmin]) {
      const r = await propose(t, S.id);
      assert.deepEqual([r.status, r.body.code], [403, "CONFLICT_OF_INTEREST"]);
    }
    // forged bodies on propose: refused (strict), the identity is the token's
    for (const extra of [{ amount: 250000 }, { outcome: "DELIVERED" }, { userId: "someone" }, { proposedBy: "adm-d65b-X" }, { sessionId: "other" }, { approvedBy: "x" }]) {
      const r = await propose(adminA(), S.id, proposeBody(extra));
      assert.deepEqual([r.status, r.body.code], [400, "INVALID_INPUT"], JSON.stringify(extra));
    }
    // non-admin roles
    for (const role of ["CUSTOMER", "PT", "GYM_OWNER"]) {
      const r = await propose(H.tokenFor(`not-admin-${role}`, role), S.id);
      assert.equal(r.status, 403, role);
    }
    assert.equal((await propose("no-such-token", S.id)).status, 401);
    assert.deepEqual(await footprint(c), snap0, "every refusal above wrote nothing");

    const p = await propose(adminA(), S.id);
    assert.equal(p.status, 201);
    const snap1 = await footprint(c);
    // self-approval
    const self = await approve(adminA(), p.body.id);
    assert.deepEqual([self.status, self.body.code], [403, "SELF_APPROVAL_FORBIDDEN"]);
    // the contract's parties as ADMIN
    for (const t of [clientAdmin, ptAdmin]) {
      const r = await approve(t, p.body.id);
      assert.deepEqual([r.status, r.body.code], [403, "CONFLICT_OF_INTEREST"]);
    }
    // no conflict-of-interest declaration
    const noDecl = await approve(adminB(), p.body.id, approveBody({ conflictOfInterestDeclaredNone: false }));
    assert.deepEqual([noDecl.status, noDecl.body.code], [403, "CONFLICT_OF_INTEREST"]);
    // forged approval bodies
    for (const extra of [{ amount: 1 }, { outcome: "DELIVERED" }, { userId: "x" }, { approvedBy: "adm-d65b-A" }, { proposedBy: "x" }]) {
      const r = await approve(adminB(), p.body.id, approveBody(extra));
      assert.deepEqual([r.status, r.body.code], [400, "INVALID_INPUT"], JSON.stringify(extra));
    }
    assert.equal((await approve(H.tokenFor("not-admin-pt", "PT"), p.body.id)).status, 403);
    // an unknown id
    assert.deepEqual([(await approve(adminB(), "11111111-1111-4111-8111-111111111111")).status], [404]);
    assert.deepEqual(await footprint(c), snap1, "nothing was written by any refusal");
    assert.equal((await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } })).approvedAt, null);
    await H.invariant("T5");
  });
});

test("T5b the database itself refuses what the service refuses: self-approval, a party as proposer/approver, an UPDATE of the audit, a DELETE, a second outcome", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    const sql = (q: string) => H.m.prisma.$executeRawUnsafe(q);
    const id = p.body.id;
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET reason = 'changed' WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET approved_by = proposed_by, approved_at = now(), approval_reason = 'x' WHERE id = '${id}'::uuid`), /d65b_four_eyes|violates check/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET approved_by = client_user_id, approved_at = now(), approval_reason = 'x' WHERE id = '${id}'::uuid`), /d65b_party_not_approver|violates check/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET outcome = 'EXECUTED', outcome_at = now(), ledger_after = '{}'::jsonb WHERE id = '${id}'::uuid`), /d65b_outcome_needs_approval|violates check/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET approved_by = 'x' WHERE id = '${id}'::uuid`), /d65b_approval_triple|violates check|append-only/);
    await assert.rejects(() => sql(`DELETE FROM d65b_resolutions WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE d65b_resolution_events SET note = 'x' WHERE resolution_id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`DELETE FROM d65b_resolution_events WHERE resolution_id = '${id}'::uuid`), /append-only/);
    await assert.rejects(
      () => sql(`INSERT INTO d65b_resolutions (id, session_id, contract_id, settlement_row_id, client_user_id, pt_user_id, reason, evidence_refs, proposed_by, ledger_before) SELECT gen_random_uuid(), 'dup-${id}', contract_id, settlement_row_id, client_user_id, pt_user_id, 'r', ARRAY['e'], 'x', '{}'::jsonb FROM d65b_resolutions WHERE id = '${id}'::uuid`),
      /23505|unique|duplicate/i,
      "one proposal per held row",
    );
    // a legitimate flow still stamps once and the stamps are then frozen
    const a = await approve(adminB(), id);
    assert.equal(a.status, 200);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET approved_by = 'adm-d65b-C' WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET ledger_after = '{}'::jsonb WHERE id = '${id}'::uuid`), /append-only/);
    void c;
  });
});

// ═════════════════════ 6. ineligible sessions ═════════════════════
test("T6 D77 trace, DISPUTED, ruled, a Case, a running contract, an unconfirmed ending, a cancelled session, a held row that is not held: refused with a specific code, NOTHING written", { skip }, async () => {
  await scenario(async () => {
    const { c, S, held } = await heldNoShow();
    const prisma = H.m.prisma;
    const expect = async (code: string, why: string) => {
      const snap = await footprint(c); // taken AFTER the fixture of this step, BEFORE the call
      const r = await propose(adminA(), S.id);
      assert.deepEqual([r.status, r.body.code], [409, code], why);
      assert.deepEqual(await footprint(c), snap, `${why}: nothing written`);
    };
    // baseline: eligible
    assert.equal((await api("GET", `/sessions/${S.id}`, adminA())).body.assessment.eligible, true);

    // D77: any PT_LATE_ARRIVAL row of the session (TEST FIXTURE: inserted)
    const late = await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${S.id}`, sessionId: S.id, contractId: c.id, status: "SETTLED" } });
    await expect("SESSION_HAS_D77", "a PT_LATE_ARRIVAL row");
    await prisma.sessionSettlement.delete({ where: { id: late.id } });

    // DISPUTED / PT_NO_SHOW_REPORTED
    for (const st of ["DISPUTED", "PT_NO_SHOW_REPORTED"] as const) {
      await prisma.session.update({ where: { id: S.id }, data: { status: st } });
      await expect("SESSION_IN_DISPUTE", st);
    }
    await prisma.session.update({ where: { id: S.id }, data: { status: "CANCELLED" } });
    await expect("SESSION_NOT_NO_SHOW", "CANCELLED");
    await prisma.session.update({ where: { id: S.id }, data: { status: "NO_SHOW" } });

    // already ruled by an admin / by a Case decision
    await prisma.session.update({ where: { id: S.id }, data: { resolvedBy: "some-admin" } });
    await expect("SESSION_WENT_THROUGH_DISPUTE", "ruled by an admin");
    await prisma.session.update({ where: { id: S.id }, data: { resolvedBy: null } });

    // a Case (any status but REJECTED_INTAKE)
    const k = await prisma.disputeCase.create({
      data: { id: crypto.randomUUID(), sessionId: S.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId, type: "PT_NO_SHOW_CLAIM", status: "INTAKE", createdBy: "fixture" },
    });
    await expect("CASE_EXISTS", "an open Case");
    await prisma.disputeCase.update({ where: { id: k.id }, data: { status: "DECISION_APPROVED" } }).catch(() => {});
    await expect("CASE_EXISTS", "an approved Case");
    await prisma.disputeCase.update({ where: { id: k.id }, data: { status: "REJECTED_INTAKE" } });

    // the ending is recorded but not confirmed
    await prisma.sessionSettlement.updateMany({ where: { contractId: c.id, kind: "CONTRACT_TERMINATION" }, data: { status: "FAILED" } });
    await expect("CONTRACT_ENDING", "unconfirmed ending");
    await prisma.sessionSettlement.updateMany({ where: { contractId: c.id, kind: "CONTRACT_TERMINATION" }, data: { status: "SETTLED" } });

    // the contract is running
    await prisma.contract.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    await expect("CONTRACT_NOT_ENDED", "running contract");
    await prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });

    // the row is not held (e.g. SETTLED / FAILED)
    await prisma.sessionSettlement.update({ where: { id: held.id }, data: { status: "FAILED" } });
    await expect("ROW_NOT_HELD", "row FAILED");
    await prisma.sessionSettlement.update({ where: { id: held.id }, data: { status: "UNCONFIRMED" } });

    // somebody already started the resolution under the key
    const res = await prisma.sessionSettlement.create({ data: { kind: "UNRESOLVED_SESSION_RESOLUTION", idempotencyKey: `UNRESOLVED_SESSION:${S.id}`, sessionId: S.id, contractId: c.id, status: "PENDING", reason: "DELIVERED" } });
    await expect("ALREADY_RESOLVING", "an UNRESOLVED_SESSION row exists");
    await prisma.sessionSettlement.delete({ where: { id: res.id } });

    // and a session that is NOT held at all: a client NO_SHOW of a running contract (no refund row)
    const pt2 = await H.makePt();
    const c2 = await H.paidContract(pt2, { price: PRICE, totalSessions: 4 });
    const S2 = await confirmedPast(c2);
    assert.equal((await ptAdmits(c2, S2.id)).status, 200);
    const r2 = await propose(adminA(), S2.id);
    assert.deepEqual([r2.status, r2.body.code], [409, "CONTRACT_NOT_ENDED"], "a running contract");

    // finally, everything restored: eligible again, and it works
    assert.equal((await api("GET", `/sessions/${S.id}`, adminA())).body.assessment.eligible, true);
    assert.equal((await propose(adminA(), S.id)).status, 201);
  });
});

test("T6b the state changes BETWEEN the proposal and the approval (a Case is opened / the ledger hold is gone): the approval is refused and nothing is stamped or paid", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    const k = await H.m.prisma.disputeCase.create({
      data: { id: crypto.randomUUID(), sessionId: S.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId, type: "PT_NO_SHOW_CLAIM", status: "INTAKE", createdBy: "fixture" },
    });
    const snap = await footprint(c);
    const a = await approve(adminB(), p.body.id);
    assert.deepEqual([a.status, a.body.code], [409, "CASE_EXISTS"]);
    assert.deepEqual(await footprint(c), snap);
    await H.m.prisma.disputeCase.update({ where: { id: k.id }, data: { status: "REJECTED_INTAKE" } });
    // the held funds are short (TEST FIXTURE: the PT's pending cut by 800,000 -> pending 100,000 + 25,000... less than one session)
    // TEST FIXTURE: a DEBIT of 225,000 on the PT's pending of THIS transaction (the ledger reading sums entries) + the wallet and escrow lowered by the same amount (invariant holds)
    await H.payDb.$executeRawUnsafe(
      `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, entry_type, bucket, amount, balance_before, balance_after, description)
       SELECT gen_random_uuid()::text, w.id, $2, 'DEBIT'::"LedgerEntryType", 'PENDING'::"LedgerBucket", 225000, w.pending_balance, w.pending_balance - 225000, 'TEST FIXTURE: shortfall'
         FROM wallets w WHERE w.owner_type = 'PT'::"WalletOwnerType" AND w.owner_id = $1`,
      c.ptUserId,
      c.txnId,
    );
    await H.payDb.$executeRawUnsafe(`UPDATE wallets SET pending_balance = pending_balance - 225000 WHERE owner_type = 'PT' AND owner_id = $1`, c.ptUserId);
    await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - 225000 WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
    const snap2 = await footprint(c);
    const b = await approve(adminB(), p.body.id);
    assert.deepEqual([b.status, b.body.code], [409, "INSUFFICIENT_HELD_FUNDS"]);
    assert.deepEqual(await footprint(c), snap2);
  });
});

// ═════════════════════ 7. the flag ═════════════════════
test("T7 flag OFF: EVERY POST is 409 D65B_RESOLUTION_DISABLED - propose, approve, retries, resumes, even an invalid body - and GET stays open; ON outside a test environment is still OFF", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    assert.equal(p.status, 201);
    const snap = await footprint(c);
    const check = async (why: string) => {
      const calls = [
        propose(adminA(), S.id),
        propose(adminA(), S.id, { amount: 1 }), // invalid body: the flag answers first
        propose(adminA(), S.id, proposeBody(), { "idempotency-key": "retry-1" }),
        approve(adminB(), p.body.id),
        approve(adminB(), p.body.id, { nonsense: true }),
        approve(adminB(), p.body.id, approveBody(), { "idempotency-key": "retry-2" }),
        api("POST", `/${p.body.id}/reject`, adminC(), { reason: "x", conflictOfInterestDeclaredNone: true }),
        api("POST", `/${p.body.id}/handover`, adminC(), { reason: "x", conflictOfInterestDeclaredNone: true }),
      ];
      for (const r of await Promise.all(calls)) assert.deepEqual([r.status, r.body.code], [409, "D65B_RESOLUTION_DISABLED"], why);
      assert.deepEqual(await footprint(c), snap, `${why}: nothing written`);
    };
    delete process.env[FLAG];
    await check("variable unset");
    process.env[FLAG] = "TRUE";
    await check("TRUE (not exactly 'true')");
    process.env[FLAG] = "1";
    await check("1");
    process.env[FLAG] = "true";
    process.env.NODE_ENV = "production";
    const warn = console.warn;
    console.warn = () => {};
    try {
      await check("true but NODE_ENV=production");
    } finally {
      console.warn = warn;
      process.env.NODE_ENV = "test";
    }
    // GET stays open with the flag off
    delete process.env[FLAG];
    assert.equal((await api("GET", "", adminC())).status, 200);
    assert.equal((await api("GET", `/${p.body.id}`, adminC())).status, 200);
    assert.equal((await api("GET", `/sessions/${S.id}`, adminC())).status, 200);
    assert.deepEqual(await totals(c), { client: 750_000, pt: 0, platform: 0, pending: 250_000, sum: PRICE });
    // an approved-but-unexecuted proposal cannot be resumed while the flag is off either
    process.env[FLAG] = "true";
    const q = await approve(adminB(), p.body.id);
    assert.equal(q.status, 200);
    delete process.env[FLAG];
    assert.deepEqual([(await approve(adminB(), p.body.id)).status], [409], "a 'resume' of a finished proposal is refused too");
  });
});

// ═════════════════════ 8. the quota, before and after (also asserted inside T1 / T3 / T4) ═════════════════════
test("T8 the quota is byte-identical before and after: compensatedSessions, usedSessions, no_show_quota_booked_at, ptAtFault, the remaining entitlement", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow("CLIENT_CANCELLED");
    const { getRemainingEntitlements } = await import("../services/contract.service");
    const entitlement = async () => getRemainingEntitlements(await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } }));
    const q0 = await quota(c, S.id);
    const e0 = await entitlement();
    const released0 = (await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toString();
    const p = await propose(adminA(), S.id);
    assert.deepEqual(await quota(c, S.id), q0);
    assert.equal((await approve(adminB(), p.body.id)).status, 200);
    assert.deepEqual(await quota(c, S.id), q0);
    assert.equal(await entitlement(), e0);
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toString(), released0, "this path never pays the PT: releasedToPt is exactly what the ending left");
  });
});

// ═════════════════════ 9. the read side ═════════════════════
test("T9 GET list / detail / by-session: admin only, no write, readable with the flag off; a stranger id is 404", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const pre = await api("GET", `/sessions/${S.id}`, adminA());
    assert.deepEqual([pre.status, pre.body.assessment.eligible, pre.body.resolution, pre.body.ledger.pendingTotal, pre.body.ledger.unit], [200, true, null, "250000.00", "250000.00"]);
    const p = await propose(adminA(), S.id);
    const post = await api("GET", `/sessions/${S.id}`, adminB());
    assert.equal(post.body.resolution.id, p.body.id);
    assert.equal(post.body.resolution.status, "PROPOSED");
    assert.equal((await api("GET", "", H.tokenFor("cust-x", "CUSTOMER"))).status, 403);
    assert.equal((await api("GET", `/${p.body.id}`, H.tokenFor("pt-x", "PT"))).status, 403);
    assert.equal((await api("GET", "/22222222-2222-4222-8222-222222222222", adminA())).status, 404);
    assert.equal((await api("GET", "/not-a-uuid", adminA())).status, 404);
    assert.equal((await api("GET", "", null)).status, 401);
    const d = await api("GET", `/${p.body.id}`, adminA());
    assert.deepEqual(d.body.history.map((e: any) => e.action), ["PROPOSED"]);
    void c;
  });
});

// ═════════ 10. evidence must be VERIFIABLE (Q26) ═════════
test("T10 evidenceRefs are verifiable references only: free text, a wrong hash, another session's evidence, an unknown or foreign ledger operation are refused (nothing written); a good set is stored as canonical references", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const snap = await footprint(c);
    const good = proposeBody().evidenceRefs;
    // free text (the old shape): refused by the strict schema
    const text = await propose(adminA(), S.id, { reason: "r", evidenceRefs: ["ticket-8841"] });
    assert.deepEqual([text.status, text.body.code], [400, "INVALID_INPUT"]);
    const bad: Array<[string, unknown]> = [
      ["wrong hash", [{ type: "EVIDENCE", id: evid.id, contentHash: "sha256-not-the-hash" }]],
      ["unknown evidence id", [{ type: "EVIDENCE", id: "33333333-3333-4333-8333-333333333333", contentHash: evid.hash }]],
      ["not a uuid", [{ type: "EVIDENCE", id: "abc", contentHash: evid.hash }]],
      ["unknown ledger operation", [{ type: "LEDGER_OP", key: "NO_SUCH_KEY:1" }]],
      ["duplicate reference", [good[0], good[0]]],
    ];
    for (const [why, refs] of bad) {
      const r = await propose(adminA(), S.id, { reason: "r", evidenceRefs: refs });
      assert.deepEqual([r.status, r.body.code], [422, "EVIDENCE_NOT_VERIFIABLE"], why);
    }
    // evidence of ANOTHER session of the same shape, and a ledger operation of ANOTHER contract
    const other = await heldNoShow();
    const foreign = { type: "EVIDENCE", id: evid.id, contentHash: evid.hash }; // belongs to the second scenario's session
    const foreignOp = { type: "LEDGER_OP", key: evid.ledgerKey };
    const r1 = await propose(adminA(), S.id, { reason: "r", evidenceRefs: [foreign] });
    assert.deepEqual([r1.status, r1.body.code], [422, "EVIDENCE_NOT_VERIFIABLE"], "evidence of another session");
    const r2 = await propose(adminA(), S.id, { reason: "r", evidenceRefs: [foreignOp] });
    assert.deepEqual([r2.status, r2.body.code], [422, "EVIDENCE_NOT_VERIFIABLE"], "a ledger operation of another contract");
    assert.equal(await H.m.prisma.d65bResolution.count(), 0, "nothing was written by any refusal");
    void snap;
    void other;
    void c;
  });
});

// ═════════ 11. reject (four eyes, no money) ═════════
test("T11 REJECT: a second non-party admin rejects a proposal; no money moves, the history is appended, an approval is never altered; the rejected proposal can never be approved; the session can be proposed again", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    assert.equal(p.status, 201);
    const reject = (t: string, body: unknown = { reason: "Bằng chứng chưa đủ", conflictOfInterestDeclaredNone: true }, h: Record<string, string> = {}) => api("POST", `/${p.body.id}/reject`, t, body, h);
    const snap = await footprint(c);
    // refusals write nothing
    const self = await reject(adminA());
    assert.deepEqual([self.status, self.body.code], [403, "SELF_REJECT_FORBIDDEN"]);
    for (const t of [H.tokenFor(c.clientUserId, "ADMIN"), H.tokenFor(c.ptUserId, "ADMIN")]) {
      const r = await reject(t);
      assert.deepEqual([r.status, r.body.code], [403, "CONFLICT_OF_INTEREST"]);
    }
    assert.equal((await reject(adminB(), { reason: "x", conflictOfInterestDeclaredNone: false })).status, 403);
    assert.deepEqual([(await reject(adminB(), { reason: "x", conflictOfInterestDeclaredNone: true, amount: 1 })).status], [400]);
    assert.equal((await reject(H.tokenFor("not-admin-r", "PT"))).status, 403);
    assert.deepEqual(await footprint(c), snap);
    // the reject
    const before = await totals(c);
    const ok = await reject(adminB(), undefined, { "idempotency-key": "rej-1" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.status, ok.body.rejectedBy, ok.body.approvedAt], ["REJECTED", "adm-d65b-B", null]);
    assert.deepEqual(await totals(c), before, "a reject moves no money");
    assert.deepEqual((await footprint(c)).ledger, snap.ledger, "the ledger did not move");
    assert.equal((await rowOf(`PT_NO_SHOW:${S.id}`))?.status, "UNCONFIRMED", "the held row is untouched");
    assert.equal(await rowOf(`UNRESOLVED_SESSION:${S.id}`), null);
    // idempotent: same admin again -> replay; same key -> replay; another admin -> 409
    const again = await reject(adminB());
    assert.deepEqual([again.status, again.body.replayed], [200, true]);
    const keyed = await reject(adminB(), undefined, { "idempotency-key": "rej-1" });
    assert.deepEqual([keyed.status, keyed.headers.get("idempotent-replay")], [200, "true"]);
    const other = await reject(adminC());
    assert.deepEqual([other.status, other.body.code], [409, "PROPOSAL_ALREADY_REJECTED"]);
    // a rejected proposal can never be approved or handed over
    const ap = await approve(adminC(), p.body.id);
    assert.deepEqual([ap.status, ap.body.code], [409, "PROPOSAL_REJECTED"]);
    const ho = await api("POST", `/${p.body.id}/handover`, adminC(), { reason: "x", conflictOfInterestDeclaredNone: true });
    assert.deepEqual([ho.status, ho.body.code], [409, "PROPOSAL_REJECTED"]);
    assert.deepEqual(await totals(c), before);
    // audit: appended, never altered; the database refuses to rewrite or delete it
    const d = await api("GET", `/${p.body.id}`, adminC());
    assert.deepEqual(d.body.history.map((e: any) => [e.action, e.actor]), [["PROPOSED", "adm-d65b-A"], ["REJECTED", "adm-d65b-B"]]);
    const sql = (q: string) => H.m.prisma.$executeRawUnsafe(q);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET rejection_reason = 'changed' WHERE id = '${p.body.id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE d65b_resolutions SET approved_by = 'x', approved_at = now(), approval_reason = 'x' WHERE id = '${p.body.id}'::uuid`), /d65b_rejected_never_approved|violates check|append-only/);
    await assert.rejects(() => sql(`DELETE FROM d65b_resolutions WHERE id = '${p.body.id}'::uuid`), /append-only/);
    // the session is free again: a NEW proposal by another admin, approved, executed ONCE
    const p2 = await propose(adminC(), S.id);
    assert.equal(p2.status, 201, JSON.stringify(p2.body));
    assert.notEqual(p2.body.id, p.body.id);
    const dup = await propose(adminA(), S.id);
    assert.deepEqual([dup.status, dup.body.code], [409, "PROPOSAL_ALREADY_EXISTS"], "one LIVE proposal per session");
    const a = await approve(adminB(), p2.body.id);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE });
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    // an EXECUTED / approved proposal cannot be rejected
    const late = await api("POST", `/${p2.body.id}/reject`, adminA(), { reason: "x", conflictOfInterestDeclaredNone: true });
    assert.deepEqual([late.status, late.body.code], [409, "PROPOSAL_NOT_REJECTABLE"]);
    const list = await api("GET", "", adminC());
    assert.deepEqual(list.body.items.map((i: any) => i.status).sort(), ["EXECUTED", "REJECTED"]);
    await H.invariant("T11");
  });
});

// ═════════ 12. handover when the approver is gone ═════════
test("T12 HANDOVER: a third non-party admin finishes an approved proposal ONLY when the approver is provably gone; one credit, the approval stamp is unchanged, the history names both", { skip }, async () => {
  await scenario(async () => {
    const { c, S } = await heldNoShow();
    const p = await propose(adminA(), S.id);
    // the approval stands but the ledger credit is not confirmed (a lost answer): 202
    const original = H.m.paymentClient.resolveUnresolvedSession.bind(H.m.paymentClient);
    const saved = H.m.paymentClient.resolveUnresolvedSession;
    (H.m.paymentClient as any).resolveUnresolvedSession = async () => {
      throw new Error("timeout of 15000ms exceeded"); // refused before the ledger acts
    };
    let a;
    try {
      a = await approve(adminB(), p.body.id);
    } finally {
      (H.m.paymentClient as any).resolveUnresolvedSession = saved;
      void original;
    }
    assert.equal(a.status, 202, JSON.stringify(a.body));
    const approvedRow = await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } });
    const ho = (t: string, body: unknown = { reason: "Người duyệt đã nghỉ việc", conflictOfInterestDeclaredNone: true }) => api("POST", `/${p.body.id}/handover`, t, body);
    const user = (over: Record<string, unknown>) => async () => ({ data: { user: { id: "adm-d65b-B", ...over } } });
    const patchAuth = (impl: unknown) => H.m.base.patch(H.m.authServiceClient as any, "internalGet", impl);
    const snap = await footprint(c);

    // refusals (nothing written): approver still an active ADMIN; the proposer; a party; no COI; auth-service unreachable; extra body fields
    let restore = patchAuth(user({ role: "ADMIN", isActive: true }));
    try {
      const r = await ho(adminC());
      assert.deepEqual([r.status, r.body.code], [409, "APPROVER_STILL_ACTIVE"]);
    } finally {
      restore();
    }
    restore = patchAuth(user({ role: "CUSTOMER", isActive: true }));
    try {
      const prop = await ho(adminA());
      assert.deepEqual([prop.status, prop.body.code], [403, "SELF_APPROVAL_FORBIDDEN"]);
      for (const t of [H.tokenFor(c.clientUserId, "ADMIN"), H.tokenFor(c.ptUserId, "ADMIN")]) assert.deepEqual([(await ho(t)).status], [403]);
      assert.equal((await ho(adminC(), { reason: "x", conflictOfInterestDeclaredNone: false })).status, 403);
      assert.equal((await ho(adminC(), { reason: "x", conflictOfInterestDeclaredNone: true, amount: 1 })).status, 400);
      assert.equal((await ho(H.tokenFor("not-admin-h", "PT"))).status, 403);
    } finally {
      restore();
    }
    restore = patchAuth(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    try {
      const r = await ho(adminC());
      assert.deepEqual([r.status, r.body.code], [503, "ACCOUNT_LOOKUP_UNAVAILABLE"]);
    } finally {
      restore();
    }
    assert.deepEqual(await footprint(c), snap, "every refusal wrote nothing");

    // the approver's account is gone (404): C takes over and finishes - ONE credit
    restore = patchAuth(async () => {
      throw Object.assign(new Error("not found"), { response: { status: 404 } });
    });
    try {
      const r = await ho(adminC());
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.status, r.body.handedOver, r.body.execution.status, r.body.execution.creditedToClient], ["EXECUTED", true, "EXECUTED", "250000.00"]);
      // idempotent: C again -> the finished state, nothing more is paid, the HANDED_OVER event exists once
      const again = await ho(adminC());
      assert.equal(again.status, 200);
      assert.deepEqual(again.body.execution.replayed, true);
    } finally {
      restore();
    }
    assert.deepEqual(await totals(c), { client: 1_000_000, pt: 0, platform: 0, pending: 0, sum: PRICE });
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    const after = await H.m.prisma.d65bResolution.findUniqueOrThrow({ where: { id: p.body.id } });
    assert.deepEqual([after.approvedBy, after.approvedAt?.toISOString(), after.approvalReason], [approvedRow.approvedBy, approvedRow.approvedAt?.toISOString(), approvedRow.approvalReason], "the approval stamp is unchanged");
    const d = await api("GET", `/${p.body.id}`, adminA());
    const hist = d.body.history.map((e: any) => e.action);
    assert.equal(hist.filter((x: string) => x === "HANDED_OVER").length, 1);
    assert.deepEqual(hist.filter((x: string) => x === "APPROVED").length, 1);
    const handed = (await H.m.prisma.d65bResolutionEvent.findFirstOrThrow({ where: { resolutionId: p.body.id, action: "HANDED_OVER" } }));
    assert.equal(handed.actorUserId, "adm-d65b-C");
    assert.equal((handed.payload as any).detail.previousApprover, "adm-d65b-B");
    assert.equal(await notices(c.clientUserId, S.id), 1);
    await H.invariant("T12");
  });
});
