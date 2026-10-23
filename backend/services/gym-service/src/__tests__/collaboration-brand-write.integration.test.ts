import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { collaborationService, MAX_ROUNDS, BRAND_TERMINATION_NOTICE_DAYS } from '../services/collaboration.service';
import { gymService } from '../services/gym.service';

/**
 * Đường GHI thoả thuận PT cấp thương hiệu: propose / respond / terminate / listFor (+ đếm của
 * closureImpact). Đường ĐỌC (activeRates, listAcceptedGymsForPt) có file riêng:
 * collaboration-brand-resolution.integration.test.ts — ở đây activeRates chỉ dùng làm "trọng tài"
 * để chứng minh thoả thuận vừa ghi thật sự cho ra tỷ lệ ở mọi chi nhánh.
 *
 * Mỗi test tự dựng thế giới riêng bằng uuid ngẫu nhiên và dọn đúng những gì mình tạo — các file test
 * khác chạy song song trên cùng một DB, nên không truy vấn "tất cả".
 */

const RATES = { ptRate: '0.6000', gymRate: '0.3000', platformRate: '0.1000' };
const OTHER = { ptRate: '0.5500', gymRate: '0.3500', platformRate: '0.1000' };
const LEG_A = { pt: '0.5500', gym: '0.3500', platform: '0.1000' };
const LEG_B = { pt: '0.5000', gym: '0.4000', platform: '0.1000' };

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);
const daysAgo = (n: number) => inDays(-n);
const num = (v: unknown) => Number(String(v));

interface World {
  pts: string[];
  brandIds: string[];
  gymIds: string[];
  ownerIds: string[];
}
const newWorld = (): World => ({ pts: [randomUUID()], brandIds: [], gymIds: [], ownerIds: [] });

function makeOwner(world: World) {
  const id = randomUUID();
  world.ownerIds.push(id);
  return id;
}

async function makeBrand(world: World, ownerId: string, name = 'Brand Write Brand') {
  const brand = await prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name } });
  world.brandIds.push(brand.id);
  return brand.id;
}

async function makeGym(
  world: World,
  ownerId: string,
  brandId: string | null,
  o: { status?: 'APPROVED' | 'PENDING_REVIEW' | 'SUSPENDED'; name?: string; createdAt?: Date } = {},
) {
  const gym = await prisma.gym.create({
    data: {
      id: randomUUID(),
      ownerId,
      brandId,
      name: o.name ?? `Brand Write Gym ${randomUUID().slice(0, 6)}`,
      address: '1 Test St',
      city: 'Hanoi',
      status: o.status ?? 'APPROVED',
      operationalStatus: 'OPEN',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
  world.gymIds.push(gym.id);
  return gym.id;
}

/** Một thương hiệu có chủ + hai chi nhánh APPROVED (A, B) — thế giới chuẩn của hầu hết test. */
async function branded(world: World) {
  const ownerId = makeOwner(world);
  const brandId = await makeBrand(world, ownerId);
  const gymA = await makeGym(world, ownerId, brandId, { createdAt: daysAgo(10) });
  const gymB = await makeGym(world, ownerId, brandId, { createdAt: daysAgo(5) });
  return { ownerId, brandId, gymA, gymB };
}

async function makeLegacy(
  gymId: string,
  ptUserId: string,
  o: {
    status?: 'PENDING' | 'COUNTERED' | 'ACCEPTED' | 'TERMINATED';
    rates?: { pt: string; gym: string; platform: string };
    proposedBy?: 'PT' | 'GYM';
    supersededByAgreementId?: string | null;
    expiresAt?: Date;
  } = {},
) {
  const status = o.status ?? 'ACCEPTED';
  const rates = o.rates ?? LEG_A;
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      proposedPtRate: rates.pt,
      proposedGymRate: rates.gym,
      platformRate: rates.platform,
      status,
      proposedBy: o.proposedBy ?? 'GYM',
      expiresAt: o.expiresAt ?? inDays(7),
      acceptedAt: status === 'ACCEPTED' ? new Date() : null,
      supersededByAgreementId: o.supersededByAgreementId ?? null,
      supersededAt: o.supersededByAgreementId ? new Date() : null,
    },
  });
}

async function makeBrandAgreement(
  brandId: string,
  ptUserId: string,
  o: {
    status?: 'PENDING' | 'COUNTERED' | 'ACCEPTED' | 'TERMINATED';
    proposedBy?: 'PT' | 'GYM';
    terminationInitiatedAt?: Date | null;
    effectiveAt?: Date | null;
  } = {},
) {
  const status = o.status ?? 'ACCEPTED';
  return prisma.gymBrandPtAgreement.create({
    data: {
      id: randomUUID(),
      brandId,
      ptUserId,
      proposedPtRate: RATES.ptRate,
      proposedGymRate: RATES.gymRate,
      platformRate: RATES.platformRate,
      status,
      proposedBy: o.proposedBy ?? 'GYM',
      expiresAt: inDays(7),
      acceptedAt: status === 'ACCEPTED' || status === 'TERMINATED' ? new Date() : null,
      terminationInitiatedAt: o.terminationInitiatedAt ?? null,
      effectiveAt: o.effectiveAt ?? null,
      terminatedAt: status === 'TERMINATED' ? new Date() : null,
    },
  });
}

