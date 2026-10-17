import { guardedTest as test } from './test-db-guard';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { collaborationService } from '../services/collaboration.service';

/**
 * Phase 1 (hợp tác PT–Gym cấp thương hiệu) — những gì web/mobile đọc từ API để vẽ màn hình:
 *   - `coveredBranches` (chi nhánh bao phủ, MỘT bộ điều khoản, không có tỷ lệ theo từng chi nhánh);
 *   - một PT hợp tác với hai thương hiệu hoàn toàn độc lập;
 *   - dòng điều khoản cũ theo chi nhánh (và cặp xung đột) vẫn được trả nguyên vẹn, không bị gộp/chọn.
 *
 * Mỗi test tự dựng thế giới riêng bằng uuid ngẫu nhiên và dọn đúng những gì mình tạo.
 */

const RATES = { ptRate: '0.6000', gymRate: '0.3000', platformRate: '0.1000' };
const LEG_A = { pt: '0.5500', gym: '0.3500', platform: '0.1000' };
const LEG_B = { pt: '0.5000', gym: '0.4000', platform: '0.1000' };

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

interface World {
  pts: string[];
  brandIds: string[];
  gymIds: string[];
}

async function makeBrand(world: World, name: string) {
  const ownerId = randomUUID();
  const brand = await prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name } });
  world.brandIds.push(brand.id);
  return { ownerId, brandId: brand.id };
}

async function makeGym(
  world: World,
  ownerId: string,
  brandId: string | null,
  o: {
    name: string;
    status?: 'APPROVED' | 'PENDING_REVIEW' | 'SUSPENDED';
    operationalStatus?: 'OPEN' | 'TEMPORARILY_CLOSED';
    createdAt?: Date;
  },
) {
  const gym = await prisma.gym.create({
    data: {
      id: randomUUID(),
      ownerId,
      brandId,
      name: o.name,
      address: '1 Test St',
      city: 'Hanoi',
      status: o.status ?? 'APPROVED',
      operationalStatus: o.operationalStatus ?? 'OPEN',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
  world.gymIds.push(gym.id);
  return gym.id;
}

async function makeLegacy(gymId: string, ptUserId: string, rates: { pt: string; gym: string; platform: string }) {
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      proposedPtRate: rates.pt,
      proposedGymRate: rates.gym,
      platformRate: rates.platform,
      status: 'ACCEPTED',
      proposedBy: 'GYM',
      expiresAt: new Date(Date.now() + 7 * DAY),
      acceptedAt: new Date(),
    },
  });
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
  const world: World = { pts: [randomUUID()], brandIds: [], gymIds: [] };
  try {
    await fn(world);
  } finally {
    await cleanup(world);
  }
}

const ptPropose = (gymId: string, ptUserId: string) =>
  collaborationService.propose({ gymId, ptUserId, proposedBy: 'PT', ...RATES });
const gymAccept = (id: string, ownerId: string) =>
  collaborationService.respond({ collaborationId: id, actor: 'GYM', actorUserId: ownerId, action: 'ACCEPT' });

