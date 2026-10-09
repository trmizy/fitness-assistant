import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import {
  backfillBrandPtAgreements,
  rollbackBrandPtAgreements,
  RollbackRefusedError,
  classifyPair,
  parseArgs,
} from '../scripts/backfill-brand-pt-agreements';

/**
 * Backfill thoả thuận Gym–PT cấp thương hiệu (docs/GYM_PT_BRAND_PARTNERSHIP_AUDIT.md §C.4–C.5).
 * Mọi lần gọi đều giới hạn `ptUserIds` vào PT ngẫu nhiên của chính bài test: các file test khác chạy song
 * song trên cùng DB và không được bị script này chuyển đổi/xoá dữ liệu của họ.
 */

const R_A = { pt: '0.5500', gym: '0.3500', platform: '0.1000' };
const R_B = { pt: '0.5000', gym: '0.4000', platform: '0.1000' };

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

interface World {
  ptUserId: string;
  brandIds: string[];
  gymIds: string[];
}

async function makeBrand(world: World, gyms: number, opts: { brandless?: boolean } = {}) {
  const ownerId = randomUUID();
  let brandId: string | null = null;
  if (!opts.brandless) {
    const brand = await prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name: 'Backfill Test Brand' } });
    brandId = brand.id;
    world.brandIds.push(brand.id);
  }
  const gymIds: string[] = [];
  for (let i = 0; i < gyms; i++) {
    const gym = await prisma.gym.create({
      data: { id: randomUUID(), ownerId, brandId, name: `Backfill Gym ${i}`, address: '1 Test St', status: 'APPROVED' },
    });
    gymIds.push(gym.id);
    world.gymIds.push(gym.id);
  }
  return { brandId, gymIds };
}

async function makeLegacy(
  gymId: string,
  ptUserId: string,
  o: {
    status?: 'PENDING' | 'COUNTERED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'TERMINATED';
    rates?: { pt: string; gym: string; platform: string };
    acceptedAt?: Date | null;
    effectiveAt?: Date | null;
  } = {},
) {
  const status = o.status ?? 'ACCEPTED';
  const rates = o.rates ?? R_B;
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      status,
      proposedPtRate: rates.pt,
      proposedGymRate: rates.gym,
      platformRate: rates.platform,
      proposedBy: 'GYM',
      expiresAt: inDays(7),
      acceptedAt: status === 'ACCEPTED' ? (o.acceptedAt === undefined ? new Date() : o.acceptedAt) : null,
      effectiveAt: o.effectiveAt ?? null,
    },
  });
}

const newWorld = (): World => ({ ptUserId: randomUUID(), brandIds: [], gymIds: [] });

async function cleanup(world: World, extraPts: string[] = []) {
  const pts = [world.ptUserId, ...extraPts];
  await prisma.gymPtAgreementConflict.deleteMany({ where: { ptUserId: { in: pts } } }).catch(() => {});
  await prisma.gymPtCollaboration
    .deleteMany({ where: { OR: [{ ptUserId: { in: pts } }, { gymId: { in: world.gymIds } }] } })
    .catch(() => {});
  await prisma.gymBrandPtAgreement
    .deleteMany({ where: { OR: [{ ptUserId: { in: pts } }, { brandId: { in: world.brandIds } }] } })
    .catch(() => {});
  await prisma.gym.deleteMany({ where: { id: { in: world.gymIds } } }).catch(() => {});
  await prisma.gymBrand.deleteMany({ where: { id: { in: world.brandIds } } }).catch(() => {});
}

const legacySnapshot = (pts: string[]) =>
  prisma.gymPtCollaboration.findMany({ where: { ptUserId: { in: pts } }, orderBy: { id: 'asc' } });

const counts = async (pts: string[]) => ({
  agreements: await prisma.gymBrandPtAgreement.count({ where: { ptUserId: { in: pts } } }),
  conflicts: await prisma.gymPtAgreementConflict.count({ where: { ptUserId: { in: pts } } }),
});

