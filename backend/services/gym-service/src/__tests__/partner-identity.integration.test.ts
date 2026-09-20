import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { partnerService } from '../services/partner.service';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { requirePartnerOwner, requireGymScope } from '../middleware/partner-context.middleware';

/**
 * Phase 1 — nghiệm thu "nền tảng danh tính đối tác".
 *
 * Chạy trên CSDL dev thật (gymcoach_gym): những thứ cần chứng minh ở đây phần lớn là ràng
 * buộc ở tầng CSDL (partial unique index, CHECK constraint) — mock ở tầng ORM thì không
 * chứng minh được gì cả. Tạo dòng thật, dọn sạch sau mỗi bài.
 */

const created: { partners: string[] } = { partners: [] };

async function makePartner(status: 'PROSPECT' | 'INVITED' | 'ACTIVE' = 'ACTIVE') {
  const partner = await prisma.gymPartner.create({
    data: { legalName: `Test Partner ${randomUUID().slice(0, 8)}`, contactEmail: `${randomUUID().slice(0, 8)}@example.com`, status },
  });
  created.partners.push(partner.id);
  return partner;
}

async function makeOwnerAccount(partnerId: string, userId = randomUUID()) {
  return prisma.gymPartnerAccount.create({
    data: { partnerId, userId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date() },
  });
}

async function cleanup() {
  // Cascade xoá luôn accounts + invitations của các đối tác này.
  await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } });
  created.partners.length = 0;
}

/** Bộ đôi req/res tối thiểu để chạy thẳng middleware mà không cần dựng cả app Express. */
function fakeReqRes(partner: any, params: Record<string, string> = {}) {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  return { req: { partner, params } as any, res, nextCalled: { value: false } };
}

integrationTest('bất biến: một userId chỉ thuộc tối đa một đối tác', async () => {
  try {
    const a = await makePartner();
    const b = await makePartner();
    const sharedUserId = randomUUID();
    await makeOwnerAccount(a.id, sharedUserId);

    await assert.rejects(
      () => makeOwnerAccount(b.id, sharedUserId),
      /Unique constraint|user_id/i,
      'CSDL phải từ chối gắn cùng một userId vào đối tác thứ hai',
    );
  } finally {
    await cleanup();
  }
});

integrationTest('bất biến: mỗi đối tác chỉ có đúng một tài khoản OWNER đang hoạt động', async () => {
  try {
    const partner = await makePartner();
    await makeOwnerAccount(partner.id);

    await assert.rejects(
      () => makeOwnerAccount(partner.id),
      /Unique constraint|one_active_owner/i,
      'partial unique index phải chặn OWNER thứ hai — kiểm ở tầng service thôi thì hai yêu cầu đồng thời lọt cả hai',
    );
  } finally {
    await cleanup();
  }
});

integrationTest('bất biến: MANAGER phải có ít nhất một chi nhánh trong phạm vi', async () => {
  try {
    const partner = await makePartner();
    await assert.rejects(
      () =>
        prisma.gymPartnerAccount.create({
          data: { partnerId: partner.id, userId: randomUUID(), role: 'MANAGER', scopedGymIds: [], status: 'ACTIVE' },
        }),
      /manager_needs_scope|check constraint/i,
    );

    // Có phạm vi thì tạo được bình thường.
    const ok = await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: randomUUID(), role: 'MANAGER', scopedGymIds: [randomUUID()], status: 'ACTIVE' },
    });
    assert.equal(ok.role, 'MANAGER');
  } finally {
    await cleanup();
  }
});

integrationTest('bất biến: không thu hồi được tài khoản OWNER cuối cùng', async () => {
  try {
    const partner = await makePartner();
    const owner = await makeOwnerAccount(partner.id);
    const manager = await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: randomUUID(), role: 'MANAGER', scopedGymIds: [randomUUID()], status: 'ACTIVE' },
    });

    // Thu hồi quản lý thì được.
    const revokedManager = await partnerService.revokeAccount(manager.id, 'admin-1', 'kiểm thử');
    assert.equal(revokedManager.status, 'REVOKED');

    // Thu hồi chủ sở hữu duy nhất thì không.
    await assert.rejects(
      () => partnerService.revokeAccount(owner.id, 'admin-1'),
      (e: any) => e.status === 409 && /chủ sở hữu cuối cùng/i.test(e.message),
    );

    const stillActive = await prisma.gymPartnerAccount.findUnique({ where: { id: owner.id } });
    assert.equal(stillActive?.status, 'ACTIVE', 'tài khoản chủ sở hữu phải còn nguyên sau khi bị từ chối');
  } finally {
    await cleanup();
  }
});

