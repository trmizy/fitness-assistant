/**
 * Listing Management B3 - add-branch paths: POST /owner/gyms (the mobile quick create) and the wizard (POST /owner/gyms/draft,
 * PATCH /owner/gyms/:id/draft, POST /owner/gyms/:id/submit) with the amenity selection and the legacy-client matrix of plan
 * section 3 / 12.8:
 *
 *   X-Gymini-Listing-Flow: 2 (new client)  -> >= 1 amenity or proposal, else 422 AMENITIES_REQUIRED (flag on or off), no event
 *   no header + flag ON                    -> accepted, legacy_no_amenities when 0, ACCEPTED event (same transaction) + legacy_client_at
 *   no header + flag OFF                   -> 422 AMENITIES_REQUIRED ("cập nhật ứng dụng") + REJECTED_422 event in its own transaction
 *
 * Evidence label: BACKEND INTEGRATION - the real Express app over an isolated `*_test` database; auth-service is a TEST FIXTURE.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { gymHoursService } from '../services/gym-hours.service';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';
import { cleanupAll, makeOwnerUser, newRegistry, startHarness, type Harness, type OwnerFx, type Reply } from './listing-b2.test-helpers';

const reg = newRegistry();
const P = `zzb3b${randomUUID().slice(0, 5)}`;
const NEW = { 'x-gymini-listing-flow': '2', 'x-gymini-client': 'web/b3-test' };
const OLD = { 'x-gymini-client': 'mobile/old-apk' };
const LEGACY_FLAG = 'LISTING_LEGACY_CLIENT_COMPAT';
let savedFlag: string | undefined;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let owner: OwnerFx;

test.before(async () => {
  if (skip) return;
  savedFlag = process.env[LEGACY_FLAG];
  delete process.env[LEGACY_FLAG];
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  owner = await makeOwnerUser(reg, h, 'B3');
});

test.after(async () => {
  if (skip) return;
  if (savedFlag === undefined) delete process.env[LEGACY_FLAG];
  else process.env[LEGACY_FLAG] = savedFlag;
  await h.stop();
  await prisma.legacyCompatEvent.deleteMany({ where: { actorUserId: owner.ownerId } });
  await cleanupAll(reg, { amenityNamePrefix: P });
  await prisma.$disconnect();
});

const code = (r: Reply) => r.json?.error?.code;
const sys = (slug: string) => `amenity-sys-${slug.toLowerCase().replace(/_/g, '-')}`;
const FLAG_OFF = async (fn: () => Promise<void>) => {
  process.env[LEGACY_FLAG] = 'false';
  try {
    await fn();
  } finally {
    delete process.env[LEGACY_FLAG];
  }
};
const events = (entityId: string) => prisma.legacyCompatEvent.findMany({ where: { entityId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
const gymRow = (id: string) => prisma.gym.findUniqueOrThrow({ where: { id } });
const amenityIdsOf = async (gymId: string) => (await prisma.gymAmenity.findMany({ where: { gymId } })).map((r) => r.amenityId).sort();
const ownerGymCount = () => prisma.gym.count({ where: { ownerId: owner.ownerId } });
const track = (gymId: string) => {
  reg.gyms.push(gymId);
  return gymId;
};
const quick = (hdr: Record<string, string>, extra: Record<string, unknown> = {}) =>
  h.call(owner.token, 'POST', '/owner/gyms', { name: `${P} Quick ${randomUUID().slice(0, 4)}`, address: '2 Lê Lợi', city: 'TP.HCM', phone: '0281234567', ...extra }, hdr);

async function legacyClientAtMatchesLastAccepted(gymId: string) {
  const rows = await prisma.$queryRaw<{ ok: boolean | null }[]>`
    SELECT (g.legacy_client_at = (SELECT max(occurred_at) FROM legacy_compat_events WHERE entity_id = g.id AND outcome = 'ACCEPTED')) AS ok
      FROM gyms g WHERE g.id = ${gymId}`;
  return rows[0]?.ok === true;
}

// ═══ 1. POST /owner/gyms (quick create) ═════════════════════════════════════════════════════════════

test('quick create, NEW client: >= 1 amenity or 422 AMENITIES_REQUIRED (nothing created, no event); with amenityIds the branch is PENDING_REVIEW with its amenities + mirror; proposals-only is enough; a bad amenity id creates nothing', async () => {
  const before = await ownerGymCount();
  let r = await quick(NEW);
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(code(r), 'AMENITIES_REQUIRED');
  assert.match(r.json.message, /tiện ích/);
  assert.equal(await ownerGymCount(), before, 'rolled back: no branch');
  assert.equal(await prisma.legacyCompatEvent.count({ where: { actorUserId: owner.ownerId } }), 0, 'a new client leaves no legacy event');

  r = await quick(NEW, { amenityIds: [sys('WIFI'), sys('SAUNA')] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const gymId = track(r.json.data.id);
  let g = await gymRow(gymId);
  assert.equal(g.status, 'PENDING_REVIEW');
  assert.equal(g.createdFlowVersion, 2);
  assert.equal(g.legacyNoAmenities, false);
  assert.equal(g.legacyClientAt, null);
  assert.deepEqual(await amenityIdsOf(gymId), [sys('SAUNA'), sys('WIFI')]);
  assert.deepEqual([...g.facilities].sort(), ['SAUNA', 'WIFI'], 'mirror synced');
  assert.equal((await events(gymId)).length, 0);

  r = await quick(NEW, { proposals: [{ name: `${P} Phòng boxing`, suggestedCategory: 'TRAINING_ZONE' }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const g2 = track(r.json.data.id);
  assert.deepEqual(await amenityIdsOf(g2), []);
  const prop = await prisma.amenityProposal.findFirstOrThrow({ where: { gymId: g2 } });
  assert.equal(prop.status, 'PENDING');
  assert.equal(prop.ownerUserId, owner.ownerId);

  const n = await ownerGymCount();
  r = await quick(NEW, { amenityIds: ['amenity-sys-nope'] });
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITY_UNKNOWN');
  assert.equal(await ownerGymCount(), n, 'a refused selection creates no branch');

  r = await quick(NEW, { amenityIds: [sys('WIFI')], brandId: randomUUID() });
  assert.equal(r.status, 201, 'the schema is not strict here (older clients send extra fields): brandId is simply never read');
  track(r.json.data.id);
  g = await gymRow(r.json.data.id);
  assert.equal(g.brandId, owner.brandId);
});

test('quick create, OLD client + flag ON: accepted without amenities (legacy_no_amenities), exactly one ACCEPTED BRANCH_CREATE_QUICK event with the SAME instant as legacy_client_at; with amenities the flag is false', async () => {
  let r = await quick(OLD);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const gymId = track(r.json.data.id);
  const g = await gymRow(gymId);
  assert.equal(g.status, 'PENDING_REVIEW');
  assert.equal(g.createdFlowVersion, null);
  assert.equal(g.legacyNoAmenities, true);
  assert.deepEqual(await amenityIdsOf(gymId), []);
  const ev = await events(gymId);
  assert.equal(ev.length, 1);
  assert.deepEqual(
    { outcome: ev[0].outcome, action: ev[0].action, type: ev[0].entityType, actor: ev[0].actorUserId, flow: ev[0].flowHeader, client: ev[0].clientHeader },
    { outcome: 'ACCEPTED', action: 'BRANCH_CREATE_QUICK', type: 'GYM', actor: owner.ownerId, flow: null, client: 'mobile/old-apk' },
  );
  assert.ok(await legacyClientAtMatchesLastAccepted(gymId));
  assert.equal(r.json.data.legacyNoAmenities, true);

  r = await quick(OLD, { amenityIds: [sys('YOGA_STUDIO')] });
  assert.equal(r.status, 201);
  const g2 = track(r.json.data.id);
  assert.equal((await gymRow(g2)).legacyNoAmenities, false);
  assert.equal((await events(g2)).length, 1);
});

test('quick create, OLD client + flag OFF: 422 AMENITIES_REQUIRED ("cập nhật ứng dụng"), nothing created, a REJECTED_422 event (own transaction) on the applicant\'s partner; with amenities it is accepted', async () => {
  await FLAG_OFF(async () => {
    const n = await ownerGymCount();
    const before = await prisma.legacyCompatEvent.count({ where: { entityId: owner.partnerId, outcome: 'REJECTED_422' } });
    let r = await quick(OLD);
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(code(r), 'AMENITIES_REQUIRED');
    assert.match(r.json.message, /cập nhật ứng dụng/i);
    assert.equal(await ownerGymCount(), n);
    const rej = await prisma.legacyCompatEvent.findMany({ where: { entityId: owner.partnerId, outcome: 'REJECTED_422' }, orderBy: { occurredAt: 'asc' } });
    assert.equal(rej.length, before + 1);
    assert.equal(rej[rej.length - 1].action, 'BRANCH_CREATE_QUICK');
    assert.equal(rej[rej.length - 1].entityType, 'GYM_PARTNER');
    assert.equal(rej[rej.length - 1].actorUserId, owner.ownerId);

    r = await quick(OLD, { amenityIds: [sys('SAUNA')] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const gymId = track(r.json.data.id);
    assert.equal((await gymRow(gymId)).legacyNoAmenities, false);
    assert.equal((await events(gymId)).filter((e) => e.outcome === 'ACCEPTED').length, 1);
  });
  // a NEW client is refused the same way when the flag is off, and still leaves no event
  await FLAG_OFF(async () => {
    const events0 = await prisma.legacyCompatEvent.count({ where: { entityId: owner.partnerId } });
    const r = await quick(NEW);
    assert.equal(r.status, 422);
    assert.equal(await prisma.legacyCompatEvent.count({ where: { entityId: owner.partnerId } }), events0);
  });
});

// ═══ 2. the wizard ══════════════════════════════════════════════════════════════════════════════════

/** Fills a draft so submit's own validation passes (name / address, opening hours, the two required documents). */
async function makeSubmittable(gymId: string, hdr: Record<string, string>) {
  const r = await h.call(owner.token, 'PATCH', `/owner/gyms/${gymId}/draft`, { name: `${P} Wizard`, address: '3 Pasteur', phone: '0281234567', provinceCode: 79, wardCode: 26734, latitude: 10.77, longitude: 106.7 }, hdr);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await gymHoursService.setHours(gymId, owner.ownerId, [
    { day: 'MONDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'TUESDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'WEDNESDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'THURSDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'FRIDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'SATURDAY', type: 'CLOSED' },
    { day: 'SUNDAY', type: 'CLOSED' },
  ]);
  await gymBranchDocumentService.attachFile(gymId, owner.ownerId, 'LEASE_OR_PROPERTY_DOC', `${owner.ownerId}-${P}-lease.pdf`);
  await gymBranchDocumentService.attachFile(gymId, owner.ownerId, 'FACILITY_PHOTOS', `${owner.ownerId}-${P}-facility.jpg`);
}
const draft = async (hdr: Record<string, string>) => {
  const r = await h.call(owner.token, 'POST', '/owner/gyms/draft', undefined, hdr);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return track(r.json.data.id as string);
};

test('wizard create + save: a NEW client marks created_flow_version 2 and leaves no event; an OLD client leaves one BRANCH_DRAFT_CREATE and one BRANCH_DRAFT_SAVE per request, each with legacy_client_at on the same instant', async () => {
  const n = await draft(NEW);
  assert.equal((await gymRow(n)).createdFlowVersion, 2);
  assert.equal((await gymRow(n)).legacyClientAt, null);
  const save = await h.call(owner.token, 'PATCH', `/owner/gyms/${n}/draft`, { name: `${P} N`, wizardStep: 2 }, NEW);
  assert.equal(save.status, 200);
  assert.equal((await events(n)).length, 0);

  const o = await draft(OLD);
  let g = await gymRow(o);
  assert.equal(g.createdFlowVersion, null);
  assert.ok(g.legacyClientAt);
  assert.deepEqual((await events(o)).map((e) => [e.action, e.outcome]), [['BRANCH_DRAFT_CREATE', 'ACCEPTED']]);
  assert.ok(await legacyClientAtMatchesLastAccepted(o));

  const s1 = await h.call(owner.token, 'PATCH', `/owner/gyms/${o}/draft`, { name: `${P} O`, wizardStep: 2 }, OLD);
  assert.equal(s1.status, 200);
  const s2 = await h.call(owner.token, 'PATCH', `/owner/gyms/${o}/draft`, { locationNote: 'gần chợ' }, OLD);
  assert.equal(s2.status, 200);
  const ev = await events(o);
  assert.deepEqual(ev.map((e) => e.action), ['BRANCH_DRAFT_CREATE', 'BRANCH_DRAFT_SAVE', 'BRANCH_DRAFT_SAVE']);
  assert.ok(ev.every((e) => e.clientHeader === 'mobile/old-apk' && e.flowHeader === null));
  assert.ok(await legacyClientAtMatchesLastAccepted(o), 'legacy_client_at moved with EVERY compat action');
  g = await gymRow(o);
  assert.equal(g.legacyClientAt?.getTime(), ev[2].occurredAt.getTime());

  // the draft PATCH stays strict: an unknown key is a 400 and writes nothing to the branch
  const bad = await h.call(owner.token, 'PATCH', `/owner/gyms/${o}/draft`, { name: 'x', approvedName: 'hack' }, OLD);
  assert.equal(bad.status, 400);
  const after = await events(o);
  assert.equal(after.length, 4, 'the refused request leaves exactly one more event ...');
  assert.equal(after[3].outcome, 'REJECTED_OTHER', '... a REJECTED_OTHER (an old client)');
  assert.equal((await gymRow(o)).legacyClientAt?.getTime(), ev[2].occurredAt.getTime(), 'and does not move legacy_client_at');
});

test('wizard amenities: PATCH draft with amenityIds / proposals / proposalIds writes the DRAFT branch selection (authoritative amenityIds over the older facilities labels, mirror synced)', async () => {
  const id = await draft(NEW);
  let r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { amenityIds: [sys('WIFI')], facilities: ['SAUNA'] }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await amenityIdsOf(id), [sys('WIFI')], 'amenityIds wins over facilities');
  assert.deepEqual((await gymRow(id)).facilities, ['WIFI']);

  r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { facilities: ['SAUNA', 'WIFI'] }, NEW);
  assert.equal(r.status, 200);
  assert.deepEqual(await amenityIdsOf(id), [sys('SAUNA'), sys('WIFI')], 'the older facilities-only request still works');

  r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { amenityIds: [], proposals: [{ name: `${P} Sân tennis`, suggestedCategory: 'TRAINING_ZONE' }] }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await amenityIdsOf(id), []);
  const prop = await prisma.amenityProposal.findFirstOrThrow({ where: { gymId: id, status: 'PENDING' } });
  r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { proposalIds: [] }, NEW);
  assert.equal((await prisma.amenityProposal.findUniqueOrThrow({ where: { id: prop.id } })).status, 'CANCELLED');

  r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { amenityIds: ['amenity-sys-nope'] }, NEW);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITY_UNKNOWN');
});

