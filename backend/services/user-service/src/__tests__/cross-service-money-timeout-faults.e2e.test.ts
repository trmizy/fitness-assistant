/**
 * D57 items 2 + 4 - FAULT INJECTION on every user-service -> payment-service money call, with the REAL payment ledger.
 * "Payment committed but user-service did not learn it" and "timeout + retry never moves money twice".
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated test databases. The FAULTS are injected at the user-service HTTP client
 * (an axios adapter wrapped around the real one, see `faults`):
 *   LOSE_RESPONSE  the request is really sent and really COMMITS in payment-service, then user-service sees a timeout
 *   DROP_BEFORE    the request is never sent (payment-service down / connection refused)
 *   LATE           the request is sent but user-service gives up at once (a timeout while payment-service is still working);
 *                  the commit lands later, the caller has already moved on
 * and, for the DB, `pg_terminate_backend` on the connection that holds the contract's advisory lock (what a crash / failover /
 * pod restart does to the lock transaction).
 * TEST FIXTURE: contract row + signed gateway IPN, session rows at their starting state, auth-service token table
 * (see cross-service-money.harness.ts).
 *
 * Phase 0 (D58/D59/D63): the 13 tests that used to be named [DEFECT] (they PASSED because the defect was present) are now
 * REGRESSION tests asserting the CORRECT behaviour - named [REGRESSION ...] with the defect they were. What the code now does:
 *   - the decision of a session money step (status CAS + counters + settlement intent row) commits in ONE short transaction;
 *     the payment-service call is made AFTER it, with no advisory lock and no transaction open; the bookkeeping
 *     (releasedTo*, compensatedSessions) is applied in the transaction that flips the row to SETTLED (apply-once);
 *   - an ending is RECORDED (CONTRACT_TERMINATION intent row, recorded reason) before the money call; until payment-service
 *     confirms it, the contract is ENDING: money-changing actions answer 409 CONTRACT_ENDING, the ending is carried through by a
 *     retry or by the settlement sweep with the SAME reason.
 * One test keeps the label [KNOWN-DEFECT]: payment-service's key semantics (Phase 2, payment-service is out of scope of Phase 0).
 * A test named [SAFE] pins a behaviour that was and is correct.
 *
 * Opt-in; run ALONE against YOUR OWN isolated databases:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_to_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_to_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-timeout-faults.e2e.test.ts
 *
 * Money (price 5,000,000 / 10 sessions; a session = 500,000 = PT 450,000 + platform 50,000; no gym; holdback off;
 * client cancel refunds 90% of the unused value): 2 delivered + client cancel => refund 3,600,000.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError } from "axios";
import { PrismaClient } from "../generated/prisma";
import { DAY, HOUR, PAYMENT_DB_URL, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

let H: Harness;
let payDb: PrismaClient;
test.before(async () => {
  if (skip) return;
  H = await startHarness();
  payDb = new PrismaClient({ datasourceUrl: PAYMENT_DB_URL });
  installFaults();
});
test.after(async () => {
  if (H) await H.close();
  if (payDb) await payDb.$disconnect();
});

const PT_UNIT = 450_000;
const PLAT_UNIT = 50_000;
const ADMIN = "admin-timeout-faults";
const show = (label: string, o: Record<string, unknown>) => console.log(`[FAULT-MONEY] ${label} ${JSON.stringify(o)}`);

// ── fault injection at the HTTP client ──────────────────────────────────────────────────────────────────────────────
type Mode = "LOSE_RESPONSE" | "DROP_BEFORE" | "LATE" | "PASS";
interface Rule {
  match: RegExp;
  mode: Mode;
  times: number;
  /** Runs right before the request would be sent (e.g. kill the lock connection). */
  before?: () => Promise<void>;
  hits: number;
  inFlight: Promise<unknown>[];
}
const rules: Rule[] = [];
const faults = {
  add(match: RegExp, mode: Mode, opts: { times?: number; before?: () => Promise<void> } = {}) {
    const r: Rule = { match, mode, times: opts.times ?? 1, before: opts.before, hits: 0, inFlight: [] };
    rules.push(r);
    return r;
  },
  clear() {
    rules.length = 0;
  },
};
function timeoutError(config: any) {
  return new AxiosError(`timeout of ${config?.timeout ?? 15000}ms exceeded`, "ECONNABORTED", config);
}
function installFaults() {
  const real = axios.getAdapter(axios.defaults.adapter as any);
  axios.defaults.adapter = (async (config: any) => {
    const url = String(config.url ?? "");
    const rule = rules.find((r) => r.times > 0 && r.match.test(url));
    if (!rule) return real(config);
    rule.times--;
    rule.hits++;
    if (rule.before) await rule.before();
    if (rule.mode === "PASS") return real(config);
    if (rule.mode === "DROP_BEFORE") throw new AxiosError("connect ECONNREFUSED", "ECONNREFUSED", config);
    if (rule.mode === "LATE") {
      rule.inFlight.push(real(config).catch(() => null));
      throw timeoutError(config);
    }
    await real(config); // LOSE_RESPONSE: payment-service really handles (and commits) it ...
    throw timeoutError(config); // ... but the answer never arrives
  }) as any;
}

