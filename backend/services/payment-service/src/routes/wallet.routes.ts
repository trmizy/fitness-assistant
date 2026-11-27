import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { requireWalletHolderRole } from '../middleware/wallet-holder.middleware';
import { walletService } from '../services/wallet.service';
import { walletRepository } from '../repositories/wallet.repository';
import { withdrawalService } from '../services/withdrawal.service';
import type { WalletOwnerType } from '../generated/prisma';
import { classifyWalletEntry } from '../services/wallet-entry-category';
import { buildPtWalletContractsView } from '../services/pt-wallet-contracts.service';
import { logger } from '@gym-coach/shared';
import { withdrawalErrorResponse } from '../utils/safe-error';
import { INVALID_AMOUNT_BODY, isValidWithdrawalAmount } from '../utils/withdrawal-amount';

const router = Router();
router.use(extractUser, requireAuth);

/** History rows as stored plus the derived, additive `category` (see wallet-entry-category.ts). */
async function historyFor(walletId: string) {
  const entries = await walletRepository.findLedgerEntriesWithPurpose(walletId);
  return entries.map(({ transaction, ...entry }) => ({ ...entry, category: classifyWalletEntry(entry, transaction) }));
}

// GET /me/wallet — always the CLIENT (buyer) wallet, regardless of the user's other roles.
// Only CUSTOMER / PT may hold one: a GYM_OWNER (or any other role) is refused 403 and NO wallet is created (requireWalletHolderRole).
//
// A client wallet exists only to receive refunds and compensation now; purchases go straight
// to a payment gateway. Both buckets are returned so the UI can say what is withdrawable and
// what is still tied to a running contract.
router.get('/wallet', requireWalletHolderRole, async (req: Request, res: Response) => {
  const wallet = await walletService.getOrCreateWallet('CLIENT', req.user!.userId);
  res.json({ success: true, data: wallet });
});

// GET /me/wallet/transactions
router.get('/wallet/transactions', requireWalletHolderRole, async (req: Request, res: Response) => {
  const wallet = await walletRepository.findByOwner('CLIENT', req.user!.userId);
  if (!wallet) return res.json({ success: true, data: [] });
  return res.json({ success: true, data: await historyFor(wallet.id) });
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

// GET /me/pt-wallet/contracts - FH-9: the PT's money PER CONTRACT, derived from the ledger (read only): value, expected income, pending
// (not earned), earned, held back (earned, not withdrawable) and when it comes back. Always the caller's own wallet.
router.get('/pt-wallet/contracts', async (req: Request, res: Response) => {
  if (req.user!.role !== 'PT') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'PT role required' } });
  }
  try {
    return res.json({ success: true, data: await buildPtWalletContractsView(req.user!.userId) });
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] pt wallet contracts view failed');
    return res.status(500).json({ success: false, error: { code: 'PT_WALLET_CONTRACTS_FAILED', message: 'Không tải được tiền theo từng hợp đồng.' } });
  }
});

// GET /me/pt-wallet/transactions
router.get('/pt-wallet/transactions', async (req: Request, res: Response) => {
  if (req.user!.role !== 'PT') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'PT role required' } });
  }
  const wallet = await walletRepository.findByOwner('PT', req.user!.userId);
  if (!wallet) return res.json({ success: true, data: [] });
  return res.json({ success: true, data: await historyFor(wallet.id) });
});

// Money-flow plan 5.3 — self-service withdrawal requests for the two owner types payment-service
// itself can authenticate: CLIENT (refund/compensation-sourced balance only) and PT (their
// earnings wallet). GYM goes through gym-service's owner-verified proxy instead — see
// internal.routes.ts's /withdrawals/gym/:gymId.
const withdrawalRequestSchema = z.object({
  amount: z.string().min(1),
  payoutInfo: z.string().min(1),
});

/**
 * Which of the caller's OWN wallets a /me/withdrawals call is about. A PT is also a client: refunds and compensation land in the CLIENT
 * wallet (GET /me/wallet), teaching income in the PT wallet, so the caller names the wallet with `wallet: "CLIENT" | "PT"` (body on POST,
 * query on GET). Absent -> the historical default (role PT -> PT, otherwise CLIENT), so an old app build behaves exactly as before.
 * The wallet is always keyed by req.user.userId, never by anything the client sends. A CUSTOMER may only use CLIENT (403 otherwise);
 * any other value is 400.
 */
export function resolveWithdrawalWallet(
  role: string | undefined,
  raw: unknown,
): { ok: true; ownerType: WalletOwnerType } | { ok: false; status: number; code: string; message: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, ownerType: role === 'PT' ? 'PT' : 'CLIENT' };
  if (raw !== 'CLIENT' && raw !== 'PT') {
    return { ok: false, status: 400, code: 'INVALID_WALLET', message: 'Ví không hợp lệ (chỉ nhận CLIENT hoặc PT).' };
  }
  if (raw === 'PT' && role !== 'PT') {
    return { ok: false, status: 403, code: 'WALLET_NOT_ALLOWED', message: 'Tài khoản này không có ví huấn luyện viên.' };
  }
  return { ok: true, ownerType: raw };
}

router.post('/withdrawals', requireWalletHolderRole, async (req: Request, res: Response) => {
  const selected = resolveWithdrawalWallet(req.user!.role, (req.body as { wallet?: unknown } | undefined)?.wallet);
  if (!selected.ok) {
    return res.status(selected.status).json({ success: false, error: { code: selected.code, message: selected.message } });
  }
  const ownerType = selected.ownerType;
  const parsed = withdrawalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  if (!isValidWithdrawalAmount(parsed.data.amount)) return res.status(400).json(INVALID_AMOUNT_BODY);
  try {
    const request = await withdrawalService.requestWithdrawal(ownerType, req.user!.userId, parsed.data.amount, parsed.data.payoutInfo);
    return res.status(201).json({ success: true, data: request });
  } catch (e) {
    const out = withdrawalErrorResponse(e, 'me withdrawal request');
    return res.status(out.status).json(out.body);
  }
});

router.get('/withdrawals', requireWalletHolderRole, async (req: Request, res: Response) => {
  const selected = resolveWithdrawalWallet(req.user!.role, req.query.wallet);
  if (!selected.ok) {
    return res.status(selected.status).json({ success: false, error: { code: selected.code, message: selected.message } });
  }
  const ownerType = selected.ownerType;
  const list = await withdrawalService.listMine(ownerType, req.user!.userId);
  return res.json({ success: true, data: list });
});

export default router;
