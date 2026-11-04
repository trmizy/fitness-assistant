/**
 * LATE-OPEN RECONCILIATION (final safety gate, 01/11/2026) - the person-driven, four-eyes way out for a session of an ORDINARY contract whose late-arrival compensation L is still OPEN at the ledger.
 *
 * The problem: the ledger refuses the session's money step (LATE_OPEN_FLAG_REQUIRED) unless the caller confirms the late arrival is verified; for a session that was never disputed there is no Case and so
 * no D-NEW-12 policy review to give that confirmation. The step is parked NEEDS_HUMAN (or HELD, UNCONFIRMED, once the contract ended) and nothing could move it.
 *
 * What this module is: queue (read) -> claim -> propose -> approve by a SECOND admin -> execute -> (retry, bounded) | reject. Every action leaves an append-only event in the same transaction.
 * What it is NOT:
 *   - not a Case: it never opens, edits or concludes a dispute case, and refuses (409) any session that has one;
 *   - not a policy review: it never writes dispute_case_policy_eligibility_reviews and never makes assertPolicyEligibility pass (the dispute ruling stays blocked until a Case review exists);
 *   - not a payout: there is no amount anywhere. The approved proposal only lets the EXISTING money step (SESSION_RELEASE / PT_NO_SHOW_COMPENSATION / UNRESOLVED_SESSION_RESOLUTION, same idempotency key) run
 *     again with settleLateOpen, which the ledger computes and books (obligation PAID_VIA_LEDGER). Quota is booked by the step's own bookkeeping, once.
 * Identity comes from the token only; the flag is read from the stored approval (contract-payout lateOpenGate), never from a request.
 */
