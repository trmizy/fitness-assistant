/**
 * Listing Management B3 - the AMENITIES step of the partner application and the legacy-client compatibility around it
 * (plan section 4, 12.8, 12.14 item 4, 12.15 items 3-4, B12).
 *
 * Evidence label: BACKEND INTEGRATION - the real Express app (src/app.ts, owner + admin routers) over an isolated `*_test` database;
 * auth-service is a TEST FIXTURE (token -> identity) and no S3 is wired in, so the application's photos and documents are TEST FIXTURE
 * rows written straight to the database (the upload pipeline is covered elsewhere and needs MinIO). Every step the tests drive
 * (bootstrap, PUT steps, submit, resubmit, admin request-changes / approve / proposal decisions) goes through real HTTP.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import {
  cleanupAll,
  makeAdminUser,
  newRegistry,
  startHarness,
  type Harness,
  type Reply,
} from './listing-b2.test-helpers';

const reg = newRegistry();
const P = `zzb3a${randomUUID().slice(0, 5)}`;
const ownerUserIds: string[] = [];
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let admin: ReturnType<typeof makeAdminUser>;

/** A new client: both headers. */
const NEW = { 'x-gymini-listing-flow': '2', 'x-gymini-client': 'web/b3-test' };
/** An old client: no X-Gymini-Listing-Flow at all (it may still send X-Gymini-Client, which is only measured). */
const OLD = { 'x-gymini-client': 'mobile/old-apk' };

const LEGACY_FLAG = 'LISTING_LEGACY_CLIENT_COMPAT';
let savedFlag: string | undefined;

test.before(async () => {
  if (skip) return;
  savedFlag = process.env[LEGACY_FLAG];
  delete process.env[LEGACY_FLAG];
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  admin = makeAdminUser(h);
});

test.after(async () => {
  if (skip) return;
  if (savedFlag === undefined) delete process.env[LEGACY_FLAG];
  else process.env[LEGACY_FLAG] = savedFlag;
  await h.stop();
  if (ownerUserIds.length) await prisma.legacyCompatEvent.deleteMany({ where: { actorUserId: { in: ownerUserIds } } });
  await cleanupAll(reg, { adminIds: [admin.adminId], amenityNamePrefix: P });
  await prisma.$disconnect();
});

const code = (r: Reply) => r.json?.error?.code;
const FLAG_OFF = async (fn: () => Promise<void>) => {
  process.env[LEGACY_FLAG] = 'false';
  try {
    await fn();
  } finally {
    delete process.env[LEGACY_FLAG];
  }
};

interface Applicant {
  userId: string;
  token: string;
  partnerId: string;
  gymId: string;
  brandId: string;
}

async function bootstrap(label: string, hdr: Record<string, string>): Promise<Omit<Applicant, 'gymId' | 'brandId'>> {
  const userId = randomUUID();
  ownerUserIds.push(userId);
  const token = `tok-app-${label}-${userId.slice(0, 8)}`;
  h.addUser(token, { id: userId, role: 'GYM_OWNER' });
  const r = await h.call(token, 'POST', '/owner/application/bootstrap', undefined, hdr);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  reg.partners.push(r.json.data.partnerId);
  return { userId, token, partnerId: r.json.data.partnerId };
}

