/**
 * D65-B - the four-eyes ADMIN RESOLUTION of the money HELD for one NO_SHOW session (03/11/2026).
 *
 * The situation: a PT no-show whose refund the ledger never paid (payment-service was down / the answer was lost), then the contract ended before it could be paid. The ending HELD the
 * session's value in the contract's own pending (the settlement row PT_NO_SHOW_COMPENSATION became UNCONFIRMED). Nothing could pay it: the dispute ruling accepts only DISPUTED sessions, the
 * late-open path needs a D77 and is flagged off, and resolveUnconfirmedSessionMoney had no caller. This module is that caller - for exactly ONE outcome and ONE session per action.
 *
 * What it is: propose (admin A) -> approve (admin B, B != A, neither is a party of the contract) -> the EXISTING resolveUnconfirmedSessionMoney(contractId, sessionId, "NOT_DELIVERED"),
 * i.e. the existing key UNRESOLVED_SESSION:<sessionId>. The value goes ONLY to the client, ONLY out of that contract's held pending; the ledger computes it.
 * What it is NOT: no amount, no outcome, no user id and no batch is accepted from a request (the controller bodies are strict); no DELIVERED branch; no automatic refund; not for a session
 * with a D77 trace, a Case, a ruling, or a dispute; it does not touch compensatedSessions, no_show_quota_booked_at, ptAtFault or usedSessions.
 *
 * Refusals write NOTHING (no event either): they are decided before the one transaction that writes the proposal / the approval stamp.
 * Execution is separate from approval and idempotent: a repeated approve by the recorded approver RESUMES it; the ledger de-duplicates on the key, so the money moves once however many times
 * it is replayed. The settlement sweep never runs a D65-B session's UNRESOLVED_SESSION row on its own (contract-payout assessSettlementRow waits) - a person resumes it.
 * Identity comes from the token only. The feature flag DISPUTE_CASE_D65B_RESOLUTION_ENABLED gates every mutation (route middleware + here).
 */
import { createHash } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { Prisma, SessionSettlementKind, SessionSettlementStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { contractRepository } from "../repositories/contract.repository";
import { withContractLock } from "./contract-lock";
import { checkApprover } from "./dispute-case/rules";
import { hasD77Trace } from "./dispute-case/execution-guard";
import { d65bResolutionEnabled } from "./dispute-case/flags";
import { isContractEnded, readLateOpenLedgerState, resolveUnconfirmedSessionMoney } from "./contract-payout.service";
import { paymentClient } from "../clients/payment.client";
import { notificationService } from "./notification.service";
import { formatVnd } from "./pt-fault-session-wording";

export interface Actor {
  id: string;
  role: string;
}
type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const OUTCOME = "NOT_DELIVERED" as const; // the ONLY outcome of this path; not a parameter of anything
const unresolvedKey = (sessionId: string) => `UNRESOLVED_SESSION:${sessionId}`;

function err(status: number, code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { status, code, ...(details === undefined ? {} : { details }) });
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? {})).digest("hex");
const keyOf = (actor: Actor, action: string, scope: string, key?: string) => (key ? `${actor.id}:D65B:${action}:${scope}:${key}` : null);
const isUnique = (e: unknown, target: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta ?? {}).includes(target);

