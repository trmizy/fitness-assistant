/**
 * GYM_PARTNER_SECURITY_MODEL.md §1–§2 — bằng chứng REAL HTTP/API (không DB) rằng cổng vận hành chặn
 * ứng viên và tài khoản mồ côi ở TẦNG SERVER, không phải chỉ ở giao diện.
 *
 * Dựng app Express THẬT với đúng router `/owner` và `pt.routes`, một auth-service giả (chỉ trả user
 * cho từng token), và thay tạm hai truy vấn DB của partnerRepository để điều khiển "ai là ai". Rồi:
 *   • kiểm kê MỌI route đã đăng ký trong owner router (đọc từ router.stack — route mới thêm sau này
 *     tự động bị kiểm), gọi từng cái với từng loại tài khoản chưa được duyệt;
 *   • khẳng định không route vận hành nào cho qua, và mã lỗi đúng.
 * Không đụng DB: một route bị cho qua lầm sẽ chạm controller và trả 500 chứ không phải 403/409 — đủ
 * để test này đỏ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4023';

type Kind =
  | 'orphan'
  | 'onboarding'
  | 'underReview'
  | 'needsInfo'
  | 'rejected'
  | 'suspendedOwner'
  | 'terminated'
  | 'activeUnverified'
  | 'payoutPending'
  | 'active';

const USERS: Record<Kind, string> = {
  orphan: 'u-orphan',
  onboarding: 'u-onboarding',
  underReview: 'u-under-review',
  needsInfo: 'u-needs-info',
  rejected: 'u-rejected',
  suspendedOwner: 'u-suspended',
  terminated: 'u-terminated',
  activeUnverified: 'u-active-unverified',
  payoutPending: 'u-payout-pending',
  active: 'u-active',
};

function account(userId: string, partnerStatus: string, verificationStatus: string, onboardingDone: boolean) {
  return {
    id: `acc-${userId}`,
    partnerId: `p-${userId}`,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    scopedGymIds: [] as string[],
    onboardingCompletedAt: onboardingDone ? new Date() : null,
    partner: { status: partnerStatus, verificationStatus },
  };
}

const ACCOUNTS: Record<string, ReturnType<typeof account> | null> = {
  [USERS.orphan]: null,
  [USERS.onboarding]: account(USERS.onboarding, 'PROSPECT', 'NOT_VERIFIED', false),
  [USERS.underReview]: account(USERS.underReview, 'PROSPECT', 'IN_REVIEW', false),
  [USERS.needsInfo]: account(USERS.needsInfo, 'PROSPECT', 'NEEDS_INFO', false),
  // Kể cả khi ứng viên đã tự hoàn tất bước payout/terms (onboardingCompletedAt đã đặt) — điều đó
  // KHÔNG được mở khoá vận hành: cổng đòi partner ACTIVE + VERIFIED.
  [USERS.rejected]: account(USERS.rejected, 'PROSPECT', 'REJECTED', true),
  [USERS.suspendedOwner]: account(USERS.suspendedOwner, 'SUSPENDED', 'VERIFIED', true),
  [USERS.terminated]: account(USERS.terminated, 'TERMINATED', 'VERIFIED', true),
  [USERS.activeUnverified]: account(USERS.activeUnverified, 'ACTIVE', 'IN_REVIEW', true),
  [USERS.payoutPending]: account(USERS.payoutPending, 'ACTIVE', 'VERIFIED', false),
  [USERS.active]: account(USERS.active, 'ACTIVE', 'VERIFIED', true),
};

// Vùng ứng viên: hai prefix này là thứ DUY NHẤT được phép dùng khi chưa được duyệt.
const APPLICANT_ZONE = ['/onboarding', '/application'];

let authServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let restore: Array<() => void> = [];
let ownerRouter: any;

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const token = String(req.headers.authorization || '').replace('Bearer ', '');
      const kind = token.startsWith('tok-') ? (token.slice(4) as Kind) : null;
      if (kind && USERS[kind]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: USERS[kind], email: `${kind}@x.test`, role: 'GYM_OWNER' } }));
        return;
      }
      if (token === 'tok-pt') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: 'u-pt', email: 'pt@x.test', role: 'PT' } }));
        return;
      }
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid token' }));
  });
  await new Promise<void>((resolve) => authServer.listen(4023, '127.0.0.1', resolve));

  const { partnerRepository } = await import('../repositories/partner.repository');
  const { onboardingService } = await import('../services/onboarding.service');
  const patch = (obj: any, key: string, impl: unknown) => {
    const original = obj[key];
    obj[key] = impl;
    restore.push(() => {
      obj[key] = original;
    });
  };
  patch(partnerRepository, 'findAccountByUserId', async (userId: string) => ACCOUNTS[userId] ?? null);
  // Không user nào trong bảng trên đứng tên Gym/Brand nào → không ai chứng minh được là legacy.
  patch(partnerRepository, 'userHasLegacyOwnership', async () => false);
  patch(onboardingService, 'getProgress', async () => ({ completed: false, currentStep: 4 }));

  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const ptRoutes = (await import('../routes/pt.routes')).default;
  ownerRouter = ownerRoutes;

  const app = express();
  app.use(express.json());
  app.use('/owner', ownerRoutes);
  app.use('/', ptRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  restore.forEach((r) => r());
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
});

type RouteSpec = { method: string; path: string };

function listOwnerRoutes(): RouteSpec[] {
  const out: RouteSpec[] = [];
  for (const layer of ownerRouter.stack) {
    if (!layer.route) continue; // middleware / router lồng nhau (vd /application) — không phải route đơn
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'test-id');

async function call(kind: Kind | 'pt', spec: RouteSpec, base = '/owner') {
  const res = await fetch(`${baseUrl}${base}${concrete(spec.path)}`, {
    method: spec.method,
    headers: { authorization: `Bearer tok-${kind}`, 'content-type': 'application/json' },
    body: ['POST', 'PUT', 'PATCH'].includes(spec.method) ? '{}' : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* body không phải JSON */
  }
  return { status: res.status, code: body?.error?.code as string | undefined };
}

