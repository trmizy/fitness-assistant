/**
 * GYM_PARTNER_SELF_ONBOARDING_SPEC.md — nghiệm thu luồng hồ sơ đối tác tự đăng ký (BACKEND INTEGRATION).
 *
 * Chạy trên CSDL thật (DATABASE_URL; nên là DB `*_test` riêng) + MinIO thật cho phần tải lên. Tạo dòng
 * thật, dọn sạch sau mỗi bài. Email không bao giờ được gửi thật: AUTH_SERVICE_URL trỏ vào một cổng
 * chết nên authClient.sendEmail thất bại nhanh và chỉ log.
 *
 * Kiểm: vòng đời đầy đủ (bootstrap → điền → nộp → yêu cầu sửa → thay giấy tờ → nộp lại → duyệt),
 * nộp lại KHÔNG đóng issue, approve KHÔNG tự VERIFIED giấy tờ, approve atomic thật (ép lỗi giữa chừng
 * → không có trạng thái nửa vời) và không thắng hai lần, ràng buộc 1 Owner = 1 Brand = đúng 1 chi nhánh
 * trong hồ sơ, và cứng hoá tải lên (loại tệp/kích thước/chữ ký/khoá của partner khác).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:9';
process.env.PARTNER_S3_ENDPOINT = process.env.PARTNER_S3_ENDPOINT || 'http://localhost:9000';
process.env.PARTNER_S3_PUBLIC_ENDPOINT = process.env.PARTNER_S3_PUBLIC_ENDPOINT || 'http://localhost:9000';
process.env.PARTNER_S3_REGION = 'us-east-1';
process.env.PARTNER_S3_FORCE_PATH_STYLE = 'true';
process.env.PARTNER_S3_ACCESS_KEY_ID = process.env.PARTNER_S3_ACCESS_KEY_ID || 'gymini_minio';
process.env.PARTNER_S3_SECRET_ACCESS_KEY = process.env.PARTNER_S3_SECRET_ACCESS_KEY || 'gymini_minio_secret';
process.env.PARTNER_S3_PRIVATE_BUCKET = process.env.PARTNER_S3_PRIVATE_BUCKET || 'gymini-partner-private';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

// Bytes tối thiểu mang đúng "chữ ký" từng định dạng (validateStoredObject chỉ đọc đầu tệp).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 3)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(100));

type Mods = {
  prisma: typeof import('../repositories/prisma').prisma;
  partnerService: typeof import('../services/partner.service').partnerService;
  app: typeof import('../services/partner-application.service').partnerApplicationService;
  upload: typeof import('../services/partner-upload.service').partnerUploadService;
  review: typeof import('../services/partner-application-review.service').partnerApplicationReviewService;
  audit: typeof import('../services/partner-audit.service').partnerAuditService;
  s3: typeof import('../services/partner-s3.service').partnerS3;
  gymService: typeof import('../services/gym.service').gymService;
  applyGymApprovalTx: typeof import('../services/gym-approval.tx').applyGymApprovalTx;
  block: typeof import('../controllers/application-review.controller').blockSelfServicePartner;
};
let m: Mods;
let s3Up = false;
const created = { partnerIds: [] as string[], ownerIds: [] as string[], keys: [] as string[] };

test.before(async () => {
  if (!process.env.DATABASE_URL) return;
  m = {
    prisma: (await import('../repositories/prisma')).prisma,
    partnerService: (await import('../services/partner.service')).partnerService,
    app: (await import('../services/partner-application.service')).partnerApplicationService,
    upload: (await import('../services/partner-upload.service')).partnerUploadService,
    review: (await import('../services/partner-application-review.service')).partnerApplicationReviewService,
    audit: (await import('../services/partner-audit.service')).partnerAuditService,
    s3: (await import('../services/partner-s3.service')).partnerS3,
    gymService: (await import('../services/gym.service')).gymService,
    applyGymApprovalTx: (await import('../services/gym-approval.tx')).applyGymApprovalTx,
    block: (await import('../controllers/application-review.controller')).blockSelfServicePartner,
  };
  try {
    s3Up = (await m.s3.headObject('__probe__')) === null; // null = bucket trả lời "không có" → MinIO sống
  } catch {
    s3Up = false;
  }
});

test.after(async () => {
  if (!m) return;
  for (const key of created.keys) await m.s3.deleteObject(key).catch(() => undefined);
  await m.prisma.gymPhoto.deleteMany({ where: { gym: { ownerId: { in: created.ownerIds } } } });
  await m.prisma.gym.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
  await m.prisma.gymBrand.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
  await m.prisma.gymPartner.deleteMany({ where: { id: { in: created.partnerIds } } });
  await m.prisma.$disconnect();
});

const s3Test = (name: string, fn: () => Promise<void>) =>
  integrationTest(name, async (t) => {
    if (!s3Up) return t.skip('MinIO không chạy (docker compose up minio minio-init)');
    await fn();
  });

async function newApplicant() {
  const userId = randomUUID();
  const email = `${userId.slice(0, 8)}@applicants.test`;
  await m.app.bootstrap(userId, email);
  created.ownerIds.push(userId);
  const ctx = await m.partnerService.resolveContextForUser(userId);
  created.partnerIds.push(ctx.partnerId!);
  return { userId, email, partnerId: ctx.partnerId! };
}

const ctxOf = (userId: string) => m.partnerService.resolveContextForUser(userId);

/** Tải lên đúng như trình duyệt: presign → POST multipart thẳng lên S3 → confirm. */
async function uploadAs(
  applicant: { userId: string },
  input: { kind: 'PHOTO' | 'DOCUMENT' | 'LOGO'; docType?: any; contentType: string; body: Buffer; declaredSize?: number },
) {
  const ctx = await ctxOf(applicant.userId);
  const presigned = await m.upload.presign(ctx, applicant.userId, {
    kind: input.kind,
    contentType: input.contentType,
    sizeBytes: input.declaredSize ?? input.body.length,
    docType: input.docType,
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) form.append(k, v as string);
  form.append('file', new Blob([input.body], { type: input.contentType }), 'upload.bin');
  const res = await fetch(presigned.url, { method: 'POST', body: form });
  const intent = await m.prisma.partnerUploadIntent.findUniqueOrThrow({ where: { id: presigned.uploadId } });
  created.keys.push(intent.objectKey);
  return { presigned, res, intent };
}

async function uploadOk(applicant: { userId: string }, input: Parameters<typeof uploadAs>[1]) {
  const { presigned, res } = await uploadAs(applicant, input);
  assert.ok(res.status === 204 || res.status === 201 || res.status === 200, `S3 POST → ${res.status}`);
  return m.upload.confirm(await ctxOf(applicant.userId), applicant.userId, presigned.uploadId);
}

/** Điền đủ hồ sơ để nộp được. */
async function fillApplication(a: { userId: string }, opts: { docs?: boolean } = { docs: true }) {
  let ctx = await ctxOf(a.userId);
  await m.app.updateRepresentative(ctx, { name: 'Nguyễn Văn A', phone: '0901234567', role: 'GYM_OWNER' });
  await m.app.updateBusinessScale(ctx, 'MULTIPLE_BRANCHES');
  await m.app.upsertBrand(ctx, { name: 'ABC Fitness', description: 'Chuỗi phòng tập' });
  await m.app.upsertBranch(ctx, {
    name: 'ABC Fitness Nguyễn Huệ',
    phone: '0281234567',
    address: '1 Nguyễn Huệ',
    provinceCode: 79,
    wardCode: 26734,
    latitude: 10.7745,
    longitude: 106.7031,
  });
  await m.app.updateLegal(ctx, { legalName: 'Công ty TNHH ABC', taxCode: '0312345678' });
  await uploadOk(a, { kind: 'PHOTO', contentType: 'image/jpeg', body: JPEG });
  if (opts.docs !== false) {
    await uploadOk(a, { kind: 'DOCUMENT', docType: 'BUSINESS_LICENSE', contentType: 'application/pdf', body: PDF });
    await uploadOk(a, { kind: 'DOCUMENT', docType: 'REPRESENTATIVE_ID', contentType: 'image/png', body: PNG });
    await uploadOk(a, { kind: 'DOCUMENT', docType: 'PREMISES_PROOF', contentType: 'image/jpeg', body: JPEG });
  }
  ctx = await ctxOf(a.userId);
  return ctx;
}

async function submitted(a: { userId: string }) {
  await fillApplication(a);
  const ctx = await ctxOf(a.userId);
  const r = await m.app.submit(ctx, a.userId, { acceptTerms: true });
  assert.equal(r.alreadySubmitted, false);
  return ctx.partnerId!;
}

const auditActions = async (partnerId: string) =>
  (await m.prisma.partnerAuditLog.findMany({ where: { partnerId }, orderBy: { createdAt: 'asc' } })).map((r) => r.action);

// ── bootstrap ────────────────────────────────────────────────────────────────────────────────

integrationTest('bootstrap tạo hồ sơ PROSPECT/SELF_SERVICE + tài khoản OWNER ACTIVE, và idempotent kể cả song song', async () => {
  const userId = randomUUID();
  created.ownerIds.push(userId);
  const results = await Promise.all(Array.from({ length: 6 }, () => m.app.bootstrap(userId, 'race@applicants.test')));
  assert.equal(results.filter((r) => r.created).length, 1, 'chỉ một lần tạo thật');
  const ids = new Set(results.map((r) => r.partnerId));
  assert.equal(ids.size, 1, 'mọi lần gọi trả về cùng một hồ sơ');
  created.partnerIds.push([...ids][0]);

  const partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: [...ids][0] }, include: { accounts: true } });
  assert.equal(partner.status, 'PROSPECT');
  assert.equal(partner.verificationStatus, 'NOT_VERIFIED');
  assert.equal(partner.source, 'SELF_SERVICE');
  assert.equal(partner.accounts.length, 1);
  assert.equal(partner.accounts[0].role, 'OWNER');
  assert.equal(partner.accounts[0].status, 'ACTIVE');
  assert.equal(partner.accounts[0].onboardingCompletedAt, null, 'chưa hoàn tất onboarding → không tự có quyền vận hành');

  const ctx = await ctxOf(userId);
  assert.equal(m.app.getStatus(ctx).accessState, 'ONBOARDING');
});

