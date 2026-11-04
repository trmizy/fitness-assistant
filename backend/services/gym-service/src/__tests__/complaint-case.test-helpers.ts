/**
 * Fixtures for the gym complaint-case suites. TEST FIXTURE: gym / partner / brand / plan / membership rows are inserted directly, auth-service is a
 * token -> identity table (patched `authServiceClient.verifyToken` and `authClient.getUser`), notifications are captured instead of sent. The case
 * workflow itself (open -> assess -> finding -> proposal -> four-eyes -> execute) is the REAL service / HTTP code.
 */
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { authServiceClient } from '../clients/auth-service.client';
import { authClient } from '../clients/auth.client';
import { userClient } from '../clients/user.client';

export const usable = process.env.DB_ISOLATION === 'accepted';
export const skip: string | false = usable ? false : 'needs an accepted isolated *_test database (TEST_DATABASE_URL, see src/__tests__/setup/README.md)';

export function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

export const identities = new Map<string, { id: string; email: string; role: string }>();
/** auth-service's view of "who is a real active admin" (assertRealAdmin). `unreachable` makes the lookup fail like a dead auth-service. */
export const authDirectory = { users: new Map<string, { role: string; isActive: boolean }>(), unreachable: false };
/** A1: whether the (fake) user-service ACCEPTS a notification. false = the notice is recorded delivered=false and no response clock starts. */
export const notify = { delivers: true };
export const notices: Array<{ userId: string; text: string; eventType: string; entityId: string }> = [];

export function token(id: string, role = 'ADMIN') {
  const t = `tok-${id}`;
  identities.set(t, { id, email: `${id}@test.local`, role });
  if (role === 'ADMIN') authDirectory.users.set(id, { role: 'ADMIN', isActive: true });
  return t;
}
export const newAdmin = () => {
  const id = `admin-${randomUUID().slice(0, 8)}`;
  return { id, tok: token(id, 'ADMIN') };
};

const restores: Array<() => void> = [];
export function installStubs() {
  restores.push(
    patch(authServiceClient, 'verifyToken', async (header: string) => {
      const user = identities.get(String(header).replace(/^Bearer /, ''));
      if (!user) throw Object.assign(new Error('bad token'), { response: { status: 401 } });
      return { user };
    }),
    patch(authClient, 'getUser', async (userId: string) => {
      if (authDirectory.unreachable) throw new Error('auth-service unreachable');
      const u = authDirectory.users.get(userId);
      if (!u) throw Object.assign(new Error('404'), { response: { status: 404 } });
      return { id: userId, email: `${userId}@test.local`, firstName: 'T', lastName: 'T', ...u };
    }),
    patch(userClient, 'notifyUser', async (p: any) => {
      notices.push({ userId: p.userId, text: p.text, eventType: p.eventType, entityId: p.entityId });
    }),
    patch(userClient, 'notifyUserChecked', async (p: any) => {
      if (!notify.delivers) return false;
      notices.push({ userId: p.userId, text: p.text, eventType: p.eventType, entityId: p.entityId });
      return true;
    }),
  );
}
export function removeStubs() {
  while (restores.length) restores.pop()!();
}

export function setFlag(on: boolean | string | undefined) {
  process.env.NODE_ENV = 'test';
  if (on === undefined) delete process.env.GYM_COMPLAINT_CASE_ENABLED;
  else process.env.GYM_COMPLAINT_CASE_ENABLED = on === true ? 'true' : on === false ? 'false' : on;
}