const dec = (d: { toFixed: (n: number) => string } | null) => (d ? d.toFixed(4) : null);

// ───────────────────────── Phân loại thuần ─────────────────────────

test('classifyPair: bảng tỷ lệ so sánh theo giá trị, dòng đang chấm dứt trộn với dòng sạch là xung đột', () => {
  const row = (id: string, r = R_B, windingDown = false) => ({
    collaborationId: id,
    gymId: `g-${id}`,
    proposedPtRate: r.pt,
    proposedGymRate: r.gym,
    platformRate: r.platform,
    acceptedAt: new Date(),
    windingDown,
  });
  assert.equal(classifyPair([row('a')], false, null).class, 'SINGLE');
  assert.equal(classifyPair([row('a'), row('b')], false, null).class, 'IDENTICAL');
  assert.equal(classifyPair([row('a'), row('b', R_A)], false, null).class, 'CONFLICT_RATES');
  assert.equal(classifyPair([row('a'), row('b', R_B, true)], false, null).class, 'CONFLICT_MIXED');
  assert.equal(classifyPair([row('a', R_B, true)], false, null).class, 'WINDING_DOWN_ONLY');
  assert.equal(classifyPair([row('a'), row('b', R_A)], true, null).class, 'ALREADY_COVERED');
});

test('parseArgs: mặc định là chạy thử; cờ lạ bị từ chối', () => {
  assert.deepEqual(parseArgs([]), { apply: false, rollback: false, help: false });
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.equal(parseArgs(['--rollback', '--report', 'x.json']).report, 'x.json');
  assert.throws(() => parseArgs(['--yolo']));
  assert.throws(() => parseArgs(['--report']));
});

// ───────────────────────── Từng lớp ─────────────────────────

integrationTest('một dòng ACCEPTED -> một thoả thuận thương hiệu, cùng 3 tỷ lệ, đánh dấu dòng cũ', async () => {
  const w = newWorld();
  try {
    const { brandId, gymIds } = await makeBrand(w, 2);
    const acceptedAt = daysAgo(10);
    const legacy = await makeLegacy(gymIds[0], w.ptUserId, { rates: R_A, acceptedAt });

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.failures.length, 0);
    assert.equal(res.pairCounts.SINGLE, 1);

    const agreements = await prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(agreements.length, 1);
    const a = agreements[0];
    assert.equal(a.brandId, brandId);
    assert.equal(a.status, 'ACCEPTED');
    assert.equal(a.origin, 'MIGRATED');
    assert.equal(dec(a.proposedPtRate), R_A.pt);
    assert.equal(dec(a.proposedGymRate), R_A.gym);
    assert.equal(dec(a.platformRate), R_A.platform);
    assert.equal(a.acceptedAt?.getTime(), acceptedAt.getTime());
    assert.equal(a.terminationInitiatedAt, null);

    const after = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(after.supersededByAgreementId, a.id);
    assert.ok(after.supersededAt);
    // Điều khoản cũ và updated_at không đổi.
    assert.equal(after.status, 'ACCEPTED');
    assert.equal(dec(after.proposedPtRate), R_A.pt);
    assert.equal(after.updatedAt.getTime(), legacy.updatedAt.getTime());
  } finally {
    await cleanup(w);
  }
});

integrationTest('nhiều dòng cùng tỷ lệ -> một thoả thuận, accepted_at sớm nhất, mọi dòng cũ được đánh dấu', async () => {
  const w = newWorld();
  try {
    const { gymIds } = await makeBrand(w, 3);
    const late = await makeLegacy(gymIds[0], w.ptUserId, { acceptedAt: daysAgo(2) });
    const earliest = await makeLegacy(gymIds[1], w.ptUserId, { acceptedAt: daysAgo(30) });
    const mid = await makeLegacy(gymIds[2], w.ptUserId, { acceptedAt: daysAgo(9) });

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.pairCounts.IDENTICAL, 1);

    const agreements = await prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(agreements.length, 1);
    assert.equal(agreements[0].acceptedAt?.getTime(), earliest.acceptedAt!.getTime());
    assert.equal(dec(agreements[0].proposedPtRate), R_B.pt);
    for (const row of [late, earliest, mid]) {
      const after = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.supersededByAgreementId, agreements[0].id);
    }
    assert.equal((await counts([w.ptUserId])).conflicts, 0);
  } finally {
    await cleanup(w);
  }
});