integrationTest('bootstrap từ chối chủ gym cũ đã chứng minh được sở hữu (không cần đăng ký đối tác mới)', async () => {
  const userId = randomUUID();
  created.ownerIds.push(userId);
  await m.prisma.gym.create({ data: { ownerId: userId, name: 'Gym cũ', address: 'x', status: 'APPROVED' } });
  await assert.rejects(m.app.bootstrap(userId, 'legacy@x.test'), (e: any) => e.status === 409 && e.code === 'LEGACY_OWNER');
});

// ── 1 Owner = 1 Brand = đúng 1 chi nhánh trong hồ sơ ──────────────────────────────────────────

integrationTest('bất biến: brand thứ hai không tạo được (kể cả song song); chi nhánh trong hồ sơ luôn chỉ có MỘT', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);

  // Chưa có brand thì chưa tạo được chi nhánh.
  await assert.rejects(m.app.upsertBranch(ctx, { name: 'X' }), (e: any) => e.code === 'BRAND_REQUIRED');

  const brands = await Promise.allSettled([1, 2, 3, 4].map((i) => m.app.upsertBrand(ctx, { name: `Thương hiệu ${i}` })));
  assert.ok(brands.every((b) => b.status === 'fulfilled'), 'các lần gọi song song đều hội tụ về cùng một brand, không lỗi');
  assert.equal(await m.prisma.gymBrand.count({ where: { ownerId: a.userId } }), 1, 'DB chỉ có một brand');

  // Ràng buộc DB (UNIQUE gym_brands.owner_id) chặn cả đường vòng qua repository.
  await assert.rejects(
    m.prisma.gymBrand.create({ data: { ownerId: a.userId, name: 'Brand lậu' } }),
    (e: any) => e.code === 'P2002',
  );

  const many = await Promise.all([1, 2, 3].map((i) => m.app.upsertBranch(ctx, { name: `Chi nhánh ${i}` })));
  assert.equal(new Set(many.map((g) => g.id)).size, 1, 'nhiều lần upsert song song vẫn là MỘT chi nhánh nháp');
  assert.equal(await m.prisma.gym.count({ where: { ownerId: a.userId } }), 1);
});

