/**
 * BACKEND INTEGRATION (REAL HTTP through the real Express routers, auth-service FAKED, isolated *_test DB).
 * Bugs from the 24/10/2026 partner test round (_warroom/evidence/partner-test-20261024/BUGS.md):
 *   C1-02 self-invite, C1-03 invited-staff password policy, C1-04 collaboration rates, C1-07 legal step validation,
 *   C1-11 revoked staff code, C3-11 draft reuse. (C2-03 lives in listing-b1-public.integration.test.ts.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4081';
process.env.PAYMENT_SERVICE_URL = 'http://127.0.0.1:4082';
process.env.USER_SERVICE_URL = 'http://127.0.0.1:4084';
process.env.PARTNER_S3_PRIVATE_BUCKET = '';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const USERS: Record<string, { id: string; role: string; email: string }> = {};
function user(role: string, label = role.toLowerCase()) {
  const id = randomUUID();
  const token = `tok-${label}-${id.slice(0, 8)}`;
  USERS[token] = { id, role, email: `${id.slice(0, 8)}@c-fixes.test` };
  return { id, token, email: USERS[token].email };
}

let authServer: http.Server;
let userServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
const partnerIds: string[] = [];
const gymIds: string[] = [];
const brandIds: string[] = [];
const createdAccounts: any[] = [];

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}
const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test.before(async () => {
  if (!process.env.DATABASE_URL) return;
  authServer = http.createServer(async (req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const u = USERS[token];
      return u ? send(res, 200, { user: u }) : send(res, 401, { error: 'invalid' });
    }
    if (req.method === 'POST' && req.url === '/auth/internal/send-email') return send(res, 200, { ok: true });
    if (req.method === 'POST' && req.url === '/auth/internal/partner-auth/email-status') return send(res, 200, { exists: false, role: null });
    if (req.method === 'POST' && req.url === '/auth/internal/partner-auth/create-invited-account') {
      const body = await readBody(req);
      createdAccounts.push(body);
      return send(res, 201, { user: { id: randomUUID(), email: body.email, firstName: body.firstName, lastName: null, role: 'GYM_OWNER' } });
    }
    return send(res, 404, { error: 'not found' });
  });
  await new Promise<void>((r) => authServer.listen(4081, '127.0.0.1', r));
  userServer = http.createServer(async (_req, res) => send(res, 201, { success: true }));
  await new Promise<void>((r) => userServer.listen(4084, '127.0.0.1', r));

  prisma = (await import('../repositories/prisma')).prisma;
  const app = express();
  app.use(express.json());
  app.use('/', (await import('../routes/public.routes')).default);
  app.use('/owner', (await import('../routes/owner.routes')).default);
  app.use('/', (await import('../routes/client.routes')).default);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: brandIds } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, userServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
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
    /* not JSON */
  }
  return { status: res.status, body: json };
}

async function makeOwnerPartner(applicant = false) {
  const u = user('GYM_OWNER', 'owner');
  const partner = await prisma.gymPartner.create({
    data: {
      legalName: `C-fixes ${randomUUID().slice(0, 8)}`,
      contactEmail: u.email,
      source: 'SELF_SERVICE',
      ...(applicant ? { status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' } : { status: 'ACTIVE', verificationStatus: 'VERIFIED' }),
    } as any,
  });
  partnerIds.push(partner.id);
  const account = await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: u.id, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: applicant ? null : new Date() },
  });
  return { ...u, partner, account };
}

async function operationalOwner() {
  const o = await makeOwnerPartner();
  const brand = await prisma.gymBrand.create({ data: { ownerId: o.id, name: 'C Brand', approvedName: 'C Brand' } });
  brandIds.push(brand.id);
  const gym = await prisma.gym.create({
    data: { ownerId: o.id, brandId: brand.id, name: 'C Gym', address: '1 Test', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'C Gym', approvedAddress: '1 Test' },
  });
  gymIds.push(gym.id);
  return { ...o, brand, gym };
}