async function makeAffiliation(gymId: string, ptId: string, status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
  return prisma.gymTrainerAffiliation.create({ data: { id: randomUUID(), gymId, ptId, status, joinedAt: new Date() } });
}

async function cleanup(world: World) {
  await prisma.gymPtAgreementConflict
    .deleteMany({ where: { OR: [{ ptUserId: { in: world.pts } }, { brandId: { in: world.brandIds } }] } })
    .catch(() => {});
  await prisma.gymTrainerAffiliation
    .deleteMany({ where: { OR: [{ ptId: { in: world.pts } }, { gymId: { in: world.gymIds } }] } })
    .catch(() => {});
  await prisma.gymPtCollaboration
    .deleteMany({ where: { OR: [{ ptUserId: { in: world.pts } }, { gymId: { in: world.gymIds } }] } })
    .catch(() => {});
  await prisma.gymBrandPtAgreement
    .deleteMany({ where: { OR: [{ ptUserId: { in: world.pts } }, { brandId: { in: world.brandIds } }] } })
    .catch(() => {});
  await prisma.gym.deleteMany({ where: { id: { in: world.gymIds } } }).catch(() => {});
  await prisma.gymBrand.deleteMany({ where: { id: { in: world.brandIds } } }).catch(() => {});
}

async function withWorld(fn: (world: World) => Promise<void>) {
  const world = newWorld();
  try {
    await fn(world);
  } finally {
    await cleanup(world);
  }
}

/** Chờ promise bị từ chối và trả lỗi (để kiểm status + thông điệp). */
async function rejection(p: Promise<unknown>): Promise<{ status?: number; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { status?: number; message: string };
  }
  assert.fail('expected the call to be rejected');
}

const ptPropose = (gymId: string, ptUserId: string, rates = RATES) =>
  collaborationService.propose({ gymId, ptUserId, proposedBy: 'PT', ...rates });
const gymAccept = (id: string, ownerId: string) =>
  collaborationService.respond({ collaborationId: id, actor: 'GYM', actorUserId: ownerId, action: 'ACCEPT' });
const ptAccept = (id: string, ptUserId: string) =>
  collaborationService.respond({ collaborationId: id, actor: 'PT', actorUserId: ptUserId, action: 'ACCEPT' });

// ───────────────────────────── (a) propose ─────────────────────────────

integrationTest('propose ở chi nhánh có thương hiệu → tạo thoả thuận THƯƠNG HIỆU, không tạo dòng cũ', () =>
  withWorld(async (world) => {
    const { brandId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];

    const created = (await ptPropose(gymB, pt)) as Awaited<ReturnType<typeof ptPropose>> & { scope: string; brand: { id: string } | null };
    assert.equal(created.scope, 'BRAND');
    assert.equal(created.brand?.id, brandId);
    assert.equal(created.status, 'PENDING');
    assert.equal(created.proposedBy, 'PT');
    assert.equal(created.round, 1);

    const rows = await prisma.gymBrandPtAgreement.findMany({ where: { brandId, ptUserId: pt } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, 'NATIVE');
    assert.equal(await prisma.gymPtCollaboration.count({ where: { gymId: { in: [gymA, gymB] }, ptUserId: pt } }), 0);
  }),
);

integrationTest('propose ở gym KHÔNG có thương hiệu → vẫn tạo dòng cũ như trước', () =>
  withWorld(async (world) => {
    const ownerId = makeOwner(world);
    const gym = await makeGym(world, ownerId, null);
    const pt = world.pts[0];

    const created = await ptPropose(gym, pt);
    assert.equal(created.gymId, gym);
    assert.ok(!('scope' in created), 'a legacy row is returned untouched');
    assert.equal(await prisma.gymPtCollaboration.count({ where: { gymId: gym, ptUserId: pt, status: 'PENDING' } }), 1);
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { ptUserId: pt } }), 0);
  }),
);

integrationTest('propose: gym không tồn tại → 404; gym chưa APPROVED (có thương hiệu) → 409', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    assert.equal((await rejection(ptPropose(randomUUID(), pt))).status, 404);

    const ownerId = makeOwner(world);
    const brandId = await makeBrand(world, ownerId);
    const pending = await makeGym(world, ownerId, brandId, { status: 'PENDING_REVIEW' });
    assert.equal((await rejection(ptPropose(pending, pt))).status, 409);
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId } }), 0);
  }),
);

