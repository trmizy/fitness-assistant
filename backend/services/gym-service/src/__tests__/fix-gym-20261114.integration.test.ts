/**
 * Fix round 14/11/2026 (gym-service), bugs from the 13/11 full test (_warroom/evidence/full-test-20261113/BUG_LOG.md):
 *   Q4 (owner approved) re-inviting a REVOKED staff member; N13E-02 purchase with an unsupported provider; N13E-03 / N13E-04 collaboration + trainers with a junk / unknown /
 *   CUSTOMER ptUserId; N13E-01 branch phone; N13E-05 photos of a TEMPORARILY_CLOSED branch for its owner / manager / admin; N13E-07 PT answers an invitation with an unknown
 *   action; N13E-09 complaint photo with HTML bytes named .jpg; N13E-10 admin PATCH gym status "BOGUS".
 *
 * BACKEND INTEGRATION: REAL HTTP into the real gym-service app (all routers + middleware) + real service code on the isolated *_test database.
 * TEST FIXTURE: gym / partner / membership rows, the auth token table, the auth-service lookups (account by id / by email / batch, patched on authClient), the payment
 * checkout (patched on paymentClient), photo files written to uploads/gym-photos for the test. The Q5 complaint-case fix has its own suite
 * (complaint-case.q5-appeal-after-refund.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { authClient } from '../clients/auth.client';
import { paymentClient } from '../clients/payment.client';
import { applicationBranchSchema } from '../schemas/application.schemas';
import { gymAdminUpdateSchema, gymCreateSchema, gymUpdateSchema } from '../schemas/gym.schemas';
import { assertSupportedProvider } from '../services/membership.service';
import { call, cleanup, authDirectory, identities, installStubs, makeGym, newAdmin, patch, removeStubs, setFlag, skip, startApp, stopApp, token, usable } from './complaint-case.test-helpers';

const restores: Array<() => void> = [];
const createdPhotoFiles: string[] = [];
const createdGymIds: string[] = [];
const accounts = new Map<string, { id: string; email: string; role: string; isActive: boolean }>(); // auth-service's "account by id"
const sentMails: string[] = [];
let authBatchDown = false;

const registerAccount = (id: string, role: string, email = `${id}@fix.test`, isActive = true) => {
  accounts.set(id, { id, email, role, isActive });
  authDirectory.users.set(id, { role, isActive });
};

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  setFlag(true);
  restores.push(
    // account by id (PT eligibility): the helper's directory answers, and the email follows the registered account
    patch(authClient, 'getUser', async (userId: string) => {
      const a = accounts.get(userId);
      if (!a) throw Object.assign(new Error('404'), { response: { status: 404 } });
      return { id: a.id, email: a.email, firstName: 'T', lastName: 'T', role: a.role, isActive: a.isActive };
    }),
    patch(authClient, 'getUsersBatch', async (ids: string[]) => {
      if (authBatchDown) throw new Error('auth-service unreachable');
      return ids.map((id) => accounts.get(id)).filter(Boolean).map((a) => ({ id: a!.id, email: a!.email, firstName: 'T', lastName: 'T' }));
    }),
    patch(authClient, 'emailStatus', async (email: string) => {
      const a = [...accounts.values()].find((x) => x.email === email);
      return a ? { exists: true, role: a.role } : { exists: false, role: null };
    }),
    patch(authClient, 'sendEmail', async (p: any) => {
      sentMails.push(p.to);
      return true;
    }),
    patch(authClient, 'revokeSessions', async () => ({ revoked: 1 })),
    patch(authClient, 'createInvitedAccount', async (p: any) => {
      const id = randomUUID();
      registerAccount(id, 'GYM_OWNER', p.email);
      return { id, email: p.email, firstName: p.firstName, lastName: null, role: 'GYM_OWNER' };
    }),
    patch(paymentClient, 'checkout', async (p: any) => ({ transactionId: randomUUID(), status: 'PENDING', redirectUrl: 'https://pay.test/x', qrCodeUrl: null, provider: p.provider ?? 'VNPAY' })),
  );
});
test.after(async () => {
  setFlag(undefined);
  while (restores.length) restores.pop()!();
  removeStubs();
  for (const f of createdPhotoFiles) fs.rmSync(f, { force: true });
  try {
    if (!skip) {
      await prisma.gymPtCollaboration.deleteMany({ where: { gymId: { in: createdGymIds } } });
      await prisma.gymTrainerAffiliation.deleteMany({ where: { gymId: { in: createdGymIds } } });
      await prisma.gymPhoto.deleteMany({ where: { gymId: { in: createdGymIds } } });
      // brand-level PT agreements created by the collaboration propose (RESTRICT fk to the brand)
      const brandIds = (await prisma.gym.findMany({ where: { id: { in: createdGymIds } }, select: { brandId: true } })).map((g) => g.brandId).filter((b): b is string => !!b);
      if (brandIds.length) {
        await prisma.$executeRawUnsafe('DELETE FROM gym_pt_agreement_conflicts WHERE brand_id = ANY($1::text[])', brandIds).catch(() => undefined);
        await prisma.$executeRawUnsafe('DELETE FROM gym_brand_pt_agreements WHERE brand_id = ANY($1::text[])', brandIds);
      }
      await cleanup();
    }
  } finally {
    await stopApp();
    await prisma.$disconnect();
  }
});
test.beforeEach(() => {
  authBatchDown = false;
  sentMails.length = 0;
});

/** A partner whose OWNER can run everything (ACTIVE + VERIFIED + onboarded), one approved OPEN branch, and the owner's token. */
async function operationalOwner() {
  const g = await makeGym();
  createdGymIds.push(g.gym.id);
  const tok = token(g.ownerId, 'GYM_OWNER');
  registerAccount(g.ownerId, 'GYM_OWNER');
  return { ...g, tok };
}

