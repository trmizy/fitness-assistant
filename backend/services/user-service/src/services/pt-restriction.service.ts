import { logger } from "@gym-coach/shared";
import {
  AuditEntityType,
  ContractStatus,
  Prisma,
  PtRestriction,
  PtRestrictionEndKind,
  PtRestrictionReasonCategory,
  PtRestrictionScope,
  PtRestrictionType,
  SessionSettlementKind,
  SessionSettlementStatus,
  SessionStatus,
} from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { auditService, SYSTEM_ACTOR } from "./audit.service";
import { notificationService } from "./notification.service";
import { resolveSessionOutcome } from "./session-outcome";
import { endOpenRoomCall } from "./open-room-call.service";
import { totalGiveBackMs, uncoveredMs, type Span } from "./pt-restriction-intervals";
import { acquirePtLock, ptTxOptions } from "./contract-lock";

/**
 * PT-suspension slices 2–3 — the temporary suspension that does NOT end contracts.
 *
 * Design "option B": a contract stays ACTIVE in the database. What is paused is the PT, recorded as
 * a PtRestriction episode (see the model's comment in schema.prisma for the history/flag rules), and
 * ONE function — {@link getEffectiveContractStatus} — answers "is this contract running or paused".
 * Nothing with business impact may decide on `contract.status === ACTIVE` alone where being paused
 * matters; the readers that had to change are listed in the slice report (docs/PT_SUSPENSION_AUDIT.md,
 * "Lát 2–3 đã đổi gì").
 *
 * All times here are INSTANTS (UTC timestamps). Every duration is a difference of two instants in
 * milliseconds — no calendar days, no time zone, no DST: a contract's end date moves by exactly the
 * milliseconds it was blocked.
 *
 * THREE LEVELS (owner's decision D38, Phase 2.5A): CONTRACT scope (one contract; the default for an
 * individual complaint), ACCOUNT scope (the PT-wide temporary suspension built in slices 2–3) and the
 * permanent ban. They live in the one table, told apart by \`scope\` (+ \`contractId\`). The rule that keeps
 * every older caller right by default: {@link getActiveRestriction} and {@link assertPtMayAct} /
 * {@link assertPtAcceptsNewBusiness} answer the ACCOUNT question ("is this PT restricted as a whole"), so
 * a contract restriction never hides a PT from discovery, stops a new contract or blocks another client.
 * Anything that is about ONE contract asks {@link getBlockingRestriction} / {@link assertPtMayActOnContract} /
 * {@link assertContractAcceptsClientAction}, which add the contract's own episode to the account one.
 * Effective status of a contract = stored status + account restriction (if any) + contract restriction (if any).
 */

type Db = typeof prisma | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An episode still active this many days after it started — or after the last time an admin
 * justified continuing it — is reported as overdue. Reporting is ALL it does: no auto-lift, no
 * auto-fault, no money.
 */
export const PT_RESTRICTION_OVERDUE_DAYS = Number(process.env.PT_RESTRICTION_OVERDUE_DAYS ?? 14);

/** Machine-readable codes of every refusal this module produces. */
export const PT_TEMPORARILY_UNAVAILABLE = "PT_TEMPORARILY_UNAVAILABLE";
export const PT_ACCOUNT_LOCKED = "PT_ACCOUNT_LOCKED";
export const PT_ALREADY_BANNED = "PT_ALREADY_BANNED";
export const PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK = "PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK";
export const NO_ACTIVE_SUSPENSION = "NO_ACTIVE_SUSPENSION";
/** The refusal for one paused contract (CONTRACT scope): the PT is otherwise fine, only this contract is. */
export const CONTRACT_PAUSED_BY_ADMIN = "CONTRACT_PAUSED_BY_ADMIN";
export const CONTRACT_NOT_FOUND = "CONTRACT_NOT_FOUND";
export const CONTRACT_NOT_RESTRICTABLE = "CONTRACT_NOT_RESTRICTABLE";
export const NO_ACTIVE_CONTRACT_RESTRICTION = "NO_ACTIVE_CONTRACT_RESTRICTION";
export const SCOPE_CHANGE_INVALID = "SCOPE_CHANGE_INVALID";

/** What the system tells a client about a session it called off because the PT was suspended. */
export const ADMIN_INTERRUPTION_CANCEL_REASON =
  "Buổi tập được tạm hoãn do gián đoạn hành chính (không phải lỗi của bạn). Buổi này không bị trừ và không bị tính vắng mặt; bạn có thể đặt lại khi huấn luyện viên hoạt động trở lại.";

const SESSION_CANCELLED_PT_SUSPENSION = "SESSION_CANCELLED_PT_SUSPENSION";

/** What a PT may be told about the category (never the admin's internal note). */
const CATEGORY_PUBLIC_LABEL: Record<PtRestrictionReasonCategory, string> = {
  COMPLAINT_REVIEW: "Đang xem xét một phản ánh liên quan đến tài khoản",
  CONDUCT_REVIEW: "Đang xem xét hoạt động huấn luyện",
  PAYMENT_REVIEW: "Đang đối soát thanh toán",
  DOCUMENT_VERIFICATION: "Cần xác minh lại hồ sơ, chứng chỉ",
  ACCOUNT_SECURITY: "Đang kiểm tra bảo mật tài khoản",
  OTHER: "Tạm hạn chế theo quyết định của quản trị viên",
  UNSPECIFIED: "Tạm hạn chế theo quyết định của quản trị viên",
};

export const PT_RESTRICTION_REASON_CATEGORIES = Object.keys(CATEGORY_PUBLIC_LABEL) as PtRestrictionReasonCategory[];

// ── errors ─────────────────────────────────────────────────────────────────────────────────

export class PtRestrictionError extends Error {
  status: number;
  code: string;
  restrictionType?: PtRestrictionType;
  constructor(message: string, status: number, code: string, restrictionType?: PtRestrictionType) {
    super(message);
    this.name = "PtRestrictionError";
    this.status = status;
    this.code = code;
    this.restrictionType = restrictionType;
  }
}

/** Who is being refused: a client / business flow aimed AT the PT, or the PT acting for themselves. */
export type PtGuardAudience = "CLIENT" | "PT";

export type ClientFacingAction =
  | "REQUEST_CONTRACT"
  | "PAY_CONTRACT"
  | "BOOK_SESSION"
  | "REPORT_PT_NO_SHOW"
  | "RESCHEDULE";

const CLIENT_MESSAGES: Record<ClientFacingAction, string> = {
  REQUEST_CONTRACT:
    "Huấn luyện viên này tạm thời chưa nhận hợp đồng mới. Bạn có thể quay lại sau hoặc chọn huấn luyện viên khác.",
  PAY_CONTRACT:
    "Huấn luyện viên này tạm thời chưa thể bắt đầu hợp đồng mới nên chưa thể thanh toán lúc này. Bạn chưa bị trừ tiền. Hợp đồng chưa thanh toán giữ nguyên đến hết hạn thanh toán.",
  BOOK_SESSION:
    "Huấn luyện viên đang tạm dừng nhận lịch. Hợp đồng và số buổi còn lại của bạn được giữ nguyên, thời hạn sẽ được cộng bù. Bạn đặt lịch lại được khi huấn luyện viên hoạt động trở lại.",
  REPORT_PT_NO_SHOW:
    "Huấn luyện viên đang tạm dừng hoạt động nên chưa tiếp nhận được báo cáo này. Buổi tập được giữ nguyên, bạn không bị mất gì; hãy gửi lại khi huấn luyện viên hoạt động trở lại.",
  RESCHEDULE:
    "Huấn luyện viên đang tạm dừng nhận lịch nên chưa thể dời lịch lúc này. Bạn đặt lịch lại được khi huấn luyện viên hoạt động trở lại.",
};

const PT_RESTRICTED_MODE_MESSAGE =
  "Tài khoản của bạn đang ở chế độ hạn chế tạm thời nên chưa thực hiện được thao tác này. Bạn vẫn xem được hợp đồng, lịch, ví và thông báo. Vui lòng liên hệ hỗ trợ nếu cần biết thêm.";

/** CONTRACT scope: said about ONE contract. It never suggests the PT, or any other client, is affected. */
const CONTRACT_PT_MESSAGE =
  "Hợp đồng này đang tạm dừng theo quyết định của quản trị viên nên bạn chưa thực hiện được thao tác này trên hợp đồng đó. Các hợp đồng khác của bạn vẫn hoạt động bình thường. Vui lòng liên hệ hỗ trợ nếu cần biết thêm.";

const CONTRACT_CLIENT_MESSAGES: Record<ClientFacingAction, string> = {
  REQUEST_CONTRACT: "Huấn luyện viên này tạm thời chưa nhận hợp đồng mới.",
  PAY_CONTRACT: "Hợp đồng này tạm thời chưa thể thanh toán lúc này. Bạn chưa bị trừ tiền.",
  BOOK_SESSION:
    "Hợp đồng của bạn đang tạm dừng nên chưa đặt lịch được. Hợp đồng và số buổi còn lại của bạn được giữ nguyên, thời hạn sẽ được cộng bù. Bạn đặt lịch lại được khi hợp đồng hoạt động trở lại, hoặc kết thúc hợp đồng để được hoàn lại phần chưa tập, không mất phí.",
  REPORT_PT_NO_SHOW:
    "Hợp đồng của bạn đang tạm dừng nên chưa tiếp nhận được báo cáo này. Buổi tập được giữ nguyên, bạn không bị mất gì; hãy gửi lại khi hợp đồng hoạt động trở lại.",
  RESCHEDULE:
    "Hợp đồng của bạn đang tạm dừng nên chưa dời lịch được. Bạn đặt lịch lại được khi hợp đồng hoạt động trở lại.",
};

function refusal(
  restriction: Pick<PtRestriction, "type"> & Partial<Pick<PtRestriction, "scope">>,
  audience: PtGuardAudience,
  action?: ClientFacingAction,
): PtRestrictionError {
  if (restriction.scope === PtRestrictionScope.CONTRACT) {
    return new PtRestrictionError(
      audience === "PT" ? CONTRACT_PT_MESSAGE : CONTRACT_CLIENT_MESSAGES[action ?? "BOOK_SESSION"],
      409,
      CONTRACT_PAUSED_BY_ADMIN,
      restriction.type,
    );
  }
  const temporary = restriction.type === PtRestrictionType.TEMPORARY_SUSPENSION;
  const message =
    audience === "PT"
      ? PT_RESTRICTED_MODE_MESSAGE
      : temporary
        ? CLIENT_MESSAGES[action ?? "BOOK_SESSION"]
        : "Huấn luyện viên này hiện không nhận lịch hoặc hợp đồng mới.";
  return new PtRestrictionError(
    message,
    409,
    temporary ? PT_TEMPORARILY_UNAVAILABLE : PT_ACCOUNT_LOCKED,
    restriction.type,
  );
}

// ── reading the restriction ────────────────────────────────────────────────────────────────

/**
 * The PT's active ACCOUNT-level restriction (temporary suspension or ban), or null. A restriction on a
 * single contract is NOT returned here: it does not restrict the PT, only that contract (see
 * {@link getActiveContractRestriction} / {@link getBlockingRestriction}). The restriction table is the
 * truth; the profile flag is its mirror. A flag that is set with NO matching row (legacy data, or
 * drift) fails CLOSED: it is reported as a synthetic permanent ban rather than silently allowing
 * business. `id` is "LEGACY_FLAG" for such a synthetic row.
 */
export async function getActiveRestriction(ptUserId: string, db: Db = prisma): Promise<PtRestriction | null> {
  const row = await db.ptRestriction.findFirst({ where: { ptUserId, endedAt: null, scope: PtRestrictionScope.ACCOUNT } });
  if (row) return row;
  const profile = await db.userProfile.findUnique({
    where: { userId: ptUserId },
    select: { ptSuspended: true, updatedAt: true },
  });
  if (profile?.ptSuspended) return legacyFlagRestriction(ptUserId, profile.updatedAt);
  return null;
}

