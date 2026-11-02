/**
 * D77 LEDGER FINAL (Ngai, 01/11/2026) - phuong an A - BACKEND INTEGRATION, real ledger, isolated *_test database. PINS expectations (not a probe).
 *
 * An OPEN late-arrival obligation L of a session is paid to the client INSIDE the settlement of that session (release / resolve / no-show), from the session's own
 * pending, under the wallet locks + a row lock on the obligation, with real wallet_ledger_entries, obligation.paid/unpaid, a SETTLE_VIA_LEDGER event and status
 * PAID_VIA_LEDGER (only when fully paid). Invariants I-1 .. I-8 of docs/DISPUTE_CASE_L_OPEN_SETTLEMENT_DESIGN.md are asserted as MONEY TO THE RIGHT PEOPLE, not only a
 * balanced book: client / PT / gym / platform AVAILABLE, the contract's pending, the obligation, the events.
 *
 * Numbers: 1.000.000 / 4 sessions: V = 250.000, L = 125.000. No gym PT 90% / platform 10%; gym PT 55% / gym 35% / platform 10%.
 * "OPEN whole" = the REAL record-only door (charged 0). "OPEN partial": a REAL shortage (rounding: 1.000.000 / 3 leaves L short by 2 dong) and a TEST FIXTURE (wallet cut by hand).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables), through the guarded preload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
// Fail-closed ledger switch (services/late-open-settlement-flag.ts): these cases PAY an OPEN L, so the suite turns it on in-process (the database already ends _test; nothing else is changed).
process.env.NODE_ENV = 'test';
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = 'true';

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  adj: typeof import('../services/adjustment-operations.service');
  lc: typeof import('../services/obligation-payment-lifecycle.service');
  report: typeof import('../services/admin-obligations.service');
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
      adj: await import('../services/adjustment-operations.service'),
      lc: await import('../services/obligation-payment-lifecycle.service'),
      report: await import('../services/admin-obligations.service'),
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
type Rates = import('../services/contract-money').RateTable;
type OwnerType = 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE',
  );
}

interface Contract {
  id: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  total: number;
  rates: Rates;
}

async function paidContract(m: Mods, id: string, o: { gym?: boolean; price?: number; total?: number } = {}): Promise<Contract> {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const clientUserId = `client-${id}`;
  const parties = { ptUserId: 'pt-lo', gymId: o.gym ? 'gym-lo' : null, clientUserId };
  const rates: Rates = o.gym
    ? { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') }
    : { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const price = o.price ?? 1_000_000;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  const c: Contract = { id, txnId: txn.id, parties, price: D(String(price)), total: o.total ?? 4, rates };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${id}` });
  return c;
}

const base = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.total, rates: c.rates, parties: c.parties });
const late = (m: Mods, c: Contract, s: string) => m.ledger.compensateLateArrival({ ...base(c), label: `late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}` });
const recordLate = (m: Mods, c: Contract, s: string) =>
  m.ledger.recordLateArrivalObligation({ ...base(c), label: `late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}`, reason: 'ending: D77 never performed' });
const noShow = (m: Mods, c: Contract, s: string, flag = true) =>
  m.ledger.compensateNoShow({ ...base(c), label: `no-show ${s}`, idempotencyKey: `PT_NO_SHOW:${c.id}:${s}`, settleLateOpen: flag });
const release = (m: Mods, c: Contract, s: string, flag = true) =>
  m.ledger.releaseSession({ ...base(c), label: `session ${s}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${s}`, settleLateOpen: flag });
const resolve = (m: Mods, c: Contract, s: string, outcome: 'DELIVERED' | 'NOT_DELIVERED', flag = true) =>
  m.ledger.resolveUnresolvedSession({ ...base(c), label: `unresolved ${s}`, idempotencyKey: `UNRESOLVED_SESSION:${c.id}:${s}`, outcome, settleLateOpen: flag });

async function wallet(m: Mods, t: OwnerType, id: string) {
  const w = await m.wallet.getOrCreateWallet(t, id);
  return { pending: Number(w.pendingBalance), available: Number(w.availableBalance) };
}
/** Who holds what, per party and bucket (single contract in the database). */
async function money(m: Mods, c: Contract) {
  const pt = await wallet(m, 'PT', c.parties.ptUserId);
  const gym = c.parties.gymId ? await wallet(m, 'GYM', c.parties.gymId) : { pending: 0, available: 0 };
  const plat = await wallet(m, 'PLATFORM', 'REVENUE');
  const client = (await wallet(m, 'CLIENT', c.parties.clientUserId)).available;
  const pending = pt.pending + gym.pending + plat.pending;
  const sum = client + pt.available + gym.available + plat.available + pending;
  return { client, pt: pt.available, gym: gym.available, platform: plat.available, pending, sum };
}
async function oblig(m: Mods, key: string) {
  const r = await m.prisma.contractUnpaidObligation.findUnique({ where: { key } });
  return r ? { id: r.id, status: r.status as string, owed: Number(r.owed), paid: Number(r.paid), unpaid: Number(r.unpaid), verifiedPaid: Number(r.verifiedPaid) } : null;
}
const lkey = (c: Contract, s: string) => `PT_LATE_ARRIVAL:${c.id}:${s}`;
async function events(m: Mods, obligationId: string) {
  return m.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId }, orderBy: { createdAt: 'asc' } });
}
async function rowsCount(m: Mods) {
  return { entries: await m.prisma.walletLedgerEntry.count(), ops: await m.prisma.ledgerOperation.count(), events: await m.prisma.contractUnpaidObligationEvent.count(), obligations: await m.prisma.contractUnpaidObligation.count() };
}
async function booksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${context}: no PT debt`);
}
const refused = (code: string) => (e: any) => {
  assert.equal(e?.code, code, String(e?.message));
  assert.equal(e?.status, 409);
  return true;
};

// ═════════ case 3 / 6 / 15 / 18 at the ledger: pinned by hand ═════════

test('CASE 3 (COMPLETED, running, L OPEN whole): the client is PAID L inside the release; PT 112.500 / platform 12.500; pending 750.000; PAID_VIA_LEDGER + event; replay changes nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const before = await money(m, A);
  assert.deepEqual([before.client, before.pending], [0, 1_000_000]);
  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.deepEqual((r as any).lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  const li = (r as any).lateOpenSettled;
  assert.deepEqual([li.amount, li.fromStatus, li.toStatus], ['125000.00', 'OPEN', 'PAID_VIA_LEDGER']);
  const after = await money(m, A);
  assert.deepEqual(after, { client: 125_000, pt: 112_500, gym: 0, platform: 12_500, pending: 750_000, sum: 1_000_000 }, 'I-1/I-3: client 125k, parties V-L, nothing held back, 3 other sessions untouched');
  const ob = await oblig(m, lkey(A, 's1'));
  assert.deepEqual([ob!.status, ob!.owed, ob!.paid, ob!.unpaid], ['PAID_VIA_LEDGER', 125_000, 125_000, 0], 'I-4');
  const ev = await events(m, ob!.id);
  assert.equal(ev.length, 1, 'I-8');
  assert.deepEqual([ev[0].action, ev[0].fromStatus, ev[0].toStatus, Number(ev[0].paidAmount), Number(ev[0].unpaid), Number(ev[0].unpaidAfter), ev[0].actor], ['SETTLE_VIA_LEDGER', 'OPEN', 'PAID_VIA_LEDGER', 125_000, 125_000, 0, `SESSION_RELEASE:${A.id}:s1`]);
  // I-7: replay - same answer, not one row more, paid not increased
  const rows = await rowsCount(m);
  assert.deepEqual(await release(m, A, 's1'), r);
  assert.deepEqual(await rowsCount(m), rows);
  assert.equal((await oblig(m, lkey(A, 's1')))!.paid, 125_000);
  await booksSound(m, 'case 3');
});

test('CASE 15 (PT_NO_SHOW, running, L OPEN whole): the client gets V (250.000) in cash inside the no-show; PT / platform 0; pending 750.000; L closed PAID_VIA_LEDGER', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const r = await noShow(m, A, 's1');
  assert.deepEqual([r.owed, r.paid, r.unpaid], ['250000.00', '250000.00', '0.00'], 'the step reports the whole session: L open 125k + the rest 125k');
  assert.deepEqual((r as any).lateOpenSettled && [(r as any).lateOpenSettled.amount, (r as any).lateOpenSettled.toStatus], ['125000.00', 'PAID_VIA_LEDGER']);
  assert.deepEqual(await money(m, A), { client: 250_000, pt: 0, gym: 0, platform: 0, pending: 750_000, sum: 1_000_000 });
  const ob = await oblig(m, lkey(A, 's1'));
  assert.deepEqual([ob!.status, ob!.paid, ob!.unpaid], ['PAID_VIA_LEDGER', 125_000, 0]);
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { kind: 'NO_SHOW' } }), 0, 'no second obligation');
  const rows = await rowsCount(m);
  assert.deepEqual(await noShow(m, A, 's1'), r);
  assert.deepEqual(await rowsCount(m), rows);
  await booksSound(m, 'case 15');
});

test('CASE 6 (COMPLETED, contract ENDED, session held, L OPEN whole): resolve DELIVERED pays the client L, parties V-L, pending ends at 0, nothing stuck', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const t = await m.ledger.terminateContract({
    ...base(A), usedSessions: 0, compensatedSessions: 0, unresolvedSessions: 1, unresolvedSessionIds: [`${A.id}:s1`], reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${A.id}`,
  });
  assert.equal(t.refund, '750000.00');
  const held = await money(m, A);
  assert.deepEqual([held.client, held.pending], [750_000, 250_000], 'the held session keeps its WHOLE value (nothing was paid yet)');
  const r = await resolve(m, A, 's1', 'DELIVERED');
  assert.deepEqual(r.moved, { pt: '112500.00', gym: '0.00', platform: '12500.00', client: '125000.00' });
  assert.deepEqual(await money(m, A), { client: 875_000, pt: 112_500, gym: 0, platform: 12_500, pending: 0, sum: 1_000_000 }, 'I-5: pending 0; I-6: nothing to the platform as forfeited share');
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
  const rows = await rowsCount(m);
  assert.deepEqual(await resolve(m, A, 's1', 'DELIVERED'), r);
  assert.deepEqual(await rowsCount(m), rows);
  await booksSound(m, 'case 6');
});

