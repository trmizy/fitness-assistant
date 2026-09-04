/**
 * Cụm A1 — chứng minh bằng sổ cái thật (không chỉ công thức thuần) rằng một buổi đã bồi
 * thường không bị tính hai lần khi hợp đồng chấm dứt sau đó.
 *
 * Đây là bước tiếp theo của compensated-sessions-reduce-remaining-value.test.ts (vốn chỉ test
 * hàm thuần trong contract-money.ts) — file này chạy đúng đường đi thật:
 * compensateNoShow() rút tiền từ ngăn chờ ba bên, RỒI terminateContract() chạy sau đó. Nếu
 * computeTermination không trừ đúng phần đã bồi thường ra khỏi `withheld`, settleParty sẽ cố
 * rút nhiều hơn số dư ngăn chờ thực tế còn lại (đã bị compensateNoShow rút bớt trước đó) —
 * lỗi im lặng (shortfall), không phải lỗi ném ra ngay.
 *
 * Run THIS FILE ALONE (giống style contract-ledger.integration.test.ts, TRUNCATE bảng dùng chung):
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/compensated-session-termination.integration.test.ts
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
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
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
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  // ledger_operations (business-key idempotency, plan 1.1) is included here — this file's own
  // idempotency-key values are hardcoded per scenario name, not randomized per run, so a
  // second manual run against this same persistent test DB would otherwise find the FIRST
  // run's cached result and replay it instead of touching the freshly-truncated wallets below,
  // making every assertion after the replayed call look like the credit silently vanished.
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
}

interface Fixture {
  contractId: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: InstanceType<Mods['Prisma']['Decimal']>;
  totalSessions: number;
  rates: { platformRate: InstanceType<Mods['Prisma']['Decimal']>; ptRate: InstanceType<Mods['Prisma']['Decimal']>; gymRate: InstanceType<Mods['Prisma']['Decimal']> };
}

async function seedContract(m: Mods, opts: { price: number; totalSessions: number; rates: Fixture['rates'] }): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, gymId: null, clientUserId: `client-${suffix}` };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId,
      purpose: 'PT_CONTRACT',
      amount: opts.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `contract-${suffix}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: `contract-${suffix}`,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
    },
  });
  return {
    contractId: `contract-${suffix}`,
    txnId: txn.id,
    parties,
    price: new m.Prisma.Decimal(opts.price),
    totalSessions: opts.totalSessions,
    rates: opts.rates,
  };
}

async function nextTxn(m: Mods, f: Fixture): Promise<string> {
  const t = await m.prisma.paymentTransaction.create({
    data: {
      payerId: f.parties.clientUserId,
      purpose: 'PT_CONTRACT',
      amount: 0,
      currency: 'VND',
      status: 'PROCESSING',
      provider: 'VNPAY',
      idempotencyKey: `evt-${randomUUID()}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: f.contractId,
      sourceService: 'integration-test',
    },
  });
  return t.id;
}

async function balances(m: Mods, f: Fixture) {
  const [pt, client, escrow, revenue] = await Promise.all([
    m.ledger.readWallet('PT', f.parties.ptUserId),
    m.ledger.readWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getEscrowWallet(),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance,
    clientAvailable: client.availableBalance,
    escrow: escrow.availableBalance.toFixed(2),
    platformPending: revenue.pendingBalance.toFixed(2),
    platformAvailable: revenue.availableBalance.toFixed(2),
  };
}

test('hợp đồng 12 buổi/1.200.000, PT vắng 1 buổi đã bồi thường, huỷ ngay sau đó — không đồng nào bị tính hai lần', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const rates = { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal('0.90'), gymRate: new m.Prisma.Decimal('0') };
  const f = await seedContract(m, { price: 1_200_000, totalSessions: 12, rates });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'A1',
  });

  const noShow = await m.ledger.compensateNoShow({
    transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'A1 no-show',
    idempotencyKey: `PT_NO_SHOW:${'A1 no-show'}`,
  });
  assert.equal(noShow.compensation, '100000.00');
  assert.equal(noShow.shortfall, '0.00', 'ngăn chờ đủ tiền bồi thường — không thiếu hụt');

  const mid = await balances(m, f);
  assert.equal(mid.clientAvailable, '100000.00');
  assert.equal(mid.ptPending, '990000.00', 'PT pending 1.080.000 → 990.000 sau bồi thường');
  assert.equal(mid.platformPending, '110000.00', 'nền tảng pending 120.000 → 110.000 sau bồi thường');

  // Khách chưa dùng buổi nào (usedSessions=0), rồi huỷ ngay — compensatedSessions=1 PHẢI được
  // truyền vào, nếu không computeTermination sẽ cố rút nhiều hơn số ngăn chờ thực tế còn lại.
  const outcome = await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f),
    price: f.price,
    totalSessions: f.totalSessions,
    usedSessions: 0,
    compensatedSessions: 1,
    rates: f.rates,
    reason: 'CLIENT_CANCELLED',
    alreadyReleased: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) },
    parties: f.parties,
    label: 'A1 termination',
    idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
  });

  const final = await balances(m, f);
  // Không đồng nào bị bỏ sót hoặc tạo thêm: số dư khả dụng cuối cùng của khách (đã gồm cả
  // 100.000 bồi thường lẫn phần hoàn khi huỷ) cộng với PT và nền tảng phải khớp tuyệt đối
  // giá hợp đồng.
  const totalOut = new m.Prisma.Decimal(final.clientAvailable)
    .plus(final.ptAvailable)
    .plus(final.platformAvailable);
  assert.equal(totalOut.toFixed(2), '1200000.00', 'tổng tiền ra (bồi thường + hoàn + entitlement) khớp tuyệt đối giá hợp đồng');

  // Ngăn chờ của PT/nền tảng phải về 0 — không còn đồng nào bị kẹt lại sau khi hợp đồng đóng.
  assert.equal(final.ptPending, '0.00', 'ngăn chờ PT phải về 0 sau khi chấm dứt — không kẹt tiền');
  assert.equal(final.platformPending, '0.00', 'ngăn chờ nền tảng phải về 0 sau khi chấm dứt — không kẹt tiền');

  assert.equal(outcome.refund, '990000.00', 'hoàn 90% của 1.100.000 (11 buổi chưa dùng, đã trừ buổi bồi thường)');
  assert.equal(final.escrow, '1200000.00', 'escrow không đổi suốt — tiền chưa từng rời nền tảng');

  await m.reconcile.assertInvariant('A1 compensated-then-terminated');
});

test('gọi terminateContract lần hai với cùng idempotencyKey — không rút thêm tiền', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const rates = { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal('0.90'), gymRate: new m.Prisma.Decimal('0') };
  const f = await seedContract(m, { price: 1_200_000, totalSessions: 12, rates });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'A1-retry',
  });
  await m.ledger.compensateNoShow({
    transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'A1-retry no-show',
    idempotencyKey: `PT_NO_SHOW:${'A1-retry no-show'}`,
  });

  const params = {
    transactionId: await nextTxn(m, f),
    price: f.price,
    totalSessions: f.totalSessions,
    usedSessions: 0,
    compensatedSessions: 1,
    rates: f.rates,
    reason: 'CLIENT_CANCELLED' as const,
    alreadyReleased: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) },
    parties: f.parties,
    label: 'A1-retry termination',
    idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
  };
  await m.ledger.terminateContract(params);
  const afterFirst = await balances(m, f);
  await m.ledger.terminateContract(params);
  const afterSecond = await balances(m, f);

  assert.equal(afterSecond.clientAvailable, afterFirst.clientAvailable, 'gọi lại không hoàn thêm cho khách');
  assert.equal(afterSecond.ptAvailable, afterFirst.ptAvailable, 'gọi lại không trả thêm cho PT');
  await m.reconcile.assertInvariant('A1 retry-safe');
});