/** Terminates the connection(s) that hold a contract advisory lock - the lock transaction dies (crash / failover). */
async function killLockTransactions(): Promise<number> {
  const rows: any[] = await H.m.prisma.$queryRawUnsafe(
    `SELECT pg_terminate_backend(l.pid) AS ok FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.granted AND l.pid <> pg_backend_pid()
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  );
  return rows.length;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const admin = () => H.tokenFor(ADMIN, "ADMIN");
const row = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });
const contractRow = (id: string) => H.m.prisma.contract.findUniqueOrThrow({ where: { id } });
const settlements = (contractId: string) => H.m.prisma.sessionSettlement.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
async function opCount(key: string): Promise<number> {
  return Number(((await payDb.$queryRawUnsafe("SELECT count(*)::text AS n FROM ledger_operations WHERE key = $1", key)) as any[])[0].n);
}
async function receivables(): Promise<{ n: number; sum: number }> {
  const r: any[] = await payDb.$queryRawUnsafe("SELECT count(*)::text AS n, COALESCE(SUM(amount),0)::text AS s FROM partner_receivables");
  return { n: Number(r[0].n), sum: Number(r[0].s) };
}
async function money(c: { txnId: string; clientUserId: string; ptUserId: string }) {
  return {
    client: (await H.wallet("CLIENT", c.clientUserId)).a,
    ptAvail: await H.net(c.txnId, "PT", "AVAILABLE"),
    ptPend: await H.net(c.txnId, "PT", "PENDING"),
    platAvail: await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"),
    ptWalletAvail: (await H.wallet("PT", c.ptUserId)).a,
    revenueAvail: (await H.revenue()).a,
  };
}
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]));

async function scenario(fn: () => Promise<void>) {
  faults.clear();
  await H.resetPayment();
  try {
    await fn();
  } finally {
    faults.clear();
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

/** PT with contract A (2 delivered) and an innocent contract B (3 delivered => the PT's pooled AVAILABLE also holds B's 1,350,000). */
async function setUp(deliverA = 2) {
  const pt = await H.makePt();
  const A = await H.paidContract(pt, { packageName: "Gói A" });
  const B = await H.paidContract(pt, { packageName: "Gói B" });
  await H.deliver(B, 3);
  if (deliverA) await H.deliver(A, deliverA);
  return { pt, A, B };
}
const cancelReq = (A: PaidContract) => () => H.call("POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" });

function payPost(path: string, body: unknown) {
  return fetch(`${H.payUrl}/internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-secret": H.secret },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
}
function ledgerBody(c: PaidContract, key: string, extra: Record<string, unknown> = {}) {
  return {
    transactionId: c.txnId,
    price: "5000000",
    totalSessions: 10,
    rates: { platformRate: "0.1", ptRate: "0.9", gymRate: "0" },
    parties: { ptUserId: c.ptUserId, gymId: null, clientUserId: c.clientUserId },
    label: `fault-test ${key}`,
    idempotencyKey: key,
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 - payment-service idempotency key semantics (what a replay does with DIFFERENT request parameters)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("[KNOWN-DEFECT/P2 - payment-service, Phase 2] payment-service replays the STORED result for a known key whatever else the request says: same key + different price / contract / reason is NOT a conflict", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c1 = await H.paidContract(pt, { packageName: "C1" });
    const c2 = await H.paidContract(pt, { packageName: "C2" });
    const key = "SESSION_RELEASE:fixed-session-1";
    const first = await payPost("/contracts/release-session", ledgerBody(c1, key));
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.data.released, { pt: "450000.00", gym: "0.00", platform: "50000.00" });
    const snap = await H.snapshot();
    const afterFirst = await money(c1);

    // (1) same key, a different PRICE (10,000,000 instead of 5,000,000): 200 and the OLD amounts - no 409, nothing moves
    const priced = await payPost("/contracts/release-session", ledgerBody(c1, key, { price: "10000000" }));
    assert.equal(priced.status, 200);
    assert.deepEqual(priced.body.data, first.body.data, "the stored result comes back, the new price is ignored");

    // (2) same key, a DIFFERENT CONTRACT: 200 with c1's result; contract c2 receives NOTHING (a lost payment, silently)
    const other = await payPost("/contracts/release-session", ledgerBody(c2, key));
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.data, first.body.data);
    assert.equal(await H.net(c2.txnId, "PT", "AVAILABLE"), 0, "c2's PT was not paid, and nobody was told");
    assert.equal(await H.net(c2.txnId, "PT", "PENDING"), 4_500_000, "c2's pending is untouched");
    assert.deepEqual(await H.snapshot(), snap, "the ledger did not move on either replay");
    assert.deepEqual(await money(c1), afterFirst);

    // (3) terminate: same key, other reason / other used count - the first ending's figures win
    const tKey = `CONTRACT_TERMINATE:${c1.id}`;
    const termBody = (reason: string, used: number) =>
      ledgerBody(c1, tKey, { usedSessions: used, compensatedSessions: 0, reason, alreadyReleased: { pt: "450000", gym: "0", platform: "50000" } });
    const t1 = await payPost("/contracts/terminate", termBody("CLIENT_CANCELLED", 1));
    assert.equal(t1.status, 200, JSON.stringify(t1.body));
    assert.equal(t1.body.data.refund, "4050000.00", "9 unused x 500,000 x 90%");
    const clientAfter = (await H.wallet("CLIENT", c1.clientUserId)).a;
    const t2 = await payPost("/contracts/terminate", termBody("PT_CANCELLED", 4));
    assert.equal(t2.status, 200);
    assert.equal(t2.body.data.reason, "CLIENT_CANCELLED", "a PT_CANCELLED request is answered with the stored CLIENT_CANCELLED result");
    assert.equal(t2.body.data.refund, t1.body.data.refund);
    assert.equal((await H.wallet("CLIENT", c1.clientUserId)).a, clientAfter);

    // (4) held session resolved both ways under ONE key: the second outcome gets the first outcome's result
    const c3 = await H.paidContract(pt, { packageName: "C3" });
    await payPost(
      "/contracts/terminate",
      ledgerBody(c3, `CONTRACT_TERMINATE:${c3.id}`, { usedSessions: 0, compensatedSessions: 0, unresolvedSessions: 1, reason: "CLIENT_CANCELLED", alreadyReleased: { pt: "0", gym: "0", platform: "0" } }),
    );
    const uKey = "UNRESOLVED_SESSION:fixed-session-3";
    const delivered = await payPost("/contracts/resolve-unresolved-session", ledgerBody(c3, uKey, { outcome: "DELIVERED" }));
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
    const clientBefore = (await H.wallet("CLIENT", c3.clientUserId)).a;
    const notDelivered = await payPost("/contracts/resolve-unresolved-session", ledgerBody(c3, uKey, { outcome: "NOT_DELIVERED" }));
    assert.equal(notDelivered.status, 200, "no 409: the opposite outcome is silently answered with the first result");
    assert.deepEqual(notDelivered.body.data, delivered.body.data);
    assert.equal((await H.wallet("CLIENT", c3.clientUserId)).a, clientBefore, "the client was NOT refunded though the caller asked for NOT_DELIVERED");
    show("key semantics", { refund: t1.body.data.refund, replayedReason: t2.body.data.reason });
    await H.invariant("key semantics");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 2 - terminate: payment commits, user-service does not learn it
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("[REGRESSION D58/D59, was DEFECT/P1] terminate commits in payment, the answer is lost: the ending is RECORDED, the contract is ENDING (never reported ended), the PT's delivery attempt is REFUSED 409 CONTRACT_ENDING (no silent 0 payout), and the sweep completes the ending without the client", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const open = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * DAY)); // a future session the ending calls off
    const rule = faults.add(/\/contracts\/terminate$/, "LOSE_RESPONSE");

    const lost = await cancelReq(A)();
    assert.equal(rule.hits, 1);
    assert.equal(lost.status, 409, "the client is told the ending is recorded but not confirmed - not 'failed', not 'ended'");
    assert.equal(lost.body.code, "CONTRACT_ENDING");

    // user-service: still ACTIVE (never reported ended), but the ending is RECORDED durably with its reason
    const c = await contractRow(A.id);
    assert.deepEqual([c.status, c.terminationReason], ["ACTIVE", null]);
    const intent = (await settlements(A.id)).filter((x) => x.kind === "CONTRACT_TERMINATION");
    assert.equal(intent.length, 1, "a durable intent exists for the ending");
    assert.deepEqual([intent[0].reason, intent[0].status], ["CLIENT_CANCELLED", "FAILED"]);
    assert.equal((await row(open.id)).status, "CANCELLED", "the future session was called off as part of the recorded ending");
    // payment-service: the ending is done
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    const afterLost = await money(A);
    assert.equal(afterLost.client, 3_600_000, "the client was refunded 3,600,000");
    assert.equal(afterLost.ptPend, 0, "A's pending is drained");

    // The PT tries to deliver one more session on the contract the app still shows as ACTIVE: refused, nothing counted, nobody paid 0.
    const late = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 3 * DAY));
    const done = await H.call("PATCH", `/sessions/${late.id}/complete`, A.ptToken, { ptNotes: "ok" });
    assert.equal(done.status, 409, JSON.stringify(done.body));
    assert.equal(done.body.code, "CONTRACT_ENDING");
    assert.equal((await contractRow(A.id)).usedSessions, 2, "the session was not counted");
    assert.deepEqual(await money(A), afterLost, "no money moved, none silently lost");
    // reads keep working while the ending is unconfirmed
    assert.equal((await H.call("GET", `/contracts/${A.id}`, A.clientToken)).status, 200);

    // The sweep carries the SAME recorded ending through - nobody has to retry.
    await runSettlementSweep();
    const ended = await contractRow(A.id);
    assert.deepEqual([ended.status, ended.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.equal((await settlements(A.id)).find((x) => x.kind === "CONTRACT_TERMINATION")!.status, "SETTLED");
    assert.deepEqual(await money(A), afterLost, "completing the ending moved nothing more");
    assert.equal((await row(late.id)).status, "CANCELLED", "the leftover session is called off by the ending");
    const retry = await cancelReq(A)();
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.deepEqual(await money(A), afterLost, "the client's late retry moved nothing");
    show("lost terminate then delivery attempt", { afterLost });
    await H.invariant("lost terminate");
  });
});