test('CASE 18 (PT_NO_SHOW, contract ENDED, session held, L OPEN whole): resolve NOT_DELIVERED -> the client has the whole V for the session (L 125k + 125k); pending 0; parties 0', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.ledger.terminateContract({
    ...base(A), usedSessions: 0, compensatedSessions: 0, unresolvedSessions: 1, unresolvedSessionIds: [`${A.id}:s1`], reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${A.id}`,
  });
  const r = await resolve(m, A, 's1', 'NOT_DELIVERED');
  assert.equal(r.moved.client, '250000.00');
  assert.deepEqual(await money(m, A), { client: 1_000_000, pt: 0, gym: 0, platform: 0, pending: 0, sum: 1_000_000 }, 'client: 750k refund + V 250k; nobody else; pending 0');
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
  await booksSound(m, 'case 18');
});

// ═════════ gym 55/35/10: by rate, every party ═════════

test('GYM 55/35/10: L OPEN is paid by the contract rates out of PT / gym / platform, and the parties get V-L by the same rates (release, no-show, resolve)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const G = await paidContract(m, 'G', { gym: true });
  await recordLate(m, G, 's1');
  const r = await release(m, G, 's1');
  assert.deepEqual(r.released, { pt: '68750.00', gym: '43750.00', platform: '12500.00' });
  assert.deepEqual(await money(m, G), { client: 125_000, pt: 68_750, gym: 43_750, platform: 12_500, pending: 750_000, sum: 1_000_000 });
  // no-show on a second session
  await recordLate(m, G, 's2');
  const n = await noShow(m, G, 's2');
  assert.equal(n.paid, '250000.00');
  assert.deepEqual(await money(m, G), { client: 375_000, pt: 68_750, gym: 43_750, platform: 12_500, pending: 500_000, sum: 1_000_000 });
  // a held session resolved DELIVERED
  await recordLate(m, G, 's3');
  const t = await m.ledger.terminateContract({
    ...base(G), usedSessions: 1, compensatedSessions: 1, unresolvedSessions: 1, unresolvedSessionIds: [`${G.id}:s3`], reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal('68750'), gym: new m.Prisma.Decimal('43750'), platform: new m.Prisma.Decimal('12500') }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${G.id}`,
  });
  assert.equal(t.refund, '250000.00');
  const d = await resolve(m, G, 's3', 'DELIVERED');
  assert.deepEqual(d.moved, { pt: '68750.00', gym: '43750.00', platform: '12500.00', client: '125000.00' });
  assert.deepEqual(await money(m, G), { client: 375_000 + 250_000 + 125_000, pt: 137_500, gym: 87_500, platform: 25_000, pending: 0, sum: 1_000_000 });
  await booksSound(m, 'gym');
});

