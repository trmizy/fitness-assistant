import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_MIN_PHOTOS,
  computeApproveBlockers,
  computeMissing,
  deriveAccessState,
  isEditableState,
  type ApproveInput,
  type CompletenessInput,
  type StateInput,
} from '../services/partner-application.state';
import {
  MAX_UPLOAD_BYTES,
  detectContentType,
  extensionFor,
  isAllowedContentType,
  validateStoredObject,
} from '../services/partner-upload.rules';

/** Hàm thuần: trạng thái điều hướng, điều kiện nộp/duyệt, và luật tải lên (loại/kích thước/chữ ký tệp). */

const base: StateInput = {
  isLegacy: false,
  hasAccount: true,
  accountStatus: 'ACTIVE',
  partnerStatus: 'PROSPECT',
  verificationStatus: 'NOT_VERIFIED',
  onboardingCompletedAt: null,
};

test('deriveAccessState: mỗi giai đoạn hồ sơ ánh xạ đúng tên nghiệp vụ', () => {
  const s = (over: Partial<StateInput>) => deriveAccessState({ ...base, ...over });
  assert.equal(s({ isLegacy: true, hasAccount: false, accountStatus: null, partnerStatus: null }), 'LEGACY');
  assert.equal(s({ hasAccount: false, accountStatus: null, partnerStatus: null }), 'SETUP_INCOMPLETE');
  assert.equal(s({}), 'ONBOARDING');
  assert.equal(s({ verificationStatus: 'IN_REVIEW' }), 'UNDER_REVIEW');
  assert.equal(s({ verificationStatus: 'NEEDS_INFO' }), 'CHANGES_REQUESTED');
  assert.equal(s({ verificationStatus: 'REJECTED' }), 'REJECTED');
  assert.equal(s({ partnerStatus: 'ACTIVE', verificationStatus: 'VERIFIED' }), 'APPROVED_PAYOUT_PENDING');
  assert.equal(s({ partnerStatus: 'ACTIVE', verificationStatus: 'VERIFIED', onboardingCompletedAt: new Date() }), 'ACTIVE');
  assert.equal(s({ partnerStatus: 'SUSPENDED', verificationStatus: 'VERIFIED' }), 'SUSPENDED');
  assert.equal(s({ partnerStatus: 'TERMINATED', verificationStatus: 'VERIFIED' }), 'TERMINATED');
});

test('deriveAccessState: tổ hợp không nhận diện được → RESTRICTED, không bao giờ tự thành ACTIVE', () => {
  const s = (over: Partial<StateInput>) => deriveAccessState({ ...base, ...over });
  assert.equal(s({ partnerStatus: 'ACTIVE', verificationStatus: 'IN_REVIEW' }), 'RESTRICTED');
  assert.equal(s({ partnerStatus: 'PROSPECT', verificationStatus: 'VERIFIED' }), 'RESTRICTED');
  assert.equal(s({ partnerStatus: 'INVITED' }), 'RESTRICTED');
  assert.equal(s({ accountStatus: 'REVOKED' }), 'RESTRICTED');
});

test('chỉ ONBOARDING và CHANGES_REQUESTED sửa được hồ sơ', () => {
  const editable = ['ONBOARDING', 'CHANGES_REQUESTED'];
  for (const st of [
    'LEGACY', 'SETUP_INCOMPLETE', 'ONBOARDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED',
    'APPROVED_PAYOUT_PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'RESTRICTED',
  ] as const) {
    assert.equal(isEditableState(st), editable.includes(st), st);
  }
});

const complete: CompletenessInput = {
  representative: { name: 'Nguyễn Văn A', phone: '0901234567', role: 'GYM_OWNER' },
  brandName: 'ABC Fitness',
  businessScale: 'ONE_BRANCH',
  branch: { name: 'ABC Nguyễn Huệ', phone: '0281234567', address: '1 Nguyễn Huệ', provinceCode: 79, wardCode: 1, latitude: 10.7, longitude: 106.7 },
  photoCount: APPLICATION_MIN_PHOTOS,
  legalName: 'Công ty ABC',
  contactEmail: 'a@b.test',
  docStatuses: { BUSINESS_LICENSE: 'RECEIVED', REPRESENTATIVE_ID: 'RECEIVED', PREMISES_PROOF: 'RECEIVED' },
  termsAcceptedAt: new Date(),
};