test("[REGRESSION D58/D59/N7, was DEFECT/P1] after a lost terminate answer, a PT no-show on the still-ACTIVE (ENDING) contract is REFUSED 409 CONTRACT_ENDING: no second compensation, nothing drawn from the PT's POOLED AVAILABLE wallet", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    faults.add(/\/contracts\/terminate$/, "LOSE_RESPONSE");
    const lost = await cancelReq(A)();
    assert.equal(lost.status, 409);
    const before = await money(A);
    assert.equal(before.ptPend, 0);

    // a session that was booked / confirmed (the contract looks ACTIVE) and the PT did not turn up
    const s = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 1 * DAY));
    const noShow = await H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" });
    assert.equal(noShow.status, 409, JSON.stringify(noShow.body));
    assert.equal(noShow.body.code, "CONTRACT_ENDING");
    assert.deepEqual(await money(A), before, "no second compensation, the PT's pooled wallet and the platform revenue are untouched");
    assert.equal(await opCount(`PT_NO_SHOW:${s.id}`), 0);

    await runSettlementSweep();
    assert.equal((await contractRow(A.id)).status, "CANCELLED");
    assert.deepEqual(await money(A), before);
    await H.invariant("N7 draw refused");
  });
});

test("[REGRESSION D59, was DEFECT/P2] after a lost CLIENT_CANCELLED answer, an admin asking to end the contract as MUTUAL completes the RECORDED ending: the response, the contract and the ledger all say CLIENT_CANCELLED - nothing is re-priced, nothing contradicts", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    faults.add(/\/contracts\/terminate$/, "LOSE_RESPONSE");
    assert.equal((await cancelReq(A)()).status, 409);
    const mutual = await H.call("POST", `/contracts/${A.id}/terminate`, admin(), { reason: "MUTUAL" });
    assert.equal(mutual.status, 200, JSON.stringify(mutual.body));
    assert.equal(mutual.body.reason, "CLIENT_CANCELLED", "the recorded reason, not the requested one");
    assert.equal(mutual.body.requestedReason, "MUTUAL");
    const c = await contractRow(A.id);
    assert.deepEqual([c.status, c.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"], "user-service records what the ledger did");
    assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 3_600_000);
    assert.equal(mutual.body.settlement.reason, "CLIENT_CANCELLED");
    await H.invariant("mutual after lost");
  });
});