// ═════════ partial (shortage): pays what exists, the rest stays OPEN, never faked ═════════

test('PARTIAL, REAL shortage (1.000.000 / 3 sessions: rounding leaves L short by 2 dong): the part that exists is paid, 2 dong stay OPEN, status stays OPEN, no PAID', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A', { total: 3 });
  await noShow(m, A, 'n1');
  await noShow(m, A, 'n2');
  await late(m, A, 'p'); // 166.667 paid
  const l = await late(m, A, 'x'); // pending is 166.665: partial
  assert.deepEqual([l.owed, l.paid, l.unpaid], ['166667.00', '166665.00', '2.00']);
  const before = await money(m, A);
  assert.equal(before.pending, 0);
  const r = await release(m, A, 'x'); // nothing left to pay the 2 dong from
  assert.equal((r as any).lateOpenSettled.amount, '0.00');
  const ob = await oblig(m, lkey(A, 'x'));
  assert.deepEqual([ob!.status, ob!.paid, ob!.unpaid], ['OPEN', 166_665, 2], 'no PAID without money');
  assert.deepEqual(await rowsCount(m).then((x) => x.events), 0, 'no event: nothing was paid by the ledger');
  assert.deepEqual(await money(m, A), before);
  await booksSound(m, 'partial real');
});