test('thoả thuận thương hiệu trả coveredBranches = mọi chi nhánh APPROVED (kể cả tạm đóng, kể cả mở sau khi ký); chi nhánh chưa duyệt / bị khoá không có', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    const { ownerId, brandId } = await makeBrand(world, 'UI Contract Brand');
    const a = await makeGym(world, ownerId, brandId, { name: 'UI Chi nhánh A', createdAt: daysAgo(30) });
    const b = await makeGym(world, ownerId, brandId, { name: 'UI Chi nhánh B', operationalStatus: 'TEMPORARILY_CLOSED', createdAt: daysAgo(20) });
    await makeGym(world, ownerId, brandId, { name: 'UI Chưa duyệt', status: 'PENDING_REVIEW', createdAt: daysAgo(10) });
    await makeGym(world, ownerId, brandId, { name: 'UI Bị khoá', status: 'SUSPENDED', createdAt: daysAgo(9) });

    const created = await ptPropose(a, pt);
    assert.deepEqual(
      (created as unknown as { coveredBranches: { id: string; name: string; operationalStatus: string }[] }).coveredBranches.map((x) => ({ id: x.id, name: x.name, op: x.operationalStatus })),
      [
        { id: a, name: 'UI Chi nhánh A', op: 'OPEN' },
        { id: b, name: 'UI Chi nhánh B', op: 'TEMPORARILY_CLOSED' },
      ],
      'propose trả danh sách ngay',
    );
    await gymAccept(created.id, ownerId);

    // Một chi nhánh mở SAU khi ký (được duyệt) cũng nằm trong danh sách — không cần ký lại.
    const later = await makeGym(world, ownerId, brandId, { name: 'UI Chi nhánh mới', createdAt: daysAgo(1) });

    for (const list of [
      await collaborationService.listFor({ ptUserId: pt }),
      await collaborationService.listFor({ ownerId }),
    ]) {
      const item = list.find((i) => i.id === created.id)!;
      assert.equal(item.scope, 'BRAND');
      assert.deepEqual(
        (item as unknown as { coveredBranches: { id: string }[] }).coveredBranches.map((x) => x.id),
        [a, b, later],
      );
      // MỘT bộ điều khoản: chỉ có các cột tỷ lệ của chính thoả thuận, không có tỷ lệ riêng của chi nhánh.
      const branchKeys = (item as unknown as { coveredBranches: Record<string, unknown>[] }).coveredBranches.flatMap((x) => Object.keys(x));
      assert.ok(!branchKeys.some((k) => /rate/i.test(k)), 'coveredBranches không mang tỷ lệ');
      assert.equal(item.proposedPtRate.toString(), '0.6');
    }

    // Và nó đúng là điều khoản đang áp ở chi nhánh mở sau (nguồn đọc tỷ lệ thật).
    const rates = await collaborationService.activeRates(later, pt);
    assert.equal(rates?.agreementScope, 'BRAND');
    assert.equal(Number(rates?.ptRate), 0.6);
  }),
);

test('PT hợp tác với HAI thương hiệu độc lập: chấm dứt một cái không đụng cái kia; mỗi cái có danh sách chi nhánh riêng', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    const x = await makeBrand(world, 'UI Brand X');
    const y = await makeBrand(world, 'UI Brand Y');
    const gx = await makeGym(world, x.ownerId, x.brandId, { name: 'UI X1' });
    const gy1 = await makeGym(world, y.ownerId, y.brandId, { name: 'UI Y1', createdAt: daysAgo(5) });
    const gy2 = await makeGym(world, y.ownerId, y.brandId, { name: 'UI Y2', createdAt: daysAgo(4) });

    const ax = await ptPropose(gx, pt);
    const ay = await ptPropose(gy1, pt);
    assert.notEqual(ax.id, ay.id);
    await gymAccept(ax.id, x.ownerId);
    await gymAccept(ay.id, y.ownerId);

    const mine = await collaborationService.listFor({ ptUserId: pt });
    const itemX = mine.find((i) => i.id === ax.id) as unknown as { coveredBranches: { id: string }[] };
    const itemY = mine.find((i) => i.id === ay.id) as unknown as { coveredBranches: { id: string }[] };
    assert.deepEqual(itemX.coveredBranches.map((c) => c.id), [gx]);
    assert.deepEqual(itemY.coveredBranches.map((c) => c.id), [gy1, gy2]);

    // Chủ X chỉ thấy thoả thuận của X; chủ Y chỉ thấy của Y.
    assert.deepEqual((await collaborationService.listFor({ ownerId: x.ownerId })).map((i) => i.id), [ax.id]);
    assert.deepEqual((await collaborationService.listFor({ ownerId: y.ownerId })).map((i) => i.id), [ay.id]);

    // Chấm dứt (báo trước) thoả thuận X: Y vẫn hoạt động đầy đủ, X chặn hợp đồng mới ngay.
    await collaborationService.terminate(ax.id, 'GYM', x.ownerId);
    assert.equal(await collaborationService.activeRates(gx, pt), null);
    assert.equal((await collaborationService.activeRates(gy2, pt))?.agreementScope, 'BRAND');
    const after = await collaborationService.listFor({ ptUserId: pt });
    const ax2 = after.find((i) => i.id === ax.id)!;
    assert.equal(ax2.status, 'ACCEPTED', 'đang báo trước, chưa TERMINATED');
    assert.ok(ax2.terminationInitiatedAt && ax2.effectiveAt, 'có ngày hiệu lực do máy chủ đặt');
    assert.equal(after.find((i) => i.id === ay.id)!.status, 'ACCEPTED');
  }),
);

