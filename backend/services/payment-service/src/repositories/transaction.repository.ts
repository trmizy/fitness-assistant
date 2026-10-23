import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

/**
 * Two transactions of one provider carry the same providerTransactionId. The gateway's reference is the only key a
 * callback brings back, so which of them it pays for cannot be told - nothing may be settled on a guess.
 */
export class AmbiguousProviderReferenceError extends Error {
  constructor(public readonly provider: unknown, public readonly providerTransactionId: string) {
    super(`more than one transaction has provider reference ${providerTransactionId} - refusing to guess which one a callback is for`);
    this.name = 'AmbiguousProviderReferenceError';
  }
}

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
    // The column has no unique index (a migration on live payment data is not worth it for a key every provider here
    // builds from a uuid or a random suffix), so uniqueness is enforced on read: two rows is an error, never "the first".
    const rows = await prisma.paymentTransaction.findMany({ where: { providerTransactionId, provider }, take: 2 });
    if (rows.length > 1) throw new AmbiguousProviderReferenceError(provider, providerTransactionId);
    return rows[0] ?? null;
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

  /**
   * Every still-open purchase (not a wallet top-up — that flow is gone), regardless of age.
   * A checkout is created with status PENDING and never moves to PROCESSING anywhere in this
   * codebase (only the old wallet-topup path used PROCESSING) — filtering on PROCESSING alone
   * would never match a real purchase. Fed to webhook.service.pollAndSettle every
   * reconciliation cycle so a gateway with no reachable IPN (ZaloPay, MoMo, PayOS on this
   * deployment) still gets confirmed before findStaleProcessing's timeout sweeps it to FAILED.
   */
  async findProcessingNonTopup() {
    return prisma.paymentTransaction.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] }, purpose: { not: 'WALLET_TOPUP' } },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Transactions stuck open past their timeout window (split by purpose — see
   * reconciliation.service.ts). PENDING is included alongside PROCESSING: a direct-to-gateway
   * checkout is created as PENDING and never moves to PROCESSING, so filtering on PROCESSING
   * alone left every abandoned non-topup purchase PENDING forever instead of eventually
   * timing out to FAILED.
   */
  async findStaleProcessing(purposeFilter: 'topup' | 'non-topup', staleMinutes: number) {
    const clause = purposeFilter === 'topup' ? Prisma.sql`"purpose" = 'WALLET_TOPUP'` : Prisma.sql`"purpose" != 'WALLET_TOPUP'`;
    return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payment_transactions
      WHERE status IN ('PENDING', 'PROCESSING')
        AND ${clause}
        AND updated_at < NOW() - (${staleMinutes} || ' minutes')::INTERVAL
    `);
  },

  /** FAILED only from a still-open state — never downgrades PAID/REFUNDED/CANCELLED. True if it moved. */
  async markFailedIfOpen(id: string) {
    const { count } = await prisma.paymentTransaction.updateMany({
      where: { id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    return count > 0;
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

  /**
   * Transactions a payment gateway reported a different amount for than their price
   * (metadata.gatewayDiscrepancy, written by gateway-amount.ts#recordGatewayDiscrepancy). These were NOT
   * settled — they wait here for a human to refund or reconcile the cash at the gateway.
   */
  async findWithGatewayDiscrepancy(limit: number) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payment_transactions
      WHERE metadata->'gatewayDiscrepancy' IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    if (rows.length === 0) return [];
    return prisma.paymentTransaction.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: { updatedAt: 'desc' },
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
