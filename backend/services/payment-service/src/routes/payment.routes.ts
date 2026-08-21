import { Router, Request, Response } from 'express';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { transactionRepository } from '../repositories/transaction.repository';
import { providerConfigStatus, DEFAULT_PROVIDER } from '../services/payment.service';

const router = Router();
router.use(extractUser, requireAuth);

// GET /me/payments — the caller's own payment/transaction history. Was
// previously an unauthenticated stub that always returned an empty array
// regardless of who asked or what actually happened — real history now
// comes from transactionRepository, scoped to the authenticated caller.
router.get('/', async (req: Request, res: Response) => {
  const transactions = await transactionRepository.findByPayerId(req.user!.userId);
  res.json({ success: true, data: transactions });
});

/**
 * GET /me/payments/methods — the gateways a payer may actually choose right now.
 *
 * The server decides, not the bundle. Which gateways work depends on which credentials this
 * deployment holds, and a hard-coded list in the UI drifts the moment an operator adds or
 * removes one — offering a payment method that cannot complete is worse than not offering it,
 * because the user finds out only after committing to buy.
 *
 * Unusable gateways are still listed, with `configured: false` and the reason, so the picker
 * can grey them out honestly rather than pretending they do not exist.
 */
router.get('/methods', async (_req: Request, res: Response) => {
  const catalogue: { provider: string; label: string; description: string }[] = [
    { provider: 'VNPAY', label: 'VNPay', description: 'Thẻ ATM nội địa, Internet Banking, thẻ quốc tế' },
    { provider: 'ZALOPAY', label: 'ZaloPay', description: 'Quét mã QR bằng ứng dụng ZaloPay' },
    { provider: 'MOMO', label: 'MoMo', description: 'Ví điện tử MoMo' },
  ];

  const methods = catalogue.map((m) => {
    const status = providerConfigStatus(m.provider);
    return {
      ...m,
      configured: status.configured,
      unavailableReason: status.configured
        ? null
        : `Chưa cấu hình: ${status.missing.join(', ')}`,
    };
  });

  // Default to the first usable one so the picker never opens pre-selected on a dead gateway.
  const preferred = (process.env.PAYMENT_PROVIDER ?? DEFAULT_PROVIDER).toUpperCase();
  const defaultProvider =
    methods.find((m) => m.provider === preferred && m.configured)?.provider ??
    methods.find((m) => m.configured)?.provider ??
    null;

  return res.json({ success: true, data: { methods, defaultProvider } });
});

// GET /me/payments/:id — a single transaction, owner-only. Returns 404 (not
// 403) for a transaction that exists but belongs to someone else, so this
// endpoint never confirms/denies another user's transaction IDs exist.
router.get('/:id', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.id);
  if (!txn || txn.payerId !== req.user!.userId) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    return;
  }
  res.json({ success: true, data: txn });
});

export default router;