// ── C1-02 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C1-02: the owner cannot invite his OWN email (409 CANNOT_INVITE_SELF, nothing created); another email still works', async () => {
  const o = await operationalOwner();
  const invite = (email: string) => call(o.token, 'POST', '/owner/partner-invitations', { email, role: 'ACCOUNTANT' });
  for (const variant of [o.email, o.email.toUpperCase(), `  ${o.email}  `]) {
    const r = await invite(variant);
    assert.equal(r.status, 409, variant);
    assert.equal(r.body.error.code, 'CANNOT_INVITE_SELF');
    assert.match(r.body.error.message, /email của chính bạn/);
  }
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: o.partner.id } }), 0);
  assert.equal((await invite(`other-${randomUUID().slice(0, 8)}@c-fixes.test`)).status, 201);
});

// ── C1-03 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C1-03: invited staff password follows the registration policy (8+, upper + lower + digit); weak ones never reach auth-service', async () => {
  const o = await operationalOwner();
  const { partnerInvitationService } = await import('../services/partner-invitation.service');
  const { rawToken } = await partnerInvitationService.createInvitation({
    partnerId: o.partner.id, email: `acc-${randomUUID().slice(0, 8)}@c-fixes.test`, role: 'ACCOUNTANT', scopedGymIds: [], createdBy: o.id,
  });
  const accept = (password: string) => call(null, 'POST', `/partner-invitations/${rawToken}/accept`, { password, firstName: 'An' });
  const before = createdAccounts.length;
  for (const bad of ['alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere', 'Ab1']) {
    const r = await accept(bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error.code, 'WEAK_PASSWORD', bad);
  }
  assert.equal((await accept('alllowercase1')).body.error.message, 'Mật khẩu phải có chữ hoa, chữ thường và chữ số');
  assert.equal(createdAccounts.length, before, 'auth-service was never asked');
  assert.equal((await prisma.partnerInvitation.findFirstOrThrow({ where: { partnerId: o.partner.id } })).status, 'PENDING');
  const ok = await accept('Goodpass1');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

// ── C1-04 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C1-04: collaboration proposal with missing / non-numeric / out-of-range rates -> 400 with a code, never a 500 DecimalError', async () => {
  const o = await operationalOwner();
  const propose = (body: Record<string, unknown>) => call(o.token, 'POST', `/owner/gyms/${o.gym.id}/collaborations`, { ptUserId: randomUUID(), ...body });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ gymRate: '0.1' }, 'RATE_REQUIRED'],
    [{ ptRate: '0.8' }, 'RATE_REQUIRED'],
    [{ ptRate: '', gymRate: '0.1' }, 'RATE_REQUIRED'],
    [{ ptRate: null, gymRate: '0.1' }, 'RATE_REQUIRED'],
    [{ ptRate: 'abc', gymRate: '0.1' }, 'RATE_INVALID'],
    [{ ptRate: { x: 1 }, gymRate: '0.1' }, 'RATE_INVALID'],
    [{ ptRate: '1.5', gymRate: '0' }, 'RATE_OUT_OF_RANGE'],
    [{ ptRate: '-0.2', gymRate: '1.1' }, 'RATE_OUT_OF_RANGE'],
    [{ ptRate: '0.5', gymRate: '0.1' }, 'RATES_MUST_SUM_TO_ONE'],
    [{ ptRate: '0.95', gymRate: '0', platformRate: '0.05' }, 'PLATFORM_RATE_TOO_LOW'],
  ];
  for (const [body, code] of cases) {
    const r = await propose(body);
    assert.equal(r.status, 400, JSON.stringify(body) + JSON.stringify(r.body));
    assert.equal(r.body.error.code, code, JSON.stringify(body));
    assert.ok(!/Decimal/i.test(JSON.stringify(r.body)));
  }
});

