import { Prisma, PaymentProviderType } from '../generated/prisma';
import { prisma } from './prisma';

export const webhookRepository = {
  async upsert(data: {
    provider: PaymentProviderType;
    providerEventId: string;
    providerTransactionId?: string;
    payload: Prisma.InputJsonValue;
  }) {
    return prisma.paymentWebhookEvent.upsert({
      where: { provider_providerEventId: { provider: data.provider, providerEventId: data.providerEventId } },
      create: {
        provider: data.provider,
        providerEventId: data.providerEventId,
        providerTransactionId: data.providerTransactionId,
        payload: data.payload,
      },
      update: {},
    });
  },

  async markProcessed(id: string) {
    return prisma.paymentWebhookEvent.update({
      where: { id },
      data: { processedAt: new Date() },
    });
  },

  async incrementRetry(id: string) {
    return prisma.paymentWebhookEvent.update({
      where: { id },
      data: { retryCount: { increment: 1 }, lastRetryAt: new Date() },
    });
  },

  async findUnprocessedPaid() {
    return prisma.$queryRaw<Array<{
      id: string;
      payment_txn_id: string;
      provider_transaction_id: string | null;
      extra_data: string | null;
      retry_count: number;
    }>>`
      SELECT whe.id, pt.id AS payment_txn_id, whe.provider_transaction_id, pt.extra_data, whe.retry_count
      FROM payment_webhook_events whe
      JOIN payment_transactions pt ON pt.provider_transaction_id = whe.provider_transaction_id
      WHERE whe.processed_at IS NULL
        AND pt.status = 'PAID'
        AND whe.retry_count < 10
      ORDER BY whe.created_at ASC
    `;
  },
};