integrationTest('khác tỷ lệ -> không có thoả thuận, một dòng xung đột liệt kê đúng các mã, dòng cũ không đổi', async () => {
  const w = newWorld();
  try {
    const { brandId, gymIds } = await makeBrand(w, 3);
    const rows = [
      await makeLegacy(gymIds[0], w.ptUserId, { rates: R_A, acceptedAt: daysAgo(5) }),
      await makeLegacy(gymIds[1], w.ptUserId, { rates: R_B, acceptedAt: daysAgo(6) }),
      await makeLegacy(gymIds[2], w.ptUserId, { rates: R_B, acceptedAt: daysAgo(7) }),
    ];
    const before = await legacySnapshot([w.ptUserId]);

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.failures.length, 0);
    assert.equal(res.pairCounts.CONFLICT_RATES, 1);

    assert.equal((await counts([w.ptUserId])).agreements, 0);
    const conflicts = await prisma.gymPtAgreementConflict.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].brandId, brandId);
    assert.equal(conflicts[0].status, 'OPEN');
    assert.deepEqual([...conflicts[0].legacyCollaborationIds].sort(), rows.map((r) => r.id).sort());

    // Dòng cũ nguyên vẹn đến từng cột, kể cả updated_at: không chọn mới nhất/cao nhất/thấp nhất/trung bình.
    assert.deepEqual(await legacySnapshot([w.ptUserId]), before);

    // Báo cáo: chỉ brand_id, pt_user_id và các dòng cũ với mã, gym, 3 tỷ lệ, accepted_at.
    assert.equal(res.conflictReport.length, 1);
    const entry = res.conflictReport[0];
    assert.deepEqual(Object.keys(entry).sort(), ['brand_id', 'legacy_rows', 'pt_user_id']);
    assert.equal(entry.legacy_rows.length, 3);
    for (const lr of entry.legacy_rows) {
      assert.deepEqual(Object.keys(lr).sort(), [
        'accepted_at',
        'collaboration_id',
        'gym_id',
        'platform_rate',
        'proposed_gym_rate',
        'proposed_pt_rate',
      ]);
    }
  } finally {
    await cleanup(w);
  }
});

integrationTest('dòng sạch + dòng ACCEPTED đang chấm dứt -> xung đột, không tạo thoả thuận, dòng cũ không đổi', async () => {
  const w = newWorld();
  try {
    const { gymIds } = await makeBrand(w, 2);
    const clean = await makeLegacy(gymIds[0], w.ptUserId);
    const winding = await makeLegacy(gymIds[1], w.ptUserId, { effectiveAt: inDays(20) });
    const before = await legacySnapshot([w.ptUserId]);

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.pairCounts.CONFLICT_MIXED, 1);
    assert.equal((await counts([w.ptUserId])).agreements, 0);
    const conflicts = await prisma.gymPtAgreementConflict.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(conflicts.length, 1);
    assert.deepEqual([...conflicts[0].legacyCollaborationIds].sort(), [clean.id, winding.id].sort());
    assert.deepEqual(await legacySnapshot([w.ptUserId]), before);
  } finally {
    await cleanup(w);
  }
});

