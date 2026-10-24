import { guardedTest as test } from './support/test-db-guard';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { walletService, type LedgerOps } from '../services/wallet.service';
import { withdrawalService } from '../services/withdrawal.service';
import { assertInvariant } from '../services/reconcile.service';

test.after(async () => { await prisma.$disconnect(); });

async function fixture() {
  const owner = randomUUID();
  const wallet = await walletService.getOrCreateWallet('PT', owner);
  const escrow = await walletService.getEscrowWallet();
  const txn = await prisma.paymentTransaction.create({ data: { payerId: owner, purpose: 'PT_CONTRACT', amount: 50000, status: 'PAID', idempotencyKey: randomUUID() } });
  await walletService.withWallets([wallet.id, escrow.id], txn.id, async ops => {
    await ops.credit(wallet.id, new Prisma.Decimal(50000), 'review test earnings');
    await ops.credit(escrow.id, new Prisma.Decimal(50000), 'review test escrow intake');
  });
  const request = await withdrawalService.requestWithdrawal('PT', owner, '50000', 'test bank');
  return { wallet, request };
}

type Action = 'approve' | 'reject' | 'pay';
const act = (action: Action, id: string) => action === 'pay'
  ? withdrawalService.markPaid(id, 'test-admin', 'test-reference')
  : action === 'reject' ? withdrawalService.reject(id, 'test-admin', 'test rejection')
  : withdrawalService.approve(id, 'test-admin');

// Hold the first operation AFTER its preflight reads, BEFORE the real wallet lock.
// The second commits against PostgreSQL before the first resumes with its stale snapshot.
for (const [first, second, finalStatus, available, locked, firstFails] of [
  ['approve', 'reject', 'REJECTED', 50000, 0, true],
  ['approve', 'pay', 'PAID', 0, 0, true],
  ['pay', 'approve', 'PAID', 0, 0, false],
  ['pay', 'reject', 'REJECTED', 50000, 0, true],
  ['reject', 'pay', 'PAID', 0, 0, true],
  ['reject', 'approve', 'REJECTED', 50000, 0, false],
  ['pay', 'pay', 'PAID', 0, 0, false],
  ['approve', 'approve', 'APPROVED', 0, 50000, false],
] as const) {
  test(`stale ${first} after ${second}: preserves state and money`, async () => {
    const { wallet, request } = await fixture();
    const original = walletService.withWallets;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const gate = new Promise<void>(r => { release = r; });
    let calls = 0;
    walletService.withWallets = async <T>(ids: string[], txn: string, fn: (ops: LedgerOps) => Promise<T>) => {
      if (++calls === 1) { entered(); await gate; }
      return original(ids, txn, fn);
    };
    try {
      const pending = act(first, request.id);
      const outcome = Promise.allSettled([pending]);
      await started;
      await act(second, request.id);
      release();
      assert.equal((await outcome)[0].status, firstFails ? 'rejected' : 'fulfilled');
      const row = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } });
      const balance = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      assert.equal(row.status, finalStatus);
      assert.equal(balance.availableBalance.toNumber(), available);
      assert.equal(balance.lockedBalance.toNumber(), locked);
      await assertInvariant(`${first} after ${second}`);
    } finally { release(); walletService.withWallets = original; }
  });
}

test('reject after approval: a failed status write rolls back the unlock and ledger together', async () => {
  const { wallet, request } = await fixture();
  await withdrawalService.approve(request.id, 'test-admin');
  const original = walletService.withWallets;
  walletService.withWallets = async (ids, txn, fn) => original(ids, txn, async ops => {
    const update = ops.tx.withdrawalRequest.update;
    ops.tx.withdrawalRequest.update = (() => { throw new Error('injected status write failure'); }) as any;
    try { return await fn(ops); } finally { ops.tx.withdrawalRequest.update = update; }
  });
  try {
    await assert.rejects(withdrawalService.reject(request.id, 'test-admin', 'test'), /injected/);
  } finally { walletService.withWallets = original; }
  assert.equal((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
  const balance = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(balance.availableBalance.toNumber(), 0);
  assert.equal(balance.lockedBalance.toNumber(), 50000);
  assert.equal(await prisma.ledgerOperation.findUnique({ where: { key: `WITHDRAWAL_UNLOCK:${request.id}` } }), null);
  await withdrawalService.reject(request.id, 'test-admin', 'retry');
  await assertInvariant('reject rollback and retry');
});
