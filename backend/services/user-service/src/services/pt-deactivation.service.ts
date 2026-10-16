import { logger } from "@gym-coach/shared";
import { AuditEntityType, ContractStatus, PtRestrictionEndKind, PtRestrictionReasonCategory, PtRestrictionScope, PtRestrictionType, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { auditService, SYSTEM_ACTOR } from "./audit.service";
import { settleContractTermination } from "./contract-payout.service";
import { callOffOpenSessions, NOT_STARTED_SESSION_STATUSES } from "./contract-session-closure";
import { getRemainingEntitlements } from "./contract.service";
import { closeEpisode, lockPt, openEpisode, syncPtSuspendedFlag } from "./pt-restriction.service";
import { ptTxOptions } from "./contract-lock";

/**
 * Contract states that still owe the client something — the ones that must be unwound when
 * a PT can no longer serve them. COMPLETED / EXPIRED / CANCELLED / REJECTED are already
 * settled and are left alone.
 */
export const BLOCKING_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.PENDING_REVIEW,
  ContractStatus.PENDING_SIGNATURE,
  ContractStatus.PENDING_PAYMENT,
  ContractStatus.ACTIVE,
];

/**
 * Sessions that have not been delivered yet, so they must be called off.
 *
 * PT_NO_SHOW_REPORTED is in the set (slice 1): the client reported that the PT never turned up and
 * the PT has to answer — but a locked PT cannot log in to answer, nothing expires that state, and
 * the admin dispute screen only accepts DISPUTED, so the session used to hang forever. It is
 * cancelled exactly like the other sessions the unwind calls off: quota kept (not consumed), no
 * compensation, no ptAtFault mark — the PT is not penalised for a report nobody got to answer, and
 * the client is not short-changed because the contract's whole unused value (this session included)
 * is refunded in full by the PT_BANNED termination right after. The report stays on the row
 * (disputeReason / disputedAt) and the audit entry records that it was closed unadjudicated.
 */
/**
 * F2 / D45-L1+L3: PENDING_CLIENT_CONFIRMATION and DISPUTED are NOT in this set any more. A session the PT already reported
 * delivered (and the client has not answered), or that the client disputed, is not "undelivered": the ban must not cancel
 * it and refund its value. It keeps its state, the ending HOLDS its value (settleContractTermination counts it for every
 * reason), and the client confirm / auto-confirm / admin ruling settles it once, later.
 */
const FUTURE_SESSION_STATUSES: SessionStatus[] = NOT_STARTED_SESSION_STATUSES;

const DEFAULT_LOCK_REASON = "Tài khoản huấn luyện viên bị khoá";

/** The unwind re-reads the PT's open contracts this many times, to catch one a payment activated meanwhile. */
const MAX_UNWIND_PASSES = 3;

export type PtLockAction = "DEACTIVATE" | "REACTIVATE";

/** One lock/unlock command as auth-service relays it. `seq` is auth-service's durable, per-command number. */
export interface PtLockCommand {
  ptUserId: string;
  adminId: string;
  /** What the admin typed; null when the client sent none (the mobile admin screen does not yet). */
  reason: string | null;
  seq: bigint;
}

/**
 * What happened to a command when it reached the profile:
 *  APPLIED   — newer than anything seen, changed the flag.
 *  DUPLICATE — newer than anything seen but the PT was already in that state: no state change.
 *  RETRY     — the very command already applied (same seq) arriving again: carry on / no-op.
 *  STALE     — an even newer command was already applied: this one must not run, ever.
 *  NO_PROFILE— the PT has no profile row; nothing to order against.
 */
export type PtLockClaim = "APPLIED" | "DUPLICATE" | "RETRY" | "STALE" | "NO_PROFILE";

