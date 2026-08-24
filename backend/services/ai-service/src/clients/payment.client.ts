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

export interface RefundResult {
  transactionId: string;
  status: string;
  refundAmount: number;
}

export interface HoldPersonalizedServiceResult extends WalletTransferResult {
  escrowAfter?: string;
  pending?: { seller: string; platform: string };
}

export type PersonalizedServiceMilestone =
  | "INTAKE_REVIEWED"
  | "DRAFT_DELIVERED"
  | "ACCEPTED"
  | "COMPLETED";

export interface ReleaseMilestoneResult {
  milestone: PersonalizedServiceMilestone;
  released: { seller: string; platform: string };
}

export interface RefundHeldResult {
  refunded: string;
  drawnFrom: { sellerPending: string; sellerAvailable: string; platformPending: string; platformAvailable: string };
  shortfall: string;
}

export interface LedgerSummaryResult {
  held: { seller: string; platform: string };
}

export class PaymentClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

export const paymentClient = {
  async walletTransfer(params: {
    payerOwnerId: string;
    receiverOwnerId: string;
    amount: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
    // Defaults preserve marketplace.service.ts's existing TrainingPackage
    // purchase call, which never passed these. personalized-service.service.ts
    // passes PERSONALIZED_SERVICE_PURCHASE explicitly — without this, every
    // Personalized Service order was silently ledgered as a TrainingPackage
    // purchase, which would corrupt payment-service's own reporting/reconciliation.
    purpose?: "TRAINING_PACKAGE_PURCHASE" | "PERSONALIZED_SERVICE_PURCHASE";
    relatedEntityType?: "TRAINING_PACKAGE_PURCHASE" | "PERSONALIZED_SERVICE_PURCHASE";
  }): Promise<WalletTransferResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/wallet-transfer`,
      {
        payerOwnerType: "CLIENT",
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: "CLIENT",
        receiverOwnerId: params.receiverOwnerId,
        amount: params.amount,
        purpose: params.purpose ?? "TRAINING_PACKAGE_PURCHASE",
        relatedEntityType: params.relatedEntityType ?? "TRAINING_PACKAGE_PURCHASE",
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: "ai-service",
      },
      { headers, timeout: 15_000 },
    );
    return data.data as WalletTransferResult;
  },

  // Reuses payment-service's EXISTING generic partial-refund endpoint (the
  // same one gym-service uses for early membership cancellation) — no new
  // refund/escrow primitive. `idempotencyKey` should be deterministic per
  // (order, amount) so a double-click or retry replays the same result
  // instead of refunding twice; a genuinely different amount gets a new key
  // and a fresh transaction, by design (lets an admin retry with a
  // corrected amount after a legitimate failure).
  async refundTransaction(
    originalTransactionId: string,
    params: { refundAmount: number; initiatedBy: string; reason: string; idempotencyKey: string },
  ): Promise<RefundResult> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/${originalTransactionId}/refund`,
        params,
        { headers, timeout: 15_000 },
      );
      return data.data as RefundResult;
    } catch (err: any) {
      const status = err?.response?.status ?? 500;
      const code = err?.response?.data?.error?.code ?? "REFUND_FAILED";
      throw new PaymentClientError(
        err?.response?.data?.error?.message ?? code,
        code,
        status,
      );
    }
  },

  // ── Personalized PT Service escrow (P1-FIN-001/002) ──────────────────────
  // Deliberately a SEPARATE trio of calls from walletTransfer/refundTransaction
  // above (which TrainingPackagePurchase still uses unchanged) — see
  // personalized-service-ledger.service.ts (payment-service) for why this
  // holds the price instead of crediting AVAILABLE immediately.

  async holdPersonalizedServicePayment(params: {
    buyerId: string;
    sellerId: string;
    price: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
    label: string;
  }): Promise<HoldPersonalizedServiceResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/personalized-service/hold`,
      {
        buyerId: params.buyerId,
        sellerId: params.sellerId,
        price: params.price,
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: "ai-service",
        label: params.label,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as HoldPersonalizedServiceResult;
  },

  async releasePersonalizedServiceMilestone(params: {
    transactionId: string;
    sellerId: string;
    price: number;
    milestone: PersonalizedServiceMilestone;
    label: string;
  }): Promise<ReleaseMilestoneResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/personalized-service/release-milestone`,
      params,
      { headers, timeout: 15_000 },
    );
    return data.data as ReleaseMilestoneResult;
  },

  async refundPersonalizedServiceHeld(params: {
    transactionId: string;
    sellerId: string;
    buyerId: string;
    refundAmount: number;
    initiatedBy: string;
    reason: string;
    label: string;
  }): Promise<RefundHeldResult> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/personalized-service/refund`,
        params,
        { headers, timeout: 15_000 },
      );
      return data.data as RefundHeldResult;
    } catch (err: any) {
      const status = err?.response?.status ?? 500;
      const code = err?.response?.data?.error?.code ?? "REFUND_FAILED";
      throw new PaymentClientError(
        err?.response?.data?.error?.message ?? code,
        code,
        status,
      );
    }
  },

  async getPersonalizedServiceLedgerSummary(
    transactionId: string,
    sellerId: string,
  ): Promise<LedgerSummaryResult> {
    const { data } = await axios.get(
      `${PAYMENT_SERVICE_URL}/internal/payments/personalized-service/${transactionId}/${sellerId}/ledger-summary`,
      { headers, timeout: 15_000 },
    );
    return data.data as LedgerSummaryResult;
  },
};
