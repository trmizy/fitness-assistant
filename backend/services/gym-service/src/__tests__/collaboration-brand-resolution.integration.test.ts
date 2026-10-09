import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { collaborationService } from '../services/collaboration.service';
import { partnerGuard } from '../services/partner-guard.service';
import { membershipService } from '../services/membership.service';
import { profileClient } from '../clients/profile.client';

/**
 * Đường ĐỌC thoả thuận PT cấp thương hiệu: activeRates() và listAcceptedGymsForPt() cùng một phép
 * phân giải (xem comment trên BRAND_AGREEMENT_USABLE trong collaboration.service.ts).
 *
 * Mỗi test tự dựng thế giới riêng bằng uuid ngẫu nhiên (PT, owner, brand, gym) và dọn đúng những gì
 * mình tạo — các file test khác chạy song song trên cùng một DB, nên không truy vấn "tất cả".
 */

const R_BRAND = { pt: '0.6000', gym: '0.3000', platform: '0.1000' };
const R_LEGACY_A = { pt: '0.5500', gym: '0.3500', platform: '0.1000' };
const R_LEGACY_B = { pt: '0.5000', gym: '0.4000', platform: '0.1000' };
// Decimal.toString() bỏ số 0 thừa: đây là dạng chuỗi mà activeRates trả ra, giống hệt trước đây.
const str = (r: { pt: string; gym: string; platform: string }) => ({
  ptRate: String(Number(r.pt)),
  gymRate: String(Number(r.gym)),
  platformRate: String(Number(r.platform)),
});

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const daysAgo = (n: number) => inDays(-n);

type OperationalStatus = 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED';
type GymStatus = 'APPROVED' | 'SUSPENDED' | 'PENDING_REVIEW';

interface World {
  ptUserId: string;
  brandIds: string[];
  gymIds: string[];
  partnerIds: string[];
  ownerIds: string[];
  /** Mọi PT phụ của bài test — để dọn dẹp. */
  extraPts: string[];
}
const newWorld = (): World => ({ ptUserId: randomUUID(), brandIds: [], gymIds: [], partnerIds: [], ownerIds: [], extraPts: [] });

async function makeOwner(world: World, partnerStatus?: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') {
  const ownerId = randomUUID();
  world.ownerIds.push(ownerId);
  if (partnerStatus) {
    const partner = await prisma.gymPartner.create({
      data: {
        legalName: `Brand Resolution ${ownerId.slice(0, 8)}`,
        contactEmail: `${ownerId.slice(0, 8)}@brand-resolution.test`,
        status: partnerStatus,
        verificationStatus: 'VERIFIED',
      },
    });
    world.partnerIds.push(partner.id);
    await prisma.gymPartnerAccount.create({
      data: {
        partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE',
        activatedAt: new Date(), onboardingCompletedAt: new Date(),
      },
    });
  }
  return ownerId;
}

async function makeBrand(world: World, ownerId: string) {
  const brand = await prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name: 'Brand Resolution Brand' } });
  world.brandIds.push(brand.id);
  return brand.id;
}

async function makeGym(
  world: World,
  ownerId: string,
  brandId: string | null,
  o: { status?: GymStatus; operationalStatus?: OperationalStatus; name?: string } = {},
) {
  const gym = await prisma.gym.create({
    data: {
      id: randomUUID(),
      ownerId,
      brandId,
      name: o.name ?? 'Brand Resolution Gym',
      address: '1 Test St',
      status: o.status ?? 'APPROVED',
      operationalStatus: o.operationalStatus ?? 'OPEN',
    },
  });
  world.gymIds.push(gym.id);
  return gym.id;
}

async function makeBrandAgreement(
  brandId: string,
  ptUserId: string,
  o: {
    status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'TERMINATED';
    rates?: { pt: string; gym: string; platform: string };
    terminationInitiatedAt?: Date | null;
    effectiveAt?: Date | null;
    acceptedAt?: Date;
  } = {},
) {
  const status = o.status ?? 'ACCEPTED';
  const rates = o.rates ?? R_BRAND;
  return prisma.gymBrandPtAgreement.create({
    data: {
      id: randomUUID(),
      brandId,
      ptUserId,
      proposedPtRate: rates.pt,
      proposedGymRate: rates.gym,
      platformRate: rates.platform,
      status,
      proposedBy: 'GYM',
      expiresAt: inDays(7),
      acceptedAt: status === 'ACCEPTED' || status === 'TERMINATED' ? (o.acceptedAt ?? new Date()) : null,
      terminationInitiatedAt: o.terminationInitiatedAt ?? null,
      effectiveAt: o.effectiveAt ?? null,
      origin: 'NATIVE',
    },
  });
}

