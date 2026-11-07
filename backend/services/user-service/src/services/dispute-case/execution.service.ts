import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma";
import { now as clockNow } from "./clock";
import { prisma } from "../../repositories/profile.repository";
import { resolveDisputeCore } from "../booking.service";
import { isContractEnding } from "../contract-lock";
import { caseError } from "./errors";
import { ackTimesOf, enrichEvidenceSourceError, evidenceGuard, type Actor } from "./dispute-case.service";
import { buildFinancialView, hasLateArrivalStep } from "./financial";
import { executionEnabled } from "./flags";
import { d77Key, readLateState, type D77Read } from "./d77-key";
import { currentApprovalWhere, hasPendingReplacement } from "./decision-replacement.service";
import { assertPolicyEligibility, D77_COMBINATION_UNRESOLVED, EXECUTION_DISABLED, OPENED_D77_COMBINATIONS, type CaseDecisionCtx } from "./execution-guard";
import { changeAcknowledged, checkApprover, outcomeForFinding, type SnapshotEntry } from "./rules";
import { noticesFor, sendNotices, type CaseParties } from "./notices";

/**
 * DISPUTE CASE slice 2 / S2.1 - the CaseDecision EXECUTOR (design 1.2.2, 1.7.4). The ONLY door through which a Case changes a session, a quota or money,
 * and it does so by calling the existing ruling core (booking.service resolveDisputeCore) - which computes the money itself. This file never writes a
 * session, a counter, a settlement or a ledger row; it writes dispute_case* rows only (execution axis + append-only execution history + events).
 *
 *   flag           DISPUTE_CASE_EXECUTION_ENABLED, fail-closed (flags.ts): effective only in NODE_ENV=test with an accepted isolated test DB.
 *   pre-checks     everything is re-read from the database, nothing is taken from the caller (decision id is only a selector): decision exists + APPROVED +
 *                  of THIS case + the case's session; outcome RE-COMPUTED from the finding; four-eyes + conflict of interest re-checked; no unacknowledged
 *                  evidence change; not LEGACY_UNCLASSIFIED; session DISPUTED (PT_NO_SHOW_REPORTED -> BLOCKED: S2.4 is not built); contract not CONTRACT_ENDING;
 *                  D77 trace -> BLOCKED. A refusal before the start changes nothing.
 *   start          ONE transaction: compare-and-set on the case (NOT_STARTED | EXEC_BLOCKED -> EXECUTING) + the STARTED history row. Idempotency key
 *                  CASE_DECISION:<decisionId>. A second command while EXECUTING is refused (EXECUTION_IN_PROGRESS); after BUSINESS_DONE it replays the stored answer.
 *   core           resolveDisputeCore(..., { caseDecisionId }) once. Under the contract lock it re-verifies the context and runs the B-1 guard BEFORE its
 *                  compare-and-set, which writes sessions.resolved_by_case_decision_id in the same statement. Money steps use the existing settlement keys.
 *   finish         ONE transaction: EXECUTING -> BUSINESS_DONE + the BUSINESS_DONE row. BUSINESS_DONE means the business exit answered; it is NOT "money arrived":
 *                  the money axis (F1/F2/F3) is derived from session_settlements + the ledger and returned beside it.
 *   crash          reconcileExecution: reads the real state first (table in the S2.1 brief) and either re-enters the core (CAS from DISPUTED blocks a double
 *                  write), records BUSINESS_DONE, or hands the case to a person (NEEDS_HUMAN). Never a blind retry.
 */

type Tx = Prisma.TransactionClient;

export const EXECUTION_IN_PROGRESS = "EXECUTION_IN_PROGRESS";
export const executionKey = (decisionId: string) => `CASE_DECISION:${decisionId}`;

/** What the executor does when the core answers with one of these (the core wrote nothing to the session). */
const BLOCK_CODES = new Set<string>([D77_COMBINATION_UNRESOLVED, "CANCELLED_BLOCKED_BY_D77", "CONTRACT_ENDING", "PT_NO_SHOW_REPORTED_NOT_SUPPORTED", "LEDGER_UNREADABLE"]);

