/**
 * Listing Management B2 - the AMENITY CATALOGUE and PROPOSALS (plan §12.3), over HTTP.
 * Evidence label: BACKEND INTEGRATION - real Express app + real `*_test` database; auth-service is a TEST FIXTURE.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/listing-b2-amenities.integration.test.ts
 *
 * Covers the eight concurrency / name-conflict cases listed in §12.3 ("bổ sung ở v5"), the owner proposal matrix, group
 * approve / reject / merge with the effect on open revisions, disabling an amenity while a DRAFT and a PENDING revision
 * are open, the admin catalogue endpoints and the audit rows. Custom amenities created here carry a unique name prefix
 * and are removed afterwards; SYSTEM amenities are only toggled for the few milliseconds a test needs (rarely used ones).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { setListingPhotoStorage } from '../services/listing-photo-storage';
import { normalizeAmenityName } from '../services/amenity-catalog';
import {
  MemoryListingStorage,
  amenityBySlug,
  cleanupAll,
  makeAdminUser,
  makeOwnerUser,
  makePublishedGym,
  newRegistry,
  payloadOf,
  seed,
  startHarness,
  type Harness,
  type OwnerFx,
  type Reply,
} from './listing-b2.test-helpers';

const reg = newRegistry();
const storage = new MemoryListingStorage();
const P = `zzb2${randomUUID().slice(0, 5)}`; // every custom amenity name of this file starts with it
const nm = (s: string) => `${P} ${s}`;
let restoreStorage: () => void;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let userClient: typeof import('../clients/user.client').userClient;
let ownerA: OwnerFx;
let ownerB: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;
let admin2: ReturnType<typeof makeAdminUser>;

test.before(async () => {
  if (skip) return;
  restoreStorage = setListingPhotoStorage(storage);
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  userClient = (await import('../clients/user.client')).userClient;
  ownerA = await makeOwnerUser(reg, h, 'A');
  ownerB = await makeOwnerUser(reg, h, 'B');
  admin = makeAdminUser(h, 'adm1');
  admin2 = makeAdminUser(h, 'adm2');
});

test.after(async () => {
  if (skip) return;
  restoreStorage();
  await h.stop();
  await cleanupAll(reg, { adminIds: [admin.adminId, admin2.adminId], amenityNamePrefix: P });
  await prisma.$disconnect();
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const code = (r: Reply) => r.json?.error?.code;
const L = (gymId: string, sub = '') => `/owner/gyms/${gymId}/listing${sub}`;
const A = (path: string) => `/admin/listings/gyms${path}`;
const gymOf = (owner: OwnerFx = ownerA, opts: Parameters<typeof makePublishedGym>[3] = {}) => makePublishedGym(reg, storage, owner, { photos: 1, ...opts });
const propose = (owner: OwnerFx, gymId: string, name: string, cat = 'TRAINING_ZONE', extra: Record<string, unknown> = {}) =>
  h.call(owner.token, 'POST', '/owner/amenities/proposals', { gymId, name, suggestedCategory: cat, ...extra });
const adminCreate = (tok: string, name: string, category = 'FACILITY', iconKey = 'wifi') => h.call(tok, 'POST', '/admin/amenities', { name, category, iconKey });
const approve = (tok: string, proposalIds: string[], extra: Record<string, unknown> = {}) => h.call(tok, 'POST', '/admin/amenities/proposals/approve', { proposalIds, ...extra });
const reject = (tok: string, proposalIds: string[], reason = 'Không phù hợp') => h.call(tok, 'POST', '/admin/amenities/proposals/reject', { proposalIds, reason });
const merge = (tok: string, proposalIds: string[], targetAmenityId: string, extra: Record<string, unknown> = {}) =>
  h.call(tok, 'POST', '/admin/amenities/proposals/merge', { proposalIds, targetAmenityId, ...extra });
const setStatus = (tok: string, id: string, status: 'ACTIVE' | 'DISABLED') => h.call(tok, 'PATCH', `/admin/amenities/${id}`, { status });
const proposalRow = (id: string) => prisma.amenityProposal.findUniqueOrThrow({ where: { id } });
const revRow = (id: string) => prisma.gymListingRevision.findUniqueOrThrow({ where: { id } });
const catalogueCount = (norm: string) => prisma.amenity.count({ where: { nameNormalized: norm } });

/** A custom amenity created through the admin endpoint (optionally DISABLED). */
async function makeCustom(name: string, opts: { disabled?: boolean; category?: string } = {}) {
  const r = await adminCreate(admin.token, name, opts.category ?? 'FACILITY');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.data.amenity.id as string;
  if (opts.disabled) assert.equal((await setStatus(admin.token, id, 'DISABLED')).status, 200);
  return id;
}

