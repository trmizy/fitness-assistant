import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { walletService } from '../services/wallet.service';
import { walletRepository } from '../repositories/wallet.repository';
import { withdrawalService } from '../services/withdrawal.service';
import type { WalletOwnerType } from '../generated/prisma';

const router = Router();
router.use(extractUser, requireAuth);

// GET /me/wallet — always the CLIENT (buyer) wallet, regardless of the user's other roles.
//
// A client wallet exists only to receive refunds and compensation now; purchases go straight
// to a payment gateway. Both buckets are returned so the UI can say what is withdrawable and
// what is still tied to a running contract.
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

/**
 * Wallet top-up is gone.
 *
 * Clients pay each purchase at the gateway directly, so there is nothing to pre-fund; a
 * client wallet now only ever receives refunds and no-show compensation. The route stays,
 * answering 410, because an old cached bundle or a stale test kit that keeps calling it
 * deserves an explanation rather than a 404 that reads like a deployment fault.
 */
const topupGone = (_req: Request, res: Response) =>
  res.status(410).json({
    success: false,
    error: {
      code: 'TOPUP_REMOVED',
      message: 'Wallet top-up has been removed — pay for each purchase at the gateway. The wallet only receives refunds.',
    },
  });

router.post('/wallet/topup', topupGone);
router.post('/wallet/topup/:transactionId/sync', topupGone);

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

// Money-flow plan 5.3 — self-service withdrawal requests for the two owner types payment-service
// itself can authenticate: CLIENT (refund/compensation-sourced balance only) and PT (their
// earnings wallet). GYM goes through gym-service's owner-verified proxy instead — see
// internal.routes.ts's /withdrawals/gym/:gymId.
const withdrawalRequestSchema = z.object({
  amount: z.string().min(1),
  payoutInfo: z.string().min(1),
});

router.post('/withdrawals', async (req: Request, res: Response) => {
  const ownerType: WalletOwnerType = req.user!.role === 'PT' ? 'PT' : 'CLIENT';
  const parsed = withdrawalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  try {
    const request = await withdrawalService.requestWithdrawal(ownerType, req.user!.userId, parsed.data.amount, parsed.data.payoutInfo);
    return res.status(201).json({ success: true, data: request });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    return res.status(err.status ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/withdrawals', async (req: Request, res: Response) => {
  const ownerType: WalletOwnerType = req.user!.role === 'PT' ? 'PT' : 'CLIENT';
  const list = await withdrawalService.listMine(ownerType, req.user!.userId);
  return res.json({ success: true, data: list });
});

export default router;
