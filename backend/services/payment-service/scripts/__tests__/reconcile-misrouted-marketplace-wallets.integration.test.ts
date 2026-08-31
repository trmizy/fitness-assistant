/**
 * Cụm C1 — chứng minh script di dời tiền bị định tuyến sai (scripts/reconcile-misrouted-
 * marketplace-wallets.ts) hoạt động đúng: dò ra đúng giao dịch, chuyển đúng số tiền qua bút
 * toán ghi sổ thật (không sửa số dư trực tiếp), giữ nguyên hoa hồng nền tảng, và idempotent.
 *
 * Sống cạnh script (ngoài src/__tests__) vì script bản thân nó nằm ngoài rootDir của tsconfig
 * (không phải một phần build bình thường của service — một công cụ chạy một lần) — để trong
 * src/__tests__ sẽ khiến `tsc --noEmit` báo lỗi rootDir. Chạy vẫn dùng đúng cùng cách:
 *
 * Dựng dữ liệu tổng hợp mô phỏng chính xác lỗi gốc: một PaymentTransaction PAID với
 * purpose=PERSONALIZED_SERVICE_PURCHASE mà receiverWalletId trỏ tới một ví loại CLIENT (thay
 * vì PT) — đúng như paymentClient.walletTransfer đã tạo ra trước khi cụm C1 được vá.
 *
 * Run THIS FILE ALONE (từ backend/services/payment-service):
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test scripts/__tests__/reconcile-misrouted-marketplace-wallets.integration.test.ts
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
  prisma: (typeof import('../../src/repositories/prisma'))['prisma'];
  Prisma: (typeof import('../../src/generated/prisma'))['Prisma'];
  wallet: (typeof import('../../src/services/wallet.service'))['walletService'];
  reconcile: typeof import('../../src/services/reconcile.service');
  script: typeof import('../reconcile-misrouted-marketplace-wallets');
};

let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../../src/repositories/prisma')).prisma,
      Prisma: (await import('../../src/generated/prisma')).Prisma,
      wallet: (await import('../../src/services/wallet.service')).walletService,
      reconcile: await import('../../src/services/reconcile.service'),
      script: await import('../reconcile-misrouted-marketplace-wallets'),
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

/** Seeds exactly the historical shape the original bug produced. */
async function seedMisroutedSale(m: Mods, opts: { grossAmount: string; commissionRate: string }) {
  const ptUserId = `pt-${randomUUID().slice(0, 8)}`;
  const buyerId = `buyer-${randomUUID().slice(0, 8)}`;
  const gross = new m.Prisma.Decimal(opts.grossAmount);
  const commission = gross.mul(opts.commissionRate);
  const netPayout = gross.minus(commission);

  // The wrongly-typed receiver wallet — money should have landed in a PT wallet, but the
  // original bug credited a CLIENT wallet keyed by the PT's own userId instead.
  const clientWallet = await m.wallet.getOrCreateWallet('CLIENT', ptUserId);
  const buyerWallet = await m.wallet.getOrCreateWallet('CLIENT', buyerId);
  const revenueWallet = await m.wallet.getRevenueWallet();
  const escrowWallet = await m.wallet.getEscrowWallet();

  // The buyer needs a real prior balance to pay from (e.g. an earlier refund) — real
  // transferInternal debits the payer's AVAILABLE balance by the full gross amount, so
  // skipping this would conjure money into the receiver/platform wallets from nowhere. Escrow
  // is credited by the same amount alongside it: every đồng anywhere in the wallet system is
  // required to be backed by escrow (that IS the reconciliation invariant), so wherever this
  // test hands the buyer a starting balance from, it must have entered the platform's custody
  // through escrow at some point — simulated here as a stand-in "money entered the system"
  // seed step, distinct from the sale transaction under test below.
  const seedTxn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: buyerId,
      purpose: 'PERSONALIZED_SERVICE_PURCHASE',
      amount: gross,
      currency: 'VND',
      status: 'PAID',
      provider: 'MOCK',
      idempotencyKey: `seed-funding-${randomUUID()}`,
      activationStatus: 'NOT_APPLICABLE',
      sourceService: 'integration-test',
    },
  });
  await m.wallet.withWallets([buyerWallet.id, escrowWallet.id], seedTxn.id, async (ops) => {
    await ops.credit(buyerWallet.id, gross, 'seed — buyer starting balance');
    await ops.credit(escrowWallet.id, gross, 'seed — backing the buyer starting balance');
  });

  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: buyerId,
      purpose: 'PERSONALIZED_SERVICE_PURCHASE',
      amount: gross,
      currency: 'VND',
      status: 'PAID',
      provider: 'MOCK',
      idempotencyKey: `seed-${randomUUID()}`,
      payerWalletId: buyerWallet.id,
      receiverWalletId: clientWallet.id,
      relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: `order-${randomUUID().slice(0, 8)}`,
      activationStatus: 'NOT_APPLICABLE',
      sourceService: 'ai-service',
    },
  });

  // Exactly what the real (buggy) transferInternal call did: debit the payer, credit the
  // (wrongly-typed) receiver with the net, credit the platform with its commission.
  await m.wallet.withWallets([buyerWallet.id, clientWallet.id, revenueWallet.id], txn.id, async (ops) => {
    await ops.debit(buyerWallet.id, gross, 'seed — payment sent');
    await ops.credit(clientWallet.id, netPayout, 'seed — misrouted payment received');
    await ops.credit(revenueWallet.id, commission, 'seed — platform commission');
  });

  await m.prisma.platformCommission.create({
    data: {
      paymentTransactionId: txn.id,
      partnerType: 'CLIENT', // the historical bug's own (also wrong) label
      partnerId: ptUserId,
      grossAmount: gross,
      platformFeeAmount: commission,
      partnerPayoutAmount: netPayout,
      commissionRate: new m.Prisma.Decimal(opts.commissionRate),
      status: 'PENDING',
    },
  });

  return { txn, ptUserId, buyerId, clientWallet, netPayout, commission };
}

