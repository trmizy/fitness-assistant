/**
 * REAL HTTP/API + DB test thật — D15: vai trò nội bộ LỄ TÂN (RECEPTIONIST) và KẾ TOÁN (ACCOUNTANT) trên danh mục
 * quyền, cạnh OWNER và MANAGER. Mặc định TỪ CHỐI.
 *
 * Dựng app Express THẬT với đúng router /owner (+ public + pt), auth-service giả (token → user) và payment-service
 * giả (ví / lịch sử rút tiền), còn lại là dữ liệu thật trong DB test: đối tác, tài khoản các vai trò, thương
 * hiệu, chi nhánh, gói, hội viên, lượt check-in.
 *
 * Đối tượng kiểm:
 *   • ma trận route × vai trò (được / bị chặn, đúng mã lỗi);
 *   • phạm vi chi nhánh (chi nhánh khác trong CÙNG đối tác) và ranh giới đối tác (đối tác KHÁC);
 *   • hình dạng dữ liệu theo vai trò (lễ tân không thấy giá/mã giao dịch; kế toán không thấy clientId, số tài
 *     khoản bị che);
 *   • quản lý nhân sự: chỉ OWNER mời / thu hồi / chuyển quyền; ràng buộc phạm vi theo vai trò;
 *   • cây route: KHÔNG route nào dưới cổng vận hành thiếu cổng quyền (default-deny chứng minh bằng cấu trúc).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

const SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;
process.env.CHECKIN_TOKEN_SECRET = process.env.CHECKIN_TOKEN_SECRET || 'test_checkin_secret_32_chars_minimum_xx';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const id = {
  ownerA: randomUUID(), managerA: randomUUID(), recepA1: randomUUID(), recepA2: randomUUID(),
  acctAll: randomUUID(), acctA1: randomUUID(),
  ownerB: randomUUID(), recepB: randomUUID(), acctB: randomUUID(),
  clientX: randomUUID(), clientY: randomUUID(), pt: randomUUID(),
};
const USERS: Record<string, { id: string; role: string; email: string }> = Object.fromEntries(
  Object.entries({
    'tok-owner-a': id.ownerA, 'tok-manager-a': id.managerA, 'tok-recep-a1': id.recepA1, 'tok-recep-a2': id.recepA2,
    'tok-acct-all': id.acctAll, 'tok-acct-a1': id.acctA1,
    'tok-owner-b': id.ownerB, 'tok-recep-b': id.recepB, 'tok-acct-b': id.acctB,
  }).map(([tok, uid]) => [tok, { id: uid, role: 'GYM_OWNER', email: `${tok}@staff.test` }]),
);
USERS['tok-customer'] = { id: id.clientX, role: 'CUSTOMER', email: 'c@staff.test' };

const gym = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
const brand = { a: randomUUID(), b: randomUUID() };
const plan = { a: randomUUID() };
const mem = { a1: randomUUID(), a2: randomUUID() };
const partnerIds: string[] = [];

let authServer: http.Server;
let payServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let ownerRouter: any;
const sentMails: Array<{ to: string; subject: string }> = [];

const WITHDRAWAL = {
  id: randomUUID(), amount: '500000.00', status: 'PAID', bankReference: 'FT-REF-1',
  payoutInfo: 'Vietcombank 0123456789012 NGUYEN VAN A',
};

test.before(async () => {
  if (!process.env.DATABASE_URL) return;

  authServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.method === 'POST' && req.url === '/auth/verify') {
        const user = USERS[String(req.headers.authorization || '').replace('Bearer ', '')];
        if (user) return res.end(JSON.stringify({ user }));
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'invalid' }));
      }
      if (req.url === '/auth/internal/send-email') {
        const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        sentMails.push({ to: b.to, subject: b.subject });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url?.startsWith('/auth/internal/users/')) {
        return res.end(JSON.stringify({ user: { id: 'x', email: 'x@y.z', firstName: 'X', lastName: 'Y', role: 'GYM_OWNER', isActive: true } }));
      }
      if (req.url === '/auth/internal/partner-auth/create-invited-account') {
        const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        return res.end(JSON.stringify({ user: { id: randomUUID(), email: b.email, firstName: b.firstName, lastName: null, role: 'GYM_OWNER' } }));
      }
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;

  payServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url?.startsWith('/internal/wallets/GYM/')) {
      return res.end(JSON.stringify({ success: true, data: { id: 'w1', availableBalance: '1000000.00', pendingBalance: '250000.00', lockedBalance: '0.00' } }));
    }
    if (req.url?.startsWith('/internal/withdrawals/gym/')) {
      return res.end(JSON.stringify({ success: true, data: [WITHDRAWAL] }));
    }
    return res.end(JSON.stringify({ success: true, data: {} }));
  });
  await new Promise<void>((r) => payServer.listen(0, '127.0.0.1', r));
  process.env.PAYMENT_SERVICE_URL = `http://127.0.0.1:${(payServer.address() as { port: number }).port}`;

  prisma = (await import('../repositories/prisma')).prisma;

  const mkPartner = async (name: string) => {
    const p = await prisma.gymPartner.create({
      data: { legalName: `Staff Roles ${name} ${randomUUID().slice(0, 6)}`, contactEmail: `${randomUUID().slice(0, 8)}@staff.test`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
    });
    partnerIds.push(p.id);
    return p.id;
  };
  const mkAcc = (partnerId: string, userId: string, role: any, scopedGymIds: string[]) =>
    prisma.gymPartnerAccount.create({
      data: { partnerId, userId, role, scopedGymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
    });

  // Gym phải có trước khi cấp phạm vi (id cố định nên tạo trước tài khoản được).
  await prisma.gymBrand.createMany({
    data: [
      { id: brand.a, ownerId: id.ownerA, name: 'Staff Brand A' },
      { id: brand.b, ownerId: id.ownerB, name: 'Staff Brand B' },
    ],
  });
  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: id.ownerA, brandId: brand.a, name: 'Staff A1', address: '1 A St', status: 'APPROVED' },
      { id: gym.a2, ownerId: id.ownerA, brandId: brand.a, name: 'Staff A2', address: '2 A St', status: 'APPROVED' },
      { id: gym.b1, ownerId: id.ownerB, brandId: brand.b, name: 'Staff B1', address: '1 B St', status: 'APPROVED' },
    ],
  });

  const pA = await mkPartner('A');
  await mkAcc(pA, id.ownerA, 'OWNER', []);
  await mkAcc(pA, id.managerA, 'MANAGER', [gym.a1]);
  await mkAcc(pA, id.recepA1, 'RECEPTIONIST', [gym.a1]);
  await mkAcc(pA, id.recepA2, 'RECEPTIONIST', [gym.a2]);
  await mkAcc(pA, id.acctAll, 'ACCOUNTANT', []);
  await mkAcc(pA, id.acctA1, 'ACCOUNTANT', [gym.a1]);
  const pB = await mkPartner('B');
  await mkAcc(pB, id.ownerB, 'OWNER', []);
  await mkAcc(pB, id.recepB, 'RECEPTIONIST', [gym.b1]);
  await mkAcc(pB, id.acctB, 'ACCOUNTANT', []);

  await prisma.gymMembershipPlan.create({ data: { id: plan.a, brandId: brand.a, name: 'Gói tháng', price: 700000, durationDays: 30, status: 'ACTIVE' } });
  const now = Date.now();
  await prisma.gymMembershipContract.createMany({
    data: [
      { id: mem.a1, gymId: gym.a1, planId: plan.a, clientId: id.clientX, status: 'ACTIVE', paymentTxnId: 'TXN-A1', startDate: new Date(now - 864e5), endDate: new Date(now + 20 * 864e5), priceAtPurchase: 700000, durationDaysSnapshot: 30, usedVisits: 3, payoutReleasedAt: new Date() },
      { id: mem.a2, gymId: gym.a2, planId: plan.a, clientId: id.clientY, status: 'ACTIVE', paymentTxnId: 'TXN-A2', startDate: new Date(now - 864e5), endDate: new Date(now + 20 * 864e5), priceAtPurchase: 700000, durationDaysSnapshot: 30 },
    ],
  });
  await prisma.gymCheckIn.create({ data: { membershipId: mem.a1, gymId: gym.a1, clientId: id.clientX, checkedInBy: id.clientX } });
  await prisma.gymPtCollaboration.create({
    data: { gymId: gym.a1, ptUserId: id.pt, proposedPtRate: 0.6, proposedGymRate: 0.3, platformRate: 0.1, status: 'ACCEPTED', proposedBy: 'GYM', expiresAt: new Date(now + 7 * 864e5), acceptedAt: new Date() },
  });

  const publicRoutes = (await import('../routes/public.routes')).default;
  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const ptRoutes = (await import('../routes/pt.routes')).default;
  ownerRouter = ownerRoutes;
  const app = express();
  app.use(express.json());
  app.use('/', publicRoutes);
  app.use('/owner', ownerRoutes);
  app.use('/', ptRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  const gymIds = Object.values(gym);
  await prisma.gymCheckIn.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: Object.values(brand) } } });
  await prisma.gymPtCollaboration.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: Object.values(brand) } } });
  await prisma.partnerInvitation.deleteMany({ where: { partnerId: { in: partnerIds } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, payServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
});

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* không phải JSON */ }
  return { status: res.status, body: json };
}