integrationTest('PENDING/COUNTERED, TERMINATED, ACCEPTED đang chấm dứt, gym không thương hiệu -> không bị chạm', async () => {
  const w = newWorld();
  try {
    // Mỗi dòng ở một PT riêng để không dòng nào "che" dòng khác; tất cả cùng thuộc phạm vi test.
    const pts = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const { gymIds } = await makeBrand(w, 5);
    const { gymIds: orphanGyms } = await makeBrand(w, 1, { brandless: true });
    await makeLegacy(gymIds[0], pts[0], { status: 'PENDING' });
    await makeLegacy(gymIds[1], pts[1], { status: 'COUNTERED' });
    await makeLegacy(gymIds[2], pts[2], { status: 'TERMINATED' });
    await makeLegacy(gymIds[3], pts[3], { effectiveAt: inDays(10) }); // ACCEPTED đang chấm dứt, đứng một mình
    const orphan = await makeLegacy(orphanGyms[0], pts[4]); // ACCEPTED nhưng gym không có thương hiệu
    const before = await legacySnapshot(pts);

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: pts });
    assert.equal(res.failures.length, 0);
    assert.deepEqual(await counts(pts), { agreements: 0, conflicts: 0 });
    assert.deepEqual(await legacySnapshot(pts), before);

    assert.equal(res.untouchedRowCounts.openNegotiations, 2);
    assert.equal(res.untouchedRowCounts.terminated, 1);
    assert.equal(res.untouchedRowCounts.brandlessGyms, 1);
    assert.deepEqual(res.brandlessCollaborationIds, [orphan.id]);
    assert.equal(res.pairCounts.WINDING_DOWN_ONLY, 1);
    assert.equal(res.pairCounts.SINGLE, 0);
  } finally {
    await cleanup(w);
  }
});

integrationTest('chạy thử (mặc định) không ghi gì, kể cả bảng xung đột và dấu trên dòng cũ', async () => {
  const w = newWorld();
  const w2 = randomUUID();
  try {
    const { gymIds } = await makeBrand(w, 3);
    await makeLegacy(gymIds[0], w.ptUserId, { rates: R_A });
    await makeLegacy(gymIds[1], w.ptUserId, { rates: R_B });
    await makeLegacy(gymIds[2], w2); // cặp khác, sẽ là SINGLE
    const before = await legacySnapshot([w.ptUserId, w2]);

    const res = await backfillBrandPtAgreements(prisma, { ptUserIds: [w.ptUserId, w2] });
    assert.equal(res.mode, 'dry-run');
    assert.equal(res.pairCounts.CONFLICT_RATES, 1);
    assert.equal(res.pairCounts.SINGLE, 1);
    assert.equal(res.conflictReport.length, 1); // báo cáo vẫn được tính ở chạy thử
    assert.deepEqual(await counts([w.ptUserId, w2]), { agreements: 0, conflicts: 0 });
    assert.deepEqual(await legacySnapshot([w.ptUserId, w2]), before);
  } finally {
    await cleanup(w, [w2]);
  }
});