test('owner GET /owner/gyms/:id returns the DRAFT branch amenity selection (custom included) and its pending proposals, so a wizard re-opened elsewhere keeps them', async () => {
  const id = await draft(NEW);
  let r = await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { amenityIds: [sys('WIFI'), sys('SAUNA')], proposals: [{ name: `${P} Phòng boxing`, suggestedCategory: 'TRAINING_ZONE' }] }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await h.call(owner.token, 'GET', `/owner/gyms/${id}`, undefined, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.amenities.map((a: { id: string }) => a.id).sort(), [sys('SAUNA'), sys('WIFI')].sort());
  assert.equal(r.json.data.amenityProposals.length, 1);
  assert.equal(r.json.data.amenityProposals[0].status, 'PENDING');
});

test('wizard submit, NEW client: 422 AMENITIES_REQUIRED without any (stays DRAFT, no event); 400 lists "amenities" among the other missing items; with an amenity or a proposal it is PENDING_REVIEW', async () => {
  const id = await draft(NEW);
  // other items missing as well -> 400 with everything listed, amenities included
  let r = await h.call(owner.token, 'POST', `/owner/gyms/${id}/submit`, undefined, NEW);
  assert.equal(r.status, 400);
  assert.ok(r.json.error.issues.some((i: any) => i.field === 'amenities'));
  assert.ok(r.json.error.issues.length > 1);

  await makeSubmittable(id, NEW);
  r = await h.call(owner.token, 'POST', `/owner/gyms/${id}/submit`, undefined, NEW);
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(code(r), 'AMENITIES_REQUIRED');
  assert.equal((await gymRow(id)).status, 'DRAFT');
  assert.equal((await events(id)).length, 0);

  await h.call(owner.token, 'PATCH', `/owner/gyms/${id}/draft`, { amenityIds: [sys('WIFI')] }, NEW);
  r = await h.call(owner.token, 'POST', `/owner/gyms/${id}/submit`, undefined, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await gymRow(id)).status, 'PENDING_REVIEW');
  assert.equal((await gymRow(id)).legacyNoAmenities, false);

  // a proposal alone
  const p = await draft(NEW);
  await makeSubmittable(p, NEW);
  await h.call(owner.token, 'PATCH', `/owner/gyms/${p}/draft`, { proposals: [{ name: `${P} Quầy sinh tố`, suggestedCategory: 'SERVICE' }] }, NEW);
  r = await h.call(owner.token, 'POST', `/owner/gyms/${p}/submit`, undefined, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('wizard submit, OLD client: flag ON accepts 0 amenities (legacy_no_amenities, ACCEPTED BRANCH_DRAFT_SUBMIT, same instant); flag OFF is 422 + REJECTED_422 and the draft is untouched; a draft started by a NEW client stays flow 2 (sticky)', async () => {
  const on = await draft(OLD);
  await makeSubmittable(on, OLD);
  const r = await h.call(owner.token, 'POST', `/owner/gyms/${on}/submit`, undefined, OLD);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = await gymRow(on);
  assert.equal(g.status, 'PENDING_REVIEW');
  assert.equal(g.legacyNoAmenities, true);
  const ev = await events(on);
  assert.equal(ev[ev.length - 1].action, 'BRANCH_DRAFT_SUBMIT');
  assert.equal(ev[ev.length - 1].outcome, 'ACCEPTED');
  assert.ok(await legacyClientAtMatchesLastAccepted(on));

  const off = await draft(OLD);
  await makeSubmittable(off, OLD);
  await FLAG_OFF(async () => {
    const before = await gymRow(off);
    const rr = await h.call(owner.token, 'POST', `/owner/gyms/${off}/submit`, undefined, OLD);
    assert.equal(rr.status, 422, JSON.stringify(rr.json));
    assert.equal(code(rr), 'AMENITIES_REQUIRED');
    assert.match(rr.json.message, /cập nhật ứng dụng/i);
    const after = await gymRow(off);
    assert.equal(after.status, 'DRAFT');
    assert.equal(after.legacyClientAt?.getTime(), before.legacyClientAt?.getTime(), 'a refused request does not touch legacy_client_at');
    const e2 = await events(off);
    const rej = e2.filter((e) => e.outcome === 'REJECTED_422');
    assert.equal(rej.length, 1);
    assert.equal(rej[0].action, 'BRANCH_DRAFT_SUBMIT');
    assert.ok(await legacyClientAtMatchesLastAccepted(off));
  });

  const sticky = await draft(NEW);
  await makeSubmittable(sticky, NEW);
  const s = await h.call(owner.token, 'POST', `/owner/gyms/${sticky}/submit`, undefined, OLD);
  assert.equal(s.status, 422, 'created by a flow-2 client: an old client cannot submit it without amenities');
  assert.equal((await events(sticky)).filter((e) => e.outcome === 'REJECTED_422').length, 1);
});

test('ownership: another owner cannot touch this owner\'s draft through the amenity fields (identity from the token)', async () => {
  const mine = await draft(NEW);
  const other = await makeOwnerUser(reg, h, 'B3o');
  const r = await h.call(other.token, 'PATCH', `/owner/gyms/${mine}/draft`, { amenityIds: [sys('WIFI')] }, NEW);
  assert.ok(r.status === 404 || r.status === 403 || r.status === 409, String(r.status));
  assert.deepEqual(await amenityIdsOf(mine), []);
});

test('no add-branch path produced a WRITER_ABSENT event', async () => {
  const absent = await prisma.legacyCompatEvent.count({ where: { entityId: { in: [...reg.gyms, ...reg.partners] }, outcome: 'WRITER_ABSENT' } });
  assert.equal(absent, 0);
});