test('PARTIAL, TEST FIXTURE (wallet cut by hand: PT pending -850.000, platform -100.000 BEFORE the late arrival): L charged 50.000 / OPEN 75.000; release pays 0 more, OPEN stays, not PAID', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  for (const [t, id, cut] of [['PT', 'pt-lo', 850_000], ['PLATFORM', 'REVENUE', 100_000]] as const) {
    await m.prisma.$executeRawUnsafe(`UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`, t, id);
    await m.prisma.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
  }
  const l = await late(m, A, 's1');
  assert.deepEqual([l.paid, l.unpaid], ['50000.00', '75000.00']);
  const r = await release(m, A, 's1');
  assert.equal((r as any).lateOpenSettled.amount, '0.00');
  const ob = await oblig(m, lkey(A, 's1'));
  assert.deepEqual([ob!.status, ob!.paid, ob!.unpaid], ['OPEN', 50_000, 75_000]);
  assert.equal((await money(m, A)).client, 50_000);
});

// ═════════ refusals: nothing written, a person decides ═════════

test('NO FLAG (settleLateOpen absent) with an OPEN L: the session step is REFUSED 409 LATE_OPEN_FLAG_REQUIRED and NOTHING is written (no op, no entry, no event)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const rows = await rowsCount(m);
  const mon = await money(m, A);
  await assert.rejects(release(m, A, 's1', false), refused('LATE_OPEN_FLAG_REQUIRED'));
  await assert.rejects(noShow(m, A, 's1', false), refused('LATE_OPEN_FLAG_REQUIRED'));
  assert.deepEqual(await rowsCount(m), rows);
  assert.deepEqual(await money(m, A), mon);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: { startsWith: 'SESSION_RELEASE:' } } }), 0, 'no success result stored');
  // the same step with the flag works afterwards (nothing was poisoned)
  await release(m, A, 's1', true);
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
});

for (const status of ['UNDER_REVIEW', 'APPROVED_FOR_PAYMENT', 'AWAITING_EVIDENCE', 'PAID_VERIFIED', 'RESOLVED_OTHER', 'PAID_EXTERNALLY', 'RESOLVED'] as const) {
  test(`obligation ${status} (TEST FIXTURE status set directly): the session step is REFUSED 409 LATE_OPEN_NEEDS_RECONCILIATION, nothing written, the money stays PENDING`, skipOpts, async () => {
    const m = await load();
    await reset(m);
    const A = await paidContract(m, 'A');
    await recordLate(m, A, 's1');
    await m.prisma.contractUnpaidObligation.update({ where: { key: lkey(A, 's1') }, data: { status } });
    const rows = await rowsCount(m);
    const mon = await money(m, A);
    await assert.rejects(release(m, A, 's1'), refused('LATE_OPEN_NEEDS_RECONCILIATION'));
    await assert.rejects(noShow(m, A, 's1'), refused('LATE_OPEN_NEEDS_RECONCILIATION'));
    assert.deepEqual(await rowsCount(m), rows);
    assert.deepEqual(await money(m, A), mon);
    assert.equal((await oblig(m, lkey(A, 's1')))!.status, status, 'the obligation is untouched');
  });
}

test('OPEN with verified outside-the-ledger money (verifiedPaid > 0) or an OPEN payment row: REFUSED, nothing written (no double payment)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.prisma.contractUnpaidObligation.update({ where: { key: lkey(A, 's1') }, data: { verifiedPaid: 50_000, unpaid: 75_000 } });
  const rows = await rowsCount(m);
  await assert.rejects(release(m, A, 's1'), refused('LATE_OPEN_NEEDS_RECONCILIATION'));
  assert.deepEqual(await rowsCount(m), rows);
  await reset(m);
  const B = await paidContract(m, 'B');
  await recordLate(m, B, 's1');
  const ob = await oblig(m, lkey(B, 's1'));
  await m.lc.approveObligationPayment({ obligationId: ob!.id, expectedUnpaid: '125000.00', expectedTransactionId: B.txnId, approvedAmount: '125000', paymentSource: 'MANUAL_CASH', approvedBy: 'owner-lo', approvalRef: 'AP-LO-1', note: 'pay outside the ledger', dryRun: false });
  assert.equal((await oblig(m, lkey(B, 's1')))!.status, 'APPROVED_FOR_PAYMENT');
  await assert.rejects(release(m, B, 's1'), refused('LATE_OPEN_NEEDS_RECONCILIATION'));
  assert.equal((await money(m, B)).client, 0, 'not paid twice: the ledger paid nothing');
});

