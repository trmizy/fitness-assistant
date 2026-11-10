/**
 * Admin finance read API (BE-1: G-04 list, G-05 detail, G-14 whitelist) - READ ONLY.
 *
 * Every row that leaves this file goes through an explicit-whitelist mapper below; a Prisma row is never spread.
 * Never returned: PaymentTransaction.extraData / metadata / idempotencyKey / requestFingerprint / payerWalletId /
 * receiverWalletId / initiatedBy, LedgerOperation.result / requestFingerprint, PaymentWebhookEvent.payload,
 * obligation/holdback keys, approval refs, notes and operator ids.
 *
 * Money is returned as the decimal STRING exactly as stored (Decimal.toFixed(column scale), never rounded).
 */
import { z } from 'zod';
import { Prisma, PaymentStatus, PaymentProviderType, PurposeType } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

// ---------------------------------------------------------------------------------------------------------------------
// Query validation (G-04)
// ---------------------------------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const isoDate = z
  .string()
  .refine((s) => ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s)), 'ngày không hợp lệ')
  .transform((s) => new Date(s));

const intInRange = (min: number, max: number, fallback: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform((s) => Number(s))
    .refine((n) => Number.isSafeInteger(n) && n >= min && n <= max)
    .optional()
    .transform((n) => n ?? fallback);

export const adminTransactionsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    status: z.nativeEnum(PaymentStatus).optional(),
    provider: z.nativeEnum(PaymentProviderType).optional(),
    purpose: z.nativeEnum(PurposeType).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: intInRange(1, 100, 25),
    offset: intInRange(0, 100000, 0),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from < v.to, { message: 'from phải trước to', path: ['from'] });

export type AdminTransactionsQuery = z.output<typeof adminTransactionsQuerySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// DTOs + whitelist mappers (G-14)
// ---------------------------------------------------------------------------------------------------------------------

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
// Columns are Decimal(12|14,2) / Decimal(5,4): toFixed(scale) prints exactly the stored digits ("299999.80", not toString()'s
// "299999.8") and cannot round, because the stored value never has more fractional digits than the column scale.
const money = (d: Prisma.Decimal): string => d.toFixed(2);
const moneyOrNull = (d: Prisma.Decimal | null): string | null => (d === null ? null : d.toFixed(2));

export interface TxnSummary {
  id: string;
  purpose: string;
  status: string;
  provider: string;
  amount: string;
  currency: string;
  payerId: string;
  gymId: string | null;
  ptId: string | null;
  ptContractId: string | null;
  membershipId: string | null;
  providerTransactionId: string | null;
  paymentMethod: string | null;
  activationStatus: string;
  refundOfTransactionId: string | null;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
}

type TxnRow = Prisma.PaymentTransactionGetPayload<object>;

export function toTxnSummary(r: TxnRow): TxnSummary {
  return {
    id: r.id,
    purpose: r.purpose,
    status: r.status,
    provider: r.provider,
    amount: money(r.amount),
    currency: r.currency,
    payerId: r.payerId,
    gymId: r.gymId,
    ptId: r.ptId,
    ptContractId: r.ptContractId,
    membershipId: r.membershipId,
    providerTransactionId: r.providerTransactionId,
    paymentMethod: r.paymentMethod,
    activationStatus: r.activationStatus,
    refundOfTransactionId: r.refundOfTransactionId,
    createdAt: r.createdAt.toISOString(),
    paidAt: iso(r.paidAt),
    failedAt: iso(r.failedAt),
    refundedAt: iso(r.refundedAt),
  };
}

type LedgerEntryRow = Prisma.WalletLedgerEntryGetPayload<{ include: { wallet: { select: { ownerType: true; ownerId: true } } } }>;

