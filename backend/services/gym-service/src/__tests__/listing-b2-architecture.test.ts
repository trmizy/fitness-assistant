/**
 * CODE AUDIT (no database) + pure unit tests - Listing Management B2 guards, so a later change cannot quietly reopen a door:
 *   1. the preview mapper is imported only by the owner-side service (never by a public route / controller / service);
 *   2. every new router starts with the no-store middleware; owner mounts carry requirePartnerOwner; admin mounts sit after
 *      the ADMIN guard;
 *   3. only the apply transaction (and the legacy draft-wizard helper) write `gym_amenities`;
 *   4. the amenity / upload code never "catches a unique violation and carries on" (P2002 / 23505) - plan §12.3;
 *   5. schemas are strict; the diff and the name normalisation behave.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gymListingPayloadSchema, adminDirectEditBodySchema, adminRetireBodySchema, ownerProposalBodySchema, saveDraftBodySchema } from '../services/gym-listing.schemas';
import { diffPayloads } from '../services/gym-listing-diff';
import { normalizeAmenityName } from '../services/amenity-catalog';

const SRC = path.resolve(__dirname, '..');
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['__tests__', 'generated', 'node_modules'].includes(e.name)) continue;
      out.push(...sourceFiles(full));
    } else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('the preview mapper (toListingPreviewDto) is imported only by gym-listing.service.ts - no public surface can reach it', () => {
  const importers = sourceFiles()
    .filter((f) => /toListingPreviewDto|gym-listing-preview/.test(code(fs.readFileSync(f, 'utf8'))))
    .map(rel)
    .sort();
  assert.deepEqual(importers, ['services/gym-listing-preview.ts', 'services/gym-listing.service.ts']);
  for (const f of ['routes/public.routes.ts', 'routes/media.routes.ts', 'controllers/gym-media.controller.ts', 'services/gym-public.ts', 'controllers/gym.controller.ts']) {
    assert.doesNotMatch(code(read(f)), /gym-listing-preview|toListingPreviewDto|ListingPreviewDto/, f);
  }
  // and the public DTO never gets a revision as input
  assert.doesNotMatch(code(read('services/gym-public.ts')), /gymListingRevision|GymListingRevision/);
});

test('routers: no-store first; owner mounts need requirePartnerOwner; admin mounts come after the ADMIN guard', () => {
  for (const f of ['routes/owner-listing.routes.ts', 'routes/admin-listing.routes.ts']) {
    const text = code(read(f));
    const routers = text.split(/export const \w+Router = Router/).slice(1);
    assert.ok(routers.length === 2, f);
    for (const r of routers) assert.match(r.trimStart().replace(/^\([^)]*\);\s*/, ''), /^\w+Router\.use\(noStorePrivate\);/, `${f}: first statement of each router`);
  }
  const owner = code(read('routes/owner.routes.ts'));
  assert.match(owner, /router\.use\('\/gyms\/:id\/listing', requirePartnerOwner, ownerListingRouter\)/);
  assert.match(owner, /router\.use\('\/amenities', requirePartnerOwner, ownerAmenityRouter\)/);
  assert.ok(owner.indexOf("router.use(requireOperationalAccess)") < owner.indexOf('ownerListingRouter)'), 'after the operational gate');
  const admin = code(read('routes/admin.routes.ts'));
  const guard = admin.indexOf("requireRoles('ADMIN')");
  assert.ok(guard > 0 && guard < admin.indexOf("router.use('/listings/gyms'") && guard < admin.indexOf("router.use('/amenities'"));
});

test('gym_amenities has four writers only: the apply transaction, the draft wizard helper, the B3 selection of an unpublished branch and the proposal decision that adds the approved amenity to such a branch (+ the admin catalogue flows never write it otherwise)', () => {
  const writers = sourceFiles()
    .filter((f) => /\bgymAmenity\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(code(fs.readFileSync(f, 'utf8'))))
    .map(rel)
    .sort();
  assert.deepEqual(writers, ['services/gym-amenity-catalog.service.ts', 'services/gym-amenity-selection.service.ts', 'services/gym-amenity.service.ts', 'services/gym-listing-apply.service.ts']);
});

