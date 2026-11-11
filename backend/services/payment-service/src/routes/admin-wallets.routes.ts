import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import {
  adminWalletDetailQuerySchema,
  adminWalletsQuerySchema,
  adminWalletsService,
  isUuid,
} from '../services/admin-wallets.service';

/**
 * G-09 / G-10 - wallet explorer. READ ONLY, ADMIN only (same auth chain as admin.routes.ts). Mounted in app.ts at
 * /admin/payments/wallets BEFORE the generic admin router, so '/:id' here can never be shadowed.
 *   GET /        wallets (ownerType?, ownerId? exact, limit, offset)
 *   GET /:id     one wallet + its ledger entries (entriesLimit, entriesOffset, from, to)
 * Error body: { error, code }.
 */
const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.get('/', async (req: Request, res: Response) => {
  const parsed = adminWalletsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    return res.json(await adminWalletsService.list(parsed.data));
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin wallets list failed');
    return res.status(500).json({ error: 'Không tải được danh sách ví.', code: 'WALLETS_LIST_FAILED' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) {
    return res.status(400).json({ error: 'Mã ví không hợp lệ.', code: 'INVALID_ID' });
  }
  const parsed = adminWalletDetailQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    const result = await adminWalletsService.detail(id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Không tìm thấy ví.', code: 'WALLET_NOT_FOUND' });
    return res.json(result);
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin wallet detail failed');
    return res.status(500).json({ error: 'Không tải được chi tiết ví.', code: 'WALLET_DETAIL_FAILED' });
  }
});

export default router;
