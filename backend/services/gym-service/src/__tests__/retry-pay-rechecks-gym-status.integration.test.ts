import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { membershipService } from '../services/membership.service';

/**
 * P0 cluster E1 — retryPay không kiểm tra lại trạng thái phòng gym bị khoá.
 *
 * purchase() đã kiểm `gym.status !== 'APPROVED'` (dòng ~95, membership.service.ts) — nhưng
 * đó chỉ là kiểm tra TẠI THỜI ĐIỂM tạo đơn PENDING_PAYMENT. Nếu phòng gym bị khoá (vi phạm,
 * ngừng hoạt động) SAU khi khách đã tạo đơn nhưng TRƯỚC khi khách bấm "Pay Now" lại
 * (retryPay), khách vẫn có thể thanh toán và kích hoạt hội viên tại một phòng gym đã bị khoá
 * — money vào một phòng gym không còn được phép nhận tiền.
 */

async function makeGym(status: string) {
  return prisma.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: 'Test Gym', address: '123 Test St', status: status as any },
  });
}

async function makePlan(gymId: string) {
  return prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), gymId, name: 'Test Plan', price: 500_000, durationDays: 30 },
  });
}

async function makePendingMembership(gymId: string, planId: string, clientId: string) {
  return prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId,
      planId,
      clientId,
      status: 'PENDING_PAYMENT',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 30,
    },
  });
}

test('retryPay từ chối khi phòng gym đã bị khoá (SUSPENDED) sau khi đơn PENDING_PAYMENT được tạo', async () => {
  const gym = await makeGym('APPROVED');
  const plan = await makePlan(gym.id);
  const clientId = randomUUID();
  const membership = await makePendingMembership(gym.id, plan.id, clientId);

  try {
    // Phòng gym bị khoá SAU khi đơn đã tồn tại — mô phỏng đúng thứ tự sự kiện thật.
    await prisma.gym.update({ where: { id: gym.id }, data: { status: 'SUSPENDED' } });

    await assert.rejects(
      () => membershipService.retryPay(membership.id, clientId),
      (err: any) => {
        assert.equal(err.status, 409);
        return true;
      },
    );

    const reread = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(reread!.status, 'PENDING_PAYMENT', 'không được kích hoạt hay đổi trạng thái');
    assert.equal(reread!.paymentTxnId, null, 'không được tạo giao dịch thanh toán nào');
  } finally {
    await prisma.gymMembershipContract.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.gymMembershipPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});

test('retryPay vẫn hoạt động bình thường khi phòng gym còn APPROVED', async () => {
  const gym = await makeGym('APPROVED');
  const plan = await makePlan(gym.id);
  const clientId = randomUUID();
  const membership = await makePendingMembership(gym.id, plan.id, clientId);

  try {
    // payment-service thật đang chạy (docker) và checkout thật sự thành công (sandbox VNPay
    // trả về redirect) — chỉ cần xác nhận kiểm tra trạng thái phòng gym KHÔNG chặn nhầm một
    // yêu cầu hợp lệ.
    const result = await membershipService.retryPay(membership.id, clientId);
    assert.ok(result.payment, 'phải bắt đầu checkout thành công khi phòng gym vẫn APPROVED');
  } finally {
    await prisma.gymMembershipContract.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.gymMembershipPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});