/** Fills every section except the amenities and the terms (photo + the three documents are TEST FIXTURE rows). */
async function fillApplication(label: string, hdr: Record<string, string>): Promise<Applicant> {
  const a = await bootstrap(label, hdr);
  const put = async (path: string, body: unknown) => {
    const r = await h.call(a.token, 'PUT', `/owner/application/${path}`, body, hdr);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
    return r;
  };
  await put('representative', { name: 'Nguyễn Văn B', phone: '0901234567', role: 'GYM_OWNER' });
  await put('business-scale', { scale: 'ONE_BRANCH' });
  const brand = await put('brand', { name: `${P} Fitness ${label}` });
  const branch = await put('branch', {
    name: `${P} Chi nhánh ${label}`,
    phone: '0281234567',
    address: '1 Nguyễn Huệ',
    city: 'TP.HCM',
    provinceCode: 79,
    wardCode: 26734,
    latitude: 10.7769,
    longitude: 106.7009,
  });
  await put('legal', { legalName: `Công ty TNHH ${P} ${label}` });
  const gymId = branch.json.data.id as string;
  reg.gyms.push(gymId);
  reg.brands.push(brand.json.data.id);
  await prisma.gymPhoto.create({ data: { gymId, fileName: `${P}-${label}.jpg`, s3Key: `application/${P}/${label}.jpg`, visibility: 'PRIVATE', sortOrder: 0, isCover: true } });
  for (const docType of ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF'] as const) {
    await prisma.gymPartnerDocument.create({ data: { partnerId: a.partnerId, docType, status: 'RECEIVED', fileUrl: `seed://${P}/${docType}` } });
  }
  return { ...a, gymId, brandId: brand.json.data.id };
}

const get = async (a: Applicant, hdr: Record<string, string> = NEW) => (await h.call(a.token, 'GET', '/owner/application', undefined, hdr)).json.data;
const sections = (app: any) => app.missing.map((m: any) => m.section);
const partnerRow = (id: string) => prisma.gymPartner.findUniqueOrThrow({ where: { id } });
const events = (entityId: string) => prisma.legacyCompatEvent.findMany({ where: { entityId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
const byAction = (rows: Array<{ action: string }>, action: string) => rows.filter((r) => r.action === action).length;
const amenityIdsOf = async (gymId: string) => (await prisma.gymAmenity.findMany({ where: { gymId } })).map((r) => r.amenityId).sort();
/** The id of a SYSTEM amenity: 'amenity-sys-' + the enum label lower-cased with '-' (migration seed). */
const sys = (slug: string) => `amenity-sys-${slug.toLowerCase().replace(/_/g, '-')}`;

/** The entity's legacy_client_at is the SAME instant as the occurred_at of its latest ACCEPTED event. */
async function legacyClientAtMatchesLastAccepted(partnerId: string) {
  const rows = await prisma.$queryRaw<{ ok: boolean | null }[]>`
    SELECT (p.legacy_client_at = (SELECT max(occurred_at) FROM legacy_compat_events WHERE entity_id = p.id AND outcome = 'ACCEPTED')) AS ok
      FROM gym_partners p WHERE p.id = ${partnerId}`;
  return rows[0]?.ok === true;
}

async function adminAcceptDocuments(partnerId: string) {
  for (const docType of ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF']) {
    const r = await h.call(admin.token, 'POST', `/admin/partners/${partnerId}/application/documents/${docType}/accept`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
}
const adminDetail = async (partnerId: string) => (await h.call(admin.token, 'GET', `/admin/partners/${partnerId}/application`)).json.data;

// ═══ 1. the step: save, read back, resume (`missing`) ═══════════════════════════════════════════════

test('PUT /owner/application/amenities: saves the DRAFT branch selection; GET exposes it and the missing section key is AMENITIES (resume); saving empty re-opens it', async () => {
  const a = await fillApplication('step', NEW);

  // a new client (header) is told what is missing: AMENITIES (and the not-yet-accepted TERMS), in wizard order
  let app = await get(a);
  assert.deepEqual(sections(app), ['AMENITIES', 'TERMS']);
  assert.equal(app.applicationFlowVersion, 2, 'bootstrap with the header sets application_flow_version = 2');
  assert.deepEqual(app.amenities, []);
  assert.deepEqual(app.amenityProposals, []);

  const r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI'), sys('SAUNA'), sys('WIFI')] }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.amenities.length, 2, 'duplicates collapse');
  assert.equal(r.json.data.amenityCount, 2);

  app = await get(a);
  assert.deepEqual(sections(app), ['TERMS'], 'AMENITIES is no longer missing');
  assert.deepEqual(app.amenities.map((x: any) => x.id).sort(), [sys('SAUNA'), sys('WIFI')]);
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: a.gymId } });
  assert.deepEqual([...gym.facilities].sort(), ['SAUNA', 'WIFI'], 'gyms.facilities mirror re-synced by the step');

  // authoritative replacement
  await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('WIFI')]);

  // saving empty is allowed (a draft step) and the section is missing again - this is what lets the client resume at the step
  const empty = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [] }, NEW);
  assert.equal(empty.status, 200);
  assert.deepEqual(sections(await get(a)), ['AMENITIES', 'TERMS']);
  assert.deepEqual((await prisma.gym.findUniqueOrThrow({ where: { id: a.gymId } })).facilities, []);

  // a new client writes NO legacy evidence
  assert.equal((await events(a.partnerId)).length, 0);
  assert.equal((await partnerRow(a.partnerId)).legacyClientAt, null);
});