test('WAIVED before the settlement: nothing is paid, nothing is deducted - the parties get the whole V (Rule 1)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.prisma.contractUnpaidObligation.update({ where: { key: lkey(A, 's1') }, data: { status: 'WAIVED' } });
  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.deepEqual(await money(m, A), { client: 0, pt: 225_000, gym: 0, platform: 25_000, pending: 750_000, sum: 1_000_000 });
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'WAIVED');
});

// ═════════ FH-8 after PAID_VIA_LEDGER; the enum is set in ONE place ═════════

test('after PAID_VIA_LEDGER FH-8 approve / waive / resolve-other / review are REFUSED and change nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await release(m, A, 's1');
  const ob = await oblig(m, lkey(A, 's1'));
  assert.equal(ob!.status, 'PAID_VIA_LEDGER');
  const rows = await rowsCount(m);
  const tries: Array<() => Promise<unknown>> = [
    () => m.lc.approveObligationPayment({ obligationId: ob!.id, expectedUnpaid: '0.00', expectedTransactionId: A.txnId, approvedAmount: '1000', paymentSource: 'MANUAL_CASH', approvedBy: 'owner-lo', approvalRef: 'AP-X', note: 'try', dryRun: false }),
    ...(['WAIVE', 'RESOLVE_OTHER', 'REVIEW', 'RESOLVE'] as const).map(
      (action) => () => m.adj.adjustObligation({ obligationId: ob!.id, expectedUnpaid: '0.00', expectedTransactionId: A.txnId, action, note: 'a note that is long enough', actor: 'owner-lo', approvalRef: `AR-${action}`, dryRun: false } as any),
    ),
  ];
  for (const t of tries) await assert.rejects(t());
  assert.deepEqual(await rowsCount(m), rows);
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
});

test('RACE: FH-8 approve vs the release, both orders (8 rounds): exactly one wins - never a ledger payment AND an outside-the-ledger approval for the same L', skipOpts, async () => {
  const m = await load();
  const tally = { ledger: 0, approved: 0 };
  for (let round = 0; round < 8; round++) {
    await reset(m);
    const A = await paidContract(m, 'A');
    await recordLate(m, A, 's1');
    const ob = await oblig(m, lkey(A, 's1'));
    const approve = () =>
      m.lc.approveObligationPayment({ obligationId: ob!.id, expectedUnpaid: '125000.00', expectedTransactionId: A.txnId, approvedAmount: '125000', paymentSource: 'MANUAL_CASH', approvedBy: 'owner-lo', approvalRef: `AP-R${round}`, note: 'pay outside', dryRun: false });
    const rel = () => release(m, A, 's1');
    const fns = round % 2 ? [rel, approve] : [approve, rel];
    const res = await Promise.allSettled(fns.map((f) => f()));
    const after = await oblig(m, lkey(A, 's1'));
    const payments = await m.prisma.contractUnpaidObligationPayment.count({ where: { obligationId: ob!.id, status: { in: ['APPROVED', 'EVIDENCE_SUBMITTED', 'VERIFIED'] } } });
    const client = (await money(m, A)).client;
    if (after!.status === 'PAID_VIA_LEDGER') {
      tally.ledger++;
      assert.equal(payments, 0, `round ${round}: ledger paid, so no outside payment may exist`);
      assert.equal(client, 125_000);
    } else {
      tally.approved++;
      assert.equal(after!.status, 'APPROVED_FOR_PAYMENT', `round ${round}`);
      assert.equal(payments, 1);
      assert.equal(client, 0, `round ${round}: the release was refused, nothing paid in the ledger`);
      assert.ok(res.some((r) => r.status === 'rejected'), `round ${round}: the loser was refused`);
    }
    await booksSound(m, `race ${round}`);
  }
  assert.equal(tally.ledger + tally.approved, 8);
});

