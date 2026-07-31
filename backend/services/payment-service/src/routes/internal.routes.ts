import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService, InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { WalletOwnerType, PartnerType, Prisma } from '../generated/prisma';

const router = Router();
router.use(serviceSecretMiddleware);

const DEFAULT_COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE ?? '0.10');

const walletTransferSchema = z.object({
  payerOwnerType: z.nativeEnum(WalletOwnerType),
  payerOwnerId: z.string().min(1),
  receiverOwnerType: z.nativeEnum(WalletOwnerType),
  receiverOwnerId: z.string().min(1),
  amount: z.number().positive(),
  commissionRate: z.number().min(0).max(1).optional(),
  purpose: z.enum(['GYM_MEMBERSHIP', 'PT_CONTRACT', 'TRAINING_PACKAGE_PURCHASE']),
  relatedEntityType: z.enum(['GYM_MEMBERSHIP', 'PT_CONTRACT', 'TRAINING_PACKAGE_PURCHASE']),
  relatedEntityId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  initiatedBy: z.string().min(1),
  sourceService: z.string().min(1),
  gymId: z.string().optional(),
  ptId: z.string().optional(),
  membershipId: z.string().optional(),
  ptContractId: z.string().optional(),
});

function statusResponse(txn: { id: string; status: string; failedAt?: Date | null }) {
  return {
    status: txn.status === 'PAID' ? 'PAID' as const : 'FAILED' as const,
    transactionId: txn.id,
  };
}