const O = 'tok-owner-a', M = 'tok-manager-a', R1 = 'tok-recep-a1', R2 = 'tok-recep-a2', AA = 'tok-acct-all', A1 = 'tok-acct-a1';
const OB = 'tok-owner-b', RB = 'tok-recep-b', AB = 'tok-acct-b';

// ── 1. Ma trận route × vai trò (chi nhánh a1 nằm trong phạm vi của M, R1, A1, AA) ─────────────────────────────
type Row = { name: string; method: string; path: () => string; body?: unknown; allow: string[] };
const matrix: Row[] = [
  { name: 'danh sách thương hiệu', method: 'GET', path: () => '/owner/brands', allow: [O, M, AA, A1] },
  { name: 'thương hiệu + chi nhánh', method: 'GET', path: () => `/owner/brands/${brand.a}`, allow: [O, M, AA, A1] },
  { name: 'danh sách chi nhánh', method: 'GET', path: () => '/owner/gyms', allow: [O, M, R1, R2, AA, A1] },
  { name: 'xem chi nhánh a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}`, allow: [O, M, R1, AA, A1] },
  { name: 'xem chi nhánh a2', method: 'GET', path: () => `/owner/gyms/${gym.a2}`, allow: [O, R2, AA] },
  { name: 'ví a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/wallet`, allow: [O, AA, A1] },
  { name: 'ví a2', method: 'GET', path: () => `/owner/gyms/${gym.a2}/wallet`, allow: [O, AA] },
  { name: 'lịch sử rút tiền a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/withdrawals`, allow: [O, AA, A1] },
  { name: 'gói của thương hiệu', method: 'GET', path: () => `/owner/brands/${brand.a}/plans`, allow: [O, M, AA, A1] },
  { name: 'hội viên a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/memberships`, allow: [O, M, R1, AA, A1] },
  { name: 'hội viên a2', method: 'GET', path: () => `/owner/gyms/${gym.a2}/memberships`, allow: [O, R2, AA] },
  { name: 'QR check-in a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/checkin-qr`, allow: [O, M, R1] },
  { name: 'QR check-in a2', method: 'GET', path: () => `/owner/gyms/${gym.a2}/checkin-qr`, allow: [O, R2] },
  { name: 'lịch sử check-in a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/checkins`, allow: [O, M, R1] },
  { name: 'check-in PT a1', method: 'GET', path: () => `/owner/gyms/${gym.a1}/pt-checkins`, allow: [O, M] },
  { name: 'tạm đóng cửa a1 (không lý do → 400 nếu qua cổng)', method: 'PATCH', path: () => `/owner/gyms/${gym.a1}/operational-status`, body: { operationalStatus: 'OPEN' }, allow: [O, M] },
  { name: 'trạng thái onboarding của chính mình', method: 'GET', path: () => '/owner/onboarding/status', allow: [O, M, R1, R2, AA, A1] },
];
const ALL_A = [O, M, R1, R2, AA, A1];

for (const row of matrix) {
  integrationTest(`ma trận · ${row.name}: ${row.method} — chỉ ${row.allow.length} tài khoản được qua cổng`, async () => {
    for (const tok of ALL_A) {
      const r = await call(tok, row.method, row.path(), row.body);
      const allowed = row.allow.includes(tok);
      if (allowed) {
        assert.notEqual(r.status, 403, `${tok} phải qua cổng ${row.method} ${row.path()} nhưng nhận 403 ${JSON.stringify(r.body)}`);
        assert.notEqual(r.status, 401);
      } else {
        assert.equal(r.status, 403, `${tok} phải bị chặn ${row.method} ${row.path()} nhưng nhận ${r.status}`);
        assert.ok(['PERMISSION_DENIED', 'OWNER_ROLE_REQUIRED', 'GYM_OUT_OF_SCOPE'].includes(r.body?.error?.code), `mã lỗi ${JSON.stringify(r.body)}`);
        assert.equal(r.body?.data, undefined, 'không lộ dữ liệu kèm lỗi');
      }
    }
    const anon = await call(null, row.method, row.path(), row.body);
    assert.equal(anon.status, 401);
  });
}

// ── 2. Chỉ OWNER: mọi route ghi / người / hợp tác PT / đóng cửa vĩnh viễn ─────────────────────────────────────
integrationTest('mọi route GHI / nhân sự / cộng tác PT / listing → 403 cho MANAGER, LỄ TÂN, KẾ TOÁN (kể cả chi nhánh trong phạm vi)', async () => {
  const attempts: Array<[string, string, unknown?]> = [
    ['POST', '/owner/brands', { name: 'x' }],
    ['PATCH', `/owner/brands/${brand.a}`, { name: 'x' }],
    ['POST', '/owner/gyms', {}],
    ['POST', '/owner/gyms/draft'],
    ['PATCH', `/owner/gyms/${gym.a1}`, { name: 'Hack' }],
    ['PUT', `/owner/gyms/${gym.a1}/hours`, { days: [] }],
    ['GET', `/owner/gyms/${gym.a1}/hours`],
    ['GET', `/owner/gyms/${gym.a1}/photos`],
    ['GET', `/owner/gyms/${gym.a1}/branch-documents`],
    ['GET', `/owner/gyms/${gym.a1}/closure-impact`],
    ['POST', `/owner/gyms/${gym.a1}/withdrawals`, { amount: 1, payoutInfo: 'x' }],
    ['POST', `/owner/brands/${brand.a}/plans`, { name: 'x', price: 1, durationDays: 1 }],
    ['PATCH', `/owner/brands/${brand.a}/plans/${plan.a}`, { price: 1 }],
    ['GET', '/owner/collaborations'],
    ['GET', '/me/collaborations'],
    ['POST', `/owner/gyms/${gym.a1}/collaborations`, { ptUserId: id.pt }],
    ['POST', `/owner/gyms/${gym.a1}/trainers`, { ptId: id.pt }],
    ['GET', `/owner/gyms/${gym.a1}/listing`],
    ['GET', '/owner/amenities'],
    ['GET', '/owner/partner-accounts'],
    ['GET', '/owner/partner-invitations'],
    ['POST', '/owner/partner-invitations', { email: 'x@y.z', role: 'RECEPTIONIST', scopedGymIds: [gym.a1] }],
    ['PATCH', '/owner/onboarding/payout', { bankName: 'x', accountNumber: '1', accountHolder: 'x' }],
    ['GET', '/owner/application'],
  ];
  for (const tok of [M, R1, AA, A1]) {
    for (const [method, path, body] of attempts) {
      const r = await call(tok, method, path, body);
      assert.equal(r.status, 403, `${tok} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  const g = await prisma.gym.findUniqueOrThrow({ where: { id: gym.a1 } });
  assert.equal(g.name, 'Staff A1', 'không có thay đổi nào được ghi');
});

integrationTest('đóng cửa: MANAGER tạm đóng/mở lại được, vĩnh viễn thì 403 OWNER_ROLE_REQUIRED; LỄ TÂN/KẾ TOÁN không đóng/mở được', async () => {
  const close = await call(M, 'PATCH', `/owner/gyms/${gym.a1}/operational-status`, { operationalStatus: 'TEMPORARILY_CLOSED', reason: 'bảo trì' });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  for (const tok of [R1, A1, AA]) {
    const r = await call(tok, 'PATCH', `/owner/gyms/${gym.a1}/operational-status`, { operationalStatus: 'OPEN' });
    assert.equal(r.status, 403);
  }
  const perm = await call(M, 'PATCH', `/owner/gyms/${gym.a1}/operational-status`, { operationalStatus: 'PERMANENTLY_CLOSED', reason: 'x' });
  assert.equal(perm.status, 403);
  assert.equal(perm.body.error.code, 'OWNER_ROLE_REQUIRED');
  const reopen = await call(M, 'PATCH', `/owner/gyms/${gym.a1}/operational-status`, { operationalStatus: 'OPEN' });
  assert.equal(reopen.status, 200);
});

// ── 3. Hình dạng dữ liệu theo vai trò ────────────────────────────────────────────────────────────────────────
integrationTest('LỄ TÂN thấy hạn/lượt của hội viên nhưng KHÔNG thấy giá, mã giao dịch, chia tiền', async () => {
  const r = await call(R1, 'GET', `/owner/gyms/${gym.a1}/memberships`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  const row = r.body.data[0];
  assert.equal(row.status, 'ACTIVE');
  assert.ok(row.endDate && row.usedVisits === 3);
  for (const k of ['priceAtPurchase', 'paymentTxnId', 'payoutReleasedAt', 'multiGymWarned', 'refundClawbackDone', 'durationDaysSnapshot']) {
    assert.equal(k in row, false, `lễ tân không được thấy ${k}`);
  }
  const text = JSON.stringify(r.body);
  assert.equal(text.includes('700000'), false);
  assert.equal(text.includes('TXN-A1'), false);
});

integrationTest('KẾ TOÁN thấy doanh số (giá, mã giao dịch) nhưng KHÔNG thấy clientId / lượt tập; CHỦ thấy đủ', async () => {
  const r = await call(AA, 'GET', `/owner/gyms/${gym.a1}/memberships`);
  assert.equal(r.status, 200);
  const row = r.body.data[0];
  assert.equal(Number(row.priceAtPurchase), 700000);
  assert.equal(row.paymentTxnId, 'TXN-A1');
  for (const k of ['clientId', 'usedVisits', 'totalVisits', 'multiGymWarned']) assert.equal(k in row, false, `kế toán không được thấy ${k}`);
  assert.equal(JSON.stringify(r.body).includes(id.clientX), false);
  const owner = await call(O, 'GET', `/owner/gyms/${gym.a1}/memberships`);
  assert.equal(owner.body.data[0].clientId, id.clientX);
});

integrationTest('KẾ TOÁN: ví đọc được; lịch sử rút tiền CHE số tài khoản; chủ thấy nguyên văn', async () => {
  const w = await call(AA, 'GET', `/owner/gyms/${gym.a1}/wallet`);
  assert.equal(w.status, 200);
  assert.equal(Number(w.body.data.availableBalance), 1000000);
  const acct = await call(AA, 'GET', `/owner/gyms/${gym.a1}/withdrawals`);
  assert.equal(acct.status, 200);
  assert.equal(acct.body.data[0].bankReference, 'FT-REF-1');
  assert.equal(acct.body.data[0].payoutInfo.includes('0123456789012'), false);
  assert.ok(acct.body.data[0].payoutInfo.includes('9012'), 'còn 4 số cuối để đối soát');
  const owner = await call(O, 'GET', `/owner/gyms/${gym.a1}/withdrawals`);
  assert.ok(owner.body.data[0].payoutInfo.includes('0123456789012'));
});

integrationTest('LỄ TÂN / KẾ TOÁN xem chi nhánh bản rút gọn (không ownerId, không userId nội bộ); quản lý vẫn nguyên trạng', async () => {
  for (const tok of [R1, AA]) {
    const r = await call(tok, 'GET', `/owner/gyms/${gym.a1}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'Staff A1');
    for (const k of ['ownerId', 'changesRequestedBy', 'closedBy', 'createdFlowVersion', 'legacyClientAt']) assert.equal(k in r.body.data, false, `${tok} thấy ${k}`);
  }
  const m = await call(M, 'GET', `/owner/gyms/${gym.a1}`);
  assert.equal(m.body.data.ownerId, id.ownerA);
});

integrationTest('danh sách chi nhánh và thương hiệu được LỌC theo phạm vi (kể cả MANAGER — trước đây thấy cả chuỗi qua /brands/:id)', async () => {
  const names = async (tok: string) => (await call(tok, 'GET', '/owner/gyms')).body.data.map((g: any) => g.id).sort();
  assert.deepEqual(await names(O), [gym.a1, gym.a2].sort());
  assert.deepEqual(await names(M), [gym.a1]);
  assert.deepEqual(await names(R1), [gym.a1]);
  assert.deepEqual(await names(R2), [gym.a2]);
  assert.deepEqual(await names(A1), [gym.a1]);
  assert.deepEqual(await names(AA), [gym.a1, gym.a2].sort());
  const branches = async (tok: string) => (await call(tok, 'GET', `/owner/brands/${brand.a}`)).body.data.branches.map((g: any) => g.id).sort();
  assert.deepEqual(await branches(O), [gym.a1, gym.a2].sort());
  assert.deepEqual(await branches(M), [gym.a1]);
  assert.deepEqual(await branches(A1), [gym.a1]);
  assert.deepEqual(await branches(AA), [gym.a1, gym.a2].sort());
});

integrationTest('QR check-in: lễ tân trong phạm vi lấy được QR hợp lệ của chi nhánh; log check-in không lộ checkedInBy', async () => {
  const qr = await call(R1, 'GET', `/owner/gyms/${gym.a1}/checkin-qr`);
  assert.equal(qr.status, 200);
  assert.ok(qr.body.data.token && qr.body.data.gymId === gym.a1);
  const log = await call(R1, 'GET', `/owner/gyms/${gym.a1}/checkins`);
  assert.equal(log.status, 200);
  assert.equal(log.body.data.length, 1);
  assert.equal('checkedInBy' in log.body.data[0], false);
});

// ── 4. Phạm vi chi nhánh & ranh giới đối tác ────────────────────────────────────────────────────────────────
integrationTest('ĐỐI TÁC KHÁC: lễ tân/kế toán của B không đọc được bất cứ thứ gì của A (kể cả kế toán cả-thương-hiệu của B)', async () => {
  const paths = [
    `/owner/gyms/${gym.a1}`, `/owner/gyms/${gym.a1}/memberships`, `/owner/gyms/${gym.a1}/checkin-qr`, `/owner/gyms/${gym.a1}/checkins`,
    `/owner/gyms/${gym.a1}/wallet`, `/owner/gyms/${gym.a1}/withdrawals`, `/owner/brands/${brand.a}`, `/owner/brands/${brand.a}/plans`,
  ];
  for (const tok of [RB, AB, OB]) {
    for (const p of paths) {
      const r = await call(tok, 'GET', p);
      assert.ok(r.status === 403 || r.status === 404, `${tok} ${p} → ${r.status}`);
      assert.equal(r.body?.data, undefined, `${tok} ${p} lộ dữ liệu`);
    }
  }
  // Ngược lại: nhân sự của B thấy đúng chi nhánh của B.
  const own = await call(AB, 'GET', `/owner/gyms/${gym.b1}/wallet`);
  assert.equal(own.status, 200);
  assert.deepEqual((await call(RB, 'GET', '/owner/gyms')).body.data.map((g: any) => g.id), [gym.b1]);
});

integrationTest('tài khoản bị THU HỒI mất quyền ngay ở lần gọi kế tiếp', async () => {
  const uid = randomUUID();
  USERS['tok-temp-r'] = { id: uid, role: 'GYM_OWNER', email: 'temp@staff.test' };
  const partner = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.ownerA } });
  const acc = await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.partnerId, userId: uid, role: 'RECEPTIONIST', scopedGymIds: [gym.a1], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  assert.equal((await call('tok-temp-r', 'GET', `/owner/gyms/${gym.a1}/checkins`)).status, 200);
  const revoke = await call(O, 'DELETE', `/owner/partner-accounts/${acc.id}`, { reason: 'nghỉ việc' });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
  assert.equal((await call('tok-temp-r', 'GET', `/owner/gyms/${gym.a1}/checkins`)).status, 403);
});

// ── 5. Quản lý nhân sự ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('OWNER mời lễ tân / kế toán / quản lý; ràng buộc phạm vi theo vai trò; vai trò lạ và OWNER bị từ chối', async () => {
  const invite = (body: any) => call(O, 'POST', '/owner/partner-invitations', body);
  const r1 = await invite({ email: 'Le.Tan@Staff.Test', role: 'RECEPTIONIST', scopedGymIds: [gym.a1] });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.data.invitation.role, 'RECEPTIONIST');
  assert.equal(r1.body.data.invitation.email, 'le.tan@staff.test');
  assert.ok(sentMails.some((m) => m.to === 'le.tan@staff.test' && /lễ tân/.test(m.subject)));

  const r2 = await invite({ email: 'ketoan@staff.test', role: 'ACCOUNTANT' }); // không chi nhánh = cả thương hiệu
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.deepEqual(r2.body.data.invitation.scopedGymIds, []);
  const r3 = await invite({ email: 'ketoan2@staff.test', role: 'ACCOUNTANT', scopedGymIds: [gym.a2] });
  assert.equal(r3.status, 201);
  assert.deepEqual(r3.body.data.invitation.scopedGymIds, [gym.a2]);
  const r4 = await invite({ email: 'ql@staff.test', scopedGymIds: [gym.a1] }); // client cũ: không có role → MANAGER
  assert.equal(r4.status, 201);
  assert.equal(r4.body.data.invitation.role, 'MANAGER');

  assert.equal((await invite({ email: 'a@staff.test', role: 'RECEPTIONIST' })).status, 400, 'lễ tân phải có chi nhánh');
  assert.equal((await invite({ email: 'a@staff.test', role: 'RECEPTIONIST', scopedGymIds: [] })).status, 400);
  assert.equal((await invite({ email: 'a@staff.test', role: 'MANAGER', scopedGymIds: [] })).status, 400);
  assert.equal((await invite({ email: 'a@staff.test', role: 'OWNER', scopedGymIds: [gym.a1] })).status, 400);
  assert.equal((await invite({ email: 'a@staff.test', role: 'FACILITY_STAFF', scopedGymIds: [gym.a1] })).status, 400);
  assert.equal((await invite({ email: 'a@staff.test', role: 'RECEPTIONIST', scopedGymIds: [gym.b1] })).status, 403, 'không gán chi nhánh của đối tác khác');
  assert.equal((await invite({ email: 'a@staff.test', role: 'ACCOUNTANT', scopedGymIds: [gym.b1] })).status, 403);

  // Không ai ngoài OWNER mời được — kể cả khi cố tự cấp quyền cao hơn.
  for (const tok of [M, R1, A1, AA]) {
    const r = await call(tok, 'POST', '/owner/partner-invitations', { email: 'evil@staff.test', role: 'MANAGER', scopedGymIds: [gym.a1] });
    assert.equal(r.status, 403, tok);
  }
});

integrationTest('chấp nhận thư mời → tài khoản đúng vai trò, đúng phạm vi; đăng nhập vào là dùng được đúng quyền đó, không hơn', async () => {
  const inv = await call(O, 'POST', '/owner/partner-invitations', { email: 'accept.le@staff.test', role: 'RECEPTIONIST', scopedGymIds: [gym.a2] });
  const token = inv.body.data.inviteLink.split('/').pop();
  const preview = await call(null, 'GET', `/partner-invitations/${token}`);
  assert.equal(preview.body.data.role, 'RECEPTIONIST');
  const accept = await call(null, 'POST', `/partner-invitations/${token}/accept`, { password: 'Passw0rd!x', firstName: 'Lan' });
  assert.equal(accept.status, 201, JSON.stringify(accept.body));
  assert.equal(accept.body.data.role, 'RECEPTIONIST');
  const acc = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { role: 'RECEPTIONIST', scopedGymIds: { equals: [gym.a2] }, invitedBy: id.ownerA }, orderBy: { createdAt: 'desc' } });
  assert.equal(acc.status, 'ACTIVE');
  // Hoàn tất onboarding rồi dùng: bước duy nhất của vai trò này là số điện thoại.
  USERS['tok-new-r'] = { id: acc.userId, role: 'GYM_OWNER', email: 'accept.le@staff.test' };
  const blocked = await call('tok-new-r', 'GET', `/owner/gyms/${gym.a2}/checkin-qr`);
  assert.equal(blocked.status, 409, 'chưa xong onboarding → ONBOARDING_INCOMPLETE');
  const done = await call('tok-new-r', 'PATCH', '/owner/onboarding/contact', { phone: '0900000000' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.completed, true, 'lễ tân chỉ cần bước liên hệ');
  assert.equal((await call('tok-new-r', 'GET', `/owner/gyms/${gym.a2}/checkin-qr`)).status, 200);
  assert.equal((await call('tok-new-r', 'GET', `/owner/gyms/${gym.a1}/checkin-qr`)).status, 403);
  assert.equal((await call('tok-new-r', 'GET', `/owner/gyms/${gym.a2}/wallet`)).status, 403);
});