integrationTest('brandId của chi nhánh do server suy ra từ brand của ứng viên, không nhận từ client', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);
  const brand = await m.app.upsertBrand(ctx, { name: 'Brand Của Tôi' });
  const gym = await m.app.upsertBranch(ctx, { name: 'CN1', brandId: 'brand-cua-nguoi-khac' } as any);
  assert.equal(gym.brandId, brand.id);
});

// ── vòng đời đầy đủ ──────────────────────────────────────────────────────────────────────────

s3Test('vòng đời: điền → nộp → yêu cầu sửa → thay giấy tờ → nộp lại (KHÔNG đóng issue) → duyệt', async () => {
  const a = await newApplicant();
  const admin = randomUUID();
  await fillApplication(a);

  // Chưa chấp nhận điều khoản → chưa nộp được, và báo đúng thứ còn thiếu.
  let ctx = await ctxOf(a.userId);
  await assert.rejects(m.app.submit(ctx, a.userId, {}), (e: any) => e.code === 'APPLICATION_INCOMPLETE' && e.issues.some((i: any) => i.field === 'TERMS'));

  // Nộp: chuyển đúng một lần, bấm đúp không lỗi, không nhân đôi audit.
  const first = await m.app.submit(ctx, a.userId, { acceptTerms: true });
  const again = await m.app.submit(await ctxOf(a.userId), a.userId, { acceptTerms: true });
  assert.equal(first.alreadySubmitted, false);
  assert.equal(again.alreadySubmitted, true);
  let partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(partner.verificationStatus, 'IN_REVIEW');
  assert.ok(partner.submittedAt);
  assert.equal((await auditActions(a.partnerId)).filter((x) => x === 'APPLICATION_SUBMITTED').length, 1);

  // Khoá sửa khi đang xét duyệt.
  ctx = await ctxOf(a.userId);
  await assert.rejects(m.app.updateLegal(ctx, { legalName: 'Đổi tên' }), (e: any) => e.code === 'APPLICATION_LOCKED');

  // Admin yêu cầu sửa: 1 issue + 1 giấy tờ.
  await m.review.requestChanges(
    a.partnerId,
    admin,
    {
      issues: [{ category: 'LOCATION', message: 'Điểm ghim chưa đúng địa chỉ' }],
      documents: [{ docType: 'BUSINESS_LICENSE', note: 'Ảnh mờ, vui lòng chụp lại' }],
    },
  );
  partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(partner.verificationStatus, 'NEEDS_INFO');
  const license = await m.prisma.gymPartnerDocument.findUniqueOrThrow({
    where: { partnerId_docType: { partnerId: a.partnerId, docType: 'BUSINESS_LICENSE' } },
  });
  assert.equal(license.status, 'REJECTED', '"Cần cập nhật"');
  const issue = await m.prisma.gymPartnerReviewIssue.findFirstOrThrow({ where: { partnerId: a.partnerId } });
  assert.equal(issue.status, 'OPEN');

  // Chưa đánh dấu issue / chưa thay giấy tờ → chưa gửi lại được.
  ctx = await ctxOf(a.userId);
  await assert.rejects(m.app.resubmit(ctx, a.userId), (e: any) => e.code === 'ISSUES_NOT_ACKNOWLEDGED');
  await m.app.markIssueUpdated(ctx, a.userId, issue.id, 'Đã ghim lại');
  await assert.rejects(m.app.resubmit(ctx, a.userId), (e: any) => e.code === 'DOCUMENTS_NOT_REPLACED');

  // Thay giấy tờ → quay lại RECEIVED, version 2, audit DOCUMENT_REPLACED.
  await uploadOk(a, { kind: 'DOCUMENT', docType: 'BUSINESS_LICENSE', contentType: 'application/pdf', body: PDF });
  const replaced = await m.prisma.gymPartnerDocument.findUniqueOrThrow({
    where: { partnerId_docType: { partnerId: a.partnerId, docType: 'BUSINESS_LICENSE' } },
  });
  assert.equal(replaced.status, 'RECEIVED');
  assert.equal(replaced.version, 2);
  assert.equal(replaced.reviewNote, null);
  assert.ok((await auditActions(a.partnerId)).includes('DOCUMENT_REPLACED'));

  // Gửi lại: IN_REVIEW, nhưng issue KHÔNG được tự đóng.
  await m.app.resubmit(await ctxOf(a.userId), a.userId);
  partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(partner.verificationStatus, 'IN_REVIEW');
  const afterResubmit = await m.prisma.gymPartnerReviewIssue.findUniqueOrThrow({ where: { id: issue.id } });
  assert.equal(afterResubmit.status, 'RESUBMITTED', 'nộp lại không chứng minh vấn đề đã được sửa đúng ý');
  assert.equal(afterResubmit.resolvedAt, null);

  // Approve bị chặn: issue chưa đóng + giấy tờ chưa được admin chấp nhận (Approve KHÔNG tự VERIFIED).
  await assert.rejects(m.review.approve(a.partnerId, admin), (e: any) => {
    assert.equal(e.code, 'APPROVE_BLOCKED');
    const codes = e.blockers.map((b: any) => b.code);
    assert.ok(codes.includes('ISSUES_UNRESOLVED'));
    assert.equal(codes.filter((c: string) => c === 'DOCUMENT_NOT_VERIFIED').length, 3, 'cả 3 giấy tờ bắt buộc chưa được chấp nhận');
    return true;
  });
  const untouched = await m.prisma.gymPartnerDocument.findMany({ where: { partnerId: a.partnerId } });
  assert.ok(untouched.every((d) => d.status !== 'VERIFIED'), 'approve thất bại không được tự VERIFIED giấy tờ nào');

  // Admin chấp nhận từng giấy tờ, đóng issue → mới approve được.
  for (const docType of ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF'] as const) {
    await m.review.acceptDocument(a.partnerId, docType, admin);
  }
  await m.review.resolveIssue(a.partnerId, issue.id, admin);

  const result = await m.review.approve(a.partnerId, admin);
  partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(partner.status, 'ACTIVE');
  assert.equal(partner.verificationStatus, 'VERIFIED');
  const gym = await m.prisma.gym.findUniqueOrThrow({ where: { id: result.gymId } });
  assert.equal(gym.status, 'APPROVED');
  assert.equal(gym.approvedName, 'ABC Fitness Nguyễn Huệ');
  const brand = await m.prisma.gymBrand.findUniqueOrThrow({ where: { ownerId: a.userId } });
  assert.equal(brand.approvedName, 'ABC Fitness', 'chi nhánh đầu được duyệt kéo theo tên thương hiệu như setStatus');

  // Duyệt xong ảnh VẪN riêng tư: không có bản sao công khai nào, khoá không đổi.
  const photo = await m.prisma.gymPhoto.findFirstOrThrow({ where: { gymId: gym.id } });
  assert.equal(photo.visibility, 'PRIVATE');
  assert.ok(photo.s3Key!.startsWith('partner-applications/'), `ảnh phải ở nguyên chỗ cũ: ${photo.s3Key}`);
  const docs = await m.prisma.gymPartnerDocument.findMany({ where: { partnerId: a.partnerId } });
  assert.ok(docs.every((d) => d.fileKey!.startsWith('partner-applications/')), 'giấy tờ vẫn ở bucket riêng tư');

  // Chuỗi audit đủ và đúng thứ tự các sự kiện quan trọng.
  const actions = await auditActions(a.partnerId);
  for (const expected of [
    'DOCUMENT_UPLOADED',
    'APPLICATION_SUBMITTED',
    'DOCUMENT_UPDATE_REQUESTED',
    'CHANGES_REQUESTED',
    'ISSUE_MARKED_UPDATED',
    'DOCUMENT_REPLACED',
    'APPLICATION_RESUBMITTED',
    'DOCUMENT_ACCEPTED',
    'ISSUE_RESOLVED',
    'APPLICATION_APPROVED',
  ]) {
    assert.ok(actions.includes(expected as any), `thiếu audit ${expected}`);
  }
  assert.ok(actions.indexOf('APPLICATION_APPROVED') > actions.indexOf('ISSUE_RESOLVED'));

  // Sau khi duyệt, hồ sơ đã thành ACTIVE — chuyển sang luồng chi nhánh thường; hồ sơ không sửa được nữa.
  const finalCtx = await ctxOf(a.userId);
  assert.equal(m.app.getStatus(finalCtx).accessState, 'APPROVED_PAYOUT_PENDING');
  await assert.rejects(m.app.updateLegal(finalCtx, { legalName: 'x' }), (e: any) => e.code === 'APPLICATION_LOCKED');
});

