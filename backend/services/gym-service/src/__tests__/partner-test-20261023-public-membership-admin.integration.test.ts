/**
 * BACKEND INTEGRATION (REAL HTTP through the real Express routers, auth-service FAKED, isolated *_test DB).
 * Bugs from the 23-24/10/2026 partner test round (_warroom/evidence/partner-test-20261023/BUGS.md):
 *   B44 collaboration lifecycle, B45 reviewer ids hidden, B46 review status codes + closed-branch rules + QR,
 *   B47 client cannot cancel an ACTIVE membership (PENDING_PAYMENT cancel still works) + other-membership warning,
 *   B40 one definition per admin queue, B41 partner role per user id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4073';
process.env.PARTNER_S3_PRIVATE_BUCKET = '';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const USERS: Record<string, { id: string; role: string; email: string; firstName?: string; lastName?: string }> = {};
const NAMES = new Map<string, { firstName: string; lastName: string }>();
function user(role: string, label = role.toLowerCase(), name?: { firstName: string; lastName: string }) {
  const id = randomUUID();
  const token = `tok-${label}-${id.slice(0, 8)}`;
  USERS[token] = { id, role, email: `${id.slice(0, 8)}@b-fixes2.test` };
  if (name) NAMES.set(id, name);
  return { id, token };
}

let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
const partnerIds: string[] = [];
const gymIds: string[] = [];
const brandIds: string[] = [];
const collabIds: string[] = [];

const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test.before(async () => {
  if (!process.env.DATABASE_URL) return;
  authServer = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const u = USERS[token];
      return u ? send(res, 200, { user: u }) : send(res, 401, { error: 'invalid' });
    }
    const m = /^\/auth\/internal\/users\/([^/]+)$/.exec(req.url || '');
    if (req.method === 'GET' && m) {
      const n = NAMES.get(m[1]);
      return n ? send(res, 200, { user: { id: m[1], ...n } }) : send(res, 404, { error: 'no' });
    }
    return send(res, 404, { error: 'not found' });
  });
  await new Promise<void>((r) => authServer.listen(4073, '127.0.0.1', r));

  prisma = (await import('../repositories/prisma')).prisma;
  const app = express();
  app.use(express.json());
  app.use('/', (await import('../routes/public.routes')).default);
  app.use('/', (await import('../routes/client.routes')).default);
  app.use('/admin', (await import('../routes/admin.routes')).default);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  await prisma.gymReview.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymPtCollaboration.deleteMany({ where: { id: { in: collabIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: brandIds } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: brandIds } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
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

async function makeGym(over: Record<string, unknown> = {}) {
  const ownerId = randomUUID();
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'B2 Brand', approvedName: 'B2 Brand' } });
  brandIds.push(brand.id);
  const gym = await prisma.gym.create({
    data: { ownerId, brandId: brand.id, name: 'B2 Gym', address: '1 Test', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'B2 Gym', approvedAddress: '1 Test', ...over },
  });
  gymIds.push(gym.id);
  const plan = await prisma.gymMembershipPlan.create({ data: { brandId: brand.id, name: 'Plan', price: 500_000, durationDays: 30 } });
  return { ownerId, brand, gym, plan };
}

async function membership(gymId: string, planId: string, clientId: string, status: 'ACTIVE' | 'PENDING_PAYMENT') {
  const now = new Date();
  return prisma.gymMembershipContract.create({
    data: {
      gymId, planId, clientId, priceAtPurchase: 500_000, durationDaysSnapshot: 30, status, totalVisits: null, usedVisits: 0,
      ...(status === 'ACTIVE' ? { startDate: now, endDate: new Date(now.getTime() + 30 * 86_400_000) } : {}),
    },
  });
}

// ── B45 + B46 reviews ─────────────────────────────────────────────────────────────────────────

integrationTest('B45: the public review list never exposes a reviewer user id; a logged-in caller gets isMine (+ their own clientId) only on their own review', async () => {
  const g = await makeGym();
  const a = user('CUSTOMER', 'a', { firstName: 'Phạm', lastName: 'Thu' });
  const b = user('CUSTOMER', 'b', { firstName: 'Lê', lastName: 'Minh Quân' });
  await membership(g.gym.id, g.plan.id, a.id, 'ACTIVE');
  await membership(g.gym.id, g.plan.id, b.id, 'ACTIVE');
  assert.equal((await call(a.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 5, comment: 'Tốt' })).status, 201);
  assert.equal((await call(b.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 4 })).status, 201);

  const anon = await call(null, 'GET', `/gyms/${g.gym.id}/reviews`);
  assert.equal(anon.status, 200);
  const raw = JSON.stringify(anon.body);
  assert.ok(!raw.includes(a.id) && !raw.includes(b.id), 'no user id anywhere in the anonymous response');
  assert.ok(!('clientId' in anon.body.data.reviews[0]));
  assert.equal(anon.body.data.count, 2);
  assert.deepEqual(anon.body.data.reviews.map((r: any) => r.isMine), [false, false]);
  assert.deepEqual(anon.body.data.reviews.map((r: any) => r.reviewerName).sort(), ['Lê M. Q.', 'Phạm T.']);

  const asA = await call(a.token, 'GET', `/gyms/${g.gym.id}/reviews`);
  const mine = asA.body.data.reviews.filter((r: any) => r.isMine);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].clientId, a.id, 'own id is returned so apps built before this change still find their review');
  assert.ok(!JSON.stringify(asA.body).includes(b.id));
});

test('B45: reviewerLabel', async () => {
  const { reviewerLabel } = await import('../services/reviewer-label');
  assert.equal(reviewerLabel('Phạm Thu'), 'Phạm T.');
  assert.equal(reviewerLabel('Nguyễn Văn An'), 'Nguyễn V. A.');
  assert.equal(reviewerLabel('Madonna'), 'Madonna');
  assert.equal(reviewerLabel('  '), 'Hội viên');
  assert.equal(reviewerLabel(undefined), 'Hội viên');
});

integrationTest('B46: edit -> 200 (create -> 201); delete without review -> 404 REVIEW_NOT_FOUND; delete -> 200 once', async () => {
  const g = await makeGym();
  const c = user('CUSTOMER', 'rv');
  await membership(g.gym.id, g.plan.id, c.id, 'ACTIVE');
  let r = await call(c.token, 'DELETE', `/gyms/${g.gym.id}/reviews`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'REVIEW_NOT_FOUND');
  r = await call(c.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 3 });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, true);
  r = await call(c.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 5, comment: 'Đã sửa' });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, false);
  assert.equal(r.body.data.rating, 5);
  assert.equal(await prisma.gymReview.count({ where: { gymId: g.gym.id } }), 1);
  assert.equal((await call(c.token, 'DELETE', `/gyms/${g.gym.id}/reviews`)).status, 200);
  assert.equal((await call(c.token, 'DELETE', `/gyms/${g.gym.id}/reviews`)).status, 404);
  r = await call(c.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 9 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_RATING');
});

for (const [label, over] of [
  ['TEMPORARILY_CLOSED', { operationalStatus: 'TEMPORARILY_CLOSED' }],
  ['PERMANENTLY_CLOSED', { operationalStatus: 'PERMANENTLY_CLOSED' }],
  ['SUSPENDED', { status: 'SUSPENDED' }],
  ['PENDING_REVIEW', { status: 'PENDING_REVIEW' }],
] as const) {
  integrationTest(`B46: writing a review is refused for a ${label} branch (409 GYM_NOT_ACCEPTING_REVIEWS); unknown branch 404`, async () => {
    const g = await makeGym(over as any);
    const c = user('CUSTOMER', 'rv2');
    await membership(g.gym.id, g.plan.id, c.id, 'ACTIVE');
    const r = await call(c.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 4 });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'GYM_NOT_ACCEPTING_REVIEWS');
    assert.equal(await prisma.gymReview.count({ where: { gymId: g.gym.id } }), 0);
    const missing = await call(c.token, 'POST', `/gyms/${randomUUID()}/reviews`, { rating: 4 });
    assert.equal(missing.status, 404);
  });
}

integrationTest('B46: a non-member is still 403 NOT_A_MEMBER', async () => {
  const g = await makeGym();
  const c = user('CUSTOMER', 'nm');
  const r = await call(c.token, 'POST', `/gyms/${g.gym.id}/reviews`, { rating: 4 });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'NOT_A_MEMBER');
});

integrationTest('B46: no check-in QR for a branch that is closed / not approved; the open one still gets a token', async () => {
  const { checkinService } = await import('../services/checkin.service');
  const open = await makeGym();
  const closed = await makeGym({ operationalStatus: 'TEMPORARILY_CLOSED' });
  const pending = await makeGym({ status: 'PENDING_REVIEW' });
  const qr = await checkinService.getGymQr(open.gym.id, open.ownerId);
  assert.ok(qr.token);
  for (const x of [closed, pending]) {
    await assert.rejects(checkinService.getGymQr(x.gym.id, x.ownerId), (e: any) => e.status === 409 && e.code === 'GYM_NOT_OPEN');
  }
});

// ── B47 ───────────────────────────────────────────────────────────────────────────────────────

integrationTest('B47: client cannot cancel an ACTIVE membership (409 MEMBERSHIP_CANCEL_DISABLED, stays ACTIVE); a PENDING_PAYMENT purchase can still be cancelled', async () => {
  const g = await makeGym();
  const c = user('CUSTOMER', 'cn');
  const active = await membership(g.gym.id, g.plan.id, c.id, 'ACTIVE');
  const other = await makeGym();
  const pending = await membership(other.gym.id, other.plan.id, c.id, 'PENDING_PAYMENT');

  let r = await call(c.token, 'POST', `/me/gym-memberships/${active.id}/cancel-membership`);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'MEMBERSHIP_CANCEL_DISABLED');
  assert.match(r.body.error.message, /chưa hỗ trợ/);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: active.id } })).status, 'ACTIVE');

  r = await call(c.token, 'POST', `/me/gym-memberships/${pending.id}/cancel`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: pending.id } })).status, 'CANCELLED');

  // somebody else's membership is still not theirs to touch
  const stranger = user('CUSTOMER', 'st');
  assert.equal((await call(stranger.token, 'POST', `/me/gym-memberships/${active.id}/cancel-membership`)).status, 403);
});

integrationTest('B47: GET /gyms/:gymId/membership-warnings lists the active memberships held at OTHER gyms (purchase itself stays allowed)', async () => {
  const a = await makeGym();
  const b = await makeGym();
  const c = user('CUSTOMER', 'wn');
  assert.deepEqual((await call(c.token, 'GET', `/gyms/${b.gym.id}/membership-warnings`)).body.data, []);
  await membership(a.gym.id, a.plan.id, c.id, 'ACTIVE');
  const r = await call(c.token, 'GET', `/gyms/${b.gym.id}/membership-warnings`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].gymId, a.gym.id);
  assert.equal(r.body.data[0].gymName, 'B2 Gym');
  assert.ok(r.body.data[0].endDate);
  assert.deepEqual((await call(c.token, 'GET', `/gyms/${a.gym.id}/membership-warnings`)).body.data, [], 'not warned about the gym being bought at');
});

// ── B44 ───────────────────────────────────────────────────────────────────────────────────────

test('B44: collaborationLifecycleOf derives TERMINATING without touching status', async () => {
  const { collaborationLifecycleOf, withCollaborationLifecycle } = await import('../services/collaboration-lifecycle');
  const eff = new Date(Date.now() + 5 * 86_400_000);
  assert.equal(collaborationLifecycleOf({ status: 'ACCEPTED' }), 'ACTIVE');
  assert.equal(collaborationLifecycleOf({ status: 'ACCEPTED', terminationInitiatedAt: new Date(), effectiveAt: eff }), 'TERMINATING');
  assert.equal(collaborationLifecycleOf({ status: 'TERMINATED', effectiveAt: eff }), 'TERMINATED');
  assert.equal(collaborationLifecycleOf({ status: 'PENDING' }), 'PENDING');
  const v = withCollaborationLifecycle({ status: 'ACCEPTED' as const, terminationInitiatedAt: new Date(), effectiveAt: eff });
  assert.equal(v.status, 'ACCEPTED');
  assert.equal(v.terminationEffectiveAt, eff);
});

integrationTest('B44: listFor (owner and PT view) and terminate() return lifecycle ACTIVE -> TERMINATING + terminationEffectiveAt, status stays ACCEPTED', async () => {
  const { collaborationService } = await import('../services/collaboration.service');
  const { withCollaborationLifecycle } = await import('../services/collaboration-lifecycle');
  const g = await makeGym({ brandId: null });
  const ptUserId = randomUUID();
  const row = await prisma.gymPtCollaboration.create({
    data: { gymId: g.gym.id, ptUserId, proposedPtRate: '0.6', proposedGymRate: '0.3', platformRate: '0.1', status: 'ACCEPTED', proposedBy: 'PT', expiresAt: new Date(Date.now() + 86_400_000), acceptedAt: new Date() },
  });
  collabIds.push(row.id);

  const before = (await collaborationService.listFor({ ownerId: g.ownerId })).find((x: any) => x.id === row.id) as any;
  assert.equal(before.lifecycle, 'ACTIVE');
  assert.equal(before.terminationEffectiveAt, null);

  const eff = new Date(Date.now() + 10 * 86_400_000);
  const terminated = withCollaborationLifecycle(await collaborationService.terminate(row.id, 'GYM', g.ownerId, eff) as any);
  assert.equal(terminated.status, 'ACCEPTED');
  assert.equal(terminated.lifecycle, 'TERMINATING');
  assert.equal(new Date(terminated.terminationEffectiveAt!).getTime(), eff.getTime());

  for (const view of [{ ownerId: g.ownerId }, { ptUserId }]) {
    const after = (await collaborationService.listFor(view)).find((x: any) => x.id === row.id) as any;
    assert.equal(after.status, 'ACCEPTED');
    assert.equal(after.lifecycle, 'TERMINATING');
    assert.equal(new Date(after.terminationEffectiveAt).getTime(), eff.getTime());
  }
});

// ── B40 ───────────────────────────────────────────────────────────────────────────────────────

const mkPartner = async (over: Record<string, unknown>) => {
  const p = await prisma.gymPartner.create({
    data: { legalName: `B40 ${randomUUID().slice(0, 8)}`, contactEmail: `${randomUUID().slice(0, 8)}@b40.test`, ...(over as any) },
  });
  partnerIds.push(p.id);
  return p;
};

integrationTest('B40: every queue number comes from one definition - applications = submitted & undecided (== applications list counts.IN_REVIEW), branches/brand names ignore non-requests', async () => {
  const { partnerDiligenceService } = await import('../services/partner-diligence.service');
  const { partnerApplicationReviewService } = await import('../services/partner-application-review.service');
  const before: any = await partnerDiligenceService.queue();
  const beforeApps = (await partnerApplicationReviewService.listApplications()).counts as Record<string, number>;

  // applications: 2 submitted (IN_REVIEW), 1 still filling (NOT_VERIFIED), 1 sent back (NEEDS_INFO), 1 rejected, 1 legacy admin-created prospect
  await mkPartner({ source: 'SELF_SERVICE', status: 'PROSPECT', verificationStatus: 'IN_REVIEW' });
  await mkPartner({ source: 'SELF_SERVICE', status: 'PROSPECT', verificationStatus: 'IN_REVIEW' });
  await mkPartner({ source: 'SELF_SERVICE', status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' });
  await mkPartner({ source: 'SELF_SERVICE', status: 'PROSPECT', verificationStatus: 'NEEDS_INFO' });
  await mkPartner({ source: 'SELF_SERVICE', status: 'PROSPECT', verificationStatus: 'REJECTED', rejectedAt: new Date() });
  await mkPartner({ source: 'ADMIN_CREATED', status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' });

  // branches: 1 first approval; 1 approved branch with a REAL rename; 1 approved branch whose pending == live (no request); 1 draft with a pending name
  const owner = randomUUID();
  const brand = await prisma.gymBrand.create({ data: { ownerId: owner, name: 'Q Brand', approvedName: 'Q Brand', pendingName: 'Q Brand Mới' } });
  const sameBrand = await prisma.gymBrand.create({ data: { ownerId: randomUUID(), name: 'Same', approvedName: 'Same', pendingName: 'Same' } });
  brandIds.push(brand.id, sameBrand.id);
  const mkGym = async (over: Record<string, unknown>) => {
    const g = await prisma.gym.create({ data: { ownerId: owner, brandId: brand.id, name: 'Q', address: '1 Q', ...(over as any) } });
    gymIds.push(g.id);
  };
  await mkGym({ status: 'PENDING_REVIEW', pendingName: 'Q first' });
  await mkGym({ status: 'APPROVED', approvedName: 'Q live', pendingName: 'Q renamed', approvedAddress: '1 Q' });
  await mkGym({ status: 'APPROVED', approvedName: 'Q same', pendingName: 'Q same', approvedAddress: '1 Q' });
  await mkGym({ status: 'DRAFT', pendingName: 'Q draft' });

  const after: any = await partnerDiligenceService.queue();
  const afterApps = (await partnerApplicationReviewService.listApplications()).counts as Record<string, number>;

  assert.equal(after.applicationsAwaitingReview - before.applicationsAwaitingReview, 2);
  assert.equal(after.applicationsAwaitingReview, afterApps.IN_REVIEW ?? 0, 'same number as the applications list the "Duyệt" screen reads');
  assert.equal(beforeApps.IN_REVIEW ?? 0, before.applicationsAwaitingReview);
  assert.equal(after.pendingProspects, after.applicationsAwaitingReview, 'old key now carries the same definition');
  assert.equal(after.applicationsWaitingApplicant - before.applicationsWaitingApplicant, 1);
  assert.equal(after.pendingLegacyProspects - before.pendingLegacyProspects, 1);
  assert.equal(after.branchesFirstApproval - before.branchesFirstApproval, 1);
  assert.equal(after.pendingGyms, after.branchesFirstApproval);
  assert.equal(after.branchRenames - before.branchRenames, 1);
  assert.equal(after.branchesToReview - before.branchesToReview, 2);
  assert.equal(after.brandRenames - before.brandRenames, 1, 'a pendingName equal to the approved name is not a request');
  assert.equal(after.pendingBrandRenames, after.brandRenames);

  const overview: any = await partnerDiligenceService.overviewStats();
  assert.equal(overview.pendingBranches, overview.needsAttention.branchesFirstApproval);
});

// ── B41 ───────────────────────────────────────────────────────────────────────────────────────

integrationTest('B41: GET /admin/partner-accounts/roles returns the partner role per user id (admin only)', async () => {
  const admin = user('ADMIN', 'adm');
  const p = await mkPartner({ status: 'ACTIVE', verificationStatus: 'VERIFIED', legalName: 'B41 Co' });
  const owner = randomUUID();
  const recep = randomUUID();
  const acct = randomUUID(); // legacy-looking: no partner account
  await prisma.gymPartnerAccount.create({ data: { partnerId: p.id, userId: owner, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date() } });
  const brand = await prisma.gymBrand.create({ data: { ownerId: owner, name: 'B41' } });
  brandIds.push(brand.id);
  const gym = await prisma.gym.create({ data: { ownerId: owner, brandId: brand.id, name: 'B41 G', address: 'x' } });
  gymIds.push(gym.id);
  await prisma.gymPartnerAccount.create({ data: { partnerId: p.id, userId: recep, role: 'RECEPTIONIST', scopedGymIds: [gym.id], status: 'ACTIVE', activatedAt: new Date() } });

  const r = await call(admin.token, 'GET', `/admin/partner-accounts/roles?userIds=${owner},${recep},${acct},${recep}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    r.body.data.map((x: any) => [x.userId, x.partnerRole, x.partnerName]),
    [[owner, 'OWNER', 'B41 Co'], [recep, 'RECEPTIONIST', 'B41 Co'], [acct, null, null]],
  );

  assert.equal((await call(admin.token, 'GET', '/admin/partner-accounts/roles')).status, 400);
  assert.equal((await call(admin.token, 'GET', `/admin/partner-accounts/roles?userIds=${Array.from({ length: 201 }, () => randomUUID()).join(',')}`)).status, 400);
  const cust = user('CUSTOMER', 'c41');
  assert.equal((await call(cust.token, 'GET', `/admin/partner-accounts/roles?userIds=${owner}`)).status, 403);
  assert.equal((await call(null, 'GET', `/admin/partner-accounts/roles?userIds=${owner}`)).status, 401);
});