async function makeLegacy(
  gymId: string,
  ptUserId: string,
  o: {
    status?: 'PENDING' | 'ACCEPTED' | 'TERMINATED';
    rates?: { pt: string; gym: string; platform: string };
    supersededByAgreementId?: string | null;
    terminationInitiatedAt?: Date | null;
    effectiveAt?: Date | null;
    acceptedAt?: Date;
  } = {},
) {
  const status = o.status ?? 'ACCEPTED';
  const rates = o.rates ?? R_LEGACY_A;
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      proposedPtRate: rates.pt,
      proposedGymRate: rates.gym,
      platformRate: rates.platform,
      status,
      proposedBy: 'GYM',
      expiresAt: inDays(7),
      acceptedAt: status === 'ACCEPTED' ? (o.acceptedAt ?? new Date()) : null,
      effectiveAt: o.effectiveAt ?? null,
      terminationInitiatedAt: o.terminationInitiatedAt ?? null,
      supersededByAgreementId: o.supersededByAgreementId ?? null,
      supersededAt: o.supersededByAgreementId ? new Date() : null,
    },
  });
}

async function cleanup(world: World) {
  const pts = [world.ptUserId, ...world.extraPts];
  await prisma.gymPtCollaboration
    .deleteMany({ where: { OR: [{ ptUserId: { in: pts } }, { gymId: { in: world.gymIds } }] } })
    .catch(() => {});
  await prisma.gymBrandPtAgreement
    .deleteMany({ where: { OR: [{ ptUserId: { in: pts } }, { brandId: { in: world.brandIds } }] } })
    .catch(() => {});
  await prisma.gym.deleteMany({ where: { id: { in: world.gymIds } } }).catch(() => {});
  await prisma.gymBrand.deleteMany({ where: { id: { in: world.brandIds } } }).catch(() => {});
  await prisma.gymPartnerAccount.deleteMany({ where: { userId: { in: world.ownerIds } } }).catch(() => {});
  await prisma.gymPartner.deleteMany({ where: { id: { in: world.partnerIds } } }).catch(() => {});
}

/**
 * Bất biến cốt lõi, kiểm tổng quát cho mọi kịch bản: với từng chi nhánh trong `gymIds`, nếu bộ chọn
 * có liệt kê thì activeRates trả ĐÚNG cùng id + bảng tỷ lệ; nếu bộ chọn bỏ qua thì activeRates trả null.
 * Mỗi chi nhánh chỉ xuất hiện tối đa một lần. Trả về map gymId → mục của bộ chọn để test kiểm thêm.
 */
async function assertPickerAgreesWithRates(ptUserId: string, gymIds: string[]) {
  const picker = (await collaborationService.listAcceptedGymsForPt(ptUserId)).filter((o) => gymIds.includes(o.gym.id));
  const listed = new Map(picker.map((o) => [o.gym.id, o]));
  assert.equal(listed.size, picker.length, 'a branch must be listed at most once');
  for (const gymId of gymIds) {
    const rates = await collaborationService.activeRates(gymId, ptUserId);
    const entry = listed.get(gymId);
    if (entry) {
      assert.ok(rates, `picker offers ${gymId} but activeRates refuses it`);
      assert.equal(rates!.collaborationId, entry.collaborationId);
      assert.deepEqual(
        { ptRate: rates!.ptRate, gymRate: rates!.gymRate, platformRate: rates!.platformRate },
        entry.rates,
        `picker and activeRates disagree on the rates at ${gymId}`,
      );
    } else {
      assert.equal(rates, null, `picker omits ${gymId} but activeRates hands out rates`);
    }
  }
  return listed;
}

// ── Brand agreement ────────────────────────────────────────────────────────