test('PAID_VIA_LEDGER is written in ONE place only (CODE AUDIT of src): the ledger settlement; every other file only reads it', skipOpts, async () => {
  const root = path.resolve(__dirname, '..');
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (['__tests__', 'generated'].includes(f.name)) continue;
        walk(p);
      } else if (/\.ts$/.test(f.name) && fs.readFileSync(p, 'utf8').includes('PAID_VIA_LEDGER')) hits.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  // writers: contract-ledger.service.ts; readers: admin-obligations (report). Nothing in FH-8, routes, CLI or anything else.
  assert.deepEqual(hits.sort(), ['services/admin-obligations.service.ts', 'services/contract-ledger.service.ts']);
  const ledger = fs.readFileSync(path.join(root, 'services/contract-ledger.service.ts'), 'utf8');
  assert.equal((ledger.match(/status: 'PAID_VIA_LEDGER'/g) ?? []).length, 1, 'one assignment');
});

// ═════════ atomicity / crash boundary ═════════

test('CRASH BOUNDARY: a failure AFTER the credit but before the answer (a trigger kills the SETTLE_VIA_LEDGER event insert) rolls EVERYTHING back; the retry then settles once', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const rows = await rowsCount(m);
  const mon = await money(m, A);
  await m.prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION lo_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'probe: crash after the credit'; END; $$ LANGUAGE plpgsql`);
  await m.prisma.$executeRawUnsafe(`CREATE TRIGGER lo_fail_trg BEFORE INSERT ON contract_unpaid_obligation_events FOR EACH ROW WHEN (NEW.action::text = 'SETTLE_VIA_LEDGER') EXECUTE FUNCTION lo_fail()`);
  try {
    await assert.rejects(release(m, A, 's1'));
  } finally {
    await m.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS lo_fail_trg ON contract_unpaid_obligation_events');
    await m.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS lo_fail()');
  }
  assert.deepEqual(await rowsCount(m), rows, 'not one ledger row, op, event or obligation change survived');
  assert.deepEqual(await money(m, A), mon);
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'OPEN');
  const r = await release(m, A, 's1'); // the retry (the sweep)
  assert.equal((r as any).lateOpenSettled.toStatus, 'PAID_VIA_LEDGER');
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 112_500, gym: 0, platform: 12_500, pending: 750_000, sum: 1_000_000 });
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 1);
});

// ═════════ two sessions with L OPEN, concurrency ═════════

test('TWO sessions with L OPEN in one contract settled at the same moment (6 rounds): each pays ITS OWN L from ITS OWN value; client 250.000; parties 2 x (V-L); pending 500.000', skipOpts, async () => {
  const m = await load();
  for (let round = 0; round < 6; round++) {
    await reset(m);
    const A = await paidContract(m, 'A');
    await recordLate(m, A, 's1');
    await recordLate(m, A, 's2');
    await Promise.all(round % 2 ? [release(m, A, 's1'), release(m, A, 's2')] : [release(m, A, 's2'), release(m, A, 's1')]);
    assert.deepEqual(await money(m, A), { client: 250_000, pt: 225_000, gym: 0, platform: 25_000, pending: 500_000, sum: 1_000_000 }, `round ${round}`);
    for (const s of ['s1', 's2']) assert.equal((await oblig(m, lkey(A, s)))!.status, 'PAID_VIA_LEDGER');
    await booksSound(m, `two ${round}`);
  }
});

test('RELEASE and the ENDING, both orders the product can produce (the user-service contract lock serialises them): same final numbers, L paid once, pending 0', skipOpts, async () => {
  const m = await load();
  const zero = () => new m.Prisma.Decimal(0);
  // order 1: S1 is released (L paid from the session), THEN the contract ends with S1 counted as used
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await release(m, A, 's1');
  await m.ledger.terminateContract({
    ...base(A), usedSessions: 1, compensatedSessions: 0, reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal('112500'), gym: zero(), platform: new m.Prisma.Decimal('12500') }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${A.id}`,
  });
  const one = await money(m, A);
  assert.deepEqual(one, { client: 125_000 + 750_000, pt: 112_500, gym: 0, platform: 12_500, pending: 0, sum: 1_000_000 }, 'order 1: no top-up of the L share to PT / platform, no forfeited share');
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 1);
  // order 2: the contract ends FIRST with S1 held, THEN S1 is resolved
  await reset(m);
  const B = await paidContract(m, 'B');
  await recordLate(m, B, 's1');
  await m.ledger.terminateContract({
    ...base(B), usedSessions: 0, compensatedSessions: 0, unresolvedSessions: 1, unresolvedSessionIds: [`${B.id}:s1`], reason: 'MUTUAL',
    alreadyReleased: { pt: zero(), gym: zero(), platform: zero() }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${B.id}`,
  });
  await resolve(m, B, 's1', 'DELIVERED');
  assert.deepEqual(await money(m, B), one, 'order 2 ends exactly where order 1 ends');
  await booksSound(m, 'release and ending');
});

test('a release that reaches the ledger AFTER the ending (S1 NOT held by it) cannot spend the reserve of anything and pays no L (FH-2c fence): nothing is stuck, nothing is paid twice', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.ledger.terminateContract({
    ...base(A), usedSessions: 0, compensatedSessions: 0, reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${A.id}`,
  });
  const after = await money(m, A);
  assert.equal(after.pending, 0);
  const rows = await rowsCount(m);
  // B-1 release gate: a release of a session the ending did NOT hold, reaching the ledger after the ending with an OPEN L, is REFUSED (nothing written) instead of storing an empty success
  await assert.rejects(release(m, A, 's1'), refused('LATE_OPEN_NEEDS_RECONCILIATION'));
  assert.deepEqual(await rowsCount(m), rows);
  assert.deepEqual(await money(m, A), after);
  const ob = await oblig(m, lkey(A, 's1'));
  assert.deepEqual([ob!.status, ob!.paid], ['OPEN', 0], 'L is not paid and not faked');
  await booksSound(m, 'release after ending');
});

