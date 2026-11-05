import { Prisma } from '../../generated/prisma';
import { prisma } from '../../repositories/prisma';
import { authClient } from '../../clients/auth.client';
import { userClient } from '../../clients/user.client';
import { contentHashOf } from './canonical';
import { caseError, forbiddenRole, notFoundCase, notInvestigator, versionConflict } from './errors';
import { gymCaseEnabled } from './flags';
import {
  INVESTIGATION_STATUSES,
  PARTY_SUBMIT_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  canTransitionManually,
  changeAcknowledged,
  checkApprover,
  closureOf,
  deriveFinancialView,
  diffAgainstSnapshot,
  evidenceVisibleTo,
  hasMoneyExit,
  isRefundOutcome,
  memberFinancialView,
  memberProgressLabel,
  outcomeFor,
  outcomeLabelVi,
  statementVisibleTo,
  viewerKind,
  appealWindow,
  unusedValueAt,
  slaOf,
  verificationLabelVi,
  verificationOf,
  type CaseClass,
  type CaseStatus,
  type FindingKind,
  type Outcome,
  type PaymentObservation,
  type SnapshotEntry,
} from './rules';

/**
 * GYM COMPLAINT CASE (Dispute V2.1 Slice 3) - the investigation / decision workflow on top of GymComplaint (docs/DISPUTE_CASE_DESIGN_V2_1.md).
 *
 * This file RECORDS and DECIDES; the only thing that EXECUTES is execution.service.ts (the money exit stays membershipService.refundByAdmin).
 * Concurrency: every mutation takes SELECT ... FOR UPDATE on the case row, still changes status through a compare-and-swap on (id, version, status) and
 * writes its GymCaseEvent in the SAME transaction. Identity is a parameter (`Actor`, the verified token) - nothing here reads a user id from a body.
 * Every WRITE is refused (409 GYM_CASE_DISABLED) unless the fail-closed flag is effective (flags.ts).
 */
export interface Actor {
  id: string;
  role: string;
}

export type Tx = Prisma.TransactionClient;
export type Db = Tx | typeof prisma;
export type CaseRow = Prisma.GymComplaintCaseGetPayload<{}>;

export const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const requireUuid = (id: string) => {
  if (!UUID_RE.test(id)) throw notFoundCase();
};
export const assertAdmin = (a: Actor) => {
  if (a.role !== 'ADMIN') throw forbiddenRole();
};
export const assertEnabled = () => {
  if (!gymCaseEnabled()) {
    throw caseError(409, 'GYM_CASE_DISABLED', 'Lớp hồ sơ khiếu nại phòng gym đang tắt (chỉ bật được trong môi trường kiểm thử cô lập)');
  }
};
export const assertInvestigator = (a: Actor, c: CaseRow) => {
  assertAdmin(a);
  if (!c.investigatorId || c.investigatorId !== a.id) throw notInvestigator();
};
export const stateNotAllowed = (c: { status: string }, allowed: readonly string[]) =>
  caseError(409, 'CASE_STATE_NOT_ALLOWED', 'Trạng thái hiện tại của hồ sơ không cho phép thao tác này', { status: c.status, allowed });

/** Party check that needs the gym's owner: an admin who IS the reporter or the owner of the gym cannot work on / decide the case. */
/**
 * Q31: every user with a REAL staff / owner relation to the gym, read from the actual schema: Gym.ownerId, the gym's brand owner (GymBrand.ownerId),
 * and every GymPartnerAccount (OWNER / MANAGER / RECEPTIONIST / ACCOUNTANT, any status except REVOKED) of the partner that owns the brand or whose
 * owner account is the gym's owner. Brand-level on purpose: a MANAGER scoped to another branch of the same brand is still "linked to the brand".
 */
export async function gymLinkedUserIds(db: Db, gymId: string): Promise<string[]> {
  const gym = await db.gym.findUnique({ where: { id: gymId }, select: { ownerId: true, brandId: true } });
  if (!gym) return [];
  const ids = new Set<string>();
  if (gym.ownerId) ids.add(gym.ownerId);
  if (gym.brandId) {
    const brand = await db.gymBrand.findUnique({ where: { id: gym.brandId }, select: { ownerId: true } });
    if (brand?.ownerId) ids.add(brand.ownerId);
  }
  const partnerIds = new Set<string>();
  if (gym.brandId) for (const p of await db.gymPartner.findMany({ where: { brandId: gym.brandId }, select: { id: true } })) partnerIds.add(p.id);
  for (const a of await db.gymPartnerAccount.findMany({ where: { userId: gym.ownerId }, select: { partnerId: true } })) partnerIds.add(a.partnerId);
  if (partnerIds.size) {
    const accounts = await db.gymPartnerAccount.findMany({ where: { partnerId: { in: [...partnerIds] }, status: { not: 'REVOKED' } }, select: { userId: true } });
    for (const a of accounts) ids.add(a.userId);
  }
  return [...ids];
}

async function partyIds(db: Db, c: { gymId: string; reporterUserId: string }) {
  const gym = await db.gym.findUnique({ where: { id: c.gymId }, select: { ownerId: true } });
  return { reporterUserId: c.reporterUserId, gymOwnerId: gym?.ownerId ?? null, linkedUserIds: await gymLinkedUserIds(db, c.gymId) };
}
export async function assertNotParty(db: Db, c: { gymId: string; reporterUserId: string }, userId: string) {
  const p = await partyIds(db, c);
  if (userId === p.reporterUserId || (p.gymOwnerId && userId === p.gymOwnerId) || p.linkedUserIds.includes(userId)) {
    throw caseError(403, 'CONFLICT_OF_INTEREST', 'Quản trị viên là một bên của vụ việc nên không được tham gia xử lý');
  }
}

/** F7 + investigator rule: the target must be a REAL, ACTIVE admin according to auth-service (fail closed: unreachable = 503, never "assume admin"). */
export async function assertRealAdmin(userId: string, selfActor?: Actor): Promise<void> {
  if (selfActor && selfActor.id === userId && selfActor.role === 'ADMIN') return; // the verified token already says so
  let user: { role: string; isActive: boolean } | null = null;
  try {
    user = await authClient.getUser(userId);
  } catch (e: any) {
    if (e?.response?.status === 404) throw caseError(400, 'ADMIN_NOT_FOUND', 'Không tìm thấy quản trị viên này');
    throw caseError(503, 'AUTH_UNAVAILABLE', 'Chưa kiểm tra được tài khoản quản trị viên (dịch vụ xác thực không phản hồi). Vui lòng thử lại sau');
  }
  if (!user) throw caseError(400, 'ADMIN_NOT_FOUND', 'Không tìm thấy quản trị viên này');
  if (user.role !== 'ADMIN' || user.isActive === false) throw caseError(400, 'NOT_AN_ADMIN', 'Người được chọn không phải là quản trị viên đang hoạt động');
}