/** The owner's draft of `gymId` with `proposalIds` / `amenityIds` in it; `submit` sends it to review. */
async function draftWithProposals(owner: OwnerFx, gymId: string, proposalIds: string[], opts: { submit?: boolean; amenityIds?: string[]; description?: string } = {}) {
  const lr = await h.call(owner.token, 'GET', L(gymId));
  assert.equal(lr.status, 200);
  const l = lr.json.data;
  const d = await h.call(owner.token, 'POST', L(gymId, '/draft'), {});
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const saved = await h.call(owner.token, 'PUT', L(gymId, '/draft'), {
    expectedDraftVersion: d.json.data.revision.draftVersion,
    payload: payloadOf(l, { proposalIds, amenityIds: opts.amenityIds, description: opts.description }),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  let rev = saved.json.data.revision;
  if (opts.submit) {
    const sub = await h.call(owner.token, 'POST', L(gymId, '/submit'), { expectedDraftVersion: rev.draftVersion });
    assert.equal(sub.status, 200, JSON.stringify(sub.json));
    rev = sub.json.data.revision;
  }
  return rev;
}

// ═══ owner: the proposal matrix ═══════════════════════════════════════════════════════════════════

test('propose: ACTIVE name -> matchedAmenity (nothing created); DISABLED -> REENABLE proposal (idempotent); NEW -> 201, own repeat -> same proposal; another owner gets a SEPARATE one; accents / case do not matter', async () => {
  const gA = await gymOf(ownerA);
  const gB = await gymOf(ownerB);

  // 1. an ACTIVE amenity: the SYSTEM "Wifi miễn phí", asked with other accents / case
  const m = await propose(ownerA, gA.gymId, 'WIFI MIEN PHI');
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(m.json.data.matchedAmenity.slug, 'WIFI');
  assert.equal(m.json.data.proposal, undefined);
  assert.equal(await prisma.amenityProposal.count({ where: { ownerUserId: ownerA.ownerId, nameNormalized: 'wifi mien phi' } }), 0);

  // 2. a DISABLED custom amenity -> REENABLE
  const futsal = await makeCustom(nm('sân futsal'), { disabled: true });
  const re1 = await propose(ownerA, gA.gymId, nm('SAN FUTSAL'));
  assert.equal(re1.status, 200, 'REENABLE answers 200 { proposal, kind }');
  assert.equal(re1.json.data.kind, 'REENABLE');
  assert.equal(re1.json.data.created, true);
  assert.equal(re1.json.data.proposal.targetAmenityId, futsal);
  assert.equal(re1.json.data.proposal.status, 'PENDING');
  const re2 = await propose(ownerA, gA.gymId, nm('sân  Futsal'));
  assert.equal(re2.status, 200);
  assert.equal(re2.json.data.created, false);
  assert.equal(re2.json.data.proposal.id, re1.json.data.proposal.id, 'own PENDING proposal comes back (idempotent)');

  // 3. a brand-new name
  const n1 = await propose(ownerA, gA.gymId, nm('Phòng Boxing'), 'TRAINING_ZONE', { note: 'Có sàn đấm bốc' });
  assert.equal(n1.status, 201, JSON.stringify(n1.json));
  assert.equal(n1.json.data.kind, 'NEW');
  assert.equal(n1.json.data.proposal.note, 'Có sàn đấm bốc');
  const n2 = await propose(ownerA, gA.gymId, nm('phong BOXING'));
  assert.equal(n2.status, 200);
  assert.equal(n2.json.data.proposal.id, n1.json.data.proposal.id);
  // another owner, same name -> their own proposal
  const n3 = await propose(ownerB, gB.gymId, nm('PHÒNG BOXING'));
  assert.equal(n3.status, 201);
  assert.notEqual(n3.json.data.proposal.id, n1.json.data.proposal.id);
  assert.equal(await prisma.amenityProposal.count({ where: { nameNormalized: normalizeAmenityName(nm('Phòng Boxing')), status: 'PENDING' } }), 2);

  // 4. validation
  assert.equal((await propose(ownerA, gA.gymId, 'x')).status, 400, 'name < 2 characters');
  assert.equal((await propose(ownerA, gA.gymId, 'x'.repeat(41))).status, 400, 'name > 40 characters');
  assert.equal((await propose(ownerA, gA.gymId, nm('ok'), 'WHATEVER')).status, 400);
  assert.equal((await propose(ownerA, gA.gymId, nm('ok2'), 'SERVICE', { status: 'APPROVED' })).status, 400, 'strict body');
  assert.equal((await h.call(ownerA.token, 'POST', '/owner/amenities/proposals', { name: nm('ok3'), suggestedCategory: 'SERVICE' })).status, 400, 'gymId is required');
  const foreign = await propose(ownerA, gB.gymId, nm('cổng bên ngoài'));
  assert.equal(foreign.status, 404, "another owner's branch is not found");
  assert.equal(code(foreign), 'GYM_NOT_FOUND');
  assert.equal((await propose(ownerA, gA.gymId, nm('ok4'))).status, 201);

  // 5. the owner's catalogue: ACTIVE only (the DISABLED futsal is absent), own proposals only
  const cat = await h.call(ownerA.token, 'GET', '/owner/amenities');
  assert.equal(cat.status, 200);
  assert.ok(cat.json.data.amenities.every((a: any) => a.status === 'ACTIVE'));
  assert.ok(cat.json.data.amenities.some((a: any) => a.slug === 'WIFI'));
  assert.ok(!cat.json.data.amenities.some((a: any) => a.id === futsal));
  assert.ok(cat.json.data.proposals.some((p: any) => p.id === n1.json.data.proposal.id));
  assert.ok(!cat.json.data.proposals.some((p: any) => p.id === n3.json.data.proposal.id), "never another owner's proposal");
});

test('concurrency: two owners propose the same name in parallel -> 2 separate proposals, no 500; one owner proposes it 5 times in parallel -> ONE proposal, every request gets the same id', async () => {
  const gA = await gymOf(ownerA);
  const gB = await gymOf(ownerB);
  const name = nm('khu cầu lông');
  const two = await Promise.all([propose(ownerA, gA.gymId, name), propose(ownerB, gB.gymId, name)]);
  assert.deepEqual(two.map((r) => r.status), [201, 201]);
  assert.notEqual(two[0].json.data.proposal.id, two[1].json.data.proposal.id);

  const name2 = nm('khu pickleball');
  const five = await Promise.all([1, 2, 3, 4, 5].map(() => propose(ownerA, gA.gymId, name2)));
  for (const r of five) assert.ok([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(five.filter((r) => r.status === 201).length, 1, 'exactly one request created it');
  assert.equal(new Set(five.map((r) => r.json.data.proposal.id)).size, 1);
  assert.equal(await prisma.amenityProposal.count({ where: { ownerUserId: ownerA.ownerId, nameNormalized: normalizeAmenityName(name2) } }), 1);
  assert.equal(await prisma.partnerAuditLog.count({ where: { partnerId: ownerA.partnerId, action: 'AMENITY_PROPOSED', metadata: { path: ['proposalId'], equals: five[0].json.data.proposal.id } } }), 1, 'one AMENITY_PROPOSED audit row');
});

// ═══ admin: deciding a group ═══════════════════════════════════════════════════════════════════════

test('approve a NEW group of two owners: ONE amenity (admin picks category / icon / sort), both proposals APPROVED -> same amenity, open revisions rewritten (DRAFT version +1, PENDING kept), audit rows, DRAFT_STALE for the stale client', async () => {
  const gA = await gymOf(ownerA);
  const gB = await gymOf(ownerB);
  const name = nm('Phòng Boxing 2');
  const pa = (await propose(ownerA, gA.gymId, name, 'TRAINING_ZONE')).json.data.proposal;
  const pb = (await propose(ownerB, gB.gymId, name.toUpperCase(), 'RECOVERY')).json.data.proposal;
  const revA = await draftWithProposals(ownerA, gA.gymId, [pa.id]); // DRAFT
  const revB = await draftWithProposals(ownerB, gB.gymId, [pb.id], { submit: true }); // PENDING

  // the queue groups them: "2 chủ gym cùng đề xuất"
  const q = await h.call(admin.token, 'GET', '/admin/amenities/proposals');
  assert.equal(q.status, 200);
  const group = q.json.data.groups.find((g: any) => g.nameNormalized === normalizeAmenityName(name));
  assert.ok(group, 'group present');
  assert.equal(group.kind, 'NEW');
  assert.equal(group.ownerCount, 2);
  assert.deepEqual([...group.proposalIds].sort(), [pa.id, pb.id].sort());
  assert.equal(group.existingAmenity, null);

  // invalid choices change nothing
  const badIcon = await approve(admin.token, group.proposalIds, { iconKey: 'not-an-icon' });
  assert.equal(badIcon.status, 422);
  assert.equal(code(badIcon), 'ICON_NOT_ALLOWED');
  const badName = await approve(admin.token, group.proposalIds, { name: nm('tên khác hẳn') });
  assert.equal(code(badName), 'NAME_MISMATCH');
  assert.equal((await proposalRow(pa.id)).status, 'PENDING');
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 0);

  const res = await approve(admin.token, group.proposalIds, { category: 'RECOVERY', iconKey: 'flame', sortOrder: 555, name: nm('Phòng Boxing 2') });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.outcome, 'APPROVED');
  const amenityId = res.json.data.amenity.id as string;
  const am = await prisma.amenity.findUniqueOrThrow({ where: { id: amenityId } });
  assert.equal(am.source, 'CUSTOM');
  assert.equal(am.status, 'ACTIVE');
  assert.equal(am.category, 'RECOVERY');
  assert.equal(am.iconKey, 'flame');
  assert.equal(am.sortOrder, 555);
  assert.equal(am.nameNormalized, normalizeAmenityName(name));
  assert.ok([pa.id, pb.id].includes(am.createdFromProposalId!));
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
  for (const id of [pa.id, pb.id]) {
    const row = await proposalRow(id);
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.resultingAmenityId, amenityId);
    assert.equal(row.reviewedBy, admin.adminId);
    assert.ok(row.reviewedAt);
  }

  // open revisions point at the new amenity now, exactly once
  const a2 = await revRow(revA.id);
  assert.equal(a2.status, 'DRAFT');
  assert.deepEqual((a2.payload as any).proposalIds, []);
  assert.deepEqual((a2.payload as any).amenityIds.filter((x: string) => x === amenityId), [amenityId]);
  assert.equal(a2.draftVersion, revA.draftVersion + 1, 'a DRAFT gets draft_version + 1');
  assert.deepEqual((a2.systemAdjustments as any[]).map((x) => x.type), ['PROPOSAL_APPROVED']);
  const b2 = await revRow(revB.id);
  assert.equal(b2.status, 'PENDING', 'a PENDING revision stays PENDING');
  assert.equal(b2.draftVersion, revB.draftVersion);
  assert.deepEqual((b2.payload as any).proposalIds, []);
  assert.ok((b2.payload as any).amenityIds.includes(amenityId));
  // the owner of the DRAFT still holds the old version number -> told to reload instead of overwriting
  const stale = await h.call(ownerA.token, 'PUT', L(gA.gymId, '/draft'), { expectedDraftVersion: revA.draftVersion, payload: payloadOf({ published: { payload: a2.payload } }) });
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'DRAFT_STALE');
  assert.ok(stale.json.revision.payload.amenityIds.includes(amenityId));

  // audit: one catalogue row for the decision, one partner row per proposal
  assert.equal(await prisma.amenityAuditLog.count({ where: { amenityId, action: 'AMENITY_PROPOSAL_APPROVED' } }), 1);
  for (const [owner, p] of [[ownerA, pa], [ownerB, pb]] as const) {
    assert.equal(await prisma.partnerAuditLog.count({ where: { partnerId: owner.partnerId, action: 'AMENITY_PROPOSAL_APPROVED', metadata: { path: ['proposalId'], equals: p.id } } }), 1);
  }
  const hist = await h.call(admin.token, 'GET', `/admin/amenities/${amenityId}/history`);
  assert.equal(hist.status, 200);
  assert.ok(hist.json.data.history.some((e: any) => e.action === 'AMENITY_PROPOSAL_APPROVED' && e.actorUserId === admin.adminId));

  // the approval of the PENDING revision now works and the amenity lands on the branch
  const ap = await h.call(admin.token, 'POST', A(`/revisions/${revB.id}/approve`), {});
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.ok((await prisma.gymAmenity.findMany({ where: { gymId: gB.gymId } })).some((r) => r.amenityId === amenityId));
  const pub = (await h.call(null, 'GET', `/gyms/${gB.gymId}`)).json.data;
  assert.ok(pub.amenities.some((x: any) => x.name === nm('Phòng Boxing 2')), 'public amenities[] shows it (facilities[] mirror cannot: CUSTOM has no enum value)');
  assert.ok(!pub.facilities.includes(am.slug));

  // a decided proposal cannot be decided again
  const again = await approve(admin2.token, [pa.id, pb.id]);
  assert.equal(again.status, 409);
  assert.equal(code(again), 'PROPOSAL_ALREADY_DECIDED');
});

