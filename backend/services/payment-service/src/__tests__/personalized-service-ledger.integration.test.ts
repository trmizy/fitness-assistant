/**
 * Cụm C3 (ký quỹ) + C4 (hoàn tiền khi huỷ trước khi PT bắt đầu) + C5 (thu hồi khi PT đã rút
 * tiền) — chứng minh bằng sổ cái thật rằng escrow của Personalized Service hoạt động đúng.
 *
 * "hold" không có hàm riêng ở đây — nó CHÍNH LÀ settleContractPayment (đã có, dùng chung cho
 * mọi purpose gateway-checkout) — xem doc comment đầu personalized-service-ledger.service.ts.
 * File này test releaseOrder + refundOrder, hai hàm thật sự mới.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/personalized-service-ledger.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  contractLedger: typeof import('../services/contract-ledger.service');
  ledger: typeof import('../services/personalized-service-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
};

let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      contractLedger: await import('../services/contract-ledger.service'),
      ledger: await import('../services/personalized-service-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  // ledger_operations included: this file's idempotency keys are per-scenario-name literals,
  // not randomized per run, so a second manual run against the persistent test DB would
  // otherwise replay the first run's cached result instead of touching freshly-truncated
  // wallets.
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

interface Fixture {
  orderId: string;
  txnId: string;
  parties: { ptUserId: string; clientUserId: string };
  price: InstanceType<Mods['Prisma']['Decimal']>;
  rates: { platformRate: InstanceType<Mods['Prisma']['Decimal']>; ptRate: InstanceType<Mods['Prisma']['Decimal']> };
}

/** "hold": exactly the generic checkout+webhook settlement every other purpose uses. */
async function seedHeldOrder(m: Mods, opts: { price: number; platformRate?: string }): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, clientUserId: `client-${suffix}` };
  const rates = {
    platformRate: new m.Prisma.Decimal(opts.platformRate ?? '0.10'),
    ptRate: new m.Prisma.Decimal(1).minus(opts.platformRate ?? '0.10'),
  };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId,
      purpose: 'PERSONALIZED_SERVICE_PURCHASE',
      amount: opts.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'MOCK',
      idempotencyKey: `order-${suffix}`,
      relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: `order-${suffix}`,
      activationStatus: 'PENDING',
      sourceService: 'ai-service',
    },
  });
  const price = new m.Prisma.Decimal(opts.price);
  await m.contractLedger.settleContractPayment({
    transactionId: txn.id,
    price,
    rates: { platformRate: rates.platformRate, ptRate: rates.ptRate, gymRate: new m.Prisma.Decimal(0) },
    parties: { ptUserId: parties.ptUserId, gymId: null, clientUserId: parties.clientUserId },
    label: `PersonalizedService order-${suffix}`,
  });
  return { orderId: `order-${suffix}`, txnId: txn.id, parties, price, rates };
}

async function balances(m: Mods, f: Fixture) {
  const [pt, client, revenue] = await Promise.all([
    m.contractLedger.readWallet('PT', f.parties.ptUserId),
    m.contractLedger.readWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance,
    clientAvailable: client.availableBalance,
    platformPending: revenue.pendingBalance.toFixed(2),
    platformAvailable: revenue.availableBalance.toFixed(2),
  };
}

test('releaseOrder: khách accept — toàn bộ pending của PT và nền tảng chuyển sang available, không đồng nào kẹt lại', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, { price: 2_000_000, platformRate: '0.10' });

  const mid = await balances(m, f);
  assert.equal(mid.ptPending, '1800000.00');
  assert.equal(mid.platformPending, '200000.00');

  const result = await m.ledger.releaseOrder({
    transactionId: f.txnId,
    price: f.price,
    rates: f.rates,
    parties: f.parties,
    label: 'accept',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  });

  assert.equal(result.released.pt, '1800000.00');
  assert.equal(result.released.platform, '200000.00');

  const final = await balances(m, f);
  assert.equal(final.ptPending, '0.00');
  assert.equal(final.platformPending, '0.00');
  assert.equal(final.ptAvailable, '1800000.00');
  assert.equal(final.platformAvailable, '200000.00');

  await m.reconcile.assertInvariant('C3 release');
});

test('releaseOrder: gọi lại lần hai với cùng khoá không giải phóng thêm', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, { price: 1_000_000 });
  const params = {
    transactionId: f.txnId,
    price: f.price,
    rates: f.rates,
    parties: f.parties,
    label: 'accept-retry',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  };
  await m.ledger.releaseOrder(params);
  const after1 = await balances(m, f);
  await m.ledger.releaseOrder(params);
  const after2 = await balances(m, f);

  assert.equal(after2.ptAvailable, after1.ptAvailable);
  assert.equal(after2.platformAvailable, after1.platformAvailable);
  await m.reconcile.assertInvariant('C3 release retry-safe');
});

