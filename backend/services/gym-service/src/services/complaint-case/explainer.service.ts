import { prisma } from '../../repositories/prisma';
import { caseError, notFoundCase } from './errors';
import { logAccess, lockCase, mutate, requireUuid, toJson, type Actor, type CaseRow } from './case.service';
import { canAccessGym } from '../partner-permissions';
import { gymCaseEnabled } from './flags';
import { PARTY_SUBMIT_STATUSES, evidenceVisibleTo, gymSafePayload, memberProgressLabel, statementVisibleTo, verificationLabelVi, verificationOf, viewerKind, type CaseStatus } from './rules';
import { contentHashOf } from './canonical';

/**
 * C10 (Ngài approved) - the GYM'S role in a gym case: PROVIDE EVIDENCE AND AN EXPLANATION, within ITS BRANCH SCOPE, and nothing else.
 *   who      an OWNER, or a MANAGER whose scoped branches include the gym, of the partner that owns the gym (gym.ownerId == the partner principal). Receptionists and
 *            accountants have no access. The scope comes from the partner context the owner router already resolved; the branch is re-checked on every call.
 *   sees     the complaint text it must answer, its own branch / membership / check-in records, what it submitted itself, and what an admin explicitly shared with it.
 *            Never the member's identity, documents or statements, never findings / proposals / approvals / money / the investigation.
 *   does     write an explanation (statement, role GYM) and attach evidence (declared hash, not verified). That is all.
 *   never    decide (no assess / finding / proposal / approval / execute / appeal / assign / share): there is no route for them, and GYM_CAN_DECIDE is false.
 * Writes go through the same fail-closed flag and the same lock / CAS / event / idempotency wrapper as every other write.
 */
export interface GymScope {
  principalUserId: string; // the partner owner's userId (== gym.ownerId of every branch of the partner)
  userId: string; // the person actually logged in (owner or manager)
  role: string; // OWNER | MANAGER | RECEPTIONIST | ACCOUNTANT
  scopedGymIds: string[];
}

const EXPLAINER_ROLES = ['OWNER', 'MANAGER'];

async function loadForGym(scope: GymScope, caseId: string): Promise<CaseRow & { complaint: { issueType: string; description: string } }> {
  requireUuid(caseId);
  const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, include: { complaint: { select: { issueType: true, description: true } } } });
  if (!c || !(await gymInScope(scope, c.gymId))) throw notFoundCase();
  return c as any;
}

export async function gymInScope(scope: GymScope, gymId: string): Promise<boolean> {
  if (!EXPLAINER_ROLES.includes(scope.role)) return false;
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { ownerId: true } });
  if (!gym || gym.ownerId !== scope.principalUserId) return false;
  return canAccessGym({ role: scope.role as any, scopedGymIds: scope.scopedGymIds }, gymId);
}

