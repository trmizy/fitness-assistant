import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { walletService, InsufficientBalanceError } from '../services/wallet.service';
import { withdrawalService } from '../services/withdrawal.service';
import { assertInvariant } from '../services/reconcile.service';

/**
 * P0 cluster F — WithdrawalRequest.approve() phải thật sự chuyển tiền AVAILABLE -> LOCKED
 * (không chỉ đổi trạng thái), markPaid trừ từ LOCKED + ESCROW, reject trả LOCKED về AVAILABLE
 * — và quan trọng nhất: một khoản thu hồi/hoàn tiền chạy SAU khi đã duyệt không được đụng
 * tới phần đã khoá.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/withdrawal-locking.integration.test.ts
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

test('approve: chuyển tiền thật từ AVAILABLE sang LOCKED — không chỉ đổi trạng thái', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');

  const approved = await withdrawalService.approve(request.id, 'admin-1');
  assert.equal((approved as any).status, 'APPROVED');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '0.00', 'phải rời khỏi available ngay khi duyệt');
  assert.equal(after!.lockedBalance.toFixed(2), '500000.00', 'phải nằm trong locked, chờ chi trả');

  await assertInvariant('after approve');
});

test('approve gọi lại lần hai (double-click admin) không khoá thêm lần nữa', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '300000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '300000', 'Bank ABC');

  await withdrawalService.approve(request.id, 'admin-1');
  await assert.rejects(() => withdrawalService.approve(request.id, 'admin-1'), (e: any) => e.code === 'INVALID_STATUS');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.lockedBalance.toFixed(2), '300000.00', 'vẫn đúng một lần khoá');
});

test('reject SAU KHI đã duyệt trả tiền về lại AVAILABLE từ LOCKED', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '400000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '400000', 'Bank ABC');
  await withdrawalService.approve(request.id, 'admin-1');

  const rejected = await withdrawalService.reject(request.id, 'admin-1', 'Thông tin ngân hàng sai');
  assert.equal((rejected as any).status, 'REJECTED');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '400000.00', 'phải trả lại đủ vào available');
  assert.equal(after!.lockedBalance.toFixed(2), '0.00', 'không được kẹt lại trong locked');

  await assertInvariant('after reject-after-approve');
});

test('reject khi CHƯA từng duyệt (vẫn PENDING) không đụng tới tiền — vì chưa từng khoá gì', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '400000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '400000', 'Bank ABC');

  await withdrawalService.reject(request.id, 'admin-1', 'Không hợp lệ');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '400000.00');
  assert.equal(after!.lockedBalance.toFixed(2), '0.00');
});

test('markPaid SAU KHI đã duyệt trừ đúng từ LOCKED (không phải AVAILABLE) và trừ ESCROW', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');
  await withdrawalService.approve(request.id, 'admin-1');

  const paid = await withdrawalService.markPaid(request.id, 'admin-1', 'REF-1');
  assert.equal((paid as any).status, 'PAID');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.lockedBalance.toFixed(2), '0.00');
  assert.equal(after!.availableBalance.toFixed(2), '0.00');

  await assertInvariant('after markPaid-after-approve');
});

test('markPaid THẲNG từ PENDING (bỏ qua approve — vẫn được hỗ trợ) tự khoá rồi chi trả trong cùng một thao tác', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '500000', 'test earnings');
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '500000', 'Bank ABC');

  const paid = await withdrawalService.markPaid(request.id, 'admin-1', 'REF-1');
  assert.equal((paid as any).status, 'PAID');

  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '0.00', 'vẫn đúng hành vi cũ đã test — tiền phải hết sau khi trả');
  assert.equal(after!.lockedBalance.toFixed(2), '0.00', 'không được kẹt lại trong locked sau khi đã trả xong');

  await assertInvariant('after markPaid-direct-from-pending');
});

test('QUAN TRỌNG NHẤT — một khoản thu hồi chạy SAU khi đã duyệt không được đụng tới phần đã khoá', async () => {
  const ptId = randomUUID();
  const wallet = await creditAvailable('PT', ptId, '1000000', 'test earnings');

  // PT có 1.000.000 khả dụng. Yêu cầu rút 700.000 được duyệt — 700.000 chuyển sang locked,
  // chỉ còn lại 300.000 thật sự "khả dụng" cho bất kỳ khoản thu hồi nào khác.
  const request = await withdrawalService.requestWithdrawal('PT', ptId, '700000', 'Bank ABC');
  await withdrawalService.approve(request.id, 'admin-1');

  const midway = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(midway!.availableBalance.toFixed(2), '300000.00');
  assert.equal(midway!.lockedBalance.toFixed(2), '700000.00');

  // Mô phỏng một khoản thu hồi (vd: PT bị phát hiện vắng mặt nhiều buổi, hoặc một khoản hoàn
  // tiền admin) cố gắng trừ 500.000 — nhiều hơn 300.000 còn thật sự khả dụng. Đây CHÍNH XÁC
  // là kịch bản task mô tả: applyDebit mặc định luôn chỉ đụng AVAILABLE — không bao giờ với
  // tới LOCKED — nên phải thất bại với InsufficientBalanceError thay vì âm thầm rút vào phần
  // đã khoá cho việc chi trả.
  const clawbackTxn = await prisma.paymentTransaction.create({
    data: {
      id: randomUUID(),
      payerId: randomUUID(),
      purpose: 'REFUND',
      amount: new Prisma.Decimal('500000'),
      idempotencyKey: `clawback-test:${randomUUID()}`,
      status: 'PAID',
    },
  });
  await assert.rejects(
    () =>
      walletService.withWallets([wallet.id], clawbackTxn.id, async (ops) => {
        await ops.debit(wallet.id, new Prisma.Decimal('500000'), 'simulated clawback');
      }),
    (e: unknown) => e instanceof InsufficientBalanceError,
    'không được để một khoản thu hồi rút vào phần đã khoá cho việc chi trả',
  );

  // Xác nhận không đồng nào bị đụng tới bởi lần thử thu hồi thất bại — cả available lẫn locked
  // vẫn y nguyên như trước khi thử.
  const after = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(after!.availableBalance.toFixed(2), '300000.00');
  assert.equal(after!.lockedBalance.toFixed(2), '700000.00');

  // Và khoản rút 700.000 đã duyệt vẫn hoàn tất bình thường sau đó — không hề bị ảnh hưởng.
  await withdrawalService.markPaid(request.id, 'admin-1', 'REF-1');
  const final = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  assert.equal(final!.lockedBalance.toFixed(2), '0.00');

  await assertInvariant('after failed clawback attempt + successful markPaid');
});