// ── Q4: re-invite a revoked staff member ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Q4: a revoked staff member can be re-invited; accepting reactivates the SAME account row with the new role + branch, the old invitation stays as history; an ACTIVE member is still refused', { skip }, async () => {
  const o = await operationalOwner();
  const second = await prisma.gym.create({ data: { ownerId: o.ownerId, brandId: o.brand.id, name: 'Case Gym 2', address: '2 Test St', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'Case Gym 2', approvedAddress: '2 Test St' } });
  createdGymIds.push(second.id);
  const staffId = randomUUID();
  const email = `staff-${randomUUID().slice(0, 8)}@fix.test`;
  registerAccount(staffId, 'GYM_OWNER', email);
  const acct = await prisma.gymPartnerAccount.create({
    data: { partnerId: o.partner.id, userId: staffId, role: 'RECEPTIONIST', scopedGymIds: [o.gym.id], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const oldInvite = await prisma.partnerInvitation.create({
    data: { partnerId: o.partner.id, email, role: 'RECEPTIONIST', scopedGymIds: [o.gym.id], tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000), status: 'ACCEPTED', acceptedAt: new Date() },
  });
  const invite = (role: string, gymIds: string[]) => call('POST', '/owner/partner-invitations', o.tok, { email, role, scopedGymIds: gymIds });

  // 1. ACTIVE: refused as before
  const active = await invite('MANAGER', [o.gym.id]);
  assert.equal(active.status, 409, JSON.stringify(active.body));
  assert.equal(active.body.error.code, 'ALREADY_PARTNER_MEMBER');

  // 2. revoke through the real owner route
  const revoked = await call('DELETE', `/owner/partner-accounts/${acct.id}`, o.tok, { reason: 'nghỉ việc' });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal((await prisma.gymPartnerAccount.findUniqueOrThrow({ where: { id: acct.id } })).status, 'REVOKED');

  // 3. the auth lookup is down: conservative, still "already a member" (never re-invited on a guess)
  authBatchDown = true;
  assert.equal((await invite('MANAGER', [o.gym.id])).body.error.code, 'ALREADY_PARTNER_MEMBER');
  authBatchDown = false;

  // 4. revoked: a NEW invitation (different role + different branch) is created
  const again = await invite('MANAGER', [second.id]);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const rawToken = String(again.body.data.inviteLink).split('/partner/invite/')[1];
  assert.ok(rawToken);
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: o.partner.id, email } }), 2);
  assert.equal((await prisma.partnerInvitation.findUniqueOrThrow({ where: { id: oldInvite.id } })).status, 'ACCEPTED', 'the old invitation stays as history');
  // a second live invitation for the same email is still refused
  assert.equal((await invite('MANAGER', [second.id])).body.error.code, 'INVITATION_ALREADY_PENDING');

  // 5. the link tells the page this is an existing account (no new password)
  const preview = await call('GET', `/partner-invitations/${rawToken}`, null);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.existingAccount, true);

  // 6. accept: no password, no account creation, SAME row reactivated with the new role + branch scope
  const accepted = await call('POST', `/partner-invitations/${rawToken}/accept`, null, {});
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.reactivated, true);
  assert.equal(accepted.body.data.role, 'MANAGER');
  const after = await prisma.gymPartnerAccount.findUniqueOrThrow({ where: { id: acct.id } });
  assert.equal(after.userId, staffId, 'same person, same row');
  assert.equal(after.status, 'ACTIVE');
  assert.equal(after.role, 'MANAGER');
  assert.deepEqual(after.scopedGymIds, [second.id]);
  assert.equal(after.revokedAt, null);
  assert.equal(await prisma.gymPartnerAccount.count({ where: { userId: staffId } }), 1, 'no second account row');
  const audit = await prisma.partnerAuditLog.findMany({ where: { partnerId: o.partner.id, targetAccountId: acct.id, action: 'PARTNER_UPDATED' } });
  assert.equal(audit.length, 1);
  const meta = audit[0].metadata as any;
  assert.deepEqual([meta.reactivated, meta.previousRole, meta.newRole], [true, 'RECEPTIONIST', 'MANAGER']);
  assert.ok(meta.previousRevokedAt, 'the old revocation is kept in the audit trail');
  const used = await prisma.partnerInvitation.findMany({ where: { partnerId: o.partner.id, email }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(used.map((r) => r.status), ['ACCEPTED', 'ACCEPTED']);

  // 7. the link is single-use; and the account is ACTIVE again, so a further invitation is refused again
  assert.equal((await call('POST', `/partner-invitations/${rawToken}/accept`, null, {})).status, 409);
  assert.equal((await invite('MANAGER', [second.id])).body.error.code, 'ALREADY_PARTNER_MEMBER');
});

