import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { walletService } from '../services/wallet.service';
import { withdrawalService } from '../services/withdrawal.service';
import { assertInvariant } from '../services/reconcile.service';

/**
 * Money-flow redesign plan item 5.3 — "luồng rút tiền bán thủ công". Integration tests
 * against the real test DB: this flow's whole point is real money movement through
 * withWallets/applyDebit, best proven against the genuine ledger rather than a mock of it.
 */

function hasCode(code: string) {
  return (e: unknown) => (e as { code?: string }).code === code;
}

/**
 * Mirrors what a real checkout does: money entering any party's wallet always enters ESCROW
 * at the same time (see contract-ledger.service.ts's resolveWallets, which always includes
 * escrowId in the wallet set). Crediting only the party wallet, as an earlier version of this
 * helper did, silently created money from the reconciliation invariant's point of view and
 * made every assertInvariant() call in this file pass for the wrong reason.
 */
async function creditAvailable(ownerType: 'PT' | 'GYM' | 'CLIENT', ownerId: string, amount: string, description: string) {
  const wallet = await walletService.getOrCreateWallet(ownerType, ownerId);
  const escrow = await walletService.getEscrowWallet();
  const txn = await prisma.paymentTransaction.create({
    data: {
      id: randomUUID(),
      payerId: randomUUID(),
      purpose: 'PT_CONTRACT',
      amount: new Prisma.Decimal(amount),
      idempotencyKey: `test:${randomUUID()}`,
      status: 'PAID',
    },
  });
  await walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new Prisma.Decimal(amount), description);
    await ops.credit(escrow.id, new Prisma.Decimal(amount), `escrow intake for ${description}`);
  });
  return wallet;
}

test('a PT can request a withdrawal up to their available balance, not beyond it', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');

  await assert.rejects(
    () => withdrawalService.requestWithdrawal('PT', ptId, '600000', 'Bank ABC 0123456'),
    hasCode('EXCEEDS_WITHDRAWABLE_BALANCE'),
  );

  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC 0123456');
  assert.equal(request.status, 'PENDING');
  assert.equal(request.amount.toString(), '500000');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '500000.00', 'availableBalance itself does not move until markPaid');
});

test('a second withdrawal request cannot double-spend the same balance — pending requests are subtracted', async () => {
  const ptId = randomUUID();
  await creditAvailable('PT', ptId, '500000', 'test earnings');

  await withdrawalService.requestWithdrawal('PT', ptId, '400000', 'Bank ABC');
  await assert.rejects(
    () => withdrawalService.requestWithdrawal('PT', ptId, '200000', 'Bank ABC'),
    hasCode('EXCEEDS_WITHDRAWABLE_BALANCE'),
    '400k already pending + 200k more requested exceeds the 500k balance',
  );
});

test('a CLIENT can only withdraw refund/compensation-sourced money, not other credits', async () => {
  const clientId = randomUUID();
  // A credit whose description does NOT mention refund/compensation — must not count.
  await creditAvailable('CLIENT', clientId, '300000', 'test unrelated credit');

  await assert.rejects(
    () => withdrawalService.requestWithdrawal('CLIENT', clientId, '100000', 'Bank ABC'),
    hasCode('EXCEEDS_WITHDRAWABLE_BALANCE'),
    'the wallet has 300k available, but none of it is refund-sourced',
  );
});

test('a CLIENT can withdraw money credited as a refund', async () => {
  const clientId = randomUUID();
  await creditAvailable('CLIENT', clientId, '250000', 'Contract xyz — refund (CLIENT_CANCELLED)');

  const request = await withdrawalService.requestWithdrawal('CLIENT', clientId, '250000', 'Bank XYZ');
  assert.equal(request.status, 'PENDING');
});

test('a CLIENT can withdraw money credited as no-show compensation', async () => {
  const clientId = randomUUID();
  await creditAvailable('CLIENT', clientId, '100000', 'Contract xyz — compensation for a missed session');

  const request = await withdrawalService.requestWithdrawal('CLIENT', clientId, '100000', 'Bank XYZ');
  assert.equal(request.status, 'PENDING');
});

test('markPaid actually debits the wallet and records the bank reference — the ONLY place money moves', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC 0123456');

  const paid = await withdrawalService.markPaid(request.id, 'admin-1', 'REF-12345');
  assert.equal((paid as any).status, 'PAID');
  assert.equal((paid as any).bankReference, 'REF-12345');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '0.00', 'the debit only happens at markPaid');
});

test('markPaid without a bank reference is rejected', async () => {
  const ptId = randomUUID();
  await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');

  await assert.rejects(() => withdrawalService.markPaid(request.id, 'admin-1', ''), hasCode('BANK_REFERENCE_REQUIRED'));
});

test('a rejected request never moves money and cannot later be marked paid', async () => {
  const ptId = randomUUID();
  await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');

  const rejected = await withdrawalService.reject(request.id, 'admin-1', 'Thông tin ngân hàng không hợp lệ');
  assert.equal((rejected as any).status, 'REJECTED');

  await assert.rejects(() => withdrawalService.markPaid(request.id, 'admin-1', 'REF-1'), hasCode('INVALID_STATUS'));
});

test('markPaid debits ESCROW along with the partner wallet — money that truly leaves the platform must leave escrow too', async () => {
  const ptId = randomUUID();
  await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');

  await withdrawalService.markPaid(request.id, 'admin-1', 'REF-1');

  // A partner-wallet-only debit reallocates a claim on escrow's cash between wallets — it
  // does not remove cash from the platform, so it can never by itself break this invariant.
  // Only a debit that also hits ESCROW models a payout correctly; asserting the invariant
  // here is what actually catches an escrow debit going missing (it did, live, before this
  // test existed — reconciliation drifted by exactly the withdrawal amount).
  await assertInvariant('after PT withdrawal markPaid');
});

test('an already-PAID request cannot be marked paid again — no double debit', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');
  await withdrawalService.markPaid(request.id, 'admin-1', 'REF-1');

  await assert.rejects(() => withdrawalService.markPaid(request.id, 'admin-1', 'REF-2'), hasCode('INVALID_STATUS'));

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '0.00', 'still exactly one debit, not two');
});