integrationTest('propose: tỷ lệ sai vẫn bị validateRates chặn (400) ở nhánh thương hiệu', () =>
  withWorld(async (world) => {
    const { gymA } = await branded(world);
    const e = await rejection(ptPropose(gymA, world.pts[0], { ptRate: '0.7', gymRate: '0.3', platformRate: '0.1' }));
    assert.equal(e.status, 400);
  }),
);

integrationTest('propose: đề xuất mở thứ hai / thoả thuận ACCEPTED thứ hai của cùng (brand, PT) → 409 dù dùng chi nhánh nào', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];

    const first = await ptPropose(gymA, pt);
    assert.equal((await rejection(ptPropose(gymA, pt))).status, 409);
    assert.equal((await rejection(ptPropose(gymB, pt))).status, 409, 'another branch of the same brand is still the same pair');
    assert.equal((await rejection(collaborationService.propose({ gymId: gymB, ptUserId: pt, proposedBy: 'GYM', ...RATES }))).status, 409);

    await gymAccept(first.id, ownerId);
    assert.equal((await rejection(ptPropose(gymA, pt))).status, 409);
    assert.equal((await rejection(ptPropose(gymB, pt))).status, 409);
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId } }), 1);
  }),
);

integrationTest('propose đồng thời hai chi nhánh → đúng một thành công, bên kia 409 (chỉ mục duy nhất là chốt chặn)', () =>
  withWorld(async (world) => {
    const { brandId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];
    const results = await Promise.allSettled([ptPropose(gymA, pt), ptPropose(gymB, pt)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.status, 409);
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId, ptUserId: pt, status: 'PENDING' } }), 1);
  }),
);

integrationTest('propose via chi nhánh A, respond bằng id → thoả thuận cho ra tỷ lệ ở chi nhánh B (activeRates)', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];

    const created = await ptPropose(gymA, pt);
    assert.equal(await collaborationService.activeRates(gymB, pt), null, 'nothing is usable before ACCEPT');

    const accepted = await gymAccept(created.id, ownerId);
    assert.equal(accepted.status, 'ACCEPTED');
    assert.ok(accepted.acceptedAt);

    for (const g of [gymA, gymB]) {
      const rates = await collaborationService.activeRates(g, pt);
      assert.ok(rates, `rates at ${g}`);
      assert.equal(rates!.agreementScope, 'BRAND');
      assert.equal(rates!.collaborationId, created.id);
      assert.equal(num(rates!.ptRate), 0.6);
      assert.equal(num(rates!.gymRate), 0.3);
    }
  }),
);

integrationTest('thoả thuận hết hạn / bị chấm dứt xong thì đề xuất mới được phép; đang báo trước thì vẫn chặn', () =>
  withWorld(async (world) => {
    const { brandId, gymA } = await branded(world);
    const pt = world.pts[0];

    // Quá hạn thời gian → coi như đã chết, không chặn.
    const stale = await makeBrandAgreement(brandId, pt, { status: 'PENDING' });
    await prisma.gymBrandPtAgreement.update({ where: { id: stale.id }, data: { expiresAt: daysAgo(1) } });
    const fresh = await ptPropose(gymA, pt);
    assert.equal((await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: stale.id } })).status, 'EXPIRED');

    // Đang báo trước chấm dứt (ACCEPTED, effectiveAt tương lai) → chặn.
    await prisma.gymBrandPtAgreement.delete({ where: { id: fresh.id } });
    const winding = await makeBrandAgreement(brandId, pt, { terminationInitiatedAt: new Date(), effectiveAt: inDays(5) });
    const blocked = await rejection(ptPropose(gymA, pt));
    assert.equal(blocked.status, 409);

    // Đã TERMINATED (kể cả nhờ finalise lười khi effectiveAt đã qua) → cho đề xuất mới.
    await prisma.gymBrandPtAgreement.update({
      where: { id: winding.id },
      data: { effectiveAt: new Date(Date.now() - 1000), terminationInitiatedAt: daysAgo(14) },
    });
    const again = await ptPropose(gymA, pt);
    assert.equal(again.status, 'PENDING');
    assert.equal((await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: winding.id } })).status, 'TERMINATED');
  }),
);

// ───────────────────────────── (b) respond ─────────────────────────────

integrationTest('hai ACCEPT đồng thời → đúng một thành công', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA } = await branded(world);
    const created = await ptPropose(gymA, world.pts[0]);
    const results = await Promise.allSettled([gymAccept(created.id, ownerId), gymAccept(created.id, ownerId)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as { status: number }).status, 409);
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId, status: 'ACCEPTED' } }), 1);
  }),
);

