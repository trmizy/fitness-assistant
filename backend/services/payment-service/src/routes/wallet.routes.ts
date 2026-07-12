import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { walletService } from '../services/wallet.service';
import { walletRepository } from '../repositories/wallet.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { getProvider } from '../services/payment.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { PaymentProviderType } from '../generated/prisma';

const router = Router();
router.use(extractUser, requireAuth);

// GET /me/wallet — always the CLIENT (buyer) wallet, regardless of the user's other roles.
router.get('/wallet', async (req: Request, res: Response) => {
  const wallet = await walletService.getOrCreateWallet('CLIENT', req.user!.userId);
  res.json({ success: true, data: wallet });
});

// GET /me/wallet/transactions
router.get('/wallet/transactions', async (req: Request, res: Response) => {
  const wallet = await walletRepository.findByOwner('CLIENT', req.user!.userId);
  if (!wallet) return res.json({ success: true, data: [] });
  const entries = await walletRepository.findLedgerEntries(wallet.id);
  return res.json({ success: true, data: entries });
});

const topupSchema = z.object({
  amount: z.number().positive(),
  clientRequestId: z.string().min(1),
});

// POST /me/wallet/topup — clientRequestId is required (not optional): the frontend
// must generate it once per form submission and reuse it on retry, so a double-click
// dedupes to one top-up. A server-generated fallback can't dedupe a double-click since
// each HTTP request would get its own fresh id, defeating the entire point.
router.post('/wallet/topup', async (req: Request, res: Response) => {
  const parsed = topupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { amount, clientRequestId } = parsed.data;
  const userId = req.user!.userId;
  const idempotencyKey = `wallet-topup:${clientRequestId}`;

  const wallet = await walletService.getOrCreateWallet('CLIENT', userId);
  const fingerprint = computeFingerprint({ amount, currency: 'VND', purpose: 'WALLET_TOPUP', payerId: userId });

  const check = await checkIdempotency(idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') {
    return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  }
  if (check.kind === 'REPLAY') {
    return res.json({ success: true, data: check.transaction });
  }

  try {
    const providerName = (process.env.PAYMENT_PROVIDER ?? 'MOCK').toUpperCase();
    const provider = getProvider(providerName);

    const txnId = randomUUID();
    const intent = await provider.createPaymentIntent({
      transactionId: txnId,
      amount,
      orderInfo: 'Wallet top-up',
    });

    const txn = await transactionRepository.create({
      id: txnId,
      payerId: userId,
      purpose: 'WALLET_TOPUP',
      amount,
      currency: 'VND',
      provider: providerName as PaymentProviderType,
      providerTransactionId: intent.providerTransactionId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      payerWalletId: wallet.id,
      receiverWalletId: wallet.id,
      relatedEntityType: 'WALLET_TOPUP',
      activationStatus: 'NOT_APPLICABLE',
      initiatedBy: userId,
      sourceService: 'payment-service',
    });

    return res.status(201).json({
      success: true,
      data: { ...txn, redirectUrl: intent.redirectUrl, qrCodeUrl: intent.qrCodeUrl },
    });
  } catch (err) {
    logger.error({ error: 'Failed to create top-up transaction', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  }
});

// GET /me/pt-wallet — always the PT earnings wallet. Gated by holding the PT role,
// not by whether the wallet has any transaction history — a PT with zero earnings
// still gets a real 0.00 balance, not an error.
router.get('/pt-wallet', async (req: Request, res: Response) => {
  if (req.user!.role !== 'PT') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'PT role required' } });
  }
  const wallet = await walletService.getOrCreateWallet('PT', req.user!.userId);
  return res.json({ success: true, data: wallet });
});

// GET /me/pt-wallet/transactions
router.get('/pt-wallet/transactions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'PT') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'PT role required' } });
  }
  const wallet = await walletRepository.findByOwner('PT', req.user!.userId);
  if (!wallet) return res.json({ success: true, data: [] });
  const entries = await walletRepository.findLedgerEntries(wallet.id);
  return res.json({ success: true, data: entries });
});

export default router;
