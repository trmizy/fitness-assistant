/**
 * D77 follow-up (owner decision, final) - RECORD-ONLY late-arrival obligation. BACKEND INTEGRATION on the real ledger in an
 * isolated *_test database (payment-service only; the cross-service flow is in user-service's cross-service-money-d77-obligation suite).
 *
 * A PT joined late and, when the contract ended, payment-service had never performed `PT_LATE_ARRIVAL:<session>`. The ending
 * records an OPEN unpaid obligation to the client under that SAME key instead of losing it or paying it out of money that is
 * not the session's. Asserted here:
 *   - owed = the late-arrival formula (half a session), paid = 0, unpaid = owed, kind LATE_ARRIVAL, a reason in words;
 *   - NO money moves: wallets, wallet_ledger_entries and escrow are exactly as before; no PartnerReceivable; no pooled draw;
 *   - idempotent: a retry and 4 concurrent calls give ONE obligation and ONE ledger operation; a real compensateLateArrival
 *     arriving later under the key replays the record and cannot also pay the client; a conflicting request is refused (409);
 *   - a key that is not PT_LATE_ARRIVAL:<session> is refused; an operation that WAS performed for real replays its own result
 *     (no second obligation);
 *   - the obligation shows up in the admin obligations report with its reason, and in the ledger lookup with its live status;
 *   - the session's own release is not reduced (nothing was deducted), the contract can still end, the books balance;
 *   - FH-8 resolve and waive work on it, audited, and move no money.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fhg_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/fh-d77-late-obligation.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = {
  skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  adjust: typeof import('../services/adjustment-operations.service');
  report: typeof import('../services/admin-obligations.service');
  lookupRouter: (typeof import('../routes/ledger-operations.routes'))['default'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      adjust: await import('../services/adjustment-operations.service'),
      report: await import('../services/admin-obligations.service'),
      lookupRouter: (await import('../routes/ledger-operations.routes')).default,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Rates = import('../services/contract-money').RateTable;

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE',
  );
}

/** 1.000.000 / 4 sessions: one session = 250.000 (PT 225.000 + platform 25.000); a late arrival costs 125.000. */
async function paidContract(m: Mods, id: string) {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const price = D('1000000');
  const clientUserId = `client-${id}`;
  const parties = { ptUserId: 'pt-d77o', gymId: null as string | null, clientUserId };
  const rates: Rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test',
      metadata: { rates: { platformRate: '0.1', ptRate: '0.9', gymRate: '0' }, parties },
    },
  });
  const c = { id, txnId: txn.id, parties, price, total: 4, rates };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price, rates, parties, label: `PT_CONTRACT ${id}` });
  return c;
}
type Contract = Awaited<ReturnType<typeof paidContract>>;

const base = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.total, rates: c.rates, parties: c.parties });
const key = (c: Contract, s: string) => `PT_LATE_ARRIVAL:${c.id}:${s}`;
const REASON = 'D77: the PT joined late; the ledger never performed the compensation before the contract ended';
const record = (m: Mods, c: Contract, s: string, reason = REASON) =>
  m.ledger.recordLateArrivalObligation({ ...base(c), label: `Contract ${c.id} PT late arrival ${s}`, idempotencyKey: key(c, s), reason });
const release = (m: Mods, c: Contract, s: string) =>
  m.ledger.releaseSession({ ...base(c), label: `Contract ${c.id} session ${s}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${s}` });

/** Everything that proves "no money moved". */
async function moneyState(m: Mods) {
  const wallets = await m.prisma.$queryRawUnsafe<{ t: string; id: string; a: string; p: string; l: string }[]>(
    `SELECT owner_type::text AS t, owner_id AS id, available_balance::text AS a, pending_balance::text AS p, locked_balance::text AS l FROM wallets ORDER BY 1, 2`,
  );
  return {
    wallets: wallets.map((w) => `${w.t}:${w.id}:${w.a}/${w.p}/${w.l}`),
    entries: await m.prisma.walletLedgerEntry.count(),
    receivables: await m.prisma.partnerReceivable.count(),
  };
}

async function assertBooksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
}

