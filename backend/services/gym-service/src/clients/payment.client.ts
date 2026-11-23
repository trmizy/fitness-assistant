import axios from 'axios';
import { invokeHttpLambda, throwForLambdaHttpError } from './lambda-http.client';
import type { EntityOrigin } from '../services/synthetic-guard';

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

/** payment-service's answer to the supplementary membership refund (see refundMembershipSupplement). */
export interface MembershipSupplementAnswer {
  refundedToClient: string;
  shortfall: string;
  gymShare?: string;
  gymDebited?: string;
  gymShortfall?: string;
  platformShare?: string;
  platformDebited?: string;
  obligationId?: string;
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
    entityOrigin?: EntityOrigin;
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
          ...(params.entityOrigin ? { entityOrigin: params.entityOrigin } : {}),
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
    entityOrigin?: EntityOrigin;
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
        ...(params.entityOrigin ? { entityOrigin: params.entityOrigin } : {}),
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
  async settleReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string; entityOrigin?: EntityOrigin }) {
    return paymentRequest<{ moved: string; shortfall: string }>({
      method: 'POST',
      path: '/internal/contracts/referral',
      timeout: 15_000,
      body,
    });
  },

  /** Reclaim a proportional share of a referral commission when an admin refunds a membership. */
  async clawbackReferral(body: { transactionId: string; gymId: string; ptUserId: string; amount: string; label: string; idempotencyKey: string; entityOrigin?: EntityOrigin }) {
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
    entityOrigin?: EntityOrigin;
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

  /**
   * Q5/Q1: the SUPPLEMENTARY refund of an after-refund appeal won by the member - ONLY the difference, idempotent on `idempotencyKey` (GYM_CASE_APPEAL_SUPPLEMENT:<approvalId>).
   * payment-service route: POST /internal/contracts/membership-appeal-supplement  { transactionId, gymId, clientId, amount, label, idempotencyKey, entityOrigin? }
   *   -> data { refundedToClient, shortfall, gymShare, gymDebited, gymShortfall, platformShare, platformDebited, obligationId? }.
   * `shortfall` is what the MEMBER is still short and is always "0.00" (the member is paid in full); `gymShortfall` is the part of the gym's 90 % share its wallet could not fund -
   * the platform fronted it and payment-service recorded a GYM_DEBT obligation (obligationId). A 4xx (409 EXCEEDS_REFUNDABLE / PLATFORM_FUNDS_INSUFFICIENT / MEMBERSHIP_PENDING_NOT_RELEASED ...)
   * means nothing moved: the executor records the case as EXEC_BLOCKED (retriable). It never invents a ledger movement of its own.
   */
  async refundMembershipSupplement(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    amount: string;
    label: string;
    idempotencyKey: string;
    entityOrigin?: EntityOrigin;
  }) {
    try {
      return await paymentRequest<MembershipSupplementAnswer>({ method: 'POST', path: '/internal/contracts/membership-appeal-supplement', timeout: 20_000, body });
    } catch (e: any) {
      const status: number | undefined = e?.response?.status ?? e?.status;
      throw Object.assign(new Error(e?.response?.data?.error?.code || e?.message || 'SUPPLEMENT_REFUND_FAILED'), status ? { status } : {});
    }
  },

  /** Client self-cancelled — forfeit everything to the parties immediately, no client credit. */
  async forfeitMembershipOnCancel(body: {
    transactionId: string;
    gymId: string;
    clientId: string;
    ptUserId?: string | null;
    label: string;
    idempotencyKey: string;
    entityOrigin?: EntityOrigin;
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
    entityOrigin?: EntityOrigin;
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
          ...(params.entityOrigin ? { entityOrigin: params.entityOrigin } : {}),
        },
      });
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'REFUND_FAILED';
      throw Object.assign(new Error(code), { status: e?.response?.status || 502 });
    }
  },

  /** E3: stored ledger operations by key (read-only). THROWS on any failure: "could not read" must never be taken as "no operation". */
  async lookupLedgerOperations(keys: string[]): Promise<{ operations: Array<{ key: string }>; missing: string[] }> {
    return paymentRequest<{ operations: Array<{ key: string }>; missing: string[] }>({ method: 'POST', path: '/internal/ledger-operations/lookup', body: { keys }, timeout: 10_000 });
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
  // Owner decision 22/11/2026: `payout.payoutInfo` is the partner's REGISTERED payout account as read by gym-service (never the client's text) and
  // `payout.requestedByUserId` is the authenticated user; payment-service's route refuses a call without `payoutSource: 'REGISTERED_ACCOUNT'`.
  async requestGymWithdrawal(
    gymId: string,
    amount: string,
    payout: { payoutInfo: string; requestedByUserId: string },
    entityOrigin?: EntityOrigin,
  ): Promise<any> {
    return paymentRequest<any>({
      method: 'POST',
      path: `/internal/withdrawals/gym/${gymId}`,
      timeout: 10_000,
      body: {
        amount,
        payoutInfo: payout.payoutInfo,
        payoutSource: 'REGISTERED_ACCOUNT',
        requestedByUserId: payout.requestedByUserId,
        ...(entityOrigin ? { entityOrigin } : {}),
      },
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

