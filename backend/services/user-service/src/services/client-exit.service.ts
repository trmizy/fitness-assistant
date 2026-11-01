import { logger } from "@gym-coach/shared";
import { AuditEntityType, ContractStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { auditService } from "./audit.service";
import {
  beginContractTermination,
  completeContractTermination,
  countUnresolvedSessions,
  isContractEnded,
  moneyBreakdown,
  registerTerminationHooks,
  settleContractTermination,
  settleUnsettledSessionMoneyFirst,
  terminateContractMoney,
  terminationTermsFor,
  type TerminationHooks,
  type TerminationIntent,
  type TerminationReason,
} from "./contract-payout.service";
import { ptTxOptions } from "./contract-lock";
import { notificationService } from "./notification.service";
import { ptDeactivationService } from "./pt-deactivation.service";
import {
  CLIENT_EXIT_ACCEPTANCE_TTL_MS,
  CLIENT_EXIT_DUE_TO_PT_RESTRICTION,
  clientExitOverrideWhilePtRestricted,
  getBlockingRestriction,
  hasFreshExitAcceptance,
  isLivePaidContract,
  lockPt,
} from "./pt-restriction.service";

/**
 * PT-suspension slice 4 — a client ends their own contract while its PT is restricted.
 *
 * The client keeps calling the existing terminate endpoint with the reason they always send,
 * CLIENT_CANCELLED. The server — never the request — decides whether this is the no-penalty exit:
 * see {@link clientExitOverrideWhilePtRestricted} for the exact conditions. When they hold the
 * termination is settled as CLIENT_EXIT_DUE_TO_PT_RESTRICTION (payment-service: 100% of the unused
 * value back, no fee, no PT compensation, the PT is not at fault); otherwise it is the ordinary
 * client cancellation, byte for byte what it was before this slice.
 *
 * CONSISTENCY WITH A LIFT (the whole point of the shape below). "The PT is restricted" and "the
 * refund is priced as an exit" must be one fact, so the check and the money step run inside the SAME
 * critical section the suspend / lift / lock code uses to change the restriction: the PT's
 * transaction-scoped advisory lock (lockPt). The lock is taken first, the contract and the
 * restriction are re-read under it, and it is held until the money call and the guarded status write
 * are done. Therefore, for any lift racing an exit:
 *   · the lift commits first  → the exit's re-read finds no restriction → an ordinary CLIENT_CANCELLED
 *     (the request is processed as what it was; the PT is running again);
 *   · the exit takes the lock first → the lift waits for it; the contract is already CANCELLED when
 *     the lift runs, so it is not extended and not revived (closeEpisode only touches ACTIVE ones).
 * Phase 0 / D58: the PT lock is held for the DECISION only - the exit's terms are decided and RECORDED durably
 * (beginContractTermination: the recorded reason, the contract's CONTRACT_TERMINATION intent) inside it, and the payment-service
 * call is made AFTER the lock is released (completeContractTermination). Once recorded, the terms cannot change: a lift
 * that lands during the money call does not reprice the exit, and a retry (or the settlement sweep) completes the same ending.
 * Before this, a lift, a suspend and a booking for that PT waited for payment-service calls (20 s each, up to 3 attempts).
 * The lock is only a mutex: nothing here is written through the lock's own connection.
 */

/** What the client-facing "Lý do" of the contract (and of each session called off) says. */
export const CLIENT_EXIT_CANCEL_REASON =
  "Hợp đồng được kết thúc theo yêu cầu của bạn vì huấn luyện viên đang tạm ngưng hoạt động. Bạn được hoàn lại toàn bộ giá trị các buổi chưa tập, không mất phí; các buổi chưa diễn ra không bị tính vắng và không bị trừ.";

export const SESSION_CANCELLED_CLIENT_EXIT = "SESSION_CANCELLED_CLIENT_EXIT_PT_RESTRICTED";

/** Machine-readable refusal: the client expected the no-fee exit but the terms that now apply are different. */
export const PT_RESTRICTION_LIFTED = "PT_RESTRICTION_LIFTED";

/**
 * The sessions a client's exit calls off as administrative: everything that has not happened yet.
 * NOT in this list, on purpose: the client's own "the PT never showed" report (Decision A / D52: the PT cannot answer
 * it any more, so the ending HOLDS it as a disputed session for the admin to rule - holdUnansweredNoShowReports),
 * PENDING_CLIENT_CONFIRMATION and DISPUTED. Those sessions keep their state and
 * their value is HELD (UNRESOLVED_SESSION_STATUSES) until the existing confirm / dispute / admin ruling decides.
 */
const SESSIONS_CALLED_OFF_ON_EXIT: SessionStatus[] = [SessionStatus.REQUESTED, SessionStatus.CONFIRMED];

export type ClientTerminationMode =
  /** This call ended the contract as the no-penalty exit. */
  | "EXIT_DUE_TO_PT_RESTRICTION"
  /** The conditions did not hold: the ordinary client cancellation, exactly as before. */
  | "ORDINARY"
  /** The contract had already been ended as the exit (a repeated / concurrent request): same state, same ledger result. */
  | "ALREADY_EXITED"
  /** Someone else ended the contract another way while this request was being processed; nothing was rewritten. */
  | "ALREADY_ENDED";

export interface ClientTerminationOutcome {
  mode: ClientTerminationMode;
  /** The reason now recorded on the contract (what the response reports). */
  reason: string;
  /** What payment-service answered (the replayed result for ALREADY_*). */
  settlement: any;
  statusBefore: ContractStatus;
  restrictionId: string | null;
  sessionsClosed: number;
  /** Sessions awaiting confirmation / disputed whose value payment-service HOLDS (0 on the ordinary path). */
  unresolvedSessions: number;
  /** True when this call finished an exit the server had accepted earlier, after the restriction had ended. */
  acceptedBeforeRelease: boolean;
}

/** Test seams — production passes none. */
export interface ClientExitOptions {
  /** Runs after the unlocked look decided the exit might apply, right before the lock is requested. */
  beforeLock?: () => Promise<void>;
  /** Request metadata for the audit row. */
  audit?: { ipAddress?: string | null; userAgent?: string | null };
  /**
   * The client was shown (and confirmed) the no-fee terms. If, under the lock, they no longer apply, nothing is
   * cancelled and the request is refused with 409 PT_RESTRICTION_LIFTED + the terms that apply now - it is never
   * quietly turned into an ordinary cancellation with a fee.
   */
  expectNoPenalty?: boolean;
}

export class ClientExitError extends Error {
  status: number;
  code?: string;
  /** Extra fields for the HTTP error body (e.g. the fresh preview of the terms now applying). */
  extra?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "ClientExitError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * What cancelling right now would do - for the preview endpoint and the 409 body. It derives the terms with the
 * SAME decision (clientExitOverrideWhilePtRestricted) and the SAME terms helper (terminationTermsFor) that the
 * execution uses, and asks payment-service with exactly the reason and held-session count the terminate would
 * send, so the quote and the execution cannot disagree. Returns null when the contract has nothing to break down.
 */
export async function previewClientExit(contractId: string): Promise<Record<string, any> | null> {
  const contract = await contractRepository.findById(contractId);
  if (!contract) return null;
  const active = contract.status === ContractStatus.ACTIVE;
  const override = active ? await clientExitOverrideWhilePtRestricted(contract, "CLIENT_CANCELLED", contract.clientUserId) : null;
  const reasonIfCancelledNow: TerminationReason | null = active ? (override ? CLIENT_EXIT_DUE_TO_PT_RESTRICTION : "CLIENT_CANCELLED") : null;
  const terms = reasonIfCancelledNow ? await terminationTermsFor(contract.id, reasonIfCancelledNow) : undefined;
  const breakdown = await moneyBreakdown(contract.id, terms);
  if (!breakdown) return null;
  // B31: a contract that was never paid has nothing to refund. The formula still prices the (unpaid) price, which made
  // an unpaid contract quote "you would get 2.700.000 back"; report no estimate instead, and say why. Paid contracts
  // are untouched, and no settlement math changes (this is the preview only).
  //
  // C2-04: an ended contract (completed / expired / cancelled / rejected) cannot be cancelled again, so "what
  // cancelling now would refund" has no meaning there; the formula would still print a number (it quoted 828.000
  // on a contract already cancelled and refunded 920.000). Report none, and say why.
  // C2-07: nothing has entered the system for an unpaid contract, so the PT must not be shown money as "still
  // pending" for it. `stillPending` is null + `stillPendingAvailable:false` (not a zero that reads as a real amount).
  // Preview only - settlement math is untouched; a paid, live contract is returned exactly as before.
  const ended = isContractEnded(contract);
  const refundEstimate = ended
    ? { refundIfCancelledNow: null, refundEstimateAvailable: false, refundEstimateUnavailableReason: "CONTRACT_ENDED" }
    : breakdown.paid === false
      ? { refundIfCancelledNow: null, refundEstimateAvailable: false }
      : {};
  const pendingMoney = breakdown.paid === false ? { stillPending: null, stillPendingAvailable: false } : {};
  return {
    ...breakdown,
    ...refundEstimate,
    ...pendingMoney,
    canExitWithoutPenalty: Boolean(override),
    exitReasonIfCancelledNow: reasonIfCancelledNow,
    // On an ended exit, how many sessions are still waiting for a decision.
    unresolvedSessions: terms ? terms.unresolvedSessions : isContractEnded(contract) ? await countUnresolvedSessions(contract.id) : 0,
  };
}

/** The refusal of an expectNoPenalty request whose terms no longer hold, with the terms that hold now. */
async function liftedError(contractId: string): Promise<ClientExitError> {
  const currentTerms = await previewClientExit(contractId).catch(() => null);
  return new ClientExitError(
    "Điều kiện rút không mất phí không còn áp dụng. Hợp đồng chưa bị kết thúc; vui lòng xem điều kiện hiện tại và xác nhận lại.",
    409,
    PT_RESTRICTION_LIFTED,
    { currentTerms },
  );
}

function ptExitNoticeText(packageName: string, held: number): string {
  const heldText = held > 0 ? ` ${held} buổi đang chờ khách xác nhận hoặc phân xử vẫn được xử lý như bình thường và được tính khi có kết quả.` : "";
  return (
    `Khách của hợp đồng "${packageName}" đã kết thúc hợp đồng trong lúc tài khoản của bạn tạm ngưng hoạt động để rà soát. ` +
    `Các buổi chưa tập đã được hoàn lại cho khách; bạn không bị tính vắng mặt và không bị phạt.${heldText}`
  );
}

/** The hooks committed with the exit's status write: the PT's notice (stored with the status, pushed after the commit). */
function exitHooks(): TerminationHooks {
  const published: unknown[] = [];
  return {
    inStatusWrite: async (ntx, { contract, terms }) => {
      const row = await notificationService.createInTx(ntx, {
        userId: contract.ptUserId,
        text: ptExitNoticeText(contract.packageName, terms.unresolvedSessions),
        eventType: "CONTRACT_CANCELLED",
        entityType: "CONTRACT",
        entityId: contract.id,
        link: "/pt/contracts",
      });
      if (row) published.push(row);
    },
    // Pushed only now, after the rows committed with the status; a crash before this loses the nudge, not the notice.
    afterCommit: () => {
      published.forEach((n) => notificationService.publish(n));
    },
  };
}
// A sweep / retry that completes an exit the original request could not still commits the PT's notice with the status.
registerTerminationHooks(CLIENT_EXIT_DUE_TO_PT_RESTRICTION, exitHooks);

/** A contract the exit already ended: replay the (idempotent) money call and report the stored state. */
async function replayIfAlreadyExited(row: NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>>) {
  if (row.terminationReason !== CLIENT_EXIT_DUE_TO_PT_RESTRICTION) return null;
  // The ledger call carries the stable CONTRACT_TERMINATE:<id> key, so payment-service replays the
  // first result instead of refunding again; the status is final, so nothing is rewritten.
  const settled = await settleContractTermination(row.id, CLIENT_EXIT_DUE_TO_PT_RESTRICTION);
  return {
    mode: "ALREADY_EXITED" as const,
    reason: CLIENT_EXIT_DUE_TO_PT_RESTRICTION as string,
    settlement: settled?.result ?? null,
    statusBefore: row.status,
    restrictionId: null,
    sessionsClosed: 0,
    unresolvedSessions: await countUnresolvedSessions(row.id),
    acceptedBeforeRelease: false,
  };
}

async function ordinaryCancellation(contractId: string, statusBefore: ContractStatus): Promise<ClientTerminationOutcome> {
  const settlement = await terminateContractMoney(contractId, "CLIENT_CANCELLED");
  return {
    mode: "ORDINARY",
    reason: "CLIENT_CANCELLED",
    settlement,
    statusBefore,
    restrictionId: null,
    sessionsClosed: 0,
    unresolvedSessions: 0,
    acceptedBeforeRelease: false,
  };
}

/**
 * Ends `contractId` on behalf of its client (who asked for CLIENT_CANCELLED). The caller has checked
 * the identity header; this re-checks that the caller is the contract's client and refuses
 * otherwise, so the exit cannot be reached by anyone else through this function either.
 */
export async function terminateAsClient(
  contractId: string,
  clientUserId: string,
  options: ClientExitOptions = {},
): Promise<ClientTerminationOutcome> {
  const first = await contractRepository.findById(contractId);
  if (!first) throw new ClientExitError("Contract not found", 404);
  if (first.clientUserId !== clientUserId) throw new ClientExitError("Not the client of this contract", 403);

  const replay = await replayIfAlreadyExited(first);
  if (replay) return replay;

  // Unlocked look, only to avoid taking the PT lock for the ordinary case. It is never trusted: if it
  // says "restricted" the real decision is re-made under the lock; if it says "not restricted" the
  // request is simply processed as the ordinary cancellation it was at that moment (a suspension that
  // starts a moment later does not change a request that was already being handled).
  const mayQualify =
    isLivePaidContract(first) && (hasFreshExitAcceptance(first) || (await getBlockingRestriction(first)) !== null);
  if (!mayQualify) {
    if (options.expectNoPenalty) throw await liftedError(contractId);
    return ordinaryCancellation(contractId, first.status);
  }

  // Outstanding session-level money steps (a release / compensation that failed earlier) are settled BEFORE the PT lock is
  // taken, so the network is never waited on under it (the ending itself refuses to be recorded while one is outstanding).
  const sessionMoneyPlan = await settleUnsettledSessionMoneyFirst(contractId);

  await options.beforeLock?.();

  type Decided =
    | { kind: "REPLAY"; row: NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>> }
    | { kind: "NOT_APPLICABLE" }
    | {
        kind: "RECORDED";
        fresh: NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>>;
        override: NonNullable<Awaited<ReturnType<typeof clientExitOverrideWhilePtRestricted>>>;
        restrictionId: string | null;
        sessionsClosed: number;
        intent: TerminationIntent;
      };

  const decided = await prisma.$transaction(
    async (tx): Promise<Decided> => {
      await lockPt(tx, first.ptUserId);

      // Everything below reads fresh state UNDER the lock.
      const fresh = await contractRepository.findById(contractId, tx);
      if (!fresh) throw new ClientExitError("Contract not found", 404);
      if (fresh.terminationReason === CLIENT_EXIT_DUE_TO_PT_RESTRICTION) return { kind: "REPLAY", row: fresh };

      const override = await clientExitOverrideWhilePtRestricted(fresh, "CLIENT_CANCELLED", clientUserId, tx);
      if (!override) return { kind: "NOT_APPLICABLE" }; // lifted (or the contract moved on) since the unlocked look → refused / ordinary, below

      // ACCEPTANCE (bổ sung 11/10, B). The check above and this write both happen under the PT lock, which a
      // lift also needs - so "the terms held" and "the server accepted them" are one fact. The write goes
      // through the shared client, not the lock's transaction: it is durable NOW, before any money call, so
      // a retry after payment-service failed (even one that lands after the PT was reinstated) finds it and
      // completes with the terms that were accepted. A stale acceptance (older than the TTL) is renewed.
      if (!override.priorAcceptance) {
        const now = new Date();
        await prisma.contract.updateMany({
          where: {
            id: fresh.id,
            status: ContractStatus.ACTIVE,
            OR: [{ clientExitAcceptedAt: null }, { clientExitAcceptedAt: { lt: new Date(now.getTime() - CLIENT_EXIT_ACCEPTANCE_TTL_MS) } }],
          },
          data: {
            clientExitAcceptedAt: now,
            clientExitRestrictionId: override.restriction && override.restriction.id !== "LEGACY_FLAG" ? override.restriction.id : null,
          },
        });
      }
      const restrictionId = override.restriction?.id ?? fresh.clientExitRestrictionId ?? null;

      // 1. Call off what is still open — before the money/status step, like the lock unwind: if
      // anything below fails the contract is still ACTIVE and a retry finds it. Administrative:
      // CANCELLED, quota kept, no no-show, no compensation, cancelledBy = SYSTEM (not the PT's id, so
      // the idle-holdback "PT cancelled counts as activity" rule is not triggered).
      const sessionsClosed = await ptDeactivationService.cancelOpenSessions(fresh, CLIENT_EXIT_CANCEL_REASON, {
        adminId: clientUserId,
        seq: null,
        sessionAuditAction: SESSION_CANCELLED_CLIENT_EXIT,
        sessionAuditExtra: restrictionId ? { restrictionId } : undefined,
        statuses: SESSIONS_CALLED_OFF_ON_EXIT,
      });

      // 2. RECORD the ending with the terms that were just decided (D58/D59): from here on the contract is ENDING, the
      // terms are fixed, and the money call below can be made - and repeated by anybody - without this lock.
      const intent = await beginContractTermination(
        fresh.id,
        CLIENT_EXIT_DUE_TO_PT_RESTRICTION,
        { cancelledBy: clientUserId, cancellationReason: CLIENT_EXIT_CANCEL_REASON },
        { drain: false, plan: sessionMoneyPlan },
      );
      if (!intent) throw new ClientExitError("Contract not found", 404);
      return { kind: "RECORDED", fresh, override, restrictionId, sessionsClosed, intent };
    },
    ptTxOptions(),
  );

  if (decided.kind === "REPLAY") return (await replayIfAlreadyExited(decided.row))!;
  if (decided.kind === "NOT_APPLICABLE") {
    // The terms the client confirmed no longer hold (lifted since the unlocked look): refuse, never reprice quietly.
    if (options.expectNoPenalty) throw await liftedError(contractId);
    return ordinaryCancellation(contractId, first.status);
  }

  const { fresh, override, restrictionId, sessionsClosed, intent } = decided;

  // 3. The shared money path, OUTSIDE every lock. It sends payment-service exactly what every termination sends
  // (used / compensated sessions, already-released amounts, the holdback arg) and NO amount; the refund is computed there
  // from the ledger. Sessions awaiting confirmation / disputed are not called off: their value is HELD (the terminate body
  // carries `unresolvedSessions`), and the PT's notice is stored in the SAME transaction as the status write, so a crash
  // can neither lose it nor repeat it. If an ending with ANOTHER reason had already been recorded for this contract, that
  // one is completed (its reason is never recomputed) and no exit notice is sent.
  const settled = await completeContractTermination(intent, intent.reason === CLIENT_EXIT_DUE_TO_PT_RESTRICTION ? exitHooks() : undefined);

  if (!settled.statusWritten) {
    // Someone else ended the contract between the recording and the write (e.g. the lock unwind), or it was an ending with
    // another reason. The money call replayed its idempotent result; this call changed nothing and records nothing.
    const stored = settled.contract.terminationReason ?? intent.reason;
    return {
      mode: stored === CLIENT_EXIT_DUE_TO_PT_RESTRICTION ? "ALREADY_EXITED" : "ALREADY_ENDED",
      reason: stored,
      settlement: settled.result,
      statusBefore: settled.contract.status,
      restrictionId,
      sessionsClosed,
      unresolvedSessions: settled.unresolvedSessions,
      acceptedBeforeRelease: false,
    };
  }

  // 4. The audit row - one, written by the call that really changed the status.
  await auditService.record({
    actorUserId: clientUserId,
    action: "CONTRACT_TERMINATED",
    entityType: AuditEntityType.CONTRACT,
    entityId: fresh.id,
    metadata: {
      reason: CLIENT_EXIT_DUE_TO_PT_RESTRICTION,
      requestedReason: "CLIENT_CANCELLED",
      actorRole: "CLIENT",
      restrictionId,
      restrictionType: override.restriction?.type ?? null,
      acceptedBeforeRelease: override.restriction === null,
      unresolvedSessions: settled.unresolvedSessions,
      refund: settled.result?.refund ?? null,
      statusBefore: fresh.status,
      sessionsClosed,
    },
    ...options.audit,
  });
  logger.info(
    `[ClientExit] contract=${fresh.id} client=${clientUserId} left a restricted PT (episode ${restrictionId}); sessions closed=${sessionsClosed}`,
  );
  return {
    mode: "EXIT_DUE_TO_PT_RESTRICTION",
    reason: CLIENT_EXIT_DUE_TO_PT_RESTRICTION,
    settlement: settled.result,
    statusBefore: fresh.status,
    restrictionId,
    sessionsClosed,
    unresolvedSessions: settled.unresolvedSessions,
    acceptedBeforeRelease: override.restriction === null,
  };
}