test('hợp tác lại: sau TERMINATED, đề xuất mới cho cùng (thương hiệu, PT) được tạo thành dòng mới; dòng cũ giữ làm lịch sử', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    const { ownerId, brandId } = await makeBrand(world, 'UI Re-partner');
    const g = await makeGym(world, ownerId, brandId, { name: 'UI RP1' });

    const first = await ptPropose(g, pt);
    await gymAccept(first.id, ownerId);
    // Chấm dứt ngay (ngày = bây giờ) để có TERMINATED.
    await collaborationService.terminate(first.id, 'PT', pt, new Date());
    const again = await ptPropose(g, pt);
    assert.notEqual(again.id, first.id);
    assert.equal(again.status, 'PENDING');

    const list = await collaborationService.listFor({ ptUserId: pt });
    assert.equal(list.find((i) => i.id === first.id)!.status, 'TERMINATED');
    assert.equal(list.find((i) => i.id === again.id)!.status, 'PENDING');
  }),
);

test('điều khoản cũ theo chi nhánh: cặp xung đột (hai tỷ lệ khác nhau) được trả NGUYÊN VẸN từng dòng, không gộp, không chọn; brand + thông tin chi nhánh có đủ để UI nhóm', () =>
  withWorld(async (world) => {
    const pt = world.pts[0];
    const { ownerId, brandId } = await makeBrand(world, 'UI Legacy Conflict');
    const a = await makeGym(world, ownerId, brandId, { name: 'UI Legacy A', createdAt: daysAgo(8) });
    const b = await makeGym(world, ownerId, brandId, { name: 'UI Legacy B', createdAt: daysAgo(7) });
    const la = await makeLegacy(a, pt, LEG_A);
    const lb = await makeLegacy(b, pt, LEG_B);

    for (const list of [
      await collaborationService.listFor({ ptUserId: pt }),
      await collaborationService.listFor({ ownerId }),
    ]) {
      assert.equal(list.length, 2, 'không có thoả thuận thương hiệu nào được tự sinh');
      const byId = new Map(list.map((i) => [i.id, i as unknown as Record<string, any>]));
      assert.equal(byId.get(la.id)!.scope, 'BRANCH');
      assert.equal(byId.get(lb.id)!.scope, 'BRANCH');
      assert.equal(byId.get(la.id)!.brand.id, brandId);
      assert.equal(byId.get(la.id)!.gym.name, 'UI Legacy A');
      assert.equal(byId.get(lb.id)!.gym.name, 'UI Legacy B');
      assert.equal(Number(byId.get(la.id)!.proposedPtRate), 0.55);
      assert.equal(Number(byId.get(lb.id)!.proposedPtRate), 0.5);
      assert.equal(byId.get(la.id)!.supersededByAgreementId, null);
      assert.equal(byId.get(la.id)!.status, 'ACCEPTED');
    }

    // Và việc đọc không đổi dữ liệu: hai dòng vẫn giữ tỷ lệ riêng, chưa có thoả thuận thương hiệu.
    assert.equal(await prisma.gymBrandPtAgreement.count({ where: { brandId } }), 0);
    const rowA = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: la.id } });
    const rowB = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: lb.id } });
    assert.equal(Number(rowA.proposedPtRate), 0.55);
    assert.equal(Number(rowB.proposedPtRate), 0.5);

    // Ký thoả thuận chung thì cả hai dòng cũ thành "đã thay thế" (UI ẩn khỏi danh sách chính) mà tỷ lệ không bị sửa.
    const joint = await ptPropose(a, pt);
    await gymAccept(joint.id, ownerId);
    const after = await collaborationService.listFor({ ptUserId: pt });
    for (const id of [la.id, lb.id]) {
      assert.equal((after.find((i) => i.id === id) as unknown as Record<string, unknown>).supersededByAgreementId, joint.id);
    }
    assert.equal(Number((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: la.id } })).proposedPtRate), 0.55);
  }),
);