// ═════════ Q5: L after the release; the report ═════════

test('Q5: L reaching the ledger AFTER the session was released in full stays OPEN, nothing is paid, and the reconciliation report shows the session, the obligation and the money already released (op key, per party)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await release(m, A, 's1');
  const l = await late(m, A, 's1');
  assert.deepEqual([l.paid, l.unpaid], ['0.00', '125000.00']);
  const rep = await m.report.buildObligationsReport();
  const row = rep.unpaidObligations.find((o) => o.kind === 'LATE_ARRIVAL');
  assert.ok(row, 'listed in the open obligations');
  assert.equal(row!.sessionId, `${A.id}:s1`);
  assert.equal(row!.sessionSettlement?.opKey, `SESSION_RELEASE:${A.id}:s1`);
  assert.deepEqual(row!.sessionSettlement?.moved, { pt: '225000.00', gym: '0.00', platform: '25000.00', client: null });
  assert.equal(row!.sessionSettlement?.releasedBeforeL, true);
  assert.ok(/after the session had been paid out/.test(row!.reason ?? ''), 'the reason in words');
  assert.equal(row!.reviewer, null, 'nobody has taken it yet (assignable through FH-8 REVIEW)');
  // a person takes it: REVIEW names the reviewer
  await m.adj.adjustObligation({ obligationId: row!.id, expectedUnpaid: '125000.00', expectedTransactionId: A.txnId, action: 'REVIEW', note: 'verifying the late arrival', actor: 'reviewer-lo', approvalRef: 'RV-1', dryRun: false } as any);
  const rep2 = await m.report.buildObligationsReport();
  assert.equal(rep2.unpaidObligations.find((o) => o.id === row!.id)?.reviewer, 'reviewer-lo');
});

// ═════════ Q4: the L of a no-show session is never given to another session ═════════