const isApplicantZone = (path: string) => APPLICANT_ZONE.some((z) => path === z || path.startsWith(z + '/'));

test('kiểm kê route: owner router thực sự có nhiều route vận hành để kiểm (chống test rỗng)', () => {
  const operational = listOwnerRoutes().filter((r) => !isApplicantZone(r.path));
  assert.ok(operational.length >= 40, `chỉ tìm thấy ${operational.length} route vận hành`);
  // Những route nhạy cảm nhất phải nằm trong danh sách được kiểm.
  const has = (m: string, p: string) => operational.some((r) => r.method === m && r.path === p);
  assert.ok(has('POST', '/gyms/:gymId/withdrawals'), 'rút tiền');
  assert.ok(has('GET', '/gyms/:gymId/wallet'), 'ví');
  assert.ok(has('GET', '/gyms/:gymId/checkins'), 'check-in');
  assert.ok(has('POST', '/brands/:brandId/plans'), 'bán gói hội viên');
  assert.ok(has('POST', '/gyms/:gymId/collaborations'), 'cộng tác PT');
  assert.ok(has('POST', '/partner-invitations'), 'mời quản lý');
});

const EXPECTED: Array<[Kind, number, string]> = [
  ['orphan', 403, 'NO_PARTNER_ACCOUNT'],
  ['onboarding', 403, 'PARTNER_APPLICATION_PENDING'],
  ['underReview', 403, 'PARTNER_APPLICATION_PENDING'],
  ['needsInfo', 403, 'PARTNER_APPLICATION_PENDING'],
  ['rejected', 403, 'PARTNER_APPLICATION_PENDING'],
  ['suspendedOwner', 403, 'PARTNER_SUSPENDED'],
  ['terminated', 403, 'PARTNER_TERMINATED'],
  ['activeUnverified', 403, 'PARTNER_NOT_VERIFIED'],
  ['payoutPending', 409, 'ONBOARDING_INCOMPLETE'],
];