test('approve refuses a mixed group (different names) with 422 and a missing id with 404; nothing is written', async () => {
  const gA = await gymOf(ownerA);
  const p1 = (await propose(ownerA, gA.gymId, nm('nhóm một'))).json.data.proposal.id;
  const p2 = (await propose(ownerA, gA.gymId, nm('nhóm hai'))).json.data.proposal.id;
  const mixed = await approve(admin.token, [p1, p2]);
  assert.equal(mixed.status, 422);
  assert.equal(code(mixed), 'PROPOSAL_GROUP_MISMATCH');
  assert.equal(code(await approve(admin.token, [p1, randomUUID()])), 'PROPOSAL_NOT_FOUND');
  assert.equal((await proposalRow(p1)).status, 'PENDING');
  assert.equal(await catalogueCount(normalizeAmenityName(nm('nhóm một'))), 0);
  assert.equal((await h.call(admin.token, 'POST', '/admin/amenities/proposals/approve', { proposalIds: [] })).status, 400);
});

test('CONCURRENCY - two admins approve the same NEW group (Promise.all): exactly one 200 and one 409 PROPOSAL_ALREADY_DECIDED; ONE new amenity; ONE audit row', async () => {
  const gA = await gymOf(ownerA);
  const gB = await gymOf(ownerB);
  const name = nm('Khu đấm bốc đôi');
  const ids = [(await propose(ownerA, gA.gymId, name)).json.data.proposal.id, (await propose(ownerB, gB.gymId, name)).json.data.proposal.id];
  const race = await Promise.all([approve(admin.token, ids), approve(admin2.token, ids)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(code(race.find((r) => r.status === 409)!), 'PROPOSAL_ALREADY_DECIDED');
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
  const winner = race.find((r) => r.status === 200)!.json.data.amenity.id;
  assert.equal(await prisma.amenityAuditLog.count({ where: { action: 'AMENITY_PROPOSAL_APPROVED', amenityId: winner } }), 1);
  assert.equal(await prisma.amenityAuditLog.count({ where: { proposalId: { in: ids }, action: { not: 'AMENITY_PROPOSED' } } }), 1, 'the loser wrote nothing at all');
  for (const id of ids) assert.equal((await proposalRow(id)).resultingAmenityId, winner);
});

test('CONCURRENCY - admin A approves NEW "Phòng boxing" while admin B creates "phong BOXING" directly: one amenity in the catalogue, proposal APPROVED (A first) or MERGED into B\'s (B first), never a 500', async () => {
  for (let round = 0; round < 3; round++) {
    const gA = await gymOf(ownerA);
    const name = nm(`Phòng boxing r${round}`);
    const pid = (await propose(ownerA, gA.gymId, name)).json.data.proposal.id;
    const [ap, cr] = await Promise.all([approve(admin.token, [pid]), adminCreate(admin2.token, nm(`phong BOXING r${round}`))]);
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    assert.ok([201, 409].includes(cr.status), `create answered ${cr.status} ${JSON.stringify(cr.json)}`);
    assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
    const row = await proposalRow(pid);
    if (cr.status === 201) {
      assert.equal(row.status, 'MERGED', 'B was first: the proposal joined B\'s amenity');
      assert.equal(row.resultingAmenityId, cr.json.data.amenity.id);
    } else {
      assert.equal(code(cr), 'AMENITY_NAME_TAKEN', 'A was first');
      assert.equal(row.status, 'APPROVED');
    }
    assert.ok(row.resultingAmenityId);
  }
});

test('approve NEW while a DISABLED amenity of that name exists: 409 AMENITY_EXISTS_DISABLED and nothing changes; the explicit "reenableAndMerge" then MERGES and re-enables (never implicitly)', async () => {
  const gA = await gymOf(ownerA);
  const name = nm('Phòng xông đá');
  const pid = (await propose(ownerA, gA.gymId, name)).json.data.proposal.id; // NEW: the name did not exist yet
  const existing = await makeCustom(name, { disabled: true }); // ... an admin then created and disabled it
  const rev = await draftWithProposals(ownerA, gA.gymId, [pid]);

  const blocked = await approve(admin.token, [pid]);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'AMENITY_EXISTS_DISABLED');
  assert.equal(blocked.json.amenity.id, existing);
  assert.equal((await proposalRow(pid)).status, 'PENDING');
  assert.equal((await prisma.amenity.findUniqueOrThrow({ where: { id: existing } })).status, 'DISABLED', 'no silent re-enable');
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
  assert.deepEqual(((await revRow(rev.id)).payload as any).proposalIds, [pid], 'the open revision was not touched');

  const merged = await approve(admin.token, [pid], { reenableAndMerge: true });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(merged.json.data.outcome, 'MERGED');
  assert.deepEqual(merged.json.data.reenabledAmenityIds, [existing]);
  const row = await proposalRow(pid);
  assert.equal(row.status, 'MERGED');
  assert.equal(row.resultingAmenityId, existing);
  assert.equal((await prisma.amenity.findUniqueOrThrow({ where: { id: existing } })).status, 'ACTIVE');
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
  const after = await revRow(rev.id);
  assert.ok(((after.payload as any).amenityIds as string[]).includes(existing));
  assert.deepEqual((after.systemAdjustments as any[]).map((x) => x.type), ['PROPOSAL_MERGED']);
});

test('approve REENABLE in parallel with an admin enabling the same amenity: still ONE catalogue row, both succeed, proposal APPROVED with resulting = target (REENABLE never inserts)', async () => {
  const gA = await gymOf(ownerA);
  const name = nm('Phòng massage');
  const target = await makeCustom(name, { disabled: true });
  const prop = (await propose(ownerA, gA.gymId, name)).json.data.proposal;
  assert.equal(prop.kind, 'REENABLE');
  const before = await prisma.amenity.count();
  const [en, ap] = await Promise.all([setStatus(admin.token, target, 'ACTIVE'), approve(admin2.token, [prop.id])]);
  assert.equal(en.status, 200, JSON.stringify(en.json));
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(await prisma.amenity.count(), before, 'no row was inserted');
  const row = await proposalRow(prop.id);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.resultingAmenityId, target);
  assert.equal((await prisma.amenity.findUniqueOrThrow({ where: { id: target } })).status, 'ACTIVE');

  // approving a REENABLE whose target is already ACTIVE is simply a no-op on the catalogue
  const again = (await propose(ownerA, gA.gymId, name)).json.data;
  assert.ok(again.matchedAmenity, 'an ACTIVE name is a match now, not a proposal');
});