test("[SAFE] terminate: the client simply retries after a lost answer - one refund, contract closed", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    faults.add(/\/contracts\/terminate$/, "LOSE_RESPONSE");
    assert.equal((await cancelReq(A)()).status, 409, "recorded, unconfirmed (D59)");
    const snap = await H.snapshot();
    for (let i = 0; i < 3; i++) assert.equal((await cancelReq(A)()).status, 200);
    assert.deepEqual(await H.snapshot(), snap, "three more cancels, ledger unchanged");
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    assert.equal((await contractRow(A.id)).status, "CANCELLED");
    assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 3_600_000);
    await H.invariant("retry heals");
  });
});

test("[SAFE] terminate: user-service gives up (LATE: payment still working) and the client retries at once - the two attempts serialize on the wallet locks, one refund", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    const rule = faults.add(/\/contracts\/terminate$/, "LATE");
    const first = await cancelReq(A)();
    assert.equal(first.status, 409);
    const second = await cancelReq(A)(); // races the first request, which is still in payment-service
    assert.equal(second.status, 200, JSON.stringify(second.body));
    await Promise.all(rule.inFlight);
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 3_600_000);
    assert.equal((await contractRow(A.id)).status, "CANCELLED");
    await H.invariant("late terminate");
  });
});

test("[REGRESSION D58/D59, was DEFECT/P2] payment-service DOWN during an ending: the ending is RECORDED (409 CONTRACT_ENDING, row FAILED), the contract stays ACTIVE-ending, and a retry after recovery completes it once", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    const open = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * DAY));
    faults.add(/\/contracts\/terminate$/, "DROP_BEFORE");
    const down = await cancelReq(A)();
    assert.equal(down.status, 409);
    assert.equal(down.body.code, "CONTRACT_ENDING");
    assert.equal((await contractRow(A.id)).status, "ACTIVE");
    const intent = (await settlements(A.id)).find((x) => x.kind === "CONTRACT_TERMINATION")!;
    assert.deepEqual([intent.reason, intent.status], ["CLIENT_CANCELLED", "FAILED"], "the accepted ending is durable - the sessions' call-off is part of it, not a loose side effect");
    assert.equal((await row(open.id)).status, "CANCELLED");
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 0);
    assert.equal((await cancelReq(A)()).status, 200);
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    assert.equal((await settlements(A.id)).find((x) => x.kind === "CONTRACT_TERMINATION")!.status, "SETTLED");
    await H.invariant("down then retry");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 3 - session release: lost answer / crash between the ledger and the bookkeeping
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

async function awaitingSession(A: PaidContract, status = "PENDING_CLIENT_CONFIRMATION") {
  return H.m.base.addSession(A, status, new Date(Date.now() - DAY), {
    clientConfirmDeadline: new Date(Date.now() + 2 * DAY),
  });
}

test("[SAFE] session release: answer lost -> the confirm still returns 200, the row is FAILED, the sweep replays: PT paid once, bookkeeping applied once", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    const before = await money(A);
    const relBefore = (await contractRow(A.id)).releasedToPt.toNumber();
    faults.add(/\/contracts\/release-session$/, "LOSE_RESPONSE");
    const conf = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    const [st] = (await settlements(A.id)).filter((x) => x.sessionId === s.id);
    assert.equal(st.status, "FAILED");
    assert.equal(d(before, await money(A)).ptAvail, PT_UNIT, "the ledger already paid the PT");
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), relBefore, "user-service has not recorded it yet");
    await runSettlementSweep();
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "SETTLED");
    assert.equal(d(before, await money(A)).ptAvail, PT_UNIT, "paid once");
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), relBefore + PT_UNIT);
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
    await runSettlementSweep();
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), relBefore + PT_UNIT, "a second sweep changes nothing");
    await H.invariant("release lost");
  });
  function d(a: Record<string, number>, b: Record<string, number>) {
    return diff(a, b);
  }
});

test("[REGRESSION D58, was DEFECT/P2] session release answer lost, then the client cancels BEFORE the sweep runs: the ending first settles the outstanding release (replay by key, bookkeeping applied once) and is priced on the true figures - it is NOT refused", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    faults.add(/\/contracts\/release-session$/, "LOSE_RESPONSE");
    assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 2 * PT_UNIT, "user-service has not recorded the third release yet (ledger: 1,350,000)");

    const end = await cancelReq(A)(); // used=3 => refund 7 x 500,000 x 90% = 3,150,000
    assert.equal(end.status, 200, JSON.stringify(end.body));
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 3 * PT_UNIT, "the outstanding release was settled first, counted once");
    const m = await money(A);
    assert.equal(m.client, 3_150_000);
    assert.equal(m.ptAvail, 1_665_000, "3 x 450,000 released + 315,000 top-up");
    assert.equal(end.body.settlement.shortfall, "0.00");
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
    assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    await H.invariant("release lost then ending");
  });
});