test('record-only: owed 125.000 / paid 0 / unpaid 125.000, kind LATE_ARRIVAL, reason stored, and NOT ONE money row is written', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const before = await moneyState(m);

  const out = await record(m, A, 's1');
  assert.deepEqual([out.owed, out.paid, out.unpaid, out.compensation, out.shortfall], ['125000.00', '0.00', '125000.00', '0.00', '125000.00']);
  assert.deepEqual(out.charged, { pt: '0.00', gym: '0.00', platform: '0.00' });
  assert.equal(out.recordedOnly, true);
  assert.ok(out.obligationId);

  const row = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: out.obligationId! } });
  assert.equal(row.key, key(A, 's1'), 'keyed on the ORIGINAL PT_LATE_ARRIVAL key');
  assert.equal(row.kind, 'LATE_ARRIVAL');
  assert.equal(row.party, 'CLIENT');
  assert.equal(row.status, 'OPEN');
  assert.equal(row.transactionId, A.txnId);
  assert.deepEqual([row.owed.toFixed(2), row.paid.toFixed(2), row.unpaid.toFixed(2)], ['125000.00', '0.00', '125000.00']);
  assert.equal(row.reason, REASON);

  assert.deepEqual(await moneyState(m), before, 'wallets, ledger entries and receivables are exactly as before: no money moved, no PT debt');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: key(A, 's1') } }), 1, 'the operation is recorded under the key');
  await assertBooksSound(m, 'record-only');
});

test('idempotent: a retry and 4 concurrent calls -> ONE obligation, ONE operation; a conflicting request under the key is refused', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const first = await record(m, A, 's1');
  const again = await record(m, A, 's1');
  assert.deepEqual(again, first);
  const raced = await Promise.all([1, 2, 3, 4].map(() => record(m, A, 's1')));
  for (const r of raced) assert.deepEqual(r, first);
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { key: key(A, 's1') } }), 1);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: key(A, 's1') } }), 1);

  // the same key for a different request is refused, not silently replayed
  await assert.rejects(
    m.ledger.recordLateArrivalObligation({ ...base(A), totalSessions: 8, label: 'x', idempotencyKey: key(A, 's1'), reason: REASON }),
    (e: Error) => (e as Error & { code?: string }).code === 'IDEMPOTENCY_KEY_CONFLICT',
  );
  // a different session of the same contract is its own obligation
  const other = await record(m, A, 's2');
  assert.notEqual(other.obligationId, first.obligationId);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 2);
  await assertBooksSound(m, 'idempotent');
});

test('a real compensateLateArrival arriving LATER under the same key replays the record: the client is NOT also paid', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const rec = await record(m, A, 's1');
  const before = await moneyState(m);
  const late = await m.ledger.compensateLateArrival({ ...base(A), label: 'slow call', idempotencyKey: key(A, 's1') });
  assert.deepEqual(late, rec, 'the slow call gets the stored record-only result');
  assert.deepEqual(await moneyState(m), before, 'and moves nothing');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
});

test('an operation that WAS performed for real replays its own result: no obligation is added by the record call', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const real = await m.ledger.compensateLateArrival({ ...base(A), label: 'real', idempotencyKey: key(A, 's1') });
  assert.deepEqual([real.owed, real.paid, real.unpaid], ['125000.00', '125000.00', '0.00']);
  const before = await moneyState(m);
  const rec = await record(m, A, 's1');
  assert.deepEqual(rec, real);
  assert.equal((rec as { recordedOnly?: boolean }).recordedOnly, undefined, 'the caller can tell it was a real payment');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  assert.deepEqual(await moneyState(m), before);
});

test('a key that is not PT_LATE_ARRIVAL:<session> is refused and records nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  for (const k of ['SESSION_RELEASE:x', 'PT_NO_SHOW:x', 'PT_LATE_ARRIVAL:']) {
    await assert.rejects(m.ledger.recordLateArrivalObligation({ ...base(A), label: 'x', idempotencyKey: k, reason: REASON }), /PT_LATE_ARRIVAL/);
  }
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  assert.equal(await m.prisma.ledgerOperation.count(), 0);
});