function heldTerminate(m: Mods, c: Contract, o: { used: number; comp: number; held: string[]; released?: { pt: number; platform: number }; ids?: boolean }) {
  return m.ledger.terminateContract({
    ...base(c), usedSessions: o.used, compensatedSessions: o.comp, unresolvedSessions: o.held.length, ...(o.ids === false ? {} : { unresolvedSessionIds: o.held.map((s) => `${c.id}:${s}`) }), reason: 'MUTUAL',
    alreadyReleased: { pt: new m.Prisma.Decimal(o.released?.pt ?? 0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(o.released?.platform ?? 0) }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  });
}

for (const gym of [false, true]) {
  for (const outcome of ['DELIVERED', 'NOT_DELIVERED'] as const) {
    test(`Q4 CASES 13/14 + held X (${gym ? 'gym 55/35/10' : '90/10'}): NO_SHOW(A) with L SETTLED, X held, MUTUAL, X ${outcome}: the L of A is NOT given to X; money to the right people; pending 0`, skipOpts, async () => {
      const m = await load();
      await reset(m);
      const A = await paidContract(m, 'A', { gym });
      await late(m, A, 'a');
      await noShow(m, A, 'a');
      const t = await heldTerminate(m, A, { used: 0, comp: 1, held: ['x'] });
      assert.equal(t.refund, '500000.00', '2 unused sessions refunded');
      assert.equal((t as any).unresolved.amountHeld, '250000.00', 'X holds its WHOLE value (before the fix: 125.000)');
      const mid = await money(m, A);
      assert.deepEqual([mid.client, mid.pending, mid.platform], [750_000, 250_000, 0], 'nothing went to the platform as a forfeited share (I-6)');
      await resolve(m, A, 'x', outcome);
      const end = await money(m, A);
      if (outcome === 'DELIVERED') {
        assert.deepEqual(gym ? { pt: end.pt, gym: end.gym, platform: end.platform } : { pt: end.pt, gym: end.gym, platform: end.platform }, gym ? { pt: 137_500, gym: 87_500, platform: 25_000 } : { pt: 225_000, gym: 0, platform: 25_000 });
        assert.equal(end.client, 750_000);
      } else {
        assert.deepEqual({ pt: end.pt, gym: end.gym, platform: end.platform, client: end.client }, { pt: 0, gym: 0, platform: 0, client: 1_000_000 });
      }
      assert.equal(end.pending, 0);
      assert.equal(end.sum, 1_000_000);
      await booksSound(m, `q4 ${gym} ${outcome}`);
    });
  }
}

test('Q4: X (held) has its OWN L paid in cash and Y is a NO_SHOW with a settled L: X keeps value - L, Y is attributed to nobody; DELIVERED ends with pending 0 and the exact split', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await late(m, A, 'y'); // 125k
  await noShow(m, A, 'y'); // +125k: client 250k
  await late(m, A, 'x'); // 125k for the held session
  const t = await heldTerminate(m, A, { used: 0, comp: 1, held: ['x'] });
  assert.equal((t as any).unresolved.amountHeld, '125000.00', 'X holds V - its own L (125k), not V - L(y)');
  await resolve(m, A, 'x', 'DELIVERED');
  const end = await money(m, A);
  assert.deepEqual(end, { client: 250_000 + 125_000 + 500_000, pt: 112_500, gym: 0, platform: 12_500, pending: 0, sum: 1_000_000 });
  await booksSound(m, 'q4 mixed');
});

test('Q4: two held sessions (X1 with its own L, X2 without) + a NO_SHOW(A) with L: ids make the attribution exact; DELIVERED / NOT_DELIVERED mixed; pending 0; totals exact', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await late(m, A, 'a');
  await noShow(m, A, 'a'); // client 250k
  await late(m, A, 'x1'); // client 375k
  const t = await heldTerminate(m, A, { used: 0, comp: 1, held: ['x1', 'x2'] });
  assert.equal(t.refund, '250000.00', 'remaining = 4 - 0 - 1 - 2 = 1 session');
  assert.equal((t as any).unresolved.amountHeld, '375000.00');
  await resolve(m, A, 'x1', 'DELIVERED'); // PT 112.5k / plat 12.5k
  await resolve(m, A, 'x2', 'NOT_DELIVERED'); // client + 250k
  const end = await money(m, A);
  assert.deepEqual(end, { client: 375_000 + 250_000 + 250_000, pt: 112_500, gym: 0, platform: 12_500, pending: 0, sum: 1_000_000 });
  await booksSound(m, 'q4 two held');
});

test('Q4: a CANCELLED historical session with a settled L (no release / no-show key) does NOT take the held value of X when the caller sends the held ids; the old count-only fallback is measured', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const withIds = await paidContract(m, 'A');
  await late(m, withIds, 'cancelled'); // client 125k, the session was later CANCELLED: no money key
  const t1 = await heldTerminate(m, withIds, { used: 0, comp: 0, held: ['x'] });
  assert.equal((t1 as any).unresolved.amountHeld, '250000.00', 'with ids: X holds its whole value');
  await reset(m);
  const countOnly = await paidContract(m, 'B');
  await late(m, countOnly, 'cancelled');
  const t2 = await heldTerminate(m, countOnly, { used: 0, comp: 0, held: ['x'], ids: false });
  // measured, not endorsed: without ids the "first N compensations without a settlement" fallback still gives the L of the cancelled session to X
  assert.equal((t2 as any).unresolved.amountHeld, '125000.00', 'count-only fallback: X is (wrongly) reduced - this is why user-service now sends the ids');
});

// ═════════ no D77: the ledger is what it was ═════════

test('NO D77 on the session: release / no-show are exactly what they always were, with or without the flag', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const r1 = await release(m, A, 's1', true);
  assert.deepEqual(r1.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.equal((r1 as any).lateOpenSettled, undefined);
  assert.equal((r1 as any).lateArrivalDeducted, undefined);
  const r2 = await release(m, A, 's2', false);
  assert.deepEqual(r2.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  const n = await noShow(m, A, 's3', true);
  assert.deepEqual([n.owed, n.paid, n.charged], ['250000.00', '250000.00', { pt: '225000.00', gym: '0.00', platform: '25000.00' }]);
  assert.equal((n as any).d77, undefined);
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 0);
  await booksSound(m, 'no d77');
});
