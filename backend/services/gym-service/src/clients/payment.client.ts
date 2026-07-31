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

export const paymentClient = {
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
};