function legacyFlagRestriction(ptUserId: string, since: Date): PtRestriction {
  return {
    id: "LEGACY_FLAG",
    ptUserId,
    type: PtRestrictionType.PERMANENT_BAN,
    reasonCategory: PtRestrictionReasonCategory.UNSPECIFIED,
    reasonText: "pt_suspended flag set without a restriction record",
    publicReason: null,
    imposedBy: SYSTEM_ACTOR,
    lockSeq: null,
    startedAt: since,
    endedAt: null,
    endKind: null,
    liftedBy: null,
    liftReason: null,
    lastJustifiedAt: null,
    lastJustifiedBy: null,
    lastJustification: null,
    scope: PtRestrictionScope.ACCOUNT,
    contractId: null,
    supersedesRestrictionId: null,
    createdAt: since,
    updatedAt: since,
  };
}

/** The active restriction placed on ONE contract (CONTRACT scope), or null. */
export async function getActiveContractRestriction(contractId: string, db: Db = prisma): Promise<PtRestriction | null> {
  return db.ptRestriction.findFirst({ where: { contractId, scope: PtRestrictionScope.CONTRACT, endedAt: null } });
}

/**
 * What blocks coaching on this contract right now: the PT's account restriction if there is one, else
 * the contract's own. Null = the contract is running. The account restriction wins only for the answer
 * (it is the wider one); both can exist at once and each is lifted on its own.
 */
export async function getBlockingRestriction(
  contract: { id: string; ptUserId: string },
  db: Db = prisma,
): Promise<PtRestriction | null> {
  return (await getActiveRestriction(contract.ptUserId, db)) ?? (await getActiveContractRestriction(contract.id, db));
}

/** Every contract that has its own active restriction right now (the sweeps and the idle clock skip these). */
export async function activeRestrictedContractIds(db: Db = prisma): Promise<string[]> {
  const rows = await db.ptRestriction.findMany({
    where: { scope: PtRestrictionScope.CONTRACT, endedAt: null },
    select: { contractId: true },
  });
  return rows.map((r) => r.contractId).filter((id): id is string => !!id);
}

/**
 * Every PT that is restricted AS A WHOLE right now (either type; includes the fail-closed flag-only
 * case). A PT with only a contract restriction is not in this list: their other contracts keep running
 * (use {@link activeRestrictedContractIds} for the contracts that are paused on their own).
 */
export async function activeRestrictedPtUserIds(db: Db = prisma): Promise<string[]> {
  const [rows, flagged] = await Promise.all([
    db.ptRestriction.findMany({ where: { endedAt: null, scope: PtRestrictionScope.ACCOUNT }, select: { ptUserId: true } }),
    db.userProfile.findMany({ where: { ptSuspended: true }, select: { userId: true } }),
  ]);
  return [...new Set([...rows.map((r) => r.ptUserId), ...flagged.map((p) => p.userId)])];
}

/** A contract's status as the rest of the system should act on it. */
export type EffectiveContractStatus = ContractStatus | "PAUSED_BY_ADMIN";

/** Pure form: the effective status given the PT's active restriction (or null). */
export function effectiveStatusOf(status: ContractStatus, restriction: Pick<PtRestriction, "type"> | null): EffectiveContractStatus {
  return status === ContractStatus.ACTIVE && restriction ? "PAUSED_BY_ADMIN" : status;
}

/**
 * THE central check. An ACTIVE contract whose PT is restricted as a whole (temporarily suspended, or
 * banned and not yet unwound) OR that has its own contract restriction is PAUSED_BY_ADMIN: still
 * ACTIVE in the database, but nothing may progress, expire, release or be booked on it. Every other
 * status is its own effective status.
 */
export async function getEffectiveContractStatus(
  contract: { id: string; status: ContractStatus; ptUserId: string },
  db: Db = prisma,
): Promise<EffectiveContractStatus> {
  if (contract.status !== ContractStatus.ACTIVE) return contract.status;
  return effectiveStatusOf(contract.status, await getBlockingRestriction(contract, db));
}

/**
 * Batch form for list endpoints: one query for the distinct PTs, one for the contracts' own
 * restrictions. Also answers, per contract, `canExitWithoutPenalty` (the client may end it now for a
 * full refund of the unused value and no fee) — derived from the same restriction read, through
 * {@link canExitWithoutPenalty}.
 */
export async function getEffectiveContractStatuses<
  T extends { id: string; status: ContractStatus; ptUserId: string } & Partial<ExitContractFacts>,
>(
  contracts: T[],
  db: Db = prisma,
): Promise<Array<T & { effectiveStatus: EffectiveContractStatus; canExitWithoutPenalty: boolean }>> {
  const active = contracts.filter((c) => c.status === ContractStatus.ACTIVE);
  const needCheck = [...new Set(active.map((c) => c.ptUserId))];
  const restricted = new Set<string>();
  const pausedContracts = new Set<string>();
  if (needCheck.length > 0) {
    const [rows, flagged, own] = await Promise.all([
      db.ptRestriction.findMany({
        where: { ptUserId: { in: needCheck }, endedAt: null, scope: PtRestrictionScope.ACCOUNT },
        select: { ptUserId: true },
      }),
      db.userProfile.findMany({ where: { userId: { in: needCheck }, ptSuspended: true }, select: { userId: true } }),
      db.ptRestriction.findMany({
        where: { contractId: { in: active.map((c) => c.id) }, scope: PtRestrictionScope.CONTRACT, endedAt: null },
        select: { contractId: true },
      }),
    ]);
    rows.forEach((r) => restricted.add(r.ptUserId));
    flagged.forEach((p) => restricted.add(p.userId));
    own.forEach((r) => r.contractId && pausedContracts.add(r.contractId));
  }
  return contracts.map((c) => {
    const restriction =
      restricted.has(c.ptUserId) || pausedContracts.has(c.id) ? { type: PtRestrictionType.TEMPORARY_SUSPENSION } : null;
    return {
      ...c,
      effectiveStatus: effectiveStatusOf(c.status, restriction),
      canExitWithoutPenalty: canExitWithoutPenalty(c as ExitContractFacts, restriction),
    };
  });
}

/**
 * Guard for flows aimed AT a PT (a client requests, pays, books...). Throws a PtRestrictionError
 * (409, machine-readable `code`, Vietnamese message that blames nobody) while the PT is restricted.
 */
export async function assertPtAcceptsNewBusiness(
  ptUserId: string,
  action: ClientFacingAction,
  db: Db = prisma,
): Promise<void> {
  const restriction = await getActiveRestriction(ptUserId, db);
  if (restriction) throw refusal(restriction, "CLIENT", action);
}

/**
 * Guard for a PT's own mutating coaching action ("restricted mode"): reads stay available, anything
 * that writes is refused server-side with 409 + code. The caller passes the id of the PT who is the
 * ACTOR — never a client id, and never an id taken from a request body.
 */
export async function assertPtMayAct(ptUserId: string, db: Db = prisma): Promise<void> {
  const restriction = await getActiveRestriction(ptUserId, db);
  if (restriction) throw refusal(restriction, "PT");
}

/** Is this PT restricted AS A WHOLE right now (either type)? A contract restriction does not make this true. */
export async function isPtRestricted(ptUserId: string, db: Db = prisma): Promise<boolean> {
  return (await getActiveRestriction(ptUserId, db)) !== null;
}

/**
 * {@link assertPtMayAct} for a coaching action on ONE contract: refused while the PT is restricted as a
 * whole OR this contract has its own restriction. Every action on a contract's sessions (confirm, complete,
 * cancel as the PT, no-show, notes, join, reschedule, feedback) goes through this one function — an
 * action with no contract in sight keeps assertPtMayAct.
 */
export async function assertPtMayActOnContract(
  ptUserId: string,
  contractId: string,
  db: Db = prisma,
): Promise<void> {
  const restriction = await getBlockingRestriction({ id: contractId, ptUserId }, db);
  if (restriction) throw refusal(restriction, "PT");
}

/**
 * {@link assertPtAcceptsNewBusiness} for a client action on an EXISTING contract (book, reschedule,
 * report the PT never came): refused while the PT is restricted as a whole OR the contract is paused.
 */
export async function assertContractAcceptsClientAction(
  contract: { id: string; ptUserId: string },
  action: ClientFacingAction,
  db: Db = prisma,
): Promise<void> {
  const restriction = await getBlockingRestriction(contract, db);
  if (restriction) throw refusal(restriction, "CLIENT", action);
}

/** Is coaching on this contract paused right now (account restriction or its own)? */
export async function isContractRestricted(contract: { id: string; ptUserId: string }, db: Db = prisma): Promise<boolean> {
  return (await getBlockingRestriction(contract, db)) !== null;
}

// ── the client's no-penalty exit (slice 4) ─────────────────────────────────────────────────

/** The termination reason the SERVER substitutes — payment-service refunds 100% of the unused value for it, no fee, no PT fault. */
export const CLIENT_EXIT_DUE_TO_PT_RESTRICTION = "CLIENT_EXIT_DUE_TO_PT_RESTRICTION" as const;

/** The contract facts the exit rules read (a row from the contracts table has all of them). */
export interface ExitContractFacts {
  status: ContractStatus;
  paymentTransactionId?: string | null;
  price?: unknown;
  totalSessions?: number;
  /** When the server accepted this client's no-fee exit request (contracts.client_exit_accepted_at), if it did. */
  clientExitAcceptedAt?: Date | null;
}

/**
 * How long an ACCEPTED no-fee exit request keeps its terms after the restriction that justified it has ended.
 * Long enough for the client's retries after a payment-service outage, short enough that an abandoned
 * attempt cannot grant a free exit weeks later.
 */
export const CLIENT_EXIT_ACCEPTANCE_TTL_MS = Number(process.env.CLIENT_EXIT_ACCEPTANCE_TTL_HOURS ?? 24) * 60 * 60 * 1000;

/** The server accepted this contract's no-fee exit recently enough that the accepted terms still stand. */
export function hasFreshExitAcceptance(c: Pick<ExitContractFacts, "clientExitAcceptedAt">, now: Date = new Date()): boolean {
  return !!c.clientExitAcceptedAt && now.getTime() - new Date(c.clientExitAcceptedAt).getTime() < CLIENT_EXIT_ACCEPTANCE_TTL_MS;
}

/**
 * "ACTIVE and actually paid" — the same test as payableOrNull in contract-payout.service.ts (a
 * payment transaction, a price and a session count), plus the status. A contract that is not paid
 * has no money to give back, so there is nothing for a no-penalty exit to be about.
 */
export function isLivePaidContract(c: ExitContractFacts): boolean {
  return c.status === ContractStatus.ACTIVE && !!c.paymentTransactionId && c.price != null && (c.totalSessions ?? 0) > 0;
}

/**
 * THE rule behind both the read flag and the substitution: a paid ACTIVE contract whose PT has an
 * active restriction — a temporary suspension, OR a permanent ban whose unwind has not reached this
 * contract yet (the outcome for the client is the same 100% refund the unwind itself would pay, so
 * waiting for the unwind is not made a precondition). A fail-closed legacy flag counts too: it
 * blocks the PT exactly like a ban does (getActiveRestriction).
 */
export function canExitWithoutPenalty(contract: ExitContractFacts, restriction: Pick<PtRestriction, "type"> | null): boolean {
  // An exit request the server already ACCEPTED keeps its terms after the restriction ends (bổ sung 11/10, B).
  return (restriction !== null || hasFreshExitAcceptance(contract)) && isLivePaidContract(contract);
}

export interface ClientExitOverride {
  reason: typeof CLIENT_EXIT_DUE_TO_PT_RESTRICTION;
  /** The restriction in force now; null when the terms stand only because an earlier request was accepted. */
  restriction: PtRestriction | null;
  /** True when this contract's exit had already been accepted before this call. */
  priorAcceptance: boolean;
}

