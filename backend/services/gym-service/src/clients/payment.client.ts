import axios from 'axios';
import { invokeHttpLambda, throwForLambdaHttpError } from './lambda-http.client';

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

async function paymentRequest<T>(params: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeout: number;
}): Promise<T> {
  if (process.env.PAYMENT_LAMBDA_NAME) {
    const result = await invokeHttpLambda({
      functionName: process.env.PAYMENT_LAMBDA_NAME,
      method: params.method,
      path: params.path,
      headers,
      body: params.body,
    });
    throwForLambdaHttpError(result);
    return result.body.data as T;
  }

  const url = `${PAYMENT_SERVICE_URL}${params.path}`;
  const response =
    params.method === 'GET'
      ? await axios.get(url, { headers, timeout: params.timeout })
      : await axios.post(url, params.body ?? {}, { headers, timeout: params.timeout });
  return response.data.data as T;
}

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
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<CheckoutResult> {
    const platformRateNum = Number(params.platformRate);
    try {
      return await paymentRequest<CheckoutResult>({
        method: 'POST',
        path: '/internal/payments/checkout',
        timeout: 20_000,
        body: {
          purpose: 'GYM_MEMBERSHIP',
          relatedEntityType: 'GYM_MEMBERSHIP',
          relatedEntityId: params.membershipId,
          amount: params.amount,
          rates: {
            platformRate: params.platformRate,
            ptRate: '0',
            gymRate: (1 - platformRateNum).toFixed(4),
          },
          parties: { ptUserId: params.gymId, gymId: params.gymId, clientUserId: params.clientId },
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.clientId,
          sourceService: 'gym-service',
          provider: params.provider,
          orderInfo: params.orderInfo,
          platform: params.platform,
          returnBaseUrl: params.returnBaseUrl,
        },
      });
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
    return paymentRequest<WalletTransferResult>({
      method: 'POST',
      path: '/internal/payments/wallet-transfer',
      timeout: 15_000,
      body: {
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
    });
  },

  async markActivated(transactionId: string): Promise<void> {
    await paymentRequest<void>({
      method: 'POST',
      path: `/internal/payments/${transactionId}/mark-activated`,
      timeout: 10_000,
      body: {},
    });
  },

  /** Move a referral commission from the gym's pending bucket into the referring PT's. */
  async settleReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string }) {
    return paymentRequest<{ moved: string; shortfall: string }>({
      method: 'POST',
      path: '/internal/contracts/referral',
      timeout: 15_000,
      body,
    });
  },

  /** Reclaim a proportional share of a referral commission when an admin refunds a membership. */
  async clawbackReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string }) {
    return paymentRequest<{ recovered: string; shortfall: string }>({
      method: 'POST',
      path: '/internal/contracts/referral/clawback',
      timeout: 15_000,
      body,
    });
  },

  /** Release a terminal membership's remaining pending to gym/platform/referral-PT available. */
  async releaseMembershipPending(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    ptUserId?: string | null;
    refundToClient?: string;
    membershipStatus: 'CANCELLED' | 'EXPIRED' | 'PENDING_ISSUE';
    label: string;
    idempotencyKey: string;
  }) {
    return paymentRequest<{
      released: { gym: string; platform: string; ptReferral: string };
      refundedToClient: string;
      shortfall: string;
    }>({
      method: 'POST',
      path: '/internal/contracts/membership-release',
      timeout: 20_000,
      body,
    });
  },

  /** Client self-cancelled — forfeit everything to the parties immediately, no client credit. */
  async forfeitMembershipOnCancel(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    ptUserId?: string | null;
    label: string;
    idempotencyKey: string;
  }) {
    return paymentRequest<{
      released: { gym: string; platform: string; ptReferral: string };
      refundedToClient: string;
      shortfall: string;
    }>({
      method: 'POST',
      path: '/internal/contracts/membership-cancel-forfeit',
      timeout: 20_000,
      body: { ...body, membershipStatus: 'CANCELLED' as const },
    });
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
      return await paymentRequest<{
        transactionId: string;
        status: string;
        refundAmount: number;
        commissionAmount: number;
        netToReceiver: number;
      }>({
        method: 'POST',
        path: `/internal/payments/${params.originalTransactionId}/refund`,
        timeout: 15_000,
        body: {
          refundAmount: params.refundAmount,
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.initiatedBy,
          reason: params.reason,
        },
      });
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'REFUND_FAILED';
      throw Object.assign(new Error(code), { status: e?.response?.status || 502 });
    }
  },

  async getTransaction(transactionId: string): Promise<any> {
    return paymentRequest<any>({
      method: 'GET',
      path: `/internal/payments/${transactionId}`,
      timeout: 10_000,
    });
  },

  async getWallet(ownerType: 'GYM', ownerId: string): Promise<any> {
    return paymentRequest<any>({
      method: 'GET',
      path: `/internal/wallets/${ownerType}/${ownerId}`,
      timeout: 10_000,
    });
  },

  // Money-flow plan 5.3 — gym-service verifies gym ownership itself (see
  // owner.routes.ts's /gyms/:gymId/withdrawals) before ever reaching here; payment-service
  // trusts the gymId because this call only comes over the service-secret-gated /internal
  // boundary, never from a browser.
  async requestGymWithdrawal(gymId: string, amount: string, payoutInfo: string): Promise<any> {
    return paymentRequest<any>({
      method: 'POST',
      path: `/internal/withdrawals/gym/${gymId}`,
      timeout: 10_000,
      body: { amount, payoutInfo },
    });
  },

  async listGymWithdrawals(gymId: string): Promise<any> {
    return paymentRequest<any>({
      method: 'GET',
      path: `/internal/withdrawals/gym/${gymId}`,
      timeout: 10_000,
    });
  },
};