for (const [kind, status, code] of EXPECTED) {
  test(`mọi route vận hành của /owner từ chối tài khoản "${kind}" → ${status} ${code}`, async () => {
    const routes = listOwnerRoutes().filter((r) => !isApplicantZone(r.path));
    const failures: string[] = [];
    for (const spec of routes) {
      const result = await call(kind, spec);
      if (result.status !== status || result.code !== code) {
        failures.push(`${spec.method} ${spec.path} → ${result.status} ${result.code ?? '(không có mã)'}`);
      }
    }
    assert.deepEqual(failures, [], `route bị cho qua hoặc trả sai mã cho "${kind}"`);
  });
}

test('/me/collaborations (dùng chung PT + GYM_OWNER, nằm NGOÀI /owner) cũng chặn ứng viên và tài khoản mồ côi', async () => {
  for (const [kind, status, code] of EXPECTED) {
    const result = await call(kind, { method: 'GET', path: '/me/collaborations' }, '');
    assert.equal(result.status, status, `${kind}: status`);
    assert.equal(result.code, code, `${kind}: code`);
  }
});

test('chủ gym ACTIVE + VERIFIED + onboarding xong KHÔNG bị cổng chặn (đi tiếp tới controller)', async () => {
  // Không DB → controller trả 500; điều cần chứng minh là cổng KHÔNG trả 403/409.
  const result = await call('active', { method: 'GET', path: '/gyms' });
  assert.ok(![403, 409].includes(result.status), `bị chặn nhầm: ${result.status} ${result.code}`);
  assert.notEqual(result.code, 'PARTNER_APPLICATION_PENDING');
});

test('tài khoản mồ côi: onboarding/* cũng bị từ chối (không còn được coi là "đã xong hết")', async () => {
  for (const spec of [
    { method: 'GET', path: '/onboarding/status' },
    { method: 'PATCH', path: '/onboarding/contact' },
    { method: 'POST', path: '/onboarding/brand' },
    { method: 'PATCH', path: '/onboarding/payout' },
    { method: 'POST', path: '/onboarding/terms' },
  ]) {
    const result = await call('orphan', spec);
    assert.equal(result.status, 403, `${spec.method} ${spec.path}`);
    assert.equal(result.code, 'NO_PARTNER_ACCOUNT');
  }
});

test('vùng ứng viên: tài khoản mồ côi gọi được application/status và nhận SETUP_INCOMPLETE', async () => {
  const res = await fetch(`${baseUrl}/owner/application/status`, {
    headers: { authorization: 'Bearer tok-orphan' },
  });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.data.accessState, 'SETUP_INCOMPLETE');
  assert.equal(body.data.editable, false);
});

test('vùng ứng viên: trạng thái điều hướng đúng cho từng giai đoạn hồ sơ', async () => {
  const expected: Array<[Kind, string]> = [
    ['onboarding', 'ONBOARDING'],
    ['underReview', 'UNDER_REVIEW'],
    ['needsInfo', 'CHANGES_REQUESTED'],
    ['rejected', 'REJECTED'],
    ['payoutPending', 'APPROVED_PAYOUT_PENDING'],
    ['active', 'ACTIVE'],
    ['suspendedOwner', 'SUSPENDED'],
    ['terminated', 'TERMINATED'],
    ['activeUnverified', 'RESTRICTED'],
  ];
  for (const [kind, state] of expected) {
    const res = await fetch(`${baseUrl}/owner/application/status`, { headers: { authorization: `Bearer tok-${kind}` } });
    assert.equal(res.status, 200, kind);
    const body: any = await res.json();
    assert.equal(body.data.accessState, state, kind);
  }
});

test('không có token / token sai → 401, không lộ gì', async () => {
  const anon = await fetch(`${baseUrl}/owner/gyms`);
  assert.equal(anon.status, 401);
  const bad = await fetch(`${baseUrl}/owner/gyms`, { headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.status, 401);
});