test('computeMissing: hồ sơ đủ → không thiếu gì', () => {
  assert.deepEqual(computeMissing(complete), []);
});

test('computeMissing: liệt kê TẤT CẢ thứ thiếu một lượt, gắn đúng mục để [Đi tới]', () => {
  const missing = computeMissing({
    representative: {},
    brandName: '',
    businessScale: null,
    branch: { name: 'Chi nhánh mới', phone: '', address: '', provinceCode: null, wardCode: null, latitude: null, longitude: null },
    photoCount: 0,
    legalName: 'a@b.test', // vẫn là email giữ chỗ = chưa nhập tên pháp lý
    contactEmail: 'a@b.test',
    docStatuses: { BUSINESS_LICENSE: 'PENDING' },
    termsAcceptedAt: null,
  });
  const sections = new Set(missing.map((m) => m.section));
  for (const s of ['REPRESENTATIVE', 'BRAND', 'SCALE', 'BRANCH', 'LOCATION', 'PHOTOS', 'LEGAL', 'TERMS']) {
    assert.ok(sections.has(s as any), `thiếu mục ${s}`);
  }
  assert.equal(missing.filter((m) => m.section === 'LEGAL' && /giấy tờ/.test(m.message)).length, 3);
  assert.ok(missing.some((m) => /tên pháp lý/.test(m.message)));
  assert.ok(missing.some((m) => /bản đồ/.test(m.message)));
});

test('computeMissing: chưa có chi nhánh → báo thiếu chi nhánh, không sập', () => {
  const missing = computeMissing({ ...complete, branch: null });
  assert.ok(missing.some((m) => m.section === 'BRANCH' && /chi nhánh đầu tiên/.test(m.message)));
});

const approvable: ApproveInput = {
  partnerStatus: 'PROSPECT',
  verificationStatus: 'IN_REVIEW',
  unresolvedIssueCount: 0,
  docStatuses: {
    BUSINESS_LICENSE: { status: 'VERIFIED', hasFile: true },
    REPRESENTATIVE_ID: { status: 'VERIFIED', hasFile: true },
    PREMISES_PROOF: { status: 'VERIFIED', hasFile: true },
  },
  draftBranchCount: 1,
  nonDraftBranchCount: 0,
};

test('computeApproveBlockers: đủ điều kiện → không có gì chặn', () => {
  assert.deepEqual(computeApproveBlockers(approvable), []);
});

test('computeApproveBlockers: mỗi điều kiện thiếu là một lý do riêng, và giấy tờ phải ĐƯỢC CHẤP NHẬN (không chỉ có tệp)', () => {
  const codes = (over: Partial<ApproveInput>) => computeApproveBlockers({ ...approvable, ...over }).map((b) => b.code);
  assert.deepEqual(codes({ verificationStatus: 'NEEDS_INFO' }), ['NOT_UNDER_REVIEW']);
  assert.deepEqual(codes({ partnerStatus: 'ACTIVE' }), ['NOT_UNDER_REVIEW']);
  assert.deepEqual(codes({ unresolvedIssueCount: 2 }), ['ISSUES_UNRESOLVED']);
  assert.deepEqual(codes({ draftBranchCount: 0 }), ['BRANCH_COUNT']);
  assert.deepEqual(codes({ draftBranchCount: 2 }), ['BRANCH_COUNT']);
  assert.deepEqual(codes({ nonDraftBranchCount: 1 }), ['UNEXPECTED_BRANCH']);
  // Có tệp nhưng mới ở RECEIVED / REJECTED → chưa được duyệt.
  assert.deepEqual(
    codes({ docStatuses: { ...approvable.docStatuses, PREMISES_PROOF: { status: 'RECEIVED', hasFile: true } } }),
    ['DOCUMENT_NOT_VERIFIED'],
  );
  assert.deepEqual(
    codes({ docStatuses: { ...approvable.docStatuses, REPRESENTATIVE_ID: { status: 'REJECTED', hasFile: true } } }),
    ['DOCUMENT_NOT_VERIFIED'],
  );
  // VERIFIED nhưng không có tệp cũng không được tính.
  assert.deepEqual(
    codes({ docStatuses: { ...approvable.docStatuses, BUSINESS_LICENSE: { status: 'VERIFIED', hasFile: false } } }),
    ['DOCUMENT_NOT_VERIFIED'],
  );
  assert.equal(codes({ docStatuses: {} }).filter((c) => c === 'DOCUMENT_NOT_VERIFIED').length, 3);
});