export interface ContractRefundOutcome {
  contractId: string;
  clientUserId: string;
  /**
   * Done:   REFUNDED · CANCELLED_NO_REFUND · ALREADY_ENDED (another actor had already ended it).
   * Not done (the contract is still in a blocking status and the relay will call again):
   *         FAILED · NOT_ATTEMPTED_SUPERSEDED (the lock was replaced by a later command mid-run).
   */
  status: "REFUNDED" | "CANCELLED_NO_REFUND" | "ALREADY_ENDED" | "FAILED" | "NOT_ATTEMPTED_SUPERSEDED";
  refundAmount: number;
  unusedSessions: number;
  cancelledSessions: number;
  reason?: string;
}

const DONE_OUTCOMES: ContractRefundOutcome["status"][] = ["REFUNDED", "CANCELLED_NO_REFUND", "ALREADY_ENDED"];

export interface DeactivationResult {
  outcomes: ContractRefundOutcome[];
  suspended: boolean;
  /** The command was superseded (before or during the run): it did, and will do, nothing more. */
  stale: boolean;
  /** Every unit of work is done. The caller may only treat the command as settled when this is true. */
  complete: boolean;
}

export interface UnwindContext {
  adminId: string;
  seq: bigint | null;
  /** Audit action for each called-off session; the lock unwind's default when absent. */
  sessionAuditAction?: string;
  /** Extra audit metadata for each called-off session (e.g. the restriction episode a client's exit refers to). */
  sessionAuditExtra?: Record<string, string>;
  /** Which open sessions to call off; the lock unwind calls off all of FUTURE_SESSION_STATUSES (the default). */
  statuses?: SessionStatus[];
}