test('the step validates its body and its preconditions: unknown / disabled amenity 422, extra key 400, no branch yet 409 BRANCH_REQUIRED, locked application 409', async () => {
  const a = await fillApplication('val', NEW);
  let r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: ['amenity-sys-NOPE'] }, NEW);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITY_UNKNOWN');

  const disabled = await prisma.amenity.create({
    data: { slug: `custom-${P}-off`, name: `${P} tắt`, nameNormalized: `${P} tat`, category: 'SERVICE', iconKey: 'wifi', sortOrder: 9000, source: 'CUSTOM', status: 'DISABLED' },
  });
  reg.amenities.push(disabled.id);
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI'), disabled.id] }, NEW);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITY_DISABLED');
  assert.deepEqual(await amenityIdsOf(a.gymId), [], 'a refused request saves nothing (one transaction)');

  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')], gymId: randomUUID() }, NEW);
  assert.equal(r.status, 400, 'strict body: a client-supplied gymId is refused, never trusted');

  // no branch yet
  const early = await bootstrap('early', NEW);
  r = await h.call(early.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
  assert.equal(r.status, 409);
  assert.equal(code(r), 'BRANCH_REQUIRED');

  // locked once under review
  await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
  const sub = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW);
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('SAUNA')] }, NEW);
  assert.equal(r.status, 409);
  assert.equal(code(r), 'APPLICATION_LOCKED');

  // another applicant cannot reach this branch: the identity comes from the token
  const other = await fillApplication('other', NEW);
  await h.call(other.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('SAUNA')] }, NEW);
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('WIFI')]);
  assert.deepEqual(await amenityIdsOf(other.gymId), [sys('SAUNA')]);
});

test('proposals: a custom amenity is bound to the DRAFT branch (PENDING); an ACTIVE catalogue name is matched and selected; proposalIds keeps / cancels; the proposal alone satisfies the step', async () => {
  const a = await fillApplication('prop', NEW);
  const name = `${P} Phòng boxing`;
  let r = await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [], proposals: [{ name, suggestedCategory: 'TRAINING_ZONE', note: 'có bao cát' }] }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.amenityProposals.length, 1);
  const proposal = r.json.data.amenityProposals[0];
  assert.equal(proposal.status, 'PENDING');
  assert.equal(proposal.gymId, a.gymId, 'bound to the application DRAFT branch');
  assert.deepEqual(sections(await get(a)), ['TERMS'], 'a PENDING proposal counts as an amenity for the step');

  // idempotent: proposing the same name again returns the same proposal (never a second one, never a 500)
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { proposals: [{ name, suggestedCategory: 'TRAINING_ZONE' }] }, NEW);
  assert.equal(r.status, 200);
  assert.equal((await prisma.amenityProposal.count({ where: { gymId: a.gymId, status: 'PENDING' } })), 1);

  // the name of an ACTIVE catalogue amenity is matched, not proposed
  const wifi = await prisma.amenity.findUniqueOrThrow({ where: { id: sys('WIFI') } });
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { proposals: [{ name: wifi.name, suggestedCategory: 'FACILITY' }] }, NEW);
  assert.equal(r.status, 200);
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('WIFI')], 'matched amenity added to gym_amenities');
  assert.equal((await prisma.amenityProposal.count({ where: { gymId: a.gymId, ownerUserId: a.userId } })), 1, 'no proposal created for it');

  // proposalIds: a foreign / unknown id is refused; [] deselects (cancels) the branch's own PENDING proposals
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { proposalIds: [randomUUID()] }, NEW);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'PROPOSAL_INVALID');
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { proposalIds: [proposal.id] }, NEW);
  assert.equal(r.status, 200);
  assert.equal((await prisma.amenityProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, 'PENDING');
  r = await h.call(a.token, 'PUT', '/owner/application/amenities', { proposalIds: [] }, NEW);
  assert.equal(r.status, 200);
  assert.equal((await prisma.amenityProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, 'CANCELLED');
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('WIFI')], 'catalogue rows untouched when only proposals change');
});