integrationTest('--apply hai lần: lần hai không tạo trùng, không lỗi, không đổi gì', async () => {
  const w = newWorld();
  try {
    const { gymIds } = await makeBrand(w, 2);
    const { gymIds: gymsB } = await makeBrand(w, 2);
    await makeLegacy(gymIds[0], w.ptUserId); // brand 1: SINGLE... cộng với dòng thứ hai khác tỷ lệ => xung đột
    await makeLegacy(gymIds[1], w.ptUserId, { rates: R_A });
    await makeLegacy(gymsB[0], w.ptUserId); // brand 2: SINGLE
    const opts = { apply: true, ptUserIds: [w.ptUserId] };

    const first = await backfillBrandPtAgreements(prisma, opts);
    assert.equal(first.failures.length, 0);
    assert.equal(first.pairCounts.CONFLICT_RATES, 1);
    assert.equal(first.pairCounts.SINGLE, 1);
    const afterFirst = {
      counts: await counts([w.ptUserId]),
      legacy: await legacySnapshot([w.ptUserId]),
      agreements: await prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: w.ptUserId }, orderBy: { id: 'asc' } }),
      conflicts: await prisma.gymPtAgreementConflict.findMany({ where: { ptUserId: w.ptUserId }, orderBy: { id: 'asc' } }),
    };
    assert.deepEqual(afterFirst.counts, { agreements: 1, conflicts: 1 });

    const second = await backfillBrandPtAgreements(prisma, opts);
    assert.equal(second.failures.length, 0);
    // Cặp đã chuyển đổi không còn là ứng viên; cặp xung đột đã ghi nhận thì không làm gì.
    assert.equal(second.pairCounts.SINGLE, 0);
    assert.equal(second.untouchedRowCounts.alreadySuperseded, 1);
    assert.equal(second.pairs.length, 1);
    assert.equal(second.pairs[0].action, 'NONE_CONFLICT_ALREADY_RECORDED');

    assert.deepEqual(await counts([w.ptUserId]), afterFirst.counts);
    assert.deepEqual(await legacySnapshot([w.ptUserId]), afterFirst.legacy);
    assert.deepEqual(
      await prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: w.ptUserId }, orderBy: { id: 'asc' } }),
      afterFirst.agreements,
    );
    assert.deepEqual(
      await prisma.gymPtAgreementConflict.findMany({ where: { ptUserId: w.ptUserId }, orderBy: { id: 'asc' } }),
      afterFirst.conflicts,
    );
  } finally {
    await cleanup(w);
  }
});

integrationTest('cặp đã có thoả thuận ACCEPTED ở bảng mới -> bỏ qua, không tạo thêm, không đánh dấu dòng cũ', async () => {
  const w = newWorld();
  try {
    const { brandId, gymIds } = await makeBrand(w, 1);
    const legacy = await makeLegacy(gymIds[0], w.ptUserId);
    const existing = await prisma.gymBrandPtAgreement.create({
      data: {
        id: randomUUID(), brandId: brandId!, ptUserId: w.ptUserId, status: 'ACCEPTED', proposedBy: 'PT',
        proposedPtRate: '0.6000', proposedGymRate: '0.3000', platformRate: '0.1000', expiresAt: inDays(7), acceptedAt: new Date(),
      },
    });
    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.failures.length, 0);
    assert.equal(res.pairCounts.ALREADY_COVERED, 1);
    assert.equal((await counts([w.ptUserId])).agreements, 1);
    const after = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(after.supersededByAgreementId, null);
    assert.equal(existing.origin, 'NATIVE');
  } finally {
    await cleanup(w);
  }
});

integrationTest('một PT có thoả thuận ở hai thương hiệu khác nhau -> hai kết quả độc lập', async () => {
  const w = newWorld();
  try {
    const one = await makeBrand(w, 2);
    const two = await makeBrand(w, 2);
    // Thương hiệu 1: cùng tỷ lệ -> gộp. Thương hiệu 2: khác tỷ lệ -> xung đột. Không ảnh hưởng nhau.
    await makeLegacy(one.gymIds[0], w.ptUserId, { rates: R_A });
    await makeLegacy(one.gymIds[1], w.ptUserId, { rates: R_A });
    const c1 = await makeLegacy(two.gymIds[0], w.ptUserId, { rates: R_A });
    const c2 = await makeLegacy(two.gymIds[1], w.ptUserId, { rates: R_B });

    const res = await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    assert.equal(res.failures.length, 0);
    assert.equal(res.pairs.length, 2);

    const agreements = await prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(agreements.length, 1);
    assert.equal(agreements[0].brandId, one.brandId);
    const conflicts = await prisma.gymPtAgreementConflict.findMany({ where: { ptUserId: w.ptUserId } });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].brandId, two.brandId);
    assert.deepEqual([...conflicts[0].legacyCollaborationIds].sort(), [c1.id, c2.id].sort());
  } finally {
    await cleanup(w);
  }
});

