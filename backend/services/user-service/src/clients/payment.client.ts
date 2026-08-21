import axios from 'axios';

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export interface WalletTransferResult {
  status: 'PAID' | 'FAILED';
  transactionId: string;
  failureReason?: string;
}

export interface CheckoutResult {
  transactionId: string;
  status: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
  provider: string;
}

export const paymentClient = {
  /**
   * Start a gateway checkout for a contract. The client pays the gateway directly — no wallet
   * pre-funding — and nothing moves in the ledger until payment-service receives the signed
   * webhook, which then splits the price across escrow and the three pending buckets.
   *
   * The rate table travels with the request and is frozen into the transaction, so the split
   * later uses the terms in force at signing rather than whatever is current at settlement.
   */
  async checkout(params: {
    relatedEntityId: string;
    amount: number;
    rates: { platformRate: string; ptRate: string; gymRate: string };
    parties: { ptUserId: string; gymId?: string | null; clientUserId: string };
    idempotencyKey: string;
    initiatedBy: string;
    provider?: string;
    orderInfo?: string;
  }): Promise<CheckoutResult> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/checkout`,
        {
          purpose: 'PT_CONTRACT',
          relatedEntityType: 'PT_CONTRACT',
          relatedEntityId: params.relatedEntityId,
          amount: params.amount,
          rates: params.rates,
          parties: params.parties,
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.initiatedBy,
          sourceService: 'user-service',
          provider: params.provider,
          orderInfo: params.orderInfo,
        },
        { headers, timeout: 20_000 },
      );
      return data.data as CheckoutResult;
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'CHECKOUT_FAILED';
      throw Object.assign(new Error(e?.response?.data?.error?.message || code), {
        code,
        status: e?.response?.status || 502,
      });
    }
  },

  /** Money movements for a contract, all owned by payment-service. */
  async releaseSession(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/release-session`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  async noShow(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/no-show`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  async terminate(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/terminate`, body, { headers, timeout: 20_000 });
    return data.data;
  },

  async moneyBreakdown(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/money-breakdown`, body, { headers, timeout: 10_000 });
    return data.data;
  },

  async walletTransfer(params: {
    payerOwnerId: string;
    receiverPtId: string;
    amount: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
    ptId: string;
  }): Promise<WalletTransferResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/wallet-transfer`,
      {
        payerOwnerType: 'CLIENT',
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: 'PT',
        receiverOwnerId: params.receiverPtId,
        amount: params.amount,
        purpose: 'PT_CONTRACT',
        relatedEntityType: 'PT_CONTRACT',
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: 'user-service',
        ptId: params.ptId,
        ptContractId: params.relatedEntityId,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as WalletTransferResult;
  },

  async markActivated(transactionId: string): Promise<void> {
    await axios.post(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}/mark-activated`, {}, { headers, timeout: 10_000 });
  },

  async getTransaction(transactionId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}`, { headers, timeout: 10_000 });
    return data.data;
  },

  /**
   * Prorated refund of a PT-contract payment. payment-service owns the ledger: it reverses
   * the entries, claws the platform's commission back proportionally and flips the original
   * transaction — none of that is reimplemented here.
   *
   * Throws with a `code` so the caller can tell an unaffordable refund (the PT's wallet no
   * longer holds the money) apart from a genuine failure.
   */
  async refund(params: {
    originalTransactionId: string;
    refundAmount: number;
    idempotencyKey: string;
    initiatedBy: string;
    reason: string;
  }): Promise<{ transactionId: string; status: string; refundAmount: number }> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/${params.originalTransactionId}/refund`,
        {
          refundAmount: params.refundAmount,
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.initiatedBy,
          reason: params.reason,
        },
        { headers, timeout: 15_000 },
      );
      return data.data;
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'REFUND_FAILED';
      throw Object.assign(new Error(code), {
        code,
        status: e?.response?.status || 502,
      });
    }
  },
};
