/**
 * CODE/UNIT — D15c: cấu hình phương thức xác minh, chuẩn hoá mã/tên, danh sách trường cho phép, ma trận quyền mới. Không DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enabledAutoMethods, businessCodeOf, AssistedCheckinError } from '../services/assisted-checkin.service';
import {
  assistedCheckinResultView, exceptionView, formatMemberCode, memberSearchResultView, nameMatchesPrefix, normalizeMemberCode, normalizeNameForSearch,
} from '../services/assisted-checkin.views';
import { hasPermission } from '../services/partner-permissions';

test('ASSISTED_CHECKIN_METHODS: mặc định PHOTO_MATCH + MEMBER_OTP; lọc giá trị lạ; rỗng = không phương thức tự động', () => {
  assert.deepEqual(enabledAutoMethods(undefined).sort(), ['MEMBER_OTP', 'PHOTO_MATCH']);
  assert.deepEqual(enabledAutoMethods('PHOTO_MATCH'), ['PHOTO_MATCH']);
  assert.deepEqual(enabledAutoMethods(' member_otp , nonsense,MANAGER_EXCEPTION'), ['MEMBER_OTP'], 'ngoại lệ không phải phương thức tự động; giá trị lạ bị bỏ');
  assert.deepEqual(enabledAutoMethods(''), []);
});

test('mã hội viên: chuẩn hoá mọi cách gõ; định dạng XXXX-XXXX', () => {
  assert.equal(normalizeMemberCode(' a1b2-c3d4 '), 'A1B2C3D4');
  assert.equal(normalizeMemberCode(undefined), '');
  assert.equal(formatMemberCode('a1b2c3d4'), 'A1B2-C3D4');
  assert.equal(formatMemberCode(null), '');
});

test('tên: tiền tố không phân biệt dấu/hoa thường, khớp tiền tố của cả tên hoặc một từ; không khớp giữa chừng', () => {
  assert.equal(normalizeNameForSearch('  Đặng  Thị Ánh '), 'dang thi anh');
  assert.equal(nameMatchesPrefix('Nguyễn Văn An', 'nguyen'), true);
  assert.equal(nameMatchesPrefix('Nguyễn Văn An', 'văn'), true);
  assert.equal(nameMatchesPrefix('Nguyễn Văn An', 'nguyen van a'), true);
  assert.equal(nameMatchesPrefix('Nguyễn Văn An', 'guyen'), false);
  assert.equal(nameMatchesPrefix('Nguyễn Văn An', ''), false);
  assert.equal(nameMatchesPrefix('Đỗ Bình', 'do'), true);
});

test('danh sách trường cho phép: trường lạ (giá, SĐT, e-mail, clientId, sức khoẻ) không bao giờ lọt ra kết quả tra cứu / check-in / ngoại lệ', () => {
  const dirty = {
    membershipId: 'm', displayName: 'An', memberCode: 'A1B2-C3D4', planName: 'P', planType: 'TIME_BASED', status: 'ACTIVE', expiresAt: 'x',
    branchScope: 'BRAND', coversThisBranch: true, remainingVisits: null, photoUrl: null, hasPhoto: false, canCheckIn: true, blockedReason: null,
    clientId: 'c', email: 'a@b.c', phone: '09', priceAtPurchase: 1, paymentTxnId: 'T', inbody: {}, healthNotes: 'x',
  };
  const v: any = memberSearchResultView(dirty);
  for (const k of ['clientId', 'email', 'phone', 'priceAtPurchase', 'paymentTxnId', 'inbody', 'healthNotes']) assert.equal(k in v, false, k);
  assert.equal(Object.keys(v).length, 14);
  const c: any = assistedCheckinResultView({ checkinId: 'i', usedVisits: 1, clientId: 'c', email: 'e', otp: '123456' });
  assert.deepEqual(Object.keys(c).sort(), ['checkinId', 'usedVisits']);
  const e: any = exceptionView({ id: 'x', status: 'PENDING', requestedBy: 'staff-uid', decidedBy: 'mgr-uid', clientId: 'c' });
  assert.deepEqual(Object.keys(e).sort(), ['id', 'status']);
});

test('ma trận quyền mới: member.search / checkin.assisted / checkin.exception.request cho lễ tân+quản lý+chủ; approve chỉ quản lý+chủ; kế toán không có gì', () => {
  const caps = ['member.search', 'checkin.assisted', 'checkin.exception.request', 'checkin.exception.approve'] as const;
  const expected = {
    OWNER: [true, true, true, true], MANAGER: [true, true, true, true], RECEPTIONIST: [true, true, true, false], ACCOUNTANT: [false, false, false, false],
  } as const;
  for (const role of ['OWNER', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'] as const) {
    caps.forEach((cap, i) => assert.equal(hasPermission(role, cap), expected[role][i], `${role} ${cap}`));
  }
});

test('mã lỗi nghiệp vụ nhận diện được; lỗi hệ thống thì không', () => {
  assert.deepEqual(businessCodeOf(new AssistedCheckinError('OTP_EXPIRED', 410)), { code: 'OTP_EXPIRED', status: 410 });
  assert.deepEqual(businessCodeOf(Object.assign(new Error('TOO_SOON'), { status: 429 })), { code: 'TOO_SOON', status: 429 });
  assert.equal(businessCodeOf(new Error('connect ECONNREFUSED')), null);
  assert.equal(businessCodeOf(Object.assign(new Error('Gym not found'), { status: 404 })), null);
});