integrationTest('chủ thu hồi được lễ tân/kế toán/quản lý; không thu hồi được OWNER; danh sách tài khoản chỉ OWNER thấy', async () => {
  const list = await call(O, 'GET', '/owner/partner-accounts');
  assert.equal(list.status, 200);
  const roles = new Set(list.body.data.map((a: any) => a.role));
  for (const r of ['OWNER', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT']) assert.ok(roles.has(r), r);
  const ownerAcc = list.body.data.find((a: any) => a.role === 'OWNER');
  const del = await call(O, 'DELETE', `/owner/partner-accounts/${ownerAcc.id}`);
  assert.equal(del.status, 403);
  // Không thu hồi được tài khoản của đối tác khác.
  const other = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.recepB } });
  assert.equal((await call(O, 'DELETE', `/owner/partner-accounts/${other.id}`)).status, 404);
  assert.equal((await call(M, 'DELETE', `/owner/partner-accounts/${other.id}`)).status, 403);
});

integrationTest('chuyển quyền sở hữu chỉ cho MANAGER (không đi tắt từ lễ tân/kế toán lên OWNER)', async () => {
  const { partnerService } = await import('../services/partner.service');
  const acc = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.recepA1 } });
  await assert.rejects(() => partnerService.transferOwnership(acc.partnerId, acc.id, 'admin'), /quản lý/);
  const acct = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.acctA1 } });
  await assert.rejects(() => partnerService.transferOwnership(acct.partnerId, acct.id, 'admin'), /quản lý/);
});