function summary(c: CaseRow) {
  return {
    id: c.id,
    complaintId: c.complaintId,
    gymId: c.gymId,
    membershipId: c.membershipId,
    caseClass: c.caseClass,
    status: c.status,
    execStatus: c.execStatus,
    escalated: c.escalated,
    investigatorId: c.investigatorId,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ── Mutation wrapper: lock, CAS, event, idempotency ──────────────────────────────────────────────────────────────────

export interface Ctx {
  tx: Tx;
  actor: Actor;
  transitions: Array<{ from: CaseStatus; to: CaseStatus; note?: string }>;
}
interface Outcome_<T> {
  caseId: string;
  result: T;
  note?: string;
  detail?: unknown;
}

export async function lockCase(tx: Tx, caseId: string): Promise<CaseRow> {
  requireUuid(caseId);
  await tx.$queryRaw`SELECT id FROM gym_complaint_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
  const c = await tx.gymComplaintCase.findUnique({ where: { id: caseId } });
  if (!c) throw notFoundCase();
  return c;
}

async function casStatus(ctx: Ctx, c: CaseRow, to: CaseStatus, note?: string): Promise<void> {
  if (!canTransition(c.status as CaseStatus, to)) throw stateNotAllowed(c, []);
  const r = await ctx.tx.gymComplaintCase.updateMany({
    where: { id: c.id, version: c.version, status: c.status },
    data: { status: to, version: { increment: 1 } },
  });
  if (r.count !== 1) throw versionConflict();
  ctx.transitions.push({ from: c.status as CaseStatus, to, note });
  c.status = to;
  c.version += 1;
}

async function casData(ctx: Ctx, c: CaseRow, data: Prisma.GymComplaintCaseUpdateManyMutationInput): Promise<void> {
  const r = await ctx.tx.gymComplaintCase.updateMany({ where: { id: c.id, version: c.version, status: c.status }, data: { ...data, version: { increment: 1 } } });
  if (r.count !== 1) throw versionConflict();
  c.version += 1;
}

const fullKey = (actor: Actor, action: string, scope: string, key?: string) => (key ? `${actor.id}:${action}:${scope}:${key}` : null);

async function findReplay<T>(key: string | null, requestHash: string): Promise<{ result: T; replayed: true } | null> {
  if (!key) return null;
  const prior = await prisma.gymCaseEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) {
    throw caseError(409, 'IDEMPOTENCY_KEY_REUSED', 'Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung');
  }
  return { result: p.result as T, replayed: true };
}

const isUniqueViolation = (e: unknown, target?: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && (!target || JSON.stringify(e.meta ?? {}).includes(target));

/** Exported for the execution service (same lock + CAS + event discipline). */
export async function mutate<T>(o: {
  actor: Actor;
  action: string;
  scope: string;
  idempotencyKey?: string;
  body: unknown;
  run: (ctx: Ctx) => Promise<Outcome_<T>>;
}): Promise<{ result: T; replayed: boolean }> {
  assertEnabled();
  const key = fullKey(o.actor, o.action, o.scope, o.idempotencyKey);
  const requestHash = contentHashOf(o.body ?? {});
  const prior = await findReplay<T>(key, requestHash);
  if (prior) return prior;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const ctx: Ctx = { tx, actor: o.actor, transitions: [] };
        const out = await o.run(ctx);
        if (ctx.transitions.length > 1) {
          for (const t of ctx.transitions) {
            await tx.gymCaseEvent.create({
              data: { caseId: out.caseId, actorUserId: o.actor.id, actorRole: o.actor.role, action: 'TRANSITION', fromStatus: t.from, toStatus: t.to, note: t.note ?? null },
            });
          }
        }
        const first = ctx.transitions[0];
        const last = ctx.transitions[ctx.transitions.length - 1];
        await tx.gymCaseEvent.create({
          data: {
            caseId: out.caseId,
            actorUserId: o.actor.id,
            actorRole: o.actor.role,
            action: o.action,
            fromStatus: first?.from ?? null,
            toStatus: last?.to ?? null,
            note: out.note ?? null,
            idempotencyKey: key,
            payload: toJson({ requestHash, result: out.result, detail: out.detail ?? null }),
          },
        });
        return { result: out.result, replayed: false };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (key && isUniqueViolation(e, 'idempotency_key')) {
      const again = await findReplay<T>(key, requestHash);
      if (again) return again;
    }
    throw e;
  }
}

// ── Evidence collection (server-observed, hashed) ────────────────────────────────────────────────────────────────

export interface EvidenceDraft {
  source: string;
  subject: string;
  provenanceType: 'SERVER_OBSERVED' | 'USER_REPORTED_STORED' | 'LEGACY_FIELD';
  eventAt: Date | null;
  sensitivity: 'NORMAL' | 'SENSITIVE';
  payload: unknown;
}
const draftHash = (d: EvidenceDraft) => contentHashOf(toJson(d.payload));
const slotKey = (source: string, subject: string) => `${source}\u0000${subject}`;

/** Everything the system can observe about a complaint. Read-only; the writer decides what is new. */
export async function collectSources(db: Db, c: { complaintId: string; gymId: string; membershipId: string | null }): Promise<EvidenceDraft[]> {
  const out: EvidenceDraft[] = [];
  const complaint = await db.gymComplaint.findUnique({ where: { id: c.complaintId } });
  if (complaint) {
    out.push({
      source: 'COMPLAINT_RECORD',
      subject: complaint.id,
      provenanceType: 'LEGACY_FIELD',
      eventAt: complaint.createdAt,
      sensitivity: 'NORMAL',
      payload: { complaintId: complaint.id, source: complaint.source, issueType: complaint.issueType, description: complaint.description, reporterUserId: complaint.reporterUserId, createdAt: complaint.createdAt },
    });
    for (const token of complaint.photoTokens) {
      // The hash covers the stored TOKEN RECORD (metadata). The private file's bytes are not read by this layer.
      out.push({ source: 'COMPLAINT_PHOTO', subject: token, provenanceType: 'USER_REPORTED_STORED', eventAt: complaint.createdAt, sensitivity: 'NORMAL', payload: { token, complaintId: complaint.id, hashCovers: 'TOKEN_RECORD_NOT_FILE_BYTES' } });
    }
  }
  const gym = await db.gym.findUnique({ where: { id: c.gymId }, select: { id: true, status: true, operationalStatus: true, closedAt: true, closureReason: true } });
  if (gym) {
    out.push({ source: 'GYM_RECORD', subject: gym.id, provenanceType: 'SERVER_OBSERVED', eventAt: null, sensitivity: 'NORMAL', payload: { gymId: gym.id, status: gym.status, operationalStatus: gym.operationalStatus, closedAt: gym.closedAt, closureReason: gym.closureReason } });
  }
  if (c.membershipId) {
    const m = await db.gymMembershipContract.findUnique({ where: { id: c.membershipId } });
    if (m) {
      out.push({
        source: 'MEMBERSHIP_RECORD',
        subject: m.id,
        provenanceType: 'SERVER_OBSERVED',
        eventAt: null,
        sensitivity: 'NORMAL',
        payload: {
          membershipId: m.id,
          gymId: m.gymId,
          clientId: m.clientId,
          status: m.status,
          paymentTxnId: m.paymentTxnId,
          startDate: m.startDate,
          endDate: m.endDate,
          priceAtPurchase: m.priceAtPurchase.toString(),
          durationDaysSnapshot: m.durationDaysSnapshot,
          totalVisits: m.totalVisits,
          usedVisits: m.usedVisits,
          payoutReleasedAt: m.payoutReleasedAt,
        },
      });
      const agg = await db.gymCheckIn.aggregate({ where: { membershipId: m.id }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } });
      out.push({ source: 'CHECKIN_SUMMARY', subject: m.id, provenanceType: 'SERVER_OBSERVED', eventAt: null, sensitivity: 'NORMAL', payload: { membershipId: m.id, count: agg._count._all, firstAt: agg._min.createdAt, lastAt: agg._max.createdAt } });
    }
  }
  return out;
}

async function insertEvidence(
  tx: Tx,
  c: { id: string; gymId: string },
  d: EvidenceDraft | (Omit<EvidenceDraft, 'provenanceType'> & { provenanceType: 'EXTERNAL_DOCUMENT' | 'ADMIN_RECEIVED_ON_BEHALF' }),
  o: { snapshotVersion?: number; supersedesId?: string | null; submittedBy?: string | null; submittedRole?: string | null } = {},
) {
  const payload = toJson(d.payload);
  return tx.gymCaseEvidence.create({
    data: {
      caseId: c.id,
      provenanceType: d.provenanceType,
      source: d.source,
      subject: d.subject,
      scopeGymId: c.gymId,
      eventAt: d.eventAt,
      submittedBy: o.submittedBy ?? null,
      submittedRole: o.submittedRole ?? null,
      snapshotVersion: o.snapshotVersion ?? 1,
      contentHash: contentHashOf(payload),
      payload,
      sensitivity: d.sensitivity,
      supersedesId: o.supersedesId ?? null,
    },
  });
}

export async function buildSnapshot(db: Db, caseId: string): Promise<SnapshotEntry[]> {
  const [ev, st] = await Promise.all([
    db.gymCaseEvidence.findMany({ where: { caseId }, select: { id: true, contentHash: true, snapshotVersion: true } }),
    db.gymCaseStatement.findMany({ where: { caseId }, select: { id: true, contentHash: true, version: true } }),
  ]);
  return [...ev.map((e) => ({ id: e.id, hash: e.contentHash, version: e.snapshotVersion })), ...st.map((s) => ({ id: s.id, hash: s.contentHash, version: s.version }))].sort((a, b) => a.id.localeCompare(b.id));
}

const statementHash = (s: { partyRole: string; version: number; text: string; supplementReason?: string | null }) =>
  contentHashOf({ partyRole: s.partyRole, version: s.version, text: s.text, supplementReason: s.supplementReason ?? null });

async function systemHeads(db: Db, caseId: string) {
  const rows = await db.gymCaseEvidence.findMany({ where: { caseId, submittedBy: null }, select: { id: true, source: true, subject: true, contentHash: true, snapshotVersion: true } });
  const heads = new Map<string, { id: string; hash: string; version: number }>();
  for (const r of rows) {
    const k = slotKey(r.source, r.subject);
    const cur = heads.get(k);
    if (!cur || r.snapshotVersion > cur.version) heads.set(k, { id: r.id, hash: r.contentHash, version: r.snapshotVersion });
  }
  return heads;
}

/** Evidence changed since a snapshot, or live data no longer matching what was stored (§1.6.4). Exported: the executor runs it again. */
export async function evidenceGuard(tx: Db, c: CaseRow, snapshot: SnapshotEntry[]) {
  const [ev, st] = await Promise.all([
    tx.gymCaseEvidence.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
    tx.gymCaseStatement.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
  ]);
  const heads = await systemHeads(tx, c.id);
  const staleLive: string[] = [];
  for (const d of await collectSources(tx, c)) {
    const head = heads.get(slotKey(d.source, d.subject));
    if (!head || head.hash !== draftHash(d)) staleLive.push(`${d.source}#${d.subject}`);
  }
  return diffAgainstSnapshot({
    snapshot,
    current: [...ev.map((e) => ({ id: e.id, hash: e.contentHash, createdAt: e.createdAt })), ...st.map((s) => ({ id: s.id, hash: s.contentHash, createdAt: s.createdAt }))],
    staleLive,
  });
}

export async function ackTimesOf(tx: Db, c: CaseRow): Promise<Date[]> {
  if (!c.investigatorId) return [];
  const rows = await tx.gymCaseEvent.findMany({ where: { caseId: c.id, action: 'EVIDENCE_CHANGE_ACK', actorUserId: c.investigatorId }, select: { createdAt: true } });
  return rows.map((r) => r.createdAt);
}

async function logAccess(db: Db, rows: Array<{ caseId: string; viewer: Actor; action: 'VIEW_CASE' | 'VIEW_EVIDENCE'; evidenceId?: string }>): Promise<void> {
  if (rows.length === 0) return;
  await db.gymCaseAccessLog.createMany({ data: rows.map((r) => ({ caseId: r.caseId, viewerUserId: r.viewer.id, viewerRole: r.viewer.role, evidenceId: r.evidenceId ?? null, action: r.action })) });
}

/** Best-effort notice to the member (never fails the action). Plain Vietnamese, no internal enum, never claims money unless the caller built the text from a confirmed view. */
export async function notifyParty(c: { id: string }, recipientUserId: string, role: 'MEMBER' | 'GYM', text: string, eventType: string, kind: string) {
  let delivered = false;
  try {
    delivered = await userClient.notifyUserChecked({ userId: recipientUserId, text, eventType, entityType: 'GYM_COMPLAINT_CASE', entityId: c.id });
  } catch {
    delivered = false;
  }
  try {
    // A1: the notice row is the proof a deadline / the appeal window is counted from: delivered=false never starts a clock.
    return await prisma.gymCaseNotice.create({ data: { caseId: c.id, kind, recipientUserId, recipientRole: role, delivered } });
  } catch {
    return null;
  }
}
export async function notifyMember(c: { id: string; reporterUserId: string }, text: string, eventType: string, kind = 'INFO') {
  return notifyParty(c, c.reporterUserId, 'MEMBER', text, eventType, kind);
}

// ── The service ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const complaintCaseService = {
  /**
   * Admin opens the case of a complaint. Idempotent per complaint (one case ever: UNIQUE complaint_id): an existing case is returned. MEM_* classes
   * need the membership the complaint is about; it must belong to the reporter AND to the complaint's gym. System evidence is collected in the same
   * transaction. The complaint moves OPEN -> IN_PROGRESS.
   */
  async openCase(actor: Actor, complaintId: string, b: { caseClass: CaseClass; membershipId?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    assertEnabled();
    const complaint = await prisma.gymComplaint.findUnique({ where: { id: complaintId } });
    if (!complaint) throw caseError(404, 'COMPLAINT_NOT_FOUND', 'Không tìm thấy khiếu nại');
    const existing = await prisma.gymComplaintCase.findUnique({ where: { complaintId } });
    if (existing) return { result: { ...summary(existing), existing: true }, replayed: true };
    if (complaint.status === 'RESOLVED') throw caseError(409, 'COMPLAINT_ALREADY_RESOLVED', 'Khiếu nại này đã được xử lý xong');
    if (!complaint.reporterUserId) {
      throw caseError(409, 'REPORTER_REQUIRED', 'Khiếu nại chưa có người phản ánh nên chưa mở được hồ sơ. Hãy gắn người phản ánh trước');
    }
    await assertNotParty(prisma, { gymId: complaint.gymId, reporterUserId: complaint.reporterUserId }, actor.id);

    if (b.caseClass === 'GYM_GENERAL' && b.membershipId) throw caseError(400, 'MEMBERSHIP_NOT_ALLOWED', 'Loại hồ sơ này không gắn với gói hội viên');
    if (hasMoneyExit(b.caseClass) && !b.membershipId) throw caseError(400, 'MEMBERSHIP_REQUIRED', 'Loại hồ sơ này cần chọn gói hội viên liên quan');
    if (b.membershipId) {
      const m = await prisma.gymMembershipContract.findUnique({ where: { id: b.membershipId }, select: { gymId: true, clientId: true } });
      if (!m) throw caseError(404, 'MEMBERSHIP_NOT_FOUND', 'Không tìm thấy gói hội viên');
      if (m.gymId !== complaint.gymId || m.clientId !== complaint.reporterUserId) {
        throw caseError(409, 'MEMBERSHIP_MISMATCH', 'Gói hội viên không thuộc người phản ánh hoặc không thuộc chi nhánh của khiếu nại');
      }
    }

    return mutate({
      actor,
      action: 'CASE_OPENED',
      scope: complaintId,
      idempotencyKey,
      body: { complaintId, ...b },
      run: async (ctx) => {
        // B1: the payout sweep decides "hold or release" under the same row lock, so a case cannot appear between its check and its release.
        if (b.membershipId) await ctx.tx.$queryRaw`SELECT id FROM gym_membership_contracts WHERE id = ${b.membershipId} FOR UPDATE`;
        let created;
        try {
          created = await ctx.tx.gymComplaintCase.create({
            data: {
              complaintId,
              gymId: complaint.gymId,
              membershipId: b.membershipId ?? null,
              reporterUserId: complaint.reporterUserId!,
              caseClass: b.caseClass,
              createdBy: actor.id,
            },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw caseError(409, 'CASE_ALREADY_OPEN', 'Khiếu nại này đã có hồ sơ, hoặc gói hội viên này đang có hồ sơ khác chưa kết thúc');
          throw e;
        }
        for (const d of await collectSources(ctx.tx, created)) await insertEvidence(ctx.tx, created, d, { snapshotVersion: 1 });
        // E1: for a class with a money exit, the refund amount is FIXED NOW as of the day the member filed the complaint, from the real membership row and its payment
        // (never from the request). Nothing is written when the membership was never paid / is not ACTIVE or EXPIRED: a refund outcome is then refused later.
        if (b.membershipId && hasMoneyExit(b.caseClass)) {
          const mem = await ctx.tx.gymMembershipContract.findUnique({ where: { id: b.membershipId } });
          if (mem && mem.paymentTxnId && (mem.status === 'ACTIVE' || mem.status === 'EXPIRED')) {
            const price = Number(mem.priceAtPurchase);
            await ctx.tx.gymCaseRefundQuote.create({
              data: {
                caseId: created.id,
                membershipId: mem.id,
                paymentTxnId: mem.paymentTxnId,
                quotedAt: complaint.createdAt,
                pricePaid: price,
                durationDays: mem.durationDaysSnapshot,
                startDate: mem.startDate,
                endDate: mem.endDate,
                amount: unusedValueAt(price, mem.durationDaysSnapshot, mem.endDate, complaint.createdAt),
                createdBy: actor.id,
              },
            });
          }
        }
        if (complaint.status === 'OPEN') await ctx.tx.gymComplaint.update({ where: { id: complaintId }, data: { status: 'IN_PROGRESS' } });
        return { caseId: created.id, result: { ...summary(created), existing: false }, note: `class ${b.caseClass}` };
      },
    }).then(async (r) => {
      if (!r.replayed) await notifyMember({ id: (r.result as any).id, reporterUserId: complaint.reporterUserId! }, 'Báo cáo vấn đề của bạn đã được tiếp nhận và đang được Gymini xem xét.', 'GYM_COMPLAINT_CASE_OPENED', 'OPENED');
      return r;
    });
  },

  /** Re-reads the live sources and appends a new snapshot version for every slot whose content changed. Never edits a stored row. */
  async recollect(actor: Actor, caseId: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'EVIDENCE_RECOLLECTED',
      scope: caseId,
      idempotencyKey,
      body: {},
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (TERMINAL_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, ['open']);
        const heads = await systemHeads(ctx.tx, c.id);
        const changed: string[] = [];
        for (const d of await collectSources(ctx.tx, c)) {
          const head = heads.get(slotKey(d.source, d.subject));
          if (head && head.hash === draftHash(d)) continue;
          await insertEvidence(ctx.tx, c, d, { snapshotVersion: (head?.version ?? 0) + 1, supersedesId: head?.id ?? null });
          changed.push(`${d.source}#${d.subject}`);
        }
        return { caseId: c.id, result: { changed }, note: changed.length ? `${changed.length} nguồn có thay đổi` : 'không có thay đổi' };
      },
    });
  },

  /** Gives the case an investigator (default: the caller) and moves INTAKE -> COLLECTING. The investigator must be a real admin and not a party. */
  async assign(actor: Actor, caseId: string, investigatorId: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    assertEnabled();
    const target = investigatorId ?? actor.id;
    await assertRealAdmin(target, actor);
    return mutate({
      actor,
      action: 'INVESTIGATOR_ASSIGNED',
      scope: caseId,
      idempotencyKey,
      body: { investigatorId: target },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (TERMINAL_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, ['open']);
        if (c.execStatus !== 'NOT_STARTED') throw stateNotAllowed(c, ['NOT_STARTED']);
        await assertNotParty(ctx.tx, c, target);
        await casData(ctx, c, { investigatorId: target });
        if (c.status === 'INTAKE') await casStatus(ctx, c, 'COLLECTING', 'giao điều tra viên');
        return { caseId: c.id, result: { investigatorId: target, status: c.status }, note: target };
      },
    });
  },

  async transition(actor: Actor, caseId: string, to: CaseStatus, o: { reason?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'STATUS_CHANGED',
      scope: caseId,
      idempotencyKey,
      body: { to, ...o },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (to === 'REJECTED_INTAKE' && c.status === 'INTAKE') {
          assertAdmin(actor);
          // C7: the hand-back to the legacy flow must not be a way round the conflict-of-interest rule: a person linked to the gym / brand (or the member) cannot dismiss the case.
          await assertNotParty(ctx.tx, c, actor.id);
          if (!o.reason) throw caseError(400, 'REASON_REQUIRED', 'Cần ghi lý do không tiếp nhận');
        } else {
          assertInvestigator(actor, c);
        }
        if (!canTransitionManually(c.status as CaseStatus, to)) throw stateNotAllowed(c, []);
        await casStatus(ctx, c, to, o.reason);
        if (to === 'REJECTED_INTAKE') {
          // The complaint goes back to the old flow (OPEN/IN_PROGRESS): a person resolves it there.
        }
        return { caseId: c.id, result: { status: c.status }, note: o.reason };
      },
    });
  },

  async requestMore(actor: Actor, caseId: string, to: 'COLLECTING' | 'AWAITING_PARTIES', note: string, idempotencyKey?: string, parties: Array<'MEMBER' | 'GYM'> = ['MEMBER']) {
    assertAdmin(actor);
    const r = await mutate({
      actor,
      action: 'MORE_INFO_REQUESTED',
      scope: caseId,
      idempotencyKey,
      body: { to, note, parties },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'FINDING_RECORDED'].includes(c.status)) throw stateNotAllowed(c, ['investigation']);
        if (c.status !== to) await casStatus(ctx, c, to, note);
        return { caseId: c.id, result: { status: c.status, reporterUserId: c.reporterUserId }, note };
      },
    });
    if (!r.replayed && to === 'AWAITING_PARTIES') {
      // A1: each asked party gets a notice; the 72h / 48h clock starts only from a DELIVERED one (deadlines.service.ts)
      const { startResponseDeadlines } = await import('./deadlines.service');
      await startResponseDeadlines(actor, caseId, parties);
    }
    return r;
  },

  async addClaim(actor: Actor, caseId: string, b: { claimantRole: 'MEMBER' | 'ADMIN_ON_BEHALF'; text: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'CLAIM_RECORDED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        const row = await ctx.tx.gymCaseClaim.create({ data: { caseId: c.id, claimantRole: b.claimantRole, text: b.text, createdBy: actor.id } });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  async addAssessment(
    actor: Actor,
    caseId: string,
    b: {
      claimId: string;
      directEvidenceIds: string[];
      indirectEvidenceIds: string[];
      rebuttalEvidenceIds: string[];
      relevanceNote: string;
      verifiabilityNote: string;
      consistencyNote: string;
      result: string;
      reasoning: string;
    },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'ASSESSMENT_RECORDED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== 'ASSESSING') throw stateNotAllowed(c, ['ASSESSING']);
        const claim = await ctx.tx.gymCaseClaim.findFirst({ where: { id: b.claimId, caseId: c.id }, select: { id: true } });
        if (!claim) throw caseError(404, 'CLAIM_NOT_FOUND', 'Không tìm thấy khẳng định trong hồ sơ này');
        const all = [...b.directEvidenceIds, ...b.indirectEvidenceIds, ...b.rebuttalEvidenceIds];
        if (new Set(all).size !== all.length) throw caseError(400, 'EVIDENCE_LISTED_TWICE', 'Một bằng chứng chỉ được xếp vào một nhóm (trực tiếp, gián tiếp hoặc phản bác)');
        if (all.length) {
          const [ev, st] = await Promise.all([
            ctx.tx.gymCaseEvidence.findMany({ where: { caseId: c.id, id: { in: all } }, select: { id: true } }),
            ctx.tx.gymCaseStatement.findMany({ where: { caseId: c.id, id: { in: all } }, select: { id: true } }),
          ]);
          if (ev.length + st.length !== all.length) throw caseError(404, 'EVIDENCE_NOT_FOUND', 'Có bằng chứng không thuộc hồ sơ này');
        }
        const row = await ctx.tx.gymCaseAssessment.create({
          data: {
            caseId: c.id,
            claimId: b.claimId,
            assessorId: actor.id,
            directEvidenceIds: b.directEvidenceIds,
            indirectEvidenceIds: b.indirectEvidenceIds,
            rebuttalEvidenceIds: b.rebuttalEvidenceIds,
            relevanceNote: b.relevanceNote,
            verifiabilityNote: b.verifiabilityNote,
            consistencyNote: b.consistencyNote,
            result: b.result as any,
            reasoning: b.reasoning,
            evidenceSnapshot: toJson(await buildSnapshot(ctx.tx, c.id)),
          },
        });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  /** Investigation completed = FINDING_RECORDED. Every claim must have an assessment. NOT_ESTABLISHED is a normal finding (it leads to "chưa đủ căn cứ"). */
  async recordFinding(actor: Actor, caseId: string, b: { finding: FindingKind; reasoning: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'FINDING_RECORDED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== 'ASSESSING') throw stateNotAllowed(c, ['ASSESSING']);
        const claims = await ctx.tx.gymCaseClaim.findMany({ where: { caseId: c.id }, select: { id: true } });
        const assessed = new Set((await ctx.tx.gymCaseAssessment.findMany({ where: { caseId: c.id }, select: { claimId: true } })).map((a) => a.claimId));
        const appeal = await ctx.tx.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
        if (appeal && appeal.status === 'REVIEWING') {
          const fresh = await ctx.tx.gymCaseAssessment.count({ where: { caseId: c.id, createdAt: { gte: appeal.assignedAt ?? appeal.filedAt } } });
          if (fresh === 0) throw caseError(409, 'APPEAL_ASSESSMENT_REQUIRED', 'Kháng nghị cần ít nhất một đánh giá mới của người xem xét lại trước khi ghi kết luận');
        }
        if (claims.length === 0 || claims.some((cl) => !assessed.has(cl.id))) {
          throw caseError(409, 'ASSESSMENT_REQUIRED', 'Cần có ít nhất một khẳng định và mỗi khẳng định phải được đánh giá trước khi ghi kết luận');
        }
        const previous = await ctx.tx.gymCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
        const row = await ctx.tx.gymCaseFinding.create({ data: { caseId: c.id, finding: b.finding, reasoning: b.reasoning, recordedBy: actor.id, supersedesId: previous?.id ?? null } });
        await casStatus(ctx, c, 'FINDING_RECORDED', b.reasoning);
        return { caseId: c.id, result: { id: row.id, finding: b.finding, caseStatus: c.status, outcome: outcomeFor(c.caseClass as CaseClass, b.finding), outcomeLabel: outcomeLabelVi(outcomeFor(c.caseClass as CaseClass, b.finding)) }, note: b.reasoning };
      },
    });
  },

  /**
   * Builds the proposal. The outcome is computed here from (case class, latest finding) - never read from the request, and no amount is accepted.
   * For a refund outcome the membership must still be refundable (ACTIVE, belongs to the reporter and the gym); otherwise no proposal is created.
   */
  async propose(actor: Actor, caseId: string, note: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate<Record<string, any>>({
      actor,
      action: 'PROPOSAL_CREATED',
      scope: caseId,
      idempotencyKey,
      body: { note: note ?? null },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        await assertNotParty(ctx.tx, c, actor.id); // Q31: a link created after the assignment still bars the proposer
        if (c.status !== 'FINDING_RECORDED') throw stateNotAllowed(c, ['FINDING_RECORDED']);
        const finding = await ctx.tx.gymCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        if (!finding) throw caseError(409, 'FINDING_REQUIRED', 'Chưa có kết luận để đề xuất');
        const outcome = outcomeFor(c.caseClass as CaseClass, finding.finding as FindingKind);
        if (isRefundOutcome(outcome)) await assertRefundable(ctx.tx, c);
        const proposal = await ctx.tx.gymCaseProposal.create({
          data: { caseId: c.id, findingId: finding.id, outcome, proposerId: actor.id, evidenceSnapshot: toJson(await buildSnapshot(ctx.tx, c.id)) },
        });
        await casStatus(ctx, c, 'AWAITING_APPROVAL', note);
        return { caseId: c.id, result: { id: proposal.id, outcome, outcomeLabel: outcomeLabelVi(outcome), caseStatus: c.status }, note };
      },
    });
  },

  async acknowledgeEvidenceChange(actor: Actor, caseId: string, note: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'EVIDENCE_CHANGE_ACK',
      scope: caseId,
      idempotencyKey,
      body: { note },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (TERMINAL_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, ['open']);
        return { caseId: c.id, result: { acknowledged: true }, note };
      },
    });
  },

  async share(actor: Actor, caseId: string, b: { evidenceId?: string; statementId?: string; reason: string; sharedWith?: 'MEMBER' | 'GYM' }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'SHARED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        if (b.evidenceId) {
          const e = await ctx.tx.gymCaseEvidence.findFirst({ where: { id: b.evidenceId, caseId: c.id } });
          if (!e) throw caseError(404, 'EVIDENCE_NOT_FOUND', 'Không tìm thấy bằng chứng trong hồ sơ này');
        } else {
          const s = await ctx.tx.gymCaseStatement.findFirst({ where: { id: b.statementId!, caseId: c.id } });
          if (!s) throw caseError(404, 'STATEMENT_NOT_FOUND', 'Không tìm thấy lời khai trong hồ sơ này');
        }
        // Only the member can receive a share; the Gym party is locked (D-NEW-9 open) and the database refuses it too.
        const row = await ctx.tx.gymCaseShare.create({ data: { caseId: c.id, evidenceId: b.evidenceId ?? null, statementId: b.statementId ?? null, sharedWithRole: b.sharedWith ?? 'MEMBER', sharedBy: actor.id, reason: b.reason } });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  /** Four eyes: the proposer can never approve; the approver is not the investigator, the member, or the gym's owner; conflict declaration mandatory. */
  async decide(
    actor: Actor,
    caseId: string,
    b: { result: 'APPROVED' | 'REJECTED'; reason: string; conflictOfInterestDeclaredNone: boolean; evidenceChangeAcknowledged: boolean },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: b.result === 'APPROVED' ? 'DECISION_APPROVED' : 'DECISION_REJECTED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.status !== 'AWAITING_APPROVAL') throw stateNotAllowed(c, ['AWAITING_APPROVAL']);
        const proposal = await ctx.tx.gymCaseProposal.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        if (!proposal) throw caseError(409, 'PROPOSAL_REQUIRED', 'Chưa có đề xuất để duyệt');
        const p = await partyIds(ctx.tx, c);
        const verdict = checkApprover({
          approverId: actor.id,
          approverRole: actor.role,
          proposerId: proposal.proposerId,
          investigatorId: c.investigatorId,
          reporterUserId: p.reporterUserId,
          gymOwnerId: p.gymOwnerId,
          linkedUserIds: p.linkedUserIds,
          conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
        });
        if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);

        if (b.result === 'APPROVED') {
          // Evidence-change guard, inside the SAME transaction as the CAS to DECISION_APPROVED (§1.6.4).
          const guard = await evidenceGuard(ctx.tx, c, proposal.evidenceSnapshot as unknown as SnapshotEntry[]);
          if (guard.changed) {
            const ack = await ackTimesOf(ctx.tx, c);
            if (!changeAcknowledged(guard, b.evidenceChangeAcknowledged, ack)) {
              throw caseError(409, 'EVIDENCE_CHANGED', 'Bằng chứng đã thay đổi sau khi đề xuất được lập. Điều tra viên cần thu thập lại/xác nhận thay đổi và người duyệt cần tích xác nhận trước khi duyệt', {
                changedIds: guard.newIds,
                staleLive: guard.staleLive,
                needsRecollect: guard.staleLive.length > 0,
              });
            }
          }
          await casStatus(ctx, c, 'DECISION_APPROVED', b.reason);
          // A1: the appeal's decision is a NEW decision: the execution axis restarts for it (the old BUSINESS_DONE row stays in the append-only history). Still never automatic: execute is explicit.
          const ap = await ctx.tx.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
          if (ap && ap.status === 'REVIEWING') {
            await ctx.tx.gymComplaintCase.updateMany({ where: { id: c.id }, data: { execStatus: 'NOT_STARTED', execDecisionId: null } });
            await ctx.tx.gymCaseAppeal.update({ where: { caseId: c.id }, data: { status: 'DECIDED' } });
          }
        } else {
          await casStatus(ctx, c, 'ASSESSING', b.reason);
        }
        const approval = await ctx.tx.gymCaseApproval.create({
          data: {
            proposalId: proposal.id,
            approverId: actor.id,
            result: b.result,
            reason: b.reason,
            conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
            evidenceChangeAcknowledged: b.evidenceChangeAcknowledged,
          },
        });
        return {
          caseId: c.id,
          result: {
            approvalId: approval.id,
            result: b.result,
            caseStatus: c.status,
            outcome: proposal.outcome,
            // An approval executes NOTHING: the money (if any) moves only through the explicit execute call, and only when the flag is effective.
            ...(b.result === 'APPROVED' ? { execution: 'NOT_STARTED' } : {}),
          },
          note: b.reason,
        };
      },
    });
  },

  // ── The member (reporter) ─────────────────────────────────────────────────────────────────────────────────────

  async submitStatement(actor: Actor, caseId: string, b: { text: string; supplementReason?: string }, idempotencyKey?: string) {
    return mutate({
      actor,
      action: 'STATEMENT_SUBMITTED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.reporterUserId !== actor.id) throw notFoundCase(); // a case the user is not the reporter of does not exist for them
        if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw caseError(409, 'CASE_NOT_ACCEPTING', 'Hồ sơ hiện không nhận thêm thông tin', { status: c.status });
        const written = await writeStatement(ctx.tx, c, 'MEMBER', actor.id, 'SUBMITTED', b);
        await ctx.tx.gymCaseDeadline.updateMany({ where: { caseId: c.id, partyRole: 'MEMBER', status: 'OPEN' }, data: { status: 'MET', resolvedAt: new Date() } });
        return { caseId: c.id, result: written };
      },
    });
  },

  async submitEvidence(actor: Actor, caseId: string, b: { description: string; sha256: string; title?: string; fileName?: string }, idempotencyKey?: string) {
    return mutate({
      actor,
      action: 'EVIDENCE_SUBMITTED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.reporterUserId !== actor.id) throw notFoundCase();
        if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw caseError(409, 'CASE_NOT_ACCEPTING', 'Hồ sơ hiện không nhận thêm thông tin', { status: c.status });
        const written = await writeEvidence(ctx.tx, c, actor, 'EXTERNAL_DOCUMENT', 'MEMBER', b);
        await ctx.tx.gymCaseDeadline.updateMany({ where: { caseId: c.id, partyRole: 'MEMBER', status: 'OPEN' }, data: { status: 'MET', resolvedAt: new Date() } });
        return { caseId: c.id, result: written };
      },
    });
  },

  // ── Admin on behalf of the member (provenance ADMIN_RECEIVED_ON_BEHALF) ─────────────────────────────────────

  async statementOnBehalf(actor: Actor, caseId: string, b: { text: string; supplementReason?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'STATEMENT_ON_BEHALF',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        return { caseId: c.id, result: await writeStatement(ctx.tx, c, 'ADMIN_ON_BEHALF', actor.id, 'ADMIN_RECEIVED_ON_BEHALF', b) };
      },
    });
  },

  async evidenceOnBehalf(actor: Actor, caseId: string, b: { description: string; sha256: string; title?: string; fileName?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: 'EVIDENCE_ON_BEHALF',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        return { caseId: c.id, result: await writeEvidence(ctx.tx, c, actor, 'ADMIN_RECEIVED_ON_BEHALF', 'ADMIN', b) };
      },
    });
  },

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async list(actor: Actor, q: { status?: string; limit: number; offset: number }) {
    assertAdmin(actor);
    const where = q.status ? { status: q.status as any } : {};
    const [rows, total] = await Promise.all([
      prisma.gymComplaintCase.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: q.limit, skip: q.offset, include: { complaint: { select: { issueType: true, source: true, status: true, description: true } } } }),
      prisma.gymComplaintCase.count({ where }),
    ]);
    await logAccess(prisma, rows.map((r) => ({ caseId: r.id, viewer: actor, action: 'VIEW_CASE' as const })));
    return {
      total,
      items: rows.map((r) => ({ ...summary(r), issueType: r.complaint.issueType, complaintStatus: r.complaint.status, descriptionPreview: r.complaint.description.slice(0, 160) })),
    };
  },

  async history(actor: Actor, caseId: string, q: { limit: number; offset: number }) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!c) throw notFoundCase();
    const [items, total] = await Promise.all([
      prisma.gymCaseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: q.limit, skip: q.offset }),
      prisma.gymCaseEvent.count({ where: { caseId } }),
    ]);
    return { total, items: items.map((e) => ({ id: e.id, action: e.action, actorUserId: e.actorUserId, actorRole: e.actorRole, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })) };
  },

  async getForAdmin(actor: Actor, caseId: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, include: { complaint: true } });
    if (!c) throw notFoundCase();
    const [claims, evidence, statements, shares, assessments, findings, proposals, executions, events, gym, membership] = await Promise.all([
      prisma.gymCaseClaim.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseShare.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseAssessment.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseFinding.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseProposal.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { approvals: { orderBy: { createdAt: 'asc' } } } }),
      prisma.gymCaseExecution.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
      prisma.gym.findUnique({ where: { id: c.gymId }, select: { id: true, name: true, ownerId: true, status: true, operationalStatus: true } }),
      c.membershipId ? prisma.gymMembershipContract.findUnique({ where: { id: c.membershipId } }) : Promise.resolve(null),
    ]);
    const approved = [...proposals].reverse().find((p) => p.approvals.some((a) => a.result === 'APPROVED')) ?? null;
    const outcome = (approved?.outcome ?? null) as Outcome | null;
    const financial = financialOf(c, outcome, executions);
    await logAccess(prisma, [{ caseId, viewer: actor, action: 'VIEW_CASE' }, ...evidence.map((e) => ({ caseId, viewer: actor, action: 'VIEW_EVIDENCE' as const, evidenceId: e.id }))]);
    const latestProposal = proposals[proposals.length - 1] ?? null;
    const unassessed = claims.filter((cl) => !assessments.some((a) => a.claimId === cl.id)).length;
    const allowedActions = computeAllowedActions(actor, c, {
      claims: claims.length,
      unassessed,
      hasFinding: findings.length > 0,
      hasProposal: !!latestProposal,
      latestProposerId: latestProposal?.proposerId ?? null,
      approvedOutcomeIsKnown: !!approved,
      lastExecState: executions[executions.length - 1]?.state ?? null,
      gymOwnerId: gym?.ownerId ?? null,
      linkedUserIds: await gymLinkedUserIds(prisma, c.gymId),
    });
    return {
      case: summary(c),
      complaint: { id: c.complaint.id, status: c.complaint.status, source: c.complaint.source, issueType: c.complaint.issueType, description: c.complaint.description, photoTokens: c.complaint.photoTokens, reporterUserId: c.complaint.reporterUserId, adminResponse: c.complaint.adminResponse, resolvedAt: c.complaint.resolvedAt },
      gym,
      membership: membership
        ? { id: membership.id, status: membership.status, startDate: membership.startDate, endDate: membership.endDate, priceAtPurchase: membership.priceAtPurchase.toString(), paymentTxnId: membership.paymentTxnId }
        : null,
      claims,
      evidence: evidence.map((e) => ({ ...e, partySubmitted: e.submittedBy !== null, provenanceLabel: provenanceLabelVi(e.provenanceType), verificationStatus: verificationOf(e.source), verificationLabel: verificationLabelVi(verificationOf(e.source)) })),
      refundQuote: await fixedRefundOf(prisma, caseId).then((q) => (q ? { amount: q.amount.toString(), pricePaid: q.pricePaid.toString(), quotedAt: q.quotedAt, durationDays: q.durationDays, startDate: q.startDate, endDate: q.endDate, paymentTxnId: q.paymentTxnId } : null)),
      sla: { ...slaOf(c.complaint.createdAt, new Date()), warnedAt: c.slaWarnedAt, overdueAt: c.slaOverdueAt },
      deadlines: await prisma.gymCaseDeadline.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } }),
      appeal: await adminAppealView(c),
      statements,
      shares,
      assessments,
      findings,
      proposals: proposals.map((p) => ({ ...p, outcomeLabel: outcomeLabelVi(p.outcome as Outcome) })),
      decision: approved ? { proposalId: approved.id, outcome: approved.outcome, outcomeLabel: outcomeLabelVi(approved.outcome as Outcome), approvalId: approved.approvals.find((a) => a.result === 'APPROVED')!.id } : null,
      execution: { status: c.execStatus, decisionId: c.execDecisionId, history: executions.map((x) => ({ id: x.id, state: x.state, attempt: x.attempt, blockedReason: x.blockedReason, note: x.note, createdAt: x.createdAt, actorUserId: x.actorUserId })) },
      financial,
      closure: closureOf(c.status as CaseStatus, c.execStatus, financial),
      allowedActions,
      events: events.map((e) => ({ id: e.id, action: e.action, actorUserId: e.actorUserId, actorRole: e.actorRole, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
    };
  },

  // ── Member reads ─────────────────────────────────────────────────────────────────────────────────────────────────

  async listForMember(actor: Actor) {
    const rows = await prisma.gymComplaintCase.findMany({ where: { reporterUserId: actor.id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 });
    await logAccess(prisma, rows.map((r) => ({ caseId: r.id, viewer: actor, action: 'VIEW_CASE' as const })));
    return { items: rows.map((r) => ({ id: r.id, complaintId: r.complaintId, progress: memberProgressLabel(r.status as CaseStatus, r.execStatus), createdAt: r.createdAt })) };
  },

  /** A case the user did not file does not exist for them (404, not 403). The Gym's own people see nothing (party locked). */
  async getForMember(actor: Actor, caseId: string) {
    requireUuid(caseId);
    const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, include: { complaint: true } });
    const kind = c ? viewerKind({ userId: actor.id, role: actor.role }, c) : 'NONE';
    if (!c || kind !== 'MEMBER') throw notFoundCase();
    const [evidenceAll, statementsAll, shares, proposals, executions] = await Promise.all([
      prisma.gymCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseShare.findMany({ where: { caseId } }),
      prisma.gymCaseProposal.findMany({ where: { caseId }, include: { approvals: true } }),
      prisma.gymCaseExecution.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const evidence = evidenceAll.filter((e) => evidenceVisibleTo(e, kind, actor.id, c.gymId, shares));
    const statements = statementsAll.filter((s) => statementVisibleTo(s, kind, actor.id, shares));
    const approved = [...proposals].reverse().find((p) => p.approvals.some((a) => a.result === 'APPROVED')) ?? null;
    const financial = financialOf(c, (approved?.outcome ?? null) as Outcome | null, executions);
    await logAccess(prisma, [{ caseId, viewer: actor, action: 'VIEW_CASE' }, ...evidence.map((e) => ({ caseId, viewer: actor, action: 'VIEW_EVIDENCE' as const, evidenceId: e.id }))]);
    const resolved = c.status === 'DECISION_APPROVED' && c.execStatus === 'BUSINESS_DONE';
    return {
      case: { id: c.id, complaintId: c.complaintId, progress: memberProgressLabel(c.status as CaseStatus, c.execStatus), createdAt: c.createdAt, canSubmit: PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus) },
      complaint: { issueType: c.complaint.issueType, description: c.complaint.description },
      evidence: evidence.map((e) => ({ id: e.id, source: e.source, subject: e.subject, capturedAt: e.capturedAt, snapshotVersion: e.snapshotVersion, payload: e.payload, mine: e.submittedBy === actor.id })),
      statements: statements.map((s) => ({ id: s.id, partyRole: s.partyRole, version: s.version, text: s.text, supplementReason: s.supplementReason, createdAt: s.createdAt, mine: s.authorUserId === actor.id })),
      // Only the member-safe money text: no internal group, no platform-side shortfall, "đã ghi vào ví" only when payment confirmed it.
      appeal: await memberAppealView(c),
      money: resolved ? memberFinancialView(financial) : null,
      resolution: resolved && approved ? { text: c.complaint.adminResponse } : null,
    };
  },
};

