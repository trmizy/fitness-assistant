/**
 * LATE-OPEN HARD BOUNDARY - an approved ELIGIBLE_CURRENT_POLICY review must NOT open the ledger's OPEN-L door while DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED is off. REAL payment-service child.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): the real user-service app in this process, payment-service a real child on an isolated *_test database, money read from the REAL ledger.
 * TEST FIXTURES named where used (the policy review = the harness default for a contract, the OPEN obligation = the real record-only door with the ledger down at the sweep, WAIVED set by SQL).
 *
 * The two layers under test:
 *   1. user-service lateOpenGate: flag OFF => settle:false whatever the review says (contested still HOLDs - unchanged).
 *   2. payment-service settleLateOpen: the only place OPEN-L money moves refuses LATE_OPEN_FLAG_REQUIRED unless its own fail-closed switch is effective - so even a body settleLateOpen:true is refused.
 *
 * Numbers (hand): 1.000.000 / 4 sessions, V = 250.000, L = 125.000, PT 90% / platform 10%.
 *   L untouched, session parked   -> client 0 / PT 0 / platform 0 / pending 1.000.000
 *   L paid inside the release     -> client 125.000 / PT 112.500 / platform 12.500 / pending 750.000
 *   L paid inside the no-show     -> client 250.000 / PT 0 / platform 0 / pending 750.000
 *
 *   A  flag OFF + approved ELIGIBLE review + L OPEN + the sweep (COMPLETED and NO_SHOW): no L paid, obligation OPEN, no PAID_VIA_LEDGER event, step parked NEEDS_HUMAN, quota right and unchanged by the sweeps
 *   B  flag OFF, retry / replay with the same idempotency key, the settlement sweep twice: still nothing
 *   B2 flag OFF, a caller that FORCES settleLateOpen:true on the real payment client (release and no-show): the real ledger refuses with the "disabled" wording, nothing written
 *   C  flag OFF, Admin late-open POST on a review-bearing contract: 409 LATE_OPEN_RECONCILIATION_DISABLED, nothing changes
 *   D  flag OFF does not block the ordinary money: D77 SETTLED in cash, L WAIVED, L already PAID_VIA_LEDGER (a second session of the same contract)
 *   F  CONTROL: the same scenario as A with the flag ON (user-service and payment child both) DOES pay, so A can really fail
 *
 * Opt-in; run ALONE:  RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... SETTLEMENT_INFLIGHT_WAIT_MS=300 \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-late-open-hard-boundary.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";
import { DISPUTE_CASE_FLAGS, lateOpenReconciliationEnabled } from "../services/dispute-case/flags";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const FLAG = DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION;
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const BASE = "/admin/late-open-reconciliations";
const OPEN_L = [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: L, paid: 0, unpaid: L }];
const UNTOUCHED = { client: 0, pt: 0, platform: 0, pending: PRICE, sum: PRICE };

let H: Harness;
/** The flag lives in TWO processes: this one (user-service) and the payment child, which reads its environment when it is spawned. Setting it therefore restarts the child. */
async function setFlag(on: boolean) {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
  await H.stopPayment();
  await H.startPayment();
}
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  delete process.env[FLAG];
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
  delete process.env[FLAG];
  if (H) await H.close();
});

// ── kit ──────────────────────────────────────────────────────────────────────

