/**
 * A4 (05/11/2026) - REPLACING an approved Case decision that has had NO effect at all (design Q3 section 2). Nothing else can be replaced here.
 *
 * What it is: propose (admin A) -> approve (admin B != A, neither a party of the contract) | reject (admin B). While it is PENDING the executor answers 409 REPLACEMENT_PENDING.
 * Approving it sends the Case back to FINDING_RECORDED (CAS on the case version, under the case row lock) so the normal path - new proposal, four-eyes approval, D-NEW-12, execute - makes the NEW decision.
 * What it is NOT: it never updates or deletes the old approval (append-only; the old decision is only EXCLUDED from "the current decision" by the replacement row), never moves money, never touches
 * the session, the quota, a settlement row or the ledger. If ANY effect of the old decision is found - a session already ruled, a money step, a ledger operation under the session's keys, an execution
 * that is not BLOCKED, the case already EXECUTING / BUSINESS_DONE / NEEDS_HUMAN - it is refused 409 DECISION_HAS_EFFECT; if the ledger cannot be read it is refused 503 (fail-closed). Refusals write nothing.
 * Identity comes from the token only. Every mutation is gated by DISPUTE_CASE_DECISION_REPLACEMENT_ENABLED (fail-closed flag, OFF outside test). History: dispute_case_events (append-only).
 */
import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { paymentClient } from "../../clients/payment.client";
import { decisionReplacementEnabled } from "./flags";

export interface Actor {
  id: string;
  role: string;
}
type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

function err(status: number, code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { status, code, ...(details === undefined ? {} : { details }) });
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? {})).digest("hex");
const keyOf = (actor: Actor, action: string, scope: string, key?: string) => (key ? `${actor.id}:REPL:${action}:${scope}:${key}` : null);
const isUnique = (e: unknown, target: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta ?? {}).includes(target);

/** The ledger keys under which the money step of an executed decision would exist. */
const moneyKeys = (sessionId: string) => [`SESSION_RELEASE:${sessionId}`, `PT_NO_SHOW:${sessionId}`, `UNRESOLVED_SESSION:${sessionId}`];
const MONEY_KINDS = ["SESSION_RELEASE", "PT_NO_SHOW_COMPENSATION", "UNRESOLVED_SESSION_RESOLUTION"] as const;