test('CONCURRENCY - one admin approves, another rejects the same group: exactly one succeeds; the final state matches the winner; open revisions are rewritten exactly once', async () => {
  const gA = await gymOf(ownerA);
  const name = nm('Khu thiền');
  const pid = (await propose(ownerA, gA.gymId, name)).json.data.proposal.id;
  const rev = await draftWithProposals(ownerA, gA.gymId, [pid]);
  const race = await Promise.all([approve(admin.token, [pid]), reject(admin2.token, [pid], 'Trùng với dịch vụ khác')]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(code(race.find((r) => r.status === 409)!), 'PROPOSAL_ALREADY_DECIDED');
  const row = await proposalRow(pid);
  const after = await revRow(rev.id);
  const payload = after.payload as any;
  assert.deepEqual(payload.proposalIds, []);
  if (race[0].status === 200) {
    assert.equal(row.status, 'APPROVED');
    assert.equal(payload.amenityIds.filter((x: string) => x === row.resultingAmenityId).length, 1);
    assert.equal(await catalogueCount(normalizeAmenityName(name)), 1);
  } else {
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.resultingAmenityId, null);
    assert.equal(row.rejectReason, 'Trùng với dịch vụ khác');
    assert.equal(await catalogueCount(normalizeAmenityName(name)), 0);
  }
  assert.equal(after.draftVersion, rev.draftVersion + 1, 'rewritten once');
  assert.equal((after.systemAdjustments as any[]).length, 1);
});