integrationTest('mỗi cặp một transaction: cặp lỗi bị hoàn tác hết, cặp khác vẫn xong, lỗi được báo', async () => {
  const w = newWorld();
  const ptBad = randomUUID();
  try {
    const { gymIds } = await makeBrand(w, 2);
    const good = await makeLegacy(gymIds[0], w.ptUserId);
    const bad = await makeLegacy(gymIds[1], ptBad);

    const res = await backfillBrandPtAgreements(prisma, {
      apply: true,
      ptUserIds: [w.ptUserId, ptBad],
      beforeCommit: async ({ ptUserId }) => {
        if (ptUserId === ptBad) throw new Error('lỗi giả lập giữa transaction');
      },
    });
    assert.equal(res.failures.length, 1);
    assert.equal(res.failures[0].ptUserId, ptBad);
    assert.match(res.failures[0].error, /giả lập/);

    assert.equal((await counts([w.ptUserId])).agreements, 1);
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: good.id } })).supersededByAgreementId !== null, true);
    // Cặp lỗi: không có thoả thuận, dòng cũ không bị đánh dấu.
    assert.equal((await counts([ptBad])).agreements, 0);
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: bad.id } })).supersededByAgreementId, null);
  } finally {
    await cleanup(w, [ptBad]);
  }
});

// ───────────────────────── Lùi lại ─────────────────────────

integrationTest('--rollback: khôi phục đúng trạng thái trước đó; chạy thử việc lùi không xoá gì', async () => {
  const w = newWorld();
  try {
    const a = await makeBrand(w, 2);
    const b = await makeBrand(w, 2);
    await makeLegacy(a.gymIds[0], w.ptUserId, { rates: R_A });
    await makeLegacy(a.gymIds[1], w.ptUserId, { rates: R_A });
    await makeLegacy(b.gymIds[0], w.ptUserId, { rates: R_A });
    await makeLegacy(b.gymIds[1], w.ptUserId, { rates: R_B });
    const before = await legacySnapshot([w.ptUserId]);
    const scope = { ptUserIds: [w.ptUserId] };

    await backfillBrandPtAgreements(prisma, { apply: true, ...scope });
    assert.deepEqual(await counts([w.ptUserId]), { agreements: 1, conflicts: 1 });
    assert.notDeepEqual(await legacySnapshot([w.ptUserId]), before);

    const dry = await rollbackBrandPtAgreements(prisma, scope);
    assert.equal(dry.mode, 'dry-run');
    assert.deepEqual(
      { m: dry.migratedAgreements, l: dry.legacyRowsToClear, c: dry.conflictRows },
      { m: 1, l: 2, c: 1 },
    );
    assert.deepEqual(await counts([w.ptUserId]), { agreements: 1, conflicts: 1 });

    const done = await rollbackBrandPtAgreements(prisma, { apply: true, ...scope });
    assert.equal(done.mode, 'apply');
    assert.deepEqual(await counts([w.ptUserId]), { agreements: 0, conflicts: 0 });
    assert.deepEqual(await legacySnapshot([w.ptUserId]), before); // đúng từng cột, kể cả updated_at

    // Và điền lại sau khi lùi hoạt động bình thường.
    const again = await backfillBrandPtAgreements(prisma, { apply: true, ...scope });
    assert.equal(again.failures.length, 0);
    assert.deepEqual(await counts([w.ptUserId]), { agreements: 1, conflicts: 1 });
  } finally {
    await cleanup(w);
  }
});