integrationTest('ACCEPT thay thế mọi dòng cũ ACCEPTED của cặp: giữ nguyên tỷ lệ + updatedAt, giải quyết xung đột, đọc theo tỷ lệ thương hiệu ở mọi chi nhánh', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];
    const otherOwner = makeOwner(world);
    const otherBrand = await makeBrand(world, otherOwner, 'Other Brand');
    const otherGym = await makeGym(world, otherOwner, otherBrand);

    const legA = await makeLegacy(gymA, pt, { rates: LEG_A });
    const legB = await makeLegacy(gymB, pt, { rates: LEG_B });
    const legOtherBrand = await makeLegacy(otherGym, pt, { rates: LEG_A });
    const conflict = await prisma.gymPtAgreementConflict.create({
      data: { id: randomUUID(), brandId, ptUserId: pt, legacyCollaborationIds: [legA.id, legB.id] },
    });
    // Trước ACCEPT: mỗi chi nhánh đọc theo dòng cũ của chính nó.
    assert.equal(num((await collaborationService.activeRates(gymA, pt))!.ptRate), 0.55);
    assert.equal(num((await collaborationService.activeRates(gymB, pt))!.ptRate), 0.5);

    const created = await collaborationService.propose({ gymId: gymA, ptUserId: pt, proposedBy: 'GYM', ...RATES });
    await new Promise((r) => setTimeout(r, 30)); // để một lần bump updatedAt (nếu có) lộ ra
    const accepted = await ptAccept(created.id, pt);
    assert.equal(accepted.status, 'ACCEPTED');
    void ownerId;

    for (const [leg, rates] of [[legA, LEG_A], [legB, LEG_B]] as const) {
      const after = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: leg.id } });
      assert.equal(after.supersededByAgreementId, created.id);
      assert.ok(after.supersededAt);
      assert.equal(num(after.proposedPtRate), num(rates.pt), 'legacy rates are never rewritten');
      assert.equal(num(after.proposedGymRate), num(rates.gym));
      assert.equal(after.status, 'ACCEPTED');
      assert.equal(after.updatedAt.getTime(), leg.updatedAt.getTime(), 'superseding must not bump updatedAt');
    }
    // Brand khác của cùng PT không bị đụng tới.
    const untouched = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: legOtherBrand.id } });
    assert.equal(untouched.supersededByAgreementId, null);

    const resolved = await prisma.gymPtAgreementConflict.findUniqueOrThrow({ where: { id: conflict.id } });
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.resolvedAgreementId, created.id);
    assert.ok(resolved.resolvedAt);

    // Sau ACCEPT: cả hai chi nhánh (kể cả chi nhánh từng có tỷ lệ cũ khác) đọc tỷ lệ thương hiệu.
    for (const g of [gymA, gymB]) {
      const rates = await collaborationService.activeRates(g, pt);
      assert.equal(rates!.agreementScope, 'BRAND');
      assert.equal(num(rates!.ptRate), 0.6);
    }
  }),
);

integrationTest('ACCEPT thương hiệu KHÔNG tạo / kích hoạt affiliation; dòng affiliation sẵn có giữ nguyên', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];
    const existing = await makeAffiliation(gymA, pt, 'PENDING');

    const created = await ptPropose(gymB, pt);
    await gymAccept(created.id, ownerId);

    const rows = await prisma.gymTrainerAffiliation.findMany({ where: { ptId: pt, gymId: { in: [gymA, gymB] } } });
    assert.equal(rows.length, 1, 'no affiliation row was created for either branch');
    assert.equal(rows[0].id, existing.id);
    assert.equal(rows[0].status, 'PENDING', 'an existing row is left as it was');
  }),
);