test('refundOrder (C4): huỷ trước khi PT bắt đầu — chưa release gì, hoàn 100% từ pending, PT/nền tảng còn lại 0', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, { price: 1_500_000, platformRate: '0.10' });

  const result = await m.ledger.refundOrder({
    transactionId: f.txnId,
    refundAmount: f.price,
    rates: f.rates,
    parties: f.parties,
    label: 'cancel-before-work',
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${f.price.toFixed(2)}`,
  });

  assert.equal(result.refund, '1500000.00');
  assert.equal(result.clawedBack.pt, '1350000.00');
  assert.equal(result.clawedBack.platform, '150000.00');
  assert.equal(result.shortfall, '0.00');

  const final = await balances(m, f);
  assert.equal(final.ptPending, '0.00');
  assert.equal(final.platformPending, '0.00');
  assert.equal(final.ptAvailable, '0.00');
  assert.equal(final.clientAvailable, '1500000.00', 'khách phải nhận đủ 100% vì PT chưa bắt đầu làm việc');

  await m.reconcile.assertInvariant('C4 full refund before work starts');
});

test('refundOrder (C5): admin hoàn tiền SAU khi đã accept (đã release) — thu hồi lại từ available của PT', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, { price: 2_000_000, platformRate: '0.10' });
  await m.ledger.releaseOrder({
    transactionId: f.txnId,
    price: f.price,
    rates: f.rates,
    parties: f.parties,
    label: 'accept',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  });

  // Quản trị viên duyệt hoàn 50% sau khi khiếu nại — PT đã có đủ 1.800.000 khả dụng để bị thu hồi phần của mình.
  const refundAmount = new m.Prisma.Decimal('1000000');
  const result = await m.ledger.refundOrder({
    transactionId: f.txnId,
    refundAmount,
    rates: f.rates,
    parties: f.parties,
    label: 'admin-partial-refund',
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${refundAmount.toFixed(2)}`,
  });

  assert.equal(result.refund, '1000000.00');
  assert.equal(result.clawedBack.pt, '900000.00');
  assert.equal(result.clawedBack.platform, '100000.00');
  assert.equal(result.shortfall, '0.00');

  const final = await balances(m, f);
  assert.equal(final.ptAvailable, '900000.00', '1.800.000 đã nhận trừ 900.000 bị thu hồi');
  assert.equal(final.platformAvailable, '100000.00', '200.000 hoa hồng trừ 100.000 bị thu hồi');
  assert.equal(final.clientAvailable, '1000000.00');

  await m.reconcile.assertInvariant('C5 partial refund after acceptance');
});

test('refundOrder (C5): PT đã rút hết tiền — thu hồi thiếu hụt được ghi nợ PartnerReceivable, khách vẫn nhận đủ', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, { price: 1_000_000, platformRate: '0.10' });
  await m.ledger.releaseOrder({
    transactionId: f.txnId,
    price: f.price,
    rates: f.rates,
    parties: f.parties,
    label: 'accept',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  });

  // PT rút sạch 900.000 khả dụng trước khi tranh chấp xảy ra — tiền thật đã rời nền tảng, nên
  // escrow cũng giảm tương ứng (đúng "payout" trong money-flow).
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const escrowWallet = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([ptWallet.id, escrowWallet.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, new m.Prisma.Decimal('900000'), 'PT withdrew everything');
    await ops.debit(escrowWallet.id, new m.Prisma.Decimal('900000'), 'cash left the platform via withdrawal');
  });

  // Doanh thu nền tảng trong đời thực là tích luỹ từ RẤT NHIỀU giao dịch khác, không chỉ một
  // giao dịch này — mô phỏng bằng cách cộng thêm hoa hồng "từ các giao dịch khác" (kèm escrow
  // tương ứng) đủ để nền tảng có khả năng đứng ra ứng trước khoản 900.000 còn thiếu.
  const revenueWallet = await m.wallet.getRevenueWallet();
  await m.wallet.withWallets([revenueWallet.id, escrowWallet.id], f.txnId, async (ops) => {
    await ops.credit(revenueWallet.id, new m.Prisma.Decimal('2000000'), 'seed — hoa hồng tích luỹ từ các giao dịch khác');
    await ops.credit(escrowWallet.id, new m.Prisma.Decimal('2000000'), 'seed — tiền tương ứng trong escrow');
  });

  const refundAmount = f.price; // hoàn toàn bộ
  const result = await m.ledger.refundOrder({
    transactionId: f.txnId,
    refundAmount,
    rates: f.rates,
    parties: f.parties,
    label: 'admin-full-refund-after-withdrawal',
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${refundAmount.toFixed(2)}`,
  });

  assert.equal(result.refund, '1000000.00');
  assert.equal(result.clawedBack.pt, '900000.00', 'toàn bộ 900.000 phần PT được ghi nhận là đã "thu hồi" — dù thật ra là nợ, không phải tiền mặt lấy lại được');
  assert.equal(result.shortfall, '0.00', 'nền tảng đứng ra ứng trước, không phải nợ treo lơ lửng');

  const receivables = await m.prisma.partnerReceivable.findMany({ where: { partnerType: 'PT', partnerId: f.parties.ptUserId } });
  assert.equal(receivables.length, 1);
  assert.equal(new m.Prisma.Decimal(receivables[0].amount).toFixed(2), '900000.00');

  const final = await balances(m, f);
  assert.equal(final.clientAvailable, '1000000.00', 'khách vẫn nhận đủ 100% dù PT đã rút sạch tiền trước đó');
  assert.equal(final.ptAvailable, '0.00');

  await m.reconcile.assertInvariant('C5 refund after PT withdrew — receivable covers the gap');
});
