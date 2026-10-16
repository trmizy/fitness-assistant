import { Prisma, PaymentProviderType } from '../generated/prisma';
import { prisma } from './prisma';

export const webhookRepository = {
  async upsert(data: {
    provider: PaymentProviderType;
    providerEventId: string;
    providerTransactionId?: string;
    payload: Prisma.InputJsonValue;
  }) {
    const where = { provider_providerEventId: { provider: data.provider, providerEventId: data.providerEventId } };
    try {
      return await prisma.paymentWebhookEvent.upsert({
        where,
        create: {
          provider: data.provider,
          providerEventId: data.providerEventId,
          providerTransactionId: data.providerTransactionId,
          payload: data.payload,
        },
        update: {},
      });
    } catch (err) {
      // Two deliveries of the SAME event racing (an IPN and its retry arriving together) both see "no row"
      // and both try to INSERT; the loser hits the unique index. That is not a failure — the row exists, which
      // is all the caller wanted. Without this the loser answered VNPay 99 and VNPay retried a payment that was
      // already being settled.
      if ((err as { code?: string }).code === 'P2002') {
        return prisma.paymentWebhookEvent.findUniqueOrThrow({ where });
      }
      throw err;
    }
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