export function toLedgerEntryDto(r: LedgerEntryRow) {
  return {
    id: r.id,
    walletId: r.walletId,
    walletOwnerType: r.wallet.ownerType as string,
    walletOwnerId: r.wallet.ownerId,
    entryType: r.entryType as string,
    bucket: r.bucket as string,
    amount: money(r.amount),
    balanceBefore: money(r.balanceBefore),
    balanceAfter: money(r.balanceAfter),
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toLedgerOperationDto(r: Prisma.LedgerOperationGetPayload<object>) {
  return { id: r.id, key: r.key, kind: r.kind, createdAt: r.createdAt.toISOString() };
}

export function toCommissionDto(r: Prisma.PlatformCommissionGetPayload<object>) {
  return {
    id: r.id,
    partnerType: r.partnerType as string,
    partnerId: r.partnerId,
    grossAmount: money(r.grossAmount),
    platformFeeAmount: money(r.platformFeeAmount),
    partnerPayoutAmount: money(r.partnerPayoutAmount),
    commissionRate: r.commissionRate.toFixed(4),
    status: r.status as string,
    settledAt: iso(r.settledAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toObligationDto(r: Prisma.ContractUnpaidObligationGetPayload<object>) {
  return {
    id: r.id,
    status: r.status as string,
    kind: r.kind as string,
    party: r.party,
    contractRef: r.contractRef,
    owed: money(r.owed),
    paid: money(r.paid),
    unpaid: money(r.unpaid),
    verifiedPaid: money(r.verifiedPaid),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: iso(r.resolvedAt),
  };
}

export function toHoldbackReviewDto(r: Prisma.PtHoldbackReviewGetPayload<object>) {
  return {
    id: r.id,
    status: r.status as string,
    kind: r.kind as string,
    reserve: money(r.reserve),
    verifiedAmount: moneyOrNull(r.verifiedAmount),
    releasedToPt: moneyOrNull(r.releasedToPt),
    reviewBy: r.reviewBy.toISOString(),
    createdAt: r.createdAt.toISOString(),
    decidedAt: iso(r.decidedAt),
  };
}

export function toWebhookEventDto(r: Prisma.PaymentWebhookEventGetPayload<object>) {
  return {
    id: r.id,
    provider: r.provider as string,
    providerEventId: r.providerEventId,
    processedAt: iso(r.processedAt),
    retryCount: r.retryCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface AdminTransactionDetail {
  transaction: TxnSummary;
  refundOf: TxnSummary | null;
  refunds: TxnSummary[];
  ledgerEntries: ReturnType<typeof toLedgerEntryDto>[];
  ledgerOperations: ReturnType<typeof toLedgerOperationDto>[];
  commissions: ReturnType<typeof toCommissionDto>[];
  obligations: ReturnType<typeof toObligationDto>[];
  holdbackReviews: ReturnType<typeof toHoldbackReviewDto>[];
  webhookEvents: ReturnType<typeof toWebhookEventDto>[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------

/** Exact-match only (no LIKE scan): `q` must equal one of these columns. */
function buildWhere(q: AdminTransactionsQuery): Prisma.PaymentTransactionWhereInput {
  const and: Prisma.PaymentTransactionWhereInput[] = [];
  if (q.q !== undefined) {
    and.push({
      OR: [
        { id: q.q },
        { providerTransactionId: q.q },
        { payerId: q.q },
        { ptContractId: q.q },
        { membershipId: q.q },
        { gymId: q.q },
        { ptId: q.q },
      ],
    });
  }
  if (q.status) and.push({ status: q.status });
  if (q.provider) and.push({ provider: q.provider });
  if (q.purpose) and.push({ purpose: q.purpose });
  if (q.from || q.to) {
    and.push({ createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } });
  }
  return and.length ? { AND: and } : {};
}

async function list(q: AdminTransactionsQuery) {
  const where = buildWhere(q);
  const [total, rows] = await prisma.$transaction([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: q.offset,
      take: q.limit,
    }),
  ]);
  return {
    total,
    limit: q.limit,
    offset: q.offset,
    hasMore: q.offset + rows.length < total,
    items: rows.map(toTxnSummary),
  };
}

/** `null` when the transaction does not exist. */
async function detail(id: string): Promise<AdminTransactionDetail | null> {
  const txn = await prisma.paymentTransaction.findUnique({ where: { id } });
  if (!txn) return null;

  const [refundOf, refunds, entries, operations, commissions, obligations, holdbackReviews, webhookEvents] = await Promise.all([
    txn.refundOfTransactionId
      ? prisma.paymentTransaction.findUnique({ where: { id: txn.refundOfTransactionId } })
      : Promise.resolve(null),
    prisma.paymentTransaction.findMany({ where: { refundOfTransactionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.walletLedgerEntry.findMany({
      where: { transactionId: id },
      include: { wallet: { select: { ownerType: true, ownerId: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.ledgerOperation.findMany({ where: { transactionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.platformCommission.findMany({ where: { paymentTransactionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.contractUnpaidObligation.findMany({ where: { transactionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.ptHoldbackReview.findMany({ where: { transactionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    txn.providerTransactionId
      ? prisma.paymentWebhookEvent.findMany({
          where: { provider: txn.provider, providerTransactionId: txn.providerTransactionId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  return {
    transaction: toTxnSummary(txn),
    refundOf: refundOf ? toTxnSummary(refundOf) : null,
    refunds: refunds.map(toTxnSummary),
    ledgerEntries: entries.map(toLedgerEntryDto),
    ledgerOperations: operations.map(toLedgerOperationDto),
    commissions: commissions.map(toCommissionDto),
    obligations: obligations.map(toObligationDto),
    holdbackReviews: holdbackReviews.map(toHoldbackReviewDto),
    webhookEvents: webhookEvents.map(toWebhookEventDto),
  };
}

/** Object (not bare functions) so route tests can replace a method without touching the database. */
export const adminTransactionsService = { list, detail };