// ═══ 2. flow 2: submit / resubmit need >= 1 amenity ═════════════════════════════════════════════════

test('new client (flow 2): submit without amenities is 422 AMENITIES_REQUIRED and changes nothing; with one amenity it is accepted; a proposal alone is enough; no legacy evidence is written', async () => {
  const a = await fillApplication('f2', NEW);
  let r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW);
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(code(r), 'AMENITIES_REQUIRED');
  assert.match(r.json.message, /tiện ích/);
  assert.equal(r.json.error.message, r.json.message);
  let p = await partnerRow(a.partnerId);
  assert.equal(p.verificationStatus, 'NOT_VERIFIED');
  assert.equal(p.submittedAt, null);
  assert.equal((await events(a.partnerId)).length, 0, 'a new client leaves no legacy event, not even for the refusal');

  await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
  r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  p = await partnerRow(a.partnerId);
  assert.equal(p.verificationStatus, 'IN_REVIEW');
  assert.equal(p.applicationFlowVersion, 2);
  assert.equal(p.legacyNoAmenities, false);
  assert.equal((await events(a.partnerId)).length, 0);

  // proposal-only
  const b = await fillApplication('f2p', NEW);
  await h.call(b.token, 'PUT', '/owner/application/amenities', { proposals: [{ name: `${P} Hồ bơi mini`, suggestedCategory: 'FACILITY' }] }, NEW);
  assert.deepEqual(await amenityIdsOf(b.gymId), []);
  r = await h.call(b.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await partnerRow(b.partnerId)).verificationStatus, 'IN_REVIEW');
});

test('flow 2 is sticky: an application a new client touched is refused as a legacy client too (flag on) - application_flow_version = 2 is never downgraded', async () => {
  const a = await fillApplication('sticky', NEW);
  // an old client (no header) now submits the same application with no amenities
  const r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
  assert.equal(r.status, 422);
  assert.equal(code(r), 'AMENITIES_REQUIRED');
  const ev = await events(a.partnerId);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].outcome, 'REJECTED_422');
  assert.equal(ev[0].action, 'APPLICATION_SUBMIT');
  assert.equal((await partnerRow(a.partnerId)).applicationFlowVersion, 2, 'a header-less request never lowers it');
});

// ═══ 3. legacy client: flag on / flag off ═══════════════════════════════════════════════════════════