/**
 * HOOK called by the client-termination flow (client-exit.service.ts). Decides — from facts the
 * server reads itself, never from the request — whether a client's plain cancellation must be
 * settled as {@link CLIENT_EXIT_DUE_TO_PT_RESTRICTION}.
 *
 * All of these must hold:
 *   · the client asked for the reason a client always sends, CLIENT_CANCELLED (any other reason —
 *     PT_REPEATED_NO_SHOW, or anything an admin picks — keeps its own formula and is never rewritten);
 *   · the caller IS the contract's client (the PT, a third party, or an anonymous call can never get it);
 *   · the contract is ACTIVE and paid;
 *   · the contract is restricted right now (its PT's account restriction, or the contract's own) — OR the server already accepted this
 *     contract's no-fee exit (contracts.client_exit_accepted_at, recent) and that request is being
 *     finished or retried after the restriction ended.
 *
 * THE ONE PLACE every "is this contract restricted for the client's exit?" decision goes through: the
 * terminate flow, the refund preview and the contract reads all call this function (or the pure
 * {@link canExitWithoutPenalty} it is built on). Contract-scoped restrictions extend it here (getBlockingRestriction).
 *
 * The caller must pass a contract row it read AFTER taking the PT lock (lockPt) and must keep that
 * lock until the money step is done: that is what makes "the restriction was active" and "the refund
 * was priced as an exit" one fact (see client-exit.service.ts).
 */
export async function clientExitOverrideWhilePtRestricted(
  contract: ExitContractFacts & { id: string; clientUserId: string; ptUserId: string },
  requestedReason: string,
  callerUserId: string | null | undefined,
  db: Db = prisma,
): Promise<ClientExitOverride | null> {
  if (requestedReason !== "CLIENT_CANCELLED") return null;
  if (!callerUserId || callerUserId !== contract.clientUserId) return null;
  if (!isLivePaidContract(contract)) return null;
  // The PT's account restriction OR this contract's own: the client's neutral exit is the same either way.
  const restriction = await getBlockingRestriction(contract, db);
  if (!canExitWithoutPenalty(contract, restriction)) return null;
  return { reason: CLIENT_EXIT_DUE_TO_PT_RESTRICTION, restriction, priorAcceptance: hasFreshExitAcceptance(contract) };
}

// ── pure maths ─────────────────────────────────────────────────────────────────────────────

/**
 * How many milliseconds of a contract's OWN running time an episode blocked.
 *
 *   from = max(episode start, contract activation)
 *   blocked = lift − from, but only if the contract had not already run out when `from` came:
 *   an end date at or before `from` means nothing was left to block, and extending it would
 *   revive a contract that had already ended its run.
 *
 * Worked example (instants shown as day numbers): activated day 0, end day 30, suspended day 20,
 * lifted day 41 → blocked 21 days → new end day 51. The client had 10 days left at day 20 and
 * has exactly 10 left at day 41.
 */
export function computeBlockedMs(episodeStart: Date, liftAt: Date, activation: Date, endDate: Date): number {
  const from = Math.max(episodeStart.getTime(), activation.getTime());
  if (endDate.getTime() <= from) return 0;
  return Math.max(liftAt.getTime() - from, 0);
}

/**
 * The instant that is `idleMs` of NON-suspended time before `now`: walks back from `now` over the
 * gaps between the PT's restriction intervals. Used by the idle-holdback sweep so suspended time
 * does not count toward the idle days. Intervals are [start, end) with end = now when still open.
 */