// ── approve: atomic + không thắng hai lần ─────────────────────────────────────────────────────

async function readyForApproval() {
  const a = await newApplicant();
  const admin = randomUUID();
  const partnerId = await submitted(a);
  for (const docType of ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF'] as const) {
    await m.review.acceptDocument(partnerId, docType, admin);
  }
  return { a, admin, partnerId };
}

s3Test('approve KHÔNG nửa vời: ép lỗi ở bước ghi audit (sau khi đã đổi partner + chi nhánh) → rollback toàn bộ', async () => {
  const { a, admin, partnerId } = await readyForApproval();
  const original = m.audit.recordInTx;
  (m.audit as any).recordInTx = async (_tx: unknown, params: { action: string }) => {
    if (params.action === 'APPLICATION_APPROVED') throw new Error('audit write failed');
    return original.call(m.audit, _tx as any, params as any);
  };
  try {
    await assert.rejects(m.review.approve(partnerId, admin), /audit write failed/);
  } finally {
    (m.audit as any).recordInTx = original;
  }

  const partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: partnerId } });
  assert.equal(partner.status, 'PROSPECT', 'partner không được ACTIVE khi audit không ghi được');
  assert.equal(partner.verificationStatus, 'IN_REVIEW');
  const gym = await m.prisma.gym.findFirstOrThrow({ where: { ownerId: a.userId } });
  assert.equal(gym.status, 'DRAFT', 'chi nhánh vẫn DRAFT');
  assert.equal(gym.approvedName, null);
  const brand = await m.prisma.gymBrand.findUniqueOrThrow({ where: { ownerId: a.userId } });
  assert.equal(brand.approvedName, null);
  assert.ok(!(await auditActions(partnerId)).includes('APPLICATION_APPROVED'));
});

