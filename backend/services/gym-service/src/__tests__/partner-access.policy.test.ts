import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GymPartnerStatus,
  PartnerAccountRole,
  PartnerAccountStatus,
  PartnerVerificationStatus,
} from '../generated/prisma';
import { evaluateOperationalAccess, type AccessSubject } from '../services/partner-access.policy';

/**
 * GYM_PARTNER_SECURITY_MODEL.md §1 — cổng vận hành cho phép DƯƠNG TÍNH, mặc định từ chối.
 *
 * Ma trận dưới đây chạy trên CHÍNH các enum của Prisma, không phải danh sách viết tay: thêm một giá
 * trị enum mới thì test này đỏ cho tới khi có người quyết định nó được phép làm gì (song song với
 * \`assertNever\` khiến policy không biên dịch được). "Kỳ vọng" ở đây cố ý viết lại quy tắc bằng lời
 * theo hướng dương tính, độc lập với hình dạng code của policy.
 */

const values = <T extends Record<string, string>>(e: T) => Object.values(e) as T[keyof T][];

/** Quy tắc dương tính, viết lại độc lập: được phép ⇔ mọi điều kiện cùng đúng. */
function expectedAllowed(s: AccessSubject): boolean {
  if (s.isLegacy) return true;
  if (s.accountStatus !== 'ACTIVE') return false;
  if (s.verificationStatus !== 'VERIFIED') return false;
  if (!s.onboardingCompletedAt) return false;
  if (s.partnerStatus === 'ACTIVE') return true;
  // Tạm khoá chỉ khoá OWNER (đăng nhập bị vô hiệu ở auth-service); MANAGER vẫn vận hành như tài liệu.
  if (s.partnerStatus === 'SUSPENDED') return s.role === 'MANAGER';
  return false;
}

test('bộ giá trị enum đã được phân loại đầy đủ — enum mới phải được quyết định rõ ràng', () => {
  assert.deepEqual(values(GymPartnerStatus).sort(), ['ACTIVE', 'INVITED', 'PROSPECT', 'SUSPENDED', 'TERMINATED']);
  assert.deepEqual(values(PartnerVerificationStatus).sort(), [
    'IN_REVIEW',
    'NEEDS_INFO',
    'NOT_VERIFIED',
    'REJECTED',
    'VERIFIED',
  ]);
  assert.deepEqual(values(PartnerAccountStatus).sort(), ['ACTIVE', 'INVITED', 'REVOKED']);
});

test('ma trận: GymPartnerStatus × PartnerVerificationStatus × PartnerAccountStatus × vai trò × onboarding', () => {
  let cases = 0;
  let allowedCount = 0;
  for (const partnerStatus of values(GymPartnerStatus)) {
    for (const verificationStatus of values(PartnerVerificationStatus)) {
      for (const accountStatus of values(PartnerAccountStatus)) {
        for (const role of values(PartnerAccountRole)) {
          for (const onboardingCompletedAt of [null, new Date()]) {
            const subject: AccessSubject = {
              isLegacy: false,
              accountStatus,
              role,
              partnerStatus,
              verificationStatus,
              onboardingCompletedAt,
            };
            const decision = evaluateOperationalAccess(subject);
            const label = JSON.stringify({ ...subject, onboardingCompletedAt: onboardingCompletedAt ? 'set' : null });
            assert.equal(decision.allowed, expectedAllowed(subject), label);
            cases += 1;
            if (decision.allowed) allowedCount += 1;
          }
        }
      }
    }
  }
  assert.equal(cases, 5 * 5 * 3 * 2 * 2);
  // Đúng 2 tổ hợp được phép: ACTIVE+VERIFIED+account ACTIVE+onboarding xong (OWNER và MANAGER) và
  // SUSPENDED+VERIFIED+account ACTIVE+onboarding xong (chỉ MANAGER) → 3.
  assert.equal(allowedCount, 3);
});

test('mã từ chối đúng từng trường hợp (frontend dựa vào chúng để điều hướng)', () => {
  const base: AccessSubject = {
    isLegacy: false,
    accountStatus: 'ACTIVE',
    role: 'OWNER',
    partnerStatus: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    onboardingCompletedAt: new Date(),
  };
  const code = (over: Partial<AccessSubject>) => {
    const d = evaluateOperationalAccess({ ...base, ...over });
    return d.allowed ? 'ALLOW' : `${d.status}:${d.code}`;
  };

  assert.equal(code({}), 'ALLOW');
  assert.equal(code({ partnerStatus: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' }), '403:PARTNER_APPLICATION_PENDING');
  assert.equal(code({ partnerStatus: 'PROSPECT', verificationStatus: 'IN_REVIEW' }), '403:PARTNER_APPLICATION_PENDING');
  assert.equal(code({ partnerStatus: 'PROSPECT', verificationStatus: 'NEEDS_INFO' }), '403:PARTNER_APPLICATION_PENDING');
  assert.equal(code({ partnerStatus: 'PROSPECT', verificationStatus: 'REJECTED' }), '403:PARTNER_APPLICATION_PENDING');
  assert.equal(code({ partnerStatus: 'INVITED' }), '403:PARTNER_APPLICATION_PENDING');
  assert.equal(code({ verificationStatus: 'IN_REVIEW' }), '403:PARTNER_NOT_VERIFIED');
  assert.equal(code({ partnerStatus: 'SUSPENDED' }), '403:PARTNER_SUSPENDED');
  assert.equal(code({ partnerStatus: 'SUSPENDED', role: 'MANAGER' }), 'ALLOW');
  assert.equal(code({ partnerStatus: 'TERMINATED' }), '403:PARTNER_TERMINATED');
  assert.equal(code({ accountStatus: 'REVOKED' }), '403:ACCOUNT_NOT_ACTIVE');
  assert.equal(code({ accountStatus: null, partnerStatus: null, verificationStatus: null }), '403:NO_PARTNER_ACCOUNT');
  // Vừa duyệt, còn bước payout — 409 (không phải ứng viên), giữ đúng hành vi cũ của trình thiết lập.
  assert.equal(code({ onboardingCompletedAt: null }), '409:ONBOARDING_INCOMPLETE');
});

test('legacy chỉ là ngoại lệ khi đã được CHỨNG MINH (isLegacy do resolver quyết định)', () => {
  const orphan: AccessSubject = {
    isLegacy: false,
    accountStatus: null,
    role: 'OWNER',
    partnerStatus: null,
    verificationStatus: null,
    onboardingCompletedAt: null,
  };
  const denied = evaluateOperationalAccess(orphan);
  assert.equal(denied.allowed, false);
  assert.equal(denied.allowed === false && denied.code, 'NO_PARTNER_ACCOUNT');

  assert.equal(evaluateOperationalAccess({ ...orphan, isLegacy: true }).allowed, true);
});

test('giá trị GymPartnerStatus chưa biết → TỪ CHỐI (không tự nhiên có quyền)', () => {
  const decision = (() => {
    try {
      return evaluateOperationalAccess({
        isLegacy: false,
        accountStatus: 'ACTIVE',
        role: 'OWNER',
        partnerStatus: 'SOMETHING_NEW' as never,
        verificationStatus: 'VERIFIED',
        onboardingCompletedAt: new Date(),
      });
    } catch {
      // assertNever ném lỗi → middleware trả 500 — vẫn là TỪ CHỐI, không phải cho qua.
      return { allowed: false as const };
    }
  })();
  assert.equal(decision.allowed, false);
});