test("[REGRESSION D58, was DEFECT/P1] session release answer lost, then the client cancels BEFORE the sweep runs and the platform revenue COULD front a gap: the PT is NOT paid the session twice, nothing is fronted, no receivable is raised", { skip }, async () => {
  await scenario(async () => {
    // extra platform revenue (a second PT's five delivered sessions = 250,000) so a gap COULD be fronted - it must not be needed
    const other = await H.makePt();
    const C = await H.paidContract(other, { packageName: "Gói C" });
    await H.deliver(C, 5);
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    faults.add(/\/contracts\/release-session$/, "LOSE_RESPONSE");
    assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
    const recvBefore = await receivables();
    const end = await cancelReq(A)();
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const m = await money(A);
    const recv = await receivables();
    show("release lost then ending", { client: m.client, ptAvailOnA: m.ptAvail, platAvailOnA: m.platAvail, settlement: end.body.settlement, receivables: recv });
    assert.equal(m.client, 3_150_000);
    assert.equal(m.ptAvail, 1_665_000, "the PT ends with exactly what it earned");
    assert.equal(m.platAvail, 185_000);
    assert.equal(Number(end.body.settlement.shortfall), 0, "no gap, so nothing fronted");
    assert.deepEqual(recv, recvBefore, "no receivable raised against the PT");
    await H.invariant("release lost then ending (no gap)");
  });
});



test("[SAFE] session release: payment-service DOWN -> FAILED row; the sweep after recovery pays once", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    const before = await money(A);
    faults.add(/\/contracts\/release-session$/, "DROP_BEFORE");
    assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
    assert.deepEqual(await money(A), before, "nothing moved");
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "FAILED");
    await runSettlementSweep();
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT);
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
  });
});

test("[SAFE] session release: LATE (timeout while payment still working) and the sweep fires at once - the second request waits on the wallet locks and replays", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    const before = await money(A);
    const rule = faults.add(/\/contracts\/release-session$/, "LATE");
    assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
    await runSettlementSweep();
    await Promise.all(rule.inFlight);
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT, "paid exactly once");
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 3 * PT_UNIT);
    await H.invariant("late release");
  });
});

test("[REGRESSION D58 apply-once, was DEFECT/P1] session release: the ledger commits, then the settle step fails (DB blip / crash): the whole apply rolls back, the retry applies the bookkeeping exactly ONCE - releasedTo* never double-counts and the ending claws nothing back", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  const repo = (await import("../repositories/session-settlement.repository")).sessionSettlementRepository;
  await scenario(async () => {
    const { pt, A } = await setUp(2);
    const s = await awaitingSession(A);
    const original = repo.settleOnce;
    let fired = 0;
    (repo as any).settleOnce = async (...args: any[]) => {
      if (fired++ === 0) throw new Error("simulated: connection reset while marking SETTLED");
      return (original as any)(...args);
    };
    try {
      assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
      assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 2 * PT_UNIT, "the bookkeeping is applied WITH the settle or not at all: nothing was added");
      assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "FAILED", "the row says FAILED though the money moved - the retry repeats the idempotent call");
      assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
      await runSettlementSweep(); // retry: ledger replays, the bookkeeping is applied once
    } finally {
      (repo as any).settleOnce = original;
    }
    const c = await contractRow(A.id);
    assert.equal(c.releasedToPt.toNumber(), 3 * PT_UNIT, "releasedToPt = 1,350,000 = what the ledger released");
    await runSettlementSweep();
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 3 * PT_UNIT, "a further sweep changes nothing");
    const end = await cancelReq(A)(); // used=3
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const m = await money(A);
    show("apply-once then ending", { client: m.client, ptAvailOnA: m.ptAvail, topUp: end.body.settlement.topUp, pt });
    assert.equal(m.ptAvail, 1_665_000, "the PT receives exactly its 3 sessions + the top-up");
    assert.equal(end.body.settlement.topUp.pt, "315000.00");
    assert.equal(m.client, 3_150_000);
    await H.invariant("apply-once");
  });
});

test("[REGRESSION D58, was DEFECT/P1] the lock is NOT held across the payment-service call any more (a crash / failover cannot roll back a decision whose money already moved): usedSessions counts the 3 delivered sessions once, however the confirm is retried", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    const before = await money(A);
    let killed = -1;
    faults.add(/\/contracts\/release-session$/, "PASS", { before: async () => void (killed = await killLockTransactions()) });
    const conf = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    assert.equal(killed, 0, "no advisory-lock transaction is open while payment-service is being called - there is nothing to crash");
    const r = await row(s.id);
    assert.deepEqual([r.status, r.sessionDeducted], ["COMPLETED", true]);
    assert.equal((await contractRow(A.id)).usedSessions, 3);
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT);
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "SETTLED");

    const retry = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.equal(retry.status, 400, "a second confirm of a COMPLETED session is refused (nothing to confirm any more)");
    assert.equal((await contractRow(A.id)).usedSessions, 3, "a retried confirm never counts the session twice");
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT, "money moved once");

    const end = await cancelReq(A)();
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const m = await money(A);
    assert.equal(m.client, 3_150_000, "priced on 3 used sessions (7 unused x 500,000 x 90%)");
    await H.invariant("no double count");
  });
});

test("[REGRESSION D58, was DEFECT/P0] one session can never be paid under two idempotency keys: the confirm counts it used atomically with its release intent, so a later ending does NOT hold it and no UNRESOLVED_SESSION release follows", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    let killed = -1;
    faults.add(/\/contracts\/release-session$/, "PASS", { before: async () => void (killed = await killLockTransactions()) });
    assert.equal((await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken)).status, 200);
    assert.equal(killed, 0);
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1, "ledger: PT paid 450,000 for S");
    assert.equal((await row(s.id)).status, "COMPLETED", "user-service agrees: S is delivered");
    const end = await cancelReq(A)(); // S counts as USED, not awaiting => nothing is held by the ending
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const conf = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.equal(conf.status, 400, "S is already COMPLETED: a late second confirm is refused and settles nothing");
    const fin = await money(A);
    show("one key one session", { final: fin, unresolvedKeyOps: await opCount(`UNRESOLVED_SESSION:${s.id}`), end: end.body.settlement });
    assert.equal(await opCount(`UNRESOLVED_SESSION:${s.id}`), 0, "no second key for the same session");
    assert.equal(fin.ptAvail, 1_665_000, "PT on A: 3 releases (1,350,000) + the ending's top-up (315,000) - not a centavo more");
    assert.equal(fin.client, 3_150_000);
    await H.invariant("one key");
  });
});

