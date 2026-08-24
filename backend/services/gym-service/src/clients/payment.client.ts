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
   * Start a gateway checkout for a membership. The client pays the gateway directly; the
   * membership activates on the signed webhook, never on this response.
   *
   * A membership has no PT side, so the split is gym versus platform. `ptUserId` still has to
   * be filled because the ledger keys every contract's pending buckets by party — the gym's
   * own id stands in, which keeps the rate table's PT share at zero without a special case.
   */
  async checkout(params: {
    membershipId: string;
    gymId: string;
    clientId: string;
    amount: number;
    platformRate: string;
    idempotencyKey: string;
    provider?: string;
    orderInfo?: string;
  }): Promise<CheckoutResult> {
    const platform = Number(params.platformRate);
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/checkout`,
        {
          purpose: 'GYM_MEMBERSHIP',
          relatedEntityType: 'GYM_MEMBERSHIP',
          relatedEntityId: params.membershipId,
          amount: params.amount,
          rates: {
            platformRate: params.platformRate,
            ptRate: '0',
            gymRate: (1 - platform).toFixed(4),
          },
          parties: { ptUserId: params.gymId, gymId: params.gymId, clientUserId: params.clientId },
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.clientId,
          sourceService: 'gym-service',
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

  async walletTransfer(params: {
    payerOwnerId: string;
    receiverOwnerId: string;
    amount: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
    gymId?: string;
  }): Promise<WalletTransferResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/wallet-transfer`,
      {
        payerOwnerType: 'CLIENT',
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: 'GYM',
        receiverOwnerId: params.receiverOwnerId,
        amount: params.amount,
        purpose: 'GYM_MEMBERSHIP',
        relatedEntityType: 'GYM_MEMBERSHIP',
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: 'gym-service',
        gymId: params.gymId,
        membershipId: params.relatedEntityId,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as WalletTransferResult;
  },

  async markActivated(transactionId: string): Promise<void> {
    await axios.post(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}/mark-activated`, {}, { headers, timeout: 10_000 });
  },

  /** ① Move a referral commission from the gym's pending bucket into the referring PT's. */
  async settleReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string }) {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/referral`, body, { headers, timeout: 15_000 });
    return data.data as { moved: string; shortfall: string };
  },

  /** ② Reclaim a proportional share of a referral commission when an admin refunds a membership. */
  async clawbackReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string }) {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/referral/clawback`, body, { headers, timeout: 15_000 });
    return data.data as { recovered: string; shortfall: string };
  },

  /** ③ Release a terminal membership's remaining pending to gym/platform/referral-PT available. */
  async releaseMembershipPending(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    ptUserId?: string | null;
    refundToClient?: string;
    membershipStatus: 'CANCELLED' | 'EXPIRED';
    label: string;
    idempotencyKey: string;
  }) {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/membership-release`, body, { headers, timeout: 20_000 });
    return data.data as {
      released: { gym: string; platform: string; ptReferral: string };
      refundedToClient: string;
      shortfall: string;
    };
  },

  /** ④ Client self-cancelled — forfeit everything to the parties immediately, no client credit. */
  async forfeitMembershipOnCancel(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    ptUserId?: string | null;
    label: string;
    idempotencyKey: string;
  }) {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/contracts/membership-cancel-forfeit`,
      { ...body, membershipStatus: 'CANCELLED' as const },
      { headers, timeout: 20_000 },
    );
    return data.data as {
      released: { gym: string; platform: string; ptReferral: string };
      refundedToClient: string;
      shortfall: string;
    };
  },

  /** Prorated (partial) refund of a membership's original purchase transaction. */
  async refund(params: {
    originalTransactionId: string;
    refundAmount: number;
    idempotencyKey: string;
    initiatedBy: string;
    reason: string;
  }): Promise<{ transactionId: string; status: string; refundAmount: number; commissionAmount: number; netToReceiver: number }> {
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
      throw Object.assign(new Error(code), { status: e?.response?.status || 502 });
    }
  },

  async getTransaction(transactionId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}`, { headers, timeout: 10_000 });
    return data.data;
  },

  async getWallet(ownerType: 'GYM', ownerId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/wallets/${ownerType}/${ownerId}`, { headers, timeout: 10_000 });
    return data.data;
  },

  // Money-flow plan 5.3 — gym-service verifies gym ownership itself (see
  // owner.routes.ts's /gyms/:gymId/withdrawals) before ever reaching here; payment-service
  // trusts the gymId because this call only comes over the service-secret-gated /internal
  // boundary, never from a browser.
  async requestGymWithdrawal(gymId: string, amount: string, payoutInfo: string): Promise<any> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/withdrawals/gym/${gymId}`,
      { amount, payoutInfo },
      { headers, timeout: 10_000 },
    );
    return data.data;
  },

  async listGymWithdrawals(gymId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/withdrawals/gym/${gymId}`, { headers, timeout: 10_000 });
    return data.data;
  },
};