s3Test('hai admin approve cùng lúc → đúng một người thắng, người kia nhận 409', async () => {
  const { partnerId } = await readyForApproval();
  const results = await Promise.allSettled([
    m.review.approve(partnerId, randomUUID()),
    m.review.approve(partnerId, randomUUID()),
    m.review.approve(partnerId, randomUUID()),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 2);
  assert.ok(failed.every((f) => f.reason.status === 409), 'người thua nhận 409, không phải 500');
  const approvedRows = (await auditActions(partnerId)).filter((x) => x === 'APPLICATION_APPROVED').length;
  assert.equal(approvedRows, 1, 'chỉ một dòng audit APPROVED');
});

integrationTest('applyGymApprovalTx cho kết quả GIỐNG HỆT gymService.setStatus(APPROVED) — hai bản không được lệch nhau', async () => {
  async function seed(tag: string) {
    const ownerId = randomUUID();
    created.ownerIds.push(ownerId);
    const brand = await m.prisma.gymBrand.create({ data: { ownerId, name: `Brand ${tag}`, pendingName: `Brand ${tag}` } });
    const gym = await m.prisma.gym.create({
      data: { ownerId, brandId: brand.id, name: `Gym ${tag}`, address: '1 Phố', status: 'PENDING_REVIEW', pendingNameNote: 'ghi chú' },
    });
    return { brand, gym };
  }
  const a = await seed('A');
  const b = await seed('B');

  await m.gymService.setStatus(a.gym.id, 'APPROVED');
  await m.prisma.$transaction((tx) => m.applyGymApprovalTx(tx, b.gym.id));

  const pick = async (gymId: string, brandId: string) => {
    const g = await m.prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
    const br = await m.prisma.gymBrand.findUniqueOrThrow({ where: { id: brandId } });
    return {
      status: g.status,
      approvedName: g.approvedName?.replace(/[AB]$/, '#'),
      approvedAddress: g.approvedAddress,
      pendingName: g.pendingName,
      pendingAddress: g.pendingAddress,
      pendingNameNote: g.pendingNameNote,
      pendingAddressNote: g.pendingAddressNote,
      changesRequestedAt: g.changesRequestedAt,
      brandApproved: br.approvedName?.replace(/[AB]$/, '#'),
      brandPending: br.pendingName,
    };
  };
  assert.deepEqual(await pick(b.gym.id, b.brand.id), await pick(a.gym.id, a.brand.id));
});

// ── từ chối / mở lại ─────────────────────────────────────────────────────────────────────────

integrationTest('REJECTED là cuối với ứng viên: khoá sửa và nộp; chỉ admin reopen mới sửa/nộp lại được', async () => {
  const a = await newApplicant();
  const admin = randomUUID();
  await m.review.reject(a.partnerId, admin, 'Không đủ điều kiện', 'Thiếu giấy phép');

  let ctx = await ctxOf(a.userId);
  assert.equal(m.app.getStatus(ctx).accessState, 'REJECTED');
  assert.equal(m.app.getStatus(ctx).editable, false);
  await assert.rejects(m.app.updateLegal(ctx, { legalName: 'x' }), (e: any) => e.code === 'APPLICATION_LOCKED');
  await assert.rejects(m.app.submit(ctx, a.userId, { acceptTerms: true }), (e: any) => e.status === 409);

  const view = await m.app.getApplication(ctx);
  assert.equal(view.partner.rejectionReason, 'Không đủ điều kiện');
  assert.equal(view.partner.adminNote, 'Thiếu giấy phép');

  await m.review.reopen(a.partnerId, admin);
  ctx = await ctxOf(a.userId);
  assert.equal(m.app.getStatus(ctx).accessState, 'ONBOARDING');
  assert.equal(m.app.getStatus(ctx).editable, true);
  const actions = await auditActions(a.partnerId);
  assert.ok(actions.includes('APPLICATION_REJECTED') && actions.includes('APPLICATION_REOPENED'));
});

integrationTest('thao tác admin cũ (sửa hồ sơ, nhập giấy tờ bằng URL, đặt verificationStatus…) bị chặn với hồ sơ tự đăng ký', async () => {
  const a = await newApplicant();
  const legacy = await m.prisma.gymPartner.create({ data: { legalName: 'Hồ sơ cũ do admin nhập', status: 'PROSPECT' } });
  created.partnerIds.push(legacy.id);

  const run = async (partnerId: string) => {
    let statusCode = 0;
    let nextCalled = false;
    await m.block(
      { params: { id: partnerId } } as any,
      { status(c: number) { statusCode = c; return this; }, json() { return this; } } as any,
      () => { nextCalled = true; },
    );
    return { statusCode, nextCalled };
  };
  assert.deepEqual(await run(a.partnerId), { statusCode: 409, nextCalled: false });
  assert.deepEqual(await run(legacy.id), { statusCode: 0, nextCalled: true }, 'hồ sơ cũ (ADMIN_CREATED) không bị ảnh hưởng');
});

// ── timeline lấy từ sự kiện đã lưu ───────────────────────────────────────────────────────────

s3Test('timeline của ứng viên đọc từ PartnerAuditLog, chỉ có trường an toàn, không lộ ghi chú nội bộ của admin', async () => {
  const a = await newApplicant();
  const admin = randomUUID();
  await submitted(a);
  await m.review.requestChanges(a.partnerId, admin, {
    issues: [{ category: 'PHOTOS', message: 'GHI CHÚ NỘI BỘ: nghi ảnh lấy từ mạng' }],
    documents: [],
  });
  const timeline = await m.app.getTimeline(await ctxOf(a.userId), a.userId);
  const actions = timeline.events.map((e) => e.action);
  assert.ok(actions.includes('APPLICATION_SUBMITTED') && actions.includes('CHANGES_REQUESTED'));
  assert.equal(JSON.stringify(timeline).includes('nghi ảnh lấy từ mạng'), false);
  assert.ok(timeline.events.find((e) => e.action === 'APPLICATION_SUBMITTED')!.byYou);
  assert.equal(timeline.events.find((e) => e.action === 'CHANGES_REQUESTED')!.byYou, false);
});

// ── logo thương hiệu (tuỳ chọn) ──────────────────────────────────────────────────────────────

s3Test('logo thương hiệu: tuỳ chọn, cần có thương hiệu trước, tải lên thì ghi vào GymBrand.logoKey', async () => {
  const a = await newApplicant();

  // Chưa đặt tên thương hiệu → từ chối kèm mã rõ ràng.
  await assert.rejects(
    async () => m.upload.presign(await ctxOf(a.userId), a.userId, { kind: 'LOGO', contentType: 'image/png', sizeBytes: PNG.length }),
    (e: any) => e.code === 'BRAND_REQUIRED',
  );

  await m.app.upsertBrand(await ctxOf(a.userId), { name: 'ABC Fitness' });

  // Logo KHÔNG phải mục bắt buộc: không xuất hiện trong danh sách còn thiếu.
  const before = await m.app.getApplication(await ctxOf(a.userId));
  assert.equal(before.brand?.logoUrl ?? null, null);
  assert.ok(!before.missing.some((x: any) => /logo/i.test(x.message)), 'logo không được tính là mục còn thiếu');

  const out: any = await uploadOk(a, { kind: 'LOGO', contentType: 'image/png', body: PNG });
  assert.equal(out.kind, 'LOGO');

  const partner = await m.prisma.gymPartner.findUniqueOrThrow({ where: { id: before.partner.id } });
  const brand = await m.prisma.gymBrand.findUniqueOrThrow({ where: { id: partner.brandId as string } });
  assert.ok(brand.logoKey && brand.logoKey.includes('/brand/'), `khoá logo sai: ${brand.logoKey}`);
  assert.ok((await m.app.getApplication(await ctxOf(a.userId))).brand?.logoUrl, 'phải trả về URL đọc logo');

  // Thay logo → khoá mới.
  await uploadOk(a, { kind: 'LOGO', contentType: 'image/jpeg', body: JPEG });
  const after = await m.prisma.gymBrand.findUniqueOrThrow({ where: { id: brand.id } });
  assert.notEqual(after.logoKey, brand.logoKey, 'thay logo phải đổi khoá');
});

// ── tải lên: cứng hoá ────────────────────────────────────────────────────────────────────────

s3Test('tải lên: tệp HTML đội lốt ảnh bị từ chối ở confirm và BỊ XOÁ khỏi S3', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);
  await m.app.upsertBrand(ctx, { name: 'B' });
  await m.app.upsertBranch(ctx, { name: 'CN' });

  const { presigned, res, intent } = await uploadAs(a, { kind: 'PHOTO', contentType: 'image/png', body: HTML });
  assert.ok([200, 201, 204].includes(res.status), 'S3 nhận tệp (policy chỉ kiểm cỡ + Content-Type khai báo)');
  assert.notEqual(await m.s3.headObject(intent.objectKey), null);

  await assert.rejects(m.upload.confirm(ctx, a.userId, presigned.uploadId), (e: any) => e.status === 422 && e.code === 'UPLOAD_REJECTED');
  assert.equal(await m.s3.headObject(intent.objectKey), null, 'tệp bị từ chối phải bị xoá');
  assert.equal(await m.prisma.gymPhoto.count({ where: { gym: { ownerId: a.userId } } }), 0, 'không tạo bản ghi ảnh');
});