test('the amenity / upload / apply code never catches a unique violation and carries on (P2002 / 23505)', () => {
  for (const f of ['services/gym-amenity-catalog.service.ts', 'services/gym-listing-upload.service.ts', 'services/gym-listing-apply.service.ts', 'services/gym-listing.service.ts', 'services/gym-listing.helpers.ts']) {
    assert.doesNotMatch(code(read(f)), /P2002|23505|PrismaClientKnownRequestError/, f);
  }
  const catalog = code(read('services/gym-amenity-catalog.service.ts'));
  assert.match(catalog, /ON CONFLICT \(owner_user_id, gym_id, name_normalized\) WHERE status = 'PENDING' DO NOTHING/);
  assert.match(catalog, /ON CONFLICT DO NOTHING/);
  assert.match(catalog, /pg_advisory_xact_lock\(hashtext\(/);
  assert.match(catalog, /FOR UPDATE/);
  assert.match(code(read('services/gym-listing-upload.service.ts')), /ON CONFLICT \(gym_id, content_hash\) WHERE status IN \('STAGED','PUBLISHED'\)[\s\S]*DO NOTHING/);
  assert.match(code(read('services/gym-listing.helpers.ts')), /ON CONFLICT \(gym_id\) WHERE status IN \('DRAFT','PENDING'\) DO NOTHING/);
});

test('every write to gyms in the new files happens in a transaction that declares itself an event-aware writer', () => {
  for (const f of ['services/gym-listing-apply.service.ts', 'services/gym.service.ts']) {
    assert.match(code(read(f)), /withCompatWriter/, f);
  }
  assert.match(code(read('services/gym-listing-apply.service.ts')), /async function applyGymListingRevisionTx[\s\S]{0,400}await withCompatWriter\(tx\)/);
});

test('schemas are strict: unknown keys, missing versions, short reasons and an over-long description are all refused', () => {
  const ok = { description: 'Mô tả', amenityIds: ['amenity-sys-wifi'], proposalIds: [], photoIds: [], coverPhotoId: null };
  assert.ok(gymListingPayloadSchema.safeParse(ok).success);
  assert.ok(!gymListingPayloadSchema.safeParse({ ...ok, facilities: [] }).success);
  assert.ok(!gymListingPayloadSchema.safeParse({ ...ok, description: 'x'.repeat(301) }).success);
  assert.ok(gymListingPayloadSchema.safeParse({ ...ok, description: 'x'.repeat(300) }).success);
  assert.equal(gymListingPayloadSchema.parse({ ...ok, description: '   ' }).description, null, 'blank -> null');
  assert.deepEqual(gymListingPayloadSchema.parse({ ...ok, amenityIds: ['a', 'a', 'b'] }).amenityIds, ['a', 'b'], 'duplicates collapse');
  assert.ok(!gymListingPayloadSchema.safeParse({ ...ok, photoIds: ['not-a-uuid'] }).success);
  assert.ok(!saveDraftBodySchema.safeParse({ payload: ok }).success, 'expectedDraftVersion is required');
  const edit = { description: 'x', reason: '0123456789', expectedListingVersion: 1 };
  assert.ok(adminDirectEditBodySchema.safeParse(edit).success);
  assert.ok(!adminDirectEditBodySchema.safeParse({ ...edit, reason: '123456789' }).success, 'reason >= 10');
  assert.ok(!adminDirectEditBodySchema.safeParse({ description: 'x', reason: '0123456789' }).success, 'expectedListingVersion required');
  assert.ok(!adminDirectEditBodySchema.safeParse({ ...edit, status: 'APPROVED' }).success);
  assert.ok(!adminRetireBodySchema.safeParse({ reason: 'ngắn' }).success);
  assert.ok(!ownerProposalBodySchema.safeParse({ gymId: '7b6f4f8e-1111-4222-8333-444455556666', name: 'a', suggestedCategory: 'SERVICE' }).success);
});

test('diffPayloads: description / amenities / proposals / photo order / cover; NO change for the same content', () => {
  const base = { description: 'A', amenityIds: ['x', 'y'], proposalIds: [], photoIds: ['p1', 'p2'], coverPhotoId: 'p1' };
  assert.deepEqual(diffPayloads(base, { ...base, amenityIds: ['y', 'x'] }), [], 'amenity order is not a change');
  assert.deepEqual(diffPayloads(base, { ...base, description: null }).map((c) => c.path), ['description']);
  assert.deepEqual(diffPayloads({ ...base, description: '' }, { ...base, description: null }), [], 'blank equals null');
  const c = diffPayloads(base, { ...base, amenityIds: ['x', 'z'], photoIds: ['p2', 'p1'], coverPhotoId: 'p2', proposalIds: ['q'] });
  assert.deepEqual(c.map((x) => x.path), ['amenityIds', 'proposalIds', 'photoIds', 'coverPhotoId']);
  assert.deepEqual([c[0].added, c[0].removed], [['z'], ['y']]);
  assert.deepEqual(c[2].added, [], 'a pure reorder adds and removes nothing but IS a change');
});

test('normalizeAmenityName: accents, case and whitespace do not matter ("Phòng boxing" == "phong BOXING"; đ -> d)', () => {
  assert.equal(normalizeAmenityName('Phòng boxing'), normalizeAmenityName('  phong   BOXING '));
  assert.equal(normalizeAmenityName('Đấu trường'), 'dau truong');
  assert.notEqual(normalizeAmenityName('Phòng boxing'), normalizeAmenityName('Phòng yoga'));
});