export function idleCutoffExcludingRestrictions(
  now: Date,
  idleMs: number,
  intervals: Array<{ startedAt: Date; endedAt: Date | null }>,
): Date {
  const spans = intervals
    .map((i) => ({ s: i.startedAt.getTime(), e: Math.min((i.endedAt ?? now).getTime(), now.getTime()) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => b.e - a.e);
  let cur = now.getTime();
  let remaining = idleMs;
  for (const span of spans) {
    if (span.e < cur) {
      const gap = cur - span.e;
      if (gap >= remaining) return new Date(cur - remaining);
      remaining -= gap;
      cur = span.e;
    }
    cur = Math.min(cur, span.s);
  }
  return new Date(cur - remaining);
}

/** A restriction row as the admin API returns it (BigInt made JSON-safe, overdue state attached). */
export function toAdminView(r: PtRestriction, now: Date = new Date()) {
  return { ...r, lockSeq: r.lockSeq == null ? null : r.lockSeq.toString(), ...overdueInfo(r, now) };
}

export function overdueInfo(
  restriction: Pick<PtRestriction, "type" | "startedAt" | "endedAt" | "lastJustifiedAt">,
  now: Date = new Date(),
) {
  const base = restriction.lastJustifiedAt ?? restriction.startedAt;
  const dueAt = new Date(base.getTime() + PT_RESTRICTION_OVERDUE_DAYS * DAY_MS);
  const applies = restriction.type === PtRestrictionType.TEMPORARY_SUSPENSION && restriction.endedAt === null;
  return { overdue: applies && dueAt.getTime() <= now.getTime(), reviewDueAt: applies ? dueAt : null };
}

// ── writing episodes (shared by the admin endpoints and the auth-service lock stream) ──────

/** Serialises everything that changes one PT's restriction, bookings and confirmations (same key as bookSession). */
export async function lockPt(tx: Prisma.TransactionClient, ptUserId: string): Promise<void> {
  // Bounded wait (503 PT_LOCK_BUSY after PT_LOCK_WAIT_MS) - see contract-lock.ts: the PT lock used to wait without limit.
  await acquirePtLock(tx, ptUserId);
}

/**
 * The mirror flag: set from the rows, never from the caller's intent. It mirrors ACCOUNT-scope episodes
 * only — a PT whose only restriction is on one contract is NOT `ptSuspended` (still discoverable, still
 * accepting new contracts).
 */
export async function syncPtSuspendedFlag(tx: Prisma.TransactionClient, ptUserId: string): Promise<boolean> {
  const active = (await tx.ptRestriction.count({ where: { ptUserId, endedAt: null, scope: PtRestrictionScope.ACCOUNT } })) > 0;
  await tx.userProfile.updateMany({ where: { userId: ptUserId }, data: { ptSuspended: active } });
  return active;
}

export interface EpisodeEndSummary {
  extendedContracts: Array<{ contractId: string; blockedMs: number; previousEndDate: Date; newEndDate: Date }>;
  confirmationDeadlinesExtended: Array<{ sessionId: string; previousDeadline: Date; newDeadline: Date }>;
}

/**
 * Contracts whose ending is RECORDED but not yet confirmed by payment-service (D59) are on their way out: a restriction that is
 * lifted meanwhile neither extends their end date nor tells their client the contract "resumes". They are left out here.
 */
async function withoutEndingContracts<T extends { id: string }>(tx: Prisma.TransactionClient, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ending = await tx.sessionSettlement.findMany({
    where: {
      contractId: { in: rows.map((r) => r.id) },
      kind: SessionSettlementKind.CONTRACT_TERMINATION,
      status: { not: SessionSettlementStatus.SETTLED },
    },
    select: { contractId: true },
  });
  if (ending.length === 0) return rows;
  const ids = new Set(ending.map((e) => e.contractId));
  return rows.filter((r) => !ids.has(r.id));
}

/**
 * Closes the active episode `episode` (a compare-and-swap on endedAt IS NULL) and, in the SAME
 * transaction, gives back the time it blocked:
 *   · every contract the episode covered (an ACCOUNT episode: all of the PT's contracts; a CONTRACT
 *     episode: that one contract) that is STILL ACTIVE and has an end date is brought up to date by the
 *     INTERVAL rule below; a unique (episode, contract) marker row records what this close added, so a
 *     repeat can never extend twice; contracts that ended (any reason) before this instant are not ACTIVE
 *     and are neither extended nor revived; contracts without an end date stay without one;
 *   · a session waiting for the client's confirmation keeps the same remaining window (the
 *     auto-confirm clock was frozen while it was restricted), again without counting an instant twice.
 *
 * THE INTERVAL RULE (how overlapping episodes never double count). A contract can be blocked by an
 * account episode and by its own contract episode at once, overlapping, closing in either order, or one
 * raised into the other. For a contract the time owed back is the LENGTH OF THE UNION of the closed
 * episodes' intervals (clipped to the contract's activation, see totalGiveBackMs). This close computes
 * that total from all closed episodes that applied to the contract, subtracts what the contract was
 * ALREADY granted (the sum of its marker rows, whichever episodes wrote them), and adds only the
 * difference. Every instant is therefore paid once, whichever episode closes first: the later close adds
 * just the part the earlier one did not cover. An episode that is still open contributes nothing yet.
 * (Limit: the guard "the contract had not already run out" reads the end date minus the grants, so it
 * assumes nothing else moves a restricted contract's end date.)
 *
 * Returns null when someone else already closed the episode (the caller treats that as "no-op").
 */
export async function closeEpisode(
  tx: Prisma.TransactionClient,
  episode: PtRestriction,
  end: { at: Date; by: string; reason: string | null; kind: PtRestrictionEndKind },
): Promise<EpisodeEndSummary | null> {
  if (episode.id === "LEGACY_FLAG") return { extendedContracts: [], confirmationDeadlinesExtended: [] };
  const { count } = await tx.ptRestriction.updateMany({
    where: { id: episode.id, endedAt: null },
    data: { endedAt: end.at, endKind: end.kind, liftedBy: end.by, liftReason: end.reason },
  });
  if (count === 0) return null;

  const summary: EpisodeEndSummary = { extendedContracts: [], confirmationDeadlinesExtended: [] };
  const isContractScope = episode.scope === PtRestrictionScope.CONTRACT && !!episode.contractId;

  const contracts = await withoutEndingContracts(
    tx,
    await tx.contract.findMany({
      where: {
        ...(isContractScope ? { id: episode.contractId as string } : { ptUserId: episode.ptUserId }),
        status: ContractStatus.ACTIVE,
        endDate: { not: null },
      },
      select: { id: true, startDate: true, createdAt: true, endDate: true },
    }),
  );
  if (contracts.length > 0) {
    const ids = contracts.map((c) => c.id);
    const [accountClosed, contractClosed, granted] = await Promise.all([
      tx.ptRestriction.findMany({
        where: { ptUserId: episode.ptUserId, scope: PtRestrictionScope.ACCOUNT, endedAt: { not: null } },
        select: { startedAt: true, endedAt: true },
      }),
      tx.ptRestriction.findMany({
        where: { contractId: { in: ids }, scope: PtRestrictionScope.CONTRACT, endedAt: { not: null } },
        select: { contractId: true, startedAt: true, endedAt: true },
      }),
      tx.ptRestrictionContractExtension.groupBy({
        by: ["contractId"],
        where: { contractId: { in: ids } },
        _sum: { blockedMs: true },
      }),
    ]);
    const accountSpans = accountClosed.map(spanOf);
    const grantedMs = new Map(granted.map((g) => [g.contractId, Number(g._sum.blockedMs ?? 0)]));
    for (const c of contracts) {
      const endDate = c.endDate as Date;
      const already = grantedMs.get(c.id) ?? 0;
      const spans = [...accountSpans, ...contractClosed.filter((r) => r.contractId === c.id).map(spanOf)];
      const total = totalGiveBackMs(endDate.getTime() - already, (c.startDate ?? c.createdAt).getTime(), spans);
      const blockedMs = total - already;
      if (blockedMs <= 0) continue;
      const newEndDate = new Date(endDate.getTime() + blockedMs);
      const marker = await tx.ptRestrictionContractExtension.createMany({
        data: [
          {
            restrictionId: episode.id,
            contractId: c.id,
            blockedMs: BigInt(blockedMs),
            previousEndDate: endDate,
            newEndDate,
          },
        ],
        skipDuplicates: true,
      });
      if (marker.count === 0) continue; // already applied for this episode — never twice
      const moved = await tx.contract.updateMany({
        where: { id: c.id, status: ContractStatus.ACTIVE, endDate },
        data: { endDate: newEndDate },
      });
      if (moved.count === 0) {
        // The contract ended or changed under us: it is not ours to extend — take the marker back.
        await tx.ptRestrictionContractExtension.deleteMany({ where: { restrictionId: episode.id, contractId: c.id } });
        continue;
      }
      summary.extendedContracts.push({ contractId: c.id, blockedMs, previousEndDate: endDate, newEndDate });
    }
  }

  const pending = await tx.session.findMany({
    where: {
      ...(isContractScope ? { contractId: episode.contractId as string } : { ptUserId: episode.ptUserId }),
      status: SessionStatus.PENDING_CLIENT_CONFIRMATION,
      clientConfirmDeadline: { gt: episode.startedAt },
    },
    select: { id: true, contractId: true, clientConfirmDeadline: true },
  });
  if (pending.length > 0) {
    // What was already given back to a session's window by OTHER closed episodes that applied to its contract.
    const contractIds = [...new Set(pending.map((s) => s.contractId))];
    const [otherAccount, otherContract] = await Promise.all([
      tx.ptRestriction.findMany({
        where: { ptUserId: episode.ptUserId, scope: PtRestrictionScope.ACCOUNT, endedAt: { not: null }, id: { not: episode.id } },
        select: { startedAt: true, endedAt: true },
      }),
      tx.ptRestriction.findMany({
        where: { contractId: { in: contractIds }, scope: PtRestrictionScope.CONTRACT, endedAt: { not: null }, id: { not: episode.id } },
        select: { contractId: true, startedAt: true, endedAt: true },
      }),
    ]);
    const thisSpan: Span = { start: episode.startedAt.getTime(), end: end.at.getTime() };
    for (const s of pending) {
      const previousDeadline = s.clientConfirmDeadline as Date;
      const covered = [...otherAccount.map(spanOf), ...otherContract.filter((r) => r.contractId === s.contractId).map(spanOf)];
      const frozenMs = uncoveredMs(thisSpan, covered);
      if (frozenMs <= 0) continue;
      const newDeadline = new Date(previousDeadline.getTime() + frozenMs);
      const r = await tx.session.updateMany({
        where: { id: s.id, status: SessionStatus.PENDING_CLIENT_CONFIRMATION, clientConfirmDeadline: previousDeadline },
        data: { clientConfirmDeadline: newDeadline },
      });
      if (r.count === 1) summary.confirmationDeadlinesExtended.push({ sessionId: s.id, previousDeadline, newDeadline });
    }
  }
  return summary;
}

function spanOf(r: { startedAt: Date; endedAt: Date | null }): Span {
  return { start: r.startedAt.getTime(), end: (r.endedAt as Date).getTime() };
}

/** Opens a new active episode. Throws the Prisma unique violation if one is already active (callers read first, under the PT lock). */
export async function openEpisode(
  tx: Prisma.TransactionClient,
  input: {
    ptUserId: string;
    type: PtRestrictionType;
    reasonCategory: PtRestrictionReasonCategory;
    reasonText: string | null;
    publicReason?: string | null;
    imposedBy: string;
    startedAt: Date;
    lockSeq?: bigint | null;
    /** Default ACCOUNT. CONTRACT needs a contractId (and is always a TEMPORARY_SUSPENSION). */
    scope?: PtRestrictionScope;
    contractId?: string | null;
    /** The episode an admin's scope change replaced. */
    supersedesRestrictionId?: string | null;
  },
): Promise<PtRestriction> {
  return tx.ptRestriction.create({
    data: {
      scope: input.scope ?? PtRestrictionScope.ACCOUNT,
      contractId: input.contractId ?? null,
      supersedesRestrictionId: input.supersedesRestrictionId ?? null,
      ptUserId: input.ptUserId,
      type: input.type,
      reasonCategory: input.reasonCategory,
      reasonText: input.reasonText,
      publicReason: input.publicReason ?? null,
      imposedBy: input.imposedBy,
      startedAt: input.startedAt,
      lockSeq: input.lockSeq ?? null,
    },
  });
}

/**
 * A contract has just ended (any termination that went through settleContractTermination): a CONTRACT-scope
 * restriction on it has nothing left to restrict, so its episode is closed (CONTRACT_ENDED, by SYSTEM). No
 * give-back — the contract is no longer ACTIVE, and an ended contract is never revived. Idempotent and
 * best-effort by design: a failure here leaves an episode on an ended contract, which every reader ignores
 * (they all look at ACTIVE contracts) and an admin can still lift.
 */
export async function closeContractEpisodeOnContractEnd(contractId: string, at: Date = new Date()): Promise<number> {
  const { count } = await prisma.ptRestriction.updateMany({
    where: { contractId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
    data: { endedAt: at, endKind: PtRestrictionEndKind.CONTRACT_ENDED, liftedBy: SYSTEM_ACTOR, liftReason: "Hợp đồng đã kết thúc" },
  });
  return count;
}

async function recordExtensionAudit(actor: string, restrictionId: string, summary: EpisodeEndSummary) {
  for (const e of summary.extendedContracts) {
    await auditService.record({
      actorUserId: actor,
      action: "CONTRACT_END_DATE_EXTENDED_PT_RESTRICTION",
      entityType: AuditEntityType.CONTRACT,
      entityId: e.contractId,
      metadata: {
        restrictionId,
        blockedMs: e.blockedMs,
        previousEndDate: e.previousEndDate.toISOString(),
        newEndDate: e.newEndDate.toISOString(),
      },
    });
  }
}

// ── temporary suspension: admin operations ─────────────────────────────────────────────────

export interface SuspendInput {
  ptUserId: string;
  adminId: string;
  reasonCategory: PtRestrictionReasonCategory;
  reasonText: string;
  publicReason?: string | null;
  /** Test seam: the instant the suspension takes effect. Defaults to now. */
  at?: Date;
}

export interface CancelledSessionInfo {
  sessionId: string;
  contractId: string;
  clientUserId: string;
  isOnline: boolean;
}

function badRequest(message: string, code: string) {
  return new PtRestrictionError(message, 400, code);
}

function validateText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${label} là bắt buộc`, "REASON_REQUIRED");
  if (value.trim().length > max) throw badRequest(`${label} tối đa ${max} ký tự`, "REASON_TOO_LONG");
  return value.trim();
}

export const ptRestrictionService = {
  /**
   * Temporarily suspends a PT. Contracts are NOT touched (no status change, no termination, no
   * refund, no compensation) and the auth-service account keeps working (restricted mode).
   *
   * Idempotent: suspending a PT who is already temporarily suspended changes nothing. A PT who is
   * permanently banned answers 409 PT_ALREADY_BANNED (a suspension is not a downgrade of a ban).
   *
   * In ONE transaction under the PT's lock (the lock bookSession/confirmSession also take, so no
   * booking can slip in between): the episode row, the mirror flag, and the cancellation of every
   * session that has not finished yet as an ADMINISTRATIVE interruption — the shared FORCE_MAJEURE
   * outcome of session-outcome.ts (status CANCELLED, quota kept, no compensation, no payout), with
   * `cancelledBy` = SYSTEM so the idle-holdback "PT cancelled counts as activity" rule is not
   * triggered, no `ptAtFault`, no no-show, no late fee, no money call.
   *
   * Sessions already waiting for the client's confirmation, disputed, or with a pending no-show
   * report are NOT touched: nothing is decided against either party while the PT is suspended; the
   * auto-confirm and room-close sweeps skip this PT, and the confirmation window is given back at
   * lift (closeEpisode).
   */
  async suspend(input: SuspendInput) {
    const reasonText = validateText(input.reasonText, "Lý do", 1000);
    const publicReason =
      input.publicReason == null || input.publicReason === "" ? null : validateText(input.publicReason, "Lý do công bố", 500);
    if (!PT_RESTRICTION_REASON_CATEGORIES.includes(input.reasonCategory)) {
      throw badRequest("Nhóm lý do không hợp lệ", "REASON_CATEGORY_INVALID");
    }
    const at = input.at ?? new Date();

    const profile = await prisma.userProfile.findUnique({ where: { userId: input.ptUserId }, select: { isPT: true } });
    if (!profile || !profile.isPT) throw new PtRestrictionError("Không tìm thấy huấn luyện viên", 404, "PT_NOT_FOUND");

    const outcome = await prisma.$transaction(async (tx) => {
      await lockPt(tx, input.ptUserId);
      const active = await tx.ptRestriction.findFirst({
        where: { ptUserId: input.ptUserId, endedAt: null, scope: PtRestrictionScope.ACCOUNT },
      });
      if (active) {
        if (active.type === PtRestrictionType.TEMPORARY_SUSPENSION) {
          return { restriction: active, changed: false, cancelled: [] as CancelledSessionInfo[], paused: [] as PausedContractInfo[], notices: NO_NOTICES };
        }
        throw new PtRestrictionError(
          "Huấn luyện viên này đang bị khoá vĩnh viễn, không thể tạm đình chỉ.",
          409,
          PT_ALREADY_BANNED,
          PtRestrictionType.PERMANENT_BAN,
        );
      }
      const restriction = await openEpisode(tx, {
        ptUserId: input.ptUserId,
        type: PtRestrictionType.TEMPORARY_SUSPENSION,
        reasonCategory: input.reasonCategory,
        reasonText,
        publicReason,
        imposedBy: input.adminId,
        startedAt: at,
      });
      await syncPtSuspendedFlag(tx, input.ptUserId);
      const cancelled = await cancelUpcomingSessionsAdministratively(tx, input.ptUserId, at);
      // Who is told: read in THE transaction that opened the episode, under the PT lock, so the list
      // is exactly the contracts this suspension paused — a contract that is not ACTIVE-and-paid right
      // now is not paused by it and gets nothing.
      // A contract that already has its own restriction is paused and its client already told: no second notice.
      const paused = await findLiveContracts(tx, input.ptUserId, { exceptContractRestricted: true });
      // The notice rows are written HERE, in the transaction that opened the episode: they exist if and only
      // if the suspension does, whatever happens to the process afterwards (a crash before the push loses
      // only the realtime nudge - the notice is in the person's list).
      const notices = await storeSuspensionNotices(
        tx,
        input.ptUserId,
        restriction.id,
        paused,
        cancelled,
        (await findLiveContracts(tx, input.ptUserId)).length, // the PT hears about ALL their live contracts
      );
      return { restriction, changed: true, cancelled, paused, notices };
    }, ptTxOptions());

    const { notices, ...state } = outcome;
    if (!state.changed) return { ...state, notified: { clients: 0, pt: false } };

    await auditService.record({
      actorUserId: input.adminId,
      action: "PT_SUSPENDED_TEMPORARILY",
      entityType: AuditEntityType.PT_PROFILE,
      entityId: input.ptUserId,
      metadata: {
        restrictionId: outcome.restriction.id,
        reasonCategory: input.reasonCategory,
        reason: reasonText,
        publicReason,
        sessionsCancelled: outcome.cancelled.length,
      },
    });
    for (const s of outcome.cancelled) {
      await auditService.record({
        actorUserId: input.adminId,
        action: SESSION_CANCELLED_PT_SUSPENSION,
        entityType: AuditEntityType.SESSION,
        entityId: s.sessionId,
        metadata: { restrictionId: outcome.restriction.id, contractId: s.contractId, outcome: "FORCE_MAJEURE" },
      });
      if (s.isOnline) endOpenRoomCall(s.sessionId, "pt_suspended");
    }
    // Pushed only on this branch - the transaction above really opened the episode (and stored the rows).
    // A repeated or retried suspend returned `changed: false` earlier and never reaches here.
    notices.stored.forEach((n) => notificationService.publish(n));
    logger.info(
      `[PtRestriction] pt=${input.ptUserId} temporarily suspended by ${input.adminId}; sessions called off=${state.cancelled.length}`,
    );
    return { ...state, notified: { clients: notices.clients, pt: notices.pt } };
  },

  /**
   * Lifts a temporary suspension. Idempotent: lifting when nothing is active (or lifting twice)
   * changes nothing. A permanent ban cannot be lifted here (409) — that is the account unlock.
   * Closing the episode, the end-date extension and the mirror flag happen in one transaction.
   */
  async lift(input: { ptUserId: string; adminId: string; reason: string; at?: Date }) {
    const reason = validateText(input.reason, "Lý do mở lại", 1000);
    const at = input.at ?? new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      await lockPt(tx, input.ptUserId);
      const active = await tx.ptRestriction.findFirst({
        where: { ptUserId: input.ptUserId, endedAt: null, scope: PtRestrictionScope.ACCOUNT },
      });
      if (!active) return { changed: false as const, restriction: null, summary: null, resumed: [] as ResumedContractInfo[], notices: NO_NOTICES };
      if (active.type === PtRestrictionType.PERMANENT_BAN) {
        throw new PtRestrictionError(
          "Huấn luyện viên này đang bị khoá vĩnh viễn; mở khoá tài khoản để gỡ.",
          409,
          PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK,
          PtRestrictionType.PERMANENT_BAN,
        );
      }
      const summary = await closeEpisode(tx, active, { at, by: input.adminId, reason, kind: PtRestrictionEndKind.LIFTED });
      if (!summary) return { changed: false as const, restriction: null, summary: null, resumed: [] as ResumedContractInfo[], notices: NO_NOTICES };
      await syncPtSuspendedFlag(tx, input.ptUserId);
      const closed = await tx.ptRestriction.findUniqueOrThrow({ where: { id: active.id } });
      // Who is told: the contracts that are STILL ACTIVE-and-paid after the episode closed, read in
      // this transaction under the PT lock (an exit takes the same lock, so a contract that ended
      // meanwhile is not in the list). Each carries what the lift did to its end date.
      // A contract that still has its OWN restriction is not resumed by this lift: it stays paused and is told nothing.
      const extended = new Map(summary.extendedContracts.map((e) => [e.contractId, e]));
      const resumed: ResumedContractInfo[] = (await findLiveContracts(tx, input.ptUserId, { exceptContractRestricted: true })).map((c) => ({
        ...c,
        extension: extended.get(c.id) ?? null,
      }));
      // Stored in this transaction too (see suspend): the lift and its notices commit together.
      const stillPaused = await tx.ptRestriction.count({
        where: { ptUserId: input.ptUserId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
      });
      const notices = await storeLiftNotices(tx, input.ptUserId, closed.id, resumed, stillPaused);
      return { changed: true as const, restriction: closed, summary, resumed, notices };
    }, ptTxOptions());

    if (!outcome.changed) return { changed: false as const, restriction: null, summary: null, resumed: [] as ResumedContractInfo[], notified: { clients: 0, pt: false } };

    await auditService.record({
      actorUserId: input.adminId,
      action: "PT_SUSPENSION_LIFTED",
      entityType: AuditEntityType.PT_PROFILE,
      entityId: input.ptUserId,
      metadata: {
        restrictionId: outcome.restriction.id,
        reason,
        startedAt: outcome.restriction.startedAt.toISOString(),
        endedAt: at.toISOString(),
        contractsExtended: outcome.summary.extendedContracts.length,
        confirmationDeadlinesExtended: outcome.summary.confirmationDeadlinesExtended.length,
      },
    });
    await recordExtensionAudit(input.adminId, outcome.restriction.id, outcome.summary);
    // Only here - the transaction really closed the episode (and stored the rows). A repeated or late lift returned above.
    outcome.notices.stored.forEach((n) => notificationService.publish(n));
    logger.info(
      `[PtRestriction] pt=${input.ptUserId} suspension lifted by ${input.adminId}; contracts extended=${outcome.summary.extendedContracts.length}`,
    );
    const { notices, ...state } = outcome;
    return { ...state, notified: { clients: notices.clients, pt: notices.pt } };
  },

  /**
   * Records that an admin looked at an active temporary suspension and decided to keep it. With
   * `contractId` it is that contract's restriction; without, the PT's account-level suspension.
   */
  async justifyContinuing(input: { ptUserId: string; adminId: string; reason: string; contractId?: string | null; at?: Date }) {
    const reason = validateText(input.reason, "Lý do tiếp tục", 1000);
    const at = input.at ?? new Date();
    const active = await prisma.ptRestriction.findFirst({
      where: {
        ptUserId: input.ptUserId,
        endedAt: null,
        type: PtRestrictionType.TEMPORARY_SUSPENSION,
        ...(input.contractId
          ? { scope: PtRestrictionScope.CONTRACT, contractId: input.contractId }
          : { scope: PtRestrictionScope.ACCOUNT }),
      },
    });
    if (!active) {
      throw new PtRestrictionError("Huấn luyện viên này không đang bị tạm đình chỉ", 409, NO_ACTIVE_SUSPENSION);
    }
    const { count } = await prisma.ptRestriction.updateMany({
      where: { id: active.id, endedAt: null },
      data: { lastJustifiedAt: at, lastJustifiedBy: input.adminId, lastJustification: reason },
    });
    if (count === 0) throw new PtRestrictionError("Huấn luyện viên này không đang bị tạm đình chỉ", 409, NO_ACTIVE_SUSPENSION);
    await auditService.record({
      actorUserId: input.adminId,
      action: "PT_SUSPENSION_CONTINUATION_JUSTIFIED",
      entityType: AuditEntityType.PT_PROFILE,
      entityId: input.ptUserId,
      metadata: { restrictionId: active.id, reason, previousJustifiedAt: active.lastJustifiedAt?.toISOString() ?? null },
    });
    const updated = await prisma.ptRestriction.findUniqueOrThrow({ where: { id: active.id } });
    return { restriction: updated, ...overdueInfo(updated, at) };
  },

  /** One episode as the admin API returns it (BigInt made JSON-safe, overdue state attached). */
  async view(restrictionId: string) {
    return toAdminView(await prisma.ptRestriction.findUniqueOrThrow({ where: { id: restrictionId } }));
  },

  /** One PT's full restriction history, newest first, with what each episode did to contract end dates (admin view). */
  async history(ptUserId: string, now: Date = new Date()) {
    const rows = await prisma.ptRestriction.findMany({
      where: { ptUserId },
      orderBy: { startedAt: "desc" },
      include: {
        contractExtensions: true,
        contract: { select: { id: true, packageName: true, status: true, clientUserId: true } },
      },
    });
    return rows.map(({ contractExtensions, ...r }) => ({
      ...r,
      lockSeq: r.lockSeq == null ? null : r.lockSeq.toString(),
      ...overdueInfo(r, now),
      contractsExtended: contractExtensions.length,
      totalExtendedMs: contractExtensions.reduce((sum, e) => sum + Number(e.blockedMs), 0),
    }));
  },

  /** PTs restricted right now, with the overdue flag. Default: temporary suspensions only. */
  async listActive(opts: { includePermanent?: boolean; overdueOnly?: boolean; scope?: PtRestrictionScope; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const rows = await prisma.ptRestriction.findMany({
      where: {
        endedAt: null,
        ...(opts.includePermanent ? {} : { type: PtRestrictionType.TEMPORARY_SUSPENSION }),
        ...(opts.scope ? { scope: opts.scope } : {}),
      },
      orderBy: { startedAt: "asc" },
      include: { contract: { select: { id: true, packageName: true, status: true, clientUserId: true } } },
    });
    const ptIds = rows.map((r) => r.ptUserId);
    const [profiles, paused] = await Promise.all([
      prisma.userProfile.findMany({ where: { userId: { in: ptIds } }, select: { userId: true, firstName: true, lastName: true } }),
      prisma.contract.groupBy({
        by: ["ptUserId"],
        where: { ptUserId: { in: ptIds }, status: ContractStatus.ACTIVE },
        _count: true,
      }),
    ]);
    const nameOf = new Map(profiles.map((p) => [p.userId, [p.firstName, p.lastName].filter(Boolean).join(" ") || null]));
    const pausedOf = new Map(paused.map((p) => [p.ptUserId, p._count]));
    const items = rows
      .map((r) => ({
        ...r,
        lockSeq: r.lockSeq == null ? null : r.lockSeq.toString(),
        ptName: nameOf.get(r.ptUserId) ?? null,
        // An account episode pauses all of the PT's live contracts; a contract episode pauses that one.
        pausedContracts:
          r.scope === PtRestrictionScope.CONTRACT ? (r.contract?.status === ContractStatus.ACTIVE ? 1 : 0) : (pausedOf.get(r.ptUserId) ?? 0),
        daysActive: Math.floor((now.getTime() - r.startedAt.getTime()) / DAY_MS),
        ...overdueInfo(r, now),
      }))
      .filter((r) => !opts.overdueOnly || r.overdue);
    return { items, overdueAfterDays: PT_RESTRICTION_OVERDUE_DAYS };
  },

  /**
   * What a PT may read about their OWN restriction: the type, since when, the category label and the
   * reason an admin chose to publish — never the internal note, who imposed it, or the overdue state.
   * `restricted`/`mode` are about the PT AS A WHOLE; the restrictions on single contracts are listed
   * apart (contractRestrictions), so a PT with only one paused contract is still in NORMAL mode.
   */
  async ownStatus(ptUserId: string) {
    const rows = await prisma.ptRestriction.findMany({
      where: { ptUserId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { contract: { select: { packageName: true } } },
    });
    const contractRestrictions = rows.map((c) => ({
      contractId: c.contractId,
      packageName: c.contract?.packageName ?? null,
      since: c.startedAt,
      reasonLabel: CATEGORY_PUBLIC_LABEL[c.reasonCategory],
      publicReason: c.publicReason,
    }));
    const r = await getActiveRestriction(ptUserId);
    if (!r) return { restricted: false as const, mode: "NORMAL" as const, contractRestrictions };
    return {
      restricted: true as const,
      mode: "RESTRICTED" as const,
      type: r.type,
      since: r.startedAt,
      reasonLabel: CATEGORY_PUBLIC_LABEL[r.reasonCategory],
      publicReason: r.publicReason,
      canRead: ["contracts", "sessions", "wallet", "transactions", "notifications", "restriction"],
      blocked: ["accept or reject contracts", "confirm, complete or cancel sessions", "reschedule", "coaching actions"],
      contractRestrictions,
    };
  },

  /**
   * Single internal read for other services (gym-service's PT coaching check-in, a later phase):
   * "is this PT restricted right now, and how". A restricted PT must not gain coaching access.
   *
   * Without `contractId` the answer is about the PT as a whole: `restricted`/`mayCoach` follow the ACCOUNT
   * restriction only (a restriction on one contract must not stop the PT teaching someone else), and
   * `restrictedContractIds` lists the contracts paused on their own. With `contractId` the answer is for
   * coaching THAT contract: `mayCoach` is false when the account is restricted OR the contract is — which is
   * what a check-in for a session of that contract must use. A contract that is not this PT's answers 404.
   */
  async internalStatus(ptUserId: string, contractId?: string | null) {
    const [r, own] = await Promise.all([
      getActiveRestriction(ptUserId),
      prisma.ptRestriction.findMany({
        where: { ptUserId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
        select: { contractId: true },
      }),
    ]);
    const restrictedContractIds = own.map((c) => c.contractId).filter((id): id is string => !!id);
    const base = {
      ptUserId,
      restricted: r !== null,
      type: r?.type ?? null,
      since: r?.startedAt ?? null,
      mayCoach: r === null,
      mayTakeNewBusiness: r === null,
      restrictedContractIds,
    };
    if (!contractId) return base;
    const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { ptUserId: true } });
    if (!contract || contract.ptUserId !== ptUserId) {
      throw new PtRestrictionError("Không tìm thấy hợp đồng của huấn luyện viên này", 404, CONTRACT_NOT_FOUND);
    }
    const contractPaused = restrictedContractIds.includes(contractId);
    return {
      ...base,
      contractId,
      contractRestricted: contractPaused,
      scope: r ? ("ACCOUNT" as const) : contractPaused ? ("CONTRACT" as const) : null,
      mayCoach: r === null && !contractPaused,
    };
  },

  // ── CONTRACT scope (owner's decision D38): restrict / lift one contract, change scope ─────────

  /**
   * Restricts coaching on ONE contract. The PT keeps every other contract, can take new ones, stays
   * discoverable and is NOT `ptSuspended`. For this contract only: the PT cannot teach, confirm, complete,
   * reschedule or cancel it as the PT; the client cannot book on it; its not-yet-happened sessions are
   * called off as an administrative interruption (the same FORCE_MAJEURE outcome, `cancelledBy` SYSTEM:
   * no no-show, no quota, no money, no PT-cancel); sessions awaiting the client's confirmation or
   * disputed are left as they are; its expiry, auto-confirm, room-close and idle-holdback clocks stop; its
   * effective status is PAUSED_BY_ADMIN and the client may leave it without a fee. Only the PT and this
   * contract's client are told.
   *
   * Idempotent: a contract that already has an active restriction changes nothing. A banned PT answers 409
   * PT_ALREADY_BANNED; a contract that is not ACTIVE answers 409 CONTRACT_NOT_RESTRICTABLE; a contract that is
   * not this PT's answers 404. An ACCOUNT suspension may be active at the same time (the combined state).
   */
  async restrictContract(input: RestrictContractInput) {
    const reasonText = validateText(input.reasonText, "Lý do", 1000);
    const publicReason =
      input.publicReason == null || input.publicReason === "" ? null : validateText(input.publicReason, "Lý do công bố", 500);
    if (!PT_RESTRICTION_REASON_CATEGORIES.includes(input.reasonCategory)) {
      throw badRequest("Nhóm lý do không hợp lệ", "REASON_CATEGORY_INVALID");
    }
    const at = input.at ?? new Date();

    const outcome = await prisma.$transaction(async (tx) => {
      await lockPt(tx, input.ptUserId);
      const contract = await tx.contract.findUnique({
        where: { id: input.contractId },
        select: { id: true, ptUserId: true, clientUserId: true, packageName: true, status: true, paymentTransactionId: true },
      });
      if (!contract || contract.ptUserId !== input.ptUserId) {
        throw new PtRestrictionError("Không tìm thấy hợp đồng của huấn luyện viên này", 404, CONTRACT_NOT_FOUND);
      }
      const existing = await getActiveContractRestriction(contract.id, tx);
      if (existing) return { restriction: existing, changed: false as const, cancelled: [] as CancelledSessionInfo[], notices: NO_NOTICES };
      const account = await getActiveRestriction(input.ptUserId, tx);
      if (account?.type === PtRestrictionType.PERMANENT_BAN) {
        throw new PtRestrictionError(
          "Huấn luyện viên này đang bị khoá vĩnh viễn; hợp đồng được xử lý theo việc khoá tài khoản.",
          409,
          PT_ALREADY_BANNED,
          PtRestrictionType.PERMANENT_BAN,
        );
      }
      if (contract.status !== ContractStatus.ACTIVE) {
        throw new PtRestrictionError("Chỉ hạn chế được hợp đồng đang hoạt động", 409, CONTRACT_NOT_RESTRICTABLE);
      }
      const restriction = await openEpisode(tx, {
        ptUserId: input.ptUserId,
        type: PtRestrictionType.TEMPORARY_SUSPENSION,
        reasonCategory: input.reasonCategory,
        reasonText,
        publicReason,
        imposedBy: input.adminId,
        startedAt: at,
        scope: PtRestrictionScope.CONTRACT,
        contractId: contract.id,
      });
      const cancelled = await cancelUpcomingSessionsAdministratively(tx, input.ptUserId, at, contract.id);
      // The client is told only if this is news to them: under an active account suspension the contract was
      // already paused (and announced). The PT always gets the contract-sized notice.
      const live = !!contract.paymentTransactionId;
      const notices = await storeContractPausedNotices(tx, contract, cancelled.length, live && !account);
      return { restriction, changed: true as const, cancelled, notices };
    }, ptTxOptions());

    const { notices, ...state } = outcome;
    if (!state.changed) return { ...state, notified: { client: false, pt: false } };
    await auditService.record({
      actorUserId: input.adminId,
      action: "PT_CONTRACT_RESTRICTED",
      entityType: AuditEntityType.CONTRACT,
      entityId: input.contractId,
      metadata: {
        restrictionId: state.restriction.id,
        ptUserId: input.ptUserId,
        reasonCategory: input.reasonCategory,
        reason: reasonText,
        publicReason,
        sessionsCancelled: state.cancelled.length,
      },
    });
    for (const sess of state.cancelled) {
      await auditService.record({
        actorUserId: input.adminId,
        action: SESSION_CANCELLED_PT_SUSPENSION,
        entityType: AuditEntityType.SESSION,
        entityId: sess.sessionId,
        metadata: { restrictionId: state.restriction.id, contractId: sess.contractId, outcome: "FORCE_MAJEURE", scope: "CONTRACT" },
      });
      if (sess.isOnline) endOpenRoomCall(sess.sessionId, "pt_contract_restricted");
    }
    notices.stored.forEach((n) => notificationService.publish(n));
    logger.info(
      `[PtRestriction] contract=${input.contractId} pt=${input.ptUserId} restricted by ${input.adminId}; sessions called off=${state.cancelled.length}`,
    );
    return { ...state, notified: { client: notices.clients > 0, pt: notices.pt } };
  },

  /**
   * Lifts the restriction on one contract. Idempotent (nothing active → changed:false). The contract's end
   * date is extended by the time it was blocked that nobody has been paid back for yet (the interval rule in
   * closeEpisode), so a lift next to an overlapping account suspension never counts a day twice. If the PT's
   * ACCOUNT restriction is still active the contract stays paused and nobody is told it resumed.
   */
  async liftContractRestriction(input: { ptUserId: string; contractId: string; adminId: string; reason: string; at?: Date }) {
    const reason = validateText(input.reason, "Lý do mở lại", 1000);
    const at = input.at ?? new Date();
    const owner = await prisma.contract.findUnique({ where: { id: input.contractId }, select: { ptUserId: true } });
    if (!owner || owner.ptUserId !== input.ptUserId) {
      throw new PtRestrictionError("Không tìm thấy hợp đồng của huấn luyện viên này", 404, CONTRACT_NOT_FOUND);
    }
    const unchanged = { changed: false as const, restriction: null, summary: null, stillPausedByAccount: false, notices: NO_NOTICES };
    const outcome = await prisma.$transaction(async (tx) => {
      await lockPt(tx, input.ptUserId);
      const active = await tx.ptRestriction.findFirst({
        where: { ptUserId: input.ptUserId, contractId: input.contractId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
      });
      if (!active) return unchanged;
      const summary = await closeEpisode(tx, active, { at, by: input.adminId, reason, kind: PtRestrictionEndKind.LIFTED });
      if (!summary) return unchanged;
      const closed = await tx.ptRestriction.findUniqueOrThrow({ where: { id: active.id } });
      const contract = await tx.contract.findUnique({
        where: { id: input.contractId },
        select: { id: true, clientUserId: true, packageName: true, status: true, paymentTransactionId: true, ptUserId: true },
      });
      const accountStillActive = (await getActiveRestriction(input.ptUserId, tx)) !== null;
      const live = !!contract && contract.status === ContractStatus.ACTIVE && !!contract.paymentTransactionId;
      const notices =
        contract && live && !accountStillActive
          ? await storeContractResumedNotices(tx, contract, summary.extendedContracts[0] ?? null)
          : NO_NOTICES;
      return { changed: true as const, restriction: closed, summary, stillPausedByAccount: accountStillActive, notices };
    }, ptTxOptions());
    if (!outcome.changed) return { ...outcome, notified: { client: false, pt: false } };
    await auditService.record({
      actorUserId: input.adminId,
      action: "PT_CONTRACT_RESTRICTION_LIFTED",
      entityType: AuditEntityType.CONTRACT,
      entityId: input.contractId,
      metadata: {
        restrictionId: outcome.restriction.id,
        ptUserId: input.ptUserId,
        reason,
        startedAt: outcome.restriction.startedAt.toISOString(),
        endedAt: at.toISOString(),
        stillPausedByAccount: outcome.stillPausedByAccount,
        contractsExtended: outcome.summary.extendedContracts.length,
        confirmationDeadlinesExtended: outcome.summary.confirmationDeadlinesExtended.length,
      },
    });
    await recordExtensionAudit(input.adminId, outcome.restriction.id, outcome.summary);
    outcome.notices.stored.forEach((n) => notificationService.publish(n));
    logger.info(`[PtRestriction] contract=${input.contractId} restriction lifted by ${input.adminId}`);
    return { ...outcome, notified: { client: outcome.notices.clients > 0, pt: outcome.notices.pt } };
  },

  /**
   * An admin changes the SCOPE of a restriction, on the record (reason, who, when) — never automatically:
   *   · to ACCOUNT, with `contractId`: the contract's restriction is raised into a PT-wide suspension. The
   *     contract episode closes (SCOPE_RAISED, the time so far is given back once) and an account episode
   *     opens at the same instant (supersedesRestrictionId points at it): the contract has no gap and no
   *     overlap. If the PT is already suspended as a whole the contract episode is simply folded in.
   *   · to CONTRACT, with `contractIds`: the PT's account suspension is narrowed to those contracts. The
   *     account episode closes (SCOPE_NARROWED), one contract episode per listed contract opens at the same
   *     instant, every other contract resumes (and is told). A permanent ban is not narrowed (409).
   * Both are idempotent: asking for the end state that already holds changes nothing. Both write
   * history rows (the closed episode + the opened ones) and one audit entry.
   */
  async changeScope(input: ChangeScopeInput) {
    const reason = validateText(input.reason, "Lý do", 1000);
    const at = input.at ?? new Date();
    if (input.to === "ACCOUNT") return raiseToAccount(input, reason, at);
    if (input.to === "CONTRACT") return narrowToContracts(input, reason, at);
    throw new PtRestrictionError("Phạm vi không hợp lệ", 400, SCOPE_CHANGE_INVALID);
  },
};

// ── contract scope: inputs, scope changes, notices ─────────────────────────────────────────

export interface RestrictContractInput {
  ptUserId: string;
  contractId: string;
  adminId: string;
  reasonCategory: PtRestrictionReasonCategory;
  reasonText: string;
  publicReason?: string | null;
  /** Test seam: the instant the restriction takes effect. Defaults to now. */
  at?: Date;
}

export interface ChangeScopeInput {
  ptUserId: string;
  adminId: string;
  to: "ACCOUNT" | "CONTRACT";
  /** to ACCOUNT: the contract whose restriction is raised. */
  contractId?: string | null;
  /** to CONTRACT: the contracts the account suspension is narrowed to. */
  contractIds?: string[] | null;
  reason: string;
  /** Optional on the new episode(s); defaults to the closed episode's own. */
  reasonCategory?: PtRestrictionReasonCategory;
  publicReason?: string | null;
  at?: Date;
}

async function raiseToAccount(input: ChangeScopeInput, reason: string, at: Date) {
  const contractId = input.contractId;
  if (!contractId) throw badRequest("Cần chỉ rõ hợp đồng bị hạn chế để nâng phạm vi", "CONTRACT_ID_REQUIRED");
  if (input.reasonCategory && !PT_RESTRICTION_REASON_CATEGORIES.includes(input.reasonCategory)) {
    throw badRequest("Nhóm lý do không hợp lệ", "REASON_CATEGORY_INVALID");
  }
  const publicReason =
    input.publicReason == null || input.publicReason === "" ? null : validateText(input.publicReason, "Lý do công bố", 500);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockPt(tx, input.ptUserId);
    const contract = await tx.contract.findUnique({ where: { id: contractId }, select: { id: true, ptUserId: true } });
    if (!contract || contract.ptUserId !== input.ptUserId) {
      throw new PtRestrictionError("Không tìm thấy hợp đồng của huấn luyện viên này", 404, CONTRACT_NOT_FOUND);
    }
    const account = await getActiveRestriction(input.ptUserId, tx);
    if (account?.type === PtRestrictionType.PERMANENT_BAN) {
      throw new PtRestrictionError("Huấn luyện viên này đang bị khoá vĩnh viễn.", 409, PT_ALREADY_BANNED, PtRestrictionType.PERMANENT_BAN);
    }
    const contractEpisode = await getActiveContractRestriction(contractId, tx);
    if (!contractEpisode) {
      // Nothing left to raise. Already suspended as a whole = the end state holds (a repeat); otherwise there was nothing to raise.
      if (account) return { changed: false as const, account, contractEpisode: null, summary: null, cancelled: [] as CancelledSessionInfo[], notices: NO_NOTICES };
      throw new PtRestrictionError("Hợp đồng này không có hạn chế nào đang hoạt động", 409, NO_ACTIVE_CONTRACT_RESTRICTION);
    }
    // The contract episode closes at `at` (its blocked time so far is given back, once) ...
    const summary = await closeEpisode(tx, contractEpisode, { at, by: input.adminId, reason, kind: PtRestrictionEndKind.SCOPE_RAISED });
    if (!summary) return { changed: false as const, account, contractEpisode: null, summary: null, cancelled: [] as CancelledSessionInfo[], notices: NO_NOTICES };
    // ... and the account episode takes over from the same instant — unless the PT is suspended already.
    let opened = account;
    let cancelled: CancelledSessionInfo[] = [];
    let notices = NO_NOTICES;
    if (!account) {
      opened = await openEpisode(tx, {
        ptUserId: input.ptUserId,
        type: PtRestrictionType.TEMPORARY_SUSPENSION,
        reasonCategory: input.reasonCategory ?? contractEpisode.reasonCategory,
        reasonText: reason,
        publicReason: publicReason ?? contractEpisode.publicReason,
        imposedBy: input.adminId,
        startedAt: at,
        supersedesRestrictionId: contractEpisode.id,
      });
      await syncPtSuspendedFlag(tx, input.ptUserId);
      cancelled = await cancelUpcomingSessionsAdministratively(tx, input.ptUserId, at);
      // The raised contract's client was told when its own restriction opened: only the others hear about it now.
      const live = await findLiveContracts(tx, input.ptUserId, { exceptContractRestricted: true });
      const others = live.filter((c) => c.id !== contractId);
      const allPaused = await findLiveContracts(tx, input.ptUserId);
      notices = await storeSuspensionNotices(tx, input.ptUserId, opened.id, others, cancelled, allPaused.length);
    }
    return { changed: true as const, account: opened, contractEpisode, summary, cancelled, notices };
  }, ptTxOptions());

  if (!outcome.changed) return { ...outcome, notified: { clients: 0, pt: false } };
  await auditService.record({
    actorUserId: input.adminId,
    action: "PT_RESTRICTION_SCOPE_RAISED",
    entityType: AuditEntityType.PT_PROFILE,
    entityId: input.ptUserId,
    metadata: {
      from: "CONTRACT",
      to: "ACCOUNT",
      contractId,
      closedRestrictionId: outcome.contractEpisode.id,
      accountRestrictionId: outcome.account?.id ?? null,
      reason,
      at: at.toISOString(),
      sessionsCancelled: outcome.cancelled.length,
    },
  });
  await recordExtensionAudit(input.adminId, outcome.contractEpisode.id, outcome.summary);
  for (const sess of outcome.cancelled) {
    await auditService.record({
      actorUserId: input.adminId,
      action: SESSION_CANCELLED_PT_SUSPENSION,
      entityType: AuditEntityType.SESSION,
      entityId: sess.sessionId,
      metadata: { restrictionId: outcome.account?.id ?? null, contractId: sess.contractId, outcome: "FORCE_MAJEURE", scope: "ACCOUNT" },
    });
    if (sess.isOnline) endOpenRoomCall(sess.sessionId, "pt_suspended");
  }
  outcome.notices.stored.forEach((n) => notificationService.publish(n));
  return { ...outcome, notified: { clients: outcome.notices.clients, pt: outcome.notices.pt } };
}

async function narrowToContracts(input: ChangeScopeInput, reason: string, at: Date) {
  const ids = [...new Set((input.contractIds ?? []).filter((id) => typeof id === "string" && id))];
  if (ids.length === 0) throw badRequest("Cần chỉ rõ ít nhất một hợp đồng để thu hẹp phạm vi", "CONTRACT_IDS_REQUIRED");
  if (input.reasonCategory && !PT_RESTRICTION_REASON_CATEGORIES.includes(input.reasonCategory)) {
    throw badRequest("Nhóm lý do không hợp lệ", "REASON_CATEGORY_INVALID");
  }
  const publicReason =
    input.publicReason == null || input.publicReason === "" ? null : validateText(input.publicReason, "Lý do công bố", 500);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockPt(tx, input.ptUserId);
    const contracts = await tx.contract.findMany({
      where: { id: { in: ids } },
      select: { id: true, ptUserId: true, status: true },
    });
    if (contracts.length !== ids.length || contracts.some((c) => c.ptUserId !== input.ptUserId)) {
      throw new PtRestrictionError("Có hợp đồng không thuộc huấn luyện viên này", 404, CONTRACT_NOT_FOUND);
    }
    const account = await getActiveRestriction(input.ptUserId, tx);
    if (!account) {
      // The end state may already hold (a repeat): every named contract has its own active restriction.
      const own = await tx.ptRestriction.count({
        where: { contractId: { in: ids }, scope: PtRestrictionScope.CONTRACT, endedAt: null },
      });
      if (own === ids.length) return { changed: false as const, closed: null, opened: [] as PtRestriction[], summary: null, notices: NO_NOTICES };
      throw new PtRestrictionError("Huấn luyện viên này không đang bị tạm đình chỉ", 409, NO_ACTIVE_SUSPENSION);
    }
    if (account.type === PtRestrictionType.PERMANENT_BAN) {
      throw new PtRestrictionError(
        "Huấn luyện viên này đang bị khoá vĩnh viễn; không thu hẹp được.",
        409,
        PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK,
        PtRestrictionType.PERMANENT_BAN,
      );
    }
    if (contracts.some((c) => c.status !== ContractStatus.ACTIVE)) {
      throw new PtRestrictionError("Chỉ hạn chế được hợp đồng đang hoạt động", 409, CONTRACT_NOT_RESTRICTABLE);
    }
    // The account episode closes at `at` (its blocked time so far is given back to every ACTIVE contract) ...
    const summary = await closeEpisode(tx, account, { at, by: input.adminId, reason, kind: PtRestrictionEndKind.SCOPE_NARROWED });
    if (!summary) return { changed: false as const, closed: null, opened: [] as PtRestriction[], summary: null, notices: NO_NOTICES };
    await syncPtSuspendedFlag(tx, input.ptUserId);
    // ... and the named contracts stay restricted, each on its own episode from the same instant.
    const already = new Set(
      (
        await tx.ptRestriction.findMany({
          where: { contractId: { in: ids }, scope: PtRestrictionScope.CONTRACT, endedAt: null },
          select: { contractId: true },
        })
      ).map((r) => r.contractId),
    );
    const opened: PtRestriction[] = [];
    for (const contractId of ids) {
      if (already.has(contractId)) continue;
      opened.push(
        await openEpisode(tx, {
          ptUserId: input.ptUserId,
          type: PtRestrictionType.TEMPORARY_SUSPENSION,
          reasonCategory: input.reasonCategory ?? account.reasonCategory,
          reasonText: reason,
          publicReason: publicReason ?? account.publicReason,
          imposedBy: input.adminId,
          startedAt: at,
          scope: PtRestrictionScope.CONTRACT,
          contractId,
          supersedesRestrictionId: account.id,
        }),
      );
    }
    // Everyone else resumes and is told, exactly as for a lift. The contracts that stay paused are told nothing new.
    const extended = new Map(summary.extendedContracts.map((e) => [e.contractId, e]));
    const resumed: ResumedContractInfo[] = (await findLiveContracts(tx, input.ptUserId, { exceptContractRestricted: true })).map((c) => ({
      ...c,
      extension: extended.get(c.id) ?? null,
    }));
    const stillPaused = await tx.ptRestriction.count({
      where: { ptUserId: input.ptUserId, scope: PtRestrictionScope.CONTRACT, endedAt: null },
    });
    const notices = await storeLiftNotices(tx, input.ptUserId, account.id, resumed, stillPaused);
    const closed = await tx.ptRestriction.findUniqueOrThrow({ where: { id: account.id } });
    return { changed: true as const, closed, opened, summary, notices };
  }, ptTxOptions());

  if (!outcome.changed) return { ...outcome, notified: { clients: 0, pt: false } };
  await auditService.record({
    actorUserId: input.adminId,
    action: "PT_RESTRICTION_SCOPE_NARROWED",
    entityType: AuditEntityType.PT_PROFILE,
    entityId: input.ptUserId,
    metadata: {
      from: "ACCOUNT",
      to: "CONTRACT",
      contractIds: ids,
      closedRestrictionId: outcome.closed.id,
      openedRestrictionIds: outcome.opened.map((r) => r.id),
      reason,
      at: at.toISOString(),
    },
  });
  await recordExtensionAudit(input.adminId, outcome.closed.id, outcome.summary);
  outcome.notices.stored.forEach((n) => notificationService.publish(n));
  return { ...outcome, notified: { clients: outcome.notices.clients, pt: outcome.notices.pt } };
}

interface ContractNoticeFacts {
  id: string;
  clientUserId: string;
  packageName: string;
  ptUserId: string;
}

/** CONTRACT scope opened: the PT (always) and this contract's client (unless an account suspension already told them). */
async function storeContractPausedNotices(
  tx: Prisma.TransactionClient,
  contract: ContractNoticeFacts,
  sessionsCalledOff: number,
  tellClient: boolean,
): Promise<StoredNotices> {
  const out: StoredNotices = { stored: [], clients: 0, pt: false };
  if (tellClient) {
    const row = await notificationService.createInTx(tx, {
      userId: contract.clientUserId,
      text: contractPausedClientText(contract.packageName, sessionsCalledOff),
      eventType: "CONTRACT_PAUSED_PT_SUSPENDED",
      entityType: "CONTRACT",
      entityId: contract.id,
      link: "/client/contracts",
    });
    if (row) {
      out.stored.push(row);
      out.clients++;
    }
  }
  const ptRow = await notificationService.createInTx(tx, {
    userId: contract.ptUserId,
    text: contractPausedPtText(contract.packageName, sessionsCalledOff),
    eventType: "CONTRACT_PAUSED_PT_SUSPENDED",
    entityType: "CONTRACT",
    entityId: contract.id,
    link: "/pt/contracts",
  });
  if (ptRow) {
    out.stored.push(ptRow);
    out.pt = true;
  }
  return out;
}

/** CONTRACT scope lifted (and nothing else holds the contract): the PT and this contract's client hear it resumed. */
async function storeContractResumedNotices(
  tx: Prisma.TransactionClient,
  contract: ContractNoticeFacts,
  extension: EpisodeEndSummary["extendedContracts"][number] | null,
): Promise<StoredNotices> {
  const out: StoredNotices = { stored: [], clients: 0, pt: false };
  const clientRow = await notificationService.createInTx(tx, {
    userId: contract.clientUserId,
    text: contractResumedClientText(contract.packageName, extension),
    eventType: "CONTRACT_RESUMED_PT_REINSTATED",
    entityType: "CONTRACT",
    entityId: contract.id,
    link: "/client/contracts",
  });
  if (clientRow) {
    out.stored.push(clientRow);
    out.clients++;
  }
  const ptRow = await notificationService.createInTx(tx, {
    userId: contract.ptUserId,
    text: contractResumedPtText(contract.packageName),
    eventType: "CONTRACT_RESUMED_PT_REINSTATED",
    entityType: "CONTRACT",
    entityId: contract.id,
    link: "/pt/contracts",
  });
  if (ptRow) {
    out.stored.push(ptRow);
    out.pt = true;
  }
  return out;
}

// ── helpers for suspend ────────────────────────────────────────────────────────────────────

/**
 * Calls off every REQUESTED / CONFIRMED session that has not finished by `at` (of one contract when
 * `contractId` is given, else all of the PT's), as an administrative interruption. Compare-and-swap on the status that was read; a pending reschedule proposal on a
 * called-off session is closed with it. Runs inside the suspend transaction.
 */
async function cancelUpcomingSessionsAdministratively(
  tx: Prisma.TransactionClient,
  ptUserId: string,
  at: Date,
  contractId?: string,
): Promise<CancelledSessionInfo[]> {
  const sessions = await tx.session.findMany({
    where: {
      ptUserId,
      ...(contractId ? { contractId } : {}),
      status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
      scheduledEndAt: { gt: at },
    },
    select: { id: true, status: true, contractId: true, clientUserId: true, sessionMode: true, scheduledStartAt: true },
    orderBy: { scheduledStartAt: "asc" },
  });
  const cancelled: CancelledSessionInfo[] = [];
  for (const s of sessions) {
    const outcome = resolveSessionOutcome({
      actor: "FORCE_MAJEURE",
      event: "CANCEL",
      hoursBeforeStart: (s.scheduledStartAt.getTime() - at.getTime()) / (60 * 60 * 1000),
    });
    // The shared matrix is the contract of this path: if it ever stopped being a no-penalty
    // cancellation, refuse to apply it rather than quietly charge somebody.
    if (
      outcome.sessionStatus !== SessionStatus.CANCELLED ||
      outcome.clientQuotaEffect !== "KEEP" ||
      outcome.clientCompensation ||
      outcome.ptPayout
    ) {
      throw new Error("FORCE_MAJEURE session outcome is no longer a no-penalty cancellation");
    }
    const { count } = await tx.session.updateMany({
      where: { id: s.id, status: s.status },
      data: {
        status: outcome.sessionStatus,
        cancelledBy: SYSTEM_ACTOR,
        cancellationReason: ADMIN_INTERRUPTION_CANCEL_REASON,
      },
    });
    if (count !== 1) continue;
    await tx.sessionRescheduleRequest.updateMany({
      where: { sessionId: s.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: at },
    });
    cancelled.push({ sessionId: s.id, contractId: s.contractId, clientUserId: s.clientUserId, isOnline: s.sessionMode === "ONLINE" });
  }
  return cancelled;
}


// ── the two notices a temporary suspension owes (slice 4) ──────────────────────────────────
//
// CONTRACT_PAUSED_PT_SUSPENDED when the episode opens, CONTRACT_RESUMED_PT_REINSTATED when a lift
// closes it. Both are direct consequences of the recipient's own contract, so — like
// CONTRACT_CANCELLED — they have no opt-out preference and are always stored and pushed.
//
// Who: the PT (once) and every client with an ACTIVE, paid contract with that PT (once per
// contract). The recipient lists are read INSIDE the transaction that opened/closed the episode, and
// the rows are STORED in that same transaction (notificationService.createInTx) and only pushed after it
// commits, so a repeated, retried or late request can never repeat a notice, and a crash after commit
// loses at most the realtime/phone nudge - the notice is already in the person's list. A transaction that
// fails stores nothing.
//
// The wording never names the reason, the complainant or anything the PT did, and never says or
// implies the PT did wrong: the PT is "tạm ngưng hoạt động để rà soát".
//
// A temporary suspension that is CONVERTED to a permanent ban, and a permanent lock, send NO
// "resumed" notice: the existing per-contract CONTRACT_CANCELLED_PT_DEACTIVATED notice of the
// unwind (pt-deactivation.service.ts) tells each client their contract ended and what they got back.

export interface PausedContractInfo {
  id: string;
  clientUserId: string;
  packageName: string;
}

export interface ResumedContractInfo extends PausedContractInfo {
  /** What the lift did to this contract's end date; null = it was not moved. */
  extension: { blockedMs: number; previousEndDate: Date; newEndDate: Date } | null;
}

/**
 * ACTIVE-and-paid contracts of a PT, read on the given connection (the transaction that changed the episode).
 * `exceptContractRestricted` leaves out the ones that have their own active restriction: an account-level
 * change does not pause or resume those (they were paused, and told, by their own episode).
 */
async function findLiveContracts(
  tx: Prisma.TransactionClient,
  ptUserId: string,
  opts: { exceptContractRestricted?: boolean } = {},
): Promise<PausedContractInfo[]> {
  return withoutEndingContracts(
    tx,
    await tx.contract.findMany({
      where: {
        ptUserId,
        status: ContractStatus.ACTIVE,
        paymentTransactionId: { not: null },
        ...(opts.exceptContractRestricted
          ? { ptRestrictions: { none: { scope: PtRestrictionScope.CONTRACT, endedAt: null } } }
          : {}),
      },
      select: { id: true, clientUserId: true, packageName: true },
      orderBy: { createdAt: "asc" },
    }),
  );
}

const VN_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

function formatBlockedTime(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / (60 * 60 * 1000));
  const parts = [days > 0 ? `${days} ngày` : "", hours > 0 ? `${hours} giờ` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "chưa đến 1 giờ";
}

export function pausedClientText(packageName: string, sessionsCalledOff: number): string {
  const sessions =
    sessionsCalledOff > 0
      ? ` ${sessionsCalledOff} buổi sắp tới đã được tạm hoãn, bạn đặt lại được khi huấn luyện viên hoạt động trở lại.`
      : "";
  return (
    `Huấn luyện viên của hợp đồng "${packageName}" đang tạm ngưng hoạt động để rà soát nên hợp đồng của bạn tạm dừng. ` +
    `Hợp đồng và các buổi chưa tập của bạn được giữ nguyên, bạn không mất buổi nào và thời hạn sẽ được cộng bù đúng bằng thời gian tạm dừng.${sessions} ` +
    `Bạn có thể chờ, hoặc nếu muốn dừng hẳn thì kết thúc hợp đồng để được hoàn lại toàn bộ giá trị các buổi chưa tập, không mất phí.`
  );
}

export function pausedPtText(contracts: number, sessionsCalledOff: number): string {
  const sessions = sessionsCalledOff > 0 ? ` ${sessionsCalledOff} buổi sắp tới đã được tạm hoãn.` : "";
  return (
    `Tài khoản của bạn đang tạm thời ở chế độ hạn chế để quản trị viên rà soát. ` +
    `${contracts} hợp đồng đang hoạt động của bạn được giữ nguyên và tạm dừng, thời hạn sẽ được cộng bù khi tài khoản hoạt động trở lại.${sessions} ` +
    `Bạn không bị tính vắng mặt và không bị phạt. Bạn vẫn xem được hợp đồng, ví và thông báo. ` +
    `Trong thời gian này khách có thể chờ hoặc kết thúc hợp đồng và nhận lại phần buổi chưa tập.`
  );
}

export function resumedClientText(packageName: string, extension: ResumedContractInfo["extension"]): string {
  const moved = extension
    ? ` Thời hạn hợp đồng được cộng thêm ${formatBlockedTime(extension.blockedMs)}, từ ${VN_DATE.format(extension.previousEndDate)} sang ${VN_DATE.format(extension.newEndDate)}.`
    : " Thời hạn hợp đồng giữ nguyên.";
  return `Huấn luyện viên của hợp đồng "${packageName}" đã hoạt động trở lại. Hợp đồng của bạn tiếp tục bình thường và bạn đặt lịch lại được ngay.${moved}`;
}

export function resumedPtText(contracts: number, stillPaused = 0): string {
  const base =
    contracts > 0
      ? `Tài khoản của bạn đã hoạt động bình thường trở lại. ${contracts} hợp đồng đang hoạt động của bạn tiếp tục, thời hạn đã được cộng bù, và khách đặt lịch với bạn được như trước.`
      : "Tài khoản của bạn đã hoạt động bình thường trở lại. Bạn nhận hợp đồng mới và lịch tập như trước.";
  // A contract with its own, separate restriction stays paused until that one is lifted.
  return stillPaused > 0 ? `${base} ${stillPaused} hợp đồng vẫn tạm dừng theo quyết định riêng của quản trị viên.` : base;
}

// CONTRACT scope: the same two notice types, worded about ONE contract. They never say or imply that the
// PT, or anyone else's contract, is affected, never name a reason or a complainant.
export function contractPausedClientText(packageName: string, sessionsCalledOff: number): string {
  const sessions =
    sessionsCalledOff > 0
      ? ` ${sessionsCalledOff} buổi sắp tới đã được tạm hoãn, bạn đặt lại được khi hợp đồng hoạt động trở lại.`
      : "";
  return (
    `Hợp đồng "${packageName}" của bạn tạm dừng theo quyết định của quản trị viên để rà soát. ` +
    `Hợp đồng và các buổi chưa tập được giữ nguyên, bạn không mất buổi nào và thời hạn sẽ được cộng bù đúng bằng thời gian tạm dừng.${sessions} ` +
    `Bạn có thể chờ, hoặc nếu muốn dừng hẳn thì kết thúc hợp đồng để được hoàn lại toàn bộ giá trị các buổi chưa tập, không mất phí.`
  );
}

export function contractPausedPtText(packageName: string, sessionsCalledOff: number): string {
  const sessions = sessionsCalledOff > 0 ? ` ${sessionsCalledOff} buổi sắp tới của hợp đồng này đã được tạm hoãn.` : "";
  return (
    `Hợp đồng "${packageName}" tạm dừng theo quyết định của quản trị viên để rà soát, nên bạn chưa huấn luyện được hợp đồng này lúc này.${sessions} ` +
    `Thời hạn hợp đồng sẽ được cộng bù khi hợp đồng hoạt động trở lại. Các hợp đồng khác của bạn vẫn hoạt động bình thường. ` +
    `Bạn không bị tính vắng mặt và không bị phạt.`
  );
}

export function contractResumedClientText(packageName: string, extension: ResumedContractInfo["extension"]): string {
  const moved = extension
    ? ` Thời hạn hợp đồng được cộng thêm ${formatBlockedTime(extension.blockedMs)}, từ ${VN_DATE.format(extension.previousEndDate)} sang ${VN_DATE.format(extension.newEndDate)}.`
    : " Thời hạn hợp đồng giữ nguyên.";
  return `Hợp đồng "${packageName}" của bạn đã hoạt động trở lại. Bạn đặt lịch lại được ngay.${moved}`;
}

export function contractResumedPtText(packageName: string): string {
  return `Hợp đồng "${packageName}" đã hoạt động trở lại. Bạn huấn luyện và nhận lịch với khách của hợp đồng này như trước, thời hạn đã được cộng bù.`;
}

/** What a transaction stored for the people to tell: the rows (to push after commit) and who got one. */
interface StoredNotices {
  stored: unknown[];
  clients: number;
  pt: boolean;
}

const NO_NOTICES: StoredNotices = { stored: [], clients: 0, pt: false };

/**
 * The suspension opened: store the notice for the PT, and for every client whose ACTIVE paid contract it
 * paused, once per contract - on `tx`, the transaction that opened the episode. Replaces the earlier
 * SESSION_CANCELLED stopgap (sent only to people with a called-off session): the paused-contract notice
 * carries the same facts - and the called-off count when there is one - so no one gets both. The
 * per-session audit rows are unchanged.
 */
async function storeSuspensionNotices(
  tx: Prisma.TransactionClient,
  ptUserId: string,
  restrictionId: string,
  paused: PausedContractInfo[],
  cancelled: CancelledSessionInfo[],
  /** Contracts the PT's text counts as paused; defaults to the ones notified now (a raised scope also counts the one already paused). */
  ptContractCount = paused.length,
): Promise<StoredNotices> {
  const out: StoredNotices = { stored: [], clients: 0, pt: false };
  for (const c of paused) {
    const called = cancelled.filter((s) => s.contractId === c.id).length;
    const row = await notificationService.createInTx(tx, {
      userId: c.clientUserId,
      text: pausedClientText(c.packageName, called),
      eventType: "CONTRACT_PAUSED_PT_SUSPENDED",
      entityType: "CONTRACT",
      entityId: c.id,
      link: "/client/contracts",
    });
    if (row) {
      out.stored.push(row);
      out.clients++;
    }
  }
  const ptRow = await notificationService.createInTx(tx, {
    userId: ptUserId,
    text: pausedPtText(ptContractCount, cancelled.length),
    eventType: "CONTRACT_PAUSED_PT_SUSPENDED",
    entityType: "CONTRACT",
    entityId: restrictionId,
    link: "/pt/contracts",
  });
  if (ptRow) {
    out.stored.push(ptRow);
    out.pt = true;
  }
  return out;
}

/** The suspension was lifted: store the notice for the PT and every client whose contract is STILL ACTIVE, once per contract, on `tx`. */
async function storeLiftNotices(
  tx: Prisma.TransactionClient,
  ptUserId: string,
  restrictionId: string,
  resumed: ResumedContractInfo[],
  stillPaused = 0,
): Promise<StoredNotices> {
  const out: StoredNotices = { stored: [], clients: 0, pt: false };
  for (const c of resumed) {
    const row = await notificationService.createInTx(tx, {
      userId: c.clientUserId,
      text: resumedClientText(c.packageName, c.extension),
      eventType: "CONTRACT_RESUMED_PT_REINSTATED",
      entityType: "CONTRACT",
      entityId: c.id,
      link: "/client/contracts",
    });
    if (row) {
      out.stored.push(row);
      out.clients++;
    }
  }
  const ptRow = await notificationService.createInTx(tx, {
    userId: ptUserId,
    text: resumedPtText(resumed.length, stillPaused),
    eventType: "CONTRACT_RESUMED_PT_REINSTATED",
    entityType: "CONTRACT",
    entityId: restrictionId,
    link: "/pt/contracts",
  });
  if (ptRow) {
    out.stored.push(ptRow);
    out.pt = true;
  }
  return out;
}
