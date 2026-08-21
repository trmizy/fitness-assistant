import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

export const transactionRepository = {
  async create(data: Prisma.PaymentTransactionCreateInput) {
    return prisma.paymentTransaction.create({ data });
  },

  async findById(id: string) {
    return prisma.paymentTransaction.findUnique({ where: { id } });
  },

  async findByIdempotencyKey(key: string) {
    return prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
  },

  /**
   * Scoped by BOTH provider and providerTransactionId — a webhook claiming to be
   * from provider X must only ever be able to match a transaction that was
   * actually created under provider X. Without the provider filter, a webhook
   * event from one provider (e.g. a forged MoMo event) could match — and
   * fraudulently complete — a real transaction created under a different
   * provider (e.g. VNPAY) if the attacker knows/guesses its providerTransactionId.
   */
  async findByProviderTransactionId(providerTransactionId: string, provider: Prisma.PaymentTransactionWhereInput['provider']) {
    return prisma.paymentTransaction.findFirst({ where: { providerTransactionId, provider } });
  },

  async updateById(id: string, data: Prisma.PaymentTransactionUpdateInput) {
    return prisma.paymentTransaction.update({ where: { id }, data });
  },

  async findByPayerId(payerId: string) {
    return prisma.paymentTransaction.findMany({
      where: { payerId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findUnprocessedPaid() {
    return prisma.$queryRaw<Array<{ id: string; provider_transaction_id: string | null; extra_data: string | null }>>`
      SELECT whe.id, whe.provider_transaction_id, pt.extra_data
      FROM payment_webhook_events whe
      JOIN payment_transactions pt ON pt.provider_transaction_id = whe.provider_transaction_id
      WHERE whe.processed_at IS NULL
        AND pt.status = 'PAID'
        AND whe.retry_count < 10
      ORDER BY whe.created_at ASC
    `;
  },

  /** GYM_MEMBERSHIP / PT_CONTRACT wallet-transfers that are PAID but not yet activated downstream. */
  async findPendingActivation(maxRetries = 10) {
    return prisma.paymentTransaction.findMany({
      where: {
        status: 'PAID',
        activationStatus: 'PENDING',
        activationRetryCount: { lt: maxRetries },
        purpose: { not: 'REFUND' },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  /** REFUND transactions that are PAID but the downstream entity hasn't been cancelled yet. */
  async findPendingRefundCancellation(maxRetries = 10) {
    return prisma.paymentTransaction.findMany({
      where: {
        purpose: 'REFUND',
        status: 'PAID',
        activationStatus: 'PENDING',
        activationRetryCount: { lt: maxRetries },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async markActivated(id: string) {
    return prisma.paymentTransaction.update({ where: { id }, data: { activationStatus: 'ACTIVATED' } });
  },

  async incrementActivationRetry(id: string) {
    return prisma.paymentTransaction.update({
      where: { id },
      data: { activationRetryCount: { increment: 1 }, lastActivationRetryAt: new Date() },
    });
  },

  /** Transactions stuck in PROCESSING past their timeout window (split by purpose — see reconciliation.service.ts). */
  async findStaleProcessing(purposeFilter: 'topup' | 'non-topup', staleMinutes: number) {
    const clause = purposeFilter === 'topup' ? Prisma.sql`"purpose" = 'WALLET_TOPUP'` : Prisma.sql`"purpose" != 'WALLET_TOPUP'`;
    return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payment_transactions
      WHERE status = 'PROCESSING'
        AND ${clause}
        AND updated_at < NOW() - (${staleMinutes} || ' minutes')::INTERVAL
    `);
  },

  async markFailed(id: string) {
    return prisma.paymentTransaction.update({ where: { id }, data: { status: 'FAILED', failedAt: new Date() } });
  },

  async findCommissionByTransactionId(paymentTransactionId: string) {
    return prisma.platformCommission.findFirst({ where: { paymentTransactionId } });
  },

  /** Admin transaction list — most recent first, capped so the endpoint can't
   * be used to dump the entire table in one request. */
  async findRecent(limit: number) {
    return prisma.paymentTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /** Admin commission list — most recent first, same cap rationale as findRecent. */
  async findRecentCommissions(limit: number) {
    return prisma.platformCommission.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
