/**
 * Final safety gate, P0: a payment transaction is terminated ONCE, whatever the idempotency key.
 *
 * Before the fix, a second `terminateContract` under a DIFFERENT key succeeded with refund 0 and wrote a phantom REFUND_SHORT obligation of the whole price (measured 01/11/2026).
 * Now it is refused 409 CONTRACT_ALREADY_TERMINATED, before any ledger row, obligation or refund is written. The SAME key still replays the first answer. The money formula is not touched.
 *
 * BACKEND INTEGRATION against the isolated *_test payment database. Run THIS FILE ALONE (it TRUNCATEs the ledger).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skipOpts = { skip: isTestDatabaseUrl(process.env.DATABASE_URL || '') ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
}

async function seed(m: Mods, price = 1_000_000, totalSessions = 4) {
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, gymId: null, clientUserId: `client-${suffix}` };
  const txn = await m.prisma.paymentTransaction.create({
    data: { payerId: parties.clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY', providerTransactionId: `vnpay_${suffix}`, idempotencyKey: `contract-${suffix}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `contract-${suffix}`, sourceService: 'integration-test' },
  });
  const rates = { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal('0.90'), gymRate: new m.Prisma.Decimal('0') };
  await m.ledger.settleContractPayment({ transactionId: txn.id, price: new m.Prisma.Decimal(price), rates, parties, label: 'seed' });
  return { txnId: txn.id, parties, price: new m.Prisma.Decimal(price), totalSessions, rates };
}
type F = Awaited<ReturnType<typeof seed>>;
const body = (f: F, key: string) => ({
  transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, usedSessions: 0, compensatedSessions: 0, rates: f.rates, reason: 'MUTUAL' as const,
  alreadyReleased: { pt: new (mods!.Prisma.Decimal)(0), gym: new (mods!.Prisma.Decimal)(0), platform: new (mods!.Prisma.Decimal)(0) }, parties: f.parties, label: 'end', idempotencyKey: key,
});
const state = async (m: Mods, f: F) => ({
  ops: await m.prisma.ledgerOperation.count({ where: { transactionId: f.txnId, kind: 'TERMINATE' } }),
  obligations: await m.prisma.contractUnpaidObligation.count({ where: { transactionId: f.txnId } }),
  refundShort: await m.prisma.contractUnpaidObligation.count({ where: { transactionId: f.txnId, kind: 'REFUND_SHORT' } }),
  entries: await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId } }),
});

test('sequential: the SAME key replays the first answer; ANOTHER key is refused 409 CONTRACT_ALREADY_TERMINATED and writes nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seed(m);
  const key = `CONTRACT_TERMINATE:${f.txnId}`;
  const first = await m.ledger.terminateContract(body(f, key) as any);
  const afterFirst = await state(m, f);
  assert.equal(afterFirst.ops, 1);
  assert.equal(afterFirst.refundShort, 0);

  const replay = await m.ledger.terminateContract(body(f, key) as any);
  assert.deepEqual(replay, first, 'same key: the stored answer');
  assert.deepEqual(await state(m, f), afterFirst);

  await assert.rejects(
    () => m.ledger.terminateContract(body(f, `${key}:other`) as any),
    (e: any) => e instanceof m.ledger.ContractAlreadyTerminatedError && e.status === 409 && e.code === 'CONTRACT_ALREADY_TERMINATED',
  );
  assert.deepEqual(await state(m, f), afterFirst, 'the refusal wrote no operation, no obligation, no refund, no wallet entry');
  await m.reconcile.assertInvariant('terminate once (sequential)');
});

test('concurrent, 12 rounds, both orders: exactly one terminate wins, the loser has no side effect, never a REFUND_SHORT', skipOpts, async () => {
  const m = await load();
  for (let round = 0; round < 12; round++) {
    await resetLedger(m);
    const f = await seed(m);
    const keys = [`CONTRACT_TERMINATE:${f.txnId}`, `CONTRACT_TERMINATE:${f.txnId}:other`];
    if (round % 2 === 1) keys.reverse();
    const results = await Promise.allSettled(keys.map((k) => m.ledger.terminateContract(body(f, k) as any)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(ok.length, 1, `round ${round}: ${results.map((r) => r.status).join(',')}`);
    assert.equal(lost.length, 1);
    assert.ok(lost[0].reason instanceof m.ledger.ContractAlreadyTerminatedError, String(lost[0].reason));
    const s = await state(m, f);
    assert.equal(s.ops, 1, `round ${round}`);
    assert.equal(s.refundShort, 0, `round ${round}: no phantom REFUND_SHORT`);
    assert.equal(s.obligations, 0, `round ${round}`);
    await m.reconcile.assertInvariant(`terminate once round ${round}`);
  }
});

test('a termination of ANOTHER transaction is not blocked (the guard is per payment transaction)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await seed(m);
  const b = await seed(m);
  await m.ledger.terminateContract(body(a, `CONTRACT_TERMINATE:${a.txnId}`) as any);
  await m.ledger.terminateContract(body(b, `CONTRACT_TERMINATE:${b.txnId}`) as any);
  assert.equal((await state(m, a)).ops, 1);
  assert.equal((await state(m, b)).ops, 1);
});