test('the session still releases in FULL (nothing was deducted), the contract can end, the books balance', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await record(m, A, 's1');
  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' }, 'the PT is paid the whole session: the record deducted nothing');
  assert.deepEqual(r.lateArrivalDeducted, { pt: '0.00', gym: '0.00', platform: '0.00' });
  const D = (v: string) => new m.Prisma.Decimal(v);
  const out = await m.ledger.terminateContract({
    ...base(A), usedSessions: 1, compensatedSessions: 0, reason: 'CLIENT_CANCELLED',
    alreadyReleased: { pt: D(r.released.pt), gym: D('0'), platform: D(r.released.platform) },
    label: `Contract ${A.id} termination`, idempotencyKey: `CONTRACT_TERMINATE:${A.id}`,
  });
  assert.deepEqual([out.unpaid, out.shortfall], ['0.00', '0.00']);
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { status: 'OPEN' } }), 1, 'the late-arrival obligation is still the only open one');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  await assertBooksSound(m, 'release + terminate');
});

test('a record-only (charged 0) compensation does not take the "open" slot of a real one: the held session still gets ITS deduction', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await record(m, A, 'zero'); // created first: nothing was charged
  const real = await m.ledger.compensateLateArrival({ ...base(A), label: 'real', idempotencyKey: key(A, 'held1') });
  assert.equal(real.paid, '125000.00');
  const lateArrival = await m.ledger.loadLateArrivalDeductions(m.prisma, A.txnId, 1);
  assert.deepEqual(
    [lateArrival.open.pt.toFixed(2), lateArrival.open.platform.toFixed(2), lateArrival.settled.pt.toFixed(2)],
    ['112500.00', '12500.00', '0.00'],
    'the one held session is attributed the REAL compensation, not the empty record',
  );
  await assertBooksSound(m, 'open slot');
});