integrationTest('brand agreement: rates at EVERY open approved branch, including one that never had a legacy row', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId, { name: 'B1' });
    const g2 = await makeGym(w, owner, brandId, { name: 'B2' });
    const g3 = await makeGym(w, owner, brandId, { name: 'B3' });
    const agreement = await makeBrandAgreement(brandId, w.ptUserId);
    // g1 has a (superseded) legacy row, g2/g3 never did.
    await makeLegacy(g1, w.ptUserId, { supersededByAgreementId: agreement.id, rates: R_LEGACY_B });

    for (const g of [g1, g2, g3]) {
      const rates = await collaborationService.activeRates(g, w.ptUserId);
      assert.deepEqual(rates, { collaborationId: agreement.id, ...str(R_BRAND), agreementScope: 'BRAND' });
    }
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [g1, g2, g3]);
    assert.equal(listed.size, 3);
    for (const entry of listed.values()) assert.equal(entry.collaborationId, agreement.id);
  } finally {
    await cleanup(w);
  }
});

integrationTest('brand agreement: a TEMPORARILY_CLOSED / PERMANENTLY_CLOSED / not-APPROVED branch is refused and unlisted, siblings still work', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const open = await makeGym(w, owner, brandId);
    const tempClosed = await makeGym(w, owner, brandId, { operationalStatus: 'TEMPORARILY_CLOSED' });
    const permClosed = await makeGym(w, owner, brandId, { operationalStatus: 'PERMANENTLY_CLOSED' });
    const suspended = await makeGym(w, owner, brandId, { status: 'SUSPENDED' });
    const pending = await makeGym(w, owner, brandId, { status: 'PENDING_REVIEW' });
    await makeBrandAgreement(brandId, w.ptUserId);

    const all = [open, tempClosed, permClosed, suspended, pending];
    const listed = await assertPickerAgreesWithRates(w.ptUserId, all);
    assert.deepEqual([...listed.keys()], [open]);
    assert.equal((await collaborationService.activeRates(open, w.ptUserId))!.agreementScope, 'BRAND');
    for (const g of [tempClosed, permClosed, suspended, pending]) {
      assert.equal(await collaborationService.activeRates(g, w.ptUserId), null);
    }
  } finally {
    await cleanup(w);
  }
});

integrationTest('brand agreement that is winding down, notice-period terminated, or not ACCEPTED is refused everywhere', async () => {
  const cases: Array<[string, Parameters<typeof makeBrandAgreement>[2]]> = [
    ['terminationInitiatedAt set', { terminationInitiatedAt: new Date() }],
    ['effectiveAt set', { effectiveAt: inDays(14) }],
    ['status PENDING', { status: 'PENDING' }],
    ['status TERMINATED', { status: 'TERMINATED' }],
    ['status EXPIRED', { status: 'EXPIRED' }],
    ['status REJECTED', { status: 'REJECTED' }],
  ];
  for (const [label, opts] of cases) {
    const w = newWorld();
    try {
      const owner = await makeOwner(w);
      const brandId = await makeBrand(w, owner);
      const gyms = [await makeGym(w, owner, brandId), await makeGym(w, owner, brandId)];
      await makeBrandAgreement(brandId, w.ptUserId, opts);
      const listed = await assertPickerAgreesWithRates(w.ptUserId, gyms);
      assert.equal(listed.size, 0, `${label}: nothing may be offered`);
      for (const g of gyms) assert.equal(await collaborationService.activeRates(g, w.ptUserId), null, label);
    } finally {
      await cleanup(w);
    }
  }
});

integrationTest('brand agreement takes precedence over a still-unsuperseded legacy row at the same branch', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId);
    const g2 = await makeGym(w, owner, brandId);
    const agreement = await makeBrandAgreement(brandId, w.ptUserId);
    await makeLegacy(g1, w.ptUserId, { rates: R_LEGACY_B }); // NOT superseded

    const rates = await collaborationService.activeRates(g1, w.ptUserId);
    assert.deepEqual(rates, { collaborationId: agreement.id, ...str(R_BRAND), agreementScope: 'BRAND' });
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [g1, g2]);
    assert.equal(listed.size, 2, 'g1 is listed once, not once per agreement');
    assert.equal(listed.get(g1)!.collaborationId, agreement.id);
  } finally {
    await cleanup(w);
  }
});

integrationTest('an unusable brand agreement does not shadow a usable legacy row at the branch (not-yet-superseded fallback)', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId);
    await makeBrandAgreement(brandId, w.ptUserId, { terminationInitiatedAt: new Date() });
    const legacy = await makeLegacy(g1, w.ptUserId, { rates: R_LEGACY_A });

    const rates = await collaborationService.activeRates(g1, w.ptUserId);
    assert.deepEqual(rates, { collaborationId: legacy.id, ...str(R_LEGACY_A), agreementScope: 'BRANCH' });
    await assertPickerAgreesWithRates(w.ptUserId, [g1]);
  } finally {
    await cleanup(w);
  }
});

