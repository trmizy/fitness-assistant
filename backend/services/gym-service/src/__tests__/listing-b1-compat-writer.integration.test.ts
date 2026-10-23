/**
 * BACKEND INTEGRATION - Listing Management B1, the DB-side proof that the legacy-compat event writer is complete
 * (plan 12.15 item 3): the AFTER INSERT/UPDATE triggers on `gyms` and `gym_partners` read
 * `current_setting('gymini.compat_writer', true)`.
 *
 *   'v1'                       -> no row                    (every covered code path)
 *   'seed' | 'maintenance'     -> outcome NON_CLIENT
 *   empty / unset / anything else -> outcome WRITER_ABSENT  (old code, a not-yet-updated instance, a hand-run script)
 *
 * Part 1 runs representative flows through the REAL service code and asserts that none of the gyms / partners they
 * touched got a WRITER_ABSENT row. Part 2 proves the trigger itself fires for an uncovered raw write.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { cleanupRegistry, makeGym, makeOwner, newRegistry } from './listing-b1.test-helpers';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:9';

const reg = newRegistry();
let prisma: typeof import('../repositories/prisma').prisma;

test.before(async () => {
  if (skip) return;
  prisma = (await import('../repositories/prisma')).prisma;
});

test.after(async () => {
  if (skip) return;
  await cleanupRegistry(reg);
  await prisma.$disconnect();
});

const eventsFor = (ids: string[], outcome?: string) =>
  prisma.legacyCompatEvent.findMany({ where: { entityId: { in: ids }, ...(outcome ? { outcome: outcome as any } : {}) }, orderBy: { occurredAt: 'asc' } });

test('covered write paths (gym.service, gym-draft.service, partner.service, partner-application*, gym-approval.tx, mirror sync) never log WRITER_ABSENT', async () => {
  const { gymService } = await import('../services/gym.service');
  const { gymDraftService } = await import('../services/gym-draft.service');
  const { partnerService } = await import('../services/partner.service');
  const { partnerRepository } = await import('../repositories/partner.repository');
  const { partnerApplicationService } = await import('../services/partner-application.service');
  const { partnerApplicationReviewService } = await import('../services/partner-application-review.service');
  const { applyGymApprovalTx } = await import('../services/gym-approval.tx');
  const { syncFacilitiesMirrorTx } = await import('../services/gym-amenity.service');
  const { runAsCompatWriter } = await import('../repositories/compat-writer');

  const touched: string[] = [];
  const adminId = randomUUID();
  const owner = await makeOwner(reg);
  touched.push(owner.partnerId);

  // gym.service — create, owner edit, admin edit / request-changes / rename, moderation, operational switch
  const gym = await gymService.createGym(owner.ownerId, { name: 'Compat Gym', address: 'A1', description: 'd' });
  reg.gyms.push(gym.id);
  touched.push(gym.id);
  await gymService.updateOwnedGym(gym.id, owner.ownerId, { phone: '0900', name: 'Compat Gym 2' });
  await gymService.requestChanges(gym.id, adminId, { nameNote: 'đổi tên' });
  await gymService.updateGymAsAdmin(gym.id, { city: 'HCM' });
  await gymService.setStatus(gym.id, 'APPROVED');
  await gymService.updateOwnedGym(gym.id, owner.ownerId, { name: 'Compat Gym 3', address: 'A2' });
  await gymService.approveRename(gym.id);
  await gymService.setOperationalStatus(gym.id, owner.ownerId, 'TEMPORARILY_CLOSED', 'bảo trì', undefined, { userId: owner.ownerId, role: 'OWNER' });
  await gymService.setOperationalStatus(gym.id, owner.ownerId, 'OPEN', undefined, undefined, { userId: owner.ownerId, role: 'OWNER' });
  await gymService.setStatus(gym.id, 'SUSPENDED');

  // gym-draft.service — create, partial save (with facilities -> gym_amenities + mirror)
  const draft = await gymDraftService.createDraft(owner.ownerId);
  reg.gyms.push(draft.id);
  touched.push(draft.id);
  await gymDraftService.updateDraft(draft.id, owner.ownerId, { name: 'Draft', wizardStep: 3 });
  await gymDraftService.updateDraft(draft.id, owner.ownerId, { facilities: ['WIFI', 'SAUNA'] as any, description: 'x' });

  // partner.service / partner.repository — create, suspend, unsuspend
  const created = await partnerService.createPartner({ legalName: 'Compat Partner', contactEmail: `${randomUUID().slice(0, 8)}@compat.test` }, adminId);
  reg.partners.push(created.id);
  touched.push(created.id);
  await partnerRepository.updatePartner(created.id, { negotiationNotes: 'note' });
  await partnerService.suspend(owner.partnerId, adminId, 'điều tra');
  await partnerService.unsuspend(owner.partnerId, adminId);

  // partner-application.service — bootstrap, representative, scale, legal, first branch (lockPartner tx: gym.create + gym.update)
  const applicantId = randomUUID();
  const boot = await partnerApplicationService.bootstrap(applicantId, `${applicantId.slice(0, 8)}@applicants.test`);
  reg.partners.push(boot.partnerId);
  touched.push(boot.partnerId);
  const brand = await prisma.gymBrand.create({ data: { ownerId: applicantId, name: 'Applicant Brand' } });
  reg.brands.push(brand.id);
  await partnerRepository.updatePartner(boot.partnerId, { brandId: brand.id });
  const ctx = await partnerService.resolveContextForUser(applicantId);
  await partnerApplicationService.updateRepresentative(ctx, { name: 'Nguyễn A', phone: '0900000000', role: 'GYM_OWNER' });
  await partnerApplicationService.updateBusinessScale(ctx, 'ONE_BRANCH');
  await partnerApplicationService.updateLegal(ctx, { legalName: 'Công ty A', taxCode: '123' });
  const branch = await partnerApplicationService.upsertBranch(ctx, { name: 'Chi nhánh A', address: 'Addr' });
  reg.gyms.push(branch.id);
  touched.push(branch.id);

  // partner-application-review.service — reject + reopen (lockPartner + gymPartner.updateMany)
  await partnerApplicationReviewService.reject(boot.partnerId, adminId, 'thiếu giấy tờ');
  await partnerApplicationReviewService.reopen(boot.partnerId, adminId);

  // gym-approval.tx — first approval of the application's DRAFT branch; and the mirror sync on its own
  await prisma.$transaction((tx) => applyGymApprovalTx(tx, branch.id));
  await prisma.$transaction((tx) => syncFacilitiesMirrorTx(tx, draft.id));
  await runAsCompatWriter((tx) => tx.gym.update({ where: { id: draft.id }, data: { locationNote: 'n' } }));

  const absent = await eventsFor(touched, 'WRITER_ABSENT');
  assert.deepEqual(absent, [], `uncovered write path(s): ${JSON.stringify(absent.map((e) => [e.entityType, e.entityId, e.action]))}`);
  // Sanity: the seeded fixtures DID leave NON_CLIENT rows, i.e. the trigger is active on these very ids.
  assert.ok((await eventsFor(touched, 'NON_CLIENT')).length >= 1);
  // B3: these direct service calls carry no X-Gymini-Listing-Flow header, i.e. they ARE old-client requests, so the paths that record legacy
  // evidence leave ACCEPTED rows (checked in listing-b3-*). Nothing may be WRITER_ABSENT or REJECTED_422 here.
  assert.equal((await eventsFor(touched)).filter((e) => e.outcome !== 'NON_CLIENT' && e.outcome !== 'ACCEPTED').length, 0);
});

test('a raw UPDATE without the GUC is recorded as WRITER_ABSENT (action UPDATE, entity_type GYM, entity_id)', async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  await prisma.$executeRaw`UPDATE gyms SET phone = '0911' WHERE id = ${gymId}`;
  const events = await eventsFor([gymId], 'WRITER_ABSENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'UPDATE');
  assert.equal(events[0].entityType, 'GYM');
  assert.equal(events[0].flowHeader, null);
  assert.equal(events[0].clientHeader, null);
  assert.equal(events[0].actorUserId, null);
  assert.ok(Math.abs(Date.now() - events[0].occurredAt.getTime()) < 60_000);
});

test('a Prisma-native write on gyms / gym_partners with no declaration is WRITER_ABSENT too (INSERT and UPDATE, both tables)', async () => {
  const partnerId = randomUUID();
  const gymId = randomUUID();
  reg.partners.push(partnerId);
  reg.gyms.push(gymId);
  await prisma.gymPartner.create({ data: { id: partnerId, legalName: 'Raw partner' } });
  await prisma.gymPartner.update({ where: { id: partnerId }, data: { contactPhone: '1' } });
  await prisma.gym.create({ data: { id: gymId, ownerId: randomUUID(), name: 'Raw', address: 'a' } });
  const p = await eventsFor([partnerId]);
  assert.deepEqual(p.map((e) => [e.outcome, e.action, e.entityType]), [
    ['WRITER_ABSENT', 'INSERT', 'GYM_PARTNER'],
    ['WRITER_ABSENT', 'UPDATE', 'GYM_PARTNER'],
  ]);
  const g = await eventsFor([gymId]);
  assert.deepEqual(g.map((e) => [e.outcome, e.action, e.entityType]), [['WRITER_ABSENT', 'INSERT', 'GYM']]);
});

test("GUC values: 'v1' logs nothing, 'seed' and 'maintenance' log NON_CLIENT, '' / 'v2' / unknown log WRITER_ABSENT", async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const base = (await eventsFor([gymId])).length;
  const touch = async (value: string | null, n: number) => {
    await prisma.$transaction(async (tx) => {
      if (value !== null) await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = '${value}'`);
      await tx.$executeRaw`UPDATE gyms SET phone = ${`09${n}`} WHERE id = ${gymId}`;
    });
  };
  const tail = async () => (await eventsFor([gymId])).slice(base).map((e) => e.outcome);

  await touch('v1', 1);
  assert.deepEqual(await tail(), []);
  await touch('seed', 2);
  await touch('maintenance', 3);
  assert.deepEqual(await tail(), ['NON_CLIENT', 'NON_CLIENT']);
  await touch('', 4);
  await touch('v2', 5);
  await touch('V1', 6);
  await touch(null, 7);
  assert.deepEqual(await tail(), ['NON_CLIENT', 'NON_CLIENT', 'WRITER_ABSENT', 'WRITER_ABSENT', 'WRITER_ABSENT', 'WRITER_ABSENT']);
});

test('the declaration is transaction-local: after a v1 transaction commits, the next plain write on the pool is WRITER_ABSENT again', async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const base = (await eventsFor([gymId])).length;
  for (let i = 0; i < 6; i++) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'v1'`);
      await tx.$executeRaw`UPDATE gyms SET phone = ${`v1-${i}`} WHERE id = ${gymId}`;
    });
    await prisma.$executeRaw`UPDATE gyms SET phone = ${`plain-${i}`} WHERE id = ${gymId}`;
  }
  const tail = (await eventsFor([gymId])).slice(base);
  assert.equal(tail.length, 6, 'one WRITER_ABSENT per plain write, none for the v1 ones - no leak across pooled connections');
  assert.ok(tail.every((e) => e.outcome === 'WRITER_ABSENT'));
});

test('one event per affected ROW: an UPDATE touching 3 gyms logs 3 events', async () => {
  const owner = await makeOwner(reg);
  const ids = [
    await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId }),
    await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId }),
    await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId }),
  ];
  const base = (await eventsFor(ids)).length;
  await prisma.$executeRaw`UPDATE gyms SET phone = '0999' WHERE id IN (${ids[0]}, ${ids[1]}, ${ids[2]})`;
  const tail = (await eventsFor(ids)).slice(base);
  assert.equal(tail.length, 3);
  assert.deepEqual([...new Set(tail.map((e) => e.entityId))].sort(), [...ids].sort());
});

test('a rolled-back write leaves no event (the event is written by the same transaction)', async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const base = (await eventsFor([gymId])).length;
  await assert.rejects(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE gyms SET phone = 'rolled-back' WHERE id = ${gymId}`;
      throw new Error('boom');
    }),
  );
  assert.equal((await eventsFor([gymId])).length, base);
});
