import { randomUUID } from "crypto";
import { logger } from "@gym-coach/shared";
import { Prisma, ContractStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { notificationService } from "./notification.service";
import { paymentClient } from "../clients/payment.client";

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

/** Sessions that have not been delivered yet, so they must be called off and refunded. */
const FUTURE_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.REQUESTED,
  SessionStatus.CONFIRMED,
  SessionStatus.PENDING_CLIENT_CONFIRMATION,
  SessionStatus.DISPUTED,
];

export interface ContractRefundOutcome {
  contractId: string;
  clientUserId: string;
  status: "REFUNDED" | "CANCELLED_NO_REFUND" | "REFUND_PENDING_MANUAL" | "SKIPPED";
  refundAmount: number;
  unusedSessions: number;
  cancelledSessions: number;
  reason?: string;
}

/**
 * Prorated refund for the sessions the client paid for but will never receive.
 *
 *   unused = totalSessions − usedSessions
 *   refund = price × unused / totalSessions
 *
 * Money is computed with Prisma.Decimal and rounded to the đồng — never with binary
 * floating point, where 1_000_000 × 3/10 is not reliably 300_000.
 *
 * `usedSessions` is already the honest count of delivered sessions: after the client
 * confirmation change, only a COMPLETED session (or a legacy client NO_SHOW) increments it,
 * so anything merely reported by the PT and still awaiting confirmation — or under dispute —
 * counts as unused and is refunded, which is the reading that favours the client.
 */
export function computeProratedRefund(contract: {
  price: Prisma.Decimal | number | null;
  totalSessions: number;
  usedSessions: number;
}): { refund: Prisma.Decimal; unusedSessions: number } {
  const total = contract.totalSessions;
  const unused = Math.max(0, total - contract.usedSessions);
  if (!total || total <= 0 || contract.price == null) {
    return { refund: new Prisma.Decimal(0), unusedSessions: unused };
  }
  const refund = new Prisma.Decimal(contract.price)
    .mul(unused)
    .div(total)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return { refund, unusedSessions: unused };
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
   * sessions that will never happen, refunds the unused portion to the client, and marks
   * the PT hidden from discovery.
   *
   * Each contract is handled independently — one with broken data (no price, zero sessions)
   * or an unaffordable refund is recorded and skipped, never allowed to abort the rest.
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
        outcomes.push(await this.unwindContract(contract, adminId, reason));
      } catch (err) {
        logger.error({
          error: "Failed to unwind contract during PT deactivation",
          contractId: contract.id,
          message: (err as Error).message,
        });
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
      `[PTDeactivation] pt=${ptUserId} contracts=${contracts.length} refunded=${outcomes.filter((o) => o.status === "REFUNDED").length} pendingManual=${outcomes.filter((o) => o.status === "REFUND_PENDING_MANUAL").length} skipped=${outcomes.filter((o) => o.status === "SKIPPED").length}`,
    );
    return { outcomes, suspended };
  },

  async unwindContract(
    contract: {
      id: string;
      clientUserId: string;
      ptUserId: string;
      price: Prisma.Decimal | number | null;
      totalSessions: number;
      usedSessions: number;
      paymentTransactionId: string | null;
    },
    adminId: string,
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

    // 2. Work out what the client is owed.
    const { refund, unusedSessions } = computeProratedRefund(contract);
    const refundAmount = refund.toNumber();

    const cancelContract = () =>
      contractRepository.update(contract.id, {
        status: ContractStatus.CANCELLED,
        cancelledBy: "SYSTEM",
        cancellationReason: reason,
      });

    // Broken data must not take the whole sweep down with it.
    if (!contract.totalSessions || contract.price == null) {
      logger.warn({
        msg: "Contract skipped during PT deactivation — unusable price/sessions",
        contractId: contract.id,
        price: contract.price,
        totalSessions: contract.totalSessions,
      });
      await cancelContract();
      return {
        contractId: contract.id,
        clientUserId: contract.clientUserId,
        status: "SKIPPED",
        refundAmount: 0,
        unusedSessions,
        cancelledSessions,
        reason: "Hợp đồng thiếu giá hoặc số buổi",
      };
    }

    // 3. Nothing paid, or nothing left unused → cancel with no money movement.
    if (refundAmount <= 0 || !contract.paymentTransactionId) {
      await cancelContract();
      await this.notifyClient(
        contract.clientUserId,
        contract.id,
        `Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Không có khoản hoàn tiền${refundAmount > 0 ? " (chưa ghi nhận thanh toán)" : ""}.`,
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

    // 4. Refund through payment-service, which owns the ledger reversal.
    try {
      await paymentClient.refund({
        originalTransactionId: contract.paymentTransactionId,
        refundAmount,
        idempotencyKey: `pt-deactivation-refund:${contract.id}:${randomUUID()}`,
        initiatedBy: adminId,
        reason,
      });
    } catch (err: any) {
      // The PT's wallet no longer holds the money. The client is still owed it, so the
      // contract is still cancelled and the shortfall is escalated instead of swallowed.
      const code = err?.code ?? "REFUND_FAILED";
      logger.error({
        error: "Refund failed during PT deactivation — needs manual settlement",
        contractId: contract.id,
        refundAmount,
        code,
      });
      await cancelContract();
      await this.notifyClient(
        contract.clientUserId,
        contract.id,
        `Hợp đồng đã bị huỷ. Khoản hoàn ${refundAmount.toLocaleString("vi-VN")}đ đang chờ xử lý thủ công.`,
      );
      await notificationService
        .create({
          userId: adminId,
          text: `Hoàn tiền ${refundAmount.toLocaleString("vi-VN")}đ cho hợp đồng ${contract.id.slice(0, 8)} thất bại (${code}) — cần xử lý thủ công.`,
          eventType: "REFUND_NEEDS_MANUAL_SETTLEMENT",
          entityType: "CONTRACT",
          entityId: contract.id,
          link: "/admin/dashboard",
        })
        .catch(() => {});
      return {
        contractId: contract.id,
        clientUserId: contract.clientUserId,
        status: "REFUND_PENDING_MANUAL",
        refundAmount,
        unusedSessions,
        cancelledSessions,
        reason: code,
      };
    }

    await cancelContract();
    await this.notifyClient(
      contract.clientUserId,
      contract.id,
      `Hợp đồng đã bị huỷ do huấn luyện viên ngừng hoạt động. Bạn được hoàn ${refundAmount.toLocaleString("vi-VN")}đ cho ${unusedSessions} buổi chưa sử dụng.`,
    );

    return {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      status: "REFUNDED",
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
