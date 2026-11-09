/**
 * LATE-OPEN RECONCILIATION - FAIL-CLOSED FEATURE FLAG (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED), flag UNSET. REAL payment-service.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service). TEST FIXTURES named where used: the OPEN obligation (real record-only door, as in the other late-open suites), the ledger failure seam (a wrapper on
 * paymentClient that throws BEFORE the request reaches the ledger), and - in F2 - the row state that stands in for "the process died right after the reopen" (set by SQL, labelled where it happens).
 *
 *   F1  flag OFF: all 9 POST routes answer 409 LATE_OPEN_RECONCILIATION_DISABLED (also a repeat with the same Idempotency-Key); no row in the 3 late-open tables; session, quota, settlement row,
 *       obligation, wallets and ledger snapshot are identical; the GET list / item stay 200.
 *   F2  an approval stored while the flag was ON, then the flag goes OFF: the retry route is refused; the settlement sweep runs several ticks; the obligation stays OPEN, nothing is paid, the row is not
 *       settled; the gate (lateOpenGate) gives no settleLateOpen. Control: the same row with the flag back ON is settled by the sweep (so the test can fail).
 *   F3  (pure unit, no database) the value "true" is ignored with NODE_ENV=production and with DB_ISOLATION not accepted; "TRUE", "1", "true " are ignored.
 *
 * Opt-in; run ALONE (same command shape as the other cross-service files).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";
import { DISPUTE_CASE_FLAGS, __resetFlagWarnings, flagVerdict, lateOpenReconciliationEnabled } from "../services/dispute-case/flags";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const FLAG = DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION;
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const BASE = "/admin/late-open-reconciliations";
const PAID = { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE };
const flagOn = () => {
  process.env[FLAG] = "true";
};
const flagOff = () => {
  delete process.env[FLAG];
};

let H: Harness;
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  flagOff();
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
  flagOff();
  if (H) await H.close();
});

// ── kit ──────────────────────────────────────────────────────────────────────

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  flagOff();
  try {
    await fn();
  } finally {
    flagOff();
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
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const rowsOf = (contractId: string) => H.m.prisma.sessionSettlement.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
const stepRow = async (contractId: string, kind: string) => (await rowsOf(contractId)).find((r) => r.kind === kind);
const lateTableCounts = async () => ({
  proposals: await H.m.prisma.lateOpenReconciliation.count(),
  events: await H.m.prisma.lateOpenReconciliationEvent.count(),
  recoveries: await H.m.prisma.lateOpenRecovery.count(),
});

/** TEST FIXTURE: COMPLETED session of an ordinary contract with L OPEN (real record-only door); the client's confirmation was refused by the ledger -> SESSION_RELEASE parked NEEDS_HUMAN. */
async function buildParked(): Promise<{ c: PaidContract; S: { id: string }; rowId: string }> {
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
  assert.equal((await H.call("POST", `/sessions/${S.id}/confirm`, c.clientToken)).status, 200);
  const step = (await stepRow(c.id, "SESSION_RELEASE"))!;
  assert.equal(step.status, "NEEDS_HUMAN");
  assert.match(step.lastError ?? "", /LATE_OPEN_FLAG_REQUIRED/);
  return { c, S, rowId: step.id };
}
/** Everything that must not change while the flag is off. */
async function state(c: PaidContract, S: { id: string }) {
  const s = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const rows = (await rowsOf(c.id)).map((r) => ({ id: r.id, kind: r.kind, status: r.status, attempts: r.attempts, lastError: r.lastError, settledAt: r.settledAt?.toISOString() ?? null }));
  return {
    session: s.status,
    contract: [k.status, k.usedSessions, k.compensatedSessions],
    rows,
    obligations: await obligations(c.txnId),
    totals: await totals(c),
    ledger: await H.snapshot(),
    late: await lateTableCounts(),
  };
}

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
  verificationNote: "Đã đối chiếu nhật ký phòng học: PT vào phòng sau 16 phút",
  evidenceRefs: ["room-log:session-room-joins"],
  policyBasis: "Khoản L của đúng buổi này là nghĩa vụ OPEN trong sổ cái; người đề xuất xác nhận việc đi muộn bằng nhật ký phòng",
};
const APPROVE = { reason: "Đã kiểm tra lại bằng chứng, đồng ý", conflictOfInterestDeclaredNone: true };
const REJECT = { reason: "Không đủ bằng chứng" };
const RECOVERY = { reason: "Đề xuất đã duyệt nhưng hết lượt thực thi; cần xem lại sổ cái" };
const HANDOVER = (to: string) => ({ newAssigneeId: to, reason: "Chuyển người phụ trách" });

function failing(method: string, mode: "before", times: number) {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  let n = 0;
  pc[method] = async function (...args: unknown[]) {
    n++;
    if (n <= times) throw new Error("simulated: payment-service never saw the request");
    return original.apply(this, args);
  };
  void mode;
  return { calls: () => n, restore: () => (pc[method] = original) };
}