test('legacy client + flag ON (default): every step leaves exactly one ACCEPTED event, the application is accepted with 0 amenities (legacy_no_amenities), legacy_client_at equals the event instant; the missing list does not ask for amenities', async () => {
  const a = await fillApplication('legacy', OLD);
  // bootstrap + 5 save steps
  let ev = await events(a.partnerId);
  assert.equal(byAction(ev, 'APPLICATION_BOOTSTRAP'), 1);
  assert.equal(byAction(ev, 'APPLICATION_SAVE_STEP'), 5);
  assert.ok(ev.every((e) => e.outcome === 'ACCEPTED' && e.entityType === 'GYM_PARTNER' && e.actorUserId === a.userId && e.flowHeader === null && e.clientHeader === 'mobile/old-apk'));
  assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId));

  // calling bootstrap again is idempotent but still leaves its trace
  const again = await h.call(a.token, 'POST', '/owner/application/bootstrap', undefined, OLD);
  assert.equal(again.status, 200);
  assert.equal(byAction(await events(a.partnerId), 'APPLICATION_BOOTSTRAP'), 2);

  // the wizard's other PUT steps leave their trace too
  await h.call(a.token, 'PUT', '/owner/application/social', { facebookUrl: 'https://facebook.com/b3' }, OLD);
  const photo = await prisma.gymPhoto.findFirstOrThrow({ where: { gymId: a.gymId } });
  assert.equal((await h.call(a.token, 'PUT', '/owner/application/photos/reorder', { ids: [photo.id] }, OLD)).status, 200);
  assert.equal(byAction(await events(a.partnerId), 'APPLICATION_SAVE_STEP'), 7);

  const app = await get(a, OLD);
  assert.deepEqual(sections(app), ['TERMS'], 'an old client is not asked for amenities while the flag is on');

  const r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = await partnerRow(a.partnerId);
  assert.equal(p.verificationStatus, 'IN_REVIEW');
  assert.equal(p.legacyNoAmenities, true);
  assert.equal(p.applicationFlowVersion, null);
  ev = await events(a.partnerId);
  assert.equal(byAction(ev, 'APPLICATION_SUBMIT'), 1);
  assert.equal(ev[ev.length - 1].action, 'APPLICATION_SUBMIT');
  assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId), 'legacy_client_at == the submit event occurred_at');

  // a double click after the submit changes nothing but still leaves its trace
  const dup = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
  assert.equal(dup.status, 200);
  assert.equal(dup.json.data.alreadySubmitted, true);
  assert.equal(byAction(await events(a.partnerId), 'APPLICATION_SUBMIT'), 2);
  assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId));

  // admin: the label, and the application is approvable with 0 amenities (it is not a flow-2 application)
  const d = await adminDetail(a.partnerId);
  assert.equal(d.legacyNoAmenities, true);
  assert.equal(d.legacyLabel, 'Từ ứng dụng cũ — chưa có tiện ích');
  assert.equal(d.partner.applicationFlowVersion, null);
  assert.ok(!d.approve.blockers.some((b: any) => b.code === 'AMENITIES_REQUIRED' || b.code === 'CUSTOM_AMENITY_PENDING'));
  await adminAcceptDocuments(a.partnerId);
  const ok = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: a.gymId } })).status, 'APPROVED');
});

test('legacy client + flag OFF: submit is 422 AMENITIES_REQUIRED ("cập nhật ứng dụng"), REJECTED_422 is written in its own transaction, the application is not touched (legacy_client_at keeps the previous instant) and the flow-2 client can then finish it', async () => {
  const a = await fillApplication('off', OLD);
  const before = await partnerRow(a.partnerId);
  assert.ok(before.legacyClientAt);

  await FLAG_OFF(async () => {
    // the missing list now asks an old client for amenities too
    assert.ok(sections(await get(a, OLD)).includes('AMENITIES'));

    const r = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(code(r), 'AMENITIES_REQUIRED');
    assert.match(r.json.message, /cập nhật ứng dụng/i);
    assert.equal(r.json.error.message, r.json.message);

    const p = await partnerRow(a.partnerId);
    assert.equal(p.verificationStatus, 'NOT_VERIFIED', 'nothing changed');
    assert.equal(p.legacyClientAt?.getTime(), before.legacyClientAt?.getTime(), 'a rejected request does not move legacy_client_at');
    const ev = await events(a.partnerId);
    const rejected = ev.filter((e) => e.outcome === 'REJECTED_422');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].action, 'APPLICATION_SUBMIT');
    assert.equal(rejected[0].clientHeader, 'mobile/old-apk');
    assert.equal(rejected[0].flowHeader, null);
    assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId), 'still equals the last ACCEPTED instant (the rejection is not an entity update)');

    // the new client adds the amenity; then even the old client's submit passes (the application has an amenity)
    await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
    const ok = await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await partnerRow(a.partnerId)).verificationStatus, 'IN_REVIEW');
    assert.equal((await partnerRow(a.partnerId)).legacyNoAmenities, false, 'it has an amenity now');
    assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId));
  });
});

