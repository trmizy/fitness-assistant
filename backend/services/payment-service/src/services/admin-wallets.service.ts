/**
 * Admin wallet explorer (G-09 wallet list + detail, G-10 entry `kind`) - READ ONLY.
 *
 * Every row that leaves this file goes through an explicit-whitelist mapper; a Prisma row is never spread.
 * `WalletLedgerEntry.description` is NEVER returned: it is a free-form internal English string ("... - refund (contract
 * could not be activated)") that can carry ids. The stable `kind` below replaces it.
 *
 * Money is the decimal STRING exactly as stored (Decimal.toFixed(2): every wallet / ledger column is Decimal(14,2)).
 * Platform wallets keep their fixed internal ownerId ("ESCROW" / "REVENUE") in the API; the web app labels them.
 */
import { z } from 'zod';
import { Prisma, WalletOwnerType } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { isUuid } from './admin-transactions.service';

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

export const adminWalletsQuerySchema = z
  .object({
    ownerType: z.nativeEnum(WalletOwnerType).optional(),
    /** Exact match (never a LIKE scan). Platform wallets: "ESCROW" / "REVENUE". */
    ownerId: z.string().trim().min(1).max(128).optional(),
    limit: intInRange(1, 100, 25),
    offset: intInRange(0, 100000, 0),
  })
  .strict();
export type AdminWalletsQuery = z.output<typeof adminWalletsQuerySchema>;

export const adminWalletDetailQuerySchema = z
  .object({
    entriesLimit: intInRange(1, 200, 50),
    entriesOffset: intInRange(0, 100000, 0),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from < v.to, { message: 'from phải trước to', path: ['from'] });
export type AdminWalletDetailQuery = z.output<typeof adminWalletDetailQuerySchema>;

export { isUuid };

// ---------------------------------------------------------------------------------------------------------------------
// G-10: entry kind
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Stable classification of a ledger entry, derived WITHOUT a schema change from the PaymentTransaction it is linked to
 * (`WalletLedgerEntry.transactionId` is a hard FK):
 *
 *   transaction.refundOfTransactionId != null   -> "REFUND"   (a refund row, whatever its purpose says)
 *   transaction.purpose = REFUND                -> "REFUND"
 *   transaction.purpose = GYM_MEMBERSHIP        -> "GYM_MEMBERSHIP"
 *   transaction.purpose = PT_CONTRACT           -> "PT_CONTRACT"
 *   transaction.purpose = GYM_PT_COMBO          -> "GYM_PT_COMBO"
 *   transaction.purpose = WALLET_TOPUP          -> "WALLET_TOPUP"
 *   transaction.purpose = TRAINING_PACKAGE_PURCHASE      -> "TRAINING_PACKAGE_PURCHASE"
 *   transaction.purpose = PERSONALIZED_SERVICE_PURCHASE  -> "PERSONALIZED_SERVICE_PURCHASE"
 *   transaction.purpose = WITHDRAWAL            -> "WITHDRAWAL"
 *   anything else (a purpose added later)       -> "OTHER"
 *
 * It says WHICH business flow produced the entry, not what happened inside the flow (release, holdback, clawback...):
 * the `entryType` + `bucket` pair already say how the money moved. It is presentation data only; nothing reads it.
 */
export type WalletEntryKind =
  | 'REFUND'
  | 'GYM_MEMBERSHIP'
  | 'PT_CONTRACT'
  | 'GYM_PT_COMBO'
  | 'WALLET_TOPUP'
  | 'TRAINING_PACKAGE_PURCHASE'
  | 'PERSONALIZED_SERVICE_PURCHASE'
  | 'WITHDRAWAL'
  | 'OTHER';

const PURPOSE_KIND: Record<string, WalletEntryKind> = {
  REFUND: 'REFUND',
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  GYM_PT_COMBO: 'GYM_PT_COMBO',
  WALLET_TOPUP: 'WALLET_TOPUP',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE',
  PERSONALIZED_SERVICE_PURCHASE: 'PERSONALIZED_SERVICE_PURCHASE',
  WITHDRAWAL: 'WITHDRAWAL',
};

export function walletEntryKind(txn: { purpose: string; refundOfTransactionId: string | null } | null | undefined): WalletEntryKind {
  if (!txn) return 'OTHER';
  if (txn.refundOfTransactionId) return 'REFUND';
  return Object.prototype.hasOwnProperty.call(PURPOSE_KIND, txn.purpose) ? PURPOSE_KIND[txn.purpose] : 'OTHER';
}

// ---------------------------------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------------------------------

const money = (d: Prisma.Decimal): string => d.toFixed(2);

export interface WalletDto {
  id: string;
  ownerType: string;
  ownerId: string;
  availableBalance: string;
  pendingBalance: string;
  lockedBalance: string;
  holdbackBalance: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function toWalletDto(r: Prisma.WalletGetPayload<object>): WalletDto {
  return {
    id: r.id,
    ownerType: r.ownerType as string,
    ownerId: r.ownerId,
    availableBalance: money(r.availableBalance),
    pendingBalance: money(r.pendingBalance),
    lockedBalance: money(r.lockedBalance),
    holdbackBalance: money(r.holdbackBalance),
    status: r.status as string,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type EntryRow = Prisma.WalletLedgerEntryGetPayload<{ include: { transaction: { select: { purpose: true; refundOfTransactionId: true } } } }>;

export function toWalletEntryDto(r: EntryRow) {
  return {
    id: r.id,
    transactionId: r.transactionId,
    entryType: r.entryType as string,
    bucket: r.bucket as string,
    amount: money(r.amount),
    balanceBefore: money(r.balanceBefore),
    balanceAfter: money(r.balanceAfter),
    kind: walletEntryKind(r.transaction),
    createdAt: r.createdAt.toISOString(),
  };
}

export interface AdminWalletDetail {
  wallet: WalletDto;
  entries: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    items: ReturnType<typeof toWalletEntryDto>[];
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------

async function list(q: AdminWalletsQuery) {
  const where: Prisma.WalletWhereInput = {
    ...(q.ownerType ? { ownerType: q.ownerType } : {}),
    ...(q.ownerId !== undefined ? { ownerId: q.ownerId } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.wallet.count({ where }),
    prisma.wallet.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: q.offset, take: q.limit }),
  ]);
  return {
    total,
    limit: q.limit,
    offset: q.offset,
    hasMore: q.offset + rows.length < total,
    items: rows.map(toWalletDto),
  };
}

/** `null` when the wallet does not exist. */
async function detail(id: string, q: AdminWalletDetailQuery): Promise<AdminWalletDetail | null> {
  const wallet = await prisma.wallet.findUnique({ where: { id } });
  if (!wallet) return null;
  const where: Prisma.WalletLedgerEntryWhereInput = {
    walletId: id,
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.walletLedgerEntry.count({ where }),
    prisma.walletLedgerEntry.findMany({
      where,
      include: { transaction: { select: { purpose: true, refundOfTransactionId: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: q.entriesOffset,
      take: q.entriesLimit,
    }),
  ]);
  return {
    wallet: toWalletDto(wallet),
    entries: {
      total,
      limit: q.entriesLimit,
      offset: q.entriesOffset,
      hasMore: q.entriesOffset + rows.length < total,
      items: rows.map(toWalletEntryDto),
    },
  };
}

/** Object (not bare functions) so route tests can replace a method without touching the database. */
export const adminWalletsService = { list, detail };