function assertEnabled() {
  if (!d65bResolutionEnabled()) throw err(409, "D65B_RESOLUTION_DISABLED", "Chức năng giải quyết khoản đang giữ của buổi PT vắng đang tắt");
}
function assertAdmin(a: Actor) {
  if (a.role !== "ADMIN") throw err(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
}
/** The client and the PT of the contract may never act on it, even holding the ADMIN role. Read from the database, never from a request. */
function assertNotParty(userId: string, c: { clientUserId: string; ptUserId: string }, who: string) {
  if (userId === c.clientUserId || userId === c.ptUserId) throw err(403, "CONFLICT_OF_INTEREST", `${who} là một bên của hợp đồng nên không được thực hiện thao tác này`);
}

// ── ledger readings (read-only; an OBSERVATION stored in the audit, never an input of the money) ───────────────────────────

export interface LedgerReading {
  readAt: string;
  contractEnded: boolean;
  price: string;
  totalSessions: number;
  /** one session's value = price / totalSessions */
  unit: string;
  ownPending: { pt: string; gym: string | null; platform: string };
  /** pt + gym + platform pending of THIS contract's transaction */
  pendingTotal: string;
  lateOperationExists: boolean;
  obligation: unknown;
}

async function readLedger(contractId: string, sessionId: string): Promise<LedgerReading> {
  let read: Awaited<ReturnType<typeof readLateOpenLedgerState>>;
  try {
    read = await readLateOpenLedgerState(contractId, sessionId);
  } catch (e) {
    throw err(503, "LEDGER_UNAVAILABLE", "Không đọc được sổ cái lúc này, hãy thử lại. Chưa ghi gì.", { cause: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  if (!read) throw err(409, "CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau");
  const s = read.state;
  const pendingTotal = Number(s.ownPending.pt) + Number(s.ownPending.gym ?? 0) + Number(s.ownPending.platform);
  return {
    readAt: new Date().toISOString(),
    contractEnded: s.contractEnded,
    price: read.price,
    totalSessions: read.totalSessions,
    unit: (Number(read.price) / read.totalSessions).toFixed(2),
    ownPending: s.ownPending,
    pendingTotal: pendingTotal.toFixed(2),
    lateOperationExists: s.lateOperation.exists,
    obligation: s.obligation,
  };
}

/** The ledger must agree with the system: the ending is recorded, no D77 of this session exists there, and the contract's own pending holds one session's value. */
function assertLedgerAllows(l: LedgerReading) {
  if (!l.contractEnded) throw err(409, "LEDGER_NOT_ENDED", "Sổ cái chưa ghi nhận việc kết thúc hợp đồng, chưa giải quyết được");
  if (l.lateOperationExists || l.obligation) throw err(409, "SESSION_HAS_D77", "Sổ cái có khoản bồi thường đi muộn của buổi này: không dùng đường này");
  if (Number(l.pendingTotal) + 1 < Number(l.unit)) {
    throw err(409, "INSUFFICIENT_HELD_FUNDS", "Tiền đang giữ của hợp đồng không đủ một buổi: một người phải đối soát trước", { held: l.pendingTotal, needed: l.unit });
  }
}

// ── assessment: is this session one the path may act on? (user database only; callable inside the contract-locked transaction) ─────

type SettlementRow = NonNullable<Awaited<ReturnType<typeof sessionSettlementRepository.findById>>>;
interface Assessed {
  sessionId: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  heldRow: SettlementRow;
  contract: { id: string; clientUserId: string; ptUserId: string; compensatedSessions: number; usedSessions: number };
  quota: { compensatedSessions: number; usedSessions: number; noShowQuotaBookedAt: string | null; ptAtFault: boolean };
}

async function assessDb(db: Db, sessionId: string, mode: "PROPOSE" | "EXECUTE"): Promise<Assessed> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, contractId: true, resolvedBy: true, resolvedByCaseDecisionId: true, noShowQuotaBookedAt: true, ptAtFault: true },
  });
  if (!session) throw err(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
  const contract = await contractRepository.findById(session.contractId, db as Tx);
  if (!contract) throw err(404, "CONTRACT_NOT_FOUND", "Không tìm thấy hợp đồng của buổi tập");
  if (!contract.paymentTransactionId) throw err(409, "CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau");
  if (!isContractEnded(contract)) throw err(409, "CONTRACT_NOT_ENDED", "Hợp đồng còn đang chạy: khoản tiền của buổi này chưa bị giữ");
  if (await sessionSettlementRepository.hasUnconfirmedTermination(contract.id, db as Tx)) {
    throw err(409, "CONTRACT_ENDING", "Việc kết thúc hợp đồng chưa được xác nhận xong, chưa giải quyết được");
  }
  if (session.status === SessionStatus.DISPUTED || session.status === SessionStatus.PT_NO_SHOW_REPORTED) {
    throw err(409, "SESSION_IN_DISPUTE", "Buổi tập đang bị khiếu nại: phải đi qua hồ sơ khiếu nại", { status: session.status });
  }
  if (session.status !== SessionStatus.NO_SHOW) throw err(409, "SESSION_NOT_NO_SHOW", "Chỉ áp dụng cho buổi PT vắng mặt (NO_SHOW)", { status: session.status });
  if (session.resolvedBy || session.resolvedByCaseDecisionId) throw err(409, "SESSION_WENT_THROUGH_DISPUTE", "Buổi tập đã được phán quyết: không dùng đường này");
  const anyCase = await db.disputeCase.findFirst({ where: { sessionId, status: { not: "REJECTED_INTAKE" } }, select: { id: true, status: true } });
  if (anyCase) throw err(409, "CASE_EXISTS", "Buổi tập đã có hồ sơ khiếu nại: phải đi qua hồ sơ", { caseStatus: anyCase.status });
  if (await hasD77Trace(db as Tx, sessionId)) throw err(409, "SESSION_HAS_D77", "Buổi tập có khoản bồi thường đi muộn (D77): không dùng đường này");

  const heldRow = await db.sessionSettlement.findFirst({ where: { contractId: contract.id, sessionId, kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION } });
  if (!heldRow) throw err(409, "NO_HELD_ROW", "Buổi tập không có dòng bồi thường PT vắng mặt");
  if (heldRow.status !== SessionSettlementStatus.UNCONFIRMED) {
    throw err(409, "ROW_NOT_HELD", "Dòng bồi thường của buổi này không ở trạng thái đang giữ (UNCONFIRMED)", { status: heldRow.status });
  }
  const resolving = await db.sessionSettlement.findUnique({ where: { idempotencyKey: unresolvedKey(sessionId) } });
  if (resolving) {
    if (mode === "PROPOSE") throw err(409, "ALREADY_RESOLVING", "Buổi tập đã có bước giải quyết khoản giữ", { status: resolving.status });
    if (resolving.reason !== OUTCOME) throw err(409, "RESOLVED_OTHER_WAY", "Buổi tập đã được giải quyết theo hướng khác", { reason: resolving.reason });
    if (resolving.status === SessionSettlementStatus.SETTLED) throw err(409, "ROW_ALREADY_SETTLED", "Bước giải quyết đã hoàn tất");
  }
  return {
    sessionId,
    contractId: contract.id,
    clientUserId: contract.clientUserId,
    ptUserId: contract.ptUserId,
    heldRow,
    contract: { id: contract.id, clientUserId: contract.clientUserId, ptUserId: contract.ptUserId, compensatedSessions: contract.compensatedSessions, usedSessions: contract.usedSessions },
    quota: {
      compensatedSessions: contract.compensatedSessions,
      usedSessions: contract.usedSessions,
      noShowQuotaBookedAt: session.noShowQuotaBookedAt ? session.noShowQuotaBookedAt.toISOString() : null,
      ptAtFault: session.ptAtFault,
    },
  };
}

// ── events + idempotent mutation helper ─────────────────────────────────────────────────────────────────────────────────────

interface EventInput {
  resolutionId: string;
  rowId: string;
  sessionId: string;
  contractId: string;
  action: string;
  actor: Actor;
  note?: string | null;
  payload?: unknown;
  idempotencyKey?: string | null;
}
const writeEvent = (db: Db, e: EventInput) =>
  db.d65bResolutionEvent.create({
    data: {
      resolutionId: e.resolutionId,
      settlementRowId: e.rowId,
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

async function findReplay<T>(key: string | null, requestHash: string): Promise<(T & { replayed: true }) | null> {
  if (!key) return null;
  const prior = await prisma.d65bResolutionEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) throw err(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
  return { ...(p.result as T), replayed: true };
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Resolution = NonNullable<Awaited<ReturnType<typeof prisma.d65bResolution.findUnique>>>;
const statusOf = (r: Pick<Resolution, "approvedAt" | "outcome">) => (r.outcome === "EXECUTED" ? "EXECUTED" : r.approvedAt ? "APPROVED_NOT_EXECUTED" : "PROPOSED");

const summaryOf = (r: Resolution) => ({
  id: r.id,
  sessionId: r.sessionId,
  contractId: r.contractId,
  status: statusOf(r),
  reason: r.reason,
  evidenceRefs: r.evidenceRefs,
  proposedBy: r.proposedBy,
  createdAt: r.createdAt,
  approvedBy: r.approvedBy,
  approvedAt: r.approvedAt,
  approvalReason: r.approvalReason,
  outcome: r.outcome,
  outcomeAt: r.outcomeAt,
});

export interface ExecutionResult {
  status: "EXECUTED" | "NOT_EXECUTED";
  code?: string;
  message?: string;
  creditedToClient?: string;
  replayed?: boolean;
}

/** What the system knows about one session right now, read-only: may this path act on it, and the ledger reading. Writes nothing. */
async function previewSession(sessionId: string) {
  let assessment: { eligible: boolean; code?: string; message?: string } = { eligible: true };
  let ledger: LedgerReading | null = null;
  const resolution = await prisma.d65bResolution.findUnique({ where: { sessionId } });
  try {
    await assessDb(prisma, sessionId, resolution ? "EXECUTE" : "PROPOSE");
  } catch (e: any) {
    assessment = { eligible: false, code: e?.code ?? "ASSESSMENT_FAILED", message: String(e?.message ?? e).slice(0, 300) };
  }
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { contractId: true, status: true } });
  if (session) {
    try {
      ledger = await readLedger(session.contractId, sessionId);
      if (assessment.eligible) assertLedgerAllows(ledger);
    } catch (e: any) {
      if (assessment.eligible) assessment = { eligible: false, code: e?.code ?? "LEDGER_CHECK_FAILED", message: String(e?.message ?? e).slice(0, 300) };
    }
  }
  return { sessionId, sessionStatus: session?.status ?? null, assessment, ledger, resolution: resolution ? summaryOf(resolution) : null };
}

// ── the service ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const d65bResolutionService = {
  // ── reads (open even when the flag is off) ──
  async list(actor: Actor, opts: { limit?: number } = {}) {
    assertAdmin(actor);
    const rows = await prisma.d65bResolution.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(opts.limit ?? 50, 1), 200) });
    return { items: rows.map(summaryOf) };
  },

  async get(actor: Actor, id: string) {
    assertAdmin(actor);
    if (!UUID_RE.test(id)) throw err(404, "RESOLUTION_NOT_FOUND", "Không tìm thấy đề xuất");
    const r = await prisma.d65bResolution.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    if (!r) throw err(404, "RESOLUTION_NOT_FOUND", "Không tìm thấy đề xuất");
    const row = await prisma.sessionSettlement.findUnique({ where: { id: r.settlementRowId }, select: { status: true, lastError: true } });
    const resolving = await prisma.sessionSettlement.findUnique({ where: { idempotencyKey: unresolvedKey(r.sessionId) }, select: { status: true, reason: true, attempts: true, lastError: true } });
    return {
      ...summaryOf(r),
      clientUserId: r.clientUserId,
      ptUserId: r.ptUserId,
      /** ledger reading when the proposal was made, and after the execution (null until executed) */
      ledgerBefore: r.ledgerBefore,
      ledgerAfter: r.ledgerAfter,
      heldRowStatus: row?.status ?? null,
      resolutionRowStatus: resolving?.status ?? null,
      resolutionRowError: resolving?.lastError ? String(resolving.lastError).slice(0, 300) : null,
      history: r.events.map((e) => ({ at: e.createdAt, action: e.action, actor: e.actorUserId, role: e.actorRole, note: e.note, payload: (e.payload as { detail?: unknown } | null)?.detail ?? null })),
    };
  },

  /** Eligibility preview of ONE session + its proposal if any. Read-only. */
  async getBySession(actor: Actor, sessionId: string) {
    assertAdmin(actor);
    return previewSession(sessionId);
  },

  // ── propose ──
  async propose(actor: Actor, sessionId: string, b: { reason: string; evidenceRefs: string[] }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    const fk = keyOf(actor, "PROPOSED", sessionId, idempotencyKey);
    const requestHash = hashOf(b);
    const replay = await findReplay<ReturnType<typeof summaryOf>>(fk, requestHash);
    if (replay) return replay;

    // refusals first: nothing is written until every check passed
    const head = await prisma.session.findUnique({ where: { id: sessionId }, select: { contractId: true } });
    if (!head) throw err(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
    const c0 = await contractRepository.findById(head.contractId);
    if (!c0) throw err(404, "CONTRACT_NOT_FOUND", "Không tìm thấy hợp đồng của buổi tập");
    assertNotParty(actor.id, c0, "Người đề xuất");
    await assessDb(prisma, sessionId, "PROPOSE"); // the system's own facts first (specific codes), then the ledger
    const ledgerBefore = await readLedger(head.contractId, sessionId);
    assertLedgerAllows(ledgerBefore);

    try {
      return await withContractLock(head.contractId, async (tx) => {
        const a = await assessDb(tx, sessionId, "PROPOSE");
        assertNotParty(actor.id, a.contract, "Người đề xuất");
        const existing = await tx.d65bResolution.findUnique({ where: { sessionId } });
        if (existing) throw err(409, "PROPOSAL_ALREADY_EXISTS", "Buổi tập này đã có đề xuất (mỗi buổi chỉ một lần)", { resolutionId: existing.id, status: statusOf(existing) });
        const created = await tx.d65bResolution.create({
          data: {
            sessionId,
            contractId: a.contractId,
            settlementRowId: a.heldRow.id,
            clientUserId: a.clientUserId,
            ptUserId: a.ptUserId,
            reason: b.reason,
            evidenceRefs: b.evidenceRefs,
            proposedBy: actor.id,
            ledgerBefore: toJson({ ledger: ledgerBefore, quota: a.quota, heldRowStatus: a.heldRow.status }),
          },
        });
        const result = summaryOf(created);
        await writeEvent(tx, {
          resolutionId: created.id,
          rowId: a.heldRow.id,
          sessionId,
          contractId: a.contractId,
          action: "PROPOSED",
          actor,
          note: b.reason,
          idempotencyKey: fk,
          payload: { requestHash, result, detail: { evidenceRefs: b.evidenceRefs, ledgerBefore, quota: a.quota } },
        });
        return result;
      });
    } catch (e) {
      if (fk && isUnique(e, "idempotency_key")) {
        const again = await findReplay<ReturnType<typeof summaryOf>>(fk, requestHash);
        if (again) return again;
      }
      if (isUnique(e, "session_id") || isUnique(e, "settlement_row_id")) throw err(409, "PROPOSAL_ALREADY_EXISTS", "Buổi tập này đã có đề xuất (mỗi buổi chỉ một lần)");
      throw e;
    }
  },

  // ── approve (+ resume) ──
  async approve(actor: Actor, id: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    if (!UUID_RE.test(id)) throw err(404, "RESOLUTION_NOT_FOUND", "Không tìm thấy đề xuất");
    const r0 = await prisma.d65bResolution.findUnique({ where: { id } });
    if (!r0) throw err(404, "RESOLUTION_NOT_FOUND", "Không tìm thấy đề xuất");
    const contract = await contractRepository.findById(r0.contractId);
    if (!contract) throw err(404, "CONTRACT_NOT_FOUND", "Không tìm thấy hợp đồng");

    // a repeated approve by the RECORDED approver is a RESUME of the execution (idempotent); anybody else is refused
    if (r0.approvedAt) {
      if (r0.approvedBy !== actor.id) throw err(409, "PROPOSAL_ALREADY_APPROVED", "Đề xuất này đã được người khác duyệt");
      assertNotParty(actor.id, contract, "Người duyệt");
      const execution = await execute(actor, r0.id);
      return { ...summaryOf((await prisma.d65bResolution.findUniqueOrThrow({ where: { id } }))), execution, resumed: true };
    }

    const verdict = checkApprover({
      approverId: actor.id,
      approverRole: actor.role,
      proposerId: r0.proposedBy,
      investigatorId: null,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
    });
    if (!verdict.ok) throw err(verdict.status, verdict.code, verdict.message);
    // the system's facts and the ledger must still agree (re-checked now, not trusted from the proposal)
    await assessDb(prisma, r0.sessionId, "PROPOSE");
    const ledgerAtApproval = await readLedger(r0.contractId, r0.sessionId);
    assertLedgerAllows(ledgerAtApproval);

    const fk = keyOf(actor, "APPROVED", id, idempotencyKey);
    const requestHash = hashOf(b);
    const prior = await findReplay<ReturnType<typeof summaryOf>>(fk, requestHash);
    if (prior) return prior;

    try {
      await withContractLock(r0.contractId, async (tx) => {
        const a = await assessDb(tx, r0.sessionId, "PROPOSE"); // nothing has started: no UNRESOLVED row yet
        assertNotParty(actor.id, a.contract, "Người duyệt");
        const won = await tx.d65bResolution.updateMany({
          where: { id, approvedAt: null, outcome: null },
          data: { approvedBy: actor.id, approvedAt: new Date(), approvalReason: b.reason },
        });
        if (won.count !== 1) throw err(409, "PROPOSAL_ALREADY_APPROVED", "Đề xuất này đã được duyệt");
        await writeEvent(tx, {
          resolutionId: id,
          rowId: r0.settlementRowId,
          sessionId: r0.sessionId,
          contractId: r0.contractId,
          action: "APPROVED",
          actor,
          note: b.reason,
          idempotencyKey: fk,
          payload: { requestHash, result: { id, approved: true }, detail: { proposedBy: r0.proposedBy, conflictOfInterestDeclaredNone: true, ledgerAtApproval, quota: a.quota } },
        });
      });
    } catch (e: any) {
      // the SAME admin pressing twice: the second press resumes instead of failing
      if (e?.code === "PROPOSAL_ALREADY_APPROVED") {
        const cur = await prisma.d65bResolution.findUnique({ where: { id } });
        if (cur?.approvedBy === actor.id) {
          const execution = await execute(actor, id);
          return { ...summaryOf(await prisma.d65bResolution.findUniqueOrThrow({ where: { id } })), execution, resumed: true };
        }
      }
      if (fk && isUnique(e, "idempotency_key")) {
        const again = await findReplay<ReturnType<typeof summaryOf>>(fk, requestHash);
        if (again) return again;
      }
      throw e;
    }
    const execution = await execute(actor, id);
    return { ...summaryOf(await prisma.d65bResolution.findUniqueOrThrow({ where: { id } })), execution };
  },
};