test("[REGRESSION D58 unit 1, was DEFECT/P1] a settlement row whose decision never committed (legacy dangling row) is NEVER paid by the sweep: it is PARKED (NEEDS_RECONCILIATION), the PT is not paid for a session the system shows as unconfirmed, a 'not delivered' ruling stays clean", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    // the state the old code could leave behind: an intent row, but the claim it belonged to rolled back
    await H.m.prisma.sessionSettlement.create({
      data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.id}`, contractId: A.id, sessionId: s.id, status: "PENDING" },
    });
    const before = await money(A);
    await runSettlementSweep();
    assert.deepEqual(await money(A), before, "the sweep paid nothing");
    const parked = (await settlements(A.id)).find((x) => x.sessionId === s.id)!;
    assert.equal(parked.status, "FAILED");
    assert.match(parked.lastError ?? "", /^NEEDS_RECONCILIATION:/);
    assert.equal((await row(s.id)).status, "PENDING_CLIENT_CONFIRMATION");

    // the client disputes it; the admin rules 'not delivered' (CANCELLED): on a running contract that moves no money
    assert.equal((await H.call("POST", `/sessions/${s.id}/dispute`, A.clientToken, { reason: "PT không đến" })).status, 200);
    const ruled = await H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "CANCELLED", note: "không diễn ra" });
    assert.equal(ruled.status, 200, JSON.stringify(ruled.body));
    assert.equal(diff(before, await money(A)).ptAvail, 0, "the PT was never paid for a session ruled NOT delivered");
    assert.equal(diff(before, await money(A)).client, 0);
    await H.invariant("dangling row");
  });
});







// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 4 - compensation (PT no-show / late arrival) and the order "status first, intent second"
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("[SAFE] no-show compensation: answer lost -> the ending drains it FIRST (replay) and prices the contract with the right compensatedSessions; the client is compensated once", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - DAY));
    faults.add(/\/contracts\/no-show$/, "LOSE_RESPONSE");
    assert.equal((await H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" })).status, 200);
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "FAILED");
    assert.equal((await contractRow(A.id)).compensatedSessions, 0, "not recorded yet, though the client already got 500,000");
    assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 500_000);
    const end = await cancelReq(A)(); // used=2, compensated=1 (after the drain) => 7 unused => 3,150,000
    assert.equal(end.status, 200, JSON.stringify(end.body));
    assert.equal((await contractRow(A.id)).compensatedSessions, 1);
    assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 500_000 + 3_150_000);
    assert.equal(await opCount(`PT_NO_SHOW:${s.id}`), 1);
    await runSettlementSweep();
    assert.equal((await contractRow(A.id)).compensatedSessions, 1, "no second increment");
    await H.invariant("noshow lost");
  });
});

test("[REGRESSION D58 apply-once, was DEFECT/P1] no-show compensation: the ledger commits, then the settle step fails: compensatedSessions is applied exactly ONCE (with the settle), the ending's drain replays and counts it once - the client keeps the full refund", { skip }, async () => {
  const repo = (await import("../repositories/session-settlement.repository")).sessionSettlementRepository;
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - DAY));
    const original = repo.settleOnce;
    let fired = 0;
    (repo as any).settleOnce = async (...args: any[]) => {
      if (fired++ === 0) throw new Error("simulated: connection reset while marking SETTLED");
      return (original as any)(...args);
    };
    try {
      assert.equal((await H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" })).status, 200);
      assert.equal((await contractRow(A.id)).compensatedSessions, 0, "not counted without its settle");
      assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "FAILED");
      assert.equal((await H.wallet("CLIENT", A.clientUserId)).a, 500_000, "the ledger already paid the client");
      const end = await cancelReq(A)(); // the drain replays the 'failed' compensation first and applies it once
      assert.equal(end.status, 200, JSON.stringify(end.body));
    } finally {
      (repo as any).settleOnce = original;
    }
    assert.equal((await contractRow(A.id)).compensatedSessions, 1, "compensatedSessions = 1 for ONE compensated session");
    const client = (await H.wallet("CLIENT", A.clientUserId)).a;
    show("single compensatedSessions", { client });
    assert.equal(client, 500_000 + 3_150_000, "refund priced on 7 unused sessions");
    assert.equal(await opCount(`PT_NO_SHOW:${s.id}`), 1, "the ledger itself moved once");
    await H.invariant("single compensated");
  });
});

test("[REGRESSION D58 atomicity, was DEFECT/P2] late cancel: the session status, the quota charge and the settlement intent commit TOGETHER - a failure before the intent is written rolls the whole decision back (nothing half-done, nothing lost), the retry pays the PT once", { skip }, async () => {
  const repo = (await import("../repositories/session-settlement.repository")).sessionSettlementRepository;
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * HOUR)); // < 24h: late cancel => quota charged + PT paid
    const before = await money(A);
    const original = repo.upsertPending;
    let fired = 0;
    (repo as any).upsertPending = async (...args: any[]) => {
      if (fired++ === 0) throw new Error("simulated crash before the settlement row is written");
      return (original as any)(...args);
    };
    let res;
    try {
      res = await H.call("PATCH", `/sessions/${s.id}/cancel`, A.clientToken, { reason: "bận" });
    } finally {
      (repo as any).upsertPending = original;
    }
    assert.equal(res.status, 500);
    const r = await row(s.id);
    assert.deepEqual([r.status, r.sessionDeducted], ["CONFIRMED", false], "the cancellation rolled back with the intent: nothing is half-done");
    assert.equal((await contractRow(A.id)).usedSessions, 2, "and the client was not charged");
    assert.equal((await settlements(A.id)).filter((x) => x.sessionId === s.id).length, 0);
    assert.deepEqual(await money(A), before);

    // the client's retry now works from the clean state and pays the PT exactly once
    const retry = await H.call("PATCH", `/sessions/${s.id}/cancel`, A.clientToken, { reason: "bận" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const r2 = await row(s.id);
    assert.deepEqual([r2.status, r2.sessionDeducted], ["CANCELLED", true]);
    assert.equal((await contractRow(A.id)).usedSessions, 3);
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT);
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "SETTLED");
    await H.invariant("late cancel atomic");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 5 - ITEM 4: for each money endpoint, a timeout followed by the client's retry (and the sweep) never moves money twice
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

interface Case {
  name: string;
  /** Which payment call the endpoint makes (the fault is injected there). */
  call: RegExp;
  key: (sessionId: string, A: PaidContract) => string;
  setup: (A: PaidContract) => Promise<{ id: string }>;
  http: (A: PaidContract, s: { id: string }) => () => Promise<{ status: number; body: any }>;
  /** Expected delta of the money, once */
  expect: Partial<Record<"client" | "ptAvail" | "platAvail", number>>;
}
const CASES: Case[] = [
  {
    name: "POST /sessions/:id/confirm (client confirm)",
    call: /release-session$/,
    key: (s) => `SESSION_RELEASE:${s}`,
    setup: (A) => awaitingSession(A),
    http: (A, s) => () => H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken),
    expect: { ptAvail: PT_UNIT, platAvail: PLAT_UNIT },
  },
  {
    name: "POST /admin/sessions/:id/resolve COMPLETED",
    call: /release-session$/,
    key: (s) => `SESSION_RELEASE:${s}`,
    setup: (A) => H.m.base.addSession(A, "DISPUTED", new Date(Date.now() - DAY), { disputeReason: "x", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" }),
    http: (_A, s) => () => H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "COMPLETED", note: "đã dạy" }),
    expect: { ptAvail: PT_UNIT, platAvail: PLAT_UNIT },
  },
  {
    name: "POST /admin/sessions/:id/resolve PT_NO_SHOW_CONFIRMED",
    call: /no-show$/,
    key: (s) => `PT_NO_SHOW:${s}`,
    setup: (A) => H.m.base.addSession(A, "DISPUTED", new Date(Date.now() - DAY), { disputeReason: "x", disputedAt: new Date(), disputeType: "PT_NO_SHOW_CLAIM" }),
    http: (_A, s) => () => H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "PT_NO_SHOW_CONFIRMED", note: "PT vắng" }),
    expect: { client: 500_000 },
  },
  {
    name: "PATCH /sessions/:id/cancel (client, < 24h: PT paid)",
    call: /release-session$/,
    key: (s) => `SESSION_RELEASE:${s}`,
    setup: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * HOUR)),
    http: (A, s) => () => H.call("PATCH", `/sessions/${s.id}/cancel`, A.clientToken, { reason: "bận" }),
    expect: { ptAvail: PT_UNIT, platAvail: PLAT_UNIT },
  },
  {
    name: "PATCH /sessions/:id/cancel (PT, < 24h: client compensated)",
    call: /no-show$/,
    key: (s) => `PT_NO_SHOW:${s}`,
    setup: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * HOUR)),
    http: (A, s) => () => H.call("PATCH", `/sessions/${s.id}/cancel`, A.ptToken, { reason: "bận" }),
    expect: { client: 500_000 },
  },
  {
    name: "PATCH /sessions/:id/no-show (PT admits)",
    call: /no-show$/,
    key: (s) => `PT_NO_SHOW:${s}`,
    setup: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - DAY)),
    http: (A, s) => () => H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" }),
    expect: { client: 500_000 },
  },
  {
    name: "POST /sessions/:id/respond-no-show AGREE",
    call: /no-show$/,
    key: (s) => `PT_NO_SHOW:${s}`,
    setup: (A) => H.m.base.addSession(A, "PT_NO_SHOW_REPORTED", new Date(Date.now() - DAY)),
    http: (A, s) => () => H.call("POST", `/sessions/${s.id}/respond-no-show`, A.ptToken, { response: "AGREE" }),
    expect: { client: 500_000 },
  },
  {
    name: "POST /availability/me/exceptions (PT blocks a date: CONFIRMED session < 24h away is compensated)",
    call: /no-show$/,
    key: (s) => `PT_NO_SHOW:${s}`,
    setup: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 2 * HOUR)),
    http: (A, s) => async () => {
      const d = new Date(Date.now() + 2 * HOUR);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      void s;
      return H.call("POST", "/availability/me/exceptions", A.ptToken, { date, reason: "bận" });
    },
    expect: { client: 500_000 },
  },
];

test("[SAFE] held session of an ENDED contract resolved as DELIVERED: payment commits + answer lost => the sweep replays by key; the PT's held 450,000 is released once", { skip }, async () => {
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await awaitingSession(A);
    assert.equal((await cancelReq(A)()).status, 200, "the client leaves; the awaiting session's 500,000 is HELD by payment-service");
    const before = await money(A);
    assert.equal(await H.net(A.txnId, "PT", "PENDING"), PT_UNIT, "450,000 of the PT's share is still held in pending");
    faults.add(/resolve-unresolved-session$/, "LOSE_RESPONSE");
    const conf = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    const [st] = (await settlements(A.id)).filter((x) => x.sessionId === s.id);
    assert.equal(st.status, "FAILED");
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT, "the ledger already released it");
    const retry = await H.call("POST", `/sessions/${s.id}/confirm`, A.clientToken);
    assert.ok([200, 400, 409].includes(retry.status));
    await runSettlementSweep();
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT, "once");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${s.id}`), 1);
    assert.equal((await settlements(A.id)).find((x) => x.sessionId === s.id)!.status, "SETTLED");
    await H.invariant("held session lost");
  });
});

