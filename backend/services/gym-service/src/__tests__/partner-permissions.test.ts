/**
 * CODE/UNIT — D15 danh mục quyền (partner-permissions.ts), phạm vi chi nhánh, hình dạng dữ liệu theo vai trò
 * (staff-views.ts) và cổng vận hành khi đối tác bị tạm khoá (partner-access.policy.ts). Không DB, không mạng.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS, OWNER_ONLY_PERMISSIONS, canAccessGym, filterByScope, hasPermission, isInvitableStaffRole,
  permissionsOf, roleRequiresBranchScope, type PartnerPermission,
} from '../services/partner-permissions';
import { branchInfoFor, checkinsFor, maskPayoutInfo, membershipViewFor, membershipsFor, withdrawalsFor } from '../services/staff-views';
import { evaluateOperationalAccess, type AccessSubject } from '../services/partner-access.policy';

const ROLES = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'] as const;

// Ma trận mong đợi, viết tay độc lập với GRANTS để bắt hồi quy khi ai đó nới quyền.
const EXPECT: Record<(typeof ROLES)[number], PartnerPermission[]> = {
  OWNER: [...ALL_PERMISSIONS],
  MANAGER: ['branch.view', 'brand.view', 'plan.view', 'membership.full', 'membership.validity', 'checkin.qr', 'checkin.list', 'ptCheckin.list', 'branch.status.temporary'],
  RECEPTIONIST: ['branch.view', 'membership.validity', 'checkin.qr', 'checkin.list'],
  ACCOUNTANT: ['branch.view', 'brand.view', 'plan.view', 'membership.sales', 'finance.wallet.view', 'finance.withdrawals.view', 'finance.export'],
};

test('ma trận quyền khớp đặc tả cho từng vai trò (mặc định từ chối mọi thứ không liệt kê)', () => {
  for (const role of ROLES) {
    assert.deepEqual(permissionsOf(role).sort(), [...EXPECT[role]].sort(), role);
    for (const p of ALL_PERMISSIONS) assert.equal(hasPermission(role, p), EXPECT[role].includes(p), `${role} ${p}`);
  }
});

test('quyền chỉ-chủ (ghi, nhân sự, cộng tác PT, rút tiền, đóng vĩnh viễn, listing) KHÔNG vai trò nào khác có', () => {
  for (const role of ['MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'] as const) {
    for (const p of OWNER_ONLY_PERMISSIONS) assert.equal(hasPermission(role, p), false, `${role} ${p}`);
  }
});

test('LỄ TÂN không có quyền tài chính / cộng tác / nhân sự / ghi; KẾ TOÁN không có quyền ghi nào', () => {
  for (const p of ['finance.wallet.view', 'finance.withdrawals.view', 'finance.export', 'plan.view', 'brand.view', 'membership.sales', 'membership.full', 'ptCheckin.list', 'branch.status.temporary'] as const) {
    assert.equal(hasPermission('RECEPTIONIST', p), false, p);
  }
  const writes = ['branch.status.temporary', ...OWNER_ONLY_PERMISSIONS];
  for (const p of writes) assert.equal(hasPermission('ACCOUNTANT', p as PartnerPermission), false, p);
  for (const p of ['checkin.qr', 'checkin.list', 'membership.validity', 'membership.full'] as const) assert.equal(hasPermission('ACCOUNTANT', p), false, p);
});

test('vai trò lạ / thiếu → từ chối (fail-closed)', () => {
  assert.equal(hasPermission('FACILITY_STAFF' as any, 'branch.view'), false);
  assert.equal(hasPermission(undefined as any, 'branch.view'), false);
});

test('chỉ mời được QUẢN LÝ / LỄ TÂN / KẾ TOÁN; phạm vi bắt buộc cho quản lý + lễ tân, tuỳ chọn cho kế toán', () => {
  assert.equal(isInvitableStaffRole('RECEPTIONIST'), true);
  assert.equal(isInvitableStaffRole('ACCOUNTANT'), true);
  assert.equal(isInvitableStaffRole('MANAGER'), true);
  assert.equal(isInvitableStaffRole('OWNER'), false);
  assert.equal(isInvitableStaffRole('FACILITY_STAFF'), false);
  assert.equal(roleRequiresBranchScope('MANAGER'), true);
  assert.equal(roleRequiresBranchScope('RECEPTIONIST'), true);
  assert.equal(roleRequiresBranchScope('ACCOUNTANT'), false);
});

test('phạm vi chi nhánh: OWNER tất cả; kế toán rỗng = cả thương hiệu; còn lại chỉ chi nhánh được gán', () => {
  assert.equal(canAccessGym({ role: 'OWNER', scopedGymIds: [] }, 'g1'), true);
  assert.equal(canAccessGym({ role: 'ACCOUNTANT', scopedGymIds: [] }, 'g1'), true);
  assert.equal(canAccessGym({ role: 'ACCOUNTANT', scopedGymIds: ['g2'] }, 'g1'), false);
  assert.equal(canAccessGym({ role: 'ACCOUNTANT', scopedGymIds: ['g1'] }, 'g1'), true);
  // Lễ tân / quản lý rỗng KHÔNG phải "tất cả" (CHECK ở DB cấm, nhưng tầng này cũng không được suy diễn).
  assert.equal(canAccessGym({ role: 'RECEPTIONIST', scopedGymIds: [] }, 'g1'), false);
  assert.equal(canAccessGym({ role: 'MANAGER', scopedGymIds: [] }, 'g1'), false);
  assert.equal(canAccessGym({ role: 'RECEPTIONIST', scopedGymIds: ['g1'] }, 'g2'), false);
  assert.deepEqual(filterByScope({ role: 'RECEPTIONIST', scopedGymIds: ['g1'] }, [{ id: 'g1' }, { id: 'g2' }]), [{ id: 'g1' }]);
});

const membership = {
  id: 'm1', gymId: 'g1', planId: 'p1', clientId: 'c1', status: 'ACTIVE', paymentTxnId: 'T1', startDate: 's', endDate: 'e',
  priceAtPurchase: '700000', durationDaysSnapshot: 30, totalVisits: 10, usedVisits: 3, payoutReleasedAt: 'x',
  multiGymWarned: true, refundClawbackDone: false, createdAt: 'c', updatedAt: 'u', someFutureField: 'secret',
};

test('hội viên theo vai trò: chủ/quản lý đủ; lễ tân chỉ hạn+lượt; kế toán chỉ doanh số (không clientId); trường mới KHÔNG tự lộ', () => {
  assert.equal(membershipViewFor('OWNER'), 'FULL');
  assert.equal(membershipViewFor('MANAGER'), 'FULL');
  assert.equal(membershipViewFor('RECEPTIONIST'), 'FRONT_DESK');
  assert.equal(membershipViewFor('ACCOUNTANT'), 'SALES');
  assert.deepEqual(membershipsFor('OWNER', [membership])[0], membership);
  const fd = membershipsFor('RECEPTIONIST', [membership])[0];
  assert.deepEqual(Object.keys(fd).sort(), ['clientId', 'createdAt', 'endDate', 'gymId', 'id', 'planId', 'startDate', 'status', 'totalVisits', 'usedVisits']);
  const sales = membershipsFor('ACCOUNTANT', [membership])[0];
  assert.equal('clientId' in sales, false);
  assert.equal('usedVisits' in sales, false);
  assert.equal('someFutureField' in sales, false);
  assert.equal(sales.priceAtPurchase, '700000');
  assert.deepEqual(membershipsFor('NOPE' as any, [membership]), []);
});

test('che số tài khoản trong thông tin nhận tiền (giữ 4 số cuối); chủ thấy nguyên văn', () => {
  assert.equal(maskPayoutInfo('VCB 0123456789012 NGUYEN VAN A'), 'VCB •********9012 NGUYEN VAN A'.replace('•********', '•'.repeat(9)));
  assert.equal(maskPayoutInfo('Momo 0901'), 'Momo 0901', 'chuỗi số ngắn không đổi');
  assert.equal(maskPayoutInfo(null), null);
  const rows = [{ amount: 1, payoutInfo: 'ACB 123456789' }];
  assert.equal((withdrawalsFor('ACCOUNTANT', rows)[0] as any).payoutInfo.includes('123456789'), false);
  assert.equal((withdrawalsFor('OWNER', rows)[0] as any).payoutInfo, 'ACB 123456789');
});

test('chi nhánh và check-in: lễ tân/kế toán nhận bản rút gọn; quản lý nguyên trạng', () => {
  const gym = { id: 'g', ownerId: 'o', name: 'n', address: 'a', changesRequestedBy: 'adm', status: 'APPROVED', brand: { id: 'b', name: 'B', logoKey: 'k', ownerId: 'o' } };
  assert.equal(branchInfoFor('MANAGER', gym), gym);
  const v: any = branchInfoFor('RECEPTIONIST', gym);
  assert.equal('ownerId' in v, false);
  assert.equal('changesRequestedBy' in v, false);
  assert.equal('logoKey' in v.brand, false);
  assert.equal('ownerId' in v.brand, false);
  assert.equal('checkedInBy' in checkinsFor('RECEPTIONIST', [{ id: '1', membershipId: 'm', gymId: 'g', clientId: 'c', checkedInBy: 'u', createdAt: 'x' }])[0], false);
});

const base: AccessSubject = {
  isLegacy: false, accountStatus: 'ACTIVE', role: 'OWNER', partnerStatus: 'ACTIVE', verificationStatus: 'VERIFIED', onboardingCompletedAt: new Date(),
};

test('cổng vận hành: bình thường mọi vai trò qua; tạm khoá chặn OWNER + KẾ TOÁN, giữ MANAGER + LỄ TÂN; chấm dứt chặn tất cả', () => {
  for (const role of ROLES) assert.equal(evaluateOperationalAccess({ ...base, role }).allowed, true, role);
  const susp = (role: AccessSubject['role']) => evaluateOperationalAccess({ ...base, role, partnerStatus: 'SUSPENDED' });
  assert.equal(susp('OWNER').allowed, false);
  assert.equal(susp('ACCOUNTANT').allowed, false);
  assert.equal((susp('ACCOUNTANT') as any).code, 'PARTNER_SUSPENDED');
  assert.equal(susp('MANAGER').allowed, true);
  assert.equal(susp('RECEPTIONIST').allowed, true);
  for (const role of ROLES) assert.equal(evaluateOperationalAccess({ ...base, role, partnerStatus: 'TERMINATED' }).allowed, false, role);
  assert.equal(evaluateOperationalAccess({ ...base, role: 'RECEPTIONIST', accountStatus: 'REVOKED' }).allowed, false);
  assert.equal(evaluateOperationalAccess({ ...base, role: 'ACCOUNTANT', onboardingCompletedAt: null }).allowed, false);
});
