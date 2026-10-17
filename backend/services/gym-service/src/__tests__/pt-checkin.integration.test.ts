/**
 * Phase 2 / P2.2 - PT QR check-in in gym-service (decisions D16, D17, D70).
 *
 * Evidence labels:
 *   REAL HTTP/API + BACKEND INTEGRATION - the real gym-service routers (client + owner) mounted on a real
 *     Express server, real Prisma/SQL on an isolated `*_test` database (see test-db-guard.ts), real
 *     axios calls through the real `userClient`.
 *   TEST FIXTURE - user-service (P2.1) and auth-service are stand-in HTTP servers that answer the
 *     agreed contract; a later slice runs gym + user for real. Sessions/contracts are fixtures, not
 *     the product's booking flow.
 * The suite refuses to run (all SKIPPED) unless DATABASE_URL names a database ending in `_test`.
 *
 * Covers: qualifying session -> 200 + one row; no session / restricted / banned / not-a-PT -> 403
 * (typed codes, no row); wrong role; invalid + expired token; closed branch + suspended gym refused
 * exactly like members; user-service 500 / 404 / timeout / dead / malformed -> 503 and NO row;
 * re-scan -> same row, scan_count 2; 10 concurrent scans -> 1 row, all 200, same id; Q-B (moved
 * session cannot qualify a second day; midnight-spanning session counts on both days); local-day
 * boundary 23:59:59 vs 00:00:01 (+07:00); a PT who is also a member -> no visit deducted, no
 * GymCheckIn; gym-service sends ONLY reads to user-service; owner list has no client fields;
 * the member path now answers GYM_NOT_ACTIVE with a code (was message-only).
 */
import nodeTest from 'node:test';
import { guardedTest as test } from './test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';

const SECRET = 'p2-2-test-internal-secret-32-chars-minimum';
process.env.INTERNAL_SERVICE_SECRET = SECRET;
delete process.env.CHECKIN_TOKEN_SECRET;
delete process.env.USER_LAMBDA_NAME;

const HOUR = 3600 * 1000;

const OWNER = randomUUID();
const OTHER_OWNER = randomUUID();
const PT = randomUUID();
const PT2 = randomUUID();
const PT_MEMBER = randomUUID();
const CUSTOMER = randomUUID();
const USERS: Record<string, { id: string; role: string; email: string }> = {
  'tok-owner': { id: OWNER, role: 'GYM_OWNER', email: 'owner@p22.test' },
  'tok-other-owner': { id: OTHER_OWNER, role: 'GYM_OWNER', email: 'other-owner@p22.test' },
  'tok-pt': { id: PT, role: 'PT', email: 'pt@p22.test' },
  'tok-pt2': { id: PT2, role: 'PT', email: 'pt2@p22.test' },
  'tok-pt-member': { id: PT_MEMBER, role: 'PT', email: 'ptm@p22.test' },
  'tok-customer': { id: CUSTOMER, role: 'CUSTOMER', email: 'c@p22.test' },
};

// ---------------------------------------------------------------- stand-in services (TEST FIXTURE)
interface UserSvcCall { method: string; path: string; query: URLSearchParams; secret: string | undefined }
type UserSvcReply =
  | { kind: 'json'; status?: number; body: unknown }
  | { kind: 'delay'; ms: number; body: unknown }
  | { kind: 'destroy' };

let userSvc: http.Server;
let authSvc: http.Server;
let appServer: http.Server;
let base = '';
const userSvcCalls: UserSvcCall[] = [];
/** What the stand-in user-service answers; tests replace it. Receives the requested [from, to). */
let userSvcAnswer: (ptUserId: string, from: Date, to: Date) => UserSvcReply = () => ({ kind: 'destroy' });

const noSessions = { ptActive: true, ptBlockedReason: null, sessions: [] as unknown[] };
const session = (id: string, contractId: string, start: Date, end: Date) => ({
  sessionId: id,
  contractId,
  status: 'CONFIRMED',
  scheduledStartAt: start.toISOString(),
  scheduledEndAt: end.toISOString(),
});
/** One confirmed session in the middle of the requested day. */
const middayAnswer = (sessionId = 'sess-1', contractId = 'ctr-1') => (ptUserId: string, from: Date, _to?: Date): UserSvcReply => ({
  kind: 'json',
  body: {
    ptUserId,
    gymId: 'x',
    ptActive: true,
    ptBlockedReason: null,
    sessions: [session(sessionId, contractId, new Date(from.getTime() + 9 * HOUR), new Date(from.getTime() + 10 * HOUR))],
  },
});

