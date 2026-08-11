/**
 * Regression tests for the P0 payment/webhook vulnerabilities found and fixed
 * in this pass:
 *
 * 1. `getProvider('MOCK')` was allowed unconditionally — any authenticated
 *    caller could top up a real wallet via the MOCK provider (which
 *    auto-completes to PAID with no real money moving) in production. The
 *    provider has since been deleted outright; the tests below now assert it
 *    cannot be obtained in ANY environment, including via PAYMENT_PROVIDER.
 * 2. `handleEvent()` looked up a transaction by `providerTransactionId` alone,
 *    with NO check that the webhook's `provider` matched the transaction's
 *    real `provider` — a forged webhook citing a real transaction's id from a
 *    different gateway could fraudulently mark it PAID and credit the wallet.
 *
 * Runs against a real (test-only) Postgres database — no mocking of the
 * DB layer — gated the same way fitness-service's integration tests are:
 * only runs when DATABASE_URL points at a database whose name contains
 * "_test", so it can never accidentally run against a real dev/prod DB.
 *
 * Run with (from backend/services/payment-service):
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/webhook-security.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);

const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : 'Requires DATABASE_URL pointing at a *_test database.',
};

type PrismaClientLike = (typeof import('../repositories/prisma'))['prisma'];
type WebhookServiceLike = (typeof import('../services/webhook.service'))['handleEvent'];
type WalletServiceLike = (typeof import('../services/wallet.service'))['walletService'];
type PaymentServiceLike = typeof import('../services/payment.service');

let prisma: PrismaClientLike | undefined;
let handleEvent: WebhookServiceLike | undefined;
let walletService: WalletServiceLike | undefined;
let paymentService: PaymentServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import('../repositories/prisma');
    const webhookModule = await import('../services/webhook.service');
    const walletModule = await import('../services/wallet.service');
    const paymentModule = await import('../services/payment.service');
    prisma = prismaModule.prisma;
    handleEvent = webhookModule.handleEvent;
    walletService = walletModule.walletService;
    paymentService = paymentModule;
  }
  return { prisma: prisma!, handleEvent: handleEvent!, walletService: walletService!, paymentService: paymentService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedWalletAndTxn(
  db: PrismaClientLike,
  opts: { provider: 'VNPAY' | 'MOMO' | 'ZALOPAY'; providerTransactionId: string; amount: number; payerId: string },
) {
  const wallet = await db.wallet.upsert({
    where: { ownerType_ownerId: { ownerType: 'CLIENT', ownerId: opts.payerId } },
    create: { ownerType: 'CLIENT', ownerId: opts.payerId },
    update: {},
  });
  const txn = await db.paymentTransaction.create({
    data: {
      payerId: opts.payerId,
      purpose: 'WALLET_TOPUP',
      amount: opts.amount,
      currency: 'VND',
      status: 'PENDING',
      provider: opts.provider,
      providerTransactionId: opts.providerTransactionId,
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
  const txns = await db.paymentTransaction.findMany({ where: { payerId }, select: { id: true } });
  const txnIds = txns.map((t) => t.id);
  if (txnIds.length > 0) {
    await db.walletLedgerEntry.deleteMany({ where: { transactionId: { in: txnIds } } });
    await db.platformCommission.deleteMany({ where: { paymentTransactionId: { in: txnIds } } });
  }
  await db.paymentTransaction.deleteMany({ where: { payerId } });
  await db.wallet.deleteMany({ where: { ownerType: 'CLIENT', ownerId: payerId } });
}

test(
  'SECURITY: a MOMO webhook cannot complete a transaction that was really created under a different provider (VNPAY)',
  skipOpts,
  async () => {
    const { prisma: db, handleEvent: handle } = await loadModules();
    const payerId = `webhook-sec-test-${Date.now()}`;
    await cleanup(db, payerId);
    try {
      const providerTransactionId = `vnpay_${randomUUID()}`;
      const { txn } = await seedWalletAndTxn(db, {
        provider: 'VNPAY',
        providerTransactionId,
        amount: 1_000_000,
        payerId,
      });

      // Attacker forges a MoMo webhook citing the REAL VNPay transaction's id.
      await handle({
        provider: 'MOMO',
        providerEventId: `forged_${randomUUID()}`,
        providerTransactionId,
        payload: { forged: true },
        status: 'PAID',
      });

      const after = await db.paymentTransaction.findUnique({ where: { id: txn.id } });
      assert.equal(after!.status, 'PENDING', 'transaction must NOT have been marked PAID by a mismatched-provider webhook');

      const wallet = await db.wallet.findUnique({ where: { id: txn.payerWalletId! } });
      assert.equal(Number(wallet!.availableBalance), 0, 'wallet must NOT have been credited');
    } finally {
      await cleanup(db, payerId);
    }
  },
);

test(
  'SECURITY: a matching-provider webhook (VNPAY event for a VNPAY transaction) still credits normally',
  skipOpts,
  async () => {
    const { prisma: db, handleEvent: handle } = await loadModules();
    const payerId = `webhook-sec-test-match-${Date.now()}`;
    await cleanup(db, payerId);
    try {
      const providerTransactionId = `vnpay_${randomUUID()}`;
      const { txn } = await seedWalletAndTxn(db, {
        provider: 'VNPAY',
        providerTransactionId,
        amount: 500_000,
        payerId,
      });

      await handle({
        provider: 'VNPAY',
        providerEventId: `real_${randomUUID()}`,
        providerTransactionId,
        payload: { real: true },
        status: 'PAID',
      });

      const after = await db.paymentTransaction.findUnique({ where: { id: txn.id } });
      assert.equal(after!.status, 'PAID');

      const wallet = await db.wallet.findUnique({ where: { id: txn.payerWalletId! } });
      assert.equal(Number(wallet!.availableBalance), 500_000);
    } finally {
      await cleanup(db, payerId);
    }
  },
);

test(
  'SECURITY: a duplicate webhook delivery (same provider, same event) never credits the wallet twice',
  skipOpts,
  async () => {
    const { prisma: db, handleEvent: handle } = await loadModules();
    const payerId = `webhook-sec-test-dup-${Date.now()}`;
    await cleanup(db, payerId);
    try {
      const providerTransactionId = `zalopay_${randomUUID()}`;
      const { txn } = await seedWalletAndTxn(db, {
        provider: 'ZALOPAY',
        providerTransactionId,
        amount: 200_000,
        payerId,
      });
      const eventId = `evt_${randomUUID()}`;
      const event = {
        provider: 'ZALOPAY',
        providerEventId: eventId,
        providerTransactionId,
        payload: {},
        status: 'PAID' as const,
      };

      await handle(event);
      await handle(event); // exact duplicate delivery
      await handle(event); // and again

      const wallet = await db.wallet.findUnique({ where: { id: txn.payerWalletId! } });
      assert.equal(Number(wallet!.availableBalance), 200_000, 'must be credited exactly once, not 3 times');
    } finally {
      await cleanup(db, payerId);
    }
  },
);

test(
  'SECURITY: two concurrent webhook deliveries for the same transaction do not double-credit',
  skipOpts,
  async () => {
    const { prisma: db, handleEvent: handle } = await loadModules();
    const payerId = `webhook-sec-test-concurrent-${Date.now()}`;
    await cleanup(db, payerId);
    try {
      const providerTransactionId = `zalopay_${randomUUID()}`;
      const { txn } = await seedWalletAndTxn(db, {
        provider: 'ZALOPAY',
        providerTransactionId,
        amount: 300_000,
        payerId,
      });

      // Two DIFFERENT event ids (simulating VNPay return + IPN both reporting PAID)
      // racing to credit the SAME underlying transaction concurrently.
      await Promise.all([
        handle({
          provider: 'ZALOPAY',
          providerEventId: `evt_a_${randomUUID()}`,
          providerTransactionId,
          payload: {},
          status: 'PAID',
        }),
        handle({
          provider: 'ZALOPAY',
          providerEventId: `evt_b_${randomUUID()}`,
          providerTransactionId,
          payload: {},
          status: 'PAID',
        }),
      ]);

      const wallet = await db.wallet.findUnique({ where: { id: txn.payerWalletId! } });
      assert.equal(Number(wallet!.availableBalance), 300_000, 'concurrent deliveries must still credit exactly once');
    } finally {
      await cleanup(db, payerId);
    }
  },
);

// The MOCK provider used to be reachable outside production, which made "is it disabled in
// prod?" the interesting question. It has since been removed outright, so the guarantee is
// now stronger and environment-independent: no environment can obtain it.
for (const env of ['production', 'development', 'test']) {
  test(`SECURITY: getProvider("MOCK") is rejected with NODE_ENV=${env}`, async () => {
    const { paymentService } = await loadModules();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    try {
      assert.throws(() => paymentService.getProvider('MOCK'), /has been removed/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test(`SECURITY: providerConfigStatus("MOCK") reports not-configured with NODE_ENV=${env}`, async () => {
    const { paymentService } = await loadModules();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    try {
      const status = paymentService.providerConfigStatus('MOCK');
      assert.equal(status.configured, false);
      assert.match(status.missing.join(' '), /has been removed/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
}

// PAYMENT_PROVIDER is operator-controlled; a stale MOCK there must not resurrect it.
test('SECURITY: a stale PAYMENT_PROVIDER=MOCK env does not resurrect the mock provider', async () => {
  const { paymentService } = await loadModules();
  const original = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = 'MOCK';
  try {
    assert.throws(() => paymentService.getProvider(), /has been removed/);
  } finally {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = original;
  }
});

test('the sandbox gateways are still constructible', async () => {
  const { paymentService } = await loadModules();
  for (const name of ['VNPAY', 'ZALOPAY', 'PAYOS', 'MOMO']) {
    assert.doesNotThrow(() => paymentService.getProvider(name), `${name} must still resolve`);
  }
});