// ═════════════════════ F1. every POST route is refused while the flag is OFF ═════════════════════
test("F1 flag UNSET: all 9 POST routes answer 409 LATE_OPEN_RECONCILIATION_DISABLED (also an Idempotency-Key repeat); no row in the 3 late-open tables; nothing else moved; GET list / item still 200", { skip }, async () => {
  await scenario(async () => {
    const { c, S, rowId } = await buildParked();
    assert.equal(lateOpenReconciliationEnabled(), false, "precondition: the flag is off");
    const A = admin();
    const before = await state(c, S);
    assert.deepEqual(before.late, { proposals: 0, events: 0, recoveries: 0 });
    assert.deepEqual(before.obligations, [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: L, paid: 0, unpaid: L }]);

    const ghost = randomUUID();
    const routes: Array<[string, string, unknown]> = [
      ["claim", `${BASE}/${rowId}/claim`, {}],
      ["propose", `${BASE}/${rowId}/proposals`, PROPOSAL],
      ["handover", `${BASE}/${rowId}/handover`, HANDOVER("adm-other")],
      ["approve", `${BASE}/proposals/${ghost}/approve`, APPROVE],
      ["reject", `${BASE}/proposals/${ghost}/reject`, REJECT],
      ["retry", `${BASE}/proposals/${ghost}/retry`, {}],
      ["openRecovery", `${BASE}/proposals/${ghost}/recoveries`, RECOVERY],
      ["approveRecovery", `${BASE}/recoveries/${ghost}/approve`, APPROVE],
      ["rejectRecovery", `${BASE}/recoveries/${ghost}/reject`, REJECT],
    ];
    assert.equal(routes.length, 9);
    for (const [name, path, body] of routes) {
      const r = await req("POST", path, A.token, body);
      assert.deepEqual([name, r.status, r.body?.code], [name, 409, "LATE_OPEN_RECONCILIATION_DISABLED"], JSON.stringify(r.body));
      assert.equal(typeof r.body.error, "string");
      // the refusal comes before the body is even read: an invalid body gets the same answer
      const bad = await req("POST", path, A.token, { junk: true });
      assert.deepEqual([name, bad.status, bad.body?.code], [name, 409, "LATE_OPEN_RECONCILIATION_DISABLED"]);
    }
    // repeat with the same Idempotency-Key: refused every time, nothing stored under the key
    const key = `k-${randomUUID()}`;
    for (const [name, path, body] of routes) {
      for (let i = 0; i < 2; i++) {
        const r = await req("POST", path, A.token, body, { "Idempotency-Key": key });
        assert.deepEqual([name, i, r.status, r.body?.code], [name, i, 409, "LATE_OPEN_RECONCILIATION_DISABLED"]);
        assert.equal(r.headers.get("idempotent-replay"), null, "a refusal is not an idempotent replay");
      }
    }

    assert.deepEqual(await state(c, S), before, "session, quota, settlement row, obligation, wallets, ledger snapshot and the 3 late-open tables are identical");
    // reads stay open
    const list = await req("GET", `${BASE}`, A.token);
    assert.equal(list.status, 200, JSON.stringify(list.body).slice(0, 300));
    const item = await req("GET", `${BASE}/${rowId}`, A.token);
    assert.equal(item.status, 200, JSON.stringify(item.body).slice(0, 300));
    await H.invariant("F1");
  });
});

