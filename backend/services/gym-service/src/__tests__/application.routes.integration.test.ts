/**
 * REAL HTTP/API — hồ sơ đối tác tự đăng ký qua đúng router Express (owner + admin) với auth-service giả
 * và DB test thật. Kiểm phần các test service không thấy được: xác thực/phân quyền theo vai trò, mã lỗi HTTP,
 * kiểm dữ liệu ở lớp route (thông điệp tiếng Việt), và việc cổng vận hành chặn ứng viên ngay trên URL thật.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4024';
process.env.PARTNER_S3_PRIVATE_BUCKET = '';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const OWNER_ID = randomUUID();
const OTHER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const USERS: Record<string, { id: string; role: string; email: string }> = {
  'tok-owner': { id: OWNER_ID, role: 'GYM_OWNER', email: `${OWNER_ID.slice(0, 8)}@routes.test` },
  'tok-other': { id: OTHER_ID, role: 'GYM_OWNER', email: `${OTHER_ID.slice(0, 8)}@routes.test` },
  'tok-admin': { id: ADMIN_ID, role: 'ADMIN', email: 'admin@routes.test' },
  'tok-customer': { id: randomUUID(), role: 'CUSTOMER', email: 'c@routes.test' },
};

let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
const partnerIds: string[] = [];

test.before(async () => {
  if (!process.env.DATABASE_URL) return;
  authServer = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    const user = USERS[token];
    if (req.method === 'POST' && req.url === '/auth/verify' && user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid' }));
  });
  await new Promise<void>((r) => authServer.listen(4024, '127.0.0.1', r));

  prisma = (await import('../repositories/prisma')).prisma;
  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const adminRoutes = (await import('../routes/admin.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/owner', ownerRoutes);
  app.use('/admin', adminRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  await prisma.gym.deleteMany({ where: { ownerId: { in: [OWNER_ID, OTHER_ID] } } });
  await prisma.gymBrand.deleteMany({ where: { ownerId: { in: [OWNER_ID, OTHER_ID] } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* không phải JSON */
  }
  return { status: res.status, body: json };
}