s3Test('tải lên: loại tệp không cho phép / quá cỡ bị chặn từ presign; policy S3 chặn quá cỡ khi upload', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);
  for (const bad of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload']) {
    await assert.rejects(
      m.upload.presign(ctx, a.userId, { kind: 'DOCUMENT', docType: 'BUSINESS_LICENSE', contentType: bad, sizeBytes: 100 }),
      (e: any) => e.status === 415,
      bad,
    );
  }
  await assert.rejects(
    m.upload.presign(ctx, a.userId, { kind: 'DOCUMENT', docType: 'BUSINESS_LICENSE', contentType: 'application/pdf', sizeBytes: 50 * 1024 * 1024 }),
    (e: any) => e.status === 413,
  );
  // Khai 100 byte để qua presign nhưng gửi thật > 10 MB: policy `content-length-range` đã ký phải chặn.
  const { res } = await uploadAs(a, {
    kind: 'DOCUMENT',
    docType: 'BUSINESS_LICENSE',
    contentType: 'application/pdf',
    body: Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024, 4)]),
    declaredSize: 100,
  });
  assert.ok(res.status >= 400, `S3 phải từ chối tệp quá cỡ, nhưng trả ${res.status}`);
});

s3Test('tải lên: Content-Type gửi lên khác với khai báo lúc presign → policy S3 từ chối', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);
  const presigned = await m.upload.presign(ctx, a.userId, {
    kind: 'DOCUMENT',
    docType: 'BUSINESS_LICENSE',
    contentType: 'application/pdf',
    sizeBytes: PDF.length,
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) form.append(k, k === 'Content-Type' ? 'text/html' : (v as string));
  form.append('file', new Blob([PDF], { type: 'text/html' }), 'x.html');
  const res = await fetch(presigned.url, { method: 'POST', body: form });
  assert.ok(res.status >= 400, `phải bị chặn, nhưng trả ${res.status}`);
});

