import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const skip = /_test/i.test(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.';

test('FINANCIAL: concurrent duplicate transfer and refund each mutate balances/ledger exactly once', { skip }, async () => {
  const { prisma } = await import('../repositories/prisma');
  const { walletService } = await import('../services/wallet.service');
  const suffix = randomUUID();
  const payerId = `financial-payer-${suffix}`;
  const receiverId = `financial-receiver-${suffix}`;
  const payer = await prisma.wallet.create({ data: { ownerType: 'CLIENT', ownerId: payerId, availableBalance: 1000 } });
  const receiver = await prisma.wallet.create({ data: { ownerType: 'PT', ownerId: receiverId, availableBalance: 0 } });
  const platform = await walletService.getOrCreatePlatformWallet();
  const platformBefore = platform.availableBalance;
  const payment = await prisma.paymentTransaction.create({ data: { payerId, ptId: receiverId, purpose: 'PT_CONTRACT', amount: 100, status: 'PENDING', provider: 'MOCK', idempotencyKey: `pay-${suffix}`, payerWalletId: payer.id, receiverWalletId: receiver.id } });

  try {
    const { Prisma } = await import('../generated/prisma');
    const invokeTransfer = () => walletService.transferInternal({ payerWalletId: payer.id, receiverWalletId: receiver.id, amount: new Prisma.Decimal(100), commissionRate: new Prisma.Decimal(0.1), transactionId: payment.id, partnerType: 'PT', partnerId: receiverId });
    await Promise.all([invokeTransfer(), invokeTransfer()]);

    const [payerPaid, receiverPaid, platformPaid, paymentLedger, commissions] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: payer.id } }), prisma.wallet.findUniqueOrThrow({ where: { id: receiver.id } }), prisma.wallet.findUniqueOrThrow({ where: { id: platform.id } }), prisma.walletLedgerEntry.count({ where: { transactionId: payment.id } }), prisma.platformCommission.findMany({ where: { paymentTransactionId: payment.id } }),
    ]);
    assert.equal(payerPaid.availableBalance.toNumber(), 900);
    assert.equal(receiverPaid.availableBalance.toNumber(), 90);
    assert.equal(platformPaid.availableBalance.minus(platformBefore).toNumber(), 10);
    assert.equal(paymentLedger, 3);
    assert.equal(commissions.length, 1);

    const refund = await prisma.paymentTransaction.create({ data: { payerId, ptId: receiverId, purpose: 'REFUND', amount: 100, status: 'PENDING', provider: 'MOCK', idempotencyKey: `refund-${suffix}`, payerWalletId: receiver.id, receiverWalletId: payer.id, refundOfTransactionId: payment.id } });
    const invokeRefund = () => walletService.reverseTransfer({ payerWalletId: payer.id, receiverWalletId: receiver.id, amount: new Prisma.Decimal(100), commissionAmount: new Prisma.Decimal(10), refundTransactionId: refund.id, originalTransactionId: payment.id, platformCommissionId: commissions[0].id });
    await Promise.all([invokeRefund(), invokeRefund()]);

    const [payerRefunded, receiverRefunded, platformRefunded, refundLedger, original, refundRow] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: payer.id } }), prisma.wallet.findUniqueOrThrow({ where: { id: receiver.id } }), prisma.wallet.findUniqueOrThrow({ where: { id: platform.id } }), prisma.walletLedgerEntry.count({ where: { transactionId: refund.id } }), prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } }), prisma.paymentTransaction.findUniqueOrThrow({ where: { id: refund.id } }),
    ]);
    assert.equal(payerRefunded.availableBalance.toNumber(), 1000);
    assert.equal(receiverRefunded.availableBalance.toNumber(), 0);
    assert.equal(platformRefunded.availableBalance.toNumber(), platformBefore.toNumber());
    assert.equal(refundLedger, 3);
    assert.equal(original.status, 'REFUNDED');
    assert.equal(refundRow.status, 'PAID');
  } finally {
    const txns = await prisma.paymentTransaction.findMany({ where: { payerId }, select: { id: true } });
    const ids = txns.map(row => row.id);
    await prisma.walletLedgerEntry.deleteMany({ where: { transactionId: { in: ids } } });
    await prisma.platformCommission.deleteMany({ where: { paymentTransactionId: { in: ids } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: ids } } });
    await prisma.wallet.deleteMany({ where: { id: { in: [payer.id, receiver.id] } } });
    await prisma.$disconnect();
  }
});