integrationTest('lượt, COUNTER, vòng tối đa, hết hạn trên thoả thuận thương hiệu', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA } = await branded(world);
    const pt = world.pts[0];
    const created = await ptPropose(gymA, pt);

    // Bên ra giá không tự trả lời được.
    assert.equal((await rejection(ptAccept(created.id, pt))).status, 409);
    assert.equal(
      (await rejection(collaborationService.respond({ collaborationId: created.id, actor: 'PT', actorUserId: pt, action: 'COUNTER', ...OTHER }))).status,
      409,
    );

    // COUNTER thiếu tỷ lệ → 400; tỷ lệ sai → 400.
    const respondGym = (extra: object) =>
      collaborationService.respond({ collaborationId: created.id, actor: 'GYM', actorUserId: ownerId, action: 'COUNTER', ...extra });
    assert.equal((await rejection(respondGym({}))).status, 400);
    assert.equal((await rejection(respondGym({ ptRate: '0.9', gymRate: '0.9', platformRate: '0.1' }))).status, 400);

    const countered = await respondGym({ ptRate: OTHER.ptRate, gymRate: OTHER.gymRate, note: 'giảm tí' });
    assert.equal(countered.status, 'COUNTERED');
    assert.equal(countered.round, 2);
    assert.equal(countered.proposedBy, 'GYM');
    assert.equal(num(countered.proposedPtRate), 0.55);
    assert.equal(countered.note, 'giảm tí');
    assert.equal(num(countered.platformRate), 0.1, 'platform rate carries over when omitted');
    assert.ok(countered.expiresAt.getTime() > Date.now() + 6 * DAY, 'the offer deadline restarts');
    assert.equal((await rejection(respondGym(OTHER))).status, 409, 'the gym just countered — not its turn');

    // Vòng tối đa: COUNTER thứ MAX_ROUNDS+1 làm hết hạn thay vì tiếp tục.
    await prisma.gymBrandPtAgreement.update({ where: { id: created.id }, data: { round: MAX_ROUNDS, proposedBy: 'PT' } });
    const lapsed = await respondGym({ ptRate: OTHER.ptRate, gymRate: OTHER.gymRate });
    assert.equal(lapsed.status, 'EXPIRED');

    // Hết hạn theo thời gian.
    const second = await ptPropose(gymA, pt);
    await prisma.gymBrandPtAgreement.update({ where: { id: second.id }, data: { expiresAt: daysAgo(1) } });
    const e = await rejection(gymAccept(second.id, ownerId));
    assert.equal(e.status, 409);
    assert.equal((await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: second.id } })).status, 'EXPIRED');

    // REJECT.
    const third = await ptPropose(gymA, pt);
    const rejected = await collaborationService.respond({ collaborationId: third.id, actor: 'GYM', actorUserId: ownerId, action: 'REJECT', note: 'không' });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.note, 'không');
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId, ptUserId: pt, status: 'ACCEPTED' } }), 0);
  }),
);

integrationTest('id lạ → 404; PT khác / chủ khác → 403 (respond và terminate), cả thương hiệu lẫn dòng cũ', () =>
  withWorld(async (world) => {
    const { ownerId, gymA } = await branded(world);
    const pt = world.pts[0];
    const stranger = randomUUID();
    world.pts.push(stranger);
    const strangerOwner = makeOwner(world);

    const created = await ptPropose(gymA, pt);
    assert.equal(
      (await rejection(collaborationService.respond({ collaborationId: randomUUID(), actor: 'GYM', actorUserId: ownerId, action: 'ACCEPT' }))).status,
      404,
    );
    assert.equal((await rejection(collaborationService.terminate(randomUUID(), 'GYM', ownerId))).status, 404);

    // Thương hiệu
    assert.equal((await rejection(ptAccept(created.id, stranger))).status, 403);
    assert.equal((await rejection(gymAccept(created.id, strangerOwner))).status, 403);
    assert.equal((await rejection(collaborationService.terminate(created.id, 'PT', stranger))).status, 403);
    assert.equal((await rejection(collaborationService.terminate(created.id, 'GYM', strangerOwner))).status, 403);

    // Dòng cũ ở gym có thương hiệu
    const legacy = await makeLegacy(gymA, pt, { status: 'ACCEPTED' });
    assert.equal((await rejection(collaborationService.terminate(legacy.id, 'PT', stranger))).status, 403);
    assert.equal((await rejection(collaborationService.terminate(legacy.id, 'GYM', strangerOwner))).status, 403);
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'ACCEPTED');
  }),
);

// ───────────────────────────── (c) terminate + finalise ─────────────────────────────

async function acceptedBrand(world: World) {
  const w = await branded(world);
  const pt = world.pts[0];
  const created = await ptPropose(w.gymA, pt);
  await gymAccept(created.id, w.ownerId);
  return { ...w, pt, agreementId: created.id };
}

integrationTest('terminate không có ngày → báo trước 14 ngày: status vẫn ACCEPTED, hợp đồng mới bị chặn ngay ở mọi chi nhánh', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, gymB, pt, agreementId } = await acceptedBrand(world);
    assert.ok(await collaborationService.activeRates(gymB, pt));

    const before = Date.now();
    const result = await collaborationService.terminate(agreementId, 'GYM', ownerId);
    assert.equal(result.status, 'ACCEPTED');
    assert.ok(result.terminationInitiatedAt, 'termination marker set');
    assert.equal(result.terminatedBy, ownerId);
    const expected = before + BRAND_TERMINATION_NOTICE_DAYS * DAY;
    assert.ok(Math.abs(result.effectiveAt!.getTime() - expected) < 60_000, 'effectiveAt is about now + 14 days');
    assert.equal(BRAND_TERMINATION_NOTICE_DAYS, 14);

    for (const g of [gymA, gymB]) assert.equal(await collaborationService.activeRates(g, pt), null);
    assert.equal((await collaborationService.listAcceptedGymsForPt(pt)).filter((o) => [gymA, gymB].includes(o.gym.id)).length, 0);

    // Đã báo chấm dứt thì không báo lần hai.
    assert.equal((await rejection(collaborationService.terminate(agreementId, 'PT', pt))).status, 409);
  }),
);