s3Test('tải lên: không gắn được khoá của partner khác — confirm chỉ nhận uploadId của CHÍNH partner đó', async () => {
  const a = await newApplicant();
  const b = await newApplicant();
  const { presigned } = await uploadAs(a, { kind: 'DOCUMENT', docType: 'BUSINESS_LICENSE', contentType: 'application/pdf', body: PDF });

  // B thử xác nhận upload của A.
  await assert.rejects(
    m.upload.confirm(await ctxOf(b.userId), b.userId, presigned.uploadId),
    (e: any) => e.status === 404 && e.code === 'NOT_FOUND',
  );
  // Không tồn tại đường nào để client gửi khoá S3 của người khác: uploadId lạ cũng chỉ là 404.
  await assert.rejects(m.upload.confirm(await ctxOf(b.userId), b.userId, randomUUID()), (e: any) => e.status === 404);

  // Khoá do server sinh, có tiền tố partner.
  const intent = await m.prisma.partnerUploadIntent.findUniqueOrThrow({ where: { id: presigned.uploadId } });
  assert.ok(intent.objectKey.startsWith(`partner-applications/${a.partnerId}/docs/BUSINESS_LICENSE/`));
});

s3Test('tải lên: confirm hai lần idempotent; chưa tải mà đã confirm → 409; không sửa được khi hồ sơ đã khoá', async () => {
  const a = await newApplicant();
  const ctx = await ctxOf(a.userId);
  const pre = await m.upload.presign(ctx, a.userId, { kind: 'DOCUMENT', docType: 'PREMISES_PROOF', contentType: 'image/jpeg', sizeBytes: JPEG.length });
  await assert.rejects(m.upload.confirm(ctx, a.userId, pre.uploadId), (e: any) => e.code === 'UPLOAD_NOT_FOUND');

  const done = await uploadOk(a, { kind: 'DOCUMENT', docType: 'PREMISES_PROOF', contentType: 'image/jpeg', body: JPEG });
  assert.equal((done as any).replaced, false);
  const intent = await m.prisma.partnerUploadIntent.findFirstOrThrow({ where: { partnerId: a.partnerId, confirmedAt: { not: null } } });
  const twice = await m.upload.confirm(await ctxOf(a.userId), a.userId, intent.id);
  assert.equal((twice as any).alreadyConfirmed, true);

  await m.review.reject(a.partnerId, randomUUID(), 'Từ chối');
  await assert.rejects(
    m.upload.presign(await ctxOf(a.userId), a.userId, { kind: 'DOCUMENT', docType: 'PREMISES_PROOF', contentType: 'image/jpeg', sizeBytes: 100 }),
    (e: any) => e.code === 'APPLICATION_LOCKED',
  );
});