integrationTest('thư mời: chỉ lưu băm, token gốc không có trong CSDL', async () => {
  try {
    const partner = await makePartner('INVITED');
    const { invitation, rawToken } = await partnerInvitationService.createInvitation({
      partnerId: partner.id,
      email: 'chusohuu@example.com',
      role: 'OWNER',
      createdBy: 'admin-1',
    });

    assert.notEqual(invitation.tokenHash, rawToken, 'không được lưu token gốc');
    assert.equal(invitation.tokenHash, partnerInvitationService._hashToken(rawToken));

    // Không dòng nào trong bảng chứa chuỗi token gốc, ở bất kỳ cột nào.
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM partner_invitations WHERE token_hash = $1`,
      rawToken,
    );
    assert.equal(Number(rows[0].n), 0, 'token gốc không được xuất hiện nguyên văn trong CSDL');

    // Token đúng thì tra ra được thư mời.
    const found = await partnerInvitationService.validateToken(rawToken);
    assert.equal(found.id, invitation.id);

    // Token sai thì không.
    await assert.rejects(
      () => partnerInvitationService.validateToken('token-bia-dat'),
      (e: any) => e.status === 404,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('thư mời: quá hạn thì không dùng được nữa và bị đánh dấu EXPIRED', async () => {
  try {
    const partner = await makePartner('INVITED');
    const { invitation, rawToken } = await partnerInvitationService.createInvitation({
      partnerId: partner.id,
      email: 'quahan@example.com',
      role: 'OWNER',
      createdBy: 'admin-1',
    });

    // Đẩy hạn về quá khứ thay vì chờ 7 ngày thật.
    await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await assert.rejects(
      () => partnerInvitationService.validateToken(rawToken),
      (e: any) => e.status === 410 && /hết hạn/i.test(e.message),
    );

    const after = await prisma.partnerInvitation.findUnique({ where: { id: invitation.id } });
    assert.equal(after?.status, 'EXPIRED', 'chạm tới thư quá hạn phải đánh dấu luôn, không để nói dối là PENDING mãi');

    // Và chấp nhận cũng phải hỏng theo.
    await assert.rejects(() => partnerInvitationService.acceptInvitation(rawToken, randomUUID()), (e: any) => e.status === 410);
  } finally {
    await cleanup();
  }
});

integrationTest('thư mời: chấp nhận tạo tài khoản và đưa đối tác sang ACTIVE', async () => {
  try {
    const partner = await makePartner('INVITED');
    const { rawToken } = await partnerInvitationService.createInvitation({
      partnerId: partner.id,
      email: 'chusohuu2@example.com',
      role: 'OWNER',
      createdBy: 'admin-1',
    });

    const userId = randomUUID();
    const account = await partnerInvitationService.acceptInvitation(rawToken, userId);
    assert.equal(account.role, 'OWNER');
    assert.equal(account.status, 'ACTIVE');

    const refreshed = await prisma.gymPartner.findUnique({ where: { id: partner.id } });
    assert.equal(refreshed?.status, 'ACTIVE');

    // Dùng lại chính token đó lần hai phải hỏng.
    await assert.rejects(
      () => partnerInvitationService.acceptInvitation(rawToken, randomUUID()),
      (e: any) => e.status === 409,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('phân giải danh tính: quản lý đi tiếp bằng principalUserId của chủ sở hữu', async () => {
  try {
    const partner = await makePartner();
    const ownerUserId = randomUUID();
    await makeOwnerAccount(partner.id, ownerUserId);

    const managerUserId = randomUUID();
    const scopedGymId = randomUUID();
    await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: managerUserId, role: 'MANAGER', scopedGymIds: [scopedGymId], status: 'ACTIVE' },
    });

    const ownerCtx = await partnerService.resolveContextForUser(ownerUserId);
    assert.equal(ownerCtx.role, 'OWNER');
    assert.equal(ownerCtx.principalUserId, ownerUserId);

    const managerCtx = await partnerService.resolveContextForUser(managerUserId);
    assert.equal(managerCtx.role, 'MANAGER');
    assert.equal(
      managerCtx.principalUserId,
      ownerUserId,
      'quản lý phải mượn danh tính chủ sở hữu để mọi kiểm tra quyền sở hữu sẵn có chạy y nguyên',
    );
    assert.deepEqual(managerCtx.scopedGymIds, [scopedGymId]);

    // Tài khoản đã thu hồi thì không phân giải được nữa.
    const revoked = randomUUID();
    await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: revoked, role: 'MANAGER', scopedGymIds: [scopedGymId], status: 'REVOKED' },
    });
    await assert.rejects(() => partnerService.resolveContextForUser(revoked), (e: any) => e.status === 403);
  } finally {
    await cleanup();
  }
});

integrationTest('phân giải danh tính: chủ gym có từ trước mô hình đối tác vẫn vào được — khi CHỨNG MINH được sở hữu', async () => {
  const legacyUserId = randomUUID();
  // Bằng chứng duy nhất được chấp nhận: đang thực sự đứng tên một Gym (hoặc một Brand).
  const gym = await prisma.gym.create({
    data: { ownerId: legacyUserId, name: 'Legacy Gym ' + legacyUserId.slice(0, 6), address: 'x', status: 'APPROVED' },
  });
  try {
    const ctx = await partnerService.resolveContextForUser(legacyUserId);
    assert.equal(ctx.isLegacy, true);
    assert.equal(ctx.role, 'OWNER');
    assert.equal(ctx.principalUserId, legacyUserId, 'không có hồ sơ đối tác thì tự làm chủ chính mình, như trước phase này');
  } finally {
    await prisma.gym.delete({ where: { id: gym.id } });
  }
});

integrationTest('phân giải danh tính: tài khoản GYM_OWNER MỒ CÔI (không account, không đứng tên gì) KHÔNG còn là legacy', async () => {
  // Đúng kiểu 11 user GYM_OWNER ở DB dev: có vai trò trong auth-service nhưng không có hồ sơ đối tác
  // và không sở hữu Gym/Brand nào. Trước đây nhận full quyền vận hành + bỏ qua cổng onboarding.
  const orphanUserId = randomUUID();
  const ctx = await partnerService.resolveContextForUser(orphanUserId);
  assert.equal(ctx.isLegacy, false, '"không có GymPartnerAccount" tự nó không còn nghĩa là legacy');
  assert.equal(ctx.accountId, null);
  assert.equal(ctx.partnerStatus, null);
  assert.equal(ctx.accountStatus, null);
});

test('ma trận quyền: MANAGER gọi route của chủ sở hữu (ví, rút tiền) → 403', () => {
  const { req, res } = fakeReqRes({ role: 'MANAGER', scopedGymIds: ['gym-1'], principalUserId: 'owner-1' });
  let nextCalled = false;
  requirePartnerOwner(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'không được đi tiếp');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'OWNER_ROLE_REQUIRED');
});

test('ma trận quyền: OWNER đi qua guard chủ sở hữu', () => {
  const { req, res } = fakeReqRes({ role: 'OWNER', scopedGymIds: [], principalUserId: 'owner-1' });
  let nextCalled = false;
  requirePartnerOwner(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
});

test('phạm vi chi nhánh: MANAGER chỉ thao tác được trên chi nhánh được gán', () => {
  const guard = requireGymScope('gymId');

  const allowed = fakeReqRes({ role: 'MANAGER', scopedGymIds: ['gym-1'], principalUserId: 'owner-1' }, { gymId: 'gym-1' });
  let ok = false;
  guard(allowed.req, allowed.res, () => { ok = true; });
  assert.equal(ok, true, 'chi nhánh được gán thì phải cho qua');

  const denied = fakeReqRes({ role: 'MANAGER', scopedGymIds: ['gym-1'], principalUserId: 'owner-1' }, { gymId: 'gym-9' });
  let leaked = false;
  guard(denied.req, denied.res, () => { leaked = true; });
  assert.equal(leaked, false);
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.res.body.error.code, 'GYM_OUT_OF_SCOPE');

  // Chủ sở hữu không bị giới hạn (scopedGymIds rỗng = toàn bộ).
  const owner = fakeReqRes({ role: 'OWNER', scopedGymIds: [], principalUserId: 'owner-1' }, { gymId: 'gym-9' });
  let ownerOk = false;
  guard(owner.req, owner.res, () => { ownerOk = true; });
  assert.equal(ownerOk, true);
});
