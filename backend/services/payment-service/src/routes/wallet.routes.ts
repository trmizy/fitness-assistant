import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { walletService } from '../services/wallet.service';
import { walletRepository } from '../repositories/wallet.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { getProvider, providerConfigStatus } from '../services/payment.service';
import { handleEvent } from '../services/webhook.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { PaymentProviderType, Prisma } from '../generated/prisma';

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
  // VND has no minor unit; integer keeps ×100 math exact for gateway providers.
  amount: z.number().int().positive(),
  clientRequestId: z.string().min(1),
  // Per-request gateway choice; omitted → PAYMENT_PROVIDER env (default MOCK).
  // ZALOPAY/PAYOS are accepted so the request reaches the config guard and returns a
  // clear 400 PROVIDER_NOT_CONFIGURED (skeletons), not a zod validation error.
  provider: z.enum(['MOCK', 'VNPAY', 'MOMO', 'ZALOPAY', 'PAYOS']).optional(),
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

  // Resolve + validate the gateway BEFORE any DB work: a missing credential must be a
  // clear 400 (PROVIDER_NOT_CONFIGURED), never a mid-request 500.
  const providerName = (parsed.data.provider ?? process.env.PAYMENT_PROVIDER ?? 'MOCK').toUpperCase();
  const providerConfig = providerConfigStatus(providerName);
  if (!providerConfig.configured) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `Payment provider ${providerName} is not configured — missing env: ${providerConfig.missing.join(', ')}`,
      },
    });
  }

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
      // Provider-required reconciliation values (e.g. VNPay vnp_CreateDate for querydr).
      ...(intent.metadata ? { metadata: intent.metadata as Prisma.InputJsonValue } : {}),
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

// POST /me/wallet/topup/:transactionId/sync — actively asks the gateway for the
// transaction's status (VNPay querydr, ...). This is the confirmation path for local/dev
// where the provider's IPN cannot reach us; a PAID answer funnels into the SAME
// idempotent handleEvent used by webhooks, so it can never double-credit.
router.post('/wallet/topup/:transactionId/sync', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn || txn.payerId !== req.user!.userId || txn.purpose !== 'WALLET_TOPUP') {
    return res.status(404).json({ success: false, error: { code: 'TRANSACTION_NOT_FOUND' } });
  }

  if (txn.status === 'PAID' || txn.status === 'REFUNDED') {
    return res.json({ success: true, data: { id: txn.id, status: txn.status, provider: txn.provider } });
  }

  try {
    const provider = getProvider(txn.provider);
    if (!provider.queryTransactionStatus) {
      return res.json({
        success: true,
        data: { id: txn.id, status: txn.status, provider: txn.provider, note: 'provider does not support status query' },
      });
    }

    const gatewayStatus = await provider.queryTransactionStatus({
      id: txn.id,
      providerTransactionId: txn.providerTransactionId,
      amount: Number(txn.amount),
      createdAt: txn.createdAt,
      metadata: txn.metadata,
    });

    if (gatewayStatus === 'PAID') {
      await handleEvent({
        provider: txn.provider,
        providerEventId: `sync_${txn.id}`,
        providerTransactionId: txn.providerTransactionId ?? txn.id,
        payload: { source: 'manual-sync', transactionId: txn.id },
        status: 'PAID',
      });
    } else if (gatewayStatus === 'FAILED' && txn.status !== 'FAILED') {
      await transactionRepository.markFailed(txn.id);
    }

    const fresh = await transactionRepository.findById(txn.id);
    return res.json({ success: true, data: { id: fresh!.id, status: fresh!.status, provider: fresh!.provider } });
  } catch (err) {
    logger.error({ error: 'Top-up sync failed', txnId: txn.id, message: (err as Error).message });
    return res.status(502).json({ success: false, error: { code: 'PROVIDER_QUERY_FAILED', message: (err as Error).message } });
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