test('visible: the admin obligations report lists it with reason / owed / paid / unpaid, the ledger lookup carries its live status', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const rec = await record(m, A, 's1');
  const report = await m.report.buildObligationsReport({ limit: 50 });
  const listed = report.unpaidObligations.find((o) => o.id === rec.obligationId);
  assert.ok(listed, 'in /admin/payments/obligations');
  assert.deepEqual([listed.kind, listed.party, listed.status, listed.owed, listed.paid, listed.unpaid], ['LATE_ARRIVAL', 'CLIENT', 'OPEN', '125000.00', '0.00', '125000.00']);
  assert.equal(listed.reason, REASON);
  // the REAL contract id (the payment transaction's related contract) and the session, not the word "Contract" cut out of a label
  assert.equal(listed.contractId, 'A');
  assert.equal(listed.contract, 'A');
  assert.equal(listed.sessionId, 'A:s1');
  assert.notEqual(listed.contract, 'Contract');
  assert.deepEqual(report.summary.unpaidObligations.open, { count: 1, unpaid: '125000.00' });

  // the lookup route user-service reads (mounted standalone: no service-secret middleware in this test)
  const app = express();
  app.use(express.json());
  app.use('/ledger-operations', m.lookupRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  try {
    const one: any = await (await fetch(`${url}/ledger-operations/${encodeURIComponent(key(A, 's1'))}`)).json();
    assert.equal(one.data.kind, 'LATE_ARRIVAL');
    assert.deepEqual(one.data.obligation, { id: rec.obligationId, status: 'OPEN', owed: '125000.00', paid: '0.00', unpaid: '125000.00' });
    // after an authorised person handles it, the lookup says so
    await m.adjust.adjustObligation({
      obligationId: rec.obligationId!, expectedUnpaid: '125000.00', expectedTransactionId: A.txnId, action: 'RESOLVE',
      note: 'paid to the client by bank transfer, ref BT-77', actor: 'owner-test', approvalRef: 'APR-77', dryRun: false,
    });
    const many: any = await (
      await fetch(`${url}/ledger-operations/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: [key(A, 's1'), 'PT_LATE_ARRIVAL:nope'] }) })
    ).json();
    assert.equal(many.data.operations[0].obligation.status, 'RESOLVED');
    assert.deepEqual(many.data.missing, ['PT_LATE_ARRIVAL:nope']);
  } finally {
    await new Promise((r) => server.close(r));
  }
  const after = await m.report.buildObligationsReport({ limit: 50 });
  assert.equal(after.unpaidObligations.some((o) => o.id === rec.obligationId), false, 'a resolved obligation leaves the open list');
  assert.deepEqual(after.summary.unpaidObligations.open, { count: 0, unpaid: '0.00' });
  assert.equal(after.summary.unpaidObligations.resolved.count, 1);
});

test('FH-8 on it: dry-run writes nothing; RESOLVE and WAIVE are audited, idempotent, and move no money', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const a = await record(m, A, 's1');
  const b = await record(m, A, 's2');
  const money0 = await moneyState(m);
  const ops0 = await m.prisma.ledgerOperation.count();

  const resolve = { obligationId: a.obligationId!, expectedUnpaid: '125000.00', expectedTransactionId: A.txnId, action: 'RESOLVE' as const, note: 'handled outside the ledger, payout ref BT-77', actor: 'owner-test', approvalRef: 'APR-1' };
  const dry = await m.adjust.adjustObligation({ ...resolve, dryRun: true });
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal((await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: a.obligationId! } })).status, 'OPEN', 'dry-run changed nothing');
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 0);

  const applied = await m.adjust.adjustObligation({ ...resolve, dryRun: false });
  assert.equal(applied.outcome, 'APPLIED');
  const replay = await m.adjust.adjustObligation({ ...resolve, dryRun: false });
  assert.equal(replay.outcome, 'REPLAYED');
  const ra = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: a.obligationId! } });
  assert.equal(ra.status, 'RESOLVED');
  assert.equal(ra.resolvedBy, 'owner-test');
  assert.match(ra.resolvedNote ?? '', /BT-77/);
  assert.equal(ra.unpaid.toFixed(2), '125000.00', 'the figures are history: never rewritten, never marked paid');
  assert.equal(ra.reason, REASON);

  await m.adjust.adjustObligation({ ...resolve, obligationId: b.obligationId!, action: 'WAIVE', note: 'owner decided not to pursue (minute 12)', approvalRef: 'APR-2', dryRun: false });
  assert.equal((await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: b.obligationId! } })).status, 'WAIVED');

  const events = await m.prisma.contractUnpaidObligationEvent.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(events.map((e) => [e.action, e.fromStatus, e.toStatus, e.actor, e.approvalRef]), [
    ['RESOLVE', 'OPEN', 'RESOLVED', 'owner-test', 'APR-1'],
    ['WAIVE', 'OPEN', 'WAIVED', 'owner-test', 'APR-2'],
  ]);
  assert.deepEqual(await moneyState(m), money0, 'no money moved by resolving or waiving');
  assert.equal(await m.prisma.ledgerOperation.count(), ops0, 'and no ledger operation was written');
  await assertBooksSound(m, 'FH-8');
});

// ── the same mechanism for a PT no-show the ledger never performed before the contract ended ──────────────────────────────

const nsKey = (c: Contract, s: string) => `PT_NO_SHOW:${c.id}:${s}`;
const recordNs = (m: Mods, c: Contract, s: string) =>
  m.ledger.recordNoShowObligation({ ...base(c), label: `Contract ${c.id} no-show ${s}`, idempotencyKey: nsKey(c, s), reason: 'PT vắng mặt: khoản hoàn tiền chưa được thực hiện trước khi hợp đồng kết thúc' });

test('NO_SHOW record-only: owed = ONE session (250.000) / paid 0, kind NO_SHOW, original key, NO money row; retried and 4 concurrent calls -> one obligation', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const before = await moneyState(m);
  const out = await recordNs(m, A, 's1');
  assert.deepEqual([out.owed, out.paid, out.unpaid, out.compensation, out.recordedOnly], ['250000.00', '0.00', '250000.00', '0.00', true]);
  const row = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: out.obligationId! } });
  assert.deepEqual([row.key, row.kind, row.party, row.status], [nsKey(A, 's1'), 'NO_SHOW', 'CLIENT', 'OPEN']);
  assert.match(row.reason ?? '', /PT vắng mặt/);
  assert.deepEqual(await moneyState(m), before, 'no wallet, entry or receivable moved');
  const again = await recordNs(m, A, 's1');
  const raced = await Promise.all([1, 2, 3, 4].map(() => recordNs(m, A, 's1')));
  for (const r of [again, ...raced]) assert.deepEqual(r, out);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: nsKey(A, 's1') } }), 1);
  // a slow REAL compensateNoShow arriving later replays the record: the client is not also paid
  const slow = await m.ledger.compensateNoShow({ ...base(A), label: 'slow', idempotencyKey: nsKey(A, 's1') });
  assert.deepEqual(slow, out);
  assert.deepEqual(await moneyState(m), before);
  // a late-arrival key is refused by the no-show operation, and the other way round
  await assert.rejects(m.ledger.recordNoShowObligation({ ...base(A), label: 'x', idempotencyKey: key(A, 'z'), reason: REASON }), /PT_NO_SHOW/);
  await assert.rejects(m.ledger.recordLateArrivalObligation({ ...base(A), label: 'x', idempotencyKey: nsKey(A, 'z'), reason: REASON }), /PT_LATE_ARRIVAL/);
  await assertBooksSound(m, 'no-show record');
});

test('NO_SHOW record-only: visible in the admin report with the real contract and session id; FH-8 waive is audited and moves no money', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const rec = await recordNs(m, A, 's1');
  const report = await m.report.buildObligationsReport({ limit: 50 });
  const listed = report.unpaidObligations.find((o) => o.id === rec.obligationId)!;
  assert.deepEqual([listed.kind, listed.status, listed.owed, listed.paid, listed.unpaid, listed.contractId, listed.sessionId], ['NO_SHOW', 'OPEN', '250000.00', '0.00', '250000.00', 'A', 'A:s1']);
  const money0 = await moneyState(m);
  const r = await m.adjust.adjustObligation({
    obligationId: rec.obligationId!, expectedUnpaid: '250000.00', expectedTransactionId: A.txnId, action: 'WAIVE',
    note: 'owner decided not to pursue (minute 3)', actor: 'owner-test', approvalRef: 'APR-NS', dryRun: false,
  });
  assert.equal(r.outcome, 'APPLIED');
  assert.equal((await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: rec.obligationId! } })).status, 'WAIVED');
  assert.deepEqual(await moneyState(m), money0);
  await assertBooksSound(m, 'no-show waive');
});

test('NO_SHOW record-only: FH-8 RESOLVE is audited and moves no money; RESOLVED is record-keeping (not "paid"), leaves the open list and cannot be re-decided', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const rec = await recordNs(m, A, 's1');
  const money0 = await moneyState(m);
  const ops0 = await m.prisma.ledgerOperation.count();
  const r = await m.adjust.adjustObligation({
    obligationId: rec.obligationId!, expectedUnpaid: '250000.00', expectedTransactionId: A.txnId, action: 'RESOLVE',
    note: 'paid outside the ledger, payout ref BT-NS-1', actor: 'owner-test', approvalRef: 'APR-NS-R', dryRun: false,
  });
  assert.equal(r.outcome, 'APPLIED');
  const row = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: rec.obligationId! } });
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.paid.toFixed(2), '0.00', 'RESOLVED never marks the obligation paid');
  assert.equal(row.unpaid.toFixed(2), '250000.00');
  const ev = await m.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId: rec.obligationId! } });
  assert.deepEqual(ev.map((e) => [e.action, e.fromStatus, e.toStatus, e.actor, e.approvalRef]), [['RESOLVE', 'OPEN', 'RESOLVED', 'owner-test', 'APR-NS-R']]);
  assert.deepEqual(await moneyState(m), money0, 'no money moved');
  assert.equal(await m.prisma.ledgerOperation.count(), ops0, 'no ledger operation written');
  const report = await m.report.buildObligationsReport({ limit: 50 });
  assert.equal(report.unpaidObligations.some((o) => o.id === rec.obligationId), false);
  assert.equal(report.summary.unpaidObligations.resolved.count, 1);
  await assert.rejects(
    m.adjust.adjustObligation({ obligationId: rec.obligationId!, expectedUnpaid: '250000.00', expectedTransactionId: A.txnId, action: 'WAIVE', note: 'changed my mind', actor: 'owner-test', approvalRef: 'APR-NS-W', dryRun: false }),
    /already RESOLVED/,
  );
  await assertBooksSound(m, 'no-show resolve');
});