test('resubmit: legacy + flag on is accepted with an ACCEPTED event; legacy + flag off is 422 + REJECTED_422; a new client needs an amenity. An application CREATED 60 DAYS AGO and resubmitted today leaves an event dated TODAY', async () => {
  // a legacy application, submitted, then sent back by the admin with an AMENITIES issue
  const a = await fillApplication('re', OLD);
  assert.equal((await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, OLD)).status, 200);
  const rc = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/request-changes`, {
    issues: [{ category: 'AMENITIES', message: 'Hãy chọn các tiện ích của phòng tập' }],
    documents: [],
  });
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  const issues = (await get(a, OLD)).issues;
  assert.equal(issues[0].category, 'AMENITIES');
  assert.equal((await h.call(a.token, 'POST', `/owner/application/issues/${issues[0].id}/mark-updated`, { note: 'đã sửa' }, OLD)).status, 200);

  // the application is old: created / submitted 60 days ago
  const longAgo = new Date(Date.now() - 60 * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'seed'`);
    await tx.gymPartner.update({ where: { id: a.partnerId }, data: { createdAt: longAgo, submittedAt: longAgo } });
  });

  await FLAG_OFF(async () => {
    const r = await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, OLD);
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(code(r), 'AMENITIES_REQUIRED');
    const rej = (await events(a.partnerId)).filter((e) => e.outcome === 'REJECTED_422');
    assert.equal(rej.length, 1);
    assert.equal(rej[0].action, 'APPLICATION_RESUBMIT');
    assert.equal((await partnerRow(a.partnerId)).verificationStatus, 'NEEDS_INFO');
  });

  // flag on: accepted today, with 0 amenities
  const ok = await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, OLD);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const p = await partnerRow(a.partnerId);
  assert.equal(p.verificationStatus, 'IN_REVIEW');
  assert.equal(p.legacyNoAmenities, true);
  const last = (await events(a.partnerId)).filter((e) => e.outcome === 'ACCEPTED').pop()!;
  assert.equal(last.action, 'APPLICATION_RESUBMIT');
  assert.ok(Date.now() - last.occurredAt.getTime() < 120_000, 'the event is dated now, not by the application created_at');
  assert.ok(Date.now() - p.legacyClientAt!.getTime() < 120_000, 'legacy_client_at is today although created_at is 60 days old');
  assert.ok(p.createdAt.getTime() < Date.now() - 59 * 86_400_000);
  assert.ok(await legacyClientAtMatchesLastAccepted(a.partnerId));

  // a new client resubmitting the same kind of application needs the amenity
  const n = await fillApplication('re2', NEW);
  await h.call(n.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')] }, NEW);
  assert.equal((await h.call(n.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW)).status, 200);
  await h.call(admin.token, 'POST', `/admin/partners/${n.partnerId}/application/request-changes`, {
    issues: [{ category: 'AMENITIES', message: 'Chọn lại tiện ích' }],
    documents: [],
  });
  await h.call(n.token, 'PUT', '/owner/application/amenities', { amenityIds: [] }, NEW);
  const nIssues = (await get(n)).issues;
  await h.call(n.token, 'POST', `/owner/application/issues/${nIssues[0].id}/mark-updated`, {}, NEW);
  const refused = await h.call(n.token, 'POST', '/owner/application/resubmit', undefined, NEW);
  assert.equal(refused.status, 422);
  assert.equal(code(refused), 'AMENITIES_REQUIRED');
  await h.call(n.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('SAUNA')] }, NEW);
  const done = await h.call(n.token, 'POST', '/owner/application/resubmit', undefined, NEW);
  assert.equal(done.status, 200, JSON.stringify(done.json));
});