integrationTest('CHECK ở CSDL: lễ tân/quản lý không chi nhánh bị từ chối; kế toán không chi nhánh hợp lệ', async () => {
  const partner = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.ownerA } });
  const mk = (role: any, scoped: string[]) =>
    prisma.gymPartnerAccount.create({ data: { partnerId: partner.partnerId, userId: randomUUID(), role, scopedGymIds: scoped, status: 'ACTIVE' } });
  await assert.rejects(() => mk('RECEPTIONIST', []));
  await assert.rejects(() => mk('MANAGER', []));
  const ok = await mk('ACCOUNTANT', []);
  assert.equal(ok.role, 'ACCOUNTANT');
});

// ── 6. Cổng vận hành khi đối tác bị tạm khoá ───────────────────────────────────────────────────────────────
integrationTest('đối tác SUSPENDED: lễ tân + quản lý vẫn làm việc, kế toán (dữ liệu tiền) và chủ bị khoá', async () => {
  const acc = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.ownerA } });
  await prisma.gymPartner.update({ where: { id: acc.partnerId }, data: { status: 'SUSPENDED' } });
  try {
    assert.equal((await call(R1, 'GET', `/owner/gyms/${gym.a1}/checkin-qr`)).status, 200);
    assert.equal((await call(M, 'GET', `/owner/gyms/${gym.a1}/memberships`)).status, 200);
    const a = await call(AA, 'GET', `/owner/gyms/${gym.a1}/wallet`);
    assert.equal(a.status, 403);
    assert.equal(a.body.error.code, 'PARTNER_SUSPENDED');
    assert.equal((await call(O, 'GET', `/owner/gyms/${gym.a1}/wallet`)).status, 403);
  } finally {
    await prisma.gymPartner.update({ where: { id: acc.partnerId }, data: { status: 'ACTIVE' } });
  }
});

