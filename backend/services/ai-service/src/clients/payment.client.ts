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

export interface CheckoutResult {
  transactionId: string;
  status: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
  provider: string;
}

export interface OrderReleaseResult {
  released: { pt: string; platform: string };
}

export interface OrderRefundResult {
  refund: string;
  clawedBack: { pt: string; platform: string };
  shortfall: string;
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
  /**
   * P0 cluster C2 — start a gateway checkout for a Personalized PT Service order. The buyer
   * pays the gateway directly; the order activates only once payment-service's webhook
   * confirms it (POST /internal/personalized-service/orders/:id/activate-after-payment) —
   * never on this response. Replaces walletTransfer for this purchase type, which required a
   * pre-funded wallet balance that no longer exists (wallet top-up is disabled).
   */
  async checkout(params: {
    orderId: string;
    sellerId: string;
    buyerId: string;
    amount: number;
    platformRate: string;
    idempotencyKey: string;
    provider?: string;
    orderInfo?: string;
    platform?: "web" | "mobile";
    returnBaseUrl?: string;
  }): Promise<CheckoutResult> {
    const platformRateNum = Number(params.platformRate);
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/checkout`,
        {
          purpose: "PERSONALIZED_SERVICE_PURCHASE",
          relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE",
          relatedEntityId: params.orderId,
          amount: params.amount,
          rates: { platformRate: params.platformRate, ptRate: (1 - platformRateNum).toFixed(4), gymRate: "0" },
          parties: { ptUserId: params.sellerId, clientUserId: params.buyerId },
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.buyerId,
          sourceService: "ai-service",
          provider: params.provider,
          orderInfo: params.orderInfo,
          platform: params.platform,
          returnBaseUrl: params.returnBaseUrl,
        },
        { headers, timeout: 20_000 },
      );
      return data.data as CheckoutResult;
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || "CHECKOUT_FAILED";
      throw Object.assign(new Error(e?.response?.data?.error?.message || code), {
        code,
        status: e?.response?.status || 502,
      });
    }
  },

  async getTransaction(transactionId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}`, { headers, timeout: 10_000 });
    return data.data;
  },

  /** P0 cluster C3 — the buyer accepted (or auto-accept did): the PT and platform's full
   * pending share for this order becomes withdrawable. */
  async releaseOrder(params: {
    transactionId: string;
    price: number;
    platformRate: string;
    parties: { ptUserId: string; clientUserId: string };
    label: string;
    idempotencyKey: string;
  }): Promise<OrderReleaseResult> {
    const platform = Number(params.platformRate);
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/personalized-service/release`,
      {
        transactionId: params.transactionId,
        price: String(params.price),
        rates: { platformRate: params.platformRate, ptRate: (1 - platform).toFixed(4) },
        parties: params.parties,
        label: params.label,
        idempotencyKey: params.idempotencyKey,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as OrderReleaseResult;
  },

  /** P0 cluster C4/C5 — hands the client back refundAmount, pulling from pending first, then
   * clawing back from available (falling back to a PartnerReceivable debt against the PT if
   * even that comes up short — the client is always made whole). */
  async refundOrder(params: {
    transactionId: string;
    refundAmount: number;
    platformRate: string;
    parties: { ptUserId: string; clientUserId: string };
    label: string;
    idempotencyKey: string;
  }): Promise<OrderRefundResult> {
    const platform = Number(params.platformRate);
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/personalized-service/refund`,
      {
        transactionId: params.transactionId,
        refundAmount: String(params.refundAmount),
        rates: { platformRate: params.platformRate, ptRate: (1 - platform).toFixed(4) },
        parties: params.parties,
        label: params.label,
        idempotencyKey: params.idempotencyKey,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as OrderRefundResult;
  },
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
        // Cụm C1: the payer always spends from their own CLIENT (personal) wallet regardless
        // of what other role they hold — but the receiver here is never a client. Both of this
        // function's callers (marketplace TrainingPackage purchase, and — until the C2/C3 fix
        // — Personalized Service purchase) gate the seller behind assertApprovedPtSeller /
        // assertApprovedPt first, so the receiver is always an approved PT. Crediting a
        // "CLIENT"-type wallet keyed by the PT's own userId used to put their earnings
        // somewhere GET /me/pt-wallet and POST /me/withdrawals (both hard-keyed to the PT
        // wallet type) could never see or reach.
        payerOwnerType: "CLIENT",
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: "PT",
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
};