for (const cs of CASES) {
  test(`[SAFE] ${cs.name}: payment commits + answer lost + client retries + sweep + client retries again => ONE ledger movement`, { skip }, async () => {
    const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
    await scenario(async () => {
      const { A } = await setUp(2);
      const s = await cs.setup(A);
      const key = cs.key(s.id, A);
      const before = await money(A);
      faults.add(cs.call, "LOSE_RESPONSE");
      const first = await cs.http(A, s)();
      const afterFirst = await money(A);
      show(`${cs.name} first`, { status: first.status, body: first.body?.code ?? first.body?.error ?? "ok" });
      const retry1 = await cs.http(A, s)();
      await runSettlementSweep();
      const retry2 = await cs.http(A, s)();
      await runSettlementSweep();
      const final = await money(A);
      const moved = diff(before, final);
      for (const [k, v] of Object.entries(cs.expect)) assert.equal(moved[k], v, `${cs.name}: ${k} moved ${moved[k]}, expected exactly ${v} once`);
      assert.deepEqual(diff(before, afterFirst).client + diff(before, afterFirst).ptAvail, (cs.expect.client ?? 0) + (cs.expect.ptAvail ?? 0), "the ledger had already moved after the lost answer");
      assert.equal(await opCount(key), 1, "one idempotency row for the key");
      assert.ok([200, 201, 500].includes(first.status), `first: ${first.status}`);
      for (const r of [retry1, retry2]) assert.ok([200, 201, 400, 409].includes(r.status), `retry answered ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal((await contractRow(A.id)).usedSessions + (await contractRow(A.id)).compensatedSessions >= 2, true);
      await H.invariant(cs.name);
    });
  });
}

test("[SAFE] POST /contracts/:id/terminate by PT and by admin: timeout + retry => one refund", { skip }, async () => {
  for (const who of ["PT", "ADMIN"] as const) {
    await scenario(async () => {
      const { A } = await setUp(2);
      const token = who === "PT" ? A.ptToken : admin();
      const reason = who === "PT" ? "PT_CANCELLED" : "MUTUAL";
      faults.add(/\/contracts\/terminate$/, "LOSE_RESPONSE");
      const first = await H.call("POST", `/contracts/${A.id}/terminate`, token, { reason });
      assert.equal(first.status, 409);
      const after = await H.snapshot();
      const again = await H.call("POST", `/contracts/${A.id}/terminate`, token, { reason });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.deepEqual(await H.snapshot(), after, `${who}: the retry moved nothing`);
      assert.equal(await opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
      await H.invariant(`terminate ${who}`);
    });
  }
});

test("[SAFE] auto-confirm sweep: payment commits + answer lost => the sweep's own retry and a second sweep move money once", { skip }, async () => {
  const { runAutoConfirm } = await import("../services/session-autoconfirm.service");
  const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
  await scenario(async () => {
    const { A } = await setUp(2);
    const s = await H.m.base.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 4 * DAY), { clientConfirmDeadline: new Date(Date.now() - HOUR) });
    const before = await money(A);
    faults.add(/release-session$/, "LOSE_RESPONSE");
    await runAutoConfirm();
    await runSettlementSweep();
    await runAutoConfirm();
    await runSettlementSweep();
    assert.equal(diff(before, await money(A)).ptAvail, PT_UNIT);
    assert.equal(await opCount(`SESSION_RELEASE:${s.id}`), 1);
    assert.equal((await contractRow(A.id)).releasedToPt.toNumber(), 3 * PT_UNIT);
    await H.invariant("autoconfirm lost");
  });
});

test("[SAFE/P2] POST /contracts/:id/pay: a lost checkout answer + retry creates a SECOND gateway checkout; if both are paid, the second is refunded in full to the wallet and the contract is activated once", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const row0 = await H.m.prisma.contract.create({
      data: {
        id: (await import("node:crypto")).randomUUID(),
        ptUserId: pt,
        clientUserId: (await import("node:crypto")).randomUUID(),
        packageName: "Pay twice",
        totalSessions: 10,
        price: 5_000_000,
        status: "PENDING_PAYMENT",
        paymentDueAt: new Date(Date.now() + 6 * HOUR),
        sessionDurationMinutes: 60,
        startDate: new Date(Date.now() - DAY),
        endDate: new Date(Date.now() + 60 * DAY),
      },
    });
    try {
      faults.add(/\/payments\/checkout$/, "LOSE_RESPONSE");
      await assert.rejects(() => H.m.contractService.pay(row0.id, row0.clientUserId, "VNPAY", "web"));
      const second = await H.m.contractService.pay(row0.id, row0.clientUserId, "VNPAY", "web");
      const txns: any[] = await payDb.$queryRawUnsafe("SELECT id, status::text AS status FROM payment_transactions WHERE related_entity_id = $1 ORDER BY created_at", row0.id);
      assert.equal(txns.length, 2, "two open checkouts exist for one contract");
      // the payer (confused by the failed first attempt) pays BOTH at the gateway
      for (const t of txns) {
        const ipn = await H.gatewayIpn(t.id, 5_000_000);
        assert.equal(ipn.RspCode, "00", JSON.stringify(ipn));
      }
      const c = await contractRow(row0.id);
      assert.equal(c.status, "ACTIVE");
      assert.equal(c.paymentTransactionId, txns[0].id.toString() === c.paymentTransactionId ? txns[0].id : txns[1].id);
      const wallet = (await H.wallet("CLIENT", row0.clientUserId)).a;
      show("double checkout", { second: second.payment.transactionId, walletRefund: wallet, active: c.paymentTransactionId });
      assert.equal(wallet, 5_000_000, "the duplicate payment was refunded in full - into the wallet, not to the card");
      await H.invariant("double checkout");
    } finally {
      await H.m.prisma.contract.deleteMany({ where: { id: row0.id } }).catch(() => {});
    }
  });
});