export interface ExecDeps {
  /** The ruling core. Default: booking.service resolveDisputeCore. */
  resolveCore: typeof resolveDisputeCore;
  /** Early (pre-lock) D77 check, which may ask the ledger. Default: financial.hasLateArrivalStep. */
  ledgerHasLateArrival: (sessionId: string) => Promise<{ exists: boolean } | { unknown: true }>;
  /** B-1 key: the REAL state of L (settlement row + ledger obligation) and the contract phase. Default: d77-key readLateState. */
  readLateState: (sessionId: string, contractId: string) => Promise<D77Read | { none: true } | { unknown: true }>;
  /** TEST SEAM - boundary 1: awaited after the case was set to EXECUTING and before the core is called. */
  afterExecutingCas?: () => Promise<void>;
  /** TEST SEAM - boundary 2: handed to the core as ctx.afterDecisionCommitted (between the committed decision and its money step). */
  afterDecisionCommitted?: () => Promise<void>;
  /** TEST SEAM - boundary 3: awaited after the core returned and before BUSINESS_DONE is recorded. */
  afterCore?: () => Promise<void>;
  /**
   * TEST ONLY (B-1 release gate): D77 x outcome combinations a test may open (see CaseDecisionCtx.openedD77Combinations). defaultExecDeps() never sets it; there is no env
   * variable or route that does.
   */
  openedD77Combinations?: ReadonlyArray<string>;
}

export const defaultExecDeps = (): ExecDeps => ({
  resolveCore: resolveDisputeCore,
  ledgerHasLateArrival: (sessionId) => hasLateArrivalStep(prisma, sessionId),
  readLateState: (sessionId, contractId) => readLateState(prisma, sessionId, contractId),
});

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function blockedError(reason: string, message: string, details?: unknown) {
  return caseError(409, "EXEC_BLOCKED", message, { reason, ...(details ? { details } : {}) });
}

interface Loaded {
  c: Prisma.DisputeCaseGetPayload<{}>;
  approval: Prisma.DisputeCaseApprovalGetPayload<{ include: { proposal: { include: { finding: true } } } }>;
  session: Prisma.SessionGetPayload<{}>;
}

/** Everything read again from the database. `decisionId` only SELECTS among this case's approvals; it is never trusted. */
async function loadAndCheck(actor: Actor, caseId: string, decisionId: string | undefined, deps: ExecDeps): Promise<Loaded> {
  if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực thi quyết định hồ sơ");
  if (!executionEnabled()) throw caseError(409, EXECUTION_DISABLED, "Bộ thực thi quyết định hồ sơ đang tắt");
  if (!UUID_RE.test(caseId)) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
  if (decisionId !== undefined && !UUID_RE.test(decisionId)) throw caseError(404, "DECISION_NOT_FOUND", "Không tìm thấy quyết định");

  const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
  if (!c) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");

  const include = { proposal: { include: { finding: true } } } as const;
  let approval;
  if (decisionId) {
    approval = await prisma.disputeCaseApproval.findUnique({ where: { id: decisionId }, include });
    if (!approval) throw caseError(404, "DECISION_NOT_FOUND", "Không tìm thấy quyết định");
    if (approval.proposal.caseId !== c.id) throw caseError(409, "DECISION_WRONG_CASE", "Quyết định này không thuộc hồ sơ");
  } else {
    approval = await prisma.disputeCaseApproval.findFirst({ where: await currentApprovalWhere(prisma, c.id), include, orderBy: { createdAt: "desc" } });
    if (!approval) throw caseError(409, "DECISION_NOT_APPROVED", "Hồ sơ chưa có quyết định được duyệt");
  }
  if (approval.result !== "APPROVED") throw caseError(409, "DECISION_NOT_APPROVED", "Quyết định chưa được duyệt");
  if (await hasPendingReplacement(prisma, c.id)) throw caseError(409, "REPLACEMENT_PENDING", "Quyết định này đang có đề xuất thay thế chờ xử lý: chưa thực thi được");
  if (c.status !== "DECISION_APPROVED") throw caseError(409, "CASE_STATE_NOT_ALLOWED", "Hồ sơ chưa ở trạng thái đã duyệt quyết định", { status: c.status, allowed: ["DECISION_APPROVED"], allowedKind: "STATUSES" });
  if (c.type === "LEGACY_UNCLASSIFIED") throw caseError(409, "CLASSIFICATION_REQUIRED", "Hồ sơ còn ở phân loại tạm (LEGACY_UNCLASSIFIED)");

  // The outcome is computed again from the finding the proposal was built on - and that finding must still be the case's latest.
  const latest = await prisma.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  const recomputed = outcomeForFinding(approval.proposal.finding.finding as any);
  if (!recomputed || recomputed !== approval.proposal.outcome || latest?.id !== approval.proposal.findingId) {
    throw caseError(409, "OUTCOME_MISMATCH", "Kết quả của quyết định không khớp với kết luận của hồ sơ", { stored: approval.proposal.outcome, recomputed });
  }

  // Four eyes and conflict of interest, again, from the stored rows.
  const verdict = checkApprover({
    approverId: approval.approverId,
    approverRole: "ADMIN",
    proposerId: approval.proposal.proposerId,
    investigatorId: c.investigatorId,
    clientUserId: c.clientUserId,
    ptUserId: c.ptUserId,
    conflictOfInterestDeclaredNone: approval.conflictOfInterestDeclaredNone,
  });
  if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);
  if (actor.id === c.clientUserId || actor.id === c.ptUserId) {
    throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc nên không được thực thi");
  }

  const session = await prisma.session.findUnique({ where: { id: c.sessionId } });
  if (!session) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
  if (session.id !== c.sessionId || session.contractId !== c.contractId) throw caseError(409, "CASE_SESSION_MISMATCH", "Hồ sơ và buổi tập không khớp");
  void deps;
  return { c, approval, session };
}

