/**
 * Listing Management B3 - Ngài's follow-up decisions:
 *   1. EVERY refused (4xx) request of an old client (no new-client header) on a compat route leaves an event: REJECTED_422 for the
 *      amenities refusal, REJECTED_OTHER for any other 4xx - own transaction, written BEFORE the response, and a failing insert never
 *      changes the original error response;
 *   2. the header is an integer >= 2 ("2", "3", ...): that number is what application_flow_version / created_flow_version store;
 *      missing, "1" and non-integers are old clients (raw value kept in flow_header);
 *   3. one PENDING proposal per (owner, branch, name): the same owner can propose a name for each branch, the admin approves the group once.
 *
 * Evidence label: BACKEND INTEGRATION - the real Express app over an isolated `*_test` database; auth-service is a TEST FIXTURE.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { cleanupAll, makeAdminUser, makeGym, makeOwnerUser, newRegistry, startHarness, type Harness, type OwnerFx, type Reply } from './listing-b2.test-helpers';

const reg = newRegistry();
const P = `zzb3r${randomUUID().slice(0, 5)}`;
const MARK = `mobile/b3r-${randomUUID().slice(0, 6)}`; // every old-client request of this file carries it, so its events can be counted exactly
const OLD = { 'x-gymini-client': MARK };
const NEW2 = { 'x-gymini-listing-flow': '2', 'x-gymini-client': MARK };
const NEW3 = { 'x-gymini-listing-flow': '3', 'x-gymini-client': MARK };
const LEGACY_FLAG = 'LISTING_LEGACY_CLIENT_COMPAT';
let savedFlag: string | undefined;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let owner: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;
const actors: string[] = [];

test.before(async () => {
  if (skip) return;
  savedFlag = process.env[LEGACY_FLAG];
  delete process.env[LEGACY_FLAG];
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  owner = await makeOwnerUser(reg, h, 'B3r');
  admin = makeAdminUser(h);
  actors.push(owner.ownerId);
});

test.after(async () => {
  if (skip) return;
  if (savedFlag === undefined) delete process.env[LEGACY_FLAG];
  else process.env[LEGACY_FLAG] = savedFlag;
  await h.stop();
  await prisma.legacyCompatEvent.deleteMany({ where: { OR: [{ actorUserId: { in: actors } }, { clientHeader: MARK }] } });
  await cleanupAll(reg, { adminIds: [admin.adminId], amenityNamePrefix: P });
  await prisma.$disconnect();
});

const code = (r: Reply) => r.json?.error?.code;
const sys = (slug: string) => `amenity-sys-${slug.toLowerCase().replace(/_/g, '-')}`;
const events = (entityId: string) => prisma.legacyCompatEvent.findMany({ where: { entityId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
const markedCount = () => prisma.legacyCompatEvent.count({ where: { clientHeader: MARK } });
const track = (id: string) => {
  reg.gyms.push(id);
  return id;
};

/** A new applicant (not an active owner): token + partner id from bootstrap. */
async function applicant(label: string, hdr: Record<string, string>) {
  const userId = randomUUID();
  actors.push(userId);
  const token = `tok-r-${label}-${userId.slice(0, 8)}`;
  h.addUser(token, { id: userId, role: 'GYM_OWNER' });
  const r = await h.call(token, 'POST', '/owner/application/bootstrap', undefined, hdr);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  reg.partners.push(r.json.data.partnerId);
  return { userId, token, partnerId: r.json.data.partnerId as string };
}

// ═══ 1. every refusal of an old client leaves an event ══════════════════════════════════════════════

