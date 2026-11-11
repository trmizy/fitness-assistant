/**
 * G-08 - admin withdrawal HISTORY (READ ONLY): the PAID and REJECTED WithdrawalRequest rows that
 * GET /admin/payments/withdrawals (open requests only) never returns.
 *
 * Every row goes through the explicit whitelist mapper below; a Prisma row is never spread.
 * NEVER returned: payoutInfo (the requester's bank / e-wallet details). bankReference is the admin-entered transfer
 * reference and is returned for PAID rows only; rejectionReason for REJECTED rows only.
 *
 * Money is a decimal STRING exactly as stored (Decimal.toFixed(2), never rounded).
 */
import { z } from 'zod';
import { Prisma, WalletOwnerType } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

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

export const adminWithdrawalHistoryQuerySchema = z
  .object({
    status: z.enum(['PAID', 'REJECTED']),
    ownerType: z.nativeEnum(WalletOwnerType).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: intInRange(1, 100, 25),
    offset: intInRange(0, 100000, 0),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from < v.to, { message: 'from phải trước to', path: ['from'] });

export type AdminWithdrawalHistoryQuery = z.output<typeof adminWithdrawalHistoryQuerySchema>;

export interface WithdrawalHistoryItem {
  id: string;
  walletId: string;
  ownerType: string;
  ownerId: string;
  amount: string;
  status: string;
  bankReference: string | null;
  rejectionReason: string | null;
  approvedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  walletAvailableNow: string;
}

type Row = Prisma.WithdrawalRequestGetPayload<{ include: { wallet: { select: { availableBalance: true } } } }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toWithdrawalHistoryItem(r: Row): WithdrawalHistoryItem {
  return {
    id: r.id,
    walletId: r.walletId,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    amount: r.amount.toFixed(2),
    status: r.status,
    bankReference: r.status === 'PAID' ? r.bankReference : null,
    rejectionReason: r.status === 'REJECTED' ? r.rejectionReason : null,
    approvedBy: r.reviewedBy,
    reviewedAt: iso(r.reviewedAt),
    paidAt: iso(r.paidAt),
    createdAt: r.createdAt.toISOString(),
    walletAvailableNow: r.wallet.availableBalance.toFixed(2),
  };
}

function buildWhere(q: AdminWithdrawalHistoryQuery): Prisma.WithdrawalRequestWhereInput {
  const dateField = q.status === 'PAID' ? 'paidAt' : 'reviewedAt';
  const where: Prisma.WithdrawalRequestWhereInput = { status: q.status };
  if (q.ownerType) where.ownerType = q.ownerType;
  // Exact match only (no LIKE scan): the withdrawal id or the wallet owner id.
  if (q.q) where.OR = [{ id: q.q }, { ownerId: q.q }];
  if (q.from || q.to) {
    where[dateField] = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) };
  }
  return where;
}

async function list(q: AdminWithdrawalHistoryQuery) {
  const where = buildWhere(q);
  const dateField = q.status === 'PAID' ? 'paidAt' : 'reviewedAt';
  const [total, rows] = await prisma.$transaction([
    prisma.withdrawalRequest.count({ where }),
    prisma.withdrawalRequest.findMany({
      where,
      include: { wallet: { select: { availableBalance: true } } },
      orderBy: [{ [dateField]: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip: q.offset,
      take: q.limit,
    }),
  ]);
  return {
    total,
    limit: q.limit,
    offset: q.offset,
    hasMore: q.offset + rows.length < total,
    items: rows.map(toWithdrawalHistoryItem),
  };
}

/** Object (not a bare function) so route tests can replace the method without touching the database. */
export const adminWithdrawalHistoryService = { list };
