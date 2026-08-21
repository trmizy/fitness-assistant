import { Router, Request, Response } from 'express';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { walletService } from '../services/wallet.service';
import { walletRepository } from '../repositories/wallet.repository';

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

export default router;