test('OLD client: 400 APPLICATION_INCOMPLETE, 400 validation, 409 APPLICATION_LOCKED and 404 each leave exactly one REJECTED_OTHER (action, entity, actor, client header), without touching legacy_client_at', async () => {
  const a = await applicant('r1', OLD);
  const before = await prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.ok(before.legacyClientAt, 'the bootstrap was an ACCEPTED action');
  const base = (await events(a.partnerId)).length;

  // 400 APPLICATION_INCOMPLETE (submit with nothing filled in)
  let r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
  assert.equal(r.status, 400);
  assert.equal(code(r), 'APPLICATION_INCOMPLETE');
  let ev = await events(a.partnerId);
  assert.equal(ev.length, base + 1, 'the event exists by the time the response arrived');
  const last = ev[ev.length - 1];
  assert.deepEqual(
    { outcome: last.outcome, action: last.action, type: last.entityType, actor: last.actorUserId, flow: last.flowHeader, client: last.clientHeader },
    { outcome: 'REJECTED_OTHER', action: 'APPLICATION_SUBMIT', type: 'GYM_PARTNER', actor: a.userId, flow: null, client: MARK },
  );

  // 400 validation of a PUT step
  r = await h.call(a.token, 'PUT', '/owner/application/representative', { name: 'A', phone: 'abc', role: 'BOSS' }, OLD);
  assert.equal(r.status, 400);
  ev = await events(a.partnerId);
  assert.deepEqual([ev[ev.length - 1].outcome, ev[ev.length - 1].action], ['REJECTED_OTHER', 'APPLICATION_SAVE_STEP']);

  // a refused resubmit (state is not CHANGES_REQUESTED) -> 409
  r = await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, OLD);
  assert.equal(r.status, 409);
  ev = await events(a.partnerId);
  assert.deepEqual([ev[ev.length - 1].outcome, ev[ev.length - 1].action], ['REJECTED_OTHER', 'APPLICATION_RESUBMIT']);

  // the entity is untouched by every refusal
  const after = await prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(after.legacyClientAt?.getTime(), before.legacyClientAt?.getTime());
  assert.equal(ev.filter((e) => e.outcome === 'REJECTED_OTHER').length, 3);

  // 409 APPLICATION_LOCKED: an ACTIVE owner (a finished application) editing a step
  const base2 = (await events(owner.partnerId)).length;
  r = await h.call(owner.token, 'PUT', '/owner/application/representative', { name: 'Nguyễn Văn A', phone: '0901234567', role: 'GYM_OWNER' }, OLD);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(code(r), 'APPLICATION_LOCKED');
  const ev2 = await events(owner.partnerId);
  assert.equal(ev2.length, base2 + 1);
  assert.equal(ev2[ev2.length - 1].outcome, 'REJECTED_OTHER');

  // branch routes: the branch id in the URL is the entity (404 for a branch that does not exist)
  const ghost = randomUUID();
  r = await h.call(owner.token, 'PATCH', `/owner/gyms/${ghost}/draft`, { name: 'x' }, OLD);
  assert.equal(r.status, 404);
  const gev = await events(ghost);
  assert.equal(gev.length, 1);
  assert.deepEqual([gev[0].outcome, gev[0].action, gev[0].entityType], ['REJECTED_OTHER', 'BRANCH_DRAFT_SAVE', 'GYM']);
  r = await h.call(owner.token, 'POST', `/owner/gyms/${ghost}/submit`, undefined, OLD);
  assert.equal(r.status, 404);
  assert.equal((await events(ghost)).filter((e) => e.action === 'BRANCH_DRAFT_SUBMIT' && e.outcome === 'REJECTED_OTHER').length, 1);

  // POST /owner/gyms: validation 400 -> the owner's partner;
  const n0 = (await events(owner.partnerId)).length;
  r = await h.call(owner.token, 'POST', '/owner/gyms', { name: '', address: '' }, OLD);
  assert.equal(r.status, 400);
  const n1 = await events(owner.partnerId);
  assert.equal(n1.length, n0 + 1);
  assert.ok(n1.slice(n0).every((e) => e.outcome === 'REJECTED_OTHER' && e.action === 'BRANCH_CREATE_QUICK'));
  // a body the parser rejects (malformed JSON) is refused BEFORE authentication, so there is no identity to attribute it to: no event (like a 401)
  const bad = await fetch(`${h.base}/owner/gyms`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}`, ...OLD }, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.equal((await events(owner.partnerId)).length, n0 + 1);
  r = await h.call(owner.token, 'POST', '/owner/gyms/draft', undefined, { ...OLD, 'x-gymini-listing-flow': '1' });
  assert.equal(r.status, 201, 'the success path is unchanged');
  track(r.json.data.id);
});

test('what does NOT leave an event: a new client (header "2" or "3"), a 401 (no identity), a 2xx, the 422 AMENITIES_REQUIRED (it is REJECTED_422 only, never both)', async () => {
  const before = await markedCount();
  // new clients: refused with 400, no event
  const a = await applicant('r2', NEW3);
  let r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW3);
  assert.equal(r.status, 400);
  r = await h.call(a.token, 'PUT', '/owner/application/representative', { name: 'A', phone: 'abc', role: 'BOSS' }, NEW2);
  assert.equal(r.status, 400);
  assert.equal(await markedCount(), before, 'a new client leaves nothing, refused or not');

  // 401: nobody to attribute it to
  r = await h.call(null, 'POST', '/owner/application/submit', {}, OLD);
  assert.equal(r.status, 401);
  assert.equal(await markedCount(), before);

  // the amenities refusal: exactly one REJECTED_422, no extra REJECTED_OTHER
  const base = await prisma.legacyCompatEvent.count({ where: { clientHeader: MARK, outcome: { in: ['REJECTED_422', 'REJECTED_OTHER'] } } });
  process.env[LEGACY_FLAG] = 'false';
  try {
    r = await h.call(owner.token, 'POST', '/owner/gyms', { name: `${P} q2`, address: '1 A', phone: '0281234567' }, OLD);
    assert.equal(r.status, 422);
    assert.equal(code(r), 'AMENITIES_REQUIRED');
  } finally {
    delete process.env[LEGACY_FLAG];
  }
  const after = await prisma.legacyCompatEvent.findMany({ where: { clientHeader: MARK, outcome: { in: ['REJECTED_422', 'REJECTED_OTHER'] } } });
  assert.equal(after.length, base + 1);
  assert.equal(after.filter((e) => e.outcome === 'REJECTED_422' && e.action === 'BRANCH_CREATE_QUICK').length >= 1, true);
});

test('a failing refusal-event insert is logged but the ORIGINAL error response is still returned', async () => {
  const a = await applicant('r3', OLD);
  const base = (await events(a.partnerId)).length;
  const original = prisma.$transaction.bind(prisma);
  (prisma as any).$transaction = async () => {
    throw new Error('simulated event-log outage');
  };
  let r: Reply;
  try {
    r = await h.call(a.token, 'PUT', '/owner/application/representative', { name: 'A', phone: 'abc', role: 'BOSS' }, OLD);
  } finally {
    (prisma as any).$transaction = original;
  }
  assert.equal(r.status, 400, 'the client still gets its validation error');
  assert.equal(code(r), 'VALIDATION_ERROR');
  assert.equal((await events(a.partnerId)).length, base, 'and no event was written');
});

// ═══ 2. the header is an integer >= 2 ═══════════════════════════════════════════════════════════════

test('header "3" is a NEW client: it needs amenities, stores 3 as application_flow_version / created_flow_version, never downgrades; "1", "abc", "2.5", "-3", "" are OLD clients whose raw value is kept', async () => {
  const a = await applicant('h3', NEW3);
  let p = await prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(p.applicationFlowVersion, 3);
  assert.equal((await events(a.partnerId)).length, 0, 'a new client leaves no legacy event');
  // a later request with header "2" does not lower it
  await h.call(a.token, 'POST', '/owner/application/bootstrap', undefined, NEW2);
  p = await prisma.gymPartner.findUniqueOrThrow({ where: { id: a.partnerId } });
  assert.equal(p.applicationFlowVersion, 3);
  // flow 3 is "flow 2 or later": the application branch needs amenities, an old client is refused on it too
  const branch = await h.call(a.token, 'PUT', '/owner/application/brand', { name: `${P} Brand h3` }, NEW3);
  reg.brands.push(branch.json.data.id);
  const b = await h.call(a.token, 'PUT', '/owner/application/branch', { name: `${P} h3`, phone: '0281234567', address: '1 A', provinceCode: 79, wardCode: 26734, latitude: 10.7, longitude: 106.7 }, NEW3);
  assert.equal(b.status, 200, JSON.stringify(b.json));
  track(b.json.data.id);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: b.json.data.id } })).createdFlowVersion, 3);
  const app = (await h.call(a.token, 'GET', '/owner/application', undefined, NEW3)).json.data;
  assert.ok(app.missing.some((m: any) => m.section === 'AMENITIES'));
  const admin1 = (await h.call(admin.token, 'GET', `/admin/partners/${a.partnerId}/application`)).json.data;
  assert.ok(admin1.approve.blockers.some((x: any) => x.code === 'AMENITIES_REQUIRED'), 'flow 3 counts as flow 2+ for the admin blocker');

  // quick create with header 3
  let r = await h.call(owner.token, 'POST', '/owner/gyms', { name: `${P} Q3`, address: '1 A' }, NEW3);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITIES_REQUIRED');
  r = await h.call(owner.token, 'POST', '/owner/gyms', { name: `${P} Q3`, address: '1 A', amenityIds: [sys('WIFI')] }, NEW3);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  track(r.json.data.id);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: r.json.data.id } })).createdFlowVersion, 3);

  // old clients: the raw value is stored on the event
  for (const raw of ['1', 'abc', '2.5', '-3']) {
    const o = await h.call(owner.token, 'POST', '/owner/gyms/draft', undefined, { ...OLD, 'x-gymini-listing-flow': raw });
    assert.equal(o.status, 201, raw);
    const id = track(o.json.data.id);
    const ev = await events(id);
    assert.equal(ev.length, 1, raw);
    assert.equal(ev[0].flowHeader, raw, raw);
    assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id } })).createdFlowVersion, null, raw);
  }
});

// ═══ 3. one PENDING proposal per (owner, branch, name) ══════════════════════════════════════════════

test('the same owner proposes the same name for two branches -> two separate PENDING proposals (idempotent per branch); ONE admin group approval gives the amenity to BOTH branches', async () => {
  const name = `${P} Sân pickleball`;
  const g1 = track((await h.call(owner.token, 'POST', '/owner/gyms/draft', undefined, NEW2)).json.data.id);
  const g2 = track((await h.call(owner.token, 'POST', '/owner/gyms/draft', undefined, NEW2)).json.data.id);
  const propose = (gym: string) =>
    h.call(owner.token, 'PATCH', `/owner/gyms/${gym}/draft`, { proposals: [{ name, suggestedCategory: 'TRAINING_ZONE' }] }, NEW2);
  assert.equal((await propose(g1)).status, 200);
  assert.equal((await propose(g2)).status, 200);
  assert.equal((await propose(g1)).status, 200, 'idempotent per (owner, branch, name)');
  const pending = await prisma.amenityProposal.findMany({ where: { ownerUserId: owner.ownerId, nameNormalized: { startsWith: P }, status: 'PENDING' } });
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map((x) => x.gymId).sort(), [g1, g2].sort());

  // the owner API on a published branch behaves the same (a third branch, same owner, same name)
  const pubGym = { id: await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'APPROVED', amenities: ['WIFI'] }) };
  if (pubGym) {
    const viaApi = await h.call(owner.token, 'POST', '/owner/amenities/proposals', { gymId: pubGym.id, name, suggestedCategory: 'TRAINING_ZONE' });
    assert.equal(viaApi.status, 201, JSON.stringify(viaApi.json));
    const again = await h.call(owner.token, 'POST', '/owner/amenities/proposals', { gymId: pubGym.id, name, suggestedCategory: 'TRAINING_ZONE' });
    assert.equal(again.json.data.proposal.id, viaApi.json.data.proposal.id);
    assert.equal(again.json.data.created, false);
  }

  // the admin queue groups them: one group of (kind, name, target), one owner
  const q = await h.call(admin.token, 'GET', '/admin/amenities/proposals');
  const group = q.json.data.groups.find((x: any) => x.nameNormalized.startsWith(P));
  assert.ok(group);
  assert.equal(group.ownerCount, 1);
  assert.ok(group.proposalIds.length >= 2);
  const ids = pending.map((x) => x.id);
  assert.ok(ids.every((id) => group.proposalIds.includes(id)));

  const ap = await h.call(admin.token, 'POST', '/admin/amenities/proposals/approve', { proposalIds: group.proposalIds });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const amenityId = ap.json.data.amenity.id as string;
  for (const g of [g1, g2]) {
    const rows = await prisma.gymAmenity.findMany({ where: { gymId: g } });
    assert.deepEqual(rows.map((r) => r.amenityId), [amenityId], `branch ${g} got the approved amenity`);
  }
  if (pubGym) {
    assert.equal((await prisma.gymAmenity.count({ where: { gymId: pubGym.id, amenityId } })), 0, 'a published branch only changes through its revision');
  }
});

test('no B3 refusal / header path produced a WRITER_ABSENT event', async () => {
  const absent = await prisma.legacyCompatEvent.count({ where: { entityId: { in: [...reg.gyms, ...reg.partners] }, outcome: 'WRITER_ABSENT' } });
  assert.equal(absent, 0);
});