// ── C1-07 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C1-07: legal step validates the Vietnamese tax code (10 or 13 digits) and a real-looking licence number; empty = not entered', async () => {
  const o = await makeOwnerPartner(true);
  const put = (body: Record<string, unknown>) => call(o.token, 'PUT', '/owner/application/legal', body);
  for (const bad of ['ab', '123', '12345678901', '0312345678-12', '03123456789012', '0312345678 001']) {
    const r = await put({ legalName: 'Công ty TNHH Thử', taxCode: bad });
    assert.equal(r.status, 400, bad);
    assert.match(JSON.stringify(r.body), /Mã số thuế/, bad);
  }
  for (const bad of ['x', 'ab', '###-1', 'GIAYPHEP']) {
    const r = await put({ legalName: 'Công ty TNHH Thử', businessLicenseNo: bad });
    assert.equal(r.status, 400, bad);
    assert.match(JSON.stringify(r.body), /giấy phép/, bad);
  }
  const p0 = await prisma.gymPartner.findUniqueOrThrow({ where: { id: o.partner.id } });
  assert.equal(p0.taxCode, null, 'nothing was saved by the refused calls');
  for (const [tax, lic] of [['0312345678', '41A8012345'], ['0312345678-001', '01/GP-KDTM'], ['0312345678001', '']] as const) {
    const r = await put({ legalName: 'Công ty TNHH Thử', taxCode: tax, businessLicenseNo: lic });
    assert.equal(r.status, 200, `${tax} ${lic} ${JSON.stringify(r.body)}`);
  }
  const p1 = await prisma.gymPartner.findUniqueOrThrow({ where: { id: o.partner.id } });
  assert.equal(p1.taxCode, '0312345678001');
  assert.equal(p1.businessLicenseNo, null);
});

// ── C1-11 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C1-11: a revoked staff account gets 403 PARTNER_ACCESS_REVOKED with a Vietnamese message (not the generic PARTNER_CONTEXT_UNRESOLVED)', async () => {
  const o = await operationalOwner();
  const staff = user('GYM_OWNER', 'staff');
  await prisma.gymPartnerAccount.create({
    data: { partnerId: o.partner.id, userId: staff.id, role: 'ACCOUNTANT', scopedGymIds: [], status: 'REVOKED', activatedAt: new Date(), revokedAt: new Date() } as any,
  });
  const r = await call(staff.token, 'GET', '/owner/partner-invitations');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PARTNER_ACCESS_REVOKED');
  assert.equal(r.body.error.message, 'Quyền truy cập của bạn vào phòng gym đã bị thu hồi');
  // an invited-but-not-active account keeps the generic code
  const invited = user('GYM_OWNER', 'invited');
  await prisma.gymPartnerAccount.create({ data: { partnerId: o.partner.id, userId: invited.id, role: 'ACCOUNTANT', scopedGymIds: [], status: 'INVITED' } as any });
  const r2 = await call(invited.token, 'GET', '/owner/partner-invitations');
  assert.equal(r2.status, 403);
  assert.equal(r2.body.error.code, 'PARTNER_CONTEXT_UNRESOLVED');
});

// ── C3-11 ─────────────────────────────────────────────────────────────────────────────────────
integrationTest('C3-11: opening the Add-Branch wizard repeatedly reuses the one UNTOUCHED draft; a touched draft is never reused', async () => {
  const o = await operationalOwner();
  const NEW = { 'x-gymini-listing-flow': '2' };
  const mk = async (headers: Record<string, string> = NEW) => {
    const res = await fetch(`${base}/owner/gyms/draft`, { method: 'POST', headers: { authorization: `Bearer ${o.token}`, ...headers } });
    return ((await res.json()) as any).data.id as string;
  };
  const a = await mk();
  gymIds.push(a);
  assert.equal(await mk(), a, 'second open reuses the empty draft');
  assert.equal(await mk(), a);
  assert.equal(await prisma.gym.count({ where: { ownerId: o.id, status: 'DRAFT' } }), 1);

  const edit = await call(o.token, 'PATCH', `/owner/gyms/${a}/draft`, { name: 'Chi nhánh Quận 1' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const b = await mk();
  gymIds.push(b);
  assert.notEqual(b, a, 'a draft the owner started filling in is not reused');
  assert.equal(await prisma.gym.count({ where: { ownerId: o.id, status: 'DRAFT' } }), 2);
  assert.equal(await mk(), b);

  // an OLD client (no flow header, e.g. the APK) keeps one draft per explicit create - never reuses
  const oldA = await mk({});
  const oldB = await mk({});
  gymIds.push(oldA, oldB);
  assert.notEqual(oldA, oldB);
  assert.ok(![a, b].includes(oldA) && ![a, b].includes(oldB));
});