/** No evidence change that nobody acknowledged - and none made AFTER the approval (the approver never saw it). Asked only for a decision that can still start. */
async function assertEvidenceUnchanged(l: Loaded): Promise<void> {
  const { c, approval } = l;
  // (Only before the execution starts: once the session has been ruled its own fields differ from the snapshot by definition, and a replay must still answer.)
  const startable = c.execStatus === "NOT_STARTED" || c.execStatus === "EXEC_BLOCKED";
  const guard = startable
    ? await evidenceGuard(prisma as unknown as Tx, c, approval.proposal.evidenceSnapshot as unknown as SnapshotEntry[])
    : { changed: false, newIds: [] as string[], staleLive: [] as string[], mutatedIds: [] as string[], lastChangeAt: null as Date | null, unreadableLive: [] as string[] };
  // F5: a live source that cannot be read now (stored copy holds real data) is unknown, not changed: refuse (fail-closed), retryable, nothing to acknowledge.
  if (guard.unreadableLive.length > 0) {
    throw caseError(503, "EVIDENCE_SOURCE_UNAVAILABLE", "Chưa đọc được một nguồn bằng chứng (chat hoặc phòng tập) nên chưa kiểm tra được bằng chứng có thay đổi hay không. Vui lòng thử lại sau", { unreadable: guard.unreadableLive, retryable: true });
  }
  if (guard.changed) {
    const acked = changeAcknowledged(guard, approval.evidenceChangeAcknowledged, await ackTimesOf(prisma as unknown as Tx, c));
    const afterApproval = guard.staleLive.length > 0 || (guard.lastChangeAt !== null && guard.lastChangeAt.getTime() > approval.createdAt.getTime());
    if (!acked || afterApproval) {
      throw caseError(409, "EVIDENCE_CHANGED", "Bằng chứng đã thay đổi sau khi quyết định được duyệt mà chưa được xác nhận", { changedIds: guard.newIds, staleLive: guard.staleLive });
    }
  }

}

/** A refusal of the kind that waits (nothing was written to the session): remembered on the case + in the history, then raised. */
type ExecCase = CaseParties & { sessionId: string };

async function recordBlocked(c: ExecCase, approval: { id: string; proposal: { outcome: any } }, actor: Actor, reason: string, message: string): Promise<never> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const cur = await tx.disputeCase.findUniqueOrThrow({ where: { id: c.id } });
    if (cur.execStatus === "BUSINESS_DONE" || cur.execStatus === "NEEDS_HUMAN") return; // already settled elsewhere: do not overwrite
    await tx.disputeCase.update({ where: { id: c.id }, data: { execStatus: "EXEC_BLOCKED", execDecisionId: approval.id, version: { increment: 1 } } });
    await tx.disputeCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, sessionId: c.sessionId, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: "BLOCKED", blockedReason: reason, note: message },
    });
    await tx.disputeCaseEvent.create({
      data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: "EXECUTION_BLOCKED", note: reason, payload: toJson({ reason, decisionId: approval.id }) },
    });
  });
  await sendNotices([noticesFor("EXEC_BLOCKED", c, { actorId: actor.id, reasonCode: reason })]);
  throw blockedError(reason, message);
}

