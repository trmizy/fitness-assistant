/**
 * Dispute Case slice 2 / S2.3 - gym-service GET /internal/pt-checkins and GET /internal/member-checkins against the REAL app, the REAL service-secret
 * middleware and a REAL isolated *_test database (no fake repository). Evidence labels: REAL HTTP + BACKEND INTEGRATION.
 * Seeded data is SYNTHETIC and includes rows that must NOT come back: another PT, another gym, another day, another membership, staff / sensitive columns.
 *
 * Run ALONE through the preload (it creates and deletes its own rows):
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_<x>_test?schema=public" npm test
 */
import { guardedTest as test, skip } from './test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const SECRET = 's23-real-route-test-secret';
process.env.INTERNAL_SERVICE_SECRET = SECRET;
const H = 3600_000;

let server: http.Server;
let base = '';
let db: typeof import('../repositories/prisma').prisma;
const made = { gyms: [] as string[], brands: [] as string[], plans: [] as string[], memberships: [] as string[], checkins: [] as string[], pt: [] as string[], events: [] as string[] };

const S = {
  gymA: '', gymB: '', planId: '',
  ptX: randomUUID(), ptY: randomUUID(),
  memA: '', memOther: '', memberA: randomUUID(), staff: randomUUID(),
  sessionIds: [randomUUID(), randomUUID()],
};
const T0 = new Date('2026-10-01T10:00:00.000Z');

test.before(async () => {
  if (skip) return;
  const { default: app } = await import('../app');
  db = (await import('../repositories/prisma')).prisma;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const brand = await db.gymBrand.create({ data: { id: randomUUID(), ownerId: randomUUID(), name: 'S23 Brand' } });
  made.brands.push(brand.id);
  for (const k of ['gymA', 'gymB'] as const) {
    const g = await db.gym.create({ data: { id: randomUUID(), ownerId: brand.ownerId, brandId: brand.id, name: `S23 ${k}`, address: '1 Test St', status: 'APPROVED' } });
    made.gyms.push(g.id);
    S[k] = g.id;
  }
  const plan = await db.gymMembershipPlan.create({ data: { id: randomUUID(), brandId: brand.id, name: 'S23 Plan', price: 500_000, durationDays: 30 } });
  made.plans.push(plan.id);
  S.planId = plan.id;
  const mkMem = async (clientId: string) => {
    const m = await db.gymMembershipContract.create({
      data: { id: randomUUID(), gymId: S.gymA, planId: S.planId, clientId, status: 'ACTIVE', priceAtPurchase: 500_000, durationDaysSnapshot: 30, startDate: new Date(T0.getTime() - 86_400_000), endDate: new Date(T0.getTime() + 20 * 86_400_000) },
    });
    made.memberships.push(m.id);
    return m.id;
  };
  S.memA = await mkMem(S.memberA);
  S.memOther = await mkMem(randomUUID());

  // PT check-ins: (gymA, ptX, 2026-10-01) is the target; same PT other day / other gym; another PT same gym+day
  const pt = (gymId: string, ptUserId: string, d: string, extra: Partial<{ scanCount: number; q: string[] }> = {}) =>
    db.gymPtCheckIn.create({
      data: { gymId, ptUserId, localDate: new Date(`${d}T00:00:00.000Z`), firstScanAt: new Date(`${d}T01:00:00.000Z`), lastScanAt: new Date(`${d}T09:30:00.000Z`), scanCount: extra.scanCount ?? 2, qualifyingSessionIds: extra.q ?? [], contractIds: ['contract-secret-1'], brandId: brand.id },
    });
  made.pt.push((await pt(S.gymA, S.ptX, '2026-10-01', { scanCount: 3, q: S.sessionIds })).id);
  made.pt.push((await pt(S.gymA, S.ptX, '2026-10-02', { scanCount: 9 })).id);
  made.pt.push((await pt(S.gymB, S.ptX, '2026-10-01', { scanCount: 8 })).id);
  made.pt.push((await pt(S.gymA, S.ptY, '2026-10-01', { scanCount: 7 })).id);

  // member check-ins of memA: QR inside the window, ASSISTED inside the window (with its audit event), one outside the window; and one of ANOTHER membership
  const ev = await db.gymAssistedCheckInEvent.create({
    data: { id: randomUUID(), eventType: 'CHECKIN_SUCCEEDED', gymId: S.gymA, staffUserId: S.staff, staffRole: 'OWNER', membershipId: S.memA, clientId: S.memberA, method: 'PHOTO_MATCH', outcome: 'OK', reason: 'secret reason', details: { otp: 'must-not-leak' } },
  });
  made.events.push(ev.id);
  const ci = (membershipId: string, at: Date, source: 'QR' | 'ASSISTED', by: string, assistedEventId?: string) =>
    db.gymCheckIn.create({ data: { id: randomUUID(), membershipId, gymId: S.gymA, clientId: 'client-secret-' + membershipId, checkedInBy: by, source, assistedEventId: assistedEventId ?? null, createdAt: at } });
  made.checkins.push((await ci(S.memA, new Date(T0.getTime() + 1 * H), 'QR', S.memberA)).id);
  made.checkins.push((await ci(S.memA, new Date(T0.getTime() + 2 * H), 'ASSISTED', S.staff, ev.id)).id);
  made.checkins.push((await ci(S.memA, new Date(T0.getTime() + 30 * H), 'QR', S.memberA)).id);
  made.checkins.push((await ci(S.memOther, new Date(T0.getTime() + 1 * H), 'QR', 'someone-else')).id);
});

