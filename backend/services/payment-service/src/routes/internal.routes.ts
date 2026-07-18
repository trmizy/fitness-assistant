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

  const check = await checkIdempotency(data.idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') {
    return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  }
  if (check.kind === 'REPLAY') {
    return res.json({ success: true, data: statusResponse(check.transaction) });
  }

  const payerWallet = await walletService.getOrCreateWallet(data.payerOwnerType, data.payerOwnerId);
  const receiverWallet = await walletService.getOrCreateWallet(data.receiverOwnerType, data.receiverOwnerId);
  const commissionRate = new Prisma.Decimal(data.commissionRate ?? DEFAULT_COMMISSION_RATE);
  const partnerType: PartnerType =
    data.receiverOwnerType === 'GYM' ? 'GYM' : data.receiverOwnerType === 'PT' ? 'PT' : 'CLIENT';

  const txn = await transactionRepository.create({
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

  try {
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