test('reject: REJECTED with the reason (required), no resulting amenity, the proposal leaves every open revision with PROPOSAL_REJECTED_REMOVED, owner may propose again with another name', async () => {
  const gA = await gymOf(ownerA);
  const name = nm('Khu spa');
  const pid = (await propose(ownerA, gA.gymId, name)).json.data.proposal.id;
  const draft = await draftWithProposals(ownerA, gA.gymId, [pid], { description: 'Có spa mới' });
  assert.equal((await h.call(admin.token, 'POST', '/admin/amenities/proposals/reject', { proposalIds: [pid] })).status, 400, 'a reason is required');
  const r = await reject(admin.token, [pid], 'Spa không thuộc nhóm tiện ích');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.outcome, 'REJECTED');
  assert.equal(r.json.data.amenity, null);
  const row = await proposalRow(pid);
  assert.equal(row.status, 'REJECTED');
  assert.equal(row.resultingAmenityId, null);
  assert.equal(row.rejectReason, 'Spa không thuộc nhóm tiện ích');
  const rev = await revRow(draft.id);
  assert.deepEqual((rev.payload as any).proposalIds, []);
  assert.deepEqual((rev.systemAdjustments as any[]).map((x) => x.type), ['PROPOSAL_REJECTED_REMOVED']);
  assert.equal(await prisma.partnerAuditLog.count({ where: { partnerId: ownerA.partnerId, action: 'AMENITY_PROPOSAL_REJECTED', metadata: { path: ['proposalId'], equals: pid } } }), 1);
  assert.equal(await catalogueCount(normalizeAmenityName(name)), 0);
  // the same name can be proposed again (a REJECTED row does not hold the PENDING slot)
  assert.equal((await propose(ownerA, gA.gymId, name)).status, 201);
  // the owner's view: the proposal is REJECTED with the reason
  const mine = (await h.call(ownerA.token, 'GET', '/owner/amenities')).json.data.proposals.find((p: any) => p.id === pid);
  assert.equal(mine.status, 'REJECTED');
  assert.equal(mine.rejectReason, 'Spa không thuộc nhóm tiện ích');
});

test('merge: proposals join an existing ACTIVE amenity (MERGED, resulting = target, drafts rewritten); a DISABLED target is 409 AMENITY_EXISTS_DISABLED unless reenableAndMerge', async () => {
  const gA = await gymOf(ownerA);
  const target = await makeCustom(nm('Phòng tập boxing chuẩn'));
  const pid = (await propose(ownerA, gA.gymId, nm('Võ đường boxing'))).json.data.proposal.id;
  const rev = await draftWithProposals(ownerA, gA.gymId, [pid]);
  const m = await merge(admin.token, [pid], target);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(m.json.data.outcome, 'MERGED');
  const row = await proposalRow(pid);
  assert.equal(row.status, 'MERGED');
  assert.equal(row.resultingAmenityId, target);
  assert.ok((((await revRow(rev.id)).payload as any).amenityIds as string[]).includes(target));
  assert.equal(await prisma.partnerAuditLog.count({ where: { partnerId: ownerA.partnerId, action: 'AMENITY_PROPOSAL_MERGED', metadata: { path: ['proposalId'], equals: pid } } }), 1);

  const off = await makeCustom(nm('Phòng boxing cũ'), { disabled: true });
  const pid2 = (await propose(ownerA, gA.gymId, nm('Sàn boxing'))).json.data.proposal.id;
  const blocked = await merge(admin.token, [pid2], off);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'AMENITY_EXISTS_DISABLED');
  assert.equal((await proposalRow(pid2)).status, 'PENDING');
  assert.equal((await merge(admin.token, [pid2], off, { reenableAndMerge: true })).status, 200);
  assert.equal((await prisma.amenity.findUniqueOrThrow({ where: { id: off } })).status, 'ACTIVE');
  assert.equal(code(await merge(admin.token, [pid2], target)), 'PROPOSAL_ALREADY_DECIDED');
  assert.equal(code(await merge(admin.token, [pid2], randomUUID())), 'AMENITY_NOT_FOUND');
});

test('database CHECK: a hand-written APPROVED proposal without resulting_amenity_id is refused', async () => {
  const gA = await gymOf(ownerA);
  const pid = (await propose(ownerA, gA.gymId, nm('Kiểm tra ràng buộc'))).json.data.proposal.id;
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE amenity_proposals SET status = 'APPROVED' WHERE id = '${pid}'`), /check|23514|resulting/i);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE amenity_proposals SET status = 'MERGED' WHERE id = '${pid}'`), /check|23514|resulting/i);
  assert.equal((await proposalRow(pid)).status, 'PENDING');
});

// ═══ revisions that mention proposals / disabled amenities ════════════════════════════════════════

test('approving a revision that still references a PENDING proposal is blocked with 409 CUSTOM_AMENITY_PENDING; a dead (REJECTED) one needs dropRejectedAmenities', async () => {
  const gA = await gymOf(ownerA);
  const pid = (await propose(ownerA, gA.gymId, nm('Khu tập nhảy'))).json.data.proposal.id;
  const rev = await draftWithProposals(ownerA, gA.gymId, [pid], { submit: true, description: 'Mô tả cùng đề xuất' });
  const det = await h.call(admin.token, 'GET', A(`/revisions/${rev.id}`));
  assert.equal(det.json.data.flags.hasPendingProposal, true);
  assert.deepEqual(det.json.data.flags.pendingProposals.map((p: any) => p.id), [pid]);
  const blocked = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {});
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'CUSTOM_AMENITY_PENDING');
  assert.deepEqual(blocked.json.proposals.map((p: any) => p.id), [pid]);
  assert.equal((await revRow(rev.id)).status, 'PENDING');

  // once the proposal is rejected the PENDING revision loses it and can be approved
  assert.equal((await reject(admin.token, [pid])).status, 200);
  const ok = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  // a revision row that still carries a REJECTED proposal (written by hand) is refused unless the admin chooses to drop it
  const g2 = await gymOf(ownerA);
  const dead = (await propose(ownerA, g2.gymId, nm('Khu đã bị từ chối'))).json.data.proposal.id;
  await reject(admin.token, [dead]);
  const l2 = (await h.call(ownerA.token, 'GET', L(g2.gymId))).json.data;
  const stale = await seed((tx) =>
    tx.gymListingRevision.create({
      data: {
        gymId: g2.gymId,
        status: 'PENDING',
        baseVersion: 1,
        submittedAt: new Date(),
        payload: { ...payloadOf(l2), description: 'Có đề xuất đã chết', proposalIds: [dead] },
      },
    }),
  );
  const refused = await h.call(admin.token, 'POST', A(`/revisions/${stale.id}/approve`), {});
  assert.equal(refused.status, 409);
  assert.equal(code(refused), 'AMENITY_PROPOSAL_DEAD');
  const dropped = await h.call(admin.token, 'POST', A(`/revisions/${stale.id}/approve`), { dropRejectedAmenities: true });
  assert.equal(dropped.status, 200, JSON.stringify(dropped.json));
  assert.deepEqual(dropped.json.data.systemAdjustments.map((x: any) => x.type), ['PROPOSAL_REJECTED_REMOVED']);
});

