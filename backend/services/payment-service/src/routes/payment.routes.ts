import { Router, Request, Response } from 'express';
import { extractUser, requireAuth } from '../middleware/auth.middleware';
import { transactionRepository } from '../repositories/transaction.repository';

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