async function recordNeedsHuman(c: ExecCase, approval: { id: string; proposal: { outcome: any } }, actor: Actor, reason: string, detail?: unknown): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const cur = await tx.disputeCase.findUniqueOrThrow({ where: { id: c.id } });
    if (cur.execStatus === "BUSINESS_DONE") return;
    await tx.disputeCase.update({ where: { id: c.id }, data: { execStatus: "NEEDS_HUMAN", execDecisionId: approval.id, version: { increment: 1 } } });
    await tx.disputeCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, sessionId: c.sessionId, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: "NEEDS_HUMAN", blockedReason: reason, response: detail === undefined ? undefined : toJson(detail) },
    });
    await tx.disputeCaseEvent.create({
      data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: "EXECUTION_NEEDS_HUMAN", note: reason, payload: toJson({ reason, decisionId: approval.id, detail: detail ?? null }) },
    });
  });
  await sendNotices([noticesFor("NEEDS_HUMAN", c, { actorId: actor.id })]);
}

/** The outcome a terminal session shows (null when the session is not in a state a ruling produces). */
const outcomeOf = (s: { status: string; ptAtFault: boolean }) =>
  s.status === "COMPLETED" ? "COMPLETED" : s.status === "CANCELLED" ? "CANCELLED" : s.status === "NO_SHOW" && s.ptAtFault ? "PT_NO_SHOW_CONFIRMED" : null;

export const EXEC_LEASE_MS = Number(process.env.DISPUTE_EXEC_LEASE_MS ?? 120_000);

/** Compare-and-set on the REAL state: the case must still be EXECUTING and the lease free or expired. */
async function acquireExecLease(caseId: string, owner: string): Promise<{ acquired: boolean; until: Date | null }> {
  const t = clockNow();
  const until = new Date(t.getTime() + EXEC_LEASE_MS);
  const r = await prisma.disputeCase.updateMany({
    where: { id: caseId, execStatus: "EXECUTING", OR: [{ execLeaseUntil: null }, { execLeaseUntil: { lt: t } }] },
    data: { execLeaseOwner: owner, execLeaseUntil: until },
  });
  if (r.count === 1) return { acquired: true, until };
  const cur = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { execLeaseUntil: true } });
  return { acquired: false, until: cur?.execLeaseUntil ?? null };
}
async function releaseExecLease(caseId: string, owner: string): Promise<void> {
  await prisma.disputeCase.updateMany({ where: { id: caseId, execLeaseOwner: owner }, data: { execLeaseOwner: null, execLeaseUntil: null } });
}

async function moneyAxis(sessionId: string) {
  try {
    const v = await buildFinancialView(prisma, sessionId);
    return { derived: true as const, group: v.group, groupLabel: v.groupLabel, f3Kind: v.f3Kind ?? null, items: v.items.map((i) => ({ key: i.key, state: i.state, group: i.group, settlementStatus: i.settlementStatus })) };
  } catch {
    return { derived: true as const, group: "UNAVAILABLE" as const, groupLabel: "Chưa đọc được sổ cái", f3Kind: null, items: [] };
  }
}

async function businessAnswer(sessionId: string, decisionId: string, outcome: string) {
  const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  return {
    outcome,
    decisionId,
    session: { id: s.id, status: s.status, sessionDeducted: s.sessionDeducted, ptAtFault: s.ptAtFault, resolvedByCaseDecisionId: s.resolvedByCaseDecisionId },
  };
}

/** Records BUSINESS_DONE (CAS EXECUTING -> BUSINESS_DONE on the case) with the business answer. */
async function finish(c: ExecCase, approval: { id: string; proposal: { outcome: any } }, actor: Actor, via: string, from: "EXECUTING" | "NEEDS_HUMAN" = "EXECUTING"): Promise<{ business: Awaited<ReturnType<typeof businessAnswer>> }> {
  const business = await businessAnswer(c.sessionId, approval.id, approval.proposal.outcome);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const r = await tx.disputeCase.updateMany({
      where: { id: c.id, execStatus: from, execDecisionId: approval.id },
      data: { execStatus: "BUSINESS_DONE", version: { increment: 1 } },
    });
    if (r.count !== 1) throw caseError(409, "EXECUTION_STATE_CHANGED", "Trạng thái thực thi của hồ sơ đã thay đổi");
    await tx.disputeCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, sessionId: c.sessionId, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: "BUSINESS_DONE", response: toJson({ ...business, via }) },
    });
    await tx.disputeCaseEvent.create({
      data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: "EXECUTION_BUSINESS_DONE", note: via, payload: toJson({ ...business }) },
    });
  });
  await sendNotices([noticesFor("EXECUTED", c, { actorId: actor.id })]);
  return { business };
}

