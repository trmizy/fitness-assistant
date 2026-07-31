/**
 * Calls payment-service's wallet-transfer primitive to settle a training
 * package purchase. Mirrors gym-service's clients/payment.client.ts — same
 * shared primitive, third caller (after gym-membership and PT-contract).
 */
import axios from "axios";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:3007";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  "dev_internal_service_secret_change_in_production";

const headers = { "x-service-secret": INTERNAL_SERVICE_SECRET };

export interface WalletTransferResult {
  status: "PAID" | "FAILED";
  transactionId: string;
  failureReason?: string;
}

export const paymentClient = {
  async walletTransfer(params: {
    payerOwnerId: string;
    receiverOwnerId: string;
    amount: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
  }): Promise<WalletTransferResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/wallet-transfer`,
      {
        payerOwnerType: "CLIENT",
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: "CLIENT",
        receiverOwnerId: params.receiverOwnerId,
        amount: params.amount,
        purpose: "TRAINING_PACKAGE_PURCHASE",
        relatedEntityType: "TRAINING_PACKAGE_PURCHASE",
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: "ai-service",
      },
      { headers, timeout: 15_000 },
    );
    return data.data as WalletTransferResult;
  },
};