/** A1: the appeal as the admin screen needs it. */
async function adminAppealView(c: { id: string; status: string; execStatus: string }) {
  const appeal = await prisma.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
  if (!appeal) return null;
  const win = appealWindow(appeal.noticeAt, appeal.filedAt);
  return { id: appeal.id, status: appeal.status, filedBy: appeal.filedBy, reason: appeal.reason, filedAt: appeal.filedAt, noticeAt: appeal.noticeAt, windowClosedAt: win.closesAt, reviewerId: appeal.reviewerId, assignedAt: appeal.assignedAt, reviewedFindingId: appeal.reviewedFindingId };
}

/** A1: what the MEMBER may do about an appeal (no reviewer identity, no internal status). */
async function memberAppealView(c: { id: string; status: string; execStatus: string }) {
  const appeal = await prisma.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
  if (appeal) return { used: true, canFile: false, progress: appeal.status === 'DECIDED' ? 'Đã có kết quả kháng nghị' : 'Đang xem xét kháng nghị', filedAt: appeal.filedAt };
  const concluded = c.status === 'DECISION_APPROVED' && c.execStatus === 'BUSINESS_DONE';
  const notice = await prisma.gymCaseNotice.findFirst({ where: { caseId: c.id, kind: 'CONCLUSION', recipientRole: 'MEMBER', delivered: true }, orderBy: { createdAt: 'desc' } });
  const win = appealWindow(notice?.createdAt ?? null, new Date());
  return { used: false, canFile: concluded && win.open, closesAt: win.closesAt, progress: null as string | null, filedAt: null as Date | null };
}