test('disabling an amenity with an open DRAFT and a PENDING revision: the DRAFT loses it (version +1, adjustment), the PENDING one keeps it (flagged; approve needs dropDisabledAmenities); public + mirror follow; a new draft is never stuck; enabling restores the mirror', async () => {
  const inbody = await amenityBySlug('INBODY_SCAN'); // rarely used SYSTEM amenity: other test files share the catalogue
  const gA = await gymOf(ownerA, { amenities: ['INBODY_SCAN', 'WIFI'] });
  const gB = await gymOf(ownerB, { amenities: ['INBODY_SCAN', 'WIFI'] });
  const wifi = await amenityBySlug('WIFI');
  // A: DRAFT that still lists it; B: PENDING revision that lists it (B also changes the description so it is a real change)
  const draftA = await draftWithProposals(ownerA, gA.gymId, [], { description: 'Bản nháp của A' });
  const pendingB = await draftWithProposals(ownerB, gB.gymId, [], { submit: true, description: 'Bản chờ duyệt của B' });
  assert.ok(draftA.payload.amenityIds.includes(inbody.id));
  assert.ok(pendingB.payload.amenityIds.includes(inbody.id));

  try {
    const off = await h.call(admin.token, 'PATCH', `/admin/amenities/${inbody.id}`, { status: 'DISABLED', reason: 'Máy InBody ngừng hỗ trợ' });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.data.amenity.status, 'DISABLED');

    // DRAFT: removed, draft_version + 1, system adjustment
    const a = await revRow(draftA.id);
    assert.ok(!(a.payload as any).amenityIds.includes(inbody.id));
    assert.deepEqual((a.payload as any).amenityIds, [wifi.id]);
    assert.equal(a.draftVersion, draftA.draftVersion + 1);
    assert.deepEqual(a.systemAdjustments, [{ type: 'AMENITY_DISABLED_REMOVED', amenityId: inbody.id, name: inbody.name }]);
    // PENDING: untouched
    const b = await revRow(pendingB.id);
    assert.equal(b.status, 'PENDING');
    assert.ok((b.payload as any).amenityIds.includes(inbody.id));
    assert.equal(b.draftVersion, pendingB.draftVersion);
    assert.deepEqual(b.systemAdjustments, []);
    // the legacy mirror and the public listing both dropped it; gym_amenities rows are kept
    assert.deepEqual([...(await prisma.gym.findUniqueOrThrow({ where: { id: gA.gymId } })).facilities], ['WIFI']);
    assert.deepEqual([...(await prisma.gym.findUniqueOrThrow({ where: { id: gB.gymId } })).facilities], ['WIFI']);
    assert.equal(await prisma.gymAmenity.count({ where: { gymId: gA.gymId, amenityId: inbody.id } }), 1);
    const pub = (await h.call(null, 'GET', `/gyms/${gA.gymId}`)).json.data;
    assert.ok(!pub.amenities.some((x: any) => x.slug === 'INBODY_SCAN'));
    // owner A holds a stale draft_version now
    const stale = await h.call(ownerA.token, 'PUT', L(gA.gymId, '/draft'), { expectedDraftVersion: draftA.draftVersion, payload: payloadOf({ published: { payload: a.payload } }) });
    assert.equal(code(stale), 'DRAFT_STALE');
    // A's submit works: it removes the disabled amenity, which is a real change - never stuck on AMENITY_DISABLED
    const subA = await h.call(ownerA.token, 'POST', L(gA.gymId, '/submit'), { expectedDraftVersion: a.draftVersion });
    assert.equal(subA.status, 200, JSON.stringify(subA.json));

    // B's PENDING revision: flagged, blocked until the admin chooses
    const det = (await h.call(admin.token, 'GET', A(`/revisions/${pendingB.id}`))).json.data;
    assert.equal(det.flags.hasDisabledAmenity, true);
    const blocked = await h.call(admin.token, 'POST', A(`/revisions/${pendingB.id}/approve`), {});
    assert.equal(blocked.status, 409);
    assert.equal(code(blocked), 'AMENITY_DISABLED');
    const ok = await h.call(admin.token, 'POST', A(`/revisions/${pendingB.id}/approve`), { dropDisabledAmenities: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(await prisma.gymAmenity.count({ where: { gymId: gB.gymId, amenityId: inbody.id } }), 0);
    assert.deepEqual((await revRow(pendingB.id)).systemAdjustments, [{ type: 'AMENITY_DISABLED_REMOVED', amenityId: inbody.id, name: inbody.name }]);
    assert.equal(await prisma.amenityAuditLog.count({ where: { amenityId: inbody.id, action: 'AMENITY_DISABLED', reason: 'Máy InBody ngừng hỗ trợ' } }), 1);
  } finally {
    const on = await setStatus(admin.token, inbody.id, 'ACTIVE');
    assert.equal(on.status, 200);
  }
  // enabling re-syncs the mirror of the branches that still hold the row (A's was removed only by the owner's pending edit: its row is still there)
  assert.deepEqual([...(await prisma.gym.findUniqueOrThrow({ where: { id: gA.gymId } })).facilities].sort(), ['INBODY_SCAN', 'WIFI']);
});

// ═══ admin catalogue endpoints ═════════════════════════════════════════════════════════════════════

test('admin catalogue: create (allowlisted icon, unique name), rename / icon / category / sort, name conflicts, listing + history; every field is validated', async () => {
  const x = await adminCreate(admin.token, nm('Quầy sinh tố'), 'SERVICE', 'cup-soda');
  assert.equal(x.status, 201, JSON.stringify(x.json));
  const xid = x.json.data.amenity.id;
  assert.equal(x.json.data.amenity.source, 'CUSTOM');
  assert.equal(x.json.data.amenity.status, 'ACTIVE');
  assert.match(x.json.data.amenity.slug, /^custom-/);
  const y = await adminCreate(admin.token, nm('Quầy nước ép'), 'SERVICE', 'cup-soda');
  assert.equal(y.status, 201);

  const dup = await adminCreate(admin.token, nm('QUAY SINH TO'), 'SERVICE', 'cup-soda');
  assert.equal(dup.status, 409);
  assert.equal(code(dup), 'AMENITY_NAME_TAKEN');
  assert.equal(dup.json.amenity.id, xid);
  assert.equal(code(await adminCreate(admin.token, nm('Biểu tượng lạ'), 'SERVICE', 'rocket-ship')), 'ICON_NOT_ALLOWED');
  assert.equal((await adminCreate(admin.token, nm('Nhóm lạ'), 'NOPE', 'wifi')).status, 400);
  assert.equal((await h.call(admin.token, 'POST', '/admin/amenities', { name: nm('Thừa khoá'), category: 'SERVICE', iconKey: 'wifi', source: 'SYSTEM' })).status, 400, 'strict body');

  // rename onto another amenity's name -> 409; onto its own normalised name is fine
  const clash = await h.call(admin.token, 'PATCH', `/admin/amenities/${xid}`, { name: nm('quầy NƯỚC ÉP') });
  assert.equal(clash.status, 409);
  assert.equal(code(clash), 'AMENITY_NAME_TAKEN');
  assert.equal(code(await h.call(admin.token, 'PATCH', `/admin/amenities/${xid}`, { iconKey: 'bogus' })), 'ICON_NOT_ALLOWED');
  assert.equal((await h.call(admin.token, 'PATCH', `/admin/amenities/${xid}`, {})).status, 400, 'nothing to update');
  assert.equal((await h.call(admin.token, 'PATCH', `/admin/amenities/${randomUUID()}`, { sortOrder: 1 })).status, 404);

  const ok = await h.call(admin.token, 'PATCH', `/admin/amenities/${xid}`, { name: nm('Quầy sinh tố trái cây'), iconKey: 'droplets', category: 'FACILITY', sortOrder: 777 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const row = await prisma.amenity.findUniqueOrThrow({ where: { id: xid } });
  assert.equal(row.name, nm('Quầy sinh tố trái cây'));
  assert.equal(row.nameNormalized, normalizeAmenityName(nm('Quầy sinh tố trái cây')));
  assert.equal(row.iconKey, 'droplets');
  assert.equal(row.category, 'FACILITY');
  assert.equal(row.sortOrder, 777);
  assert.equal(row.slug, x.json.data.amenity.slug, 'the slug never changes');
  assert.equal((await h.call(admin.token, 'PATCH', `/admin/amenities/${xid}`, { sortOrder: 777 })).json.data.changed, false, 'a no-op is not audited');

  const hist = await h.call(admin.token, 'GET', `/admin/amenities/${xid}/history`);
  assert.deepEqual(hist.json.data.history.map((e: any) => e.action).sort(), ['AMENITY_CREATED', 'AMENITY_UPDATED']);
  const upd = hist.json.data.history.find((e: any) => e.action === 'AMENITY_UPDATED');
  assert.equal(upd.before.name, nm('Quầy sinh tố'));
  assert.equal(upd.after.name, nm('Quầy sinh tố trái cây'));
  assert.equal((await h.call(admin.token, 'GET', `/admin/amenities/${randomUUID()}/history`)).status, 404);

  // the admin list sees every status; filters work; the owner catalogue only the ACTIVE ones
  await setStatus(admin.token, xid, 'DISABLED');
  const all = await h.call(admin.token, 'GET', `/admin/amenities?q=${encodeURIComponent(P)}`);
  assert.equal(all.status, 200);
  assert.ok(all.json.data.amenities.some((a: any) => a.id === xid && a.status === 'DISABLED' && a.gymCount === 0));
  assert.ok(Array.isArray(all.json.data.iconKeys) && all.json.data.iconKeys.includes('wifi'));
  const onlyDisabled = await h.call(admin.token, 'GET', `/admin/amenities?status=DISABLED&q=${encodeURIComponent(P)}`);
  assert.ok(onlyDisabled.json.data.amenities.every((a: any) => a.status === 'DISABLED'));
  const mine = (await h.call(ownerA.token, 'GET', '/owner/amenities')).json.data.amenities;
  assert.ok(!mine.some((a: any) => a.id === xid));
});

test('owner PATCH / DELETE of a PENDING proposal: the name check runs again; decided proposals and other owners\' are refused; DELETE leaves DRAFTs (version +1) but is blocked by a PENDING revision', async () => {
  const gA = await gymOf(ownerA);
  const gB = await gymOf(ownerB);
  const p1 = (await propose(ownerA, gA.gymId, nm('đề xuất một'))).json.data.proposal;
  const p2 = (await propose(ownerA, gA.gymId, nm('đề xuất hai'))).json.data.proposal;
  const patch = (tok: string, id: string, body: unknown) => h.call(tok, 'PATCH', `/owner/amenities/proposals/${id}`, body);

  const toActive = await patch(ownerA.token, p1.id, { name: 'Wifi miễn phí' });
  assert.equal(toActive.status, 409);
  assert.equal(code(toActive), 'AMENITY_ALREADY_EXISTS');
  assert.equal(toActive.json.matchedAmenity.slug, 'WIFI');
  const toOwn = await patch(ownerA.token, p1.id, { name: nm('ĐỀ XUẤT HAI') });
  assert.equal(toOwn.status, 409);
  assert.equal(code(toOwn), 'PROPOSAL_NAME_TAKEN');
  assert.equal(toOwn.json.proposal.id, p2.id);
  assert.equal((await proposalRow(p1.id)).name, nm('đề xuất một'), 'nothing changed');
  const disabled = await makeCustom(nm('tên đã tắt'), { disabled: true });
  const toDisabled = await patch(ownerA.token, p1.id, { name: nm('Tên Đã Tắt'), note: 'xin bật lại' });
  assert.equal(toDisabled.status, 200, JSON.stringify(toDisabled.json));
  let row = await proposalRow(p1.id);
  assert.equal(row.kind, 'REENABLE');
  assert.equal(row.targetAmenityId, disabled);
  assert.equal(row.note, 'xin bật lại');
  const renamed = await patch(ownerA.token, p1.id, { name: nm('đề xuất mới hẳn'), suggestedCategory: 'SERVICE' });
  assert.equal(renamed.status, 200);
  row = await proposalRow(p1.id);
  assert.equal(row.kind, 'NEW');
  assert.equal(row.targetAmenityId, null);
  assert.equal(row.nameNormalized, normalizeAmenityName(nm('đề xuất mới hẳn')));
  assert.equal(row.suggestedCategory, 'SERVICE');
  assert.equal((await patch(ownerA.token, p1.id, {})).status, 400);
  assert.equal((await patch(ownerA.token, p1.id, { status: 'APPROVED' })).status, 400, 'strict body');
  assert.equal((await patch(ownerB.token, p1.id, { note: 'x' })).status, 404, "another owner's proposal is not found");
  assert.equal((await h.call(ownerB.token, 'DELETE', `/owner/amenities/proposals/${p1.id}`)).status, 404);
  assert.equal((await patch(ownerA.token, randomUUID(), { note: 'x' })).status, 404);

  // decided: no more edits / cancel
  assert.equal((await reject(admin.token, [p2.id])).status, 200);
  assert.equal(code(await patch(ownerA.token, p2.id, { note: 'muộn' })), 'PROPOSAL_ALREADY_DECIDED');
  assert.equal(code(await h.call(ownerA.token, 'DELETE', `/owner/amenities/proposals/${p2.id}`)), 'PROPOSAL_ALREADY_DECIDED');

  // DELETE: out of the open DRAFT; blocked while it sits in a PENDING revision
  const draft = await draftWithProposals(ownerA, gA.gymId, [p1.id]);
  const del = await h.call(ownerA.token, 'DELETE', `/owner/amenities/proposals/${p1.id}`);
  assert.equal(del.status, 200, JSON.stringify(del.json));
  row = await proposalRow(p1.id);
  assert.equal(row.status, 'CANCELLED');
  assert.equal(row.resultingAmenityId, null);
  const dr = await revRow(draft.id);
  assert.deepEqual((dr.payload as any).proposalIds, []);
  assert.equal(dr.draftVersion, draft.draftVersion + 1);
  assert.deepEqual((dr.systemAdjustments as any[]).map((x) => x.type), ['PROPOSAL_CANCELLED_REMOVED']);
  await h.call(ownerA.token, 'POST', L(gA.gymId, '/discard'), {});

  const p3 = (await propose(ownerB, gB.gymId, nm('đề xuất ba'))).json.data.proposal;
  const pending = await draftWithProposals(ownerB, gB.gymId, [p3.id], { submit: true, description: 'Có đề xuất ba' });
  const blocked = await h.call(ownerB.token, 'DELETE', `/owner/amenities/proposals/${p3.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'PROPOSAL_IN_REVIEW');
  assert.equal((await proposalRow(p3.id)).status, 'PENDING');
  await h.call(ownerB.token, 'POST', L(gB.gymId, '/withdraw'), {});
  assert.equal((await revRow(pending.id)).status, 'WITHDRAWN');
  assert.equal((await h.call(ownerB.token, 'DELETE', `/owner/amenities/proposals/${p3.id}`)).status, 200, 'after the withdraw it can be cancelled');
});

test('proposal decisions notify the proposing owners (GYM_AMENITY_PROPOSAL_REVIEWED, entity GYM_BRANCH) only when LISTING_GYM_NOTIFICATIONS_ENABLED is on; disabling an amenity tells the owner of an edited DRAFT', async () => {
  const sent: any[] = [];
  const original = userClient.notifyUser;
  (userClient as any).notifyUser = async (p: unknown) => {
    sent.push(p);
  };
  const previous = process.env.LISTING_GYM_NOTIFICATIONS_ENABLED;
  try {
    const gA = await gymOf(ownerA);
    const gB = await gymOf(ownerB);
    process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = 'false';
    const off =(await propose(ownerA, gA.gymId, nm('thông báo tắt'))).json.data.proposal.id;
    assert.equal((await reject(admin.token, [off])).status, 200);
    assert.equal(sent.length, 0, 'flag off -> silent');

    process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = 'true';
    const name = nm('thông báo bật');
    const ids = [(await propose(ownerA, gA.gymId, name)).json.data.proposal.id, (await propose(ownerB, gB.gymId, name)).json.data.proposal.id];
    assert.equal((await approve(admin.token, ids)).status, 200);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map((s) => s.userId).sort(), [ownerA.ownerId, ownerB.ownerId].sort());
    for (const s of sent) {
      assert.equal(s.eventType, 'GYM_AMENITY_PROPOSAL_REVIEWED');
      assert.equal(s.entityType, 'GYM_BRANCH');
      assert.equal(s.link, `/gym-owner/listings?gymId=${s.entityId}`);
      assert.match(s.text, /đã được duyệt/);
    }

    sent.length = 0;
    const amenity = await makeCustom(nm('tiện ích sắp tắt'));
    const gC = await gymOf(ownerA, { amenities: ['WIFI'] });
    await seed((tx) => tx.gymAmenity.create({ data: { gymId: gC.gymId, amenityId: amenity } }));
    await draftWithProposals(ownerA, gC.gymId, [], { description: 'Bản nháp có tiện ích sắp tắt' });
    assert.equal((await setStatus(admin.token, amenity, 'DISABLED')).status, 200);
    assert.deepEqual(sent.map((s) => s.eventType), ['GYM_LISTING_INVALIDATED']);
    assert.equal(sent[0].userId, ownerA.ownerId);
  } finally {
    (userClient as any).notifyUser = original;
    if (previous === undefined) delete process.env.LISTING_GYM_NOTIFICATIONS_ENABLED;
    else process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = previous;
  }
});

test('no amenity path produced a WRITER_ABSENT compat event (enable / disable re-sync the mirror as an event-aware writer)', async () => {
  const events = await prisma.legacyCompatEvent.findMany({ where: { outcome: 'WRITER_ABSENT', entityId: { in: [...reg.gyms, ...reg.partners] } } });
  assert.deepEqual(events.map((e) => `${e.entityType}:${e.action}:${e.entityId}`), []);
});