// ── Legacy ────────────────────────────────────────────────────────────────

integrationTest('legacy fallback for a not-migrated pair works only at its own branch', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const withRow = await makeGym(w, owner, brandId);
    const sibling = await makeGym(w, owner, brandId);
    const legacy = await makeLegacy(withRow, w.ptUserId);

    assert.deepEqual(await collaborationService.activeRates(withRow, w.ptUserId), {
      collaborationId: legacy.id,
      ...str(R_LEGACY_A),
      agreementScope: 'BRANCH',
    });
    assert.equal(await collaborationService.activeRates(sibling, w.ptUserId), null);
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [withRow, sibling]);
    assert.deepEqual([...listed.keys()], [withRow]);
  } finally {
    await cleanup(w);
  }
});

integrationTest('conflict pair (different legacy rates, no brand agreement): each branch returns ITS OWN legacy rates', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId);
    const g2 = await makeGym(w, owner, brandId);
    const c1 = await makeLegacy(g1, w.ptUserId, { rates: R_LEGACY_A });
    const c2 = await makeLegacy(g2, w.ptUserId, { rates: R_LEGACY_B });

    assert.deepEqual(await collaborationService.activeRates(g1, w.ptUserId), { collaborationId: c1.id, ...str(R_LEGACY_A), agreementScope: 'BRANCH' });
    assert.deepEqual(await collaborationService.activeRates(g2, w.ptUserId), { collaborationId: c2.id, ...str(R_LEGACY_B), agreementScope: 'BRANCH' });
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [g1, g2]);
    assert.equal(listed.size, 2);
  } finally {
    await cleanup(w);
  }
});

integrationTest('a legacy row already winding down (terminationInitiatedAt or effectiveAt) is not an agreement', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const g1 = await makeGym(w, owner, null);
    const g2 = await makeGym(w, owner, null);
    await makeLegacy(g1, w.ptUserId, { terminationInitiatedAt: new Date() });
    await makeLegacy(g2, w.ptUserId, { effectiveAt: inDays(14) });
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [g1, g2]);
    assert.equal(listed.size, 0);
  } finally {
    await cleanup(w);
  }
});

integrationTest('superseded legacy row is never used — including after its brand agreement is terminated', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId);
    const g2 = await makeGym(w, owner, brandId);
    const agreement = await makeBrandAgreement(brandId, w.ptUserId);
    const l1 = await makeLegacy(g1, w.ptUserId, { supersededByAgreementId: agreement.id, rates: R_LEGACY_A });
    await makeLegacy(g2, w.ptUserId, { supersededByAgreementId: agreement.id, rates: R_LEGACY_A });

    // While the brand agreement is live, the brand rates win everywhere.
    assert.equal((await collaborationService.activeRates(g1, w.ptUserId))!.agreementScope, 'BRAND');

    // Notice-period termination of the brand agreement.
    await prisma.gymBrandPtAgreement.update({ where: { id: agreement.id }, data: { terminationInitiatedAt: new Date(), effectiveAt: inDays(14) } });
    assert.equal(await collaborationService.activeRates(g1, w.ptUserId), null, 'the superseded legacy row must not come back');
    assert.equal((await assertPickerAgreesWithRates(w.ptUserId, [g1, g2])).size, 0);

    // Fully terminated.
    await prisma.gymBrandPtAgreement.update({ where: { id: agreement.id }, data: { status: 'TERMINATED', terminatedAt: new Date() } });
    assert.equal(await collaborationService.activeRates(g1, w.ptUserId), null);
    assert.equal(await collaborationService.activeRates(g2, w.ptUserId), null);
    assert.equal((await assertPickerAgreesWithRates(w.ptUserId, [g1, g2])).size, 0);

    // The legacy row itself was never touched (still ACCEPTED, still marked superseded).
    const row = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: l1.id } });
    assert.equal(row.status, 'ACCEPTED');
    assert.equal(row.supersededByAgreementId, agreement.id);
  } finally {
    await cleanup(w);
  }
});