function provenanceLabelVi(p: string): string {
  switch (p) {
    case 'SERVER_OBSERVED':
      return 'Hệ thống ghi nhận';
    case 'USER_REPORTED_STORED':
      return 'Người dùng cung cấp (chưa kiểm chứng)';
    case 'EXTERNAL_DOCUMENT':
      return 'Tài liệu bên ngoài (người dùng khai hash, chưa kiểm chứng)';
    case 'ADMIN_RECEIVED_ON_BEHALF':
      return 'Admin nhận hộ';
    default:
      return 'Trường cũ của khiếu nại';
  }
}

/** Refund outcomes need a membership that can still be refunded NOW (the executor asks refundByAdmin again at execution time). */
export async function assertRefundable(db: Db, c: { id: string; gymId: string; membershipId: string | null; reporterUserId: string }) {
  if (!c.membershipId) throw caseError(409, 'MEMBERSHIP_REQUIRED', 'Hồ sơ chưa gắn gói hội viên nên không đề xuất hoàn tiền được');
  const m = await db.gymMembershipContract.findUnique({ where: { id: c.membershipId } });
  if (!m) throw caseError(404, 'MEMBERSHIP_NOT_FOUND', 'Không tìm thấy gói hội viên');
  if (m.gymId !== c.gymId || m.clientId !== c.reporterUserId) throw caseError(409, 'MEMBERSHIP_MISMATCH', 'Gói hội viên không thuộc người phản ánh hoặc chi nhánh của hồ sơ');
  // E1: ACTIVE or EXPIRED (the term may end while the case runs); CANCELLED / anything else cannot be refunded again.
  if (m.status !== 'ACTIVE' && m.status !== 'EXPIRED') throw caseError(409, 'MEMBERSHIP_NOT_REFUNDABLE', 'Gói hội viên không còn ở trạng thái hoàn được', { status: m.status });
  if (!m.paymentTxnId) throw caseError(409, 'MEMBERSHIP_NOT_REFUNDABLE', 'Gói hội viên chưa có giao dịch thanh toán để hoàn');
  const quote = await db.gymCaseRefundQuote.findUnique({ where: { caseId: c.id } });
  if (!quote) throw caseError(409, 'REFUND_QUOTE_MISSING', 'Hồ sơ chưa chốt số tiền hoàn tại ngày khiếu nại nên không hoàn tiền được');
}