function assertEnabled() {
  if (!decisionReplacementEnabled()) throw err(409, "DECISION_REPLACEMENT_DISABLED", "Chức năng thay thế quyết định đã duyệt đang tắt");
}
function assertAdmin(a: Actor) {
  if (a.role !== "ADMIN") throw err(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
}
const isParty = (userId: string, c: { clientUserId: string; ptUserId: string }) => userId === c.clientUserId || userId === c.ptUserId;

/** The decision the executor must use: the newest APPROVED approval of the case that has NOT been replaced by an approved replacement. */
export async function currentApprovalWhere(db: Db, caseId: string) {
  const replaced = (await db.disputeCaseDecisionReplacement.findMany({ where: { caseId, approvedAt: { not: null } }, select: { oldApprovalId: true } })).map((r) => r.oldApprovalId);
  return { result: "APPROVED" as const, proposal: { caseId }, ...(replaced.length ? { id: { notIn: replaced } } : {}) };
}

/** True while an undecided replacement exists for the case (read it under the case row lock to be ordered against an executor start). */
export async function hasPendingReplacement(db: Db, caseId: string): Promise<boolean> {
  return (await db.disputeCaseDecisionReplacement.count({ where: { caseId, approvedAt: null, rejectedAt: null } })) > 0;
}

// ── "no effect" checks ──────────────────────────────────────────────────────────────────────────────────────────────────────

type CaseRow = NonNullable<Awaited<ReturnType<typeof prisma.disputeCase.findUnique>>>;

/** DB-visible facts (callable inside the case-locked transaction). Throws 409 DECISION_HAS_EFFECT listing every effect found. */
export async function dbChecks(db: Db, c: CaseRow, approvalId: string) {
  const effects: string[] = [];
  if (c.status !== "DECISION_APPROVED") effects.push(`case status is ${c.status}`);
  if (c.execStatus !== "NOT_STARTED" && c.execStatus !== "EXEC_BLOCKED") effects.push(`case execution status is ${c.execStatus}`);
  if (c.execDecisionId && c.execDecisionId !== approvalId) effects.push("case is bound to another decision");
  const session = await db.session.findUnique({ where: { id: c.sessionId }, select: { status: true, resolvedBy: true, resolvedByCaseDecisionId: true, sessionDeducted: true, noShowQuotaBookedAt: true, contractId: true } });
  if (!session) effects.push("session not found");
  else {
    if (session.status !== "DISPUTED") effects.push(`session status is ${session.status}`);
    if (session.resolvedBy || session.resolvedByCaseDecisionId) effects.push("session already ruled");
    if (session.sessionDeducted) effects.push("session already deducted");
    if (session.noShowQuotaBookedAt) effects.push("no-show quota already booked");
  }
  const executions = await db.disputeCaseExecution.findMany({ where: { caseId: c.id }, select: { state: true } });
  const live = executions.filter((e) => e.state !== "BLOCKED");
  if (live.length > 0) effects.push(`${live.length} execution row(s) not BLOCKED`);
  const money = await db.sessionSettlement.count({ where: { sessionId: c.sessionId, kind: { in: [...MONEY_KINDS] } } });
  if (money > 0) effects.push(`${money} money settlement row(s) of the session`);
  const contract = await db.contract.findUnique({ where: { id: c.contractId }, select: { usedSessions: true, compensatedSessions: true } });
  if (effects.length) throw err(409, "DECISION_HAS_EFFECT", "Quyết định đã duyệt này đã có tác động (buổi, quyền buổi, tiền hoặc thực thi): không thay thế được. Chưa ghi gì", { effects });
  return {
    caseStatus: c.status,
    execStatus: c.execStatus,
    sessionStatus: session?.status ?? null,
    executionRows: executions.length,
    moneyRows: money,
    quota: { usedSessions: contract?.usedSessions ?? null, compensatedSessions: contract?.compensatedSessions ?? null },
  };
}

/** The ledger must hold NOTHING under the session's money keys. Unreadable = refuse (fail-closed). */
async function ledgerChecks(sessionId: string) {
  const found: string[] = [];
  for (const k of moneyKeys(sessionId)) {
    let rec: Awaited<ReturnType<typeof paymentClient.lookupLedgerOperation>>;
    try {
      rec = await paymentClient.lookupLedgerOperation(k);
    } catch {
      throw err(503, "LEDGER_UNAVAILABLE", "Không đọc được sổ cái để kiểm tra quyết định chưa có tác động tiền. Chưa ghi gì.");
    }
    if (rec) found.push(k);
  }
  if (found.length) throw err(409, "DECISION_HAS_EFFECT", "Sổ cái đã có thao tác tiền của buổi này: không thay thế được. Chưa ghi gì", { effects: found.map((k) => `ledger operation ${k}`) });
  return { ledgerKeysChecked: moneyKeys(sessionId), ledgerOperationsFound: 0 };
}

async function lockCase(tx: Tx, caseId: string): Promise<CaseRow> {
  await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
  return tx.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
}

async function findReplay<T>(key: string | null, requestHash: string): Promise<(T & { replayed: true }) | null> {
  if (!key) return null;
  const prior = await prisma.disputeCaseEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) throw err(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
  return { ...(p.result as T), replayed: true };
}

type Replacement = NonNullable<Awaited<ReturnType<typeof prisma.disputeCaseDecisionReplacement.findUnique>>>;
const statusOf = (r: Pick<Replacement, "approvedAt" | "rejectedAt">) => (r.rejectedAt ? "REJECTED" : r.approvedAt ? "APPROVED" : "PENDING");
const viewOf = (r: Replacement) => ({
  id: r.id,
  caseId: r.caseId,
  oldApprovalId: r.oldApprovalId,
  status: statusOf(r),
  proposedBy: r.proposedBy,
  reason: r.reason,
  createdAt: r.createdAt,
  approvedBy: r.approvedBy,
  approvedAt: r.approvedAt,
  approvalReason: r.approvalReason,
  rejectedBy: r.rejectedBy,
  rejectedAt: r.rejectedAt,
  rejectionReason: r.rejectionReason,
});

const UNIQUE_LIVE = "dcdr_one_live_per_case";

export const decisionReplacementService = {
  /** Read: the replacements of a case (newest first) with the checks that proved "no effect". Open even when the flag is off. */
  async list(actor: Actor, caseId: string) {
    assertAdmin(actor);
    if (!UUID_RE.test(caseId)) throw err(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { id: true, status: true, execStatus: true } });
    if (!c) throw err(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    const rows = await prisma.disputeCaseDecisionReplacement.findMany({ where: { caseId }, orderBy: { createdAt: "desc" } });
    return { caseStatus: c.status, execStatus: c.execStatus, items: rows.map((r) => ({ ...viewOf(r), checksAtProposal: r.checksAtProposal, checksAtApproval: r.checksAtApproval })) };
  },

  async propose(actor: Actor, caseId: string, b: { reason: string }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    if (!UUID_RE.test(caseId)) throw err(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    const fk = keyOf(actor, "PROPOSED", caseId, idempotencyKey);
    const requestHash = hashOf(b);
    const replay = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
    if (replay) return replay;
    const c0 = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c0) throw err(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    if (isParty(actor.id, c0)) throw err(403, "CONFLICT_OF_INTEREST", "Người đề xuất là một bên của hợp đồng nên không được thực hiện thao tác này");
    const approval = await prisma.disputeCaseApproval.findFirst({ where: await currentApprovalWhere(prisma, caseId), orderBy: { createdAt: "desc" } });
    if (!approval) throw err(409, "DECISION_NOT_APPROVED", "Hồ sơ chưa có quyết định đã duyệt để thay thế");
    const db0 = await dbChecks(prisma, c0, approval.id);
    const ledger0 = await ledgerChecks(c0.sessionId);
    try {
      return await prisma.$transaction(async (tx) => {
        const c = await lockCase(tx, caseId);
        const db = await dbChecks(tx, c, approval.id); // again, under the case row lock (ordered against an executor start)
        if (await hasPendingReplacement(tx, caseId)) throw err(409, "REPLACEMENT_PENDING", "Hồ sơ đã có một đề xuất thay thế đang chờ");
        const created = await tx.disputeCaseDecisionReplacement.create({
          data: { caseId, oldApprovalId: approval.id, sessionId: c.sessionId, contractId: c.contractId, clientUserId: c.clientUserId, ptUserId: c.ptUserId, proposedBy: actor.id, reason: b.reason, checksAtProposal: toJson({ ...db, ...ledger0, first: db0 }) },
        });
        const result = viewOf(created);
        await tx.disputeCaseEvent.create({
          data: {
            caseId,
            actorUserId: actor.id,
            actorRole: actor.role,
            action: "REPLACEMENT_PROPOSED",
            fromStatus: c.status,
            toStatus: c.status,
            note: b.reason,
            idempotencyKey: fk,
            payload: toJson({ requestHash, result, oldApprovalId: approval.id, moneyMoved: false }),
          },
        });
        return result;
      });
    } catch (e) {
      if (isUnique(e, UNIQUE_LIVE)) throw err(409, "REPLACEMENT_PENDING", "Hồ sơ đã có một đề xuất thay thế đang chờ");
      if (fk && isUnique(e, "idempotency_key")) {
        const again = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
        if (again) return again;
      }
      throw e;
    }
  },

  async approve(actor: Actor, caseId: string, replacementId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    const r0 = await loadReplacement(caseId, replacementId);
    if (isParty(actor.id, r0)) throw err(403, "CONFLICT_OF_INTEREST", "Người duyệt là một bên của hợp đồng nên không được thực hiện thao tác này");
    if (actor.id === r0.proposedBy) throw err(403, "SELF_APPROVAL_FORBIDDEN", "Người đề xuất không được tự duyệt đề xuất thay thế của mình");
    if (b.conflictOfInterestDeclaredNone !== true) throw err(403, "CONFLICT_OF_INTEREST", "Người duyệt phải khai báo không có xung đột lợi ích");
    const fk = keyOf(actor, "APPROVED", replacementId, idempotencyKey);
    const requestHash = hashOf(b);
    const prior = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
    if (prior) return prior;
    if (r0.approvedAt) {
      if (r0.approvedBy === actor.id) return { ...viewOf(r0), replayed: true };
      throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã được người khác duyệt");
    }
    if (r0.rejectedAt) throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã bị từ chối");
    const c0 = await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
    await dbChecks(prisma, c0, r0.oldApprovalId);
    const ledger = await ledgerChecks(c0.sessionId);
    try {
      return await prisma.$transaction(async (tx) => {
        const c = await lockCase(tx, caseId);
        const db = await dbChecks(tx, c, r0.oldApprovalId);
        const stamped = await tx.disputeCaseDecisionReplacement.updateMany({
          where: { id: replacementId, approvedAt: null, rejectedAt: null },
          data: { approvedBy: actor.id, approvedAt: new Date(), approvalReason: b.reason, checksAtApproval: toJson({ ...db, ...ledger }) },
        });
        if (stamped.count !== 1) throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã được quyết định");
        // CAS on the case: still the approved decision, nothing executed, same version -> back to FINDING_RECORDED for a NEW proposal. The old approval row is NOT touched.
        const moved = await tx.disputeCase.updateMany({
          where: { id: caseId, version: c.version, status: "DECISION_APPROVED", execStatus: { in: ["NOT_STARTED", "EXEC_BLOCKED"] } },
          data: { status: "FINDING_RECORDED", execStatus: "NOT_STARTED", execDecisionId: null, version: { increment: 1 } },
        });
        if (moved.count !== 1) throw err(409, "CASE_CHANGED", "Hồ sơ vừa thay đổi (có thể một lệnh thực thi vừa chạy): không thay thế được. Chưa ghi gì");
        const result = viewOf(await tx.disputeCaseDecisionReplacement.findUniqueOrThrow({ where: { id: replacementId } }));
        await tx.disputeCaseEvent.create({
          data: {
            caseId,
            actorUserId: actor.id,
            actorRole: actor.role,
            action: "REPLACEMENT_APPROVED",
            fromStatus: "DECISION_APPROVED",
            toStatus: "FINDING_RECORDED",
            note: b.reason,
            idempotencyKey: fk,
            payload: toJson({ requestHash, result, oldApprovalId: r0.oldApprovalId, proposedBy: r0.proposedBy, conflictOfInterestDeclaredNone: true, moneyMoved: false }),
          },
        });
        return result;
      });
    } catch (e) {
      if (fk && isUnique(e, "idempotency_key")) {
        const again = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
        if (again) return again;
      }
      throw e;
    }
  },

  async reject(actor: Actor, caseId: string, replacementId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    const r0 = await loadReplacement(caseId, replacementId);
    if (isParty(actor.id, r0)) throw err(403, "CONFLICT_OF_INTEREST", "Người từ chối là một bên của hợp đồng nên không được thực hiện thao tác này");
    if (actor.id === r0.proposedBy) throw err(403, "SELF_REJECT_FORBIDDEN", "Người đề xuất không được tự từ chối đề xuất của mình (cần người thứ hai)");
    if (b.conflictOfInterestDeclaredNone !== true) throw err(403, "CONFLICT_OF_INTEREST", "Người từ chối phải khai báo không có xung đột lợi ích");
    const fk = keyOf(actor, "REJECTED", replacementId, idempotencyKey);
    const requestHash = hashOf(b);
    const prior = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
    if (prior) return prior;
    if (r0.rejectedAt) {
      if (r0.rejectedBy === actor.id) return { ...viewOf(r0), replayed: true };
      throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã bị người khác từ chối");
    }
    if (r0.approvedAt) throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã được duyệt, không từ chối được");
    try {
      return await prisma.$transaction(async (tx) => {
        const c = await lockCase(tx, caseId);
        const stamped = await tx.disputeCaseDecisionReplacement.updateMany({
          where: { id: replacementId, approvedAt: null, rejectedAt: null },
          data: { rejectedBy: actor.id, rejectedAt: new Date(), rejectionReason: b.reason },
        });
        if (stamped.count !== 1) throw err(409, "REPLACEMENT_ALREADY_DECIDED", "Đề xuất thay thế này đã được quyết định");
        const result = viewOf(await tx.disputeCaseDecisionReplacement.findUniqueOrThrow({ where: { id: replacementId } }));
        await tx.disputeCaseEvent.create({
          data: {
            caseId,
            actorUserId: actor.id,
            actorRole: actor.role,
            action: "REPLACEMENT_REJECTED",
            fromStatus: c.status,
            toStatus: c.status,
            note: b.reason,
            idempotencyKey: fk,
            payload: toJson({ requestHash, result, oldApprovalId: r0.oldApprovalId, proposedBy: r0.proposedBy, conflictOfInterestDeclaredNone: true, moneyMoved: false }),
          },
        });
        return result;
      });
    } catch (e) {
      if (fk && isUnique(e, "idempotency_key")) {
        const again = await findReplay<ReturnType<typeof viewOf>>(fk, requestHash);
        if (again) return again;
      }
      throw e;
    }
  },
};

async function loadReplacement(caseId: string, replacementId: string): Promise<Replacement> {
  if (!UUID_RE.test(caseId) || !UUID_RE.test(replacementId)) throw err(404, "REPLACEMENT_NOT_FOUND", "Không tìm thấy đề xuất thay thế");
  const r = await prisma.disputeCaseDecisionReplacement.findUnique({ where: { id: replacementId } });
  if (!r || r.caseId !== caseId) throw err(404, "REPLACEMENT_NOT_FOUND", "Không tìm thấy đề xuất thay thế");
  return r;
}