test.after(async () => {
  if (!skip && db) {
    await db.gymCheckIn.deleteMany({ where: { id: { in: made.checkins } } });
    await db.gymPtCheckIn.deleteMany({ where: { id: { in: made.pt } } });
    // append-only audit table: the trigger refuses DELETE, so the event rows of this run are left in the isolated test database
    await db.gymMembershipContract.deleteMany({ where: { id: { in: made.memberships } } });
    await db.gymMembershipPlan.deleteMany({ where: { id: { in: made.plans } } });
    await db.gym.deleteMany({ where: { id: { in: made.gyms } } });
    await db.gymBrand.deleteMany({ where: { id: { in: made.brands } } });
    await db.$disconnect();
  }
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

async function get(path: string, secret: string | null = SECRET) {
  const res = await fetch(base + path, { headers: secret === null ? {} : { 'x-service-secret': secret } });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const json = (t: string) => JSON.parse(t);
const pt = (o: { ptUserId?: string; gymId?: string; date?: string } = {}) => `/internal/pt-checkins?ptUserId=${o.ptUserId ?? S.ptX}&gymId=${o.gymId ?? S.gymA}&date=${o.date ?? '2026-10-01'}`;
const win = (m: string, from: string, to: string) => `/internal/member-checkins?membershipId=${m}&from=${from}&to=${to}`;

test('wrong / missing / near-miss service secret -> 401 on both routes; nothing is read', async () => {
  for (const path of [pt(), win('x', '2026-10-01T00:00:00Z', '2026-10-01T12:00:00Z')]) {
    for (const secret of [null, '', 'wrong', SECRET + 'x', SECRET.toUpperCase()]) assert.equal((await get(path, secret)).status, 401, `${path} ${secret}`);
  }
});

test('pt-checkins: a missing key, a bad / impossible date, an extra or repeated parameter -> 400', async () => {
  for (const q of ['', `?ptUserId=${S.ptX}&gymId=${S.gymA}`, `?gymId=${S.gymA}&date=2026-10-01`, `?ptUserId=${S.ptX}&date=2026-10-01`, pt({ date: '2026-02-30' }).slice('/internal/pt-checkins'.length), pt({ date: '01-10-2026' }).slice('/internal/pt-checkins'.length), `${pt().slice('/internal/pt-checkins'.length)}&all=1`, `${pt().slice('/internal/pt-checkins'.length)}&ptUserId=${S.ptY}`]) {
    assert.equal((await get(`/internal/pt-checkins${q}`)).status, 400, q);
  }
});

test('pt-checkins: exactly the record of (gym, PT, local day) - the other PT / day / gym are not returned; only four fields; qualifyingSessionIds as stored', async () => {
  const r = await get(pt());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const body = json(r.text);
  assert.deepEqual(Object.keys(body.data).sort(), ['firstScanAt', 'lastScanAt', 'qualifyingSessionIds', 'scanCount']);
  assert.equal(body.data.scanCount, 3, 'not the 9 / 8 / 7 of the decoys');
  assert.deepEqual(body.data.qualifyingSessionIds, S.sessionIds);
  assert.equal(body.data.firstScanAt, '2026-10-01T01:00:00.000Z');
  for (const leak of ['contract-secret-1', S.ptX, S.ptY, S.gymA, S.gymB, 'brandId', 'contractIds', 'brand']) assert.equal(r.text.includes(leak), false, `leaked ${leak}`);
  // the other keys give their OWN records, never this one
  assert.equal(json((await get(pt({ date: '2026-10-02' }))).text).data.scanCount, 9);
  assert.equal(json((await get(pt({ gymId: S.gymB }))).text).data.scanCount, 8);
  assert.equal(json((await get(pt({ ptUserId: S.ptY }))).text).data.scanCount, 7);
  // no record is null - never a zero-filled object
  assert.deepEqual(json((await get(pt({ date: '2026-10-03' }))).text), { data: null });
  assert.deepEqual(json((await get(pt({ ptUserId: randomUUID() }))).text), { data: null });
});

test('member-checkins: a missing key, an unordered / zero / >48 h window, a bad date, an extra parameter -> 400', async () => {
  const a = '2026-10-01T00:00:00Z';
  const bad = [
    `?from=${a}&to=2026-10-01T05:00:00Z`,
    `?membershipId=${S.memA}&to=2026-10-01T05:00:00Z`,
    `?membershipId=${S.memA}&from=${a}`,
    `?membershipId=${S.memA}&from=2026-10-01T05:00:00Z&to=${a}`,
    `?membershipId=${S.memA}&from=${a}&to=${a}`,
    `?membershipId=${S.memA}&from=${a}&to=2026-10-03T00:00:01Z`,
    `?membershipId=${S.memA}&from=yesterday&to=today`,
    `?membershipId=${S.memA}&from=${a}&to=2026-10-01T05:00:00Z&clientId=x`,
    `?membershipId=${S.memA}&from=${a}&to=2026-10-01T05:00:00Z&limit=999`,
  ];
  for (const q of bad) assert.equal((await get(`/internal/member-checkins${q}`)).status, 400, q);
  assert.equal((await get(win(S.memA, a, '2026-10-03T00:00:00Z'))).status, 200, 'exactly 48 h is allowed');
});

test('member-checkins: only THIS membership, only inside the window, QR vs ASSISTED with the staff verification method, no client / staff-sensitive columns', async () => {
  const r = await get(win(S.memA, '2026-10-01T09:00:00Z', '2026-10-01T13:00:00Z'));
  assert.equal(r.status, 200);
  const rows = json(r.text).data as any[];
  assert.equal(rows.length, 2, 'the QR + the ASSISTED one; not the one 30 h later, not the other membership');
  assert.deepEqual(rows.map((x) => x.source), ['QR', 'ASSISTED']);
  for (const x of rows) assert.deepEqual(Object.keys(x).sort(), ['assisted', 'checkedInBy', 'createdAt', 'gymId', 'source']);
  assert.equal(rows[0].checkedInBy, S.memberA);
  assert.equal(rows[0].assisted, null);
  assert.equal(rows[1].checkedInBy, S.staff);
  assert.deepEqual(Object.keys(rows[1].assisted).sort(), ['eventAt', 'method', 'staffRole']);
  assert.deepEqual([rows[1].assisted.method, rows[1].assisted.staffRole], ['PHOTO_MATCH', 'OWNER']);
  for (const leak of ['secret reason', 'must-not-leak', 'client-secret-', 'otp', 'clientId', 'idempotency', 'someone-else']) assert.equal(r.text.includes(leak), false, `leaked ${leak}`);
  // the other membership sees only its own row; a window with nothing is an empty list, not an error
  const other = json((await get(win(S.memOther, '2026-10-01T09:00:00Z', '2026-10-01T13:00:00Z'))).text).data as any[];
  assert.deepEqual(other.map((x) => x.checkedInBy), ['someone-else']);
  assert.deepEqual(json((await get(win(S.memA, '2026-09-01T00:00:00Z', '2026-09-01T12:00:00Z'))).text), { data: [] });
  assert.deepEqual(json((await get(win(randomUUID(), '2026-10-01T09:00:00Z', '2026-10-01T13:00:00Z'))).text), { data: [] });
});

test('member-checkins: the row cap holds on real data (101 rows -> 100) and nothing but GET is served', async () => {
  const m = await db.gymMembershipContract.create({
    data: { id: randomUUID(), gymId: S.gymA, planId: S.planId, clientId: randomUUID(), status: 'ACTIVE', priceAtPurchase: 1, durationDaysSnapshot: 30, startDate: new Date(T0.getTime() - 86_400_000), endDate: new Date(T0.getTime() + 86_400_000 * 20) },
  });
  made.memberships.push(m.id);
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), membershipId: m.id, gymId: S.gymA, clientId: 'c', checkedInBy: 'c', source: 'QR' as const, createdAt: new Date(T0.getTime() + i * 1000) }));
  await db.gymCheckIn.createMany({ data: rows });
  made.checkins.push(...rows.map((x) => x.id));
  assert.equal(json((await get(win(m.id, '2026-10-01T09:00:00Z', '2026-10-01T13:00:00Z'))).text).data.length, 100);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(base + pt(), { method, headers: { 'x-service-secret': SECRET } });
    assert.ok(res.status === 404 || res.status === 405, `${method} -> ${res.status}`);
  }
});

test('the gateway-facing app does not serve /internal without the secret even on an unknown sub-path', async () => {
  assert.equal((await get('/internal/pt-checkins/extra', null)).status, 401);
});