integrationTest('terminate: ngày trong quá khứ → 400; ngày tương lai được dùng nguyên; chưa ACCEPTED → 409', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, brandId, pt, agreementId } = await acceptedBrand(world);
    assert.equal((await rejection(collaborationService.terminate(agreementId, 'GYM', ownerId, daysAgo(2)))).status, 400);
    assert.equal((await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: agreementId } })).terminationInitiatedAt, null);

    const when = inDays(30);
    const result = await collaborationService.terminate(agreementId, 'GYM', ownerId, when);
    assert.equal(result.effectiveAt!.getTime(), when.getTime());
    assert.equal(result.status, 'ACCEPTED');

    const pending = await makeBrandAgreement(brandId, randomUUID(), { status: 'PENDING' });
    world.pts.push(pending.ptUserId);
    assert.equal((await rejection(collaborationService.terminate(pending.id, 'GYM', ownerId))).status, 409);
    void gymA;
    void pt;
  }),
);

integrationTest('terminate "ngay bây giờ" → TERMINATED tức thì, affiliation ACTIVE của PT ở mọi chi nhánh bị SUSPENDED', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, gymB, pt, agreementId } = await acceptedBrand(world);
    const otherPt = randomUUID();
    world.pts.push(otherPt);
    const affA = await makeAffiliation(gymA, pt);
    const affB = await makeAffiliation(gymB, pt);
    const affOther = await makeAffiliation(gymA, otherPt);

    const result = await collaborationService.terminate(agreementId, 'PT', pt, new Date());
    assert.equal(result.status, 'TERMINATED');
    assert.ok(result.terminatedAt);
    assert.ok(result.terminationInitiatedAt);
    assert.ok(result.effectiveAt!.getTime() <= Date.now());

    for (const a of [affA, affB]) {
      assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: a.id } })).status, 'SUSPENDED');
    }
    assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: affOther.id } })).status, 'ACTIVE');
    for (const g of [gymA, gymB]) assert.equal(await collaborationService.activeRates(g, pt), null);
    void ownerId;
  }),
);

integrationTest('hết thời gian báo trước → listFor chốt TERMINATED, suspend affiliation ACTIVE của PT trong thương hiệu; dòng cũ đã thay thế KHÔNG sống lại', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];
    const agreement = await makeBrandAgreement(brandId, pt, { terminationInitiatedAt: daysAgo(15), effectiveAt: new Date(Date.now() - 1000) });
    const superseded = await makeLegacy(gymA, pt, { supersededByAgreementId: agreement.id, rates: LEG_A });
    const affA = await makeAffiliation(gymA, pt);
    const affB = await makeAffiliation(gymB, pt, 'PENDING');

    // Chưa ai đọc → vẫn ACCEPTED trong DB; đọc qua listFor sẽ chốt.
    assert.equal((await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).status, 'ACCEPTED');
    const list = await collaborationService.listFor({ ptUserId: pt });
    assert.equal(list.find((i) => i.id === agreement.id)!.status, 'TERMINATED');
    const stored = await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    assert.equal(stored.status, 'TERMINATED');
    assert.equal(stored.terminatedAt!.getTime(), agreement.effectiveAt!.getTime());

    assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: affA.id } })).status, 'SUSPENDED');
    assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: affB.id } })).status, 'PENDING', 'only ACTIVE rows are suspended');

    for (const g of [gymA, gymB]) assert.equal(await collaborationService.activeRates(g, pt), null);
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: superseded.id } })).status, 'ACCEPTED');

    // Có thể đề xuất lại sau khi đã TERMINATED.
    const again = await ptPropose(gymB, pt);
    assert.equal(again.status, 'PENDING');
    void ownerId;
  }),
);

integrationTest('terminate cũng chốt lười: hết hạn báo trước mà chưa ai đọc → 409 "đã TERMINATED", không báo lần hai', () =>
  withWorld(async (world) => {
    const { ownerId, brandId } = await branded(world);
    const pt = world.pts[0];
    const agreement = await makeBrandAgreement(brandId, pt, { terminationInitiatedAt: daysAgo(15), effectiveAt: new Date(Date.now() - 1000) });
    const e = await rejection(collaborationService.terminate(agreement.id, 'GYM', ownerId));
    assert.equal(e.status, 409);
    assert.match(e.message, /TERMINATED/);
  }),
);

integrationTest('terminate dòng cũ: đặt terminationInitiatedAt; mặc định VẪN là chấm dứt ngay (khác thương hiệu)', () =>
  withWorld(async (world) => {
    const ownerId = makeOwner(world);
    const gym = await makeGym(world, ownerId, null);
    const pt = world.pts[0];

    const row = await makeLegacy(gym, pt);
    const done = await collaborationService.terminate(row.id, 'GYM', ownerId);
    assert.equal(done.status, 'TERMINATED');
    assert.ok(done.terminationInitiatedAt);
    assert.ok(done.effectiveAt);

    const future = await makeLegacy(gym, pt);
    const noticed = await collaborationService.terminate(future.id, 'PT', pt, inDays(10));
    assert.equal(noticed.status, 'ACCEPTED');
    assert.ok(noticed.terminationInitiatedAt);
    assert.equal(await collaborationService.activeRates(gym, pt), null, 'the read path refuses on terminationInitiatedAt too');
  }),
);