integrationTest('--rollback từ chối khi có thoả thuận NATIVE, và không xoá gì', async () => {
  const w = newWorld();
  try {
    const a = await makeBrand(w, 1);
    const b = await makeBrand(w, 1);
    await makeLegacy(a.gymIds[0], w.ptUserId);
    await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    await prisma.gymBrandPtAgreement.create({
      data: {
        id: randomUUID(), brandId: b.brandId!, ptUserId: w.ptUserId, status: 'PENDING', proposedBy: 'GYM',
        proposedPtRate: '0.6000', proposedGymRate: '0.3000', platformRate: '0.1000', expiresAt: inDays(7), origin: 'NATIVE',
      },
    });
    const before = await counts([w.ptUserId]);
    await assert.rejects(
      rollbackBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] }),
      (e: unknown) => e instanceof RollbackRefusedError && /NATIVE/.test((e as Error).message),
    );
    assert.deepEqual(await counts([w.ptUserId]), before);
    const marked = await prisma.gymPtCollaboration.count({
      where: { ptUserId: w.ptUserId, supersededByAgreementId: { not: null } },
    });
    assert.equal(marked, 1, 'dấu trên dòng cũ phải còn nguyên');
  } finally {
    await cleanup(w);
  }
});

integrationTest('--rollback từ chối khi thoả thuận MIGRATED đã bị luồng mới chấm dứt', async () => {
  const w = newWorld();
  try {
    const a = await makeBrand(w, 1);
    await makeLegacy(a.gymIds[0], w.ptUserId);
    await backfillBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] });
    await prisma.gymBrandPtAgreement.updateMany({
      where: { ptUserId: w.ptUserId },
      data: { terminationInitiatedAt: new Date() },
    });
    await assert.rejects(
      rollbackBrandPtAgreements(prisma, { apply: true, ptUserIds: [w.ptUserId] }),
      RollbackRefusedError,
    );
    assert.equal((await counts([w.ptUserId])).agreements, 1);
  } finally {
    await cleanup(w);
  }
});

// ───────────────────────── Chỉ mục duy nhất ─────────────────────────

integrationTest('chỉ mục duy nhất: từ chối ACCEPTED thứ hai và thương thảo mở thứ hai cho cùng (brand, PT)', async () => {
  const w = newWorld();
  try {
    const { brandId } = await makeBrand(w, 1);
    const base = {
      brandId: brandId!, ptUserId: w.ptUserId, proposedBy: 'PT' as const,
      proposedPtRate: '0.5000', proposedGymRate: '0.4000', platformRate: '0.1000', expiresAt: inDays(7),
    };
    const mk = (status: 'ACCEPTED' | 'PENDING' | 'COUNTERED' | 'TERMINATED' | 'REJECTED') =>
      prisma.gymBrandPtAgreement.create({ data: { id: randomUUID(), status, ...base } });

    await mk('ACCEPTED');
    await assert.rejects(mk('ACCEPTED'), /Unique constraint/);
    // Dòng đã kết thúc thì được phép trùng cặp (chỉ mục chỉ áp cho ACCEPTED).
    await mk('TERMINATED');
    await mk('REJECTED');

    await mk('PENDING');
    await assert.rejects(mk('PENDING'), /Unique constraint/);
    await assert.rejects(mk('COUNTERED'), /Unique constraint/); // PENDING và COUNTERED cùng một nhóm "đang mở"
    // Một ACCEPTED và một đang mở có thể cùng tồn tại (gia hạn/điều chỉnh khi đang hiệu lực).
    assert.equal((await counts([w.ptUserId])).agreements, 4);

    // Xung đột: một OPEN mỗi cặp, nhưng có thể có nhiều RESOLVED làm lịch sử.
    const c = { brandId: brandId!, ptUserId: w.ptUserId, legacyCollaborationIds: ['x'] };
    await prisma.gymPtAgreementConflict.create({ data: { id: randomUUID(), ...c } });
    await assert.rejects(prisma.gymPtAgreementConflict.create({ data: { id: randomUUID(), ...c } }), /Unique constraint/);
    await prisma.gymPtAgreementConflict.create({ data: { id: randomUUID(), ...c, status: 'RESOLVED' } });
    await prisma.gymPtAgreementConflict.create({ data: { id: randomUUID(), ...c, status: 'RESOLVED' } });
  } finally {
    await cleanup(w);
  }
});