s3Test('admin xem giấy tờ: presigned GET ngắn hạn, giấy tờ PDF ép tải xuống, MỖI lần xem ghi audit', async () => {
  const a = await newApplicant();
  const admin = randomUUID();
  await submitted(a);

  const before = (await auditActions(a.partnerId)).filter((x) => x === 'DOCUMENT_VIEWED').length;
  const file = await m.review.getDocumentFile(a.partnerId, 'BUSINESS_LICENSE', admin);
  assert.equal(file.expiresInSec, 120);
  const res = await fetch(file.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const after = (await auditActions(a.partnerId)).filter((x) => x === 'DOCUMENT_VIEWED').length;
  assert.equal(after, before + 1);

  // Quá hạn thì hết dùng được: URL đã ký cho 120 s; đổi chữ ký → 403.
  const tampered = file.url.replace(/X-Amz-Signature=[0-9a-f]+/, 'X-Amz-Signature=deadbeef');
  assert.equal((await fetch(tampered)).status, 403);
});

s3Test('khoá đối tượng nằm ở bucket RIÊNG TƯ: URL không chữ ký không đọc được; bucket công khai chỉ có ảnh sau duyệt', async () => {
  const a = await newApplicant();
  await submitted(a);
  const doc = await m.prisma.gymPartnerDocument.findUniqueOrThrow({
    where: { partnerId_docType: { partnerId: a.partnerId, docType: 'BUSINESS_LICENSE' } },
  });
  const anonymous = await fetch(`http://localhost:9000/gymini-partner-private/${doc.fileKey}`);
  assert.ok([403, 404].includes(anonymous.status), `bucket riêng tư không được đọc ẩn danh, nhưng trả ${anonymous.status}`);

  const photo = await m.prisma.gymPhoto.findFirstOrThrow({ where: { gym: { ownerId: a.userId } } });
  assert.equal(photo.visibility, 'PRIVATE', 'trước khi duyệt ảnh vẫn riêng tư');
  const publicTry = await fetch(`http://localhost:9000/gymini-partner-photos/${photo.s3Key}`);
  assert.notEqual(publicTry.status, 200, 'ảnh chưa duyệt không được có ở vùng công khai');
});

// ── email thông báo ──────────────────────────────────────────────────────────────────────────

s3Test('email: gửi đúng người, đúng nội dung SAU commit; ở chế độ dev-echo thì KHÔNG gửi thật', async () => {
  const { authClient } = await import('../clients/auth.client');
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const original = authClient.sendEmail;
  (authClient as any).sendEmail = async (mail: { to: string; subject: string; text: string }) => {
    sent.push(mail);
    return true;
  };
  const tick = () => new Promise((r) => setTimeout(r, 80));
  try {
    const a = await newApplicant();
    const admin = randomUUID();
    await submitted(a);
    await tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, a.email);
    assert.match(sent[0].subject, /đã nhận hồ sơ/);

    await m.review.requestChanges(a.partnerId, admin, { issues: [{ category: 'PHOTOS', message: 'Ảnh mặt tiền chưa rõ' }], documents: [] });
    await tick();
    assert.match(sent[1].subject, /cần bạn cập nhật/);
    assert.match(sent[1].text, /1 nội dung/);

    await m.review.reject(a.partnerId, admin, 'Không đủ điều kiện');
    await tick();
    assert.match(sent[2].subject, /chưa được chấp thuận/);
    assert.match(sent[2].text, /Không đủ điều kiện/);

    // dev-echo: nội dung chỉ được log, không có email thật nào ra ngoài.
    process.env.PARTNER_APPLICATION_DEV_ECHO = 'true';
    const before = sent.length;
    await m.review.reopen(a.partnerId, admin);
    await m.review.reject(a.partnerId, admin, 'Lần hai');
    await tick();
    delete process.env.PARTNER_APPLICATION_DEV_ECHO;
    assert.equal(sent.length, before, 'dev-echo không được gửi email thật');
  } finally {
    delete process.env.PARTNER_APPLICATION_DEV_ECHO;
    (authClient as any).sendEmail = original;
  }
});
