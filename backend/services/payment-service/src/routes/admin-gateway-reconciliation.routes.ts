import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import {
  adminGatewayReconciliationService,
  gatewayReconciliationQuerySchema,
  GatewayWindowError,
} from '../services/admin-gateway-reconciliation.service';
import { vnpayL3QuerySchema, vnpayQueryReconcileService, L3_MAX_WINDOW_DAYS } from '../services/vnpay-query-reconcile';

/**
 * B8 (L2) - GET /admin/payments/gateway-reconciliation?from&to. READ ONLY, ADMIN only (same auth chain as admin.routes.ts).
 * Mounted in app.ts BEFORE `app.use('/admin/payments', adminRoutes)` so it can never be shadowed by a '/:id/...' route.
 * Compares Gymini's transactions only against the gateway events Gymini itself stored (not a gateway settlement file).
 * Error body: { error, code }.
 */
const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.get('/', async (req: Request, res: Response) => {
  const parsed = gatewayReconciliationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    return res.json(await adminGatewayReconciliationService.report(parsed.data));
  } catch (err) {
    if (err instanceof GatewayWindowError) {
      return res.status(400).json({ error: 'Khoảng thời gian không hợp lệ (from phải trước to, tối đa 92 ngày).', code: 'INVALID_QUERY' });
    }
    logger.error({ err: (err as Error).message }, '[payment-service] admin gateway reconciliation failed');
    return res.status(500).json({ error: 'Không tải được đối chiếu cổng.', code: 'GATEWAY_RECONCILIATION_FAILED' });
  }
});

/**
 * B8 (L3, VNPAY only) - GET /admin/payments/gateway-reconciliation/l3?from&to. READ ONLY (a GET: it never changes anything in
 * Gymini). Asks VNPay's own transaction query API about up to 50 Gymini VNPAY transactions of the window (default last 7 days,
 * max 31 days), one at a time. Without VNPay credentials it answers 200 { configured: false } and calls nothing.
 */
router.get('/l3', async (req: Request, res: Response) => {
  const parsed = vnpayL3QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await vnpayQueryReconcileService.run(parsed.data));
  } catch (err) {
    if (err instanceof GatewayWindowError) {
      return res.status(400).json({ error: `Khoảng thời gian không hợp lệ (from phải trước to, tối đa ${L3_MAX_WINDOW_DAYS} ngày).`, code: 'INVALID_QUERY' });
    }
    logger.error({ err: (err as Error).message }, '[payment-service] admin VNPay L3 reconciliation failed');
    return res.status(500).json({ error: 'Không đối chiếu được trực tiếp với VNPay.', code: 'VNPAY_L3_FAILED' });
  }
});

export default router;