test('Q4: a person revoked at ANOTHER partner is not re-invitable here (EMAIL_IN_USE)', { skip }, async () => {
  const a = await operationalOwner();
  const b = await operationalOwner();
  const staffId = randomUUID();
  const email = `other-${randomUUID().slice(0, 8)}@fix.test`;
  registerAccount(staffId, 'GYM_OWNER', email);
  await prisma.gymPartnerAccount.create({ data: { partnerId: b.partner.id, userId: staffId, role: 'RECEPTIONIST', scopedGymIds: [b.gym.id], status: 'REVOKED', activatedAt: new Date(), revokedAt: new Date() } });
  await prisma.partnerInvitation.create({ data: { partnerId: b.partner.id, email, role: 'RECEPTIONIST', scopedGymIds: [b.gym.id], tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000), status: 'ACCEPTED', acceptedAt: new Date() } });
  const r = await call('POST', '/owner/partner-invitations', a.tok, { email, role: 'MANAGER', scopedGymIds: [a.gym.id] });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'EMAIL_IN_USE', 'the revoked person belongs to ANOTHER partner: only their own partner may bring them back');
  assert.equal(await prisma.partnerInvitation.count({ where: { partnerId: a.partner.id, email } }), 0);
  assert.equal((await prisma.gymPartnerAccount.findUniqueOrThrow({ where: { userId: staffId } })).partnerId, b.partner.id);
});

// ── N13E-02: provider validated BEFORE the membership row exists ──────────────────────────────────────────────────────────────────────────────────