// ═══ 4. admin: blockers, in-place proposal decisions, no dead end ═══════════════════════════════════

test('admin approve blockers: CUSTOM_AMENITY_PENDING while a proposal is PENDING and AMENITIES_REQUIRED for a flow-2 application with 0 amenities; the detail carries amenities and proposals; rejecting the proposal leaves AMENITIES_REQUIRED, and request-changes(AMENITIES) -> owner adds -> resubmit -> approve has no dead end and publishes the amenities', async () => {
  const a = await fillApplication('adm', NEW);
  await h.call(a.token, 'PUT', '/owner/application/amenities', { proposals: [{ name: `${P} Phòng boxing`, suggestedCategory: 'TRAINING_ZONE' }] }, NEW);
  assert.equal((await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW)).status, 200);
  await adminAcceptDocuments(a.partnerId);

  let d = await adminDetail(a.partnerId);
  const codes = (x: any) => x.approve.blockers.map((b: any) => b.code).sort();
  assert.deepEqual(codes(d), ['AMENITIES_REQUIRED', 'CUSTOM_AMENITY_PENDING']);
  assert.equal(d.approve.canApprove, false);
  assert.equal(d.amenities.length, 0);
  assert.equal(d.amenityProposals.length, 1);
  assert.equal(d.amenityProposals[0].status, 'PENDING');
  assert.equal(d.amenityProposals[0].ownerUserId, a.userId);
  assert.equal(d.partner.applicationFlowVersion, 2);
  assert.equal(d.legacyNoAmenities, false);
  const proposalId = d.amenityProposals[0].id as string;

  let blocked = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/approve`);
  assert.equal(blocked.status, 409);
  assert.ok(blocked.json.error.blockers.some((b: any) => b.code === 'CUSTOM_AMENITY_PENDING'));

  // REJECT the proposal in place: the pending blocker goes, the branch has 0 amenities -> AMENITIES_REQUIRED remains
  const rej = await h.call(admin.token, 'POST', '/admin/amenities/proposals/reject', { proposalIds: [proposalId], reason: 'Trùng với tiện ích khác' });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  d = await adminDetail(a.partnerId);
  assert.deepEqual(codes(d), ['AMENITIES_REQUIRED']);
  assert.equal(d.amenityProposals[0].status, 'REJECTED');
  assert.deepEqual(await amenityIdsOf(a.gymId), [], 'a rejected proposal adds nothing to the DRAFT branch');
  blocked = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/approve`);
  assert.equal(blocked.status, 409);

  // the way out: request changes with the AMENITIES category
  const rc = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/request-changes`, {
    issues: [{ category: 'AMENITIES', message: 'Tiện ích đề xuất bị từ chối, hãy chọn tiện ích có sẵn' }],
    documents: [],
  });
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  let app = await get(a);
  assert.equal(app.accessState, 'CHANGES_REQUESTED');
  assert.ok(sections(app).includes('AMENITIES'));
  const issueId = app.issues[0].id as string;
  const early = await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, NEW);
  assert.equal(early.status, 422, 'the amenities gate answers first: still 0 amenities');
  assert.equal(code(early), 'AMENITIES_REQUIRED');
  // owner chooses amenities again, then (before acknowledging the issue) is still stopped, acknowledges, resubmits
  assert.equal((await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI'), sys('SAUNA')] }, NEW)).status, 200);
  assert.equal((await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, NEW)).status, 409, 'issue not acknowledged yet');
  assert.equal((await h.call(a.token, 'POST', `/owner/application/issues/${issueId}/mark-updated`, {}, NEW)).status, 200);
  const re = await h.call(a.token, 'POST', '/owner/application/resubmit', undefined, NEW);
  assert.equal(re.status, 200, JSON.stringify(re.json));

  assert.equal((await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/issues/${issueId}/resolve`)).status, 200);
  d = await adminDetail(a.partnerId);
  assert.deepEqual(d.approve.blockers, [], JSON.stringify(d.approve.blockers));
  const ok = await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  // approval keeps the gym_amenities and they are public
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('SAUNA'), sys('WIFI')]);
  const pub = await h.call(null, 'GET', `/gyms/${a.gymId}`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.deepEqual(pub.json.data.amenities.map((x: any) => x.slug).sort(), ['SAUNA', 'WIFI'], 'the public DTO shows the amenities by slug');
});

