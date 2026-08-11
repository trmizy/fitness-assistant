import { logger } from '@gym-coach/shared';
import { Prisma, WalletOwnerType, PartnerType } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

export class InsufficientBalanceError extends Error {
  constructor(walletId: string) {
    super(`Insufficient balance in wallet ${walletId}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class WalletNotActiveError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} is not ACTIVE`);
    this.name = 'WalletNotActiveError';
  }
}

/**
 * The two system wallets. Both are ownerType PLATFORM; only ownerId tells them apart.
 *
 * ESCROW is custodial: every đồng that entered through a gateway and has not been paid out
 * lives here, which is what makes the reconciliation invariant (see reconcile.service)
 * checkable. REVENUE is the platform's own earned commission.
 */
export const PLATFORM_ESCROW_ID = 'ESCROW';
export const PLATFORM_REVENUE_ID = 'REVENUE';

export type Bucket = 'PENDING' | 'AVAILABLE';

type TxClient = Prisma.TransactionClient;

interface WalletRow {
  id: string;
  owner_type: string;
  owner_id: string;
  available_balance: string;
  pending_balance: string;
  locked_balance: string;
  status: string;
}

/** Locks wallets in ascending-id order (deadlock prevention across concurrent transfers). */
async function lockWallets(tx: TxClient, walletIds: string[]): Promise<Map<string, WalletRow>> {
  const sorted = [...new Set(walletIds)].sort();
  const locked = new Map<string, WalletRow>();
  for (const id of sorted) {
    const rows = await tx.$queryRaw<WalletRow[]>`SELECT * FROM wallets WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new Error(`Wallet ${id} not found`);
    locked.set(id, rows[0]);
  }
  return locked;
}

/**
 * The locked row carries the balances read under FOR UPDATE, but a single DB transaction
 * often touches one wallet's bucket several times (release, then top up, then settle). Reading
 * the row again would miss the earlier writes, so the running value is tracked on the row
 * itself and every entry chains off it.
 */
function readBucket(wallet: WalletRow, bucket: Bucket): Prisma.Decimal {
  return new Prisma.Decimal(bucket === 'PENDING' ? wallet.pending_balance : wallet.available_balance);
}

function writeBucket(wallet: WalletRow, bucket: Bucket, value: Prisma.Decimal): void {
  if (bucket === 'PENDING') wallet.pending_balance = value.toString();
  else wallet.available_balance = value.toString();
}

async function applyDebit(
  tx: TxClient,
  wallet: WalletRow,
  amount: Prisma.Decimal,
  transactionId: string,
  description: string,
  bucket: Bucket = 'AVAILABLE',
): Promise<void> {
  const before = readBucket(wallet, bucket);
  if (before.lessThan(amount)) throw new InsufficientBalanceError(wallet.id);
  const after = before.minus(amount);
  await tx.wallet.update({
    where: { id: wallet.id },
    data: bucket === 'PENDING' ? { pendingBalance: after } : { availableBalance: after },
  });
  writeBucket(wallet, bucket, after);
  await tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      transactionId,
      entryType: 'DEBIT',
      bucket,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      description,
    },
  });
}

async function applyCredit(
  tx: TxClient,
  wallet: WalletRow,
  amount: Prisma.Decimal,
  transactionId: string,
  description: string,
  bucket: Bucket = 'AVAILABLE',
): Promise<void> {
  const before = readBucket(wallet, bucket);
  const after = before.plus(amount);
  await tx.wallet.update({
    where: { id: wallet.id },
    data: bucket === 'PENDING' ? { pendingBalance: after } : { availableBalance: after },
  });
  writeBucket(wallet, bucket, after);
  await tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      transactionId,
      entryType: 'CREDIT',
      bucket,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      description,
    },
  });
}

/**
 * Debit/credit against a set of wallets already locked FOR UPDATE inside one DB transaction.
 *
 * Contract money movements touch up to five wallets and several buckets at once. Handing the
 * caller these bound operations — rather than letting it lock and write on its own — is what
 * keeps every flow on the same lock ordering and the same ledger-writing code.
 */
export interface LedgerOps {
  debit(walletId: string, amount: Prisma.Decimal, description: string, bucket?: Bucket): Promise<void>;
  credit(walletId: string, amount: Prisma.Decimal, description: string, bucket?: Bucket): Promise<void>;
  /** Current value of a bucket, reflecting writes already made in this transaction. */
  balance(walletId: string, bucket: Bucket): Prisma.Decimal;
  tx: TxClient;
}

export const walletService = {
  async getOrCreateWallet(ownerType: WalletOwnerType, ownerId: string) {
    return prisma.wallet.upsert({
      where: { ownerType_ownerId: { ownerType, ownerId } },
      create: { ownerType, ownerId },
      update: {},
    });
  },

  /** Custodial wallet: holds every đồng taken in and not yet paid out. */
  async getEscrowWallet() {
    return this.getOrCreateWallet('PLATFORM', PLATFORM_ESCROW_ID);
  },

  /** The platform's own earned commission. */
  async getRevenueWallet() {
    return this.getOrCreateWallet('PLATFORM', PLATFORM_REVENUE_ID);
  },

  /**
   * Legacy alias kept for the pre-existing wallet-to-wallet transfer/refund paths, which
   * credit and claw back commission — that is revenue, never custodial money.
   */
  async getOrCreatePlatformWallet() {
    return this.getRevenueWallet();
  },

  /**
   * Runs `fn` inside one DB transaction with every listed wallet locked in ascending-id
   * order. Anything the callback throws rolls the whole movement back, so a money split can
   * never land half-applied.
   */
  async withWallets<T>(
    walletIds: string[],
    transactionId: string,
    fn: (ops: LedgerOps) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const locked = await lockWallets(tx, walletIds);
      for (const [id, w] of locked) {
        if (w.status !== 'ACTIVE') throw new WalletNotActiveError(id);
      }
      const need = (walletId: string): WalletRow => {
        const w = locked.get(walletId);
        if (!w) throw new Error(`Wallet ${walletId} was not locked for this operation`);
        return w;
      };
      return fn({
        tx,
        balance: (walletId, bucket) => readBucket(need(walletId), bucket),
        debit: (walletId, amount, description, bucket = 'AVAILABLE') =>
          applyDebit(tx, need(walletId), amount, transactionId, description, bucket),
        credit: (walletId, amount, description, bucket = 'AVAILABLE') =>
          applyCredit(tx, need(walletId), amount, transactionId, description, bucket),
      });
    });
  },

  /**
   * Single-wallet credit that also flips the transaction to PAID — used by the
   * top-up webhook flow (only one wallet, no deadlock risk). Crediting the wallet
   * and marking the transaction PAID happen in the same DB transaction: if these
   * were two separate calls, a crash between them would leave the wallet credited
   * but the transaction still not PAID, and a webhook retry would credit again.
   */
  async creditWalletAndMarkPaid(walletId: string, amount: Prisma.Decimal, transactionId: string, description: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const locked = await lockWallets(tx, [walletId]);
      const wallet = locked.get(walletId)!;
      if (wallet.status !== 'ACTIVE') throw new WalletNotActiveError(walletId);

      // Compare-and-swap on the transaction status BEFORE crediting: only the caller that
      // actually flips PENDING/PROCESSING → PAID is allowed to credit. Two concurrent
      // deliveries for the same top-up (e.g. VNPay return + IPN arriving together) both
      // pass handleEvent's status pre-check, but here they serialize on the wallet's
      // FOR UPDATE lock and the second sees status already PAID → flipped.count === 0 →
      // skips the credit. This is the single source of truth against double-credit.
      const flipped = await tx.paymentTransaction.updateMany({
        where: { id: transactionId, status: { not: 'PAID' } },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (flipped.count === 0) {
        logger.info(`[WalletService] Transaction ${transactionId} already PAID — skipping duplicate credit`);
        return;
      }

      await applyCredit(tx, wallet, amount, transactionId, description);
    });
  },

  /**
   * Wallet-to-wallet transfer with platform commission split. Validates inputs,
   * locks payer/receiver/platform wallets in a single ascending-id-sorted pass
   * (prevents deadlocks between concurrent transfers touching overlapping wallets),
   * then debits payer, credits receiver (net of commission), credits platform
   * (commission), records PlatformCommission, and flips the transaction to PAID —
   * all inside one DB transaction.
   */
  async transferInternal(params: {
    payerWalletId: string;
    receiverWalletId: string;
    amount: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
    transactionId: string;
    partnerType: PartnerType;
    partnerId: string;
  }): Promise<void> {
    const { payerWalletId, receiverWalletId, amount, commissionRate, transactionId, partnerType, partnerId } = params;

    if (amount.lessThanOrEqualTo(0)) throw new Error('amount must be > 0');
    if (commissionRate.lessThan(0) || commissionRate.greaterThan(1)) {
      throw new Error('commissionRate must be between 0 and 1');
    }
    if (payerWalletId === receiverWalletId) throw new Error('payerWalletId and receiverWalletId must differ');

    const platformWallet = await this.getOrCreatePlatformWallet();
    const commissionAmount = amount.mul(commissionRate);
    const netToReceiver = amount.minus(commissionAmount);

    await prisma.$transaction(async (tx) => {
      const locked = await lockWallets(tx, [payerWalletId, receiverWalletId, platformWallet.id]);
      const payer = locked.get(payerWalletId)!;
      const receiver = locked.get(receiverWalletId)!;
      const platform = locked.get(platformWallet.id)!;

      if (payer.status !== 'ACTIVE') throw new WalletNotActiveError(payerWalletId);
      if (receiver.status !== 'ACTIVE') throw new WalletNotActiveError(receiverWalletId);

      await applyDebit(tx, payer, amount, transactionId, 'Payment');
      await applyCredit(tx, receiver, netToReceiver, transactionId, 'Payment received');
      await applyCredit(tx, platform, commissionAmount, transactionId, 'Platform commission');

      await tx.platformCommission.create({
        data: {
          paymentTransactionId: transactionId,
          partnerType,
          partnerId,
          grossAmount: amount,
          platformFeeAmount: commissionAmount,
          partnerPayoutAmount: netToReceiver,
          commissionRate,
          status: 'PENDING',
        },
      });

      await tx.paymentTransaction.update({
        where: { id: transactionId },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });

    logger.info(`[WalletService] Transfer ${transactionId} completed: ${payerWalletId} -> ${receiverWalletId} (commission ${commissionAmount.toString()})`);
  },

  /**
   * Reverses a completed transfer's ledger entries: credits back the payer,
   * debits the receiver and platform wallets. Caller must have already verified
   * both wallets can absorb the reversal (checkRefundAffordable) before calling this.
   */
  async reverseTransfer(params: {
    payerWalletId: string;
    receiverWalletId: string;
    amount: Prisma.Decimal;
    commissionAmount: Prisma.Decimal;
    refundTransactionId: string;
    originalTransactionId: string;
    platformCommissionId: string;
  }): Promise<void> {
    const { payerWalletId, receiverWalletId, amount, commissionAmount, refundTransactionId, originalTransactionId, platformCommissionId } = params;
    const platformWallet = await this.getOrCreatePlatformWallet();
    const netToReceiver = amount.minus(commissionAmount);

    await prisma.$transaction(async (tx) => {
      const locked = await lockWallets(tx, [payerWalletId, receiverWalletId, platformWallet.id]);
      const payer = locked.get(payerWalletId)!;
      const receiver = locked.get(receiverWalletId)!;
      const platform = locked.get(platformWallet.id)!;

      // Reversal direction: credit back payer, debit receiver + platform.
      await applyCredit(tx, payer, amount, refundTransactionId, `Refund of ${originalTransactionId}`);
      await applyDebit(tx, receiver, netToReceiver, refundTransactionId, `Refund reversal of ${originalTransactionId}`);
      await applyDebit(tx, platform, commissionAmount, refundTransactionId, `Refund commission reversal of ${originalTransactionId}`);

      await tx.platformCommission.update({
        where: { id: platformCommissionId },
        data: { status: 'CANCELLED' },
      });

      await tx.paymentTransaction.update({
        where: { id: refundTransactionId },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await tx.paymentTransaction.update({
        where: { id: originalTransactionId },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      });
    });

    logger.info(`[WalletService] Refund ${refundTransactionId} reversed transfer ${originalTransactionId}`);
  },

  /**
   * Checks (without locking/mutating) whether the receiver and platform wallets
   * have enough availableBalance to absorb a refund reversal.
   */
  async checkRefundAffordable(receiverWalletId: string, netToReceiver: Prisma.Decimal, commissionAmount: Prisma.Decimal): Promise<boolean> {
    const platformWallet = await this.getOrCreatePlatformWallet();
    const [receiver, platform] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: receiverWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWallet.id } }),
    ]);
    return receiver.availableBalance.greaterThanOrEqualTo(netToReceiver) && platform.availableBalance.greaterThanOrEqualTo(commissionAmount);
  },
};