/** Calls the core ONCE for the case that is in EXECUTING, then records the end. Used by the first run and by the recovery. */
async function runCoreAndFinish(l: Loaded, actor: Actor, deps: ExecDeps, via: string) {
  const { c, approval } = l;
  // B-1 key: the real state of L + the contract phase, read here (outside every lock) only when something could be opened (production opens nothing: no ledger call is added to the live path)
  let d77Read: D77Read | undefined;
  if (OPENED_D77_COMBINATIONS.length + (deps.openedD77Combinations?.length ?? 0) > 0) {
    const st = await deps.readLateState(c.sessionId, c.contractId).catch(() => ({ unknown: true as const }));
    if ("lState" in st) d77Read = st;
  }
  const ctx: CaseDecisionCtx = { caseDecisionId: approval.id, afterDecisionCommitted: deps.afterDecisionCommitted, openedD77Combinations: deps.openedD77Combinations, d77Read };
  const note = `Hồ sơ khiếu nại ${c.id}: ${approval.reason}`.slice(0, 1000);
  try {
    await deps.resolveCore(c.sessionId, actor.id, approval.proposal.outcome as any, note, ctx);
  } catch (e: any) {
    const code = String(e?.code ?? "");
    if (e?.execBlocked || BLOCK_CODES.has(code)) {
      await recordBlocked(c, approval, actor, code || "BLOCKED", String(e?.message ?? "Chưa thực thi được"));
    }
    if (typeof e?.status === "number" && e.status >= 400 && e.status < 500) {
      // A deliberate refusal AFTER our pre-checks passed (the session moved, the context no longer holds): contradictory state, a person decides.
      await recordNeedsHuman(c, approval, actor, code || `HTTP_${e.status}`, { message: String(e?.message ?? "") });
      throw caseError(409, "NEEDS_HUMAN", "Trạng thái buổi tập và quyết định mâu thuẫn nên không tự thực thi tiếp. Cần người xem xét", { reason: code || `HTTP_${e.status}` });
    }
    throw e; // unknown / 5xx: the case stays EXECUTING; reconcileExecution reads the real state before anything is retried
  }
  if (deps.afterCore) await deps.afterCore();
  return finish(c, approval, actor, via);
}