let prisma: typeof import('../repositories/prisma').prisma;
let ptCheckinService: typeof import('../services/pt-checkin.service').ptCheckinService;
let checkinService: typeof import('../services/checkin.service').checkinService;
let signGymCheckinToken: typeof import('../utils/checkinToken').signGymCheckinToken;

const fx = {
  brand: randomUUID(),
  gymOpen: randomUUID(),
  gymClosed: randomUUID(),
  gymSuspended: randomUUID(),
  plan: randomUUID(),
  // suspended-partner parity fixture
  spOwner: randomUUID(),
  spBrand: randomUUID(),
  spGym: randomUUID(),
  spPlan: randomUUID(),
};
const partnerIds: string[] = [];
const membershipIds: string[] = [];
const tokenFor = (gymId: string) => signGymCheckinToken(gymId).token;

test.before(async () => {
  userSvc = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    userSvcCalls.push({
      method: req.method || '',
      path: url.pathname,
      query: url.searchParams,
      secret: req.headers['x-service-secret'] as string | undefined,
    });
    const m = /^\/internal\/pt\/([^/]+)\/gym-sessions$/.exec(url.pathname);
    if (req.method !== 'GET' || !m) {
      res.writeHead(404).end();
      return;
    }
    const reply = userSvcAnswer(decodeURIComponent(m[1]), new Date(url.searchParams.get('from')!), new Date(url.searchParams.get('to')!));
    if (reply.kind === 'destroy') {
      req.socket.destroy();
      return;
    }
    const send = () => {
      res.writeHead(reply.kind === 'json' ? reply.status ?? 200 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    };
    if (reply.kind === 'delay') setTimeout(send, reply.ms);
    else send();
  });
  await new Promise<void>((r) => userSvc.listen(0, '127.0.0.1', r));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userSvc.address() as net.AddressInfo).port}`;

  authSvc = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/auth/verify' && USERS[token]) {
      res.writeHead(200).end(JSON.stringify({ user: USERS[token] }));
      return;
    }
    const m = /^\/auth\/internal\/users\/([^/]+)$/.exec(req.url || '');
    if (req.method === 'GET' && m && decodeURIComponent(m[1]) === PT) {
      // auth-service owns names; this fixture also returns an e-mail that must NEVER reach the owner list.
      res.writeHead(200).end(JSON.stringify({ user: { id: PT, firstName: 'Phan', lastName: 'Trainer', email: 'secret-pt@p22.test' } }));
      return;
    }
    res.writeHead(token ? 404 : 401).end(JSON.stringify({ error: 'x' }));
  });
  await new Promise<void>((r) => authSvc.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authSvc.address() as net.AddressInfo).port}`;

  prisma = (await import('../repositories/prisma')).prisma;
  ({ ptCheckinService } = await import('../services/pt-checkin.service'));
  ({ checkinService } = await import('../services/checkin.service'));
  ({ signGymCheckinToken } = await import('../utils/checkinToken'));

  await prisma.gymBrand.create({ data: { id: fx.brand, ownerId: OWNER, name: 'P22 Brand' } });
  await prisma.gym.createMany({
    data: [
      { id: fx.gymOpen, ownerId: OWNER, brandId: fx.brand, name: 'P22 Open', address: '1 St', status: 'APPROVED', operationalStatus: 'OPEN' },
      { id: fx.gymClosed, ownerId: OWNER, brandId: fx.brand, name: 'P22 Closed', address: '2 St', status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' },
      { id: fx.gymSuspended, ownerId: OWNER, brandId: fx.brand, name: 'P22 Suspended', address: '3 St', status: 'SUSPENDED', operationalStatus: 'OPEN' },
    ],
  });
  await prisma.gymMembershipPlan.create({
    data: { id: fx.plan, brandId: fx.brand, name: 'P22 Plan', price: 500_000, durationDays: 30, visitLimit: 12 },
  });

  // A SUSPENDED partner whose branch is still APPROVED/OPEN (for the member/PT parity test).
  const partner = await prisma.gymPartner.create({
    data: { legalName: 'P22 Suspended Partner', contactEmail: 'sp@p22.test', status: 'SUSPENDED', verificationStatus: 'VERIFIED' },
  });
  partnerIds.push(partner.id);
  await prisma.gymPartnerAccount.create({
    data: {
      partnerId: partner.id, userId: fx.spOwner, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE',
      activatedAt: new Date(), onboardingCompletedAt: new Date(),
    },
  });
  await prisma.gymBrand.create({ data: { id: fx.spBrand, ownerId: fx.spOwner, name: 'P22 SP Brand' } });
  await prisma.gym.create({
    data: { id: fx.spGym, ownerId: fx.spOwner, brandId: fx.spBrand, name: 'P22 SP Gym', address: '4 St', status: 'APPROVED', operationalStatus: 'OPEN' },
  });
  await prisma.gymMembershipPlan.create({
    data: { id: fx.spPlan, brandId: fx.spBrand, name: 'P22 SP Plan', price: 500_000, durationDays: 30, visitLimit: 12 },
  });

  const clientRoutes = (await import('../routes/client.routes')).default;
  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/owner', ownerRoutes);
  app.use('/', clientRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as net.AddressInfo).port}`;
});

test.beforeEach(async () => {
  userSvcCalls.length = 0;
  userSvcAnswer = () => ({ kind: 'destroy' });
  await prisma.gymPtCheckIn.deleteMany({ where: { gymId: { in: [fx.gymOpen, fx.gymClosed, fx.gymSuspended, fx.spGym] } } });
});

test.after(async () => {
  if (!prisma) return;
  const gymIds = [fx.gymOpen, fx.gymClosed, fx.gymSuspended, fx.spGym];
  await prisma.gymPtCheckIn.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymCheckIn.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipContract.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { id: { in: [fx.plan, fx.spPlan] } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: [fx.brand, fx.spBrand] } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [userSvc, authSvc, appServer]) await new Promise<void>((r) => s.close(() => r()));
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
const scan = (token: string | null, qr: unknown) => call(token, 'POST', '/me/pt-gym-checkins', { token: qr });
const rowsFor = (gymId: string, ptUserId = PT) => prisma.gymPtCheckIn.findMany({ where: { gymId, ptUserId } });

async function makeMembership(clientId: string, gymId: string, planId: string) {
  const id = randomUUID();
  membershipIds.push(id);
  return prisma.gymMembershipContract.create({
    data: {
      id, gymId, planId, clientId, status: 'ACTIVE', priceAtPurchase: 500_000, durationDaysSnapshot: 30,
      startDate: new Date(), endDate: new Date(Date.now() + 15 * 24 * HOUR), totalVisits: 12,
    },
  });
}

// ---------------------------------------------------------------- happy path + contract

test('PT with a qualifying session -> 200, kind PT, exactly one row, no client identity / visit counts', async () => {
  userSvcAnswer = middayAnswer('sess-a', 'ctr-a');
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  const d = r.body.data;
  assert.equal(d.kind, 'PT');
  assert.equal(d.gymId, fx.gymOpen);
  assert.equal(d.gymName, 'P22 Open');
  assert.equal(d.scanCount, 1);
  assert.equal(d.qualifyingSessionCount, 1);
  assert.match(d.localDate, /^\d{4}-\d{2}-\d{2}$/);
  for (const forbidden of ['clientId', 'clientName', 'usedVisits', 'totalVisits', 'planName', 'endDate', 'membershipId', 'ptUserId', 'contractIds', 'qualifyingSessionIds']) {
    assert.equal(forbidden in d, false, `response must not contain ${forbidden}`);
  }
  const rows = await rowsFor(fx.gymOpen);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, d.checkinId);
  assert.equal(rows[0].brandId, fx.brand);
  assert.deepEqual(rows[0].qualifyingSessionIds, ['sess-a']);
  assert.deepEqual(rows[0].contractIds, ['ctr-a']);
});

test('the request to user-service follows the P2.1 contract and is a READ (GET) only', async () => {
  userSvcAnswer = middayAnswer();
  await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(userSvcCalls.length, 1);
  const c = userSvcCalls[0];
  assert.equal(c.method, 'GET');
  assert.equal(c.path, `/internal/pt/${PT}/gym-sessions`);
  assert.equal(c.secret, SECRET);
  assert.equal(c.query.get('gymId'), fx.gymOpen);
  const from = new Date(c.query.get('from')!);
  const to = new Date(c.query.get('to')!);
  assert.equal(to.getTime() - from.getTime(), 24 * HOUR);
  assert.equal(from.getUTCHours(), 17, 'day starts at 00:00 +07:00 = 17:00Z of the previous UTC day');
  assert.equal(from.getUTCMinutes() + from.getUTCSeconds() + from.getUTCMilliseconds(), 0);
});

// ---------------------------------------------------------------- refusals

test('no qualifying session -> 403 PT_NO_QUALIFYING_SESSION and no row', async () => {
  userSvcAnswer = () => ({ kind: 'json', body: noSessions });
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PT_NO_QUALIFYING_SESSION');
  assert.equal((await rowsFor(fx.gymOpen)).length, 0);
});

test('a session that does not overlap the day is not trusted blindly (defence in depth)', async () => {
  userSvcAnswer = (_pt, from) => ({
    kind: 'json',
    body: { ptActive: true, ptBlockedReason: null, sessions: [session('far', 'c', new Date(from.getTime() + 30 * HOUR), new Date(from.getTime() + 31 * HOUR))] },
  });
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PT_NO_QUALIFYING_SESSION');
  assert.equal((await rowsFor(fx.gymOpen)).length, 0);
});

for (const [reason, code] of [
  ['PT_ACCOUNT_RESTRICTED', 'PT_RESTRICTED'],
  ['PT_BANNED', 'PT_BANNED'],
  ['NOT_A_PT', 'NOT_A_PT'],
  ['PT_NOT_FOUND', 'PT_NOT_FOUND'],
] as const) {
  test(`ptActive=false (${reason}) -> 403 ${code}, no row, sessions ignored`, async () => {
    userSvcAnswer = (_pt, from) => ({
      kind: 'json',
      body: { ptActive: false, ptBlockedReason: reason, sessions: [session('s', 'c', new Date(from.getTime() + 9 * HOUR), new Date(from.getTime() + 10 * HOUR))] },
    });
    const r = await scan('tok-pt', tokenFor(fx.gymOpen));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, code);
    assert.equal((await rowsFor(fx.gymOpen)).length, 0);
  });
}

test('wrong role (CUSTOMER, GYM_OWNER) -> 403 FORBIDDEN, anonymous -> 401; user-service never asked, no row', async () => {
  userSvcAnswer = middayAnswer();
  const qr = tokenFor(fx.gymOpen);
  for (const tok of ['tok-customer', 'tok-owner']) {
    const r = await scan(tok, qr);
    assert.equal(r.status, 403, tok);
    assert.equal(r.body.error.code, 'FORBIDDEN', tok);
  }
  assert.equal((await scan(null, qr)).status, 401);
  assert.equal(userSvcCalls.length, 0);
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.gymOpen } }), 0);
});

test('invalid / missing / forged / expired token -> 400 with a code; unknown gym -> 404; user-service not asked', async () => {
  userSvcAnswer = middayAnswer();
  const bad = [undefined, '', 'garbage', 'a.b', 123, tokenFor(fx.gymOpen).slice(0, -3) + 'xyz'];
  for (const t of bad) {
    const r = await scan('tok-pt', t);
    assert.equal(r.status, 400, String(t));
    assert.equal(r.body.error.code, 'INVALID_TOKEN', String(t));
  }
  // expired: correctly signed but exp in the past
  const payload = Buffer.from(JSON.stringify({ gymId: fx.gymOpen, purpose: 'GYM_CHECKIN_QR', exp: Date.now() - 1000 })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const expired = await scan('tok-pt', `${payload}.${sig}`);
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error.code, 'TOKEN_EXPIRED');
  // wrong purpose is not a branch QR
  const p2 = Buffer.from(JSON.stringify({ gymId: fx.gymOpen, purpose: 'SOMETHING_ELSE', exp: Date.now() + HOUR })).toString('base64url');
  const sig2 = createHmac('sha256', SECRET).update(p2).digest('base64url');
  assert.equal((await scan('tok-pt', `${p2}.${sig2}`)).body.error.code, 'INVALID_TOKEN');
  // a validly signed QR for a gym that does not exist
  const unknown = await scan('tok-pt', tokenFor(randomUUID()));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'GYM_NOT_FOUND');
  assert.equal(userSvcCalls.length, 0);
});

test('closed / suspended branch is refused exactly like the member path: 409 GYM_NOT_ACTIVE, user-service not asked, no row', async () => {
  userSvcAnswer = middayAnswer();
  for (const gymId of [fx.gymClosed, fx.gymSuspended]) {
    const r = await scan('tok-pt', tokenFor(gymId));
    assert.equal(r.status, 409, gymId);
    assert.equal(r.body.error.code, 'GYM_NOT_ACTIVE', gymId);
    assert.equal((await rowsFor(gymId)).length, 0);
  }
  assert.equal(userSvcCalls.length, 0);
});

test('partner SUSPENDED (branch still APPROVED/OPEN): PT path behaves exactly like the member path (both allowed - partner lock does not gate walking in)', async () => {
  const membership = await makeMembership(CUSTOMER, fx.spGym, fx.spPlan);
  const qr = tokenFor(fx.spGym);
  const member = await checkinService.checkInByGymToken(CUSTOMER, qr);
  assert.equal(member.ok, true, 'member path: allowed');
  userSvcAnswer = middayAnswer();
  const pt = await scan('tok-pt', qr);
  assert.equal(pt.status, 200, 'PT path: same decision as the member path');
  await prisma.gymCheckIn.deleteMany({ where: { membershipId: membership.id } });
});

// ---------------------------------------------------------------- user-service unavailable (Q16)

test('user-service 500 / 404 / dead connection / malformed answers -> 503 PT_SESSION_CHECK_UNAVAILABLE and NO row', async () => {
  const cases: Array<[string, (pt: string, f: Date, t: Date) => UserSvcReply]> = [
    ['500', () => ({ kind: 'json', status: 500, body: { error: 'boom' } })],
    ['404', () => ({ kind: 'json', status: 404, body: {} })],
    ['503', () => ({ kind: 'json', status: 503, body: {} })],
    ['dead connection', () => ({ kind: 'destroy' })],
    ['empty object', () => ({ kind: 'json', body: {} })],
    ['sessions not an array', () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: 'x' } })],
    ['ptActive missing', () => ({ kind: 'json', body: { sessions: [] } })],
    ['bad session entry', () => ({ kind: 'json', body: { ptActive: true, sessions: [{ sessionId: 's' }] } })],
  ];
  for (const [label, answer] of cases) {
    userSvcAnswer = answer;
    const r = await scan('tok-pt', tokenFor(fx.gymOpen));
    assert.equal(r.status, 503, label);
    assert.equal(r.body.error.code, 'PT_SESSION_CHECK_UNAVAILABLE', label);
    assert.equal((await rowsFor(fx.gymOpen)).length, 0, `${label}: no row`);
  }
});

test('user-service timeout (> 3 s) -> 503 within ~3 s, no row', async () => {
  userSvcAnswer = (pt, f, t) => ({ kind: 'delay', ms: 4500, body: (middayAnswer()(pt, f, t) as any).body });
  const started = Date.now();
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  const took = Date.now() - started;
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'PT_SESSION_CHECK_UNAVAILABLE');
  assert.ok(took >= 2800 && took < 4400, `gave up after the 3 s ceiling, took ${took} ms`);
  assert.equal((await rowsFor(fx.gymOpen)).length, 0);
});

test('an outage on a re-scan leaves the day record untouched (no scan_count bump, no new row)', async () => {
  userSvcAnswer = middayAnswer();
  await scan('tok-pt', tokenFor(fx.gymOpen));
  userSvcAnswer = () => ({ kind: 'json', status: 500, body: {} });
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(r.status, 503);
  const rows = await rowsFor(fx.gymOpen);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scanCount, 1);
});

// ---------------------------------------------------------------- idempotency / race (Q17)

test('re-scan the same day -> 200, SAME record id, scan_count 2, last_scan_at moves, first_scan_at does not', async () => {
  userSvcAnswer = middayAnswer();
  const a = await scan('tok-pt', tokenFor(fx.gymOpen));
  await new Promise((r) => setTimeout(r, 20));
  const b = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.data.checkinId, a.body.data.checkinId);
  assert.equal(b.body.data.scanCount, 2);
  assert.equal(b.body.data.firstScanAt, a.body.data.firstScanAt);
  assert.ok(new Date(b.body.data.lastScanAt) > new Date(a.body.data.lastScanAt));
  assert.equal((await rowsFor(fx.gymOpen)).length, 1);
});

test('10 concurrent scans -> exactly one row, all 200, identical record id, scan_count 10', async () => {
  userSvcAnswer = middayAnswer();
  const qr = tokenFor(fx.gymOpen);
  const results = await Promise.all(Array.from({ length: 10 }, () => scan('tok-pt', qr)));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  assert.equal(new Set(results.map((r) => r.body.data.checkinId)).size, 1);
  const rows = await rowsFor(fx.gymOpen);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scanCount, 10);
  assert.equal(rows[0].id, results[0].body.data.checkinId);
});

test('different PTs / different branches on the same day get separate rows', async () => {
  userSvcAnswer = middayAnswer();
  await scan('tok-pt', tokenFor(fx.gymOpen));
  await scan('tok-pt2', tokenFor(fx.gymOpen));
  await scan('tok-pt', tokenFor(fx.spGym));
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.gymOpen } }), 2);
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.spGym } }), 1);
});

test('later scans union the basis (a second session booked later the same day is added, none lost)', async () => {
  userSvcAnswer = middayAnswer('s1', 'c1');
  await scan('tok-pt', tokenFor(fx.gymOpen));
  userSvcAnswer = (_pt, from) => ({
    kind: 'json',
    body: {
      ptActive: true, ptBlockedReason: null,
      sessions: [
        session('s2', 'c2', new Date(from.getTime() + 14 * HOUR), new Date(from.getTime() + 15 * HOUR)),
        session('s1', 'c1', new Date(from.getTime() + 9 * HOUR), new Date(from.getTime() + 10 * HOUR)),
      ],
    },
  });
  const r = await scan('tok-pt', tokenFor(fx.gymOpen));
  assert.equal(r.body.data.qualifyingSessionCount, 2);
  const [row] = await rowsFor(fx.gymOpen);
  assert.deepEqual(row.qualifyingSessionIds, ['s1', 's2']);
  assert.deepEqual(row.contractIds, ['c1', 'c2']);
});

// ---------------------------------------------------------------- local day boundary (Q18)

test('local-day boundary: 23:59:59 +07:00 is day D, 00:00:01 +07:00 is D+1; window sent to user-service is the local day', async () => {
  const seen: Array<{ from: string; to: string }> = [];
  userSvcAnswer = (_pt, from, to) => {
    seen.push({ from: from.toISOString(), to: to.toISOString() });
    return { kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session(`s-${from.toISOString()}`, 'c', new Date(from.getTime() + 9 * HOUR), new Date(from.getTime() + 10 * HOUR))] } };
  };
  const before = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-10-17T16:59:59.000Z')); // 23:59:59 on 17/10
  const after = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-10-17T17:00:01.000Z')); // 00:00:01 on 18/10
  assert.equal(before.localDate, '2026-10-17');
  assert.equal(after.localDate, '2026-10-18');
  assert.notEqual(before.checkinId, after.checkinId, 'two local days = two records');
  assert.deepEqual(seen[0], { from: '2026-10-16T17:00:00.000Z', to: '2026-10-17T17:00:00.000Z' });
  assert.deepEqual(seen[1], { from: '2026-10-17T17:00:00.000Z', to: '2026-10-18T17:00:00.000Z' });
  const rows = await prisma.$queryRaw<Array<{ d: string }>>`SELECT to_char(local_date,'YYYY-MM-DD') AS d FROM gym_pt_check_ins WHERE gym_id = ${fx.gymOpen} AND pt_user_id = ${PT} ORDER BY local_date`;
  assert.deepEqual(rows.map((r) => r.d), ['2026-10-17', '2026-10-18']);
});

test('the same instant on both sides of the boundary is stored on the right day regardless of process TZ', async () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    userSvcAnswer = (_pt, from) => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session(`tz-${from.toISOString()}`, 'c', new Date(from.getTime() + 9 * HOUR), new Date(from.getTime() + 10 * HOUR))] } });
    const late = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-12-31T16:59:59.999Z'));
    const next = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-12-31T17:00:00.000Z'));
    assert.equal(late.localDate, '2026-12-31');
    assert.equal(next.localDate, '2027-01-01');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

// ---------------------------------------------------------------- Q-B + Q18 interplay

test('Q-B: a session recorded as basis for day 1 and then MOVED to day 2 does not qualify day 2; a different session does', async () => {
  const day1 = new Date('2026-10-20T05:00:00Z'); // 12:00 local 20/10
  const day2 = new Date('2026-10-21T05:00:00Z'); // 12:00 local 21/10
  const at = (iso: string) => new Date(iso);
  // Day 1: session S booked 20/10 09:00-10:00 local (02:00Z-03:00Z).
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session('S', 'c', at('2026-10-20T02:00:00Z'), at('2026-10-20T03:00:00Z'))] } });
  const first = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), day1);
  assert.equal(first.localDate, '2026-10-20');
  // The session is then rescheduled to 21/10 09:00 local; user-service now reports it on day 2.
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session('S', 'c', at('2026-10-21T02:00:00Z'), at('2026-10-21T03:00:00Z'))] } });
  await assert.rejects(
    () => ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), day2),
    (e: any) => e.message === 'PT_NO_QUALIFYING_SESSION' && e.status === 403,
  );
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.gymOpen, ptUserId: PT } }), 1, 'no second row');
  // A genuinely different session on day 2 still qualifies, alone (S is dropped from the basis).
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [
    session('S', 'c', at('2026-10-21T02:00:00Z'), at('2026-10-21T03:00:00Z')),
    session('T', 'c', at('2026-10-21T06:00:00Z'), at('2026-10-21T07:00:00Z')),
  ] } });
  const second = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), day2);
  assert.equal(second.qualifyingSessionCount, 1);
  const rows = await prisma.gymPtCheckIn.findMany({ where: { gymId: fx.gymOpen, ptUserId: PT }, orderBy: { localDate: 'asc' } });
  assert.deepEqual(rows.map((r) => r.qualifyingSessionIds), [['S'], ['T']]);
});

test('Q-B is per PT: another PT\'s record with the same session id does not block', async () => {
  const day1 = new Date('2026-10-20T05:00:00Z');
  const day2 = new Date('2026-10-21T05:00:00Z');
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session('SHARED', 'c', new Date('2026-10-20T02:00:00Z'), new Date('2026-10-20T03:00:00Z'))] } });
  await ptCheckinService.checkInByGymToken(PT2, tokenFor(fx.gymOpen), day1);
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [session('SHARED', 'c', new Date('2026-10-21T02:00:00Z'), new Date('2026-10-21T03:00:00Z'))] } });
  const r = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), day2);
  assert.equal(r.qualifyingSessionCount, 1);
});

test('Q18+Q-B: a session spanning midnight (23:00-01:00) qualifies BOTH days - it was never moved', async () => {
  const sp = session('NIGHT', 'c', new Date('2026-10-20T16:00:00Z'), new Date('2026-10-20T18:00:00Z')); // 23:00 20/10 - 01:00 21/10 local
  userSvcAnswer = () => ({ kind: 'json', body: { ptActive: true, ptBlockedReason: null, sessions: [sp] } });
  const d1 = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-10-20T16:30:00Z')); // 23:30 local 20/10
  const d2 = await ptCheckinService.checkInByGymToken(PT, tokenFor(fx.gymOpen), new Date('2026-10-20T17:30:00Z')); // 00:30 local 21/10
  assert.equal(d1.localDate, '2026-10-20');
  assert.equal(d2.localDate, '2026-10-21');
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.gymOpen, ptUserId: PT } }), 2);
});

// ---------------------------------------------------------------- Q15 + D70: no membership / money effect

test('a PT who is also a member: PT scan deducts NO visit, creates NO GymCheckIn, leaves the membership row byte-identical', async () => {
  const membership = await makeMembership(PT_MEMBER, fx.gymOpen, fx.plan);
  const snapshot = async () =>
    JSON.stringify(await prisma.$queryRaw`SELECT * FROM gym_membership_contracts WHERE id = ${membership.id}`);
  const before = await snapshot();
  userSvcAnswer = middayAnswer();
  const qr = tokenFor(fx.gymOpen);
  for (let i = 0; i < 3; i++) assert.equal((await scan('tok-pt-member', qr)).status, 200);
  assert.equal(await snapshot(), before, 'membership row unchanged (used_visits, status, updated_at...)');
  assert.equal(await prisma.gymCheckIn.count({ where: { gymId: fx.gymOpen } }), 0);
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: fx.gymOpen, ptUserId: PT_MEMBER } }), 1);
  // And the member route still works for this very person (unchanged behaviour): one visit deducted there.
  const asMember = await checkinService.checkInByGymToken(PT_MEMBER, qr);
  assert.equal(asMember.usedVisits, 1);
  await prisma.gymCheckIn.deleteMany({ where: { membershipId: membership.id } });
});

test('D70: across all PT-path scenarios gym-service sent user-service only GETs (no write call exists)', async () => {
  userSvcAnswer = middayAnswer();
  await scan('tok-pt', tokenFor(fx.gymOpen));
  await scan('tok-pt', tokenFor(fx.gymOpen));
  userSvcAnswer = () => ({ kind: 'json', body: noSessions });
  await scan('tok-pt2', tokenFor(fx.gymOpen));
  assert.ok(userSvcCalls.length >= 3);
  assert.ok(userSvcCalls.every((c) => c.method === 'GET'), JSON.stringify(userSvcCalls.map((c) => c.method)));
});

// ---------------------------------------------------------------- owner list (Q19)

test('owner list: PT entries only, no client identity, pt name from auth (never e-mail), counts, newest first; other owners 403; member list unaffected', async () => {
  userSvcAnswer = (pt, from) => middayAnswer(`os-${pt}`, 'secret-contract')(pt, from, from);
  await scan('tok-pt', tokenFor(fx.gymOpen));
  await scan('tok-pt', tokenFor(fx.gymOpen));
  await scan('tok-pt2', tokenFor(fx.gymOpen));
  const r = await call('tok-owner', 'GET', `/owner/gyms/${fx.gymOpen}/pt-checkins`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 2);
  const mine = r.body.data.find((x: any) => x.ptUserId === PT);
  assert.equal(mine.ptName, 'Phan Trainer');
  assert.equal(mine.scanCount, 2);
  assert.equal(mine.qualifyingSessionCount, 1);
  assert.ok(mine.firstScanAt && mine.lastScanAt && /^\d{4}-\d{2}-\d{2}$/.test(mine.localDate));
  const other = r.body.data.find((x: any) => x.ptUserId === PT2);
  assert.equal(other.ptName, null, 'unknown name -> null; the caller falls back to ptUserId');
  const allowed = new Set(['id', 'ptUserId', 'ptName', 'localDate', 'firstScanAt', 'lastScanAt', 'scanCount', 'qualifyingSessionCount']);
  for (const row of r.body.data) assert.deepEqual(Object.keys(row).filter((k) => !allowed.has(k)), [], 'only whitelisted fields');
  const blob = JSON.stringify(r.body);
  assert.equal(blob.includes('secret-pt@p22.test'), false, 'PT e-mail never exposed');
  assert.equal(blob.includes('secret-contract'), false, 'contract ids never exposed');
  assert.equal(blob.includes('os-'), false, 'session ids never exposed');
  // another owner cannot read this branch; anonymous / PT cannot use the owner route
  assert.equal((await call('tok-other-owner', 'GET', `/owner/gyms/${fx.gymOpen}/pt-checkins`)).status, 403);
  assert.equal((await call(null, 'GET', `/owner/gyms/${fx.gymOpen}/pt-checkins`)).status, 401);
  assert.equal((await call('tok-pt', 'GET', `/owner/gyms/${fx.gymOpen}/pt-checkins`)).status, 403);
  // member visit list does not contain PT rows
  const members = await call('tok-owner', 'GET', `/owner/gyms/${fx.gymOpen}/checkins`);
  assert.equal(members.status, 200);
  assert.equal(members.body.data.length, 0);
});

// ---------------------------------------------------------------- pre-existing gap fixed on the member path

test('member path: a closed branch now answers 409 with error.code GYM_NOT_ACTIVE (was error.message only)', async () => {
  const membership = await makeMembership(CUSTOMER, fx.gymClosed, fx.plan);
  const r = await call('tok-customer', 'POST', '/me/gym-checkins', { token: tokenFor(fx.gymClosed) });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GYM_NOT_ACTIVE');
  const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
  assert.equal(after?.usedVisits, 0);
});

// Plain node:test (no DB): the migration and the generated client agree on the table shape.
nodeTest('migration file exists with the agreed unique key and indexes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.resolve(__dirname, '../../prisma/migrations/20261018000000_gym_pt_check_ins/migration.sql');
  const sql = fs.readFileSync(dir, 'utf8');
  assert.match(sql, /CREATE TABLE "gym_pt_check_ins"/);
  assert.match(sql, /UNIQUE INDEX "gym_pt_check_ins_gym_pt_date_key" ON "gym_pt_check_ins"\("gym_id", "pt_user_id", "local_date"\)/);
  assert.match(sql, /INDEX "gym_pt_check_ins_gym_date_idx" ON "gym_pt_check_ins"\("gym_id", "local_date"\)/);
  assert.match(sql, /"local_date" DATE NOT NULL/);
  assert.match(sql, /"qualifying_session_ids" TEXT\[\]/);
  assert.match(sql, /"contract_ids" TEXT\[\]/);
});