import { createHash } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { Prisma, SessionSettlementKind, SessionSettlementStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { NEEDS_RECONCILIATION_PREFIX, sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { contractRepository } from "../repositories/contract.repository";
import { withContractLock } from "./contract-lock";
import { checkApprover } from "./dispute-case/rules";
import { lateOpenReconciliationEnabled } from "./dispute-case/flags";
import { isContractEnded, readLateOpenLedgerState, resolveUnresolvedSessionMoney, runSessionMoneyRow } from "./contract-payout.service";
import { notificationService } from "./notification.service";
import { authServiceClient } from "../clients/auth-service.client";
import { paymentClient } from "../clients/payment.client";
import { formatVnd } from "./pt-fault-session-wording";

export interface Actor {
  id: string;
  role: string;
}

type Tx = Prisma.TransactionClient;

const STEP_KINDS: SessionSettlementKind[] = [
  SessionSettlementKind.SESSION_RELEASE,
  SessionSettlementKind.PT_NO_SHOW_COMPENSATION,
  SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION,
];
const LATE_OPEN_ERROR = /LATE_OPEN_/; // LATE_OPEN_FLAG_REQUIRED | LATE_OPEN_NEEDS_RECONCILIATION | LATE_OPEN_RECONCILIATION_RETRY (our own park text)
/** An approved reconciliation is executed at most this many times IN TOTAL (failures counted from the event log); then a person must look again. */
export const RECONCILIATION_MAX_EXECUTION_ATTEMPTS = 3;
/** A recovery grants this many EXTRA executions (the same idempotency key); a proposal can have at most RECONCILIATION_MAX_RECOVERIES recoveries. */
export const RECONCILIATION_RECOVERY_EXTRA_ATTEMPTS = 2;
export const RECONCILIATION_MAX_RECOVERIES = 2;
const capForEpoch = (epoch: number) => (epoch === 0 ? RECONCILIATION_MAX_EXECUTION_ATTEMPTS : RECONCILIATION_RECOVERY_EXTRA_ATTEMPTS);
const STATUS_SUFFIX = "OBLIGATION_";

// ── errors ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function err(status: number, code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { status, code, ...(details === undefined ? {} : { details }) });
}
/** The path is BLOCKED: nothing is written except the event that says why, the row stays NEEDS_HUMAN / held. 409 with the specific code. */
class Blocked extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
const assertAdmin = (a: Actor) => {
  if (a.role !== "ADMIN") throw err(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (id: string, code: string) => {
  if (!UUID_RE.test(id)) throw err(404, code, "Không tìm thấy");
};

// ── events and idempotency ──────────────────────────────────────────────────────────────────────────────────────────

interface EventInput {
  rowId: string;
  reconciliationId?: string | null;
  sessionId: string;
  contractId: string;
  action: string;
  actor: Actor;
  note?: string | null;
  payload?: unknown;
  idempotencyKey?: string | null;
}
const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

async function writeEvent(db: Tx | typeof prisma, e: EventInput) {
  return db.lateOpenReconciliationEvent.create({
    data: {
      settlementRowId: e.rowId,
      reconciliationId: e.reconciliationId ?? null,
      sessionId: e.sessionId,
      contractId: e.contractId,
      action: e.action,
      actorUserId: e.actor.id,
      actorRole: e.actor.role,
      note: e.note ?? null,
      payload: toJson(e.payload ?? null),
      idempotencyKey: e.idempotencyKey ?? null,
    },
  });
}
const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? {})).digest("hex");
const keyOf = (actor: Actor, action: string, scope: string, key?: string) => (key ? `${actor.id}:${action}:${scope}:${key}` : null);
const isUnique = (e: unknown, target: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta ?? {}).includes(target);

async function findReplay<T>(key: string | null, requestHash: string): Promise<(T & { replayed: true }) | null> {
  if (!key) return null;
  const prior = await prisma.lateOpenReconciliationEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) throw err(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
  return { ...(p.result as T), replayed: true };
}

/** Runs `run` under the contract lock in ONE transaction; the event it returns is written in the same transaction (with the idempotency key and the stored result for replay). */
async function mutate<T extends object>(o: {
  actor: Actor;
  action: string;
  scope: string;
  idempotencyKey?: string;
  body: unknown;
  contractId: string;
  run: (tx: Tx) => Promise<{ result: T; event: Omit<EventInput, "actor" | "contractId" | "action" | "idempotencyKey" | "payload"> & { action?: string; detail?: unknown } }>;
}): Promise<T & { replayed?: boolean }> {
  const fk = keyOf(o.actor, o.action, o.scope, o.idempotencyKey);
  const requestHash = hashOf(o.body);
  const prior = await findReplay<T>(fk, requestHash);
  if (prior) return prior;
  try {
    return await withContractLock(o.contractId, async (tx) => {
      const out = await o.run(tx);
      await writeEvent(tx, {
        ...out.event,
        contractId: o.contractId,
        action: out.event.action ?? o.action,
        actor: o.actor,
        idempotencyKey: fk,
        payload: { requestHash, result: out.result, detail: out.event.detail ?? null },
      });
      return out.result;
    });
  } catch (e) {
    if (fk && isUnique(e, "idempotency_key")) {
      const again = await findReplay<T>(fk, requestHash);
      if (again) return again;
    }
    throw e;
  }
}

// ── assessment: is this row one the path may act on? ────────────────────────────────────────────────────────────────

type RowRec = NonNullable<Awaited<ReturnType<typeof sessionSettlementRepository.findById>>>;
interface Assessed {
  row: RowRec;
  sessionId: string;
  contractId: string;
  outcome: "DELIVERED" | "NOT_DELIVERED";
  ended: boolean;
  sessionStatus: SessionStatus;
  clientUserId: string;
  ptUserId: string;
}

/** The part of the assessment that reads only the user database (callable inside the contract-locked transaction). */
async function assessDb(db: Tx | typeof prisma, rowId: string): Promise<Assessed> {
  requireUuid(rowId, "SETTLEMENT_ROW_NOT_FOUND");
  const row = await db.sessionSettlement.findUnique({ where: { id: rowId } });
  if (!row) throw err(404, "SETTLEMENT_ROW_NOT_FOUND", "Không tìm thấy dòng thanh toán");
  if (!STEP_KINDS.includes(row.kind) || !row.sessionId) throw new Blocked("ROW_KIND_NOT_SUPPORTED", "Dòng này không phải bước tiền của một buổi tập");
  const sessionId = row.sessionId;
  const contract = await contractRepository.findById(row.contractId, db as Tx);
  if (!contract || !contract.paymentTransactionId) throw new Blocked("CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau");
  const ended = isContractEnded(contract);

  // the row is waiting for a person in a way this path owns
  const waitingNeedsHuman = row.status === SessionSettlementStatus.NEEDS_HUMAN && LATE_OPEN_ERROR.test(row.lastError ?? "");
  const waitingHeld = row.status === SessionSettlementStatus.UNCONFIRMED && ended && row.kind !== SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION;
  if (row.status === SessionSettlementStatus.SETTLED) throw new Blocked("ROW_ALREADY_SETTLED", "Bước tiền này đã hoàn tất", { status: row.status });
  if (!waitingNeedsHuman && !waitingHeld) throw new Blocked("ROW_NOT_WAITING", "Dòng này không ở trạng thái chờ người xử lý do khoản bồi thường đi muộn còn mở", { status: row.status });
  if (!ended && row.kind === SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION) throw new Blocked("ROW_NOT_RECONCILABLE", "Bước giải quyết buổi bị giữ chỉ có khi hợp đồng đã kết thúc");

  const session = await db.session.findUnique({ where: { id: sessionId }, select: { id: true, status: true, sessionDeducted: true, contractId: true, resolvedBy: true, resolvedByCaseDecisionId: true, clientUserId: true, ptUserId: true } });
  if (!session || session.contractId !== row.contractId) throw new Blocked("SESSION_MISMATCH", "Buổi tập không thuộc hợp đồng của dòng này");
  if (session.status === SessionStatus.DISPUTED || session.status === SessionStatus.PT_NO_SHOW_REPORTED) {
    throw new Blocked("SESSION_IN_DISPUTE", "Buổi tập đang bị khiếu nại: phải đi qua hồ sơ khiếu nại", { status: session.status });
  }
  if (session.status !== SessionStatus.COMPLETED && session.status !== SessionStatus.NO_SHOW) {
    throw new Blocked("SESSION_NOT_TERMINAL", "Buổi tập chưa kết thúc theo đường thường", { status: session.status });
  }
  // ruled by an admin or by a Case decision = it went through the dispute road (a client report that the PT simply AGREED to is an ordinary road: it has disputedAt but no ruling)
  if (session.resolvedBy || session.resolvedByCaseDecisionId) throw new Blocked("SESSION_WENT_THROUGH_DISPUTE", "Buổi tập đã được phán quyết qua khiếu nại: phải xử lý bằng hồ sơ khiếu nại");

  // step kind vs the session's real outcome
  const delivered = session.status === SessionStatus.COMPLETED && session.sessionDeducted;
  const notDelivered = session.status === SessionStatus.NO_SHOW;
  let outcome: "DELIVERED" | "NOT_DELIVERED";
  if (row.kind === SessionSettlementKind.SESSION_RELEASE) outcome = "DELIVERED";
  else if (row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION) outcome = "NOT_DELIVERED";
  else outcome = row.reason === "DELIVERED" ? "DELIVERED" : "NOT_DELIVERED";
  if ((outcome === "DELIVERED" && !delivered) || (outcome === "NOT_DELIVERED" && !notDelivered)) {
    throw new Blocked("SESSION_STATE_MISMATCH", "Trạng thái buổi tập không khớp với bước tiền đang chờ", { sessionStatus: session.status, step: row.kind });
  }

  // no Case at all that is open, nothing contested
  const openCases = await db.disputeCase.count({ where: { sessionId, status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] } } });
  if (openCases > 0) throw new Blocked("OPEN_CASE_EXISTS", "Buổi tập có hồ sơ khiếu nại đang mở: phải đi qua hồ sơ, không dùng đường này");
  if ((await db.disputeCase.count({ where: { sessionId, status: "DECISION_APPROVED" } })) > 0) throw new Blocked("SESSION_WENT_THROUGH_DISPUTE", "Buổi tập đã có hồ sơ khiếu nại được duyệt quyết định: không dùng đường này");
  const contested = await db.disputeCaseIssue.findFirst({ where: { kind: "PT_LATE", finding: { in: ["LATE_CONTESTED", "NOT_LATE"] }, case: { sessionId } }, select: { id: true } });
  if (contested) throw new Blocked("LATE_CONTESTED", "Việc đi muộn của buổi này đang bị tranh cãi trong hồ sơ khiếu nại");

  // the D77 step itself is SETTLED (the ledger wrote the compensation / the OPEN obligation)
  const late = await db.sessionSettlement.findUnique({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${sessionId}` } });
  if (!late || late.status !== SessionSettlementStatus.SETTLED) throw new Blocked("LATE_STEP_NOT_SETTLED", "Bước bồi thường đi muộn của buổi này chưa hoàn tất");

  // D-NEW-12: a CURRENT approved EXCEPTION_APPLIES review of the contract blocks this path (a historical exception is for a person to settle with a Case)
  const latestReview = await db.disputeCasePolicyEligibilityReview.findFirst({ where: { contractId: row.contractId, approvedAt: { not: null } }, orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }], select: { result: true } });
  if (latestReview?.result === "EXCEPTION_APPLIES") throw new Blocked("POLICY_EXCEPTION_APPLIES", "Hợp đồng có kết luận chính sách EXCEPTION_APPLIES: không dùng đường này");

  return { row, sessionId, contractId: row.contractId, outcome, ended, sessionStatus: session.status, clientUserId: session.clientUserId, ptUserId: session.ptUserId };
}

type LedgerRead = NonNullable<Awaited<ReturnType<typeof readLateOpenLedgerState>>>;

/** The part that reads the ledger (a network call: never inside the contract-locked transaction). Throws Blocked with the obligation state as the code. */
async function assessLedger(a: Assessed, opts: { resume?: boolean } = {}): Promise<LedgerRead> {
  let read: LedgerRead | null;
  try {
    read = await readLateOpenLedgerState(a.contractId, a.sessionId);
  } catch (e) {
    throw err(503, "LEDGER_UNAVAILABLE", "Không đọc được sổ cái lúc này, hãy thử lại", { message: String((e as Error).message).slice(0, 200) });
  }
  if (!read) throw new Blocked("CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau");
  const { state } = read;
  if (!state.lateOperation.exists) throw new Blocked("LATE_OPERATION_MISSING", "Sổ cái không có khoản bồi thường đi muộn của buổi này");
  const ob = state.obligation;
  // RESUME of an approved execution that already started: if the ledger DID book the payment (a crash after its commit, before this side recorded it), the obligation is PAID_VIA_LEDGER and the
  // right thing is to let the step replay (same key, the ledger answers from its stored result) so the row and the bookkeeping catch up - once. Never for a proposal or an approval.
  if (opts.resume && ob?.status === "PAID_VIA_LEDGER") return read;
  if (!ob) throw new Blocked("NO_OBLIGATION", "Sổ cái không có nghĩa vụ còn mở cho buổi này");
  if (ob.status !== "OPEN") throw new Blocked(`${STATUS_SUFFIX}${ob.status}`, `Nghĩa vụ ở trạng thái ${ob.status}: một người phải đối soát nó trước`, { status: ob.status });
  if (Number(ob.verifiedPaid) > 0 || Number(ob.externallyPaid) > 0 || ob.openPayments > 0) {
    throw new Blocked("OBLIGATION_HAS_OUTSIDE_PAYMENT", "Nghĩa vụ có khoản thanh toán ngoài sổ đang mở hoặc đã xác minh");
  }
  if (!(Number(ob.unpaid) > 0)) throw new Blocked("OBLIGATION_NOT_UNPAID", "Nghĩa vụ không còn khoản chưa trả");
  if (state.contractEnded !== a.ended) throw new Blocked("LEDGER_ENDING_MISMATCH", "Sổ cái và hệ thống không thống nhất về việc hợp đồng đã kết thúc chưa", { ledgerEnded: state.contractEnded, userServiceEnded: a.ended });
  const unitValue = Number(read.price) / read.totalSessions;
  const need = Math.min(Number(ob.unpaid), unitValue);
  const have = Number(state.ownPending.pt) + Number(state.ownPending.gym ?? 0) + Number(state.ownPending.platform);
  if (have + 0.005 < need) throw new Blocked("INSUFFICIENT_SOURCE", "Tiền đang giữ của hợp đồng không đủ để trả khoản này", { needed: need.toFixed(2), available: have.toFixed(2) });
  return read;
}

/** Writes the BLOCKED event of a refused action (its own write: the refusal itself throws) and rethrows. */
async function recordBlocked<T>(actor: Actor, rowId: string, reconciliationId: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Blocked) {
      const row = await prisma.sessionSettlement.findUnique({ where: { id: rowId }, select: { sessionId: true, contractId: true } });
      if (row?.sessionId) {
        await writeEvent(prisma, { rowId, reconciliationId, sessionId: row.sessionId, contractId: row.contractId, action: "BLOCKED", actor, note: e.message, payload: { code: e.code, details: e.details } }).catch((we) =>
          logger.error({ message: (we as Error).message }, "[LateOpenReconciliation] could not record the BLOCKED event"),
        );
      }
    }
    throw e;
  }
}

// ── derived state ───────────────────────────────────────────────────────────────────────────────────────────────────

type Proposal = Awaited<ReturnType<typeof prisma.lateOpenReconciliation.findMany>>[number];
type EventRec = Awaited<ReturnType<typeof prisma.lateOpenReconciliationEvent.findMany>>[number];

/** The current person in charge, derived from the append-only events (the `assignee` column of a proposal is immutable and only says who it started with): the latest claim / proposal / hand-over wins. */
function assigneeOf(events: EventRec[], _proposals: Proposal[]): string | null {
  let current: string | null = null;
  for (const e of events) {
    if (e.action === "CLAIMED" || e.action === "HANDED_OVER") current = ((e.payload as { result?: { assignee?: string } } | null)?.result?.assignee as string | undefined) ?? current;
    else if (e.action === "PROPOSED") current = e.actorUserId;
  }
  return current;
}
/** How many recoveries have been approved for this proposal = the execution "epoch"; every epoch has its own failure budget. */
const epochOf = (events: EventRec[], proposalId: string) => events.filter((e) => e.reconciliationId === proposalId && e.action === "RECOVERY_APPROVED").length;
const failuresInEpoch = (events: EventRec[], proposalId: string, epoch: number) =>
  events.filter((e) => e.reconciliationId === proposalId && e.action === "EXECUTION_FAILED" && Number((e.payload as { epoch?: number } | null)?.epoch ?? 0) === epoch).length;
function statusOf(events: EventRec[], proposals: Proposal[]): string {
  const live = proposals.find((p) => p.outcome !== "REJECTED");
  if (live) {
    if (live.outcome === "EXECUTED") return "EXECUTED";
    if (live.approvedAt) {
      const epoch = epochOf(events, live.id);
      const failures = failuresInEpoch(events, live.id, epoch);
      return failures >= capForEpoch(epoch) ? "EXECUTION_EXHAUSTED" : failures > 0 ? "EXECUTION_FAILED" : "APPROVED";
    }
    return "PROPOSED";
  }
  const last = events[events.length - 1];
  if (last?.action === "BLOCKED") return "BLOCKED";
  return assigneeOf(events, proposals) ? "CLAIMED" : "UNCLAIMED";
}

// ── conflict of interest and identity ───────────────────────────────────────────────────────────────────────────────

/** The two parties of a contract, read from the database (never from a request). The code has no gym-owner data for a contract, so the gym owner is NOT checked (stated in the report). */
async function assertNotParty(userId: string, contractId: string, who: string): Promise<void> {
  const c = await contractRepository.findById(contractId);
  if (c && (c.clientUserId === userId || c.ptUserId === userId)) throw err(403, "CONFLICT_OF_INTEREST", `${who} là một bên của hợp đồng nên không được thực hiện thao tác này`);
}
/** The person a row is handed to must be a REAL, active ADMIN account (auth-service says so; an outage fails closed). Role-based only: the system has no finer admin permissions and none is built here. */
async function assertRealAdmin(userId: string): Promise<void> {
  let user: { role?: string; isActive?: boolean } | undefined;
  try {
    const { data } = await authServiceClient.internalGet(`/auth/internal/users/${encodeURIComponent(userId)}`, { timeoutMs: 3000 });
    user = data?.user;
  } catch (e: any) {
    if (e?.response?.status === 404) throw err(422, "ASSIGNEE_NOT_FOUND", "Không tìm thấy tài khoản của người nhận chuyển giao");
    throw err(503, "ACCOUNT_LOOKUP_UNAVAILABLE", "Không kiểm tra được tài khoản người nhận lúc này, hãy thử lại");
  }
  if (!user || user.role !== "ADMIN" || user.isActive === false) throw err(422, "ASSIGNEE_NOT_ADMIN", "Người nhận chuyển giao phải là quản trị viên đang hoạt động");
}

async function itemOf(row: RowRec) {
  const [events, proposals, recoveries] = await Promise.all([
    prisma.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: row.id }, orderBy: { createdAt: "asc" } }),
    prisma.lateOpenReconciliation.findMany({ where: { settlementRowId: row.id }, orderBy: { createdAt: "asc" } }),
    prisma.lateOpenRecovery.findMany({ where: { settlementRowId: row.id }, orderBy: { createdAt: "asc" } }),
  ]);
  let assessment: { eligible: boolean; code?: string; message?: string } = { eligible: true };
  let ledger: unknown = null;
  try {
    const a = await assessDb(prisma, row.id);
    ledger = (await assessLedger(a)).state;
  } catch (e) {
    if (e instanceof Blocked) assessment = { eligible: false, code: e.code, message: e.message };
    else assessment = { eligible: false, code: (e as any)?.code ?? "ASSESSMENT_FAILED", message: String((e as Error).message).slice(0, 200) };
    try {
      const read = await readLateOpenLedgerState(row.contractId, row.sessionId!);
      ledger = read?.state ?? null;
    } catch {
      ledger = null;
    }
  }
  const session = row.sessionId ? await prisma.session.findUnique({ where: { id: row.sessionId }, select: { status: true } }) : null;
  const contract = await prisma.contract.findUnique({ where: { id: row.contractId }, select: { status: true } });
  return {
    rowId: row.id,
    kind: row.kind,
    settlementStatus: row.status,
    sessionId: row.sessionId,
    contractId: row.contractId,
    sessionStatus: session?.status ?? null,
    contractStatus: contract?.status ?? null,
    reason: row.lastError ? String(row.lastError).slice(0, 300) : null,
    status: statusOf(events, proposals),
    assignee: assigneeOf(events, proposals),
    attempts: (() => {
      const live = proposals.find((p) => p.outcome !== "REJECTED" && p.approvedAt);
      if (!live) return null;
      const epoch = epochOf(events, live.id);
      return { epoch, failures: failuresInEpoch(events, live.id, epoch), cap: capForEpoch(epoch), recoveriesLeft: Math.max(0, RECONCILIATION_MAX_RECOVERIES - recoveries.length) };
    })(),
    recoveries: recoveries.map((r) => ({ id: r.id, reconciliationId: r.reconciliationId, openedBy: r.openedBy, reason: r.reason, classification: r.classification, haltCode: r.haltCode, observation: r.observation, approvedBy: r.approvedBy, approvedAt: r.approvedAt, outcome: r.outcome, createdAt: r.createdAt })),
    assessment,
    /** an OBSERVATION read from the ledger; never an input of any action */
    ledger,
    proposals: proposals.map((p) => ({
      id: p.id,
      stepKind: p.stepKind,
      assignee: p.assignee,
      reason: p.reason,
      verificationNote: p.verificationNote,
      evidenceRefs: p.evidenceRefs,
      policyBasis: p.policyBasis,
      proposedBy: p.proposedBy,
      approvedBy: p.approvedBy,
      approvedAt: p.approvedAt,
      outcome: p.outcome,
      outcomeAt: p.outcomeAt,
      createdAt: p.createdAt,
    })),
    history: events.map((e) => ({ at: e.createdAt, action: e.action, actor: e.actorUserId, note: e.note, reconciliationId: e.reconciliationId })),
  };
}

// ── execution ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  status: "EXECUTED" | "BLOCKED" | "FAILED" | "IN_FLIGHT";
  code?: string;
  message?: string;
  replayed?: boolean;
  obligationAfter?: { status: string; paid: string; unpaid: string } | null;
}

async function finalizeExecuted(actor: Actor, p: Proposal, a: Assessed): Promise<ExecutionResult> {
  let after: LedgerRead | null = null;
  try {
    after = await readLateOpenLedgerState(a.contractId, a.sessionId);
  } catch {
    after = null;
  }
  const ob = after?.state.obligation ?? null;
  const obligationAfter = ob ? { status: ob.status, paid: ob.paid, unpaid: ob.unpaid } : null;
  const stamped = await prisma.lateOpenReconciliation.updateMany({ where: { id: p.id, outcome: null, approvedAt: { not: null } }, data: { outcome: "EXECUTED", outcomeAt: new Date() } });
  if (stamped.count === 1) {
    await writeEvent(prisma, { rowId: a.row.id, reconciliationId: p.id, sessionId: a.sessionId, contractId: a.contractId, action: "EXECUTED", actor, note: "Bước tiền đã chạy lại qua sổ cái với cờ đã duyệt", payload: { obligationAfter } });
  }
  await notifyOnce(p, a, obligationAfter);
  return { status: "EXECUTED", obligationAfter };
}

/** One confirmation to the client, only when the ledger really credited (the obligation moved) - and only once (the event key is unique). */
async function notifyOnce(p: Proposal, a: Assessed, ob: { status: string; paid: string; unpaid: string } | null): Promise<void> {
  if (!ob || !(Number(ob.paid) > 0)) return;
  const key = `LATE_OPEN_NOTIFY:${p.id}`;
  try {
    await writeEvent(prisma, { rowId: a.row.id, reconciliationId: p.id, sessionId: a.sessionId, contractId: a.contractId, action: "NOTIFIED", actor: { id: "system", role: "SYSTEM" }, note: "Đã gửi xác nhận cho khách", payload: { obligation: ob }, idempotencyKey: key });
  } catch (e) {
    if (isUnique(e, "idempotency_key")) return; // already sent
    throw e;
  }
  const full = Number(ob.unpaid) <= 0;
  const text =
    a.outcome === "NOT_DELIVERED"
      ? full
        ? `Sau khi đối soát, khoản hoàn cho buổi tập Huấn luyện viên vắng mặt đã được ghi nhận vào ví Gymini của bạn (bao gồm ${formatVnd(ob.paid)}đ bồi thường đi muộn).`
        : `Sau khi đối soát, đã ghi nhận ${formatVnd(ob.paid)}đ vào ví Gymini của bạn; ${formatVnd(ob.unpaid)}đ còn lại vẫn đang được đối soát.`
      : full
        ? `Sau khi đối soát, khoản bồi thường Huấn luyện viên vào muộn ${formatVnd(ob.paid)}đ đã được ghi nhận vào ví Gymini của bạn.`
        : `Sau khi đối soát, đã ghi nhận ${formatVnd(ob.paid)}đ bồi thường vào ví Gymini của bạn; ${formatVnd(ob.unpaid)}đ còn lại vẫn đang được đối soát.`;
  await notificationService
    .create({ userId: a.clientUserId, text, eventType: a.outcome === "NOT_DELIVERED" ? "SESSION_NO_SHOW_PT" : "SESSION_PENDING_CONFIRMATION", entityType: "SESSION", entityId: a.sessionId, link: "/client/booking" })
    .catch((e) => logger.warn({ message: (e as Error).message }, "[LateOpenReconciliation] confirmation notice not stored"));
}

/** Runs the approved proposal's money step. Never throws for a business outcome: BLOCKED / FAILED / IN_FLIGHT / EXECUTED come back as the result. */
async function executeApproved(actor: Actor, proposalId: string): Promise<ExecutionResult> {
  // Fail-closed feature flag, defence in depth behind the route guard: a non-HTTP caller cannot execute while the flag is off.
  if (!lateOpenReconciliationEnabled()) throw err(409, "LATE_OPEN_RECONCILIATION_DISABLED", "Chức năng đối soát khoản bồi thường mở đang tắt");
  const p = await prisma.lateOpenReconciliation.findUnique({ where: { id: proposalId } });
  if (!p) throw err(404, "PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất");
  if (p.outcome === "EXECUTED") return { status: "EXECUTED", replayed: true };
  if (!p.approvedAt || p.outcome === "REJECTED") throw err(409, "NOT_APPROVED", "Đề xuất chưa được duyệt");
  const allEvents = await prisma.lateOpenReconciliationEvent.findMany({ where: { reconciliationId: p.id }, orderBy: { createdAt: "asc" } });
  const epoch = epochOf(allEvents, p.id);
  const failures = failuresInEpoch(allEvents, p.id, epoch);
  if (failures >= capForEpoch(epoch)) throw err(409, "EXECUTION_ATTEMPTS_EXHAUSTED", "Đã thử thực thi tối đa số lần cho phép: cần mở recovery (hai người) hoặc một người xem lại", { failures, epoch });

  // 1. a fresh look, right before executing: user database under the contract lock, then the ledger
  let a: Assessed;
  try {
    a = await withContractLock(p.contractId, (tx) => assessDb(tx, p.settlementRowId));
    const started = await prisma.lateOpenReconciliationEvent.count({ where: { reconciliationId: p.id, action: "EXECUTION_STARTED" } });
    await assessLedger(a, { resume: started > 0 });
  } catch (e) {
    if (e instanceof Blocked) {
      // the row may have been settled meanwhile by the very same approved execution (a concurrent call): that is a success, not a block
      if (e.code === "ROW_ALREADY_SETTLED") {
        const row = await prisma.sessionSettlement.findUnique({ where: { id: p.settlementRowId } });
        if (row) {
          const a2 = await assessedForSettled(row);
          if (a2) return finalizeExecuted(actor, p, a2);
        }
      }
      if (e.code === "ROW_NOT_WAITING") {
        const cur = await prisma.sessionSettlement.findUnique({ where: { id: p.settlementRowId }, select: { status: true } });
        if (cur && (cur.status === SessionSettlementStatus.PENDING || cur.status === SessionSettlementStatus.PROCESSING || cur.status === SessionSettlementStatus.FAILED)) return { status: "IN_FLIGHT", code: e.code, message: e.message };
      }
      await writeEvent(prisma, { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, contractId: p.contractId, action: "BLOCKED", actor, note: e.message, payload: { code: e.code, details: e.details, phase: "execute" } });
      return { status: "BLOCKED", code: e.code, message: e.message };
    }
    throw e;
  }

  await writeEvent(prisma, { rowId: a.row.id, reconciliationId: p.id, sessionId: a.sessionId, contractId: a.contractId, action: "EXECUTION_STARTED", actor, note: `Lần thực thi ${failures + 1}/${capForEpoch(epoch)} (đợt ${epoch})`, payload: { epoch, path: a.ended ? "ENDED_CONTRACT_RESOLUTION" : "RUNNING_CONTRACT_STEP", outcome: a.outcome } });

  // 2. reopen exactly the parked row (compare-and-set) and run the EXISTING step with the same idempotency key; lateOpenGate reads the stored approval
  const resolutionKey = `UNRESOLVED_SESSION:${a.sessionId}`;
  if (a.ended) {
    // the contract ended: the session is HELD, its step is the resolution of the hold (UNRESOLVED_SESSION:<id>). Whatever the step row looked like (UNCONFIRMED held, or still NEEDS_HUMAN when the ending was
    // the natural completion), the existing resolution runs and closes the step row in its own transaction.
    const resolution = await sessionSettlementRepository.findByKey(resolutionKey);
    if (resolution && resolution.status === SessionSettlementStatus.NEEDS_HUMAN) {
      if (!(await sessionSettlementRepository.reopenParkedForReconciliation(resolution.id))) return { status: "IN_FLIGHT", code: "REOPEN_LOST", message: "Một lần thực thi khác đang chạy dòng này" };
    }
    await resolveUnresolvedSessionMoney(a.contractId, a.sessionId, a.outcome, { takeover: true }, a.row.kind === SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION ? {} : { closeHeldRowId: a.row.id }).catch((e) =>
      logger.error({ message: (e as Error).message }, "[LateOpenReconciliation] resolution threw"),
    );
  } else {
    if (!(await sessionSettlementRepository.reopenParkedForReconciliation(a.row.id))) return { status: "IN_FLIGHT", code: "REOPEN_LOST", message: "Một lần thực thi khác đang chạy dòng này" };
    await runSessionMoneyRow({ id: a.row.id, kind: a.row.kind, contractId: a.contractId, sessionId: a.sessionId, reason: a.row.reason }, { takeover: true }).catch((e) => logger.error({ message: (e as Error).message }, "[LateOpenReconciliation] step threw"));
  }

  // 3. what happened, from the rows (not from what we hoped)
  const stepAfter = await sessionSettlementRepository.findById(a.row.id);
  const resolutionAfter = await sessionSettlementRepository.findByKey(resolutionKey);
  // ended contract: the resolution of the hold is the money (it also closes the held row in its own transaction); running contract: the step itself
  const done = a.ended ? resolutionAfter?.status === SessionSettlementStatus.SETTLED : stepAfter?.status === SessionSettlementStatus.SETTLED;
  if (done) return finalizeExecuted(actor, p, a);

  const failedRow = a.ended && resolutionAfter ? resolutionAfter : stepAfter;
  const why = `${failedRow?.status ?? "?"}: ${String(failedRow?.lastError ?? "no detail").slice(0, 300)}`;
  // keep the row parked for a person: the sweep must not loop on it
  if (failedRow && failedRow.status !== SessionSettlementStatus.NEEDS_HUMAN && failedRow.status !== SessionSettlementStatus.SETTLED && failedRow.status !== SessionSettlementStatus.CONFLICT) {
    await sessionSettlementRepository.park(failedRow.id, NEEDS_RECONCILIATION_PREFIX, `LATE_OPEN_RECONCILIATION_RETRY the reconciliation attempt did not settle the step (${why})`);
  }
  await writeEvent(prisma, { rowId: a.row.id, reconciliationId: p.id, sessionId: a.sessionId, contractId: a.contractId, action: "EXECUTION_FAILED", actor, note: why, payload: { epoch, stepStatus: stepAfter?.status ?? null, resolutionStatus: resolutionAfter?.status ?? null } });
  return { status: "FAILED", code: "EXECUTION_DID_NOT_SETTLE", message: why };
}

/** A row that is already SETTLED by an execution of this same approval: rebuild the minimal context to finish the bookkeeping (outcome stamp, one notice). */
async function assessedForSettled(row: RowRec): Promise<Assessed | null> {
  if (!row.sessionId) return null;
  const s = await prisma.session.findUnique({ where: { id: row.sessionId }, select: { status: true, clientUserId: true, ptUserId: true } });
  if (!s) return null;
  const outcome = s.status === SessionStatus.NO_SHOW ? "NOT_DELIVERED" : "DELIVERED";
  const contract = await contractRepository.findById(row.contractId);
  return { row, sessionId: row.sessionId, contractId: row.contractId, outcome, ended: !!contract && isContractEnded(contract), sessionStatus: s.status, clientUserId: s.clientUserId, ptUserId: s.ptUserId };
}

// ── recovery classification ─────────────────────────────────────────────────────────────────────────────────────────

interface RecoveryClass {
  klass: "REPLAY" | "GRANT" | "HALT";
  haltCode?: string;
  message: string;
  observation: Record<string, unknown>;
}
/** Reads the REAL ledger by the step's own keys and says what a recovery may do. Never writes. Unreadable / not clean / inconsistent => HALT with an explicit code. */
async function classifyForRecovery(p: Proposal): Promise<RecoveryClass> {
  const keys = [`SESSION_RELEASE:${p.sessionId}`, `PT_NO_SHOW:${p.sessionId}`, `UNRESOLVED_SESSION:${p.sessionId}`];
  const halt = (haltCode: string, message: string, observation: Record<string, unknown> = {}): RecoveryClass => ({ klass: "HALT", haltCode, message, observation: { ...observation, haltCode } });
  let a: Assessed;
  try {
    a = await withContractLock(p.contractId, (tx) => assessDb(tx, p.settlementRowId));
  } catch (e) {
    if (e instanceof Blocked) {
      if (e.code === "ROW_ALREADY_SETTLED") return { klass: "REPLAY", message: "Dòng đã hoàn tất: chỉ cần chốt sổ", observation: { rowAlreadySettled: true } };
      return halt(e.code, e.message, e.details);
    }
    throw e;
  }
  let read: LedgerRead | null;
  let ops: { operations: Array<{ key: string }>; missing: string[] };
  try {
    read = await readLateOpenLedgerState(a.contractId, a.sessionId);
    ops = await paymentClient.lookupLedgerOperations(keys);
  } catch (e) {
    return halt("LEDGER_UNREADABLE", "Không đọc được sổ cái", { error: String((e as Error).message).slice(0, 200) });
  }
  if (!read) return halt("CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau");
  const ob = read.state.obligation;
  const wrote = ops.operations.map((o) => o.key);
  const observation = { operationKeysWritten: wrote, obligation: ob ? { status: ob.status, owed: ob.owed, paid: ob.paid, unpaid: ob.unpaid } : null, ownPending: read.state.ownPending, contractEnded: read.state.contractEnded };
  if (wrote.length > 0 && ob?.status === "PAID_VIA_LEDGER") return { klass: "REPLAY", message: "Sổ cái đã ghi: chỉ phát lại cùng khóa để bắt kịp dòng và bookkeeping", observation };
  if (wrote.length > 0) return halt("LEDGER_WROTE_BUT_OBLIGATION_NOT_PAID", "Sổ cái đã có thao tác nhưng nghĩa vụ chưa được trả: không rõ, một người phải xem", observation);
  if (ob?.status === "PAID_VIA_LEDGER") return halt("OBLIGATION_PAID_WITHOUT_STEP_OPERATION", "Nghĩa vụ đã trả nhưng không có thao tác của bước này: không rõ, một người phải xem", observation);
  try {
    await assessLedger(a);
  } catch (e) {
    if (e instanceof Blocked) return halt(e.code, e.message, { ...observation, ...e.details });
    return halt("LEDGER_UNREADABLE", "Không đánh giá được sổ cái", observation);
  }
  return { klass: "GRANT", message: "Sổ cái chưa ghi, nghĩa vụ OPEN sạch, đủ nguồn: cấp thêm số lần có giới hạn, cùng khóa", observation };
}

// ── the service ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const lateOpenReconciliationService = {
  /** The queue: parked / held money steps of ordinary sessions with a D77 step, with assignee, reason, status, history and the ledger observation. READ-ONLY. */
  async list(actor: Actor, opts: { limit?: number } = {}) {
    assertAdmin(actor);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await prisma.sessionSettlement.findMany({
      where: {
        kind: { in: STEP_KINDS },
        sessionId: { not: null },
        OR: [{ status: SessionSettlementStatus.NEEDS_HUMAN, lastError: { contains: "LATE_OPEN_" } }, { status: SessionSettlementStatus.UNCONFIRMED }, { lateOpenReconciliations: { some: {} } }],
      },
      orderBy: { updatedAt: "asc" },
      take: limit * 3,
    });
    const lateRows = await prisma.sessionSettlement.findMany({ where: { idempotencyKey: { in: rows.map((r) => `PT_LATE_ARRIVAL:${r.sessionId}`) }, status: SessionSettlementStatus.SETTLED }, select: { sessionId: true } });
    const withLate = new Set(lateRows.map((r) => r.sessionId));
    const eligible = rows.filter((r) => r.sessionId && withLate.has(r.sessionId)).slice(0, limit);
    const items = [];
    for (const r of eligible) items.push(await itemOf(r));
    return { items, count: items.length };
  },

  async get(actor: Actor, rowId: string) {
    assertAdmin(actor);
    requireUuid(rowId, "SETTLEMENT_ROW_NOT_FOUND");
    const row = await sessionSettlementRepository.findById(rowId);
    if (!row || !STEP_KINDS.includes(row.kind) || !row.sessionId) throw err(404, "SETTLEMENT_ROW_NOT_FOUND", "Không tìm thấy dòng thanh toán");
    return itemOf(row);
  },

  /** Take responsibility for a parked row. Only one assignee at a time (409 ALREADY_ASSIGNED). */
  async claim(actor: Actor, rowId: string, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(rowId, "SETTLEMENT_ROW_NOT_FOUND");
    const head = await sessionSettlementRepository.findById(rowId);
    if (!head) throw err(404, "SETTLEMENT_ROW_NOT_FOUND", "Không tìm thấy dòng thanh toán");
    await assertNotParty(actor.id, head.contractId, "Người nhận phụ trách");
    return recordBlocked(actor, rowId, null, () =>
      mutate<{ rowId: string; assignee: string }>({
        actor,
        action: "CLAIMED",
        scope: rowId,
        idempotencyKey,
        body: {},
        contractId: head.contractId,
        run: async (tx) => {
          const a = await assessDb(tx, rowId);
          const [events, proposals] = await Promise.all([
            tx.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: rowId }, orderBy: { createdAt: "asc" } }),
            tx.lateOpenReconciliation.findMany({ where: { settlementRowId: rowId }, orderBy: { createdAt: "asc" } }),
          ]);
          const current = assigneeOf(events, proposals);
          if (current && current !== actor.id) throw err(409, "ALREADY_ASSIGNED", "Dòng này đã có người phụ trách", { assignee: current });
          return { result: { rowId, assignee: actor.id }, event: { rowId, sessionId: a.sessionId, note: "Nhận phụ trách" } };
        },
      }),
    );
  },

  /** A proposal: why the late arrival is verified, how it was verified, the policy basis, the evidence. NO amount, NO identity, NO flag in the body. */
  async propose(actor: Actor, rowId: string, b: { reason: string; verificationNote: string; evidenceRefs: string[]; policyBasis: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(rowId, "SETTLEMENT_ROW_NOT_FOUND");
    const head = await sessionSettlementRepository.findById(rowId);
    if (!head) throw err(404, "SETTLEMENT_ROW_NOT_FOUND", "Không tìm thấy dòng thanh toán");
    await assertNotParty(actor.id, head.contractId, "Người đề xuất");
    return recordBlocked(actor, rowId, null, async () => {
      const a0 = await assessDb(prisma, rowId);
      await assessLedger(a0);
      return mutate<{ reconciliationId: string; rowId: string; sessionId: string; approved: false }>({
        actor,
        action: "PROPOSED",
        scope: rowId,
        idempotencyKey,
        body: b,
        contractId: head.contractId,
        run: async (tx) => {
          const a = await assessDb(tx, rowId);
          const [events, proposals] = await Promise.all([
            tx.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: rowId }, orderBy: { createdAt: "asc" } }),
            tx.lateOpenReconciliation.findMany({ where: { settlementRowId: rowId }, orderBy: { createdAt: "asc" } }),
          ]);
          if (proposals.some((p) => p.outcome !== "REJECTED")) throw err(409, "PROPOSAL_ALREADY_EXISTS", "Dòng này đã có một đề xuất đang hiệu lực");
          const current = assigneeOf(events, proposals);
          if (current && current !== actor.id) throw err(409, "ALREADY_ASSIGNED", "Dòng này do người khác phụ trách", { assignee: current });
          const created = await tx.lateOpenReconciliation.create({
            data: {
              sessionId: a.sessionId,
              contractId: a.contractId,
              settlementRowId: rowId,
              stepKind: a.row.kind,
              lateKey: `PT_LATE_ARRIVAL:${a.sessionId}`,
              assignee: actor.id,
              reason: b.reason,
              verificationNote: b.verificationNote,
              evidenceRefs: b.evidenceRefs,
              policyBasis: b.policyBasis,
              proposedBy: actor.id,
            },
          });
          return {
            result: { reconciliationId: created.id, rowId, sessionId: a.sessionId, approved: false as const },
            event: { rowId, reconciliationId: created.id, sessionId: a.sessionId, note: b.reason, detail: { stepKind: a.row.kind, evidenceRefs: b.evidenceRefs, policyBasis: b.policyBasis } },
          };
        },
      });
    });
  },

  /** The second pair of eyes. Re-checks everything, stamps the approval in ONE update, then executes. Approval and execution are separate facts: a failed execution leaves the approval standing (retry, bounded). */
  async approve(actor: Actor, proposalId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(proposalId, "PROPOSAL_NOT_FOUND");
    const p = await prisma.lateOpenReconciliation.findUnique({ where: { id: proposalId } });
    if (!p) throw err(404, "PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất");
    const contract = await contractRepository.findById(p.contractId);
    const verdict = checkApprover({
      approverId: actor.id,
      approverRole: actor.role,
      proposerId: p.proposedBy,
      investigatorId: null,
      clientUserId: contract?.clientUserId ?? "",
      ptUserId: contract?.ptUserId ?? "",
      conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
    });
    if (!verdict.ok) throw err(verdict.status, verdict.code, verdict.message);
    // four eyes: the approver is neither the proposer (checked above) nor the CURRENT person in charge (a hand-over cannot be used to approve one's own file)
    const approveEvents = await prisma.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: p.settlementRowId }, orderBy: { createdAt: "asc" } });
    if (assigneeOf(approveEvents, []) === actor.id) throw err(403, "APPROVER_IS_ASSIGNEE", "Người đang phụ trách hồ sơ không được tự duyệt");
    const fk = keyOf(actor, "APPROVED", proposalId, idempotencyKey);
    const requestHash = hashOf(b);
    const replay = await findReplay<{ reconciliationId: string; approved: true; execution: ExecutionResult }>(fk, requestHash);
    if (replay) return replay;
    if (p.approvedAt) throw err(409, "PROPOSAL_ALREADY_APPROVED", "Đề xuất này đã được duyệt");
    if (p.outcome === "REJECTED") throw err(409, "PROPOSAL_REJECTED", "Đề xuất này đã bị từ chối");

    const stamped = await recordBlocked(actor, p.settlementRowId, p.id, async () => {
      const a0 = await withContractLock(p.contractId, (tx) => assessDb(tx, p.settlementRowId));
      await assessLedger(a0);
      return mutate<{ reconciliationId: string; approved: true }>({
        actor,
        action: "APPROVED",
        scope: proposalId,
        idempotencyKey,
        body: b,
        contractId: p.contractId,
        run: async (tx) => {
          const a = await assessDb(tx, p.settlementRowId);
          const r = await tx.lateOpenReconciliation.updateMany({ where: { id: p.id, approvedAt: null, outcome: null }, data: { approvedBy: actor.id, approvedAt: new Date() } });
          if (r.count !== 1) throw err(409, "PROPOSAL_ALREADY_APPROVED", "Đề xuất này đã được duyệt hoặc không còn hiệu lực");
          return {
            result: { reconciliationId: p.id, approved: true as const },
            event: { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: a.sessionId, note: b.reason, detail: { proposedBy: p.proposedBy, approvedBy: actor.id, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone, policyBasis: p.policyBasis } },
          };
        },
      });
    });
    if ((stamped as { replayed?: boolean }).replayed) return stamped as typeof stamped & { execution?: ExecutionResult };
    const execution = await executeApproved(actor, p.id);
    return { ...stamped, execution };
  },

  async reject(actor: Actor, proposalId: string, b: { reason: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(proposalId, "PROPOSAL_NOT_FOUND");
    const p = await prisma.lateOpenReconciliation.findUnique({ where: { id: proposalId } });
    if (!p) throw err(404, "PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất");
    await assertNotParty(actor.id, p.contractId, "Người từ chối");
    return mutate<{ reconciliationId: string; outcome: "REJECTED" }>({
      actor,
      action: "REJECTED",
      scope: proposalId,
      idempotencyKey,
      body: b,
      contractId: p.contractId,
      run: async (tx) => {
        const r = await tx.lateOpenReconciliation.updateMany({ where: { id: p.id, approvedAt: null, outcome: null }, data: { outcome: "REJECTED", outcomeAt: new Date() } });
        if (r.count !== 1) throw err(409, "PROPOSAL_NOT_REJECTABLE", "Đề xuất đã được duyệt hoặc đã đóng, không từ chối được");
        return { result: { reconciliationId: p.id, outcome: "REJECTED" as const }, event: { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, note: b.reason } };
      },
    });
  },

  /** Run an approved, not yet executed proposal again (bounded by RECONCILIATION_MAX_EXECUTION_ATTEMPTS failures). */
  async retry(actor: Actor, proposalId: string) {
    assertAdmin(actor);
    requireUuid(proposalId, "PROPOSAL_NOT_FOUND");
    const p = await prisma.lateOpenReconciliation.findUnique({ where: { id: proposalId }, select: { contractId: true } });
    if (p) await assertNotParty(actor.id, p.contractId, "Người thực thi");
    return { reconciliationId: proposalId, execution: await executeApproved(actor, proposalId) };
  },

  /** Hand the file to another ADMIN. Any ADMIN (not a party) may do it - the current person may be absent. One append-only event per hand-over: previous, new, reason. The proposal's `assignee` column never changes. */
  async handover(actor: Actor, rowId: string, b: { newAssigneeId: string; reason: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(rowId, "SETTLEMENT_ROW_NOT_FOUND");
    const head = await sessionSettlementRepository.findById(rowId);
    if (!head) throw err(404, "SETTLEMENT_ROW_NOT_FOUND", "Không tìm thấy dòng thanh toán");
    await assertNotParty(actor.id, head.contractId, "Người chuyển giao");
    await assertNotParty(b.newAssigneeId, head.contractId, "Người nhận chuyển giao");
    await assertRealAdmin(b.newAssigneeId);
    return recordBlocked(actor, rowId, null, () =>
      mutate<{ rowId: string; assignee: string; previous: string | null }>({
        actor,
        action: "HANDED_OVER",
        scope: rowId,
        idempotencyKey,
        body: b,
        contractId: head.contractId,
        run: async (tx) => {
          const a = await assessDb(tx, rowId);
          const events = await tx.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: rowId }, orderBy: { createdAt: "asc" } });
          const previous = assigneeOf(events, []);
          return {
            result: { rowId, assignee: b.newAssigneeId, previous },
            event: { rowId, sessionId: a.sessionId, note: b.reason, detail: { from: previous, to: b.newAssigneeId, reason: b.reason } },
          };
        },
      }),
    );
  },

  /** RECOVERY (not "retry again"): after the execution attempts of an approved proposal are exhausted. An ADMIN opens it with a reason; the REAL ledger is read by the step's own keys and stored with a classification. */
  async openRecovery(actor: Actor, proposalId: string, b: { reason: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(proposalId, "PROPOSAL_NOT_FOUND");
    const replay = await findReplay<Record<string, unknown>>(keyOf(actor, "RECOVERY_OPENED", proposalId, idempotencyKey), hashOf(b));
    if (replay) return replay as never;
    const p = await prisma.lateOpenReconciliation.findUnique({ where: { id: proposalId } });
    if (!p) throw err(404, "PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất");
    await assertNotParty(actor.id, p.contractId, "Người mở recovery");
    if (p.outcome === "EXECUTED") throw err(409, "ALREADY_EXECUTED", "Đề xuất đã được thực thi xong");
    if (!p.approvedAt || p.outcome) throw err(409, "NOT_APPROVED", "Chỉ mở recovery cho đề xuất đã duyệt và chưa đóng");
    const events = await prisma.lateOpenReconciliationEvent.findMany({ where: { reconciliationId: p.id }, orderBy: { createdAt: "asc" } });
    const epoch = epochOf(events, p.id);
    if (failuresInEpoch(events, p.id, epoch) < capForEpoch(epoch)) throw err(409, "NOT_EXHAUSTED", "Đề xuất vẫn còn lượt thực thi: dùng retry, chưa cần recovery");
    const recoveries = await prisma.lateOpenRecovery.findMany({ where: { reconciliationId: p.id } });
    if (recoveries.some((r) => !r.outcome)) throw err(409, "RECOVERY_ALREADY_OPEN", "Đã có một recovery đang mở cho đề xuất này");
    if (recoveries.length >= RECONCILIATION_MAX_RECOVERIES) throw err(409, "RECOVERY_LIMIT_REACHED", "Đã dùng hết số lần recovery cho đề xuất này: cần một người xem lại bằng cách khác", { limit: RECONCILIATION_MAX_RECOVERIES });
    const cls = await classifyForRecovery(p);
    return mutate<{ recoveryId: string; reconciliationId: string; classification: string; haltCode: string | null; message: string }>({
      actor,
      action: "RECOVERY_OPENED",
      scope: proposalId,
      idempotencyKey,
      body: b,
      contractId: p.contractId,
      run: async (tx) => {
        const created = await tx.lateOpenRecovery.create({
          data: { reconciliationId: p.id, settlementRowId: p.settlementRowId, openedBy: actor.id, reason: b.reason, classification: cls.klass, haltCode: cls.haltCode ?? null, observation: toJson(cls.observation) },
        });
        return {
          result: { recoveryId: created.id, reconciliationId: p.id, classification: cls.klass, haltCode: cls.haltCode ?? null, message: cls.message },
          event: { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, note: b.reason, detail: { recoveryId: created.id, classification: cls.klass, haltCode: cls.haltCode ?? null, observation: cls.observation } },
        };
      },
    });
  },

  /** The second admin approves a recovery. The ledger is read AGAIN and the action follows what it says NOW: REPLAY (same key, no new money), GRANT (bounded extra executions, same key), HALT (stop, nothing is run). */
  async approveRecovery(actor: Actor, recoveryId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(recoveryId, "RECOVERY_NOT_FOUND");
    const r = await prisma.lateOpenRecovery.findUnique({ where: { id: recoveryId } });
    if (!r) throw err(404, "RECOVERY_NOT_FOUND", "Không tìm thấy recovery");
    const p = await prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id: r.reconciliationId } });
    const contract = await contractRepository.findById(p.contractId);
    const verdict = checkApprover({
      approverId: actor.id,
      approverRole: actor.role,
      proposerId: r.openedBy,
      investigatorId: null,
      clientUserId: contract?.clientUserId ?? "",
      ptUserId: contract?.ptUserId ?? "",
      conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
    });
    if (!verdict.ok) throw err(verdict.status, verdict.code, verdict.message);
    if (actor.id === p.proposedBy) throw err(403, "SELF_APPROVAL_FORBIDDEN", "Người đề xuất không được duyệt recovery của chính đề xuất đó");
    const events = await prisma.lateOpenReconciliationEvent.findMany({ where: { settlementRowId: p.settlementRowId }, orderBy: { createdAt: "asc" } });
    if (assigneeOf(events, []) === actor.id) throw err(403, "APPROVER_IS_ASSIGNEE", "Người đang phụ trách hồ sơ không được duyệt recovery");
    const fk = keyOf(actor, "RECOVERY_APPROVED", recoveryId, idempotencyKey);
    const requestHash = hashOf(b);
    const replay = await findReplay<Record<string, unknown>>(fk, requestHash);
    if (replay) return replay;
    if (r.approvedAt || r.outcome) throw err(409, "RECOVERY_CLOSED", "Recovery này đã được duyệt hoặc đã đóng");

    const fresh = await classifyForRecovery(p);
    const halted = fresh.klass === "HALT";
    const stamped = await mutate<{ recoveryId: string; classification: string; haltCode: string | null }>({
      actor,
      action: halted ? "RECOVERY_HALTED" : "RECOVERY_APPROVED",
      scope: recoveryId,
      idempotencyKey,
      body: b,
      contractId: p.contractId,
      run: async (tx) => {
        const u = await tx.lateOpenRecovery.updateMany({
          where: { id: r.id, approvedAt: null, outcome: null },
          data: { approvedBy: actor.id, approvedAt: new Date(), ...(halted ? { outcome: "HALTED", outcomeAt: new Date() } : {}) },
        });
        if (u.count !== 1) throw err(409, "RECOVERY_CLOSED", "Recovery này đã được duyệt hoặc đã đóng");
        return {
          result: { recoveryId: r.id, classification: fresh.klass, haltCode: fresh.haltCode ?? null },
          event: { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, note: b.reason, detail: { recoveryId: r.id, openedBy: r.openedBy, approvedBy: actor.id, classification: fresh.klass, haltCode: fresh.haltCode ?? null, observation: fresh.observation } },
        };
      },
    });
    if (halted) return { ...stamped, status: "HALTED" as const, message: fresh.message };
    const execution = await executeApproved(actor, p.id);
    await prisma.lateOpenRecovery.updateMany({ where: { id: r.id, outcome: null }, data: { outcome: "APPLIED", outcomeAt: new Date() } });
    await writeEvent(prisma, { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, contractId: p.contractId, action: "RECOVERY_APPLIED", actor, note: `Recovery ${fresh.klass}: thực thi ${execution.status}`, payload: { recoveryId: r.id, execution } });
    return { ...stamped, status: "APPLIED" as const, execution };
  },

  async rejectRecovery(actor: Actor, recoveryId: string, b: { reason: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(recoveryId, "RECOVERY_NOT_FOUND");
    const r = await prisma.lateOpenRecovery.findUnique({ where: { id: recoveryId } });
    if (!r) throw err(404, "RECOVERY_NOT_FOUND", "Không tìm thấy recovery");
    const p = await prisma.lateOpenReconciliation.findUniqueOrThrow({ where: { id: r.reconciliationId } });
    await assertNotParty(actor.id, p.contractId, "Người từ chối");
    return mutate<{ recoveryId: string; outcome: "REJECTED" }>({
      actor,
      action: "RECOVERY_REJECTED",
      scope: recoveryId,
      idempotencyKey,
      body: b,
      contractId: p.contractId,
      run: async (tx) => {
        const u = await tx.lateOpenRecovery.updateMany({ where: { id: r.id, approvedAt: null, outcome: null }, data: { outcome: "REJECTED", outcomeAt: new Date() } });
        if (u.count !== 1) throw err(409, "RECOVERY_CLOSED", "Recovery đã được duyệt hoặc đã đóng");
        return { result: { recoveryId: r.id, outcome: "REJECTED" as const }, event: { rowId: p.settlementRowId, reconciliationId: p.id, sessionId: p.sessionId, note: b.reason, detail: { recoveryId: r.id } } };
      },
    });
  },
};