// POST /internal/payments/wallet-transfer
router.post('/payments/wallet-transfer', async (req: Request, res: Response) => {
  const parsed = walletTransferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const data = parsed.data;

  const fingerprint = computeFingerprint({
    amount: data.amount,
    currency: 'VND',
    purpose: data.purpose,
    payerOwnerType: data.payerOwnerType,
    payerOwnerId: data.payerOwnerId,
    receiverOwnerType: data.receiverOwnerType,
    receiverOwnerId: data.receiverOwnerId,
    relatedEntityType: data.relatedEntityType,
    relatedEntityId: data.relatedEntityId,
  });

  // Everything up to and including transactionRepository.create() previously ran
  // outside any try/catch — a DB-level error there (e.g. an enum value the running
  // process's Prisma client didn't yet know about) became an unhandled rejection
  // that crashed the whole service instead of returning a 500. Wrapping the full
  // handler body closes that gap.
  let txn: Awaited<ReturnType<typeof transactionRepository.create>>;
  try {
    const check = await checkIdempotency(data.idempotencyKey, fingerprint);
    if (check.kind === 'CONFLICT') {
      return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    }
    if (check.kind === 'REPLAY') {
      return res.json({ success: true, data: statusResponse(check.transaction) });
    }

    const payerWallet = await walletService.getOrCreateWallet(data.payerOwnerType, data.payerOwnerId);
    const receiverWallet = await walletService.getOrCreateWallet(data.receiverOwnerType, data.receiverOwnerId);

    txn = await transactionRepository.create({
      payerId: data.payerOwnerId,
      purpose: data.purpose,
      gymId: data.gymId,
      ptId: data.ptId,
      membershipId: data.membershipId,
      ptContractId: data.ptContractId,
      amount: data.amount,
      currency: 'VND',
      status: 'PROCESSING',
      idempotencyKey: data.idempotencyKey,
      requestFingerprint: fingerprint,
      payerWalletId: payerWallet.id,
      receiverWalletId: receiverWallet.id,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
      activationStatus: 'PENDING',
      initiatedBy: data.initiatedBy,
      sourceService: data.sourceService,
    });

    const commissionRate = new Prisma.Decimal(data.commissionRate ?? DEFAULT_COMMISSION_RATE);
    const partnerType: PartnerType =
      data.receiverOwnerType === 'GYM' ? 'GYM' : data.receiverOwnerType === 'PT' ? 'PT' : 'CLIENT';

    await walletService.transferInternal({
      payerWalletId: payerWallet.id,
      receiverWalletId: receiverWallet.id,
      amount: new Prisma.Decimal(data.amount),
      commissionRate,
      transactionId: txn.id,
      partnerType,
      partnerId: data.receiverOwnerId,
    });
    const updated = await transactionRepository.findById(txn.id);
    return res.json({ success: true, data: statusResponse(updated!) });
  } catch (err) {
    if (!txn!) {
      logger.error({ error: 'wallet-transfer failed before transaction row was created', message: (err as Error).message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    }
    const isBusinessError = err instanceof InsufficientBalanceError || err instanceof WalletNotActiveError;
    if (!isBusinessError) {
      logger.error({ error: 'wallet-transfer failed', message: (err as Error).message, transactionId: txn.id });
    }
    await transactionRepository.markFailed(txn.id);
    return res.json({
      success: true,
      data: { status: 'FAILED' as const, transactionId: txn.id, failureReason: (err as Error).message },
    });
  }
});

const round2 = (n: number) => Math.round(n * 100) / 100;

const refundSchema = z.object({
  refundAmount: z.number().positive(),
  initiatedBy: z.string().min(1),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

// POST /internal/payments/:id/refund — partial (prorated) refund initiated by a service on the
// user's behalf (e.g. gym-service when a client cancels a membership early). Same ledger-reversal
// engine as the admin full-refund, but the caller passes the exact gross amount to return; the
// commission portion is prorated at the original transaction's commission rate. reverseTransfer
// runs the whole reversal (credit payer, debit receiver + platform, flip original → REFUNDED) in
// one DB transaction with the wallets locked FOR UPDATE.
router.post('/payments/:id/refund', async (req: Request, res: Response) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { refundAmount, initiatedBy, reason, idempotencyKey } = parsed.data;

  const original = await transactionRepository.findById(req.params.id);
  if (!original) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (original.status !== 'PAID') {
    const code = original.status === 'REFUNDED' ? 'ALREADY_REFUNDED' : 'NOT_REFUNDABLE';
    return res.status(409).json({ success: false, error: { code } });
  }
  if (!original.payerWalletId || !original.receiverWalletId) {
    return res.status(400).json({ success: false, error: { code: 'NOT_REFUNDABLE', message: 'Original has no wallet references' } });
  }
  if (refundAmount > Number(original.amount) + 0.001) {
    return res.status(400).json({ success: false, error: { code: 'REFUND_EXCEEDS_ORIGINAL' } });
  }

  const commission = await transactionRepository.findCommissionByTransactionId(original.id);
  if (!commission) return res.status(500).json({ success: false, error: { code: 'MISSING_COMMISSION_RECORD' } });

  const rate = Number(commission.commissionRate);
  const commissionAmount = round2(refundAmount * rate);
  const netToReceiver = round2(refundAmount - commissionAmount);

  const fingerprint = computeFingerprint({ originalTransactionId: original.id, refundAmount, initiatedBy });
  const check = await checkIdempotency(idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  if (check.kind === 'REPLAY') {
    return res.json({ success: true, data: { transactionId: check.transaction.id, status: check.transaction.status, refundAmount } });
  }

  const affordable = await walletService.checkRefundAffordable(
    original.receiverWalletId,
    new Prisma.Decimal(netToReceiver),
    new Prisma.Decimal(commissionAmount),
  );

  const refundTxn = await transactionRepository.create({
    payerId: original.payerId,
    purpose: 'REFUND',
    gymId: original.gymId,
    ptId: original.ptId,
    membershipId: original.membershipId,
    ptContractId: original.ptContractId,
    amount: refundAmount,
    currency: original.currency,
    status: 'PROCESSING',
    idempotencyKey,
    requestFingerprint: fingerprint,
    payerWalletId: original.payerWalletId,
    receiverWalletId: original.receiverWalletId,
    relatedEntityType: original.relatedEntityType,
    relatedEntityId: original.relatedEntityId,
    activationStatus: 'PENDING',
    initiatedBy,
    sourceService: 'payment-service',
    refundOfTransactionId: original.id,
    metadata: { reason, partialRefund: true, originalAmount: Number(original.amount) },
  });

  if (!affordable) {
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(409).json({ success: false, error: { code: 'INSUFFICIENT_REFUND_FUNDS' }, data: { transactionId: refundTxn.id, status: 'FAILED' } });
  }

  try {
    await walletService.reverseTransfer({
      payerWalletId: original.payerWalletId,
      receiverWalletId: original.receiverWalletId,
      amount: new Prisma.Decimal(refundAmount),
      commissionAmount: new Prisma.Decimal(commissionAmount),
      refundTransactionId: refundTxn.id,
      originalTransactionId: original.id,
      platformCommissionId: commission.id,
    });
  } catch (err) {
    logger.error({ error: 'Partial refund reversal failed', transactionId: refundTxn.id, message: (err as Error).message });
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED' }, data: { transactionId: refundTxn.id, status: 'FAILED' } });
  }

  // The initiating service (gym-service) cancels the membership itself, so no cancel-after-refund
  // callback is needed here.
  await transactionRepository.markActivated(refundTxn.id);
  return res.json({ success: true, data: { transactionId: refundTxn.id, status: 'PAID', refundAmount, commissionAmount, netToReceiver } });
});

// POST /internal/payments/:transactionId/mark-activated
router.post('/payments/:transactionId/mark-activated', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  await transactionRepository.markActivated(txn.id);
  return res.json({ success: true });
});

// GET /internal/payments/:transactionId — lookup used by gym-service/user-service to
// verify a transaction before activating/cancelling (never trust the caller blindly).
router.get('/payments/:transactionId', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  return res.json({ success: true, data: txn });
});

// GET /internal/wallets/:ownerType/:ownerId
router.get('/wallets/:ownerType/:ownerId', async (req: Request, res: Response) => {
  const ownerType = req.params.ownerType as WalletOwnerType;
  if (!Object.values(WalletOwnerType).includes(ownerType)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_OWNER_TYPE' } });
  }
  const wallet = await walletService.getOrCreateWallet(ownerType, req.params.ownerId);
  return res.json({ success: true, data: wallet });
});

export default router;
