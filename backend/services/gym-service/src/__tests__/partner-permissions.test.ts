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
import {
  branchInfoFor, checkinsFor, frontDeskClientView, maskPayoutInfo, membershipViewFor, membershipsFor, ptTodayView, withdrawalsFor,
} from '../services/staff-views';
import { monthKeyVn, parseCommissionRange, summarizeCommission } from '../services/pt-commission-summary.service';
import { evaluateOperationalAccess, type AccessSubject } from '../services/partner-access.policy';

const ROLES = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'] as const;

// Ma trận mong đợi, viết tay độc lập với GRANTS để bắt hồi quy khi ai đó nới quyền.
const EXPECT: Record<(typeof ROLES)[number], PartnerPermission[]> = {
  OWNER: [...ALL_PERMISSIONS],
  MANAGER: ['branch.view', 'brand.view', 'plan.view', 'membership.full', 'checkin.qr', 'checkin.list', 'ptCheckin.list', 'ptCheckin.today', 'frontDesk.clients', 'branch.status.temporary'],
  RECEPTIONIST: ['branch.view', 'checkin.qr', 'checkin.list', 'ptCheckin.today', 'frontDesk.clients'],
  ACCOUNTANT: ['branch.view', 'brand.view', 'plan.view', 'membership.sales', 'finance.wallet.view', 'finance.withdrawals.view', 'finance.export', 'finance.ptCommission.view'],
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
  for (const p of ['finance.wallet.view', 'finance.withdrawals.view', 'finance.export', 'finance.ptCommission.view', 'plan.view', 'brand.view', 'membership.sales', 'membership.full', 'ptCheckin.list', 'branch.status.temporary'] as const) {
    assert.equal(hasPermission('RECEPTIONIST', p), false, p);
  }
  const writes = ['branch.status.temporary', ...OWNER_ONLY_PERMISSIONS];
  for (const p of writes) assert.equal(hasPermission('ACCOUNTANT', p as PartnerPermission), false, p);
  for (const p of ['checkin.qr', 'checkin.list', 'ptCheckin.list', 'ptCheckin.today', 'frontDesk.clients', 'membership.full'] as const) assert.equal(hasPermission('ACCOUNTANT', p), false, p);
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

test('hội viên theo vai trò: chủ/quản lý đủ; LỄ TÂN KHÔNG có danh sách hội viên; kế toán chỉ doanh số (không clientId); trường mới KHÔNG tự lộ', () => {
  assert.equal(membershipViewFor('OWNER'), 'FULL');
  assert.equal(membershipViewFor('MANAGER'), 'FULL');
  assert.equal(membershipViewFor('RECEPTIONIST'), null, 'D15b: lễ tân không xem danh sách hội viên');
  assert.equal(membershipViewFor('ACCOUNTANT'), 'SALES');
  assert.deepEqual(membershipsFor('OWNER', [membership])[0], membership);
  assert.deepEqual(membershipsFor('RECEPTIONIST', [membership]), []);
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
  const raw = { id: '1', membershipId: 'm', gymId: 'g', clientId: 'c-secret', checkedInBy: 'u', createdAt: 'x' };
  assert.deepEqual(checkinsFor('MANAGER', [raw])[0], raw);
  // D15b: lễ tân chỉ nhận tên hiển thị + giờ - không clientId / membershipId / người quét.
  const fd = checkinsFor('RECEPTIONIST', [raw], new Map([['c-secret', 'Nguyễn An']]))[0];
  assert.deepEqual(Object.keys(fd).sort(), ['clientName', 'createdAt', 'gymId', 'id']);
  assert.equal(fd.clientName, 'Nguyễn An');
  assert.equal(JSON.stringify(fd).includes('c-secret'), false);
  assert.equal(checkinsFor('RECEPTIONIST', [raw])[0].clientName, 'Hội viên', 'thiếu tên → nhãn trung tính, không lộ id');
  assert.deepEqual(checkinsFor('ACCOUNTANT', [raw]), [], 'kế toán không có danh sách check-in');
});

test('D15b · khách hôm nay / PT hôm nay của lễ tân: danh sách trường cho phép, trường lạ (SĐT, e-mail, sức khoẻ, id) không lọt', () => {
  const client: any = frontDeskClientView({
    displayName: 'An', checkedInAt: 't1', bookedAt: null, clientId: 'c1', email: 'a@b.c', phone: '09', inbody: { bmr: 1 }, healthNotes: 'x', planName: 'P',
  });
  assert.deepEqual(Object.keys(client).sort(), ['bookedAt', 'checkedInAt', 'displayName']);
  const pt: any = ptTodayView({
    id: 'i', ptName: 'PT A', firstScanAt: 'a', lastScanAt: 'b', ptUserId: 'u1', scanCount: 3, contractIds: ['c'], qualifyingSessionIds: ['s'], email: 'p@x.y',
  });
  assert.deepEqual(Object.keys(pt).sort(), ['firstScanAt', 'id', 'lastScanAt', 'ptName']);
});

test('D15b · rút tiền cho kế toán: allow-list (không walletId/reviewedBy), số tài khoản bị che', () => {
  const row = { id: 'w', walletId: 'wal', ownerId: 'g', amount: 5, status: 'PAID', payoutInfo: 'VCB 0123456789', bankReference: 'R', reviewedBy: 'admin-1', newField: 1, paidAt: 'p', createdAt: 'c', updatedAt: 'u' };
  const v: any = withdrawalsFor('ACCOUNTANT', [row])[0];
  assert.equal('walletId' in v || 'reviewedBy' in v || 'newField' in v, false);
  assert.equal(v.bankReference, 'R');
  assert.equal(v.payoutInfo.includes('0123456789'), false);
  assert.equal((withdrawalsFor('OWNER', [row])[0] as any).reviewedBy, 'admin-1');
});

const D = (iso: string) => new Date(iso);
const fact = (status: string, amount: number, clawedBack: number, createdAt: string, payoutReleasedAt: string | null, membershipStatus = 'ACTIVE') => ({
  status, amount: String(amount), clawedBack: String(clawedBack), createdAt: D(createdAt), payoutReleasedAt: payoutReleasedAt ? D(payoutReleasedAt) : null, membershipStatus,
});

test('D15b · tổng hoa hồng PT: dự kiến / đã ghi nhận / đã chi tách đúng, trừ phần thu hồi, bỏ VOIDED và thẻ đã huỷ chưa chuyển', () => {
  const r = summarizeCommission([
    fact('PENDING', 100000, 0, '2026-10-02T03:00:00Z', null, 'PENDING_PAYMENT'),
    fact('FAILED', 50000, 0, '2026-10-03T03:00:00Z', null),
    fact('RELEASED', 200000, 0, '2026-10-04T03:00:00Z', null),
    fact('RELEASED', 300000, 100000, '2026-09-30T20:00:00Z', '2026-10-20T00:00:00Z', 'EXPIRED'), // 03:00 VN ngày 1/10 → tháng 10
    fact('RELEASED', 80000, 80000, '2026-09-15T03:00:00Z', '2026-09-20T00:00:00Z', 'CANCELLED'),
    fact('VOIDED', 999999, 0, '2026-10-05T03:00:00Z', null),
    fact('PENDING', 777777, 0, '2026-10-06T03:00:00Z', null, 'CANCELLED'),
  ]);
  assert.equal(r.totals.expected, '150000.00');
  assert.equal(r.totals.recorded, '200000.00');
  assert.equal(r.totals.paid, '200000.00');
  assert.equal(r.totals.clawedBack, '180000.00');
  assert.equal(r.totals.referralCount, 5);
  assert.deepEqual(r.byMonth.map((m) => m.month), ['2026-09', '2026-10']);
  assert.equal(r.byMonth[1].paid, '200000.00');
  assert.equal(r.byMonth[0].referralCount, 1);
  assert.equal(monthKeyVn(D('2026-09-30T20:00:00Z')), '2026-10');
  // Không chiều theo PT / tỷ lệ trong kết quả.
  assert.equal(/referrer|ptUserId|rate/i.test(JSON.stringify(r)), false);
});

test('D15b · khoảng thời gian tổng hợp: mặc định hợp lệ, sai định dạng / đảo ngược / quá 24 tháng bị từ chối', () => {
  const now = D('2026-10-21T05:00:00Z');
  const def = parseCommissionRange({}, now);
  assert.equal(def.ok, true);
  if (def.ok) assert.equal(def.from.toISOString(), '2026-04-30T17:00:00.000Z', '6 tháng gần nhất, đầu tháng 5 giờ VN');
  const ok = parseCommissionRange({ from: '2026-10-01', to: '2026-10-31' }, now);
  assert.equal(ok.ok && ok.to.toISOString(), '2026-10-31T17:00:00.000Z', 'to là LOẠI TRỪ: gồm cả ngày 31');
  for (const bad of [{ from: 'x' }, { from: '2026-10-05', to: '2026-10-01' }, { from: '2020-01-01', to: '2026-10-01' }, { to: 5 }]) {
    assert.equal(parseCommissionRange(bad as any, now).ok, false, JSON.stringify(bad));
  }
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