export const executionService = {
  /**
   * Executes the approved decision of a case. Returns { executionState: "BUSINESS_DONE", ... } (+ the derived money axis), or throws a coded refusal:
   * 404/409/403 with a stable `code`; EXEC_BLOCKED / NEEDS_HUMAN / EXECUTION_IN_PROGRESS are 409 with `details.reason`.
   */
  async executeDecision(actor: Actor, caseId: string, opts: { decisionId?: string } = {}, deps: ExecDeps = defaultExecDeps()) {
    const l = await loadAndCheck(actor, caseId, opts.decisionId, deps);
    const { c, approval, session } = l;
    const key = executionKey(approval.id);

    // Already executed: the SAME answer, nothing runs again.
    if (c.execStatus === "BUSINESS_DONE" && c.execDecisionId === approval.id) {
      const done = await prisma.disputeCaseExecution.findFirst({ where: { idempotencyKey: key, state: "BUSINESS_DONE" } });
      const business = (done?.response as any) ?? (await businessAnswer(c.sessionId, approval.id, approval.proposal.outcome));
      return { replayed: true, executionState: "BUSINESS_DONE" as const, ...business, money: await moneyAxis(c.sessionId) };
    }
    if (c.execStatus === "EXECUTING") throw caseError(409, EXECUTION_IN_PROGRESS, "Quyết định đang được thực thi (hoặc lần thực thi trước chưa kết thúc). Dùng đối chiếu thực thi để xử lý", { decisionId: approval.id });
    if (c.execStatus === "NEEDS_HUMAN") throw caseError(409, "NEEDS_HUMAN", "Việc thực thi quyết định này đang chờ người xem xét");
    if (c.execDecisionId && c.execDecisionId !== approval.id) throw caseError(409, "DECISION_MISMATCH", "Hồ sơ đã gắn với một quyết định khác");

    // D-NEW-12: BEFORE any mutation (not even an EXEC_BLOCKED mark): the contract must have an approved ELIGIBLE_CURRENT_POLICY review. Re-checked under the contract lock in the core.
    await prisma.$transaction((tx) => assertPolicyEligibility(tx, session.contractId));

    // Refusals that WAIT: remembered (EXEC_BLOCKED) so the case shows in the queue, nothing written to the session.
    if (session.status === "PT_NO_SHOW_REPORTED") {
      await recordBlocked(c, approval, actor, "PT_NO_SHOW_REPORTED_NOT_SUPPORTED", "Buổi đang chờ PT phản hồi báo vắng mặt; đường chuyển sang khiếu nại chưa được xây (S2.4) nên chưa thực thi được");
    }
    if (session.status !== "DISPUTED") {
      throw caseError(409, "SESSION_ALREADY_PROCESSED", "Buổi tập không còn ở trạng thái đang khiếu nại", { status: session.status });
    }
    try {
      await assertEvidenceUnchanged(l);
    } catch (e) {
      throw await enrichEvidenceSourceError(e, c.id, actor); // C3: counted, backed off, escalated
    }
    if (await isContractEnding(session.contractId)) {
      await recordBlocked(c, approval, actor, "CONTRACT_ENDING", "Hợp đồng đang được kết thúc nhưng khoản tiền chưa được xác nhận; thử lại sau");
    }
    const late = await deps.ledgerHasLateArrival(session.id);
    if ("unknown" in late) await recordBlocked(c, approval, actor, "LEDGER_UNREADABLE", "Chưa đọc được sổ cái để kiểm tra khoản đền đến muộn; thử lại sau");
    if ("exists" in late && late.exists) {
      // B-1 (direction A): the combination is outcome + REAL state of L + contract phase. Nothing is opened in production; the seam is test-only.
      const outcome = approval.proposal.outcome as string;
      const opened = [...OPENED_D77_COMBINATIONS, ...(deps.openedD77Combinations ?? [])];
      let st: Awaited<ReturnType<typeof deps.readLateState>> = { unknown: true };
      try {
        st = await deps.readLateState(session.id, session.contractId);
      } catch {
        st = { unknown: true };
      }
      const isOpen = "lState" in st ? opened.includes(d77Key(outcome, st.lState, st.phase)) || opened.includes(outcome) : opened.includes(outcome);
      if (!isOpen) await recordBlocked(c, approval, actor, D77_COMBINATION_UNRESOLVED, "Buổi này có khoản đền đến muộn (D77); tổ hợp chưa được duyệt đối soát nên chưa thực thi");
    }

    // START: CAS on the case + the STARTED row, one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
      // A4: ordered against a replacement by the case row lock - a replacement proposed or approved before this point stops the start
      if (await hasPendingReplacement(tx, c.id)) throw caseError(409, "REPLACEMENT_PENDING", "Quyết định này đang có đề xuất thay thế chờ xử lý: chưa thực thi được");
      const stillApproved = await tx.disputeCaseApproval.findFirst({ where: await currentApprovalWhere(tx, c.id), select: { id: true }, orderBy: { createdAt: "desc" } });
      if (stillApproved?.id !== approval.id) throw caseError(409, "DECISION_REPLACED", "Quyết định này đã được thay thế: chưa thực thi được", { decisionId: approval.id });
      const r = await tx.disputeCase.updateMany({
        where: { id: c.id, status: "DECISION_APPROVED", execStatus: { in: ["NOT_STARTED", "EXEC_BLOCKED"] }, OR: [{ execDecisionId: null }, { execDecisionId: approval.id }] },
        data: { execStatus: "EXECUTING", execDecisionId: approval.id, version: { increment: 1 } },
      });
      if (r.count !== 1) throw caseError(409, EXECUTION_IN_PROGRESS, "Quyết định đang được thực thi bởi một lệnh khác", { decisionId: approval.id });
      const attempt = (await tx.disputeCaseExecution.count({ where: { idempotencyKey: key, state: "STARTED" } })) + 1;
      await tx.disputeCaseExecution.create({
        data: { caseId: c.id, decisionId: approval.id, sessionId: c.sessionId, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: key, attempt, state: "STARTED" },
      });
      await tx.disputeCaseEvent.create({
        data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: "EXECUTION_STARTED", note: `attempt ${attempt}`, payload: toJson({ decisionId: approval.id, outcome: approval.proposal.outcome, attempt }) },
      });
    });
    if (deps.afterExecutingCas) await deps.afterExecutingCas();

    const { business } = await runCoreAndFinish(l, actor, deps, "EXECUTE");
    return { replayed: false, executionState: "BUSINESS_DONE" as const, ...business, money: await moneyAxis(c.sessionId) };
  },

  /**
   * Crash recovery for a case left in EXECUTING. Reads the real state first (S2.1 brief):
   *   session DISPUTED and no settlement intent carries this decision id       -> the core may be called again (its CAS from DISPUTED blocks a double write)
   *   session terminal, resolved_by_case_decision_id = this decision, outcome agrees -> BUSINESS_DONE (the money step belongs to session_settlements)
   *   session terminal with another / NULL decision id, or the outcome disagrees  -> NEEDS_HUMAN, no retry
   *   anything else (unreadable, contradictory: DISPUTED yet an intent carries the id) -> NEEDS_HUMAN
   */
  async reconcileExecution(actor: Actor, caseId: string, deps: ExecDeps = defaultExecDeps()) {
    if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện");
    if (!executionEnabled()) throw caseError(409, EXECUTION_DISABLED, "Bộ thực thi quyết định hồ sơ đang tắt");
    if (!UUID_RE.test(caseId)) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    const c0 = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { id: true, execStatus: true, execDecisionId: true } });
    if (!c0) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    if (c0.execStatus !== "EXECUTING" || !c0.execDecisionId) return { action: "NOTHING_TO_RECONCILE" as const, execStatus: c0.execStatus };
    // C4 (Ngai 05/11): a runner (the sweep, an admin) re-enters an EXECUTING case ONLY after winning a compare-and-set LEASE on the real state. A second runner while the lease is held does nothing;
    // a lease left by a dead runner expires, and the next runner re-reads the real state (the ruling core's own compare-and-set from DISPUTED still blocks any double write).
    const owner = `${actor.id}:${randomUUID()}`;
    const lease = await acquireExecLease(c0.id, owner);
    if (!lease.acquired) return { action: "LEASE_HELD" as const, execStatus: c0.execStatus, leaseUntil: lease.until };
    try {
      return await executionService.reconcileExecutionLeased(actor, caseId, deps);
    } finally {
      await releaseExecLease(c0.id, owner);
    }
  },

  /** The reconciliation proper (reads the real state first). Call it only through reconcileExecution, which holds the lease. */
  async reconcileExecutionLeased(actor: Actor, caseId: string, deps: ExecDeps = defaultExecDeps()) {
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    if (c.execStatus !== "EXECUTING" || !c.execDecisionId) return { action: "NOTHING_TO_RECONCILE" as const, execStatus: c.execStatus };
    const approval = await prisma.disputeCaseApproval.findUnique({ where: { id: c.execDecisionId }, include: { proposal: { include: { finding: true } } } });
    if (!approval || approval.proposal.caseId !== c.id) {
      return { action: "NEEDS_HUMAN" as const, reason: "DECISION_UNREADABLE" };
    }
    const handOver = async (reason: string, detail?: unknown) => {
      await recordNeedsHuman(c, approval, actor, reason, detail);
      return { action: "NEEDS_HUMAN" as const, reason };
    };
    let session;
    let carrying: number;
    try {
      session = await prisma.session.findUnique({ where: { id: c.sessionId } });
      carrying = await prisma.sessionSettlement.count({ where: { sessionId: c.sessionId, requestSnapshot: { path: ["caseDecisionId"], equals: approval.id } } });
    } catch (e: any) {
      return handOver("STATE_UNREADABLE", { message: String(e?.message ?? "").slice(0, 200) });
    }
    if (!session) return handOver("SESSION_MISSING");
    const loaded: Loaded = { c, approval, session };
    if (session.status === "DISPUTED") {
      if (carrying > 0) return handOver("CONTRADICTION_DISPUTED_BUT_INTENT_RECORDED");
      const r = await runCoreAndFinish(loaded, actor, deps, "RECONCILE_RERUN");
      return { action: "RERAN_CORE" as const, ...r };
    }
    const terminalOutcome = outcomeOf(session);
    if (terminalOutcome && session.resolvedByCaseDecisionId === approval.id && terminalOutcome === approval.proposal.outcome) {
      const r = await finish(c, approval, actor, "RECONCILE_ALREADY_RULED");
      return { action: "BUSINESS_DONE" as const, ...r };
    }
    return handOver("SESSION_RULED_ELSEWHERE_OR_MISMATCH", { sessionStatus: session.status, resolvedByCaseDecisionId: session.resolvedByCaseDecisionId });
  },

  /**
   * NEEDS_HUMAN way out that MOVES NO MONEY. An ADMIN (not a party; no four-eyes: nothing is decided about money) acknowledges a case the executor handed to a person.
   * The real state is read first and the acknowledgement is always audited (event NEEDS_HUMAN_ACKNOWLEDGED: who, note, the session real state).
   *   - the session is already ruled BY THIS DECISION with the agreed outcome (resolved_by_case_decision_id = this approval)   -> NEEDS_HUMAN -> BUSINESS_DONE
   *     (the business answer is already in the session; the money steps belong to session_settlements and are untouched by this call)
   *   - anything else (the session is still DISPUTED: finishing would call the ruling core and move money; or it was ruled elsewhere / differently) -> the case STAYS
   *     NEEDS_HUMAN, locked, and the answer says why. Nothing is retried and nothing is written but the acknowledgement.
   */
  async acknowledgeNeedsHuman(actor: Actor, caseId: string, note: string) {
    if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện");
    if (!executionEnabled()) throw caseError(409, EXECUTION_DISABLED, "Bộ thực thi quyết định hồ sơ đang tắt");
    if (!UUID_RE.test(caseId)) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    if (actor.id === c.clientUserId || actor.id === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc nên không được thực hiện");
    if (c.execStatus !== "NEEDS_HUMAN" || !c.execDecisionId) throw caseError(409, "NOT_NEEDS_HUMAN", "Việc thực thi của hồ sơ không ở trạng thái chờ người xem xét", { execStatus: c.execStatus });
    const approval = await prisma.disputeCaseApproval.findUnique({ where: { id: c.execDecisionId }, include: { proposal: { include: { finding: true } } } });
    if (!approval || approval.proposal.caseId !== c.id) throw caseError(409, "DECISION_UNREADABLE", "Không đọc được quyết định gắn với lần thực thi");
    const session = await prisma.session.findUnique({ where: { id: c.sessionId } });
    if (!session) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
    const terminalOutcome = outcomeOf(session);
    const appliedByThisDecision = !!terminalOutcome && session.resolvedByCaseDecisionId === approval.id && terminalOutcome === approval.proposal.outcome;
    await prisma.disputeCaseEvent.create({
      data: {
        caseId: c.id,
        actorUserId: actor.id,
        actorRole: actor.role,
        action: "NEEDS_HUMAN_ACKNOWLEDGED",
        note,
        payload: toJson({ decisionId: approval.id, sessionStatus: session.status, resolvedByCaseDecisionId: session.resolvedByCaseDecisionId, appliedByThisDecision }),
      },
    });
    if (!appliedByThisDecision) {
      return {
        action: "STAYS_LOCKED" as const,
        execStatus: c.execStatus,
        reason: session.status === "DISPUTED" ? "SESSION_STILL_DISPUTED_FINISHING_WOULD_MOVE_MONEY" : "SESSION_RULED_ELSEWHERE_OR_MISMATCH",
        sessionStatus: session.status,
        message:
          session.status === "DISPUTED"
            ? "Buổi tập vẫn đang khiếu nại: hoàn tất sẽ chạy phán quyết và có thể chuyển tiền nên hồ sơ giữ nguyên trạng thái chờ người xem xét"
            : "Buổi tập đã được xử lý bằng một đường khác hoặc kết quả không khớp quyết định: hồ sơ giữ nguyên trạng thái chờ người xem xét",
      };
    }
    const r = await finish(c, approval, actor, "NEEDS_HUMAN_ACKNOWLEDGED", "NEEDS_HUMAN");
    return { action: "BUSINESS_DONE" as const, execStatus: "BUSINESS_DONE" as const, ...r };
  },

  /** The recovery sweep: every case that has been EXECUTING for longer than `olderThanMs`. Returns what was done per case. */
  async reconcileStale(actor: Actor, olderThanMs = 60_000, deps: ExecDeps = defaultExecDeps()) {
    if (!executionEnabled()) return [];
    const rows = await prisma.disputeCase.findMany({ where: { execStatus: "EXECUTING", updatedAt: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true }, take: 50 });
    const out: Array<{ caseId: string; result: unknown }> = [];
    for (const r of rows) {
      try {
        out.push({ caseId: r.id, result: await executionService.reconcileExecution(actor, r.id, deps) });
      } catch (e: any) {
        out.push({ caseId: r.id, result: { error: String(e?.code ?? e?.message ?? "ERROR") } });
      }
    }
    return out;
  },
};