integrationTest('PT with agreements in two brands gets the right rates in each; brandless gym uses legacy only', async () => {
  const w = newWorld();
  try {
    const ownerA = await makeOwner(w);
    const ownerB = await makeOwner(w);
    const ownerC = await makeOwner(w);
    const brandA = await makeBrand(w, ownerA);
    const brandB = await makeBrand(w, ownerB);
    const a1 = await makeGym(w, ownerA, brandA);
    const a2 = await makeGym(w, ownerA, brandA);
    const b1 = await makeGym(w, ownerB, brandB);
    const solo = await makeGym(w, ownerC, null);
    const agA = await makeBrandAgreement(brandA, w.ptUserId, { rates: R_BRAND });
    const agB = await makeBrandAgreement(brandB, w.ptUserId, { rates: R_LEGACY_B });
    const soloLegacy = await makeLegacy(solo, w.ptUserId, { rates: R_LEGACY_A });

    for (const g of [a1, a2]) {
      assert.deepEqual(await collaborationService.activeRates(g, w.ptUserId), { collaborationId: agA.id, ...str(R_BRAND), agreementScope: 'BRAND' });
    }
    assert.deepEqual(await collaborationService.activeRates(b1, w.ptUserId), { collaborationId: agB.id, ...str(R_LEGACY_B), agreementScope: 'BRAND' });
    assert.deepEqual(await collaborationService.activeRates(solo, w.ptUserId), { collaborationId: soloLegacy.id, ...str(R_LEGACY_A), agreementScope: 'BRANCH' });
    const listed = await assertPickerAgreesWithRates(w.ptUserId, [a1, a2, b1, solo]);
    assert.equal(listed.size, 4);

    // A different trainer holds nothing here.
    assert.equal(await collaborationService.activeRates(a1, randomUUID()), null);
  } finally {
    await cleanup(w);
  }
});

integrationTest('picker response shape and ordering: acceptedAt newest first, then name, then id; no duplicates', async () => {
  const w = newWorld();
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const zeta = await makeGym(w, owner, brandId, { name: 'Zeta' });
    const alpha = await makeGym(w, owner, brandId, { name: 'Alpha' });
    const solo = await makeGym(w, owner, null, { name: 'Solo' });
    const agreement = await makeBrandAgreement(brandId, w.ptUserId, { acceptedAt: daysAgo(10) });
    const legacy = await makeLegacy(solo, w.ptUserId, { acceptedAt: daysAgo(1) });

    const mine = (await collaborationService.listAcceptedGymsForPt(w.ptUserId));
    assert.deepEqual(mine.map((o) => o.gym.id), [solo, alpha, zeta]);
    assert.deepEqual(Object.keys(mine[0]).sort(), ['collaborationId', 'gym', 'rates']);
    assert.deepEqual(Object.keys(mine[0].gym).sort(), ['city', 'id', 'name']);
    assert.equal(mine[0].collaborationId, legacy.id);
    assert.equal(mine[1].collaborationId, agreement.id);
    assert.deepEqual(mine[1].rates, str(R_BRAND));
  } finally {
    await cleanup(w);
  }
});

// ── Partner eligibility ───────────────────────────────────────────────────

for (const partnerStatus of ['SUSPENDED', 'TERMINATED'] as const) {
  integrationTest(`partner ${partnerStatus}: refused by activeRates and absent from the picker (brand and legacy agreements)`, async () => {
    const w = newWorld();
    try {
      const ownerLocked = await makeOwner(w, partnerStatus);
      const ownerOk = await makeOwner(w, 'ACTIVE');
      const brandLocked = await makeBrand(w, ownerLocked);
      const brandOk = await makeBrand(w, ownerOk);
      const lockedBrandGym = await makeGym(w, ownerLocked, brandLocked);
      const lockedLegacyGym = await makeGym(w, ownerLocked, null);
      const okGym = await makeGym(w, ownerOk, brandOk);
      await makeBrandAgreement(brandLocked, w.ptUserId);
      await makeLegacy(lockedLegacyGym, w.ptUserId);
      await makeBrandAgreement(brandOk, w.ptUserId);

      assert.equal(await collaborationService.activeRates(lockedBrandGym, w.ptUserId), null);
      assert.equal(await collaborationService.activeRates(lockedLegacyGym, w.ptUserId), null);
      assert.equal((await collaborationService.activeRates(okGym, w.ptUserId))!.agreementScope, 'BRAND');
      const listed = await assertPickerAgreesWithRates(w.ptUserId, [lockedBrandGym, lockedLegacyGym, okGym]);
      assert.deepEqual([...listed.keys()], [okGym]);
    } finally {
      await cleanup(w);
    }
  });
}