// ── HTTP: the real gym-service app on an ephemeral port ──
let server: http.Server | null = null;
let baseUrl = '';
export async function startApp() {
  if (server) return baseUrl;
  const { default: app } = await import('../app');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  return baseUrl;
}
export async function stopApp() {
  if (!server) return;
  const s = server;
  server = null;
  (s as any).closeAllConnections?.();
  await new Promise((r) => s.close(r));
}
export async function call(method: string, path: string, tok: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

// ── Fixtures ──
const created = { gyms: [] as string[], brands: [] as string[], partners: [] as string[], plans: [] as string[], memberships: [] as string[], complaints: [] as string[] };

export async function makeGym(ownerId = `owner-${randomUUID().slice(0, 8)}`) {
  const partner = await prisma.gymPartner.create({ data: { legalName: `Case Partner ${randomUUID().slice(0, 8)}`, status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
  created.partners.push(partner.id);
  await prisma.gymPartnerAccount.create({ data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Case Brand', approvedName: 'Case Brand' } });
  created.brands.push(brand.id);
  await prisma.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
  const gym = await prisma.gym.create({ data: { ownerId, brandId: brand.id, name: 'Case Gym', address: '1 Test St', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'Case Gym', approvedAddress: '1 Test St' } });
  created.gyms.push(gym.id);
  return { gym, ownerId, brand, partner };
}

export async function makeMembership(gymId: string, clientId: string, o: Partial<{ status: string; price: number; days: number; paymentTxnId: string | null; startOffsetDays: number }> = {}) {
  const brandId = (await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).brandId!;
  const plan = await prisma.gymMembershipPlan.create({ data: { brandId, name: 'Case Plan', price: o.price ?? 300_000, durationDays: o.days ?? 30 } });
  created.plans.push(plan.id);
  const days = o.days ?? 30;
  const start = new Date(Date.now() - (o.startOffsetDays ?? 0) * 86_400_000);
  const m = await prisma.gymMembershipContract.create({
    data: {
      gymId,
      planId: plan.id,
      clientId,
      priceAtPurchase: o.price ?? 300_000,
      durationDaysSnapshot: days,
      status: (o.status ?? 'ACTIVE') as any,
      startDate: start,
      endDate: new Date(start.getTime() + days * 86_400_000),
      paymentTxnId: o.paymentTxnId === undefined ? `txn-${randomUUID().slice(0, 8)}` : o.paymentTxnId,
    },
  });
  created.memberships.push(m.id);
  return m;
}

export async function makeComplaint(gymId: string, reporterUserId: string | null, o: { issueType?: string; source?: string; description?: string; photoTokens?: string[] } = {}) {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const c = await prisma.gymComplaint.create({
    data: {
      gymId,
      partnerId: null,
      source: (o.source ?? 'MEMBER_REPORT') as any,
      issueType: (o.issueType ?? 'BILLING') as any,
      reporterUserId,
      description: o.description ?? 'Mô tả vấn đề của hội viên',
      photoTokens: o.photoTokens ?? [],
    },
  });
  created.complaints.push(c.id);
  void gym;
  return c;
}

export async function cleanup() {
  // append-only triggers fire on row-level UPDATE/DELETE only; TRUNCATE is the (test-only) way to clear them
  await prisma.$executeRawUnsafe(
    'TRUNCATE gym_case_notices, gym_case_deadlines, gym_case_appeals, gym_case_access_logs, gym_case_executions, gym_case_events, gym_case_approvals, gym_case_proposals, gym_case_findings, gym_case_assessments, gym_case_claims, gym_case_shares, gym_case_evidence, gym_case_statements, gym_complaint_cases CASCADE',
  );
  if (created.complaints.length) await prisma.gymComplaint.deleteMany({ where: { id: { in: created.complaints } } });
  if (created.gyms.length) await prisma.gymComplaint.deleteMany({ where: { gymId: { in: created.gyms } } });
  // memberships / plans may also have been created by the code under test (membershipService.purchase): clear by gym / brand, not only by id
  if (created.gyms.length) {
    await prisma.gymMembershipReferral.deleteMany({ where: { gymId: { in: created.gyms } } });
    await prisma.gymCheckIn.deleteMany({ where: { gymId: { in: created.gyms } } });
    await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: created.gyms } } });
  }
  if (created.memberships.length) await prisma.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
  if (created.brands.length) await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: created.brands } } });
  if (created.plans.length) await prisma.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  if (created.partners.length) await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } });
  for (const k of Object.keys(created) as Array<keyof typeof created>) created[k].length = 0;
  notices.length = 0;
  notify.delivers = true;
}

// ── Driving a case through the REAL HTTP endpoints ──
export interface Drive {
  complaintId: string;
  caseId: string;
  inv: { id: string; tok: string };
  appr: { id: string; tok: string };
  reporter: { id: string; tok: string };
  ownerId: string;
  gymId: string;
  membershipId: string | null;
}
const ok = (r: { status: number; body: any }, expected: number | number[], what: string) => {
  const exp = Array.isArray(expected) ? expected : [expected];
  if (!exp.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body?.data;
};

/** Opens a case and walks it to AWAITING_APPROVAL (proposal made). Returns what a test needs to decide / execute. */
export async function driveToProposal(o: { caseClass: string; finding: 'ESTABLISHED' | 'NOT_ESTABLISHED'; membership?: { status?: string; price?: number; days?: number; startOffsetDays?: number } | false; ownerId?: string }): Promise<Drive & { proposal: any }> {
  const { gym, ownerId } = await makeGym(o.ownerId);
  const reporterId = `member-${randomUUID().slice(0, 8)}`;
  const reporter = { id: reporterId, tok: token(reporterId, 'CUSTOMER') };
  const m = o.membership === false ? null : await makeMembership(gym.id, reporterId, o.membership ?? {});
  const complaint = await makeComplaint(gym.id, reporterId);
  const inv = newAdmin();
  const appr = newAdmin();
  const opened = ok(await call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass: o.caseClass, ...(m && o.caseClass !== 'GYM_GENERAL' ? { membershipId: m.id } : {}) }), 201, 'open');
  const caseId = opened.id as string;
  ok(await call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, {}), 200, 'assign');
  ok(await call('POST', `/admin/complaint-cases/${caseId}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'to ASSESSING');
  const claim = ok(await call('POST', `/admin/complaint-cases/${caseId}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'Hội viên khẳng định có vấn đề' }), 201, 'claim');
  const detail = ok(await call('GET', `/admin/complaint-cases/${caseId}`, inv.tok), 200, 'detail');
  const direct = detail.evidence.filter((e: any) => e.source === 'COMPLAINT_RECORD').map((e: any) => e.id);
  ok(
    await call('POST', `/admin/complaint-cases/${caseId}/assessments`, inv.tok, {
      claimId: claim.id,
      directEvidenceIds: direct,
      relevanceNote: 'Đúng người, đúng chi nhánh',
      verifiabilityNote: 'Nguồn hệ thống',
      consistencyNote: 'Nhất quán',
      result: o.finding === 'ESTABLISHED' ? 'ESTABLISHED' : 'NOT_ESTABLISHED',
      reasoning: 'Lý do đánh giá bằng lời',
    }),
    201,
    'assessment',
  );
  ok(await call('POST', `/admin/complaint-cases/${caseId}/finding`, inv.tok, { finding: o.finding, reasoning: 'Kết luận có lý do' }), 201, 'finding');
  const proposal = ok(await call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {}), 201, 'proposal');
  return { complaintId: complaint.id, caseId, inv, appr, reporter, ownerId, gymId: gym.id, membershipId: m?.id ?? null, proposal };
}

export async function approve(d: Drive, extra: Record<string, unknown> = {}) {
  return call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'APPROVED', reason: 'Đồng ý với đề xuất', conflictOfInterestDeclaredNone: true, ...extra });
}
export { ok };
