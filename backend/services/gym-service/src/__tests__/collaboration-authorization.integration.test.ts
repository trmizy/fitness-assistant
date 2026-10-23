/**
 * REAL HTTP/API + DB test thật — ai được đọc/ghi thoả thuận cộng tác PT (tỷ lệ chia doanh thu).
 *
 * Ranh giới: "tiền và người thì chỉ chủ sở hữu". `GET /owner/collaborations` đã đòi OWNER, nhưng
 * route dùng chung `GET /me/collaborations` (PT + GYM_OWNER, nằm NGOÀI /owner) chỉ đi qua cổng vận
 * hành — nên một tài khoản MANAGER đọc được toàn bộ tỷ lệ đã đàm phán của MỌI chi nhánh qua đường
 * thứ hai. File này khoá lại cả hai đường và kiểm luôn phía đối diện:
 *   • MANAGER → 403 trên mọi route cộng tác / mời PT;
 *   • OWNER của đối tác khác không thấy, không sửa được dòng của đối tác này;
 *   • PT chỉ thấy, chỉ sửa được thoả thuận của chính mình;
 *   • chủ gym cũ (legacy, không có hồ sơ đối tác) vẫn dùng được như trước.
 *
 * Dựng app Express THẬT với đúng các router, auth-service giả (token → user), còn lại là dữ liệu
 * thật trong DB test: hồ sơ đối tác, tài khoản OWNER/MANAGER, chi nhánh, dòng cộng tác.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

const SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const OWNER_A = randomUUID();
const MANAGER_A = randomUUID();
const OWNER_B = randomUUID();
const LEGACY_OWNER = randomUUID();
const PT_1 = randomUUID();
const PT_2 = randomUUID();

const USERS: Record<string, { id: string; role: string; email: string }> = {
  'tok-owner-a': { id: OWNER_A, role: 'GYM_OWNER', email: 'owner-a@collab.test' },
  'tok-manager-a': { id: MANAGER_A, role: 'GYM_OWNER', email: 'manager-a@collab.test' },
  'tok-owner-b': { id: OWNER_B, role: 'GYM_OWNER', email: 'owner-b@collab.test' },
  'tok-legacy': { id: LEGACY_OWNER, role: 'GYM_OWNER', email: 'legacy@collab.test' },
  'tok-pt-1': { id: PT_1, role: 'PT', email: 'pt1@collab.test' },
  'tok-pt-2': { id: PT_2, role: 'PT', email: 'pt2@collab.test' },
  'tok-customer': { id: randomUUID(), role: 'CUSTOMER', email: 'c@collab.test' },
};

let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let ownerRouter: any;

const partnerIds: string[] = [];
// gymA1 nằm trong phạm vi của MANAGER_A; gymA2 thì không — cả hai đều của đối tác A.
const gym = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), legacy: randomUUID() };
const collab = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), legacy: randomUUID() };
const affiliationId = randomUUID();

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
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  // Cổng ngẫu nhiên: các file test chạy song song, mỗi file một auth-service giả riêng.
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;

  prisma = (await import('../repositories/prisma')).prisma;

  for (const [ownerUserId, managerUserId] of [
    [OWNER_A, MANAGER_A],
    [OWNER_B, null],
  ] as const) {
    const partner = await prisma.gymPartner.create({
      data: {
        legalName: `Collab Authz ${ownerUserId.slice(0, 8)}`,
        contactEmail: `${ownerUserId.slice(0, 8)}@collab.test`,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
    });
    partnerIds.push(partner.id);
    await prisma.gymPartnerAccount.create({
      data: {
        partnerId: partner.id, userId: ownerUserId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE',
        activatedAt: new Date(), onboardingCompletedAt: new Date(),
      },
    });
    if (managerUserId) {
      await prisma.gymPartnerAccount.create({
        data: {
          partnerId: partner.id, userId: managerUserId, role: 'MANAGER', scopedGymIds: [gym.a1], status: 'ACTIVE',
          activatedAt: new Date(), onboardingCompletedAt: new Date(),
        },
      });
    }
  }

  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: OWNER_A, name: 'Collab A1', address: '1 A St', status: 'APPROVED' },
      { id: gym.a2, ownerId: OWNER_A, name: 'Collab A2', address: '2 A St', status: 'APPROVED' },
      { id: gym.b1, ownerId: OWNER_B, name: 'Collab B1', address: '1 B St', status: 'APPROVED' },
      // Chủ gym có từ trước mô hình đối tác: đứng tên một Gym nhưng không có GymPartnerAccount.
      { id: gym.legacy, ownerId: LEGACY_OWNER, name: 'Collab Legacy', address: '1 L St', status: 'APPROVED' },
    ],
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const accepted = { status: 'ACCEPTED' as const, proposedBy: 'GYM' as const, expiresAt, acceptedAt: new Date() };
  await prisma.gymPtCollaboration.createMany({
    data: [
      { id: collab.a1, gymId: gym.a1, ptUserId: PT_1, proposedPtRate: 0.6, proposedGymRate: 0.3, platformRate: 0.1, ...accepted },
      { id: collab.a2, gymId: gym.a2, ptUserId: PT_2, proposedPtRate: 0.55, proposedGymRate: 0.35, platformRate: 0.1, ...accepted },
      // Đang chờ phía gym trả lời — để thử "OWNER khác / MANAGER trả lời hộ".
      { id: collab.b1, gymId: gym.b1, ptUserId: PT_1, proposedPtRate: 0.7, proposedGymRate: 0.2, platformRate: 0.1, status: 'PENDING', proposedBy: 'PT', expiresAt },
      { id: collab.legacy, gymId: gym.legacy, ptUserId: PT_2, proposedPtRate: 0.65, proposedGymRate: 0.25, platformRate: 0.1, ...accepted },
    ],
  });
  await prisma.gymTrainerAffiliation.create({
    data: { id: affiliationId, gymId: gym.a1, ptId: PT_1, status: 'ACTIVE', visibility: 'PUBLIC', commissionRate: 0.3, invitedBy: OWNER_A },
  });

  const publicRoutes = (await import('../routes/public.routes')).default;
  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const ptRoutes = (await import('../routes/pt.routes')).default;
  const internalRoutes = (await import('../routes/internal.routes')).default;
  ownerRouter = ownerRoutes;

  // Cùng thứ tự mount với app.ts.
  const app = express();
  app.use(express.json());
  app.use('/', publicRoutes);
  app.use('/owner', ownerRoutes);
  app.use('/', ptRoutes);
  app.use('/internal', internalRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  const gymIds = Object.values(gym);
  await prisma.gymTrainerAffiliation.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymPtCollaboration.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

async function call(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
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

const ids = (r: { body: any }) => (r.body?.data ?? []).map((row: { id: string }) => row.id).sort();
const sorted = (...list: string[]) => [...list].sort();

// ── MANAGER ──────────────────────────────────────────────────────────────────

integrationTest('MANAGER không đọc được thoả thuận cộng tác qua route dùng chung /me/collaborations → 403', async () => {
  const r = await call('tok-manager-a', 'GET', '/me/collaborations');
  assert.equal(r.status, 403, `MANAGER đọc được ${JSON.stringify(ids(r))}`);
  assert.equal(r.body.error.code, 'OWNER_ROLE_REQUIRED');
  assert.equal(r.body.data, undefined, 'không lộ dòng nào kèm theo lỗi');
});

integrationTest('MANAGER → 403 trên mọi route cộng tác / mời PT của /owner, kể cả với chi nhánh trong phạm vi', async () => {
  const attempts: Array<[string, string, unknown?]> = [
    ['GET', '/owner/collaborations'],
    ['POST', `/owner/gyms/${gym.a1}/collaborations`, { ptUserId: PT_2, ptRate: '0.6', gymRate: '0.3' }],
    ['PATCH', `/owner/collaborations/${collab.a1}`, { action: 'REJECT' }],
    ['DELETE', `/owner/collaborations/${collab.a1}`],
    ['POST', `/owner/gyms/${gym.a1}/trainers`, { ptId: PT_2, commissionRate: 0.2 }],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call('tok-manager-a', method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.error.code, 'OWNER_ROLE_REQUIRED', `${method} ${path}`);
  }
  const row = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: collab.a1 } });
  assert.equal(row.status, 'ACCEPTED', 'yêu cầu bị từ chối không được để lại thay đổi nào');
  assert.equal(await prisma.gymPtCollaboration.count({ where: { gymId: gym.a1, ptUserId: PT_2 } }), 0);
  assert.equal(await prisma.gymTrainerAffiliation.count({ where: { gymId: gym.a1, ptId: PT_2 } }), 0);
});

integrationTest('kiểm kê: MỌI route của owner router có "collaborations" hoặc "trainers" đều từ chối MANAGER', async () => {
  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of ownerRouter.stack) {
    if (!layer.route || !/collaborations|trainers/.test(layer.route.path)) continue;
    for (const method of Object.keys(layer.route.methods)) routes.push({ method: method.toUpperCase(), path: layer.route.path });
  }
  assert.ok(routes.length >= 5, `chỉ tìm thấy ${routes.length} route — chống test rỗng`);
  for (const spec of routes) {
    const path = spec.path.replace(':gymId', gym.a1).replace(':id', collab.a1);
    const r = await call('tok-manager-a', spec.method, `/owner${path}`, ['POST', 'PATCH', 'PUT'].includes(spec.method) ? {} : undefined);
    assert.equal(r.status, 403, `${spec.method} ${spec.path}`);
    assert.equal(r.body.error.code, 'OWNER_ROLE_REQUIRED', `${spec.method} ${spec.path}`);
  }
});

// ── OWNER ────────────────────────────────────────────────────────────────────

integrationTest('OWNER thấy đúng thoả thuận của mọi chi nhánh thuộc đối tác mình — trên cả hai đường', async () => {
  for (const path of ['/me/collaborations', '/owner/collaborations']) {
    const r = await call('tok-owner-a', 'GET', path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(ids(r), sorted(collab.a1, collab.a2), path);
  }
});

integrationTest('OWNER của đối tác khác không thấy và không sửa được thoả thuận của đối tác này', async () => {
  for (const path of ['/me/collaborations', '/owner/collaborations']) {
    const r = await call('tok-owner-b', 'GET', path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(ids(r), [collab.b1], `${path}: chỉ dòng của chính đối tác B`);
  }

  assert.equal((await call('tok-owner-b', 'PATCH', `/owner/collaborations/${collab.a1}`, { action: 'REJECT' })).status, 403);
  assert.equal((await call('tok-owner-b', 'DELETE', `/owner/collaborations/${collab.a1}`)).status, 403);
  assert.equal(
    (await call('tok-owner-b', 'POST', `/owner/gyms/${gym.a1}/collaborations`, { ptUserId: PT_2, ptRate: '0.6', gymRate: '0.3' })).status,
    403,
  );
  assert.equal((await call('tok-owner-b', 'POST', `/owner/gyms/${gym.a1}/trainers`, { ptId: PT_2 })).status, 403);

  const row = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: collab.a1 } });
  assert.equal(row.status, 'ACCEPTED');
  assert.equal(row.terminatedBy, null);
});

integrationTest('chủ gym cũ (legacy, không có hồ sơ đối tác nhưng đứng tên một Gym) vẫn đọc được của mình', async () => {
  for (const path of ['/me/collaborations', '/owner/collaborations']) {
    const r = await call('tok-legacy', 'GET', path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(ids(r), [collab.legacy], path);
  }
});

// ── PT ───────────────────────────────────────────────────────────────────────

integrationTest('PT chỉ thấy thoả thuận của chính mình', async () => {
  const pt1 = await call('tok-pt-1', 'GET', '/me/collaborations');
  assert.equal(pt1.status, 200);
  assert.deepEqual(ids(pt1), sorted(collab.a1, collab.b1));

  const pt2 = await call('tok-pt-2', 'GET', '/me/collaborations');
  assert.equal(pt2.status, 200);
  assert.deepEqual(ids(pt2), sorted(collab.a2, collab.legacy));
});

integrationTest('PT không trả lời / chấm dứt được thoả thuận của PT khác, và không vào được đường của chủ gym', async () => {
  assert.equal((await call('tok-pt-1', 'PATCH', `/collaborations/${collab.a2}`, { action: 'REJECT' })).status, 403);
  assert.equal((await call('tok-pt-1', 'DELETE', `/collaborations/${collab.a2}`)).status, 403);
  const row = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: collab.a2 } });
  assert.equal(row.status, 'ACCEPTED');

  const viaOwnerPath = await call('tok-pt-1', 'GET', '/owner/collaborations');
  assert.equal(viaOwnerPath.status, 403);
  assert.equal(viaOwnerPath.body.error.code, 'FORBIDDEN');
});

// ── Vai trò khác / không đăng nhập / tầng nội bộ / công khai ─────────────────

integrationTest('/me/collaborations: CUSTOMER → 403, không token → 401', async () => {
  const customer = await call('tok-customer', 'GET', '/me/collaborations');
  assert.equal(customer.status, 403);
  assert.equal(customer.body.error.code, 'FORBIDDEN');
  assert.equal((await call(null, 'GET', '/me/collaborations')).status, 401);
});

integrationTest('/internal/collaborations/active chỉ mở bằng service secret — JWT người dùng không đủ', async () => {
  const path = `/internal/collaborations/active?gymId=${gym.a1}&ptUserId=${PT_1}`;
  assert.equal((await call(null, 'GET', path)).status, 401);
  assert.equal((await call('tok-owner-a', 'GET', path)).status, 401, 'kể cả chính chủ sở hữu cũng không gọi được bằng JWT');
  assert.equal((await call(null, 'GET', path, undefined, { 'x-service-secret': 'wrong' })).status, 401);

  const ok = await call(null, 'GET', path, undefined, { 'x-service-secret': SERVICE_SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.collaborationId, collab.a1);
});

integrationTest('công khai: GET /gyms/:gymId/trainers không lộ tỷ lệ hoa hồng của phòng gym', async () => {
  const r = await call(null, 'GET', `/gyms/${gym.a1}/trainers`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  const row = r.body.data[0];
  assert.equal(row.ptId, PT_1);
  assert.equal('commissionRate' in row, false, 'commissionRate là điều khoản thương mại, không phải thông tin công khai');
  assert.equal('invitedBy' in row, false);
});