// ───────────────────────────── (d) dòng cũ ở gym có thương hiệu ─────────────────────────────

integrationTest('dòng cũ đang mở ở gym có thương hiệu: REJECT được, ACCEPT và COUNTER bị 409; hết hạn vẫn chạy; dòng ACCEPTED vẫn chấm dứt được', () =>
  withWorld(async (world) => {
    const { ownerId, gymA, gymB } = await branded(world);
    const pt = world.pts[0];

    const open = await makeLegacy(gymA, pt, { status: 'PENDING', proposedBy: 'PT' });
    const gymRespond = (id: string, action: 'ACCEPT' | 'COUNTER' | 'REJECT') =>
      collaborationService.respond({ collaborationId: id, actor: 'GYM', actorUserId: ownerId, action, ...OTHER });

    const accept = await rejection(gymRespond(open.id, 'ACCEPT'));
    assert.equal(accept.status, 409);
    assert.match(accept.message, /thương hiệu/);
    assert.equal((await rejection(gymRespond(open.id, 'COUNTER'))).status, 409);
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: open.id } })).status, 'PENDING');
    assert.equal(await prisma.gymTrainerAffiliation.count({ where: { ptId: pt } }), 0);

    assert.equal((await gymRespond(open.id, 'REJECT')).status, 'REJECTED');

    // Hết hạn theo thời gian.
    const stale = await makeLegacy(gymB, pt, { status: 'PENDING', proposedBy: 'PT', expiresAt: daysAgo(1) });
    const list = await collaborationService.listFor({ ptUserId: pt });
    assert.equal(list.find((i) => i.id === stale.id)!.status, 'EXPIRED');

    // Dòng ACCEPTED vẫn chấm dứt được.
    const accepted = await makeLegacy(gymA, pt, { status: 'ACCEPTED' });
    const ended = await collaborationService.terminate(accepted.id, 'GYM', ownerId);
    assert.equal(ended.status, 'TERMINATED');
    assert.ok(ended.terminationInitiatedAt);
  }),
);

// ───────────────────────────── listFor ─────────────────────────────

const REQUIRED_FIELDS = [
  'id', 'status', 'proposedPtRate', 'proposedGymRate', 'platformRate', 'proposedBy', 'round', 'expiresAt',
  'createdAt', 'updatedAt', 'gymId', 'ptUserId', 'scope',
] as const;
// Có thể null nhưng PHẢI hiện diện (client đọc thẳng key).
const NULLABLE_FIELDS = ['acceptedAt', 'terminatedAt', 'effectiveAt', 'note', 'terminationInitiatedAt', 'brand'] as const;

function assertShape(item: Record<string, unknown>) {
  for (const k of REQUIRED_FIELDS) assert.notEqual(item[k], undefined, `missing ${k}`);
  for (const k of REQUIRED_FIELDS) assert.notEqual(item[k], null, `${k} must not be null`);
  for (const k of NULLABLE_FIELDS) assert.ok(k in item, `missing key ${k}`);
  const gym = item.gym as { id: string; name: string; city: string | null };
  assert.ok(gym && gym.id && gym.name, 'gym object non-null with id and name');
  assert.equal(item.gymId, gym.id);
}

