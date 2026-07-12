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
};
