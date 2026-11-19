import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { adminWithdrawalHistoryQuerySchema, adminWithdrawalHistoryService } from '../services/admin-withdrawal-history.service';

// G-08 - read-only withdrawal history (PAID / REJECTED), mounted at /admin/payments/withdrawal-history in app.ts.
// Error body: { error, code }. No write route; payoutInfo is never returned (see the service whitelist).
const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.get('/', async (req: Request, res: Response) => {
  const parsed = adminWithdrawalHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    return res.json(await adminWithdrawalHistoryService.list(parsed.data));
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin withdrawal history failed');
    return res.status(500).json({ error: 'Không tải được lịch sử rút tiền.', code: 'WITHDRAWAL_HISTORY_FAILED' });
  }
});

export default router;