test('phát hiện đúng giao dịch bị định tuyến sai — bỏ qua giao dịch đã đúng ownerType', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const bad = await seedMisroutedSale(m, { grossAmount: '1000000', commissionRate: '0.10' });

  // Một giao dịch ĐÚNG (receiver là ví PT thật) không được lẫn vào danh sách.
  const goodPtUserId = `pt-${randomUUID().slice(0, 8)}`;
  const goodPtWallet = await m.wallet.getOrCreateWallet('PT', goodPtUserId);
  const goodTxn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: `buyer-${randomUUID().slice(0, 8)}`,
      purpose: 'TRAINING_PACKAGE_PURCHASE',
      amount: new m.Prisma.Decimal('500000'),
      currency: 'VND',
      status: 'PAID',
      provider: 'MOCK',
      idempotencyKey: `seed-good-${randomUUID()}`,
      receiverWalletId: goodPtWallet.id,
      relatedEntityType: 'TRAINING_PACKAGE_PURCHASE',
      relatedEntityId: `purchase-${randomUUID().slice(0, 8)}`,
      activationStatus: 'NOT_APPLICABLE',
      sourceService: 'ai-service',
    },
  });
  await m.prisma.platformCommission.create({
    data: {
      paymentTransactionId: goodTxn.id,
      partnerType: 'PT',
      partnerId: goodPtUserId,
      grossAmount: new m.Prisma.Decimal('500000'),
      platformFeeAmount: new m.Prisma.Decimal('50000'),
      partnerPayoutAmount: new m.Prisma.Decimal('450000'),
      commissionRate: new m.Prisma.Decimal('0.10'),
      status: 'PENDING',
    },
  });

  const found = await m.script.findMisrouted();
  assert.equal(found.length, 1);
  assert.equal(found[0].transactionId, bad.txn.id);
  assert.equal(found[0].ptUserId, bad.ptUserId);
  assert.equal(found[0].netAmount.toFixed(2), bad.netPayout.toFixed(2));
});

test('di dời đúng số tiền qua bút toán thật — không đụng hoa hồng nền tảng, idempotent khi chạy lại', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const { txn, ptUserId, clientWallet, netPayout } = await seedMisroutedSale(m, {
    grossAmount: '2000000',
    commissionRate: '0.10',
  });

  const revenueBefore = await m.wallet.getRevenueWallet();

  const [row] = await m.script.findMisrouted();
  assert.ok(row, 'phải tìm thấy đúng giao dịch vừa seed');
  await m.script.migrateOne(row);

  const clientAfter = await m.prisma.wallet.findUnique({ where: { id: clientWallet.id } });
  const ptWallet = await m.prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'PT', ownerId: ptUserId } } });
  const revenueAfter = await m.wallet.getRevenueWallet();

  assert.equal(clientAfter!.availableBalance.toFixed(2), '0.00', 'ví CLIENT sai phải về 0 — toàn bộ đã chuyển đi');
  assert.equal(ptWallet!.availableBalance.toFixed(2), netPayout.toFixed(2), 'ví PT đúng phải nhận đủ đúng số tiền đã bị định tuyến sai');
  assert.equal(
    revenueAfter.availableBalance.toFixed(2),
    revenueBefore.availableBalance.toFixed(2),
    'hoa hồng nền tảng không bị đụng tới — vẫn y nguyên như lúc bán hàng gốc (commission đã được cộng lúc seed, script không chạm vào)',
  );

  const updatedCommission = await m.prisma.platformCommission.findFirst({ where: { paymentTransactionId: txn.id } });
  assert.equal(updatedCommission!.partnerType, 'PT', 'nhãn partnerType phải được sửa lại cho đúng thực tế');

  // Idempotent: chạy dò lại lần hai không còn thấy giao dịch này nữa.
  const foundAgain = await m.script.findMisrouted();
  assert.equal(foundAgain.length, 0, 'chạy lại sau khi đã sửa không được tìm thấy giao dịch này lần nữa');

  await m.reconcile.assertInvariant('C1 reconciliation script — after migration');
});

test('nếu ví CLIENT sai đã bị tiêu bớt trước khi script chạy, chỉ chuyển phần còn lại — không đẩy ví âm', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const { txn, clientWallet, netPayout } = await seedMisroutedSale(m, { grossAmount: '1000000', commissionRate: '0.10' });

  // Giả lập: một phần số dư sai đã bị rút/tiêu trước khi ai phát hiện ra lỗi — tiền thật đã
  // rời khỏi nền tảng, nên escrow cũng phải giảm tương ứng (đúng "payout" trong money-flow,
  // khác với dịch chuyển nội bộ giữa các ví).
  const spent = netPayout.minus('300000'); // còn lại 300,000
  const escrowWallet = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([clientWallet.id, escrowWallet.id], txn.id, async (ops) => {
    await ops.debit(clientWallet.id, spent, 'seed — đã tiêu trước khi script chạy');
    await ops.debit(escrowWallet.id, spent, 'seed — tiền rời khỏi nền tảng qua rút tiền');
  });

  const [row] = await m.script.findMisrouted();
  await m.script.migrateOne(row);

  const clientAfter = await m.prisma.wallet.findUnique({ where: { id: clientWallet.id } });
  assert.equal(clientAfter!.availableBalance.toFixed(2), '0.00', 'không được đẩy ví CLIENT xuống âm');
  await m.reconcile.assertInvariant('C1 reconciliation script — partial balance');
});