test('N13E-02: an unsupported provider (MOMO / PAYOS / BOGUS) is refused 400 INVALID_PAYMENT_PROVIDER and leaves NO membership row; the next purchase with a live provider works', { skip }, async () => {
  assert.doesNotThrow(() => assertSupportedProvider(undefined));
  assert.doesNotThrow(() => assertSupportedProvider('zalopay'));
  const o = await operationalOwner();
  const plan = await prisma.gymMembershipPlan.create({ data: { brandId: o.brand.id, name: 'Gói test', price: 300_000, durationDays: 30 } });
  const clientId = randomUUID();
  const tok = token(clientId, 'CUSTOMER');
  for (const provider of ['MOMO', 'PAYOS', 'BOGUS']) {
    const r = await call('POST', `/gyms/${o.gym.id}/memberships`, tok, { planId: plan.id, provider });
    assert.equal(r.status, 400, provider);
    assert.equal(r.body.error.code, 'INVALID_PAYMENT_PROVIDER', provider);
    assert.equal(await prisma.gymMembershipContract.count({ where: { clientId } }), 0, `${provider}: nothing left behind`);
  }
  const ok = await call('POST', `/gyms/${o.gym.id}/memberships`, tok, { planId: plan.id, provider: 'vnpay' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await prisma.gymMembershipContract.count({ where: { clientId, status: 'PENDING_PAYMENT' } }), 1);
  // retry-pay with a bad provider is refused too, and does not touch the pending row
  const row = await prisma.gymMembershipContract.findFirstOrThrow({ where: { clientId } });
  const retry = await call('POST', `/me/gym-memberships/${row.id}/pay`, tok, { provider: 'MOMO' });
  assert.equal(retry.status, 400);
  assert.equal(retry.body.error.code, 'INVALID_PAYMENT_PROVIDER');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING_PAYMENT');
});

// ── N13E-03 / N13E-04: ptUserId must be a real, active PT ─────────────────────────────────────────────────────────────────────────────────────────

test('N13E-03/04: collaboration propose and owner trainers invite refuse junk / unknown / CUSTOMER / locked ids (no dangling row) and accept a real PT', { skip }, async () => {
  const o = await operationalOwner();
  const customerId = randomUUID();
  const lockedPt = randomUUID();
  const goodPt = randomUUID();
  registerAccount(customerId, 'CUSTOMER');
  registerAccount(lockedPt, 'PT', undefined, false);
  registerAccount(goodPt, 'PT');
  const collab = (ptUserId: unknown) => call('POST', `/owner/gyms/${o.gym.id}/collaborations`, o.tok, { ptUserId, ptRate: '0.6', gymRate: '0.3' });
  const trainer = (ptId: unknown) => call('POST', `/owner/gyms/${o.gym.id}/trainers`, o.tok, { ptId });
  const cases: Array<[unknown, number, string]> = [
    ['not-a-uuid', 400, 'INVALID_PT_USER_ID'],
    [randomUUID(), 404, 'PT_NOT_FOUND'],
    [customerId, 422, 'NOT_A_PT'],
    [lockedPt, 422, 'PT_NOT_ACTIVE'],
  ];
  for (const [id, status, code] of cases) {
    const c = await collab(id);
    assert.deepEqual([c.status, c.body.error?.code], [status, code], `collaboration ${String(id)}`);
    const t = await trainer(id);
    assert.deepEqual([t.status, t.body.error?.code], [status, code], `trainer ${String(id)}`);
  }
  assert.equal(await prisma.gymPtCollaboration.count({ where: { gymId: o.gym.id } }), 0, 'no dangling collaboration');
  assert.equal(await prisma.gymTrainerAffiliation.count({ where: { gymId: o.gym.id } }), 0, 'no dangling invitation');
  const okCollab = await collab(goodPt);
  assert.equal(okCollab.status, 201, JSON.stringify(okCollab.body));
  const okTrainer = await trainer(goodPt);
  assert.equal(okTrainer.status, 201, JSON.stringify(okTrainer.body));
  // another owner cannot use this as a probe: the ownership check answers first
  const stranger = await operationalOwner();
  assert.equal((await call('POST', `/owner/gyms/${o.gym.id}/trainers`, stranger.tok, { ptId: randomUUID() })).status, 403);
});

// ── N13E-07: PT answers an invitation ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('N13E-07: an unknown / missing action is 400 and leaves the invitation PENDING; accept:true, action ACCEPT and accept:false still work', { skip }, async () => {
  const o = await operationalOwner();
  const pts = [randomUUID(), randomUUID(), randomUUID()];
  for (const p of pts) registerAccount(p, 'PT');
  const ids: string[] = [];
  for (const p of pts) {
    const r = await call('POST', `/owner/gyms/${o.gym.id}/trainers`, o.tok, { ptId: p });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.push(r.body.data.id);
  }
  const toks = pts.map((p) => token(p, 'PT'));
  for (const body of [{ action: 'BOGUS' }, {}, { accept: 'yes' }, { action: 7 }]) {
    const r = await call('PATCH', `/pt/gym-invitations/${ids[0]}`, toks[0], body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'INVALID_RESPONSE');
  }
  assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'PENDING');
  assert.equal((await call('PATCH', `/pt/gym-invitations/${ids[0]}`, toks[0], { accept: true })).status, 200);
  assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'ACTIVE');
  assert.equal((await call('PATCH', `/pt/gym-invitations/${ids[1]}`, toks[1], { action: 'ACCEPT' })).status, 200);
  assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: ids[1] } })).status, 'ACTIVE');
  assert.equal((await call('PATCH', `/pt/gym-invitations/${ids[2]}`, toks[2], { accept: false })).status, 200);
  assert.equal((await prisma.gymTrainerAffiliation.findUniqueOrThrow({ where: { id: ids[2] } })).status, 'REJECTED');
});

