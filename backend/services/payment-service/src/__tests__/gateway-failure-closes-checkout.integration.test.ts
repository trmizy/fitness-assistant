/**
 * GAP-22: a VNPay checkout the payer CANCELLED (signed return, vnp_ResponseCode 24) stayed PENDING
 * until the stale sweep, so the app/web result page said "Đang chờ xác nhận" for a payment that was
 * already over. The signed return now closes it to FAILED — without ever being able to lose a real
 * payment or touch another gateway's transaction.
 *
 * Run with (from backend/services/payment-service):
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/gateway-failure-closes-checkout.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';

// vnpay.provider reads its secret at import time; sign/verify only need it to be consistent.
process.env.VNPAY_HASH_SECRET ??= 'test-only-vnpay-hash-secret';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type PrismaClientLike = (typeof import('../repositories/prisma'))['prisma'];
type WebhookModule = typeof import('../services/webhook.service');

let prisma: PrismaClientLike | undefined;
let webhook: WebhookModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import('../repositories/prisma')).prisma;
    webhook = await import('../services/webhook.service');
  }
  return { prisma: prisma!, webhook: webhook! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedTopup(
  db: PrismaClientLike,
  opts: { provider: 'VNPAY' | 'MOMO'; status?: 'PENDING' | 'PAID'; payerId: string },
) {
  const wallet = await db.wallet.upsert({
    where: { ownerType_ownerId: { ownerType: 'CLIENT', ownerId: opts.payerId } },
    create: { ownerType: 'CLIENT', ownerId: opts.payerId },
    update: {},
  });
  const id = randomUUID();
  const txn = await db.paymentTransaction.create({
    data: {
      id,
      payerId: opts.payerId,
      purpose: 'WALLET_TOPUP',
      amount: 50000,
      currency: 'VND',
      status: opts.status ?? 'PENDING',
      provider: opts.provider,
      providerTransactionId: id,
      idempotencyKey: `test-${randomUUID()}`,
      payerWalletId: wallet.id,
      receiverWalletId: wallet.id,
      relatedEntityType: 'WALLET_TOPUP',
      activationStatus: 'NOT_APPLICABLE',
      sourceService: 'payment-service-test',
    },
  });
  return { wallet, txn };
}

async function cleanup(db: PrismaClientLike, payerId: string) {
  const txns = await db.paymentTransaction.findMany({ where: { payerId }, select: { id: true, providerTransactionId: true } });
  const ids = txns.map((t) => t.id);
  if (ids.length) {
    await db.walletLedgerEntry.deleteMany({ where: { transactionId: { in: ids } } });
    await db.paymentWebhookEvent.deleteMany({
      where: { providerTransactionId: { in: txns.map((t) => t.providerTransactionId).filter((x): x is string => !!x) } },
    });
    await db.paymentTransaction.deleteMany({ where: { id: { in: ids } } });
  }
  await db.wallet.deleteMany({ where: { ownerId: payerId } });
}

test('isDefinitiveVnpayFailure: cancel/expiry/decline yes; success, suspicious (07) and unknown (99) no', async () => {
  const { isDefinitiveVnpayFailure } = await import('../providers/vnpay.provider');
  for (const code of ['24', '11', '51', '79']) assert.equal(isDefinitiveVnpayFailure(code), true, code);
  for (const code of ['00', '07', '99', undefined, 24]) assert.equal(isDefinitiveVnpayFailure(code), false, String(code));
});

test('a signed failure closes an open checkout exactly once', skipOpts, async () => {
  const { prisma: db, webhook: w } = await loadModules();
  const payerId = `gap22-${randomUUID()}`;
  try {
    const { txn } = await seedTopup(db, { provider: 'VNPAY', payerId });
    assert.equal(await w.failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: txn.id }), true);
    const row = await db.paymentTransaction.findUnique({ where: { id: txn.id } });
    assert.equal(row!.status, 'FAILED');
    assert.ok(row!.failedAt);
    assert.equal(await w.failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: txn.id }), false);
  } finally {
    await cleanup(db, payerId);
  }
});

test('never downgrades a PAID transaction', skipOpts, async () => {
  const { prisma: db, webhook: w } = await loadModules();
  const payerId = `gap22-${randomUUID()}`;
  try {
    const { txn } = await seedTopup(db, { provider: 'VNPAY', payerId, status: 'PAID' });
    assert.equal(await w.failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: txn.id }), false);
    assert.equal((await db.paymentTransaction.findUnique({ where: { id: txn.id } }))!.status, 'PAID');
  } finally {
    await cleanup(db, payerId);
  }
});

test("SECURITY: a failure reported under one gateway never closes another gateway's transaction", skipOpts, async () => {
  const { prisma: db, webhook: w } = await loadModules();
  const payerId = `gap22-${randomUUID()}`;
  try {
    const { txn } = await seedTopup(db, { provider: 'MOMO', payerId });
    assert.equal(await w.failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: txn.id }), false);
    assert.equal((await db.paymentTransaction.findUnique({ where: { id: txn.id } }))!.status, 'PENDING');
  } finally {
    await cleanup(db, payerId);
  }
});

test('a genuine PAID arriving after the failure still settles it (no real payment is lost)', skipOpts, async () => {
  const { prisma: db, webhook: w } = await loadModules();
  const payerId = `gap22-${randomUUID()}`;
  try {
    const { txn, wallet } = await seedTopup(db, { provider: 'VNPAY', payerId });
    await w.failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: txn.id });
    await w.handleEvent({
      provider: 'VNPAY',
      providerEventId: `late-${txn.id}`,
      providerTransactionId: txn.id,
      payload: {},
      status: 'PAID',
    });
    assert.equal((await db.paymentTransaction.findUnique({ where: { id: txn.id } }))!.status, 'PAID');
    const fresh = await db.wallet.findUnique({ where: { id: wallet.id } });
    assert.equal(Number(fresh!.availableBalance), 50000);
  } finally {
    await cleanup(db, payerId);
  }
});

test('route: the signed "payer cancelled" return closes the checkout and still redirects', skipOpts, async () => {
  const { prisma: db } = await loadModules();
  const express = (await import('express')).default;
  const { buildSimulatedReturnQuery } = await import('../providers/vnpay.provider');
  const router = (await import('../routes/vnpay-return.routes')).default;
  const app = express();
  app.use('/payments', router);
  const server = app.listen(0);
  const payerId = `gap22-${randomUUID()}`;
  try {
    const { txn } = await seedTopup(db, { provider: 'VNPAY', payerId });
    const port = (server.address() as AddressInfo).port;
    const query = buildSimulatedReturnQuery({ txnRef: txn.id, amount: 50000, success: false });
    const res = await fetch(`http://127.0.0.1:${port}/payments/vnpay/return?${query}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /status=failed/);
    assert.equal((await db.paymentTransaction.findUnique({ where: { id: txn.id } }))!.status, 'FAILED');

    // A tampered query (signature no longer matches) changes nothing.
    const { txn: other } = await seedTopup(db, { provider: 'VNPAY', payerId });
    const forged = buildSimulatedReturnQuery({ txnRef: other.id, amount: 50000, success: false }).replace('vnp_Amount=', 'vnp_Amount=1');
    await fetch(`http://127.0.0.1:${port}/payments/vnpay/return?${forged}`, { redirect: 'manual' });
    assert.equal((await db.paymentTransaction.findUnique({ where: { id: other.id } }))!.status, 'PENDING');
  } finally {
    server.close();
    await cleanup(db, payerId);
  }
});