/** E1: the amount fixed for the case (written when it was opened). */
export async function fixedRefundOf(db: Db, caseId: string) {
  return db.gymCaseRefundQuote.findUnique({ where: { caseId } });
}

async function writeStatement(tx: Tx, c: CaseRow, partyRole: 'MEMBER' | 'ADMIN_ON_BEHALF', authorId: string, source: string, b: { text: string; supplementReason?: string }) {
  const last = await tx.gymCaseStatement.findFirst({ where: { caseId: c.id, partyRole }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;
  if (version > 1 && !b.supplementReason) throw caseError(400, 'SUPPLEMENT_REASON_REQUIRED', 'Lời khai bổ sung cần ghi lý do bổ sung');
  const row = await tx.gymCaseStatement.create({
    data: { caseId: c.id, partyRole, authorUserId: authorId, version, source, text: b.text, supplementReason: version > 1 ? b.supplementReason! : null, supersedesId: last?.id ?? null, contentHash: statementHash({ partyRole, version, text: b.text, supplementReason: b.supplementReason }) },
  });
  return { id: row.id, version };
}

async function writeEvidence(tx: Tx, c: CaseRow, actor: Actor, provenance: 'EXTERNAL_DOCUMENT' | 'ADMIN_RECEIVED_ON_BEHALF', role: string, b: { description: string; sha256: string; title?: string; fileName?: string }) {
  const sha = b.sha256.toLowerCase();
  const dup = await tx.gymCaseEvidence.findFirst({ where: { caseId: c.id, source: 'PARTY_DOCUMENT', subject: sha } });
  if (dup) throw caseError(409, 'EVIDENCE_DUPLICATE', 'Tài liệu có cùng mã sha256 đã được nộp trong hồ sơ này');
  const row = await insertEvidence(
    tx,
    c,
    { source: 'PARTY_DOCUMENT', subject: sha, provenanceType: provenance, eventAt: null, sensitivity: 'NORMAL', payload: { description: b.description, declaredSha256: sha, title: b.title ?? null, fileName: b.fileName ?? null, verification: 'DECLARED_NOT_VERIFIED' } },
    { submittedBy: actor.id, submittedRole: role },
  );
  return { id: row.id };
}

export function financialOf(
  c: { execStatus: string },
  outcome: Outcome | null,
  executions: Array<{ state: string; blockedReason: string | null; response: unknown; createdAt: Date }>,
) {
  const done = [...executions].reverse().find((x) => x.state === 'BUSINESS_DONE');
  const blocked = [...executions].reverse().find((x) => x.state === 'BLOCKED');
  const obs = (done?.response as { payment?: PaymentObservation } | null)?.payment ?? null;
  return deriveFinancialView({ outcome, execStatus: c.execStatus, observation: obs ? { ...obs, observedAt: obs.observedAt ?? done!.createdAt.toISOString() } : null, blockedReason: blocked?.blockedReason ?? null });
}

export interface AllowedAction {
  action: string;
  allowed: boolean;
  reason?: string;
}
function computeAllowedActions(
  actor: Actor,
  c: CaseRow,
  x: { claims: number; unassessed: number; hasFinding: boolean; hasProposal: boolean; latestProposerId: string | null; linkedUserIds: string[]; approvedOutcomeIsKnown: boolean; lastExecState: string | null; gymOwnerId: string | null },
): AllowedAction[] {
  const isInv = c.investigatorId === actor.id;
  const open = !TERMINAL_STATUSES.includes(c.status as CaseStatus);
  const st = c.status as CaseStatus;
  const flag = gymCaseEnabled();
  const A = (action: string, ok: boolean, reason?: string): AllowedAction => ({ action, allowed: flag && ok, ...(!(flag && ok) ? { reason: !flag ? 'GYM_CASE_DISABLED' : reason } : {}) });
  const party = actor.id === c.reporterUserId || actor.id === x.gymOwnerId || x.linkedUserIds.includes(actor.id);
  const needInv = (ok: boolean, why: string) => (isInv ? (ok ? undefined : why) : 'NOT_INVESTIGATOR');
  const list: AllowedAction[] = [];
  const push = (action: string, reason: string | undefined) => list.push(A(action, reason === undefined, reason));
  push('ASSIGN', !open ? 'CASE_CLOSED' : c.execStatus !== 'NOT_STARTED' ? 'EXECUTION_STARTED' : party ? 'CONFLICT_OF_INTEREST' : undefined);
  push('RECOLLECT_EVIDENCE', needInv(open, 'CASE_CLOSED'));
  push('ADD_CLAIM', needInv(INVESTIGATION_STATUSES.includes(st), 'STATE_NOT_ALLOWED'));
  push('ADD_STATEMENT_ON_BEHALF', needInv(INVESTIGATION_STATUSES.includes(st), 'STATE_NOT_ALLOWED'));
  push('ADD_EVIDENCE_ON_BEHALF', needInv(INVESTIGATION_STATUSES.includes(st), 'STATE_NOT_ALLOWED'));
  push('SHARE', needInv(INVESTIGATION_STATUSES.includes(st), 'STATE_NOT_ALLOWED'));
  push('REQUEST_MORE_INFO', needInv(['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'FINDING_RECORDED'].includes(st), 'STATE_NOT_ALLOWED'));
  push('ADD_ASSESSMENT', needInv(st === 'ASSESSING' && x.claims > 0, x.claims === 0 ? 'CLAIM_REQUIRED' : 'STATE_NOT_ALLOWED'));
  push('RECORD_FINDING', needInv(st === 'ASSESSING' && x.claims > 0 && x.unassessed === 0, x.unassessed > 0 ? 'ASSESSMENT_REQUIRED' : 'STATE_NOT_ALLOWED'));
  push('PROPOSE', needInv(st === 'FINDING_RECORDED' && x.hasFinding, 'STATE_NOT_ALLOWED'));
  push('ACK_EVIDENCE_CHANGE', needInv(open, 'CASE_CLOSED'));
  const canApprove = st === 'AWAITING_APPROVAL' && actor.role === 'ADMIN' && !isInv && actor.id !== x.latestProposerId && !party;
  const approveReason = st !== 'AWAITING_APPROVAL' ? 'STATE_NOT_ALLOWED' : actor.id === x.latestProposerId ? 'SELF_APPROVAL_FORBIDDEN' : isInv ? 'SELF_APPROVAL_FORBIDDEN' : party ? 'CONFLICT_OF_INTEREST' : undefined;
  push('APPROVE', canApprove ? undefined : approveReason ?? 'NOT_ALLOWED');
  push('REJECT', canApprove ? undefined : approveReason ?? 'NOT_ALLOWED');
  const execOk = st === 'DECISION_APPROVED' && ['NOT_STARTED', 'EXEC_BLOCKED'].includes(c.execStatus) && !party;
  push('EXECUTE', execOk ? undefined : st !== 'DECISION_APPROVED' ? 'DECISION_NOT_APPROVED' : party ? 'CONFLICT_OF_INTEREST' : c.execStatus === 'BUSINESS_DONE' ? 'ALREADY_EXECUTED' : 'EXECUTION_' + c.execStatus);
  push('RECONCILE_EXECUTION', c.execStatus === 'EXECUTING' ? undefined : 'NOTHING_TO_RECONCILE');
  push('ASSIGN_APPEAL_REVIEWER', st !== 'APPEAL_REVIEW' ? 'NO_APPEAL_WAITING' : party ? 'CONFLICT_OF_INTEREST' : undefined);
  return list;
}

export { casStatus, casData, logAccess, insertEvidence, summary };