async function scenario(flag: boolean, fn: () => Promise<void>) {
  await H.resetPayment();
  await setFlag(flag);
  try {
    await fn();
  } finally {
    await setFlag(false).catch(() => {});
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
async function settleEvents(txnId: string) {
  return ((await H.payDb.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM contract_unpaid_obligation_events e JOIN contract_unpaid_obligations o ON o.id = e.obligation_id WHERE o.transaction_id = $1 AND e.action::text = 'SETTLE_VIA_LEDGER'`,
    txnId,
  )) as any[])[0].n as number;
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
const lateTableCounts = async () => ({
  proposals: await H.m.prisma.lateOpenReconciliation.count(),
  events: await H.m.prisma.lateOpenReconciliationEvent.count(),
  recoveries: await H.m.prisma.lateOpenRecovery.count(),
});

type Outcome = "COMPLETED" | "NO_SHOW";
type D77 = "SETTLED" | "OPEN";
interface Fx {
  c: PaidContract;
  S: { id: string };
}
const stepKindOf = (o: Outcome) => (o === "COMPLETED" ? "SESSION_RELEASE" : "PT_NO_SHOW_COMPENSATION");
/** A contract WITH an approved ELIGIBLE_CURRENT_POLICY review (the harness default = TEST FIXTURE) and one late session. OPEN = the ledger was down at the sweep, so the REAL record-only door wrote the OPEN obligation
 *  (the UNCONFIRMED status of the sweep row is the TEST FIXTURE that lets it run); SETTLED = L was paid in cash at the sweep. */
async function build(d77: D77, outcome: Outcome): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
  assert.equal(await H.m.prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: c.id, result: "ELIGIBLE_CURRENT_POLICY", approvedAt: { not: null } } }), 1, "precondition: the contract has an approved ELIGIBLE review");
  const S = await lateSession(c);
  if (d77 === "OPEN") await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  if (d77 === "OPEN") {
    await H.startPayment();
    const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
    assert.notEqual(row.status, "SETTLED");
    await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
    assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  }
  const late = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  assert.equal(late.status, "SETTLED", "the D77 step is SETTLED (paid L, or the OPEN obligation is recorded)");
  if (outcome === "NO_SHOW") await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } }); // TEST FIXTURE: the PT admits the absence on a CONFIRMED session
  return { c, S };
}
async function act(fx: Fx, outcome: Outcome) {
  const r = outcome === "COMPLETED" ? await H.call("POST", `/sessions/${fx.S.id}/confirm`, fx.c.clientToken) : await H.call("PATCH", `/sessions/${fx.S.id}/no-show`, fx.c.ptToken, {});
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
}
async function counters(fx: Fx) {
  const s = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
  return { session: s.status, deducted: s.sessionDeducted, contract: k.status, used: k.usedSessions, compensated: k.compensatedSessions };
}
const QUOTA = (o: Outcome) =>
  o === "COMPLETED" ? { session: "COMPLETED", deducted: true, contract: "ACTIVE", used: 1, compensated: 0 } : { session: "NO_SHOW", deducted: false, contract: "ACTIVE", used: 0, compensated: 1 };
/** Everything that must not change while the door is closed (the settlement row's attempt counters are compared separately where a retry is the point). */
async function frozen(fx: Fx) {
  return {
    counters: await counters(fx),
    obligations: await obligations(fx.c.txnId),
    totals: await totals(fx.c),
    settleEvents: await settleEvents(fx.c.txnId),
    ledger: await H.snapshot(),
    late: await lateTableCounts(),
  };
}
const admin = () => {
  const id = `adm-${randomUUID()}`;
  return { id, token: H.tokenFor(id, "ADMIN") };
};
async function post(path: string, token: string, body: unknown) {
  const res = await fetch(H.userUrl + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
/** Wraps a paymentClient method so the body ALWAYS carries settleLateOpen:true - a caller that bypasses the user-service gate. */
function forceFlag(method: "releaseSession" | "noShow") {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  const seen: boolean[] = [];
  pc[method] = async function (body: Record<string, unknown>) {
    seen.push(body.settleLateOpen === true);
    return original.call(this, { ...body, settleLateOpen: true });
  };
  return { sent: () => seen, restore: () => (pc[method] = original) };
}

// ═════════════════════ A. flag OFF + approved review + OPEN L + sweep ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`A ${outcome}: flag OFF, approved ELIGIBLE review, L OPEN - the session changes state, NO L is paid, the obligation stays OPEN, no PAID_VIA_LEDGER event, the step is parked, the sweeps change nothing`, { skip }, async () => {
    await scenario(false, async () => {
      assert.equal(lateOpenReconciliationEnabled(), false, "precondition: the flag is off");
      const fx = await build("OPEN", outcome);
      assert.deepEqual(await totals(fx.c), UNTOUCHED);
      await act(fx, outcome);
      const kind = stepKindOf(outcome);
      assert.deepEqual(await counters(fx), QUOTA(outcome), "session rights are booked at the terminal change, with or without the money");
      assert.deepEqual(await totals(fx.c), UNTOUCHED, "not a cent moved: pending still holds the whole price");
      assert.deepEqual(await obligations(fx.c.txnId), OPEN_L);
      assert.equal(await settleEvents(fx.c.txnId), 0, "no PAID_VIA_LEDGER settlement event");
      assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 0, "the ledger wrote nothing for the step");
      const row = (await stepRow(fx.c.id, kind))!;
      assert.equal(row.status, "NEEDS_HUMAN");
      assert.match(row.lastError ?? "", /^NEEDS_RECONCILIATION: .*LATE_OPEN_FLAG_REQUIRED/);
      assert.equal(row.attempts, 1);
      assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: false }, "the review does NOT give settleLateOpen while the flag is off");
      const before = await frozen(fx);
      await drain(fx.c.id, 4);
      const again = (await stepRow(fx.c.id, kind))!;
      assert.deepEqual([again.status, again.attempts], ["NEEDS_HUMAN", 1], "no automatic retry");
      assert.deepEqual(await frozen(fx), before, "sweeps: quota, obligation, wallets, ledger snapshot, late-open tables identical");
      await H.invariant(`A ${outcome}`);
    });
  });
}

// ═════════════════════ B. retry / replay with the same idempotency key ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`B ${outcome}: flag OFF, the parked step is re-opened (TEST FIXTURE: row -> PENDING) and the settlement sweep runs twice with the SAME key - refused again each time, nothing written`, { skip }, async () => {
    await scenario(false, async () => {
      const fx = await build("OPEN", outcome);
      await act(fx, outcome);
      const kind = stepKindOf(outcome);
      const key = (await stepRow(fx.c.id, kind))!.idempotencyKey;
      const before = await frozen(fx);
      for (let round = 1; round <= 2; round++) {
        await H.m.prisma.sessionSettlement.update({ where: { idempotencyKey: key }, data: { status: "PENDING", lastError: null, nextAttemptAt: null } });
        const calls = H.m.paymentClient as any;
        const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
        const original = calls[method];
        let n = 0;
        calls[method] = async function (...a: unknown[]) {
          n++;
          return original.apply(this, a);
        };
        try {
          await runSettlementSweep();
          await runSettlementSweep();
        } finally {
          calls[method] = original;
        }
        assert.ok(n >= 1, `round ${round}: the sweep really sent the step to the ledger again (${n} call(s))`);
        const row = (await stepRow(fx.c.id, kind))!;
        assert.equal(row.idempotencyKey, key, "same idempotency key");
        assert.equal(row.status, "NEEDS_HUMAN", `round ${round}`);
        assert.match(row.lastError ?? "", /LATE_OPEN_FLAG_REQUIRED/);
        assert.deepEqual(await frozen(fx), before, `round ${round}: nothing moved`);
      }
      await H.invariant(`B ${outcome}`);
    });
  });
}

// ═════════════════════ B2. the user-service gate is bypassed: settleLateOpen:true forced on the real client ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`B2 ${outcome}: flag OFF, a caller FORCES settleLateOpen:true on the real payment client - the REAL ledger refuses LATE_OPEN_FLAG_REQUIRED ("disabled"), nothing is written, the step is parked`, { skip }, async () => {
    await scenario(false, async () => {
      const fx = await build("OPEN", outcome);
      const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
      const forced = forceFlag(method);
      try {
        await act(fx, outcome);
        await drain(fx.c.id, 2);
      } finally {
        forced.restore();
      }
      assert.ok(forced.sent().length >= 1, "the ledger call was made");
      assert.ok(forced.sent().every((v) => v === false), "the gate itself sent NO flag (the test forced it on top, below the gate)");
      const row = (await stepRow(fx.c.id, stepKindOf(outcome)))!;
      assert.equal(row.status, "NEEDS_HUMAN");
      assert.match(row.lastError ?? "", /LATE_OPEN_FLAG_REQUIRED/);
      assert.match(row.lastError ?? "", /disabled/, "the refusal is the ledger's own switch, not the missing body flag");
      assert.deepEqual(await totals(fx.c), UNTOUCHED);
      assert.deepEqual(await obligations(fx.c.txnId), OPEN_L);
      assert.equal(await settleEvents(fx.c.txnId), 0);
      assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 0);
      assert.deepEqual(await counters(fx), QUOTA(outcome));
      await H.invariant(`B2 ${outcome}`);
    });
  });
}

// ═════════════════════ C. Admin reconciliation POST while the flag is off ═════════════════════
test("C flag OFF, review-bearing contract with a parked step: the Admin late-open POSTs (claim, propose) answer 409 LATE_OPEN_RECONCILIATION_DISABLED, nothing changes", { skip }, async () => {
  await scenario(false, async () => {
    const fx = await build("OPEN", "COMPLETED");
    await act(fx, "COMPLETED");
    const row = (await stepRow(fx.c.id, "SESSION_RELEASE"))!;
    const before = await frozen(fx);
    const A = admin();
    for (const [name, path, body] of [
      ["claim", `${BASE}/${row.id}/claim`, {}],
      ["propose", `${BASE}/${row.id}/proposals`, { reason: "Khách xác nhận PT vào muộn", verificationNote: "Đã đối chiếu nhật ký phòng", evidenceRefs: ["room-log:x"], policyBasis: "Khoản L của đúng buổi này" }],
      ["approve", `${BASE}/proposals/${randomUUID()}/approve`, { reason: "ok", conflictOfInterestDeclaredNone: true }],
    ] as Array<[string, string, unknown]>) {
      const r = await post(path, A.token, body);
      assert.deepEqual([name, r.status, r.body?.code], [name, 409, "LATE_OPEN_RECONCILIATION_DISABLED"], JSON.stringify(r.body));
    }
    assert.deepEqual(await frozen(fx), before);
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))!.status, "NEEDS_HUMAN");
    await H.invariant("C");
  });
});

// ═════════════════════ D. the ordinary money is NOT blocked by the closed door ═════════════════════
test("D1 flag OFF, D77 SETTLED in cash (L 125.000 paid at the sweep), approved review: the release pays the normal V-L - client 125.000 / PT 112.500 / platform 12.500 / pending 750.000", { skip }, async () => {
  await scenario(false, async () => {
    const fx = await build("SETTLED", "COMPLETED");
    assert.equal((await totals(fx.c)).client, L, "L was paid in cash at the sweep");
    assert.deepEqual(await obligations(fx.c.txnId), [], "no obligation: nothing OPEN");
    await act(fx, "COMPLETED");
    assert.deepEqual(await counters(fx), QUOTA("COMPLETED"));
    assert.deepEqual(await totals(fx.c), { client: L, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    await H.invariant("D1");
  });
});
test("D2 flag OFF, L WAIVED (TEST FIXTURE: the FH-8 waive set by SQL), approved review: the release pays the whole V - PT 225.000 / platform 25.000, nothing to the client", { skip }, async () => {
  await scenario(false, async () => {
    const fx = await build("OPEN", "COMPLETED");
    await H.payDb.$executeRawUnsafe(`UPDATE contract_unpaid_obligations SET status = 'WAIVED' WHERE transaction_id = $1`, fx.c.txnId);
    await act(fx, "COMPLETED");
    assert.deepEqual(await counters(fx), QUOTA("COMPLETED"));
    assert.deepEqual(await totals(fx.c), { client: 0, pt: 225_000, platform: 25_000, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    assert.equal(await settleEvents(fx.c.txnId), 0);
    await H.invariant("D2");
  });
});
test("D3 flag OFF, L already PAID_VIA_LEDGER (paid while the flag was ON): a second, ordinary session of the same contract is released normally - PT +225.000 / platform +25.000", { skip }, async () => {
  await scenario(true, async () => {
    const fx = await build("OPEN", "COMPLETED");
    await act(fx, "COMPLETED");
    assert.deepEqual(await totals(fx.c), { client: L, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE }, "flag ON: L paid inside the release");
    assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    await setFlag(false); // the switch goes off in BOTH processes
    assert.equal(lateOpenReconciliationEnabled(), false);
    const T = Date.now();
    const S2 = await H.m.base.addSession(fx.c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
    const r = await H.call("POST", `/sessions/${S2.id}/confirm`, fx.c.clientToken);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.deepEqual(await totals(fx.c), { client: L, pt: 337_500, platform: 37_500, pending: 500_000, sum: PRICE });
    assert.equal(await opCount(`SESSION_RELEASE:${S2.id}`), 1);
    assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    assert.equal(await settleEvents(fx.c.txnId), 1, "still exactly one settlement event");
    await H.invariant("D3");
  });
});

// ═════════════════════ F. CONTROL: the flag ON pays ═════════════════════
test("F COMPLETED CONTROL: the same scenario as A with the flag ON (user-service and payment child) pays L inside the release - client 125.000 / PT 112.500 / platform 12.500 / pending 750.000, PAID_VIA_LEDGER", { skip }, async () => {
  await scenario(true, async () => {
    assert.equal(lateOpenReconciliationEnabled(), true, "the flag is effective in this process");
    const fx = await build("OPEN", "COMPLETED");
    assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: true });
    await act(fx, "COMPLETED");
    assert.deepEqual(await counters(fx), QUOTA("COMPLETED"));
    assert.deepEqual(await totals(fx.c), { client: L, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE });
    assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    assert.equal(await settleEvents(fx.c.txnId), 1);
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    await H.invariant("F COMPLETED");
  });
});
test("F NO_SHOW CONTROL: the same scenario with the flag ON pays the client V inside the no-show - client 250.000 / PT 0 / platform 0 / pending 750.000, PAID_VIA_LEDGER", { skip }, async () => {
  await scenario(true, async () => {
    const fx = await build("OPEN", "NO_SHOW");
    await act(fx, "NO_SHOW");
    assert.deepEqual(await counters(fx), QUOTA("NO_SHOW"));
    assert.deepEqual(await totals(fx.c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "PAID_VIA_LEDGER", owed: L, paid: L, unpaid: 0 }]);
    assert.equal((await stepRow(fx.c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    await H.invariant("F NO_SHOW");
  });
});