// ── N13E-01: branch phone ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('N13E-01: the branch phone is validated on the owner PATCH, the admin PATCH and the application branch schema ("abc" / "12" / "<script>" refused, a clear stays valid)', { skip }, async () => {
  const o = await operationalOwner();
  for (const bad of ['abc', '12', '<script>', '+++-----']) {
    const r = await call('PATCH', `/owner/gyms/${o.gym.id}`, o.tok, { phone: bad });
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR', bad);
    assert.match(r.body.error.message, /Số điện thoại không hợp lệ/);
    assert.equal(applicationBranchSchema.safeParse({ phone: bad }).success, false, `application branch ${bad}`);
    assert.equal(gymCreateSchema.safeParse({ name: 'Phòng tập A', address: '12 Lê Lợi, Quận 1', phone: bad }).success, false, `create ${bad}`);
    assert.equal(gymUpdateSchema.safeParse({ phone: bad }).success, false, `update ${bad}`);
    assert.equal(gymAdminUpdateSchema.safeParse({ phone: bad }).success, false, `admin ${bad}`);
  }
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: o.gym.id } })).phone, null, 'nothing stored');
  const good = await call('PATCH', `/owner/gyms/${o.gym.id}`, o.tok, { phone: '0901 234 567' });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: o.gym.id } })).phone, '0901 234 567');
  assert.equal(applicationBranchSchema.safeParse({ phone: '+84 901 234 567' }).success, true);
  const cleared = await call('PATCH', `/owner/gyms/${o.gym.id}`, o.tok, { phone: '' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
});

// ── N13E-05: photos of a temporarily closed branch ───────────────────────────────────────────────────────────────────────────────────────────────