integrationTest('listFor: gồm cả thoả thuận thương hiệu lẫn dòng cũ (kể cả đã thay thế), đủ trường, mới nhất trước — cho PT và cho chủ', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    // Thương hiệu 1: có chi nhánh PENDING_REVIEW tạo sớm hơn và APPROVED tạo muộn hơn → chọn APPROVED.
    const owner1 = makeOwner(world);
    const brand1 = await makeBrand(world, owner1, 'Brand Uno');
    const early = await makeGym(world, owner1, brand1, { status: 'PENDING_REVIEW', name: 'Early Pending', createdAt: daysAgo(30) });
    const approvedOld = await makeGym(world, owner1, brand1, { name: 'Approved Old', createdAt: daysAgo(20) });
    await makeGym(world, owner1, brand1, { name: 'Approved New', createdAt: daysAgo(2) });
    // Thương hiệu 2 của chủ khác.
    const owner2 = makeOwner(world);
    const brand2 = await makeBrand(world, owner2, 'Brand Dos');
    const only = await makeGym(world, owner2, brand2, { status: 'SUSPENDED', name: 'Only Suspended' });
    // Gym không thương hiệu của chủ 1? Một owner chỉ có một brand, nhưng gym lẻ của chủ 3:
    const owner3 = makeOwner(world);
    const solo = await makeGym(world, owner3, null, { name: 'Solo Gym' });

    const ag1 = await makeBrandAgreement(brand1, pt, { status: 'PENDING', proposedBy: 'GYM' });
    const ag2 = await makeBrandAgreement(brand2, pt);
    const legSuperseded = await makeLegacy(approvedOld, pt, { supersededByAgreementId: ag2.id });
    const legSolo = await makeLegacy(solo, pt);
    // Làm updatedAt khác nhau rõ rệt để kiểm thứ tự.
    await prisma.$executeRaw`UPDATE gym_pt_collaborations SET updated_at = ${daysAgo(3)} WHERE id = ${legSuperseded.id}`;
    await prisma.$executeRaw`UPDATE gym_pt_collaborations SET updated_at = ${daysAgo(1)} WHERE id = ${legSolo.id}`;

    const mine = (await collaborationService.listFor({ ptUserId: pt })).filter((i) => world.pts.includes(i.ptUserId));
    assert.deepEqual(new Set(mine.map((i) => i.id)), new Set([ag1.id, ag2.id, legSuperseded.id, legSolo.id]));
    for (const item of mine) assertShape(item as unknown as Record<string, unknown>);
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i - 1].updatedAt >= mine[i].updatedAt, 'newest activity first');

    const brandItem1 = mine.find((i) => i.id === ag1.id)!;
    assert.equal(brandItem1.scope, 'BRAND');
    assert.equal((brandItem1.brand as { name: string }).name, 'Brand Uno');
    assert.equal(brandItem1.gym.id, approvedOld, 'representative = earliest-created APPROVED branch');
    assert.equal(brandItem1.gymId, approvedOld);
    assert.notEqual(brandItem1.gym.id, early);
    const brandItem2 = mine.find((i) => i.id === ag2.id)!;
    assert.equal(brandItem2.gym.id, only, 'falls back to the earliest branch of any status');
    assert.equal(brandItem2.terminationInitiatedAt, null);

    const legacySup = mine.find((i) => i.id === legSuperseded.id)! as unknown as Record<string, unknown>;
    assert.equal(legacySup.scope, 'BRANCH');
    assert.equal(legacySup.supersededByAgreementId, ag2.id);
    assert.equal((legacySup.brand as { id: string }).id, brand1);
    const legacySolo = mine.find((i) => i.id === legSolo.id)! as unknown as Record<string, unknown>;
    assert.equal(legacySolo.brand, null);
    assert.equal(legacySolo.supersededByAgreementId, null);
    assert.equal((legacySolo.gym as { name: string }).name, 'Solo Gym');

    // Chủ 1 thấy thoả thuận thương hiệu 1 và dòng cũ ở chi nhánh của mình; không thấy của chủ khác.
    const ownerList = await collaborationService.listFor({ ownerId: owner1 });
    assert.deepEqual(new Set(ownerList.filter((i) => world.pts.includes(i.ptUserId)).map((i) => i.id)), new Set([ag1.id, legSuperseded.id]));
    for (const item of ownerList) assertShape(item as unknown as Record<string, unknown>);
    const owner3List = await collaborationService.listFor({ ownerId: owner3 });
    assert.deepEqual(owner3List.map((i) => i.id), [legSolo.id]);
  }),
);

// ───────────────────────────── (e) closureImpact ─────────────────────────────

integrationTest('closureImpact.activeCollaborations: thương hiệu, dòng cũ, dòng đã thay thế, và không có gì', () =>
  withWorld(async (world) => {
    const { ownerId, brandId, gymA, gymB } = await branded(world);
    const ptLegacy = randomUUID();
    const ptBoth = randomUUID();
    world.pts.push(ptLegacy, ptBoth);
    const count = async (gymId: string) => (await gymService.closureImpact(gymId, ownerId)).activeCollaborations;

    assert.equal(await count(gymA), 0, 'none');

    await makeLegacy(gymA, ptLegacy);
    assert.equal(await count(gymA), 1, 'one live legacy row');
    assert.equal(await count(gymB), 0, 'a legacy row only counts for its own branch');

    const ag = await makeBrandAgreement(brandId, ptBoth);
    assert.equal(await count(gymA), 2, 'legacy + brand agreement');
    assert.equal(await count(gymB), 1, 'a brand agreement covers every branch');

    // Một dòng cũ đã bị thay thế không đếm riêng nữa (thoả thuận thương hiệu đã đếm cặp đó).
    await makeLegacy(gymA, ptBoth, { supersededByAgreementId: ag.id });
    assert.equal(await count(gymA), 2, 'superseded legacy row is not counted twice');

    // Thoả thuận thương hiệu không ACCEPTED thì không đếm.
    await prisma.gymBrandPtAgreement.update({ where: { id: ag.id }, data: { status: 'TERMINATED' } });
    assert.equal(await count(gymA), 1);
  }),
);