export const ptDeactivationService = {
  /** Contracts that block a PT from being wound down (shared by suspension and resignation). */
  async findBlockingContracts(ptUserId: string) {
    return prisma.contract.findMany({
      where: { ptUserId, status: { in: BLOCKING_CONTRACT_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Orders a lock/unlock command against the ones already applied to this PT.
   *
   * ONE atomic UPDATE ... WHERE decides it, on the sequence number auth-service assigned when it
   * recorded the command — not on the order requests happen to arrive in:
   *   · lock   applies when stored seq is null or <= its own  (<= so the same command may be retried);
   *   · unlock applies when stored seq is null or <  its own  (a repeat of an applied unlock is a no-op).
   * A command that matches zero rows is older than something already applied and is STALE: lock →
   * unlock → a late or retried lock cannot lock the PT again.
   */
  async claimLockCommand(action: PtLockAction, cmd: PtLockCommand): Promise<PtLockClaim> {
    const suspend = action === "DEACTIVATE";
    const at = new Date();

    // One transaction under the PT's lock: the sequence claim, the restriction record (history) and
    // the mirror flag change together or not at all. This stream (auth-service's account lock) only
    // ever opens / closes the PERMANENT_BAN episode: an unlock never lifts a temporary suspension,
    // and a lock that finds a temporary suspension active CONVERTS it (the temporary episode is
    // closed at this instant, the permanent one opened) before the unwind below runs.
    const decided = await prisma.$transaction(async (tx) => {
      await lockPt(tx, cmd.ptUserId);
      const before = await tx.userProfile.findUnique({
        where: { userId: cmd.ptUserId },
        select: { ptSuspended: true, ptLockSeq: true },
      });
      if (!before) return { claim: "NO_PROFILE" as PtLockClaim, before: null, hadBan: false, converted: false };

      const { count } = await tx.userProfile.updateMany({
        where: {
          userId: cmd.ptUserId,
          OR: [{ ptLockSeq: null }, { ptLockSeq: suspend ? { lte: cmd.seq } : { lt: cmd.seq } }],
        },
        data: { ptLockSeq: cmd.seq },
      });
      if (count === 0) {
        const now = await tx.userProfile.findUnique({ where: { userId: cmd.ptUserId }, select: { ptLockSeq: true } });
        return { claim: (now?.ptLockSeq === cmd.seq ? "RETRY" : "STALE") as PtLockClaim, before, hadBan: false, converted: false };
      }

      // The command is the newest seen: bring the restriction record in line with it.
      // ACCOUNT scope only: a restriction on one contract is neither a ban nor a suspension of the PT.
      const active = await tx.ptRestriction.findFirst({
        where: { ptUserId: cmd.ptUserId, endedAt: null, scope: PtRestrictionScope.ACCOUNT },
      });
      // A flag set with no row at all is a legacy lock (before the history existed): it counts as a ban.
      const hadBan = active ? active.type === PtRestrictionType.PERMANENT_BAN : before.ptSuspended;
      let converted = false;
      if (suspend) {
        if (active?.type === PtRestrictionType.TEMPORARY_SUSPENSION) {
          await closeEpisode(tx, active, {
            at,
            by: cmd.adminId,
            reason: cmd.reason,
            kind: PtRestrictionEndKind.CONVERTED_TO_PERMANENT,
          });
          converted = true;
        }
        if (active?.type !== PtRestrictionType.PERMANENT_BAN) {
          // The ban supersedes any restriction on single contracts: they close here (the unwind below ends the contracts).
          const ownEpisodes = await tx.ptRestriction.findMany({
            where: { ptUserId: cmd.ptUserId, endedAt: null, scope: PtRestrictionScope.CONTRACT },
          });
          for (const own of ownEpisodes) {
            await closeEpisode(tx, own, { at, by: cmd.adminId, reason: cmd.reason, kind: PtRestrictionEndKind.CONVERTED_TO_PERMANENT });
          }
          await openEpisode(tx, {
            ptUserId: cmd.ptUserId,
            type: PtRestrictionType.PERMANENT_BAN,
            reasonCategory: PtRestrictionReasonCategory.UNSPECIFIED,
            reasonText: cmd.reason,
            imposedBy: cmd.adminId,
            startedAt: at,
            lockSeq: cmd.seq,
          });
        }
      } else if (active?.type === PtRestrictionType.PERMANENT_BAN) {
        await closeEpisode(tx, active, { at, by: cmd.adminId, reason: cmd.reason, kind: PtRestrictionEndKind.LIFTED });
      }
      await syncPtSuspendedFlag(tx, cmd.ptUserId);

      const claim: PtLockClaim =
        before.ptLockSeq === cmd.seq ? "RETRY" : hadBan === suspend ? "DUPLICATE" : "APPLIED";
      return { claim, before, hadBan, converted };
    }, ptTxOptions());
    const { claim, before } = decided;
    if (claim === "NO_PROFILE" || !before) return "NO_PROFILE";

    if (claim === "APPLIED" || claim === "DUPLICATE") {
      await auditService.record({
        actorUserId: cmd.adminId,
        action: suspend ? "PT_LOCKED" : "PT_UNLOCKED",
        entityType: AuditEntityType.PT_PROFILE,
        entityId: cmd.ptUserId,
        metadata: {
          seq: cmd.seq.toString(),
          reason: cmd.reason,
          previousSuspended: decided.hadBan,
          convertedFromTemporarySuspension: decided.converted,
          previousSeq: before.ptLockSeq == null ? null : before.ptLockSeq.toString(),
          noop: claim === "DUPLICATE",
        },
      });
    } else if (claim === "STALE") {
      const now = await prisma.userProfile.findUnique({ where: { userId: cmd.ptUserId }, select: { ptLockSeq: true } });
      logger.warn(
        `[PTDeactivation] ignoring stale ${action} seq=${cmd.seq} for pt=${cmd.ptUserId} (already at seq=${now?.ptLockSeq})`,
      );
      await auditService.record({
        actorUserId: cmd.adminId,
        action: "PT_LOCK_COMMAND_IGNORED_STALE",
        entityType: AuditEntityType.PT_PROFILE,
        entityId: cmd.ptUserId,
        metadata: {
          command: action,
          seq: cmd.seq.toString(),
          appliedSeq: now?.ptLockSeq == null ? null : now.ptLockSeq.toString(),
          reason: cmd.reason,
        },
      });
    }
    return claim;
  },

  /** True while `seq` is still the command that owns this PT's lock state (and the PT is still locked). */
  async isLockCurrent(ptUserId: string, seq: bigint): Promise<boolean> {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: ptUserId },
      select: { ptSuspended: true, ptLockSeq: true },
    });
    return !profile || (profile.ptSuspended && profile.ptLockSeq === seq);
  },

  /**
   * Unwinds every open contract of a PT whose account is being locked: cancels the sessions that
   * will never happen, settles the contract's money, and marks the PT hidden from discovery.
   *
   * Each contract is a separate unit with its own recorded outcome (the response, plus an
   * AuditLog row per contract). A unit that fails is NOT swallowed into a success: `complete`
   * stays false, the contract is left in its open status ("needs processing" == still in
   * BLOCKING_CONTRACT_STATUSES), the route answers with an error, auth-service keeps the command
   * FAILED and its sweep calls again. Every step is safe to repeat: the PT flag is a CAS on the
   * command's sequence number, the unit list is re-derived from the contracts' own status, session
   * cancellation and the contract status write are guarded updates, and the money call carries
   * `CONTRACT_TERMINATE:<contractId>`.
   */
  async deactivatePT(cmd: PtLockCommand): Promise<DeactivationResult> {
    // Hide from discovery first (and claim the command's place in the order): no new client
    // should be able to book a PT that is on the way out while the unwind is still running.
    const claim = await this.claimLockCommand("DEACTIVATE", cmd);
    if (claim === "STALE") return { outcomes: [], suspended: false, stale: true, complete: true };

    const reason = cmd.reason?.trim() || DEFAULT_LOCK_REASON;
    const ctx: UnwindContext = { adminId: cmd.adminId, seq: cmd.seq };
    const outcomes: ContractRefundOutcome[] = [];
    const attempted = new Set<string>();
    let superseded = false;

    for (let pass = 0; pass < MAX_UNWIND_PASSES && !superseded; pass++) {
      // Re-read every pass: a payment can activate a PENDING_PAYMENT contract mid-run, and a
      // contract that failed earlier in THIS run is left for the relay's retry, not hammered here.
      const contracts = (await this.findBlockingContracts(cmd.ptUserId)).filter((c) => !attempted.has(c.id));
      if (contracts.length === 0) break;

      for (const contract of contracts) {
        attempted.add(contract.id);
        if (claim !== "NO_PROFILE" && !(await this.isLockCurrent(cmd.ptUserId, cmd.seq))) {
          // An unlock (or a later lock) took over while we were working: it owns the PT now.
          superseded = true;
        }
        if (superseded) {
          outcomes.push(this.notDone(contract, "NOT_ATTEMPTED_SUPERSEDED", "lock superseded by a later command"));
          continue;
        }
        try {
          outcomes.push(await this.unwindContract(contract, reason, ctx));
        } catch (err) {
          outcomes.push(await this.recordUnwindFailure(contract, err as Error, ctx));
        }
      }
    }

    const complete = superseded || outcomes.every((o) => DONE_OUTCOMES.includes(o.status));
    logger.info(
      `[PTDeactivation] pt=${cmd.ptUserId} seq=${cmd.seq} contracts=${outcomes.length} refunded=${outcomes.filter((o) => o.status === "REFUNDED").length} failed=${outcomes.filter((o) => o.status === "FAILED").length} superseded=${superseded} complete=${complete}`,
    );
    return { outcomes, suspended: claim !== "NO_PROFILE", stale: superseded, complete };
  },

  /**
   * Lifts the discovery/booking block — if this unlock is newer than whatever is applied.
   * Contracts are NOT restored. A repeated unlock is a no-op; an unlock older than the last
   * applied command is stale and changes nothing.
   */
  async reactivatePT(cmd: PtLockCommand): Promise<{ reactivated: boolean; stale: boolean; duplicate: boolean }> {
    const claim = await this.claimLockCommand("REACTIVATE", cmd);
    return {
      reactivated: claim === "APPLIED" || claim === "DUPLICATE" || claim === "RETRY",
      stale: claim === "STALE",
      duplicate: claim === "DUPLICATE" || claim === "RETRY",
    };
  },

  async unwindContract(
    contract: {
      id: string;
      clientUserId: string;
      ptUserId: string;
      totalSessions: number;
      usedSessions: number;
      compensatedSessions: number;
    },
    reason: string,
    ctx: UnwindContext = { adminId: SYSTEM_ACTOR, seq: null },
  ): Promise<ContractRefundOutcome> {
    // 1. Call off everything not yet delivered. Done BEFORE the money/status step on purpose: if
    // anything below fails the contract is still open and the retry finds it; the other way round
    // a contract already CANCELLED would never be picked up again and its sessions would hang.
    const cancelledSessions = await this.cancelOpenSessions(contract, reason, ctx);

    // 2. Settle the contract's money through the exact same formula and idempotency key every
    // other termination path in the system uses (P0 cluster A2). This file used to run its own
    // prorated-refund formula (which ignored compensatedSessions, disagreeing with
    // contract-money.ts) and call payment-service's raw transaction refund with a fresh random
    // idempotency key on every attempt — so a retried deactivation call (the auth-service relay
    // explicitly documents retrying as safe) would refund the same contract a second time.
    // settleContractTermination is the one shared path: stable `CONTRACT_TERMINATE:<contractId>`
    // key, compensatedSessions accounted for, and a status write that is guarded on the status it
    // read — so a payment that activates the contract meanwhile is refunded through the ledger,
    // not stranded. The client-facing "Lý do" text is written in the same guarded UPDATE.
    const settled = await settleContractTermination(contract.id, "PT_BANNED", {
      cancelledBy: SYSTEM_ACTOR,
      cancellationReason: reason,
    });
    if (!settled) throw new Error(`Contract ${contract.id} no longer exists`);

    const unusedSessions = getRemainingEntitlements(settled.contract);
    const base = { contractId: contract.id, clientUserId: contract.clientUserId, unusedSessions, cancelledSessions };
    const refundAmount = Number(settled.result?.refund ?? 0);

    let outcome: ContractRefundOutcome;
    if (!settled.statusWritten) {
      // Someone else had already ended the contract (and its money was replayed, not repeated).
      outcome = {
        ...base,
        status: "ALREADY_ENDED",
        refundAmount,
        reason: `contract was already ${settled.contract.status}`,
      };
    } else if (settled.result === null) {
      // Never paid — no money to move.
      await this.notifyClient(
        contract.clientUserId,
        contract.id,
        "Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Không có khoản hoàn tiền (chưa ghi nhận thanh toán).",
      );
      outcome = { ...base, status: "CANCELLED_NO_REFUND", refundAmount: 0 };
    } else {
      await this.notifyClient(
        contract.clientUserId,
        contract.id,
        refundAmount > 0
          ? `Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Bạn được hoàn ${refundAmount.toLocaleString("vi-VN")}đ cho ${unusedSessions} buổi chưa sử dụng.`
          : "Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Không có khoản hoàn tiền.",
      );
      outcome = { ...base, status: refundAmount > 0 ? "REFUNDED" : "CANCELLED_NO_REFUND", refundAmount };
    }

    await auditService.record({
      actorUserId: ctx.adminId,
      action: "PT_LOCK_CONTRACT_UNWOUND",
      entityType: AuditEntityType.CONTRACT,
      entityId: contract.id,
      metadata: {
        seq: ctx.seq == null ? null : ctx.seq.toString(),
        outcome: outcome.status,
        refundAmount: outcome.refundAmount,
        unusedSessions,
        cancelledSessions,
        statusBefore: settled.contract.status,
        reason,
      },
    });
    return outcome;
  },

  /**
   * Cancels a contract's not-yet-delivered sessions one by one, each with a compare-and-swap on
   * the status it was read in — a session that moved on meanwhile (a client confirmed it, the PT
   * reported it) is never overwritten blindly; it is re-read on the next pass. Throws if sessions
   * are still open after the last pass, so the contract stays "needs processing".
   *
   * `cancelledBy` is SYSTEM, never the PT's id: the idle-holdback clock counts a PT-cancelled
   * session as activity (contract.repository.ts findIdleHoldbackCandidates), and a lock is not the
   * PT cancelling.
   */
  async cancelOpenSessions(
    contract: { id: string },
    reason: string,
    ctx: UnwindContext = { adminId: SYSTEM_ACTOR, seq: null },
  ): Promise<number> {
    // The routine itself lives in contract-session-closure.ts (F1): every contract ending uses it, this
    // wrapper only carries the lock unwind's own audit action and its wider default set of statuses.
    return callOffOpenSessions(contract.id, reason, {
      actorUserId: ctx.adminId,
      seq: ctx.seq,
      auditAction: ctx.sessionAuditAction ?? "SESSION_CANCELLED_PT_LOCK",
      auditExtra: ctx.sessionAuditExtra,
      statuses: ctx.statuses ?? FUTURE_SESSION_STATUSES,
    });
  },

  /** A failed unit: logged, audited, the admin told once per (contract, command), and returned as FAILED. */
  async recordUnwindFailure(
    contract: { id: string; clientUserId: string },
    err: Error,
    ctx: UnwindContext,
  ): Promise<ContractRefundOutcome> {
    logger.error({
      error: "Failed to unwind contract during PT deactivation",
      contractId: contract.id,
      message: err.message,
    });
    const seqText = ctx.seq == null ? null : ctx.seq.toString();
    // The relay retries every few minutes until the contract is done: tell the admin about a
    // given failure once per command, not on every retry.
    const alreadyReported =
      seqText === null
        ? 0
        : await prisma.auditLog
            .count({
              where: {
                entityType: AuditEntityType.CONTRACT,
                entityId: contract.id,
                action: "PT_LOCK_CONTRACT_UNWIND_FAILED",
                metadata: { path: ["seq"], equals: seqText },
              },
            })
            .catch(() => 0);
    await auditService.record({
      actorUserId: ctx.adminId,
      action: "PT_LOCK_CONTRACT_UNWIND_FAILED",
      entityType: AuditEntityType.CONTRACT,
      entityId: contract.id,
      metadata: { seq: seqText, error: err.message },
    });
    if (alreadyReported === 0) {
      await notificationService
        .create({
          userId: ctx.adminId,
          text: `Chấm dứt hợp đồng ${contract.id.slice(0, 8)} khi khoá huấn luyện viên thất bại — hệ thống sẽ tự thử lại; nếu vẫn lỗi cần kiểm tra thủ công.`,
          eventType: "REFUND_NEEDS_MANUAL_SETTLEMENT",
          entityType: "CONTRACT",
          entityId: contract.id,
          link: "/admin/dashboard",
        })
        .catch(() => {});
    }
    // An ending that is recorded but not confirmed (CONTRACT_ENDING) says so generically to a client; the admin's report
    // names what payment-service actually answered.
    const cause = (err as { cause?: unknown }).cause;
    return this.notDone(contract, "FAILED", cause instanceof Error ? `${err.message} [${cause.message}]` : err.message);
  },

  notDone(
    contract: { id: string; clientUserId: string },
    status: "FAILED" | "NOT_ATTEMPTED_SUPERSEDED",
    reason: string,
  ): ContractRefundOutcome {
    return {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      status,
      refundAmount: 0,
      unusedSessions: 0,
      cancelledSessions: 0,
      reason,
    };
  },

  async notifyClient(userId: string, contractId: string, text: string) {
    await notificationService
      .create({
        userId,
        text,
        eventType: "CONTRACT_CANCELLED_PT_DEACTIVATED",
        entityType: "CONTRACT",
        entityId: contractId,
        link: "/client/contracts",
      })
      .catch(() => {});
  },
};
