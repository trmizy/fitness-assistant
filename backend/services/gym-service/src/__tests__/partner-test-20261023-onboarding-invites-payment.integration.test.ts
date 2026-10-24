/**
 * BACKEND INTEGRATION (REAL HTTP through the real Express routers, auth-service and payment-service FAKED, isolated *_test DB).
 * Bugs from the 23-24/10/2026 partner test round (_warroom/evidence/partner-test-20261023/BUGS.md):
 *   B09 payout only after approval + audit of every change, B13 admin note hidden on reject, B10 staff invitation checks,
 *   B11 accept-invitation error propagation, B24 payment error code kept, B25 human payment description.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4071';
process.env.PAYMENT_SERVICE_URL = 'http://127.0.0.1:4072';
process.env.USER_SERVICE_URL = 'http://127.0.0.1:4074';
process.env.PARTNER_S3_PRIVATE_BUCKET = '';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const USERS: Record<string, { id: string; role: string; email: string }> = {};
function user(role: string, label = role.toLowerCase()) {
  const id = randomUUID();
  const token = `tok-${label}-${id.slice(0, 8)}`;
  USERS[token] = { id, role, email: `${id.slice(0, 8)}@b-fixes.test` };
  return { id, token };
}

let authServer: http.Server;
let paymentServer: http.Server;
let userServer: http.Server;
const notifications: any[] = [];
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
const partnerIds: string[] = [];
const gymIds: string[] = [];
const brandIds: string[] = [];
const checkoutBodies: any[] = [];

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
    if (req.method === 'POST' && req.url === '/auth/internal/partner-auth/email-status') {
      const body = await readBody(req);
      const e = String(body.email);
      if (e.startsWith('cust-')) return send(res, 200, { exists: true, role: 'CUSTOMER' });
      if (e.startsWith('pt-')) return send(res, 200, { exists: true, role: 'PT' });
      if (e.startsWith('adm-')) return send(res, 200, { exists: true, role: 'ADMIN' });
      if (e.startsWith('own-')) return send(res, 200, { exists: true, role: 'GYM_OWNER' });
      if (e.startsWith('down-')) return send(res, 503, { error: 'down' });
      return send(res, 200, { exists: false, role: null });
    }
    if (req.method === 'POST' && req.url === '/auth/internal/partner-auth/create-invited-account') {
      const body = await readBody(req);
      if (String(body.email).startsWith('taken')) return send(res, 409, { error: 'Email đã được sử dụng' });
      if (body.password === 'password1') return send(res, 400, { error: 'Mật khẩu quá yếu, hãy thêm chữ hoa và số' });
      return send(res, 201, { user: { id: randomUUID(), email: body.email, firstName: body.firstName, lastName: null, role: 'GYM_OWNER' } });
    }
    return send(res, 404, { error: 'not found' });
  });
  await new Promise<void>((r) => authServer.listen(4071, '127.0.0.1', r));

  paymentServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/internal/payments/checkout') {
      const body = await readBody(req);
      checkoutBodies.push(body);
      if (body.provider === 'ZALOPAY') return send(res, 400, { success: false, error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'PROVIDER_NOT_CONFIGURED' } });
      if (body.provider === 'MOMO') return send(res, 502, { success: false, error: { code: 'GATEWAY_ERROR', message: 'Cổng MoMo từ chối' } });
      return send(res, 200, { success: true, data: { transactionId: randomUUID(), status: 'PENDING', redirectUrl: 'https://pay.test/x', qrCodeUrl: null, provider: 'MOCK' } });
    }
    return send(res, 404, {});
  });
  await new Promise<void>((r) => paymentServer.listen(4072, '127.0.0.1', r));

  userServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/internal/notifications') {
      notifications.push(await readBody(req));
      return send(res, 201, { success: true });
    }
    return send(res, 404, {});
  });
  await new Promise<void>((r) => userServer.listen(4074, '127.0.0.1', r));

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
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: brandIds } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: brandIds } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, paymentServer, userServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
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

type Applicant = 'ONBOARDING' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'REJECTED' | 'APPROVED_PAYOUT_PENDING' | 'ACTIVE' | 'SUSPENDED';
async function makeOwnerPartner(state: Applicant, extra: Record<string, unknown> = {}) {
  const u = user('GYM_OWNER', 'owner');
  const partnerState: Record<Applicant, Record<string, unknown>> = {
    ONBOARDING: { status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' },
    UNDER_REVIEW: { status: 'PROSPECT', verificationStatus: 'IN_REVIEW', submittedAt: new Date() },
    CHANGES_REQUESTED: { status: 'PROSPECT', verificationStatus: 'NEEDS_INFO', verificationNotes: '[BRANCH] Thiếu ảnh biển hiệu' },
    REJECTED: { status: 'PROSPECT', verificationStatus: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'Giấy phép không hợp lệ', verificationNotes: 'NOTE-NOI-BO-ADMIN: nghi ngờ gian lận' },
    APPROVED_PAYOUT_PENDING: { status: 'ACTIVE', verificationStatus: 'VERIFIED' },
    ACTIVE: { status: 'ACTIVE', verificationStatus: 'VERIFIED' },
    SUSPENDED: { status: 'SUSPENDED', verificationStatus: 'VERIFIED' },
  };
  const partner = await prisma.gymPartner.create({
    data: {
      legalName: `B-fixes ${randomUUID().slice(0, 8)}`,
      contactEmail: USERS[u.token].email,
      source: 'SELF_SERVICE',
      ...(partnerState[state] as any),
      ...extra,
    },
  });
  partnerIds.push(partner.id);
  const account = await prisma.gymPartnerAccount.create({
    data: {
      partnerId: partner.id,
      userId: u.id,
      role: 'OWNER',
      scopedGymIds: [],
      status: 'ACTIVE',
      activatedAt: new Date(),
      onboardingCompletedAt: state === 'ACTIVE' || state === 'SUSPENDED' ? new Date() : null,
    },
  });
  return { ...u, partner, account };
}

const PAYOUT = { bankName: 'VCB', accountNumber: '0011223344', accountHolder: 'NGUYEN VAN A' };
const payoutLogs = async (partnerId: string) =>
  (await prisma.partnerAuditLog.findMany({ where: { partnerId, action: 'PARTNER_UPDATED' }, orderBy: { createdAt: 'asc' } })).filter(
    (r) => (r.metadata as any)?.field === 'payoutBank',
  );

// ── B09 ───────────────────────────────────────────────────────────────────────────────────────

for (const state of ['ONBOARDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'] as const) {
  integrationTest(`B09: applicant (${state}) cannot declare payout - 403 PAYOUT_REQUIRES_APPROVAL, nothing saved, no audit; contact still works`, async () => {
    const o = await makeOwnerPartner(state);
    const r = await call(o.token, 'PATCH', '/owner/onboarding/payout', PAYOUT);
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'PAYOUT_REQUIRES_APPROVAL');
    assert.match(r.body.error.message, /duyệt/);
    const p = await prisma.gymPartner.findUniqueOrThrow({ where: { id: o.partner.id } });
    assert.equal(p.payoutBankAccountNumber, null);
    assert.equal((await payoutLogs(o.partner.id)).length, 0);
    // the applicant wizard's own steps are untouched
    const c = await call(o.token, 'PATCH', '/owner/onboarding/contact', { phone: '0901234567' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await prisma.gymPartnerAccount.findUniqueOrThrow({ where: { id: o.account.id } })).onboardingCompletedAt, null, 'still not onboarded');
  });
}

integrationTest('B09: SUSPENDED partner gets PAYOUT_NOT_AVAILABLE', async () => {
  const o = await makeOwnerPartner('SUSPENDED');
  const r = await call(o.token, 'PATCH', '/owner/onboarding/payout', PAYOUT);
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PAYOUT_NOT_AVAILABLE');
});

integrationTest('B09: approved owner declares payout -> 200 + audit(firstTime); change -> second audit; same again -> no new row; full number never logged', async () => {
  const o = await makeOwnerPartner('APPROVED_PAYOUT_PENDING');
  let r = await call(o.token, 'PATCH', '/owner/onboarding/payout', PAYOUT);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let logs = await payoutLogs(o.partner.id);
  assert.equal(logs.length, 1);
  assert.deepEqual(
    { last4: (logs[0].metadata as any).last4, prev: (logs[0].metadata as any).previousLast4, firstTime: (logs[0].metadata as any).firstTime },
    { last4: '3344', prev: null, firstTime: true },
  );
  assert.equal(logs[0].actorUserId, o.id);

  r = await call(o.token, 'PATCH', '/owner/onboarding/payout', { ...PAYOUT, accountNumber: '9988776655' });
  assert.equal(r.status, 200);
  r = await call(o.token, 'PATCH', '/owner/onboarding/payout', { ...PAYOUT, accountNumber: '9988776655' });
  assert.equal(r.status, 200);
  // only the holder changes -> still a change
  r = await call(o.token, 'PATCH', '/owner/onboarding/payout', { ...PAYOUT, accountNumber: '9988776655', accountHolder: 'TRAN THI B' });
  assert.equal(r.status, 200);
  logs = await payoutLogs(o.partner.id);
  assert.equal(logs.length, 3, 'first + number change + holder change; the identical repeat adds nothing');
  assert.equal((logs[1].metadata as any).previousLast4, '3344');
  assert.ok(!JSON.stringify(logs.map((l) => l.metadata)).includes('9988776655'), 'the full account number is never stored in the audit log');
});

// ── B13 ───────────────────────────────────────────────────────────────────────────────────────

integrationTest('B13: a rejected applicant sees the rejection reason but never the admin internal note (application + timeline)', async () => {
  const { partnerApplicationService } = await import('../services/partner-application.service');
  const o = await makeOwnerPartner('REJECTED');
  const ctx = {
    partnerId: o.partner.id,
    accountId: o.account.id,
    principalUserId: o.id,
    role: 'OWNER' as const,
    scopedGymIds: [],
    partnerStatus: 'PROSPECT' as const,
    verificationStatus: 'REJECTED' as const,
    accountStatus: 'ACTIVE' as const,
    onboardingCompletedAt: null,
    isLegacy: false,
  };
  const app: any = await partnerApplicationService.getApplication(ctx as any);
  assert.equal(app.accessState, 'REJECTED');
  assert.equal(app.partner.rejectionReason, 'Giấy phép không hợp lệ');
  assert.equal(app.partner.adminNote, null);
  assert.ok(!JSON.stringify(app).includes('NOTE-NOI-BO-ADMIN'), 'internal note must not appear anywhere in the applicant view');
  const timeline = await partnerApplicationService.getTimeline(ctx as any, o.id);
  assert.ok(!JSON.stringify(timeline).includes('NOTE-NOI-BO-ADMIN'));
});

integrationTest('B13: the changes-requested summary is still shown to the applicant (it is written for them)', async () => {
  const { partnerApplicationService } = await import('../services/partner-application.service');
  const o = await makeOwnerPartner('CHANGES_REQUESTED');
  const ctx = {
    partnerId: o.partner.id, accountId: o.account.id, principalUserId: o.id, role: 'OWNER' as const, scopedGymIds: [],
    partnerStatus: 'PROSPECT' as const, verificationStatus: 'NEEDS_INFO' as const, accountStatus: 'ACTIVE' as const,
    onboardingCompletedAt: null, isLegacy: false,
  };
  const app: any = await partnerApplicationService.getApplication(ctx as any);
  assert.match(app.partner.adminNote, /Thiếu ảnh biển hiệu/);
});

// ── B14 ───────────────────────────────────────────────────────────────────────────────────────

integrationTest('B14: rejecting an application sends an in-app notification to the applicant (reason only, no admin note) after the commit', async () => {
  const { partnerApplicationReviewService } = await import('../services/partner-application-review.service');
  const o = await makeOwnerPartner('UNDER_REVIEW');
  notifications.length = 0;
  await partnerApplicationReviewService.reject(o.partner.id, randomUUID(), 'Giấy phép không hợp lệ', 'NOTE-NOI-BO-ADMIN');
  for (let i = 0; i < 50 && notifications.length === 0; i++) await new Promise((r) => setTimeout(r, 40));
  assert.equal(notifications.length, 1);
  const n = notifications[0];
  assert.equal(n.userId, o.id);
  assert.equal(n.eventType, 'GYM_PARTNER_APPLICATION_REJECTED');
  assert.equal(n.entityType, 'GYM_PARTNER_APPLICATION');
  assert.equal(n.entityId, o.partner.id);
  assert.equal(n.link, '/partner/application');
  assert.equal(n.text, 'Hồ sơ đối tác phòng gym của bạn chưa được duyệt. Lý do: Giấy phép không hợp lệ');
  assert.ok(!JSON.stringify(n).includes('NOTE-NOI-BO-ADMIN'));
  assert.equal((await prisma.gymPartner.findUniqueOrThrow({ where: { id: o.partner.id } })).verificationStatus, 'REJECTED');
});

integrationTest('B14: a notification failure never undoes the rejection', async () => {
  const { partnerApplicationReviewService } = await import('../services/partner-application-review.service');
  const o = await makeOwnerPartner('UNDER_REVIEW');
  await new Promise<void>((r) => userServer.close(() => r()));
  try {
    const res = await partnerApplicationReviewService.reject(o.partner.id, randomUUID(), 'Không đủ điều kiện');
    assert.deepEqual(res, { ok: true });
    assert.equal((await prisma.gymPartner.findUniqueOrThrow({ where: { id: o.partner.id } })).verificationStatus, 'REJECTED');
  } finally {
    await new Promise<void>((r) => userServer.listen(4074, '127.0.0.1', r));
  }
});

// ── B10 / B11 ─────────────────────────────────────────────────────────────────────────────────

async function operationalOwner() {
  const o = await makeOwnerPartner('ACTIVE');
  const brand = await prisma.gymBrand.create({ data: { ownerId: o.id, name: 'B10 Brand', approvedName: 'B10 Brand' } });
  brandIds.push(brand.id);
  const gym = await prisma.gym.create({
    data: { ownerId: o.id, brandId: brand.id, name: 'B10 Gym', address: '1 Test', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'B10 Gym', approvedAddress: '1 Test' },
  });
  gymIds.push(gym.id);
  return { ...o, brand, gym };
}
const invite = (o: { token: string; gym: { id: string } }, email: string, role = 'RECEPTIONIST') =>
  call(o.token, 'POST', '/owner/partner-invitations', { email, role, scopedGymIds: [o.gym.id] });

integrationTest('B10: staff invitation validates the email format (400 INVALID_EMAIL, nothing created)', async () => {
  const o = await operationalOwner();
  for (const bad of ['nope', 'a@b', 'a b@c.vn', '@c.vn', 'a@@c.vn']) {
    const r = await invite(o, bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error.code, 'INVALID_EMAIL', bad);
  }
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: o.partner.id } }), 0);
});

integrationTest('B10: a second PENDING invite for the same email is refused (409 INVITATION_ALREADY_PENDING); two simultaneous requests create exactly one', async () => {
  const o = await operationalOwner();
  const email = `staff-${randomUUID().slice(0, 8)}@b-fixes.test`;
  const [a, b] = await Promise.all([invite(o, email), invite(o, email.toUpperCase())]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const lost = a.status === 409 ? a : b;
  assert.equal(lost.body.error.code, 'INVITATION_ALREADY_PENDING');
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: o.partner.id, email, status: 'PENDING' } }), 1);

  const again = await invite(o, email);
  assert.equal(again.status, 409);
  assert.match(again.body.error.message, /Gửi lại/);
});

integrationTest('B10: an email already accepted in this partner -> ALREADY_PARTNER_MEMBER; accepted anywhere else -> EMAIL_IN_USE; an expired pending invite does not block', async () => {
  const o = await operationalOwner();
  const other = await makeOwnerPartner('ACTIVE');
  const mine = `member-${randomUUID().slice(0, 8)}@b-fixes.test`;
  const theirs = `elsewhere-${randomUUID().slice(0, 8)}@b-fixes.test`;
  const stale = `stale-${randomUUID().slice(0, 8)}@b-fixes.test`;
  const mk = (partnerId: string, email: string, status: 'ACCEPTED' | 'PENDING', expiresAt: Date) =>
    prisma.partnerInvitation.create({
      data: { partnerId, email, role: 'RECEPTIONIST', scopedGymIds: [], tokenHash: randomUUID(), expiresAt, status },
    });
  const future = new Date(Date.now() + 86_400_000);
  await mk(o.partner.id, mine, 'ACCEPTED', future);
  await mk(other.partner.id, theirs, 'ACCEPTED', future);
  const old = await mk(o.partner.id, stale, 'PENDING', new Date(Date.now() - 86_400_000));

  let r = await invite(o, mine);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ALREADY_PARTNER_MEMBER');
  r = await invite(o, theirs);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'EMAIL_IN_USE');
  r = await invite(o, stale);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await prisma.partnerInvitation.findUniqueOrThrow({ where: { id: old.id } })).status, 'EXPIRED');
});

integrationTest('B10: email of a customer / PT / admin account -> 409 EMAIL_IN_USE, nothing created; GYM_OWNER defers to partner checks; auth-service down does not block', async () => {
  const o = await operationalOwner();
  const id = randomUUID().slice(0, 8);
  for (const prefix of ['cust-', 'pt-', 'adm-']) {
    const r = await invite(o, `${prefix}${id}@b-fixes.test`);
    assert.equal(r.status, 409, prefix);
    assert.equal(r.body.error.code, 'EMAIL_IN_USE', prefix);
    assert.match(r.body.error.message, /tài khoản Gymini khác/);
  }
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: o.partner.id } }), 0);
  assert.equal((await invite(o, `own-${id}@b-fixes.test`)).status, 201, 'GYM_OWNER email is not refused by this check');
  assert.equal((await invite(o, `down-${id}@b-fixes.test`)).status, 201, 'auth-service error must not block the invite');
});

async function pendingInvitationFor(partnerId: string, email: string) {
  const { partnerInvitationService } = await import('../services/partner-invitation.service');
  const { rawToken } = await partnerInvitationService.createInvitation({ partnerId, email, role: 'RECEPTIONIST', scopedGymIds: ['gym-x'], createdBy: 'x' });
  return rawToken;
}

integrationTest('B11: accept-invitation errors are propagated in Vietnamese with a code, never "Request failed with status code 400"', async () => {
  const o = await operationalOwner();
  const accept = (token: string, body: unknown) => call(null, 'POST', `/partner-invitations/${token}/accept`, body);
  const t1 = await pendingInvitationFor(o.partner.id, `acc-${randomUUID().slice(0, 8)}@b-fixes.test`);

  // too short: refused locally before auth-service is asked
  let r = await accept(t1, { password: 'abc', firstName: 'An' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'WEAK_PASSWORD');
  assert.match(r.body.error.message, /ít nhất 8 ký tự/);

  // auth-service refuses a longer-but-weak password: its own message comes through
  r = await accept(t1, { password: 'password1', firstName: 'An' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'WEAK_PASSWORD');
  assert.equal(r.body.error.message, 'Mật khẩu quá yếu, hãy thêm chữ hoa và số');
  assert.ok(!/status code/i.test(JSON.stringify(r.body)));

  // email already has an account
  const t2 = await pendingInvitationFor(o.partner.id, `taken-${randomUUID().slice(0, 8)}@b-fixes.test`);
  r = await accept(t2, { password: 'Str0ng!Pass', firstName: 'An' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'EMAIL_IN_USE');
  assert.match(r.body.error.message, /Email này đã có tài khoản/);
  assert.equal((await prisma.partnerInvitation.findFirstOrThrow({ where: { partnerId: o.partner.id, email: { startsWith: 'taken-' } } })).status, 'PENDING', 'the invitation stays usable');

  // happy path
  r = await accept(t1, { password: 'Str0ng!Pass', firstName: 'An' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.role, 'RECEPTIONIST');
});

// ── B24 / B25 ─────────────────────────────────────────────────────────────────────────────────

integrationTest('B24 + B25: payment-service error code/status survive purchase AND retry-pay; the gateway description is plan + branch, no id', async () => {
  const o = await operationalOwner();
  const plan = await prisma.gymMembershipPlan.create({ data: { brandId: o.brand.id, name: 'Gói 3 tháng', price: 900_000, durationDays: 90 } });
  const c = user('CUSTOMER', 'cust');
  checkoutBodies.length = 0;

  // B24 purchase: 400 PROVIDER_NOT_CONFIGURED (message was just the code upstream -> Vietnamese fallback)
  let r = await call(c.token, 'POST', `/gyms/${o.gym.id}/memberships`, { planId: plan.id, provider: 'zalopay' });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'PROVIDER_NOT_CONFIGURED');
  assert.match(r.body.error.message, /chọn cổng thanh toán khác/);

  // the PENDING_PAYMENT row exists; retry-pay with a gateway that errors keeps status 502 + code + upstream message
  const pending = await prisma.gymMembershipContract.findFirstOrThrow({ where: { gymId: o.gym.id, clientId: c.id } });
  r = await call(c.token, 'POST', `/me/gym-memberships/${pending.id}/pay`, { provider: 'momo' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'GATEWAY_ERROR');
  assert.equal(r.body.error.message, 'Cổng MoMo từ chối');

  // success path: orderInfo is human, with no uuid
  checkoutBodies.length = 0;
  r = await call(c.token, 'POST', `/me/gym-memberships/${pending.id}/pay`, { provider: 'mock' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(checkoutBodies.length, 1);
  const info: string = checkoutBodies[0].orderInfo;
  assert.equal(info, 'Gói hội viên Gói 3 tháng - B10 Gym');
  assert.ok(!info.includes(pending.id) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(info), 'no internal id in the description');
  assert.ok(info.length <= 100);
});

test('B25: membershipOrderInfo is cut to 100 characters and degrades gracefully', async () => {
  const { membershipOrderInfo } = await import('../services/membership.service');
  assert.equal(membershipOrderInfo(undefined, undefined), 'Gói hội viên');
  assert.equal(membershipOrderInfo('Gói tháng', null), 'Gói hội viên Gói tháng');
  assert.equal(membershipOrderInfo('X'.repeat(200), 'Y').length, 100);
});