// ── execution: after the approval stamp; outside every lock and transaction around the HTTP call ────────────────────────────

async function execute(actor: Actor, id: string): Promise<ExecutionResult> {
  const r = await prisma.d65bResolution.findUniqueOrThrow({ where: { id } });
  const base = { resolutionId: id, rowId: r.settlementRowId, sessionId: r.sessionId, contractId: r.contractId, actor };
  if (!r.approvedAt) throw err(409, "NOT_APPROVED", "Đề xuất chưa được duyệt");
  if (r.outcome === "EXECUTED") return { status: "EXECUTED", replayed: true, creditedToClient: (r.ledgerAfter as { creditedToClient?: string } | null)?.creditedToClient };

  const held = await prisma.sessionSettlement.findUnique({ where: { id: r.settlementRowId } });
  const resolving = await prisma.sessionSettlement.findUnique({ where: { idempotencyKey: unresolvedKey(r.sessionId) } });
  const alreadyDone = held?.status === SessionSettlementStatus.SETTLED && resolving?.status === SessionSettlementStatus.SETTLED && resolving.reason === OUTCOME;

  let ledgerBefore: LedgerReading | null = null;
  if (!alreadyDone) {
    // the premise is re-checked at execution (a Case may have been opened since the approval): a refusal here writes one BLOCKED event (the approval exists)
    try {
      await withContractLock(r.contractId, (tx) => assessDb(tx, r.sessionId, "EXECUTE"));
      ledgerBefore = await readLedger(r.contractId, r.sessionId);
      // a resume after a lost answer: the ledger may already have done it (pending already dropped) - then the key replays and nothing more is paid
      const done = await paymentClient.lookupLedgerOperation(unresolvedKey(r.sessionId)).catch(() => undefined);
      if (!done) assertLedgerAllows(ledgerBefore);
    } catch (e: any) {
      // only a REFUSAL of the premise is audited (409); "the ledger cannot be read" (503) says nothing about the premise
      if (e?.status === 409) await writeEvent(prisma, { ...base, action: "EXECUTION_BLOCKED", note: String(e?.message ?? e).slice(0, 300), payload: { detail: { code: e?.code ?? null } } }).catch(() => {});
      throw e;
    }
    await writeEvent(prisma, { ...base, action: "EXECUTION_STARTED", payload: { detail: { ledgerBefore } } });
    let answer: Awaited<ReturnType<typeof resolveUnconfirmedSessionMoney>> | { state: "THREW"; error: string };
    try {
      answer = await resolveUnconfirmedSessionMoney(r.contractId, r.sessionId, OUTCOME);
    } catch (e) {
      answer = { state: "THREW", error: String((e as Error)?.message ?? e).slice(0, 300) };
    }
    const settled = answer.state === "SETTLED" || answer.state === "ALREADY_SETTLED";
    if (!settled) {
      const code = `LEDGER_${answer.state}`;
      await writeEvent(prisma, { ...base, action: "EXECUTION_FAILED", note: code, payload: { detail: { state: answer.state, error: (answer as { error?: string }).error ?? null } } });
      logger.warn({ message: "[D65B] execution did not confirm - the held row stays UNCONFIRMED, nothing is marked paid", resolutionId: id, state: answer.state });
      return { status: "NOT_EXECUTED", code, message: "Chưa xác nhận được khoản hoàn từ sổ cái. Khoản vẫn đang giữ, chưa ghi đã hoàn. Duyệt lại cùng đề xuất để chạy tiếp." };
    }
  }
  return finalize(actor, r, ledgerBefore);
}