// ── 7. Default-deny bằng cấu trúc: không route nào dưới cổng vận hành thiếu cổng quyền ─────────────────────
integrationTest('cây route /owner: MỌI route sau cổng vận hành đều có cổng quyền có nhãn (requirePermission / requirePartnerOwner)', async () => {
  const layers: any[] = ownerRouter.stack;
  const gateIdx = layers.findIndex((l) => l.handle?.name === 'requireOperationalAccess');
  assert.ok(gateIdx > 0, 'phải tìm thấy cổng vận hành');
  const tagged = (fn: any) => Array.isArray(fn?.permissions) && fn.permissions.length > 0;
  const missing: string[] = [];
  let routes = 0;
  layers.slice(gateIdx + 1).forEach((layer, i, arr) => {
    if (layer.route) {
      routes++;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      if (!layer.route.stack.some((s: any) => tagged(s.handle))) missing.push(`${methods} ${layer.route.path}`);
      return;
    }
    // router.use(path, guard, subRouter): lớp sub-router phải đứng ngay sau một lớp guard có nhãn cùng đường dẫn.
    if (layer.handle?.stack) {
      const prev = arr[i - 1];
      if (!(prev && !prev.route && tagged(prev.handle) && prev.regexp.source === layer.regexp.source)) {
        missing.push(`use ${layer.regexp.source}`);
      }
    }
  });
  assert.deepEqual(missing, [], `route thiếu cổng quyền: ${missing.join(' | ')}`);
  assert.ok(routes > 40, `đã duyệt ${routes} route`);
});
