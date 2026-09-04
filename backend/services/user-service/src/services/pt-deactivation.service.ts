import { logger } from "@gym-coach/shared";
import { ContractStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { notificationService } from "./notification.service";
import { terminateContractMoney } from "./contract-payout.service";
import { getRemainingEntitlements } from "./contract.service";

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

/** Sessions that have not been delivered yet, so they must be called off. */
const FUTURE_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.REQUESTED,
  SessionStatus.CONFIRMED,
  SessionStatus.PENDING_CLIENT_CONFIRMATION,
  SessionStatus.DISPUTED,
];

export interface ContractRefundOutcome {
  contractId: string;
  clientUserId: string;
  status: "REFUNDED" | "CANCELLED_NO_REFUND" | "SKIPPED";
  refundAmount: number;
  unusedSessions: number;
  cancelledSessions: number;
  reason?: string;
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
   * Unwinds every open contract of a PT whose account is being disabled: cancels the
   * sessions that will never happen, settles the contract's money, and marks the PT hidden
   * from discovery.
   *
   * Each contract is handled independently — one that fails is recorded and skipped, never
   * allowed to abort the rest. auth-service's relay (pt-deactivation-relay.service.ts) may
   * call this endpoint again on a retry; that is safe because every step below is either
   * idempotent (terminateContractMoney's `CONTRACT_TERMINATE:<contractId>` key) or re-derives
   * "what's left to do" from the contract's current status on every call.
   */
  async deactivatePT(
    ptUserId: string,
    adminId: string,
    reason = "Tài khoản huấn luyện viên bị khoá",
  ): Promise<{ outcomes: ContractRefundOutcome[]; suspended: boolean }> {
    // Hide from discovery first: no new client should be able to book a PT that is on the
    // way out while the unwind is still running.
    const suspended = await this.setPtSuspended(ptUserId, true);

    const contracts = await this.findBlockingContracts(ptUserId);
    const outcomes: ContractRefundOutcome[] = [];

    for (const contract of contracts) {
      try {
        outcomes.push(await this.unwindContract(contract, reason));
      } catch (err) {
        logger.error({
          error: "Failed to unwind contract during PT deactivation",
          contractId: contract.id,
          message: (err as Error).message,
        });
        await notificationService
          .create({
            userId: adminId,
            text: `Chấm dứt hợp đồng ${contract.id.slice(0, 8)} khi khoá huấn luyện viên thất bại — cần kiểm tra thủ công.`,
            eventType: "REFUND_NEEDS_MANUAL_SETTLEMENT",
            entityType: "CONTRACT",
            entityId: contract.id,
            link: "/admin/dashboard",
          })
          .catch(() => {});
        outcomes.push({
          contractId: contract.id,
          clientUserId: contract.clientUserId,
          status: "SKIPPED",
          refundAmount: 0,
          unusedSessions: 0,
          cancelledSessions: 0,
          reason: (err as Error).message,
        });
      }
    }

    logger.info(
      `[PTDeactivation] pt=${ptUserId} contracts=${contracts.length} refunded=${outcomes.filter((o) => o.status === "REFUNDED").length} skipped=${outcomes.filter((o) => o.status === "SKIPPED").length}`,
    );
    return { outcomes, suspended };
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
  ): Promise<ContractRefundOutcome> {
    // 1. Call off everything not yet delivered.
    const { count: cancelledSessions } = await prisma.session.updateMany({
      where: { contractId: contract.id, status: { in: FUTURE_SESSION_STATUSES } },
      data: {
        status: SessionStatus.CANCELLED,
        cancelledBy: "SYSTEM",
        cancellationReason: reason,
      },
    });

    const unusedSessions = getRemainingEntitlements(contract);

    // 2. Settle the contract's money through the exact same formula and idempotency key every
    // other termination path in the system uses (P0 cluster A2). This file used to run its own
    // prorated-refund formula (which ignored compensatedSessions, disagreeing with
    // contract-money.ts) and call payment-service's raw transaction refund with a fresh random
    // idempotency key on every attempt — so a retried deactivation call (the auth-service relay
    // explicitly documents retrying as safe) would refund the same contract a second time.
    // terminateContractMoney is the one shared path: stable `CONTRACT_TERMINATE:<contractId>`
    // key, and it already accounts for compensatedSessions. It also returns null for a
    // contract that was never paid (or has no usable price/session count) instead of touching
    // anything — that case is handled below.
    const result = await terminateContractMoney(contract.id, "PT_BANNED");

    if (result === null) {
      // Never paid — no money to move. Cancel the contract ourselves; terminateContractMoney
      // did not touch it.
      await contractRepository.update(contract.id, {
        status: ContractStatus.CANCELLED,
        cancelledBy: "SYSTEM",
        cancellationReason: reason,
      });
      await this.notifyClient(
        contract.clientUserId,
        contract.id,
        "Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Không có khoản hoàn tiền (chưa ghi nhận thanh toán).",
      );
      return {
        contractId: contract.id,
        clientUserId: contract.clientUserId,
        status: "CANCELLED_NO_REFUND",
        refundAmount: 0,
        unusedSessions,
        cancelledSessions,
      };
    }

    // terminateContractMoney already committed status/terminatedAt/terminationReason on the
    // contract row — this only fills in the client-facing "Lý do" text shown on the contract
    // detail page, which the shared path does not set for itself.
    await contractRepository.update(contract.id, { cancelledBy: "SYSTEM", cancellationReason: reason });

    const refundAmount = Number(result.refund ?? 0);
    await this.notifyClient(
      contract.clientUserId,
      contract.id,
      refundAmount > 0
        ? `Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Bạn được hoàn ${refundAmount.toLocaleString("vi-VN")}đ cho ${unusedSessions} buổi chưa sử dụng.`
        : "Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Không có khoản hoàn tiền.",
    );

    return {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      status: refundAmount > 0 ? "REFUNDED" : "CANCELLED_NO_REFUND",
      refundAmount,
      unusedSessions,
      cancelledSessions,
    };
  },

  /** Flips the discovery/booking block. Returns false when the profile doesn't exist. */
  async setPtSuspended(ptUserId: string, suspended: boolean): Promise<boolean> {
    const { count } = await prisma.userProfile.updateMany({
      where: { userId: ptUserId },
      data: { ptSuspended: suspended },
    });
    return count > 0;
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