export const explainerService = {
  async list(scope: GymScope) {
    if (!EXPLAINER_ROLES.includes(scope.role)) return { items: [] };
    const gyms = await prisma.gym.findMany({ where: { ownerId: scope.principalUserId }, select: { id: true } });
    const ids = gyms.map((g) => g.id).filter((id) => canAccessGym({ role: scope.role as any, scopedGymIds: scope.scopedGymIds }, id));
    const rows = await prisma.gymComplaintCase.findMany({
      where: { gymId: { in: ids }, status: { not: 'REJECTED_INTAKE' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      include: { complaint: { select: { issueType: true } }, deadlines: { where: { status: 'OPEN', partyRole: 'GYM' }, select: { dueAt: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        gymId: r.gymId,
        issueType: r.complaint.issueType,
        progress: memberProgressLabel(r.status as CaseStatus, r.execStatus),
        canSubmit: gymCaseEnabled() && PARTY_SUBMIT_STATUSES.includes(r.status as CaseStatus),
        respondBy: r.deadlines[0]?.dueAt ?? null,
        createdAt: r.createdAt,
      })),
    };
  },

  async get(actor: Actor, scope: GymScope, caseId: string) {
    const c = await loadForGym(scope, caseId);
    const kind = viewerKind({ userId: actor.id, role: 'GYM_OWNER', gymIds: [c.gymId] }, { reporterUserId: c.reporterUserId, gymId: c.gymId });
    const [evidenceAll, statementsAll, shares, deadline] = await Promise.all([
      prisma.gymCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.gymCaseShare.findMany({ where: { caseId } }),
      prisma.gymCaseDeadline.findFirst({ where: { caseId, partyRole: 'GYM', status: 'OPEN' } }),
    ]);
    const evidence = evidenceAll.filter((e) => e.submittedRole === 'GYM' || evidenceVisibleTo(e, kind, actor.id, c.gymId, shares));
    // a branch teammate's submission counts as the Gym's own: visibility of "mine" is by gym role, not by the single login
    const gymAuthored = new Set(statementsAll.filter((s) => s.partyRole === 'GYM').map((s) => s.id));
    const statements = statementsAll.filter((s) => gymAuthored.has(s.id) || statementVisibleTo(s, kind, actor.id, shares));
    await logAccess(prisma, [{ caseId, viewer: actor, action: 'VIEW_CASE' }, ...evidence.map((e) => ({ caseId, viewer: actor, action: 'VIEW_EVIDENCE' as const, evidenceId: e.id }))]);
    return {
      case: { id: c.id, gymId: c.gymId, progress: memberProgressLabel(c.status as CaseStatus, c.execStatus), createdAt: c.createdAt, canSubmit: gymCaseEnabled() && PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus), respondBy: deadline?.dueAt ?? null },
      complaint: { issueType: c.complaint.issueType, description: c.complaint.description },
      evidence: evidence.map((e) => {
        const v = verificationOf(e.source);
        return { id: e.id, source: e.source, subject: e.source === 'COMPLAINT_PHOTO' ? '(ảnh)' : e.subject, capturedAt: e.capturedAt, payload: gymSafePayload(e.payload), verificationStatus: v, verificationLabel: verificationLabelVi(v), mine: e.submittedRole === 'GYM' };
      }),
      statements: statements.map((s) => ({ id: s.id, partyRole: s.partyRole, version: s.version, text: s.text, supplementReason: s.supplementReason, createdAt: s.createdAt, mine: s.partyRole === 'GYM' })),
    };
  },

  async explain(actor: Actor, scope: GymScope, caseId: string, b: { text: string; supplementReason?: string }, idempotencyKey?: string) {
    await loadForGym(scope, caseId); // 404 outside the branch scope, before anything is written
    return mutate({
      actor,
      action: 'GYM_EXPLANATION_SUBMITTED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (!(await gymInScope(scope, c.gymId))) throw notFoundCase();
        if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw caseError(409, 'CASE_NOT_ACCEPTING', 'Hồ sơ hiện không nhận thêm thông tin', { status: c.status });
        const last = await ctx.tx.gymCaseStatement.findFirst({ where: { caseId: c.id, partyRole: 'GYM' }, orderBy: { version: 'desc' } });
        const version = (last?.version ?? 0) + 1;
        if (version > 1 && !b.supplementReason) throw caseError(400, 'SUPPLEMENT_REASON_REQUIRED', 'Lời giải trình bổ sung cần ghi lý do bổ sung');
        const row = await ctx.tx.gymCaseStatement.create({
          data: { caseId: c.id, partyRole: 'GYM', authorUserId: actor.id, version, source: 'GYM_EXPLANATION', text: b.text, supplementReason: version > 1 ? b.supplementReason! : null, supersedesId: last?.id ?? null, contentHash: contentHashOf({ partyRole: 'GYM', version, text: b.text, supplementReason: b.supplementReason ?? null }) },
        });
        await ctx.tx.gymCaseDeadline.updateMany({ where: { caseId: c.id, partyRole: 'GYM', status: 'OPEN' }, data: { status: 'MET', resolvedAt: new Date() } });
        return { caseId: c.id, result: { id: row.id, version } };
      },
    });
  },

  async addEvidence(actor: Actor, scope: GymScope, caseId: string, b: { description: string; sha256: string; title?: string; fileName?: string }, idempotencyKey?: string) {
    await loadForGym(scope, caseId);
    return mutate({
      actor,
      action: 'GYM_EVIDENCE_SUBMITTED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (!(await gymInScope(scope, c.gymId))) throw notFoundCase();
        if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw caseError(409, 'CASE_NOT_ACCEPTING', 'Hồ sơ hiện không nhận thêm thông tin', { status: c.status });
        const sha = b.sha256.toLowerCase();
        if (await ctx.tx.gymCaseEvidence.findFirst({ where: { caseId: c.id, source: 'PARTY_DOCUMENT', subject: sha } })) throw caseError(409, 'EVIDENCE_DUPLICATE', 'Tài liệu có cùng mã sha256 đã được nộp trong hồ sơ này');
        const payload = toJson({ description: b.description, declaredSha256: sha, title: b.title ?? null, fileName: b.fileName ?? null, verification: 'DECLARED_NOT_VERIFIED' });
        const row = await ctx.tx.gymCaseEvidence.create({
          data: { caseId: c.id, provenanceType: 'EXTERNAL_DOCUMENT', source: 'PARTY_DOCUMENT', subject: sha, scopeGymId: c.gymId, submittedBy: actor.id, submittedRole: 'GYM', contentHash: contentHashOf(payload), payload, sensitivity: 'NORMAL' },
        });
        await ctx.tx.gymCaseDeadline.updateMany({ where: { caseId: c.id, partyRole: 'GYM', status: 'OPEN' }, data: { status: 'MET', resolvedAt: new Date() } });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },
};
