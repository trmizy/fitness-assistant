/**
 * D77 follow-up with the REAL payment-service ledger - a late-arrival compensation payment-service never performed, met by the contract's
 * ending, is written down as an OPEN unpaid obligation and NOT lost, NOT paid out of money that is not the session's.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned payment-service child,
 * real ledger, isolated test databases; the FH-8 CLI is run as a real child process against the payment test database.
 * TEST FIXTURE: the contract row, the signed gateway IPN, session rows at their starting state, auth-service's token table (also used so
 * the ADMIN route /admin/payments/obligations can be called over HTTP), and the NEEDS_HUMAN status given to the late-arrival row (stands
 * for 12 failed attempts: payment-service was down when the compensation was due). See cross-service-money.harness.ts. Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_fhg_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_fhg_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/cross-service-money-d77-obligation.e2e.test.ts
 *
 * Hand-computed money: 5,000,000 / 10 sessions -> one session = 500,000 (PT 450,000 + platform 50,000); a late arrival = HALF a session
 * = 250,000. 2 sessions delivered and released (PT 900,000 / platform 100,000), session P (the late one) reported delivered and awaiting
 * the client. CLIENT_CANCELLED: refund = 90% x 7 unused sessions x 500,000 = 3,150,000; P's 500,000 is HELD in the contract's own pending.
 * The 250,000 compensation is NOT paid: it is an OPEN obligation (owed 250,000 / paid 0 / unpaid 250,000).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { DAY, PAYMENT_DB_URL, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

let H: Harness;
test.before(async () => {
  if (skip) return;
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
  if (H) await H.close();
});

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

const num = (v: unknown) => Number(v ?? 0);
async function obligations(txnId?: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT id, key, kind::text AS kind, party, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid, reason, transaction_id
       FROM contract_unpaid_obligations ${txnId ? "WHERE transaction_id = $1" : ""} ORDER BY created_at`,
    ...(txnId ? [txnId] : []),
  );
  return rows;
}

/** 2 delivered+released sessions, then session P (the PT joined late) reported delivered and awaiting the client; its compensation was due but payment-service was down. */
async function lateUnperformed() {
  const pt = await H.makePt();
  const c = await H.paidContract(pt);
  await H.deliver(c, 2);
  const T = Date.now();
  const P = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
  await H.m.prisma.$transaction((tx) => H.m.payout.recordLateArrivalIntent(tx, c.id, P.id));
  await H.stopPayment();
  const outcome: any = await H.m.payout.compensateLateArrivalMoney(c.id, P.id);
  assert.equal(outcome.state, "FAILED", "payment-service was down: the compensation did not happen");
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${P.id}` } });
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
  assert.equal((await obligations()).length, 0, "nothing exists in the ledger for it");
  assert.equal(await H.m.prisma.sessionSettlement.count({ where: { contractId: c.id, idempotencyKey: `PT_LATE_ARRIVAL:${P.id}` } }), 1);
  return { pt, c, P, row, outcome };
}

const ledgerNet = async (c: PaidContract) => ({
  client: (await H.wallet("CLIENT", c.clientUserId)).a,
  ptAvail: await H.net(c.txnId, "PT", "AVAILABLE"),
  ptPend: await H.net(c.txnId, "PT", "PENDING"),
  platAvail: await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
  platPend: await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"),
});

test("D77: late arrival unperformed -> the ending records exactly ONE OPEN obligation (owed 250,000 / paid 0 / unpaid 250,000), moves NO money for it, the row is terminal; retried and concurrent endings change nothing", { skip }, async () => {
  await scenario(async () => {
    const { c, P, row, outcome } = await lateUnperformed();

    // the client is not told they were compensated
    const { ptLateArrivalClientMessage, readPtFaultMoney } = await import("../services/pt-fault-session-wording");
    assert.doesNotMatch(ptLateArrivalClientMessage(readPtFaultMoney(outcome), "01/01/2027"), /Đã bồi thường/);

    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const quoted = num(preview.body.refundIfCancelledNow);
    const entriesBefore = (await H.entries(c.txnId)).length;

    // two endings at once
    const [a, b] = await Promise.all([
      H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" }),
      H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" }),
    ]);
    assert.ok([a.status, b.status].includes(200), JSON.stringify([a.body, b.body]));

    // ── payment-service: one obligation, one operation, nothing paid ──
    const obs = await obligations(c.txnId);
    assert.equal(obs.length, 1, "exactly one obligation however many endings");
    const o = obs[0];
    assert.equal(o.key, `PT_LATE_ARRIVAL:${P.id}`, "keyed on the ORIGINAL late-arrival key");
    assert.deepEqual([o.kind, o.party, o.status, o.owed, o.paid, o.unpaid], ["LATE_ARRIVAL", "CLIENT", "OPEN", "250000.00", "0.00", "250000.00"]);
    assert.match(o.reason, /PT vào muộn/);
    const ops: any[] = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `PT_LATE_ARRIVAL:${P.id}`);
    assert.equal(ops[0].n, 1);

    // ── no money for it: no draw on this contract's pending, no pooled draw, no fronting, no PT debt; the client got the quoted refund and nothing more ──
    const n = await ledgerNet(c);
    assert.equal(n.client, quoted, "the client's wallet is exactly the quoted refund - no late-arrival compensation was credited");
    assert.equal(quoted, 3_150_000);
    const lateEntries = (await H.entries(c.txnId)).filter((e) => /late-arrival/i.test(e.description));
    assert.deepEqual(lateEntries, [], "not one ledger row mentions a late-arrival charge or credit");
    assert.equal((await H.entries(c.txnId)).length > entriesBefore, true, "the ending itself wrote its rows");
    assert.equal(num(((await H.payDb.$queryRawUnsafe("SELECT count(*)::text AS n FROM partner_receivables")) as any[])[0].n), 0, "no PT debt");
    // P's whole 500,000 stays held for P (PT 450,000 / platform 50,000): it was not reduced by a compensation that was never paid
    assert.deepEqual([n.ptPend, n.platPend], [450_000, 50_000]);

    // ── user-service: the row is terminal and points at it ──
    const after = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "SETTLED");
    assert.equal((after.result as any).obligationId, o.id);
    assert.equal((after.result as any).recordedOnly, true);
    assert.equal(Number((after.result as any).paid), 0);

    // ── a further retry and the sweep: still one ──
    const again = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.ok(again.status === 200 || again.status === 409, JSON.stringify(again.body));
    await (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
    assert.equal((await obligations(c.txnId)).length, 1);
    assert.equal((await ledgerNet(c)).client, quoted);

    // ── the client was never told about a compensation ──
    const notes = await H.m.prisma.notification.findMany({ where: { userId: c.clientUserId } });
    assert.ok(notes.every((x) => !/đã bồi thường|bồi thường đủ/i.test(x.text)), notes.map((x) => x.text).join(" | "));

    // ── visible to the admin, over the real route ──
    const report = await H.adminCall("GET", "/admin/payments/obligations");
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const listed = report.body.data.unpaidObligations.find((x: any) => x.id === o.id);
    assert.ok(listed, "listed in GET /admin/payments/obligations");
    assert.deepEqual([listed.kind, listed.status, listed.owed, listed.paid, listed.unpaid], ["LATE_ARRIVAL", "OPEN", "250000.00", "0.00", "250000.00"]);
    assert.match(listed.reason, /PT vào muộn/);
    assert.equal(listed.contractId, c.id, "the REAL contract id (not the word 'Contract' cut out of the ledger label)");
    assert.equal(listed.contract, c.id.slice(0, 8));
    assert.equal(listed.sessionId, P.id, "and the session the compensation is about");
    assert.equal(report.body.data.summary.unpaidObligations.open.count, 1);
  });
});

test("D77: the FH-8 CLI resolves / waives it - audited, idempotent, and it moves no money", { skip }, async () => {
  await scenario(async () => {
    const { c, P } = await lateUnperformed();
    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [o] = await obligations(c.txnId);
    const before = await H.snapshot();
    const wallets = await ledgerNet(c);

    const cli = (op: "obligation-resolve" | "obligation-waive", ref: string, apply: boolean) => {
      const args = [
        "--import", "tsx", "scripts/fh8-adjust.ts", `--op=${op}`, `--id=${o.id}`, "--expected-amount=250000.00", `--expected-transaction-id=${c.txnId}`,
        op === "obligation-resolve" ? "--reason=client paid by bank transfer, payout ref BT-2026-77" : "--reason=owner decided not to pursue (minute 12)",
        "--approved-by=owner-test", `--approval-ref=${ref}`, ...(apply ? ["--apply"] : []),
      ];
      return execFileSync(process.execPath, args, {
        cwd: path.resolve(__dirname, "../../../payment-service"),
        env: { ...process.env, DATABASE_URL: process.env.E2E_PAYMENT_DATABASE_URL ?? PAYMENT_DB_URL },
        encoding: "utf8",
        windowsHide: true,
      });
    };

    const dry = cli("obligation-resolve", "APR-1", false);
    assert.match(dry, /DRY_RUN/);
    assert.equal((await obligations(c.txnId))[0].status, "OPEN", "a dry-run changes nothing");

    const applied = cli("obligation-resolve", "APR-1", true);
    assert.match(applied, /APPLIED/);
    const replay = cli("obligation-resolve", "APR-1", true);
    assert.match(replay, /REPLAYED/);
    const [resolved] = await obligations(c.txnId);
    assert.equal(resolved.status, "RESOLVED");
    assert.deepEqual([resolved.owed, resolved.paid, resolved.unpaid], ["250000.00", "0.00", "250000.00"], "the figures are history: never rewritten, never marked paid");
    const ev: any[] = await H.payDb.$queryRawUnsafe(`SELECT action, from_status::text AS f, to_status::text AS t, actor, approval_ref FROM contract_unpaid_obligation_events WHERE obligation_id = $1`, o.id);
    assert.deepEqual(ev.map((e) => [e.action, e.f, e.t, e.actor, e.approval_ref]), [["RESOLVE", "OPEN", "RESOLVED", "owner-test", "APR-1"]]);
    assert.deepEqual(await H.snapshot(), before, "no wallet, entry or ledger operation moved");
    assert.deepEqual(await ledgerNet(c), wallets);

    // the ledger lookup user-service reads now says RESOLVED; a second obligation is not created by anything
    const look = await H.m.paymentClient.lookupLedgerOperation(`PT_LATE_ARRIVAL:${P.id}`);
    assert.equal(look?.obligation?.status, "RESOLVED");
    assert.equal((await obligations(c.txnId)).length, 1);
    const report = await H.adminCall("GET", "/admin/payments/obligations");
    assert.equal(report.body.data.unpaidObligations.some((x: any) => x.id === o.id), false, "a resolved obligation leaves the open list");

    // waiving an already-resolved one is refused by the state rules
    assert.throws(
      () => cli("obligation-waive", "APR-2", true),
      (e: any) => e.status === 1 && /REFUSED \[NOT_OPEN\]/.test(String(e.stdout)),
    );
    assert.equal((await obligations(c.txnId))[0].status, "RESOLVED");
  });
});

// ── DQ-2(a): the refund state of a PT-fault session, from the REAL ledger answers ───────────────────────────────────────────
// 1,000,000 / 4 sessions -> one session = 250,000 (PT 225,000 + platform 25,000).

/** TEST FIXTURE: a ledger whose pending was already short - `cut` taken out of one wallet's pending, escrow lowered by the same amount (invariant holds). */
async function cutPending(ownerType: "PT" | "PLATFORM", ownerId: string, cut: number) {
  await H.payDb.$executeRawUnsafe(
    `UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`,
    ownerType,
    ownerId,
  );
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
}
async function ptNoShow(c: PaidContract) {
  const session = await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
  const res = await H.call("PATCH", `/sessions/${session.id}/no-show`, c.ptToken, { noShowBy: "PT" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return session;
}
const states = async (c: PaidContract, token: string) => {
  const res = await H.call("GET", `/sessions/contract/${c.id}`, token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return new Map<string, any>(res.body.map((s: any) => [s.id, s]));
};

test("DQ-2(a): a PT no-show is FULL / PARTIAL / PENDING exactly as the ledger paid it; the SAME facts for client and PT; OPEN is never 'paid'; RESOLVED turns FULL, WAIVED never does; the session is never COMPLETED", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 4 });
    const full = await ptNoShow(c); // funded: client +250,000
    await cutPending("PT", pt, 575_000); // PT pending 675,000 -> 100,000
    const partial = await ptNoShow(c); // PT 100,000 + platform 25,000 -> client +125,000, unpaid 125,000
    await cutPending("PLATFORM", "REVENUE", 50_000); // platform pending 50,000 -> 0
    const none = await ptNoShow(c); // PT 0 + platform 0 -> client +0, unpaid 250,000

    for (const token of [c.clientToken, c.ptToken]) {
      const m = await states(c, token);
      const pick = (id: string) => {
        const s = m.get(id);
        return [s.status, s.refundState, s.refundedAmount, s.refundPendingAmount];
      };
      assert.deepEqual(pick(full.id), ["NO_SHOW", "FULL", "250000.00", "0.00"]);
      assert.deepEqual(pick(partial.id), ["NO_SHOW", "PARTIAL", "125000.00", "125000.00"]);
      assert.deepEqual(pick(none.id), ["NO_SHOW", "PENDING", "0.00", "250000.00"]);
    }
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 250_000 + 125_000, "the wallet agrees with the states");

    // an authorised person handles one outside the ledger (RESOLVED) and waives the other: the live status wins, nothing is paid by it
    const obs = await obligations(c.txnId);
    assert.equal(obs.length, 2);
    const cli = (op: string, id: string, unpaid: string, ref: string) =>
      execFileSync(process.execPath, ["--import", "tsx", "scripts/fh8-adjust.ts", `--op=${op}`, `--id=${id}`, `--expected-amount=${unpaid}`, `--expected-transaction-id=${c.txnId}`, "--reason=handled outside the ledger ref BT-9", "--approved-by=owner-test", `--approval-ref=${ref}`, "--apply"], {
        cwd: path.resolve(__dirname, "../../../payment-service"),
        env: { ...process.env, DATABASE_URL: process.env.E2E_PAYMENT_DATABASE_URL ?? PAYMENT_DB_URL },
        encoding: "utf8",
        windowsHide: true,
      });
    cli("obligation-resolve", obs.find((o) => o.key === `PT_NO_SHOW:${partial.id}`).id, "125000.00", "APR-10");
    cli("obligation-waive", obs.find((o) => o.key === `PT_NO_SHOW:${none.id}`).id, "250000.00", "APR-11");
    const after = await states(c, c.clientToken);
    assert.deepEqual([after.get(partial.id).refundState, after.get(partial.id).refundPendingAmount], ["FULL", "0.00"], "RESOLVED = handled with a reference");
    assert.deepEqual([after.get(none.id).refundState, after.get(none.id).refundPendingAmount], ["PENDING", "0.00"], "WAIVED: the client was NOT paid - never FULL, nothing pending");
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 375_000, "resolving / waiving moved no money");
    for (const s of after.values()) assert.notEqual(s.status, "COMPLETED", "a PT-fault session is never presented as delivered");
  });
});

// ── a PT no-show whose compensation was never performed, then NATURAL COMPLETION (no ending drain) ─────────────────────────
// 1,000,000 / 4 sessions -> one session = 250,000 (PT 225,000 + platform 25,000).

test("natural completion with a never-performed NO_SHOW: exactly ONE OPEN obligation (owed 250,000 / paid 0) under PT_NO_SHOW:<session>, no money, retried and concurrent sweeps change nothing, visible to the admin, the client sees 'PENDING' (never refunded), FH-8 resolve works", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 4 });
    await H.deliver(c, 2);
    // the PT no-show happens while payment-service is down: the session is NO_SHOW, its compensation row FAILED
    const ns = await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 6 * DAY));
    await H.stopPayment();
    const noShow = await H.call("PATCH", `/sessions/${ns.id}/no-show`, c.ptToken, { noShowBy: "PT" });
    assert.equal(noShow.status, 200, JSON.stringify(noShow.body));
    await H.startPayment();
    const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${ns.id}` } });
    assert.equal(row.status, "FAILED", "the compensation is recorded but unsettled");
    assert.equal((await obligations()).length, 0);

    // the contract then completes NATURALLY (2 + 2 delivered); nobody drains the NO_SHOW row
    await H.deliver(c, 2);
    const done = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.compensatedSessions, 0);
    const before = await H.snapshot();

    // sweeps: one after the other, then several at once (the settle function is the apply-once gate)
    const sweep = (await import("../services/session-settlement-sweep.service")).runSettlementSweep;
    await sweep();
    await Promise.all([1, 2, 3].map(() => H.m.payout.settleEndedCompensationRow(row.id)));
    await sweep();

    const obs = await obligations(c.txnId);
    assert.equal(obs.length, 1, "exactly one obligation");
    const o = obs[0];
    assert.equal(o.key, `PT_NO_SHOW:${ns.id}`);
    assert.deepEqual([o.kind, o.party, o.status, o.owed, o.paid, o.unpaid], ["NO_SHOW", "CLIENT", "OPEN", "250000.00", "0.00", "250000.00"]);
    assert.match(o.reason, /PT vắng mặt/);
    const ops: any[] = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `PT_NO_SHOW:${ns.id}`);
    assert.equal(ops[0].n, 1);
    const after = await H.snapshot();
    assert.deepEqual({ ...after, operations: 0 }, { ...before, operations: 0 }, "no wallet, no ledger entry, no receivable moved (only the operation record was added)");
    assert.equal(after.operations, before.operations + 1);
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 0, "the client was not paid");

    const settled = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(settled.status, "SETTLED");
    assert.deepEqual([(settled.result as any).recordedOnly, (settled.result as any).obligationId], [true, o.id]);
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).compensatedSessions, 0, "nothing was compensated");

    // the client's view: never 'refunded'; the PT sees the same facts
    for (const token of [c.clientToken, c.ptToken]) {
      const s = (await states(c, token)).get(ns.id);
      assert.deepEqual([s.status, s.refundState, s.refundedAmount, s.refundPendingAmount], ["NO_SHOW", "PENDING", "0.00", "250000.00"]);
    }
    const notes = await H.m.prisma.notification.findMany({ where: { userId: c.clientUserId } });
    assert.ok(notes.every((x) => !/Đã hoàn|đã hoàn tiền/.test(x.text)), notes.map((x) => x.text).join(" | "));

    // visible to the admin
    const report = await H.adminCall("GET", "/admin/payments/obligations");
    const listed = report.body.data.unpaidObligations.find((x: any) => x.id === o.id);
    assert.ok(listed);
    assert.deepEqual([listed.kind, listed.owed, listed.paid, listed.unpaid, listed.contractId, listed.sessionId], ["NO_SHOW", "250000.00", "0.00", "250000.00", c.id, ns.id]);

    // FH-8 resolve: audited, no money; the session then reads FULL ("handled with a reference")
    execFileSync(process.execPath, ["--import", "tsx", "scripts/fh8-adjust.ts", "--op=obligation-resolve", `--id=${o.id}`, "--expected-amount=250000.00", `--expected-transaction-id=${c.txnId}`, "--reason=client refunded by bank transfer ref BT-5", "--approved-by=owner-test", "--approval-ref=APR-NS-1", "--apply"], {
      cwd: path.resolve(__dirname, "../../../payment-service"),
      env: { ...process.env, DATABASE_URL: process.env.E2E_PAYMENT_DATABASE_URL ?? PAYMENT_DB_URL },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal((await obligations(c.txnId))[0].status, "RESOLVED");
    assert.deepEqual(await H.snapshot(), after, "resolving moved nothing");
    const resolved = (await states(c, c.clientToken)).get(ns.id);
    assert.deepEqual([resolved.refundState, resolved.refundPendingAmount], ["FULL", "0.00"]);
    const ev: any[] = await H.payDb.$queryRawUnsafe(`SELECT action, to_status::text AS t, approval_ref FROM contract_unpaid_obligation_events WHERE obligation_id = $1`, o.id);
    assert.deepEqual(ev.map((e) => [e.action, e.t, e.approval_ref]), [["RESOLVE", "RESOLVED", "APR-NS-1"]]);
  });
});