test('approving a custom proposal for an application branch adds the new amenity to the DRAFT branch (gym_amenities, mirror) and clears the blocker; approval then publishes it', async () => {
  const a = await fillApplication('adm2', NEW);
  const name = `${P} Sân bóng rổ`;
  await h.call(a.token, 'PUT', '/owner/application/amenities', { amenityIds: [sys('WIFI')], proposals: [{ name, suggestedCategory: 'TRAINING_ZONE' }] }, NEW);
  assert.equal((await h.call(a.token, 'POST', '/owner/application/submit', { acceptTerms: true }, NEW)).status, 200);
  await adminAcceptDocuments(a.partnerId);
  let d = await adminDetail(a.partnerId);
  assert.deepEqual(d.approve.blockers.map((b: any) => b.code), ['CUSTOM_AMENITY_PENDING']);

  const ap = await h.call(admin.token, 'POST', '/admin/amenities/proposals/approve', { proposalIds: [d.amenityProposals[0].id] });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const newAmenityId = ap.json.data.amenity.id as string;
  assert.deepEqual(await amenityIdsOf(a.gymId), [sys('WIFI'), newAmenityId].sort(), 'the approved amenity is now on the DRAFT branch');
  d = await adminDetail(a.partnerId);
  assert.deepEqual(d.approve.blockers, []);
  assert.deepEqual(d.amenities.map((x: any) => x.id).sort(), [sys('WIFI'), newAmenityId].sort());
  assert.equal(d.amenityProposals[0].status, 'APPROVED');
  assert.equal(d.amenityProposals[0].resultingAmenityId, newAmenityId);

  // MERGE into an existing amenity behaves the same way
  const b = await fillApplication('adm3', NEW);
  await h.call(b.token, 'PUT', '/owner/application/amenities', { proposals: [{ name: `${P} Xông hơi khô`, suggestedCategory: 'RECOVERY' }] }, NEW);
  const bp = (await prisma.amenityProposal.findFirstOrThrow({ where: { gymId: b.gymId } })).id;
  const mg = await h.call(admin.token, 'POST', '/admin/amenities/proposals/merge', { proposalIds: [bp], targetAmenityId: sys('SAUNA') });
  assert.equal(mg.status, 200, JSON.stringify(mg.json));
  assert.deepEqual(await amenityIdsOf(b.gymId), [sys('SAUNA')]);
  assert.deepEqual((await prisma.gym.findUniqueOrThrow({ where: { id: b.gymId } })).facilities, ['SAUNA']);

  assert.equal((await h.call(admin.token, 'POST', `/admin/partners/${a.partnerId}/application/approve`)).status, 200);
  const pub = await h.call(null, 'GET', `/gyms/${a.gymId}`);
  const created = await prisma.amenity.findUniqueOrThrow({ where: { id: newAmenityId } });
  assert.ok(pub.json.data.amenities.some((x: any) => x.slug === created.slug && x.name === name), 'the approved custom amenity is public');
});

// ═══ 5. the evidence is clean ═══════════════════════════════════════════════════════════════════════

test('no application path produced a WRITER_ABSENT event: every write to gym_partners / gyms ran inside the compat writer', async () => {
  const ids = [...reg.partners, ...reg.gyms];
  const absent = await prisma.legacyCompatEvent.count({ where: { entityId: { in: ids }, outcome: 'WRITER_ABSENT' } });
  assert.equal(absent, 0);
  const nonClient = await prisma.legacyCompatEvent.count({ where: { entityId: { in: ids }, outcome: 'NON_CLIENT' } });
  assert.equal(nonClient, 1, 'only the explicit seed back-dating of one application (declared as seed) is NON_CLIENT');
});