integrationTest('luồng HTTP ứng viên: bootstrap → điền từng bước → cổng vận hành vẫn chặn → nộp thiếu bị 400 kèm danh sách', async () => {
  // Chưa bootstrap: chỉ status/bootstrap dùng được.
  let r = await call('tok-owner', 'GET', '/owner/application/status');
  assert.equal(r.body.data.accessState, 'SETUP_INCOMPLETE');
  r = await call('tok-owner', 'GET', '/owner/application');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'NO_PARTNER_ACCOUNT');

  r = await call('tok-owner', 'POST', '/owner/application/bootstrap');
  assert.equal(r.status, 201);
  partnerIds.push(r.body.data.partnerId);
  assert.equal((await call('tok-owner', 'POST', '/owner/application/bootstrap')).status, 200, 'gọi lại idempotent');
  assert.equal((await call('tok-owner', 'GET', '/owner/application/status')).body.data.accessState, 'ONBOARDING');

  // Cổng vận hành chặn ngay trên URL thật, kể cả khi đã bootstrap.
  r = await call('tok-owner', 'GET', '/owner/gyms');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PARTNER_APPLICATION_PENDING');
  r = await call('tok-owner', 'POST', '/owner/brands', { name: 'Đi tắt' });
  assert.equal(r.status, 403, 'không tạo được brand bằng route vận hành cũ');

  // Kiểm dữ liệu ở lớp route.
  r = await call('tok-owner', 'PUT', '/owner/application/representative', { name: 'A', phone: 'abc', role: 'BOSS' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  r = await call('tok-owner', 'PUT', '/owner/application/representative', { name: 'Nguyễn Văn A', phone: '0901234567', role: 'GYM_OWNER' });
  assert.equal(r.status, 200);

  // Chi nhánh cần brand trước.
  r = await call('tok-owner', 'PUT', '/owner/application/branch', { name: 'CN1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'BRAND_REQUIRED');
  r = await call('tok-owner', 'PUT', '/owner/application/brand', { name: 'ABC Fitness' });
  assert.equal(r.status, 200);
  r = await call('tok-owner', 'PUT', '/owner/application/branch', { name: 'ABC Nguyễn Huệ', phone: '0281234567', email: 'khong-phai-email' });
  assert.equal(r.status, 400, 'email sai định dạng bị chặn bằng chính gymCreateSchema');
  r = await call('tok-owner', 'PUT', '/owner/application/branch', { name: 'ABC Nguyễn Huệ', phone: '0281234567', address: '1 Nguyễn Huệ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'DRAFT');

  // Tải lên: loại tệp nguy hiểm bị chặn; S3 chưa cấu hình → 503 (không lộ lỗi thô).
  r = await call('tok-owner', 'POST', '/owner/application/uploads/presign', { kind: 'PHOTO', contentType: 'text/html', sizeBytes: 10 });
  assert.equal(r.status, 503, 'S3 chưa cấu hình trong test này');
  r = await call('tok-owner', 'POST', '/owner/application/uploads/presign', { kind: 'DOCUMENT', contentType: 'application/pdf', sizeBytes: 10 });
  assert.equal(r.status, 400, 'thiếu docType');

  // Nộp thiếu: 400 kèm danh sách từng mục còn thiếu.
  r = await call('tok-owner', 'POST', '/owner/application/submit', { acceptTerms: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'APPLICATION_INCOMPLETE');
  const sections = r.body.error.issues.map((i: any) => i.field);
  for (const s of ['SCALE', 'LOCATION', 'PHOTOS', 'LEGAL']) assert.ok(sections.includes(s), s);

  // Xem hồ sơ: dữ liệu của CHÍNH mình, không lộ ghi chú admin.
  r = await call('tok-owner', 'GET', '/owner/application');
  assert.equal(r.body.data.brand.name, 'ABC Fitness');
  assert.equal(r.body.data.branch.name, 'ABC Nguyễn Huệ');
  assert.ok(r.body.data.missing.length > 0);
});

integrationTest('ứng viên khác không đọc/sửa được hồ sơ của người này (danh tính suy từ token, không từ body/URL)', async () => {
  await call('tok-other', 'POST', '/owner/application/bootstrap').then((r) => partnerIds.push(r.body.data.partnerId));
  const mine = await call('tok-owner', 'GET', '/owner/application');
  const theirs = await call('tok-other', 'GET', '/owner/application');
  assert.notEqual(mine.body.data.partner.id, theirs.body.data.partner.id);
  assert.equal(theirs.body.data.brand, null, 'không thấy brand của người kia');
  // Cố nhét partnerId/ownerId vào body — bị bỏ qua.
  const r = await call('tok-other', 'PUT', '/owner/application/brand', { name: 'Của tôi', partnerId: mine.body.data.partner.id, ownerId: OWNER_ID });
  assert.equal(r.status, 200);
  const after = await call('tok-owner', 'GET', '/owner/application');
  assert.equal(after.body.data.brand.name, 'ABC Fitness', 'brand của người này không bị đụng');
});

integrationTest('admin: chỉ ADMIN vào được; APPROVE bị chặn kèm blockers; thao tác admin cũ bị chặn với hồ sơ tự đăng ký', async () => {
  const partnerId = (await call('tok-owner', 'GET', '/owner/application')).body.data.partner.id as string;

  for (const [token, expected] of [[null, 401], ['tok-customer', 403], ['tok-owner', 403]] as const) {
    const r = await call(token, 'GET', '/admin/partners/applications');
    assert.equal(r.status, expected, `${token}`);
  }

  const list = await call('tok-admin', 'GET', '/admin/partners/applications');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.items.some((i: any) => i.id === partnerId));
  assert.ok('NOT_VERIFIED' in list.body.data.counts);

  const detail = await call('tok-admin', 'GET', `/admin/partners/${partnerId}/application`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.partner.contactEmail, USERS['tok-owner'].email);
  assert.equal(detail.body.data.approve.canApprove, false);
  assert.ok(detail.body.data.approve.blockers.length > 0);
  // 3 bắt buộc + 2 bổ sung (mã số thuế, PCCC) — đúng danh sách ứng viên thấy; SITE_PHOTOS trùng bước Ảnh nên không có.
  assert.deepEqual(detail.body.data.documents.map((d: any) => d.docType), ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF', 'TAX_CODE_CERTIFICATE', 'FIRE_SAFETY_CERTIFICATE']);

  const approve = await call('tok-admin', 'POST', `/admin/partners/${partnerId}/application/approve`);
  assert.equal(approve.status, 409);
  assert.equal(approve.body.error.code, 'APPROVE_BLOCKED');
  assert.ok(Array.isArray(approve.body.error.blockers) && approve.body.error.blockers.length > 0);

  const empty = await call('tok-admin', 'POST', `/admin/partners/${partnerId}/application/request-changes`, { issues: [], documents: [] });
  assert.equal(empty.status, 400, 'phải nêu ít nhất một mục hoặc một giấy tờ');

  // Thao tác admin cũ bị chặn với hồ sơ tự đăng ký.
  for (const [method, path, body] of [
    ['PATCH', `/admin/partners/${partnerId}`, { legalName: 'Sửa lén' }],
    ['POST', `/admin/partners/${partnerId}/reject`, { reason: 'x' }],
    ['PATCH', `/admin/partners/${partnerId}/verification-status`, { status: 'VERIFIED' }],
  ] as const) {
    const r = await call('tok-admin', method, path, body);
    assert.equal(r.status, 409, `${method} ${path}`);
    assert.equal(r.body.error.code, 'SELF_SERVICE_APPLICATION');
  }
  // Đường admin tạo/cấp tài khoản chủ gym đã ngừng hẳn (W3.9): 410 với mọi hồ sơ.
  for (const [method, path, body] of [
    ['POST', '/admin/partners', { legalName: 'X', contactEmail: 'x@y.zz' }],
    ['POST', `/admin/partners/${partnerId}/provision`, {}],
  ] as const) {
    const r = await call('tok-admin', method, path, body);
    assert.equal(r.status, 410, `${method} ${path}`);
    assert.equal(r.body.error.code, 'ENDPOINT_RETIRED');
  }
  const stillProspect = await prisma.gymPartner.findUniqueOrThrow({ where: { id: partnerId } });
  assert.equal(stillProspect.verificationStatus, 'NOT_VERIFIED', 'không có gì bị đổi bởi các lệnh bị chặn');
});