test('N13E-05 + N15C-06: a PUBLISHED photo of an APPROVED TEMPORARILY_CLOSED branch is served to everyone (owner, manager, admin AND anonymous / customer / other partner / receptionist); a STAGED photo never; PERMANENTLY_CLOSED stays hidden', { skip }, async () => {
  const o = await operationalOwner();
  const other = await operationalOwner();
  const photoDir = path.resolve(process.cwd(), 'uploads/gym-photos');
  fs.mkdirSync(photoDir, { recursive: true });
  const mkPhoto = async (gymId: string) => {
    const fileName = `fix-${randomUUID()}.jpg`;
    fs.writeFileSync(path.join(photoDir, fileName), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]));
    createdPhotoFiles.push(path.join(photoDir, fileName));
    return prisma.gymPhoto.create({ data: { gymId, fileName, status: 'PUBLISHED' } });
  };
  const staff = async (role: 'MANAGER' | 'RECEPTIONIST', scoped: string[]) => {
    const id = randomUUID();
    registerAccount(id, 'GYM_OWNER');
    await prisma.gymPartnerAccount.create({ data: { partnerId: o.partner.id, userId: id, role, scopedGymIds: scoped, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
    return token(id, 'GYM_OWNER');
  };
  const scopedManager = await staff('MANAGER', [o.gym.id]);
  const unscopedManager = await staff('MANAGER', [randomUUID()]);
  const receptionist = await staff('RECEPTIONIST', [o.gym.id]);
  const customer = token(randomUUID(), 'CUSTOMER');
  const admin = newAdmin();

  const photo = await mkPhoto(o.gym.id);
  const url = `/media/gym-photos/${photo.id}`;
  assert.equal((await call('GET', url, null)).status, 200, 'OPEN: public as before');

  await prisma.gym.update({ where: { id: o.gym.id }, data: { operationalStatus: 'TEMPORARILY_CLOSED' } });
  const status = async (tok: string | null) => (await call('GET', url, tok)).status;
  // N15C-06 (15/11): an APPROVED but TEMPORARILY_CLOSED branch is still a real gym and its direct-link page is reachable -> its PUBLISHED photos are public too.
  assert.equal(await status(null), 200, 'anonymous');
  assert.equal(await status(customer), 200, 'customer');
  assert.equal(await status(other.tok), 200, 'another partner owner');
  assert.equal(await status(unscopedManager), 200, 'manager of other branches');
  assert.equal(await status(receptionist), 200, 'receptionist');
  assert.equal(await status(o.tok), 200, 'owner');
  assert.equal(await status(scopedManager), 200, 'scoped manager');
  assert.equal(await status(admin.tok), 200, 'admin');
  // the legacy URL follows the same rule
  const legacy = `/uploads/gym-photos/${photo.fileName}`;
  assert.equal((await call('GET', legacy, null)).status, 200, 'legacy URL: public as well');
  assert.equal((await call('GET', legacy, o.tok)).status, 200);
  // a STAGED / RETIRED photo is never served, not even to the owner
  const staged = await prisma.gymPhoto.create({ data: { gymId: o.gym.id, fileName: photo.fileName, status: 'STAGED' } });
  assert.equal((await call('GET', `/media/gym-photos/${staged.id}`, null)).status, 404, 'STAGED never public');
  assert.equal((await call('GET', `/media/gym-photos/${staged.id}`, o.tok)).status, 404);

  await prisma.gym.update({ where: { id: o.gym.id }, data: { operationalStatus: 'PERMANENTLY_CLOSED' } });
  assert.equal(await status(o.tok), 404, 'permanently closed stays hidden even for the owner');
  assert.equal(await status(null), 404, 'permanently closed: anonymous');
});

// ── N13E-09: complaint photo bytes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('N13E-09: a complaint photo is judged by its real bytes - HTML (or a PNG) named .jpg is refused 400 and not kept; real JPEG / PNG / WEBP are accepted', { skip }, async () => {
  const userId = randomUUID();
  const tok = token(userId, 'CUSTOMER');
  const upload = async (bytes: Buffer, name: string, type: string) => {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(bytes)], { type }), name);
    const base = await startApp();
    const res = await fetch(`${base}/complaint-photos`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: form });
    return { status: res.status, body: (await res.json()) as any };
  };
  const dir = path.resolve(process.cwd(), 'uploads/complaint-photos');
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${userId}-`)).length : 0;
  const html = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg', 'image/jpeg');
  assert.equal(html.status, 400);
  assert.equal(html.body.error.code, 'INVALID_IMAGE_CONTENT');
  const png = await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'x.jpg', 'image/jpeg');
  assert.equal(png.status, 400, 'PNG bytes under a .jpg name');
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith(`${userId}-`)).length, before, 'the refused files are not kept');
  const jpg = await upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]), 'a.jpg', 'image/jpeg');
  assert.equal(jpg.status, 201, JSON.stringify(jpg.body));
  const pngOk = await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'b.png', 'image/png');
  assert.equal(pngOk.status, 201);
  const webp = await upload(Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0]), 'c.webp', 'image/webp');
  assert.equal(webp.status, 201);
  for (const r of [jpg, pngOk, webp]) createdPhotoFiles.push(path.join(dir, r.body.data.token));
});

// ── N13E-10: admin PATCH gym status ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('N13E-10: admin PATCH /admin/gyms/:id/status with an unknown / missing status is 400 (not 500) and changes nothing; a valid one still works', { skip }, async () => {
  const o = await operationalOwner();
  const admin = newAdmin();
  for (const body of [{ status: 'BOGUS' }, {}, { status: 5 }, { status: 'DRAFT' }]) {
    const r = await call('PATCH', `/admin/gyms/${o.gym.id}/status`, admin.tok, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'INVALID_STATUS');
  }
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: o.gym.id } })).status, 'APPROVED');
  const ok = await call('PATCH', `/admin/gyms/${o.gym.id}/status`, admin.tok, { status: 'SUSPENDED' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: o.gym.id } })).status, 'SUSPENDED');
});

void usable;
void identities;