integrationTest('legacy owner with no partner record is allowed, as for memberships; ACTIVE partner too', async () => {
  const w = newWorld();
  try {
    const legacyOwner = await makeOwner(w); // no GymPartner/GymPartnerAccount
    assert.equal(await partnerGuard.acceptsNewMoney(legacyOwner), true);
    const brandId = await makeBrand(w, legacyOwner);
    const g = await makeGym(w, legacyOwner, brandId);
    const ag = await makeBrandAgreement(brandId, w.ptUserId);
    assert.equal((await collaborationService.activeRates(g, w.ptUserId))!.collaborationId, ag.id);
    await assertPickerAgreesWithRates(w.ptUserId, [g]);
  } finally {
    await cleanup(w);
  }
});

integrationTest('acceptsNewMoney shares assertAcceptsNewMoney\'s definition and does not swallow unrelated errors', async () => {
  const w = newWorld();
  const original = partnerGuard.assertAcceptsNewMoney;
  try {
    const suspended = await makeOwner(w, 'SUSPENDED');
    const terminated = await makeOwner(w, 'TERMINATED');
    const active = await makeOwner(w, 'ACTIVE');
    assert.equal(await partnerGuard.acceptsNewMoney(suspended), false);
    assert.equal(await partnerGuard.acceptsNewMoney(terminated), false);
    assert.equal(await partnerGuard.acceptsNewMoney(active), true);

    // A failure that is NOT the guard's refusal (say, the database going away) must surface.
    partnerGuard.assertAcceptsNewMoney = async () => {
      throw new Error('connection reset');
    };
    await assert.rejects(() => partnerGuard.acceptsNewMoney(active), /connection reset/);

    // ...and it surfaces through the contract-facing functions too, instead of reading as "not eligible".
    const brandId = await makeBrand(w, active);
    const g = await makeGym(w, active, brandId);
    await makeBrandAgreement(brandId, w.ptUserId);
    await assert.rejects(() => collaborationService.activeRates(g, w.ptUserId), /connection reset/);
    await assert.rejects(() => collaborationService.listAcceptedGymsForPt(w.ptUserId), /connection reset/);
  } finally {
    partnerGuard.assertAcceptsNewMoney = original;
    await cleanup(w);
  }
});

integrationTest('activeRates returns null for a gym that does not exist', async () => {
  assert.equal(await collaborationService.activeRates(randomUUID(), randomUUID()), null);
});

// ── Referral (membership.service.resolveReferral) ─────────────────────────

integrationTest('resolveReferral: honoured at any open branch of a brand the PT holds an agreement with (even one with no legacy row), refused at a closed one', async () => {
  const w = newWorld();
  const original = profileClient.resolveReferralCode;
  try {
    const owner = await makeOwner(w);
    const brandId = await makeBrand(w, owner);
    const g1 = await makeGym(w, owner, brandId);
    const g2 = await makeGym(w, owner, brandId);
    const closed = await makeGym(w, owner, brandId, { operationalStatus: 'TEMPORARILY_CLOSED' });
    const other = await makeGym(w, await makeOwner(w), null);
    await makeBrandAgreement(brandId, w.ptUserId);
    await makeLegacy(g1, w.ptUserId, { supersededByAgreementId: (await prisma.gymBrandPtAgreement.findFirstOrThrow({ where: { brandId } })).id });
    // The code lookup itself calls user-service (not running here); stub only that one call.
    profileClient.resolveReferralCode = async () => w.ptUserId;
    const clientId = randomUUID();

    assert.deepEqual(await membershipService.resolveReferral('CODE', g1, clientId), { ptUserId: w.ptUserId });
    assert.deepEqual(await membershipService.resolveReferral('CODE', g2, clientId), { ptUserId: w.ptUserId });
    for (const g of [closed, other]) {
      await assert.rejects(() => membershipService.resolveReferral('CODE', g, clientId), /REFERRAL_NOT_APPLICABLE_AT_THIS_GYM/);
    }
  } finally {
    profileClient.resolveReferralCode = original;
    await cleanup(w);
  }
});