/** The ledger credit is CONFIRMED (the key's stored operation says what moved): only now the outcome is stamped and the client told. */
async function finalize(actor: Actor, r: Resolution, ledgerBefore: LedgerReading | null): Promise<ExecutionResult> {
  const base = { resolutionId: r.id, rowId: r.settlementRowId, sessionId: r.sessionId, contractId: r.contractId, actor };
  const op = await paymentClient.lookupLedgerOperation(unresolvedKey(r.sessionId)).catch(() => null);
  const moved = (op?.result as { moved?: { client?: string; pt?: string; gym?: string; platform?: string } } | undefined)?.moved;
  const credited = moved?.client !== undefined ? Number(moved.client) : NaN;
  if (!op || !Number.isFinite(credited) || credited <= 0) {
    await writeEvent(prisma, { ...base, action: "EXECUTION_NO_CREDIT", note: "Sổ cái không xác nhận khoản hoàn cho khách", payload: { detail: { operationFound: !!op, moved: moved ?? null } } });
    return { status: "NOT_EXECUTED", code: "LEDGER_CREDIT_NOT_CONFIRMED", message: "Sổ cái chưa xác nhận khoản hoàn cho khách. Chưa ghi đã hoàn." };
  }
  let after: LedgerReading | null = null;
  try {
    after = await readLedger(r.contractId, r.sessionId);
  } catch {
    after = null;
  }
  const before = ledgerBefore ?? ((r.ledgerBefore as { ledger?: LedgerReading } | null)?.ledger ?? null);
  const ledgerAfter = {
    ledger: after,
    creditedToClient: credited.toFixed(2),
    moved,
    operationKey: unresolvedKey(r.sessionId),
    pendingBefore: before?.pendingTotal ?? null,
    pendingAfter: after?.pendingTotal ?? null,
  };
  const session = await prisma.session.findUnique({ where: { id: r.sessionId }, select: { noShowQuotaBookedAt: true, ptAtFault: true } });
  const c = await prisma.contract.findUnique({ where: { id: r.contractId }, select: { compensatedSessions: true, usedSessions: true } });
  const won = await prisma.d65bResolution.updateMany({
    where: { id: r.id, outcome: null, approvedAt: { not: null } },
    data: { outcome: "EXECUTED", outcomeAt: new Date(), ledgerAfter: toJson({ ...ledgerAfter, quotaAfter: { compensatedSessions: c?.compensatedSessions, usedSessions: c?.usedSessions, noShowQuotaBookedAt: session?.noShowQuotaBookedAt ?? null, ptAtFault: session?.ptAtFault } }) },
  });
  if (won.count === 1) {
    await writeEvent(prisma, { ...base, action: "EXECUTED", note: "Đã hoàn khoản đang giữ cho khách qua sổ cái", payload: { detail: ledgerAfter } });
    await notificationService
      .create({
        userId: r.clientUserId,
        text: `Đã hoàn ${formatVnd(credited.toFixed(2))}đ vào ví cho buổi tập huấn luyện viên vắng mặt (khoản đang giữ đã được quản trị viên đối soát).`,
        eventType: "SESSION_DISPUTE_RESOLVED",
        entityType: "SESSION",
        entityId: r.sessionId,
        link: "/client/wallet",
      })
      .catch(() => {});
  }
  return { status: "EXECUTED", creditedToClient: credited.toFixed(2) };
}