// ── luật tải lên ─────────────────────────────────────────────────────────────────────────────

test('chỉ cho định dạng mà trình duyệt không thực thi được: không HTML/SVG/XML/JS/office', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(isAllowedContentType('PHOTO', ok), true, ok);
  for (const ok of ['application/pdf', 'image/jpeg', 'image/png']) assert.equal(isAllowedContentType('DOCUMENT', ok), true, ok);
  assert.equal(isAllowedContentType('PHOTO', 'application/pdf'), false);
  assert.equal(isAllowedContentType('DOCUMENT', 'image/webp'), false);
  for (const bad of [
    'text/html', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript',
    'application/x-msdownload', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '',
  ]) {
    assert.equal(isAllowedContentType('PHOTO', bad), false, `PHOTO ${bad}`);
    assert.equal(isAllowedContentType('DOCUMENT', bad), false, `DOCUMENT ${bad}`);
  }
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.throws(() => extensionFor('text/html'));
});

test('detectContentType đọc CHỮ KÝ đầu tệp, không tin tên/Content-Type', () => {
  const b = (...bytes: number[]) => Uint8Array.from(bytes);
  assert.equal(detectContentType(b(0xff, 0xd8, 0xff, 0xe0, 0)), 'image/jpeg');
  assert.equal(detectContentType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png');
  assert.equal(detectContentType(b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), 'image/webp');
  assert.equal(detectContentType(new TextEncoder().encode('%PDF-1.7')), 'application/pdf');
  assert.equal(detectContentType(new TextEncoder().encode('<html><script>')), null);
  assert.equal(detectContentType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(detectContentType(b()), null);
  // RIFF nhưng không phải WEBP (vd WAV) → không nhận.
  assert.equal(detectContentType(b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)), null);
});

test('validateStoredObject: từ chối tệp rỗng, quá cỡ, sai loại khai báo, sai chữ ký', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const good = {
    kind: 'PHOTO' as const,
    declaredContentType: 'image/png',
    declaredMaxBytes: MAX_UPLOAD_BYTES,
    head: { contentLength: 100, contentType: 'image/png' },
    firstBytes: png,
  };
  assert.deepEqual(validateStoredObject(good), { ok: true });
  assert.equal(validateStoredObject({ ...good, head: { contentLength: 0, contentType: 'image/png' } }).ok, false);
  assert.equal(validateStoredObject({ ...good, head: { contentLength: MAX_UPLOAD_BYTES + 1, contentType: 'image/png' } }).ok, false);
  assert.equal(validateStoredObject({ ...good, head: { contentLength: 100, contentType: 'image/jpeg' } }).ok, false);
  assert.equal(validateStoredObject({ ...good, kind: 'PHOTO', declaredContentType: 'application/pdf' }).ok, false);
  assert.equal(validateStoredObject({ ...good, firstBytes: new TextEncoder().encode('<html>') }).ok, false);
  // Khai là PNG nhưng nội dung là JPEG → lệch.
  assert.equal(validateStoredObject({ ...good, firstBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) }).ok, false);
});