// ═════════════════════ F2. a stored approval does nothing while the flag is OFF ═════════════════════
test("F2 an approval stored while the flag was ON, then the flag OFF: retry refused, the settlement sweep (several ticks) gives no settleLateOpen - obligation stays OPEN, no money, row not settled; control: flag back ON settles it", { skip }, async () => {
  await scenario(async () => {
    const { c, S, rowId } = await buildParked();
    // flag ON only to store the approval through the real API; the ledger fails BEFORE reaching payment-service, so the approval stands unexecuted
    flagOn();
    const seam = failing("releaseSession", "before", 1);
    const A = admin();
    const B = admin();
    let id: string;
    try {
      assert.equal((await req("POST", `${BASE}/${rowId}/claim`, A.token, {})).status, 200);
      const proposed = await req("POST", `${BASE}/${rowId}/proposals`, A.token, PROPOSAL);
      assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
      id = proposed.body.reconciliationId as string;
      const approved = await req("POST", `${BASE}/proposals/${id}/approve`, B.token, APPROVE);
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.execution.status, "FAILED");
    } finally {
      seam.restore();
    }
    const stored = await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } });
    assert.ok(stored.approvedAt && stored.outcome === null, "the approval is stored and not consumed");
    assert.deepEqual(await H.m.payout.lateOpenGate(S.id), { settle: true }, "flag ON: the stored approval is what the gate reads (control)");

    // ── flag OFF from here ──
    flagOff();
    assert.equal(lateOpenReconciliationEnabled(), false);
    assert.deepEqual(await H.m.payout.lateOpenGate(S.id), { settle: false }, "flag OFF: the stored approval gives no settleLateOpen");
    const retry = await req("POST", `${BASE}/proposals/${id}/retry`, B.token, {});
    assert.deepEqual([retry.status, retry.body.code], [409, "LATE_OPEN_RECONCILIATION_DISABLED"]);

    // TEST FIXTURE (SQL): the state of a row whose reopen succeeded and whose process then died - PENDING, so that the sweep WOULD run it
    await H.m.prisma.sessionSettlement.update({ where: { id: rowId }, data: { status: "PENDING", lastError: null, nextAttemptAt: null } });
    const calls = failing("releaseSession", "before", 0); // counts the ledger calls the sweep makes
    const snap0 = await H.snapshot();
    const tot0 = await totals(c);
    const obl0 = await obligations(c.txnId);
    const used0 = (await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions;
    try {
      await drain(c.id, 4);
    } finally {
      calls.restore();
    }
    const after = await stepRow(c.id, "SESSION_RELEASE");
    assert.notEqual(after?.status, "SETTLED", "the row is not settled");
    assert.deepEqual(await obligations(c.txnId), obl0);
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: L, paid: 0, unpaid: L }], "still OPEN, no PAID_VIA_LEDGER");
    assert.deepEqual(await totals(c), tot0);
    assert.deepEqual(await totals(c), { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE }, "no money moved");
    assert.deepEqual(await H.snapshot(), snap0, "wallets / entries / operations / receivables unchanged");
    assert.equal(await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `SESSION_RELEASE:${S.id}`).then((r: any) => r[0].n), 0, "no SESSION_RELEASE ledger operation");
    assert.equal((await H.m.prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id } })).outcome, null, "the approval was not consumed");
    assert.deepEqual((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, used0, "the quota did not move");
    await H.invariant("F2 flag off");

    // ── control: flag back ON, same stored approval, same sweep -> it settles ──
    flagOn();
    await H.stopPayment(); // the payment-service child reads the flag when it is spawned: restart it so it sees the flag ON too (hard boundary of the ledger)
    await H.startPayment();
    await H.m.prisma.sessionSettlement.update({ where: { id: rowId }, data: { status: "PENDING", lastError: null, nextAttemptAt: null } });
    await drain(c.id, 4);
    assert.equal((await stepRow(c.id, "SESSION_RELEASE"))?.status, "SETTLED", "control: with the flag ON the stored approval is consumed by the sweep");
    assert.deepEqual(await obligations(c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    assert.deepEqual(await totals(c), PAID);
    await H.invariant("F2 control");
  });
});

// ═════════════════════ F3. the flag rule (pure unit, no database) ═════════════════════
test("F3 the value 'true' is ignored with NODE_ENV=production and with DB_ISOLATION not accepted; 'TRUE', '1', 'true ' are ignored", () => {
  const ok = { [FLAG]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as NodeJS.ProcessEnv;
  assert.equal(flagVerdict(FLAG, ok).effective, true);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    __resetFlagWarnings();
    for (const [label, env] of [
      ["unset", { ...ok, [FLAG]: undefined }],
      ["TRUE", { ...ok, [FLAG]: "TRUE" }],
      ["1", { ...ok, [FLAG]: "1" }],
      ["'true '", { ...ok, [FLAG]: "true " }],
      ["NODE_ENV production", { ...ok, NODE_ENV: "production" }],
      ["NODE_ENV unset", { ...ok, NODE_ENV: undefined }],
      ["NODE_ENV development", { ...ok, NODE_ENV: "development" }],
      ["DB_ISOLATION refused", { ...ok, DB_ISOLATION: "refused" }],
      ["DB_ISOLATION unset", { ...ok, DB_ISOLATION: undefined }],
    ] as Array<[string, NodeJS.ProcessEnv]>) {
      assert.equal(flagVerdict(FLAG, env).effective, false, label);
    }
    assert.equal(flagVerdict(FLAG, { ...ok, NODE_ENV: "production" }).refusedBecause, "NOT_TEST_ENV");
    assert.equal(flagVerdict(FLAG, { ...ok, DB_ISOLATION: "refused" }).refusedBecause, "DB_ISOLATION_NOT_ACCEPTED");
  } finally {
    console.warn = realWarn;
  }
  // the real accessor reads process.env on every call
  const saved = { flag: process.env[FLAG], env: process.env.NODE_ENV, iso: process.env.DB_ISOLATION };
  console.warn = () => {};
  try {
    process.env[FLAG] = "true";
    process.env.NODE_ENV = "test";
    process.env.DB_ISOLATION = "accepted";
    assert.equal(lateOpenReconciliationEnabled(), true);
    process.env.NODE_ENV = "production";
    assert.equal(lateOpenReconciliationEnabled(), false);
    process.env.NODE_ENV = "test";
    process.env.DB_ISOLATION = "refused";
    assert.equal(lateOpenReconciliationEnabled(), false);
    process.env.DB_ISOLATION = "accepted";
    for (const v of ["TRUE", "1", "true ", ""]) {
      process.env[FLAG] = v;
      assert.equal(lateOpenReconciliationEnabled(), false, `value '${v}'`);
    }
  } finally {
    console.warn = realWarn;
    for (const [k, v] of [[FLAG, saved.flag], ["NODE_ENV", saved.env], ["DB_ISOLATION", saved.iso]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
