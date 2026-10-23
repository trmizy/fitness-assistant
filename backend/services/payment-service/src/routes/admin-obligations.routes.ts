/**
 * FH-4 part 2 - GET /admin/payments/obligations (READ ONLY).
 *
 * The gateway already restricts /admin/payments/* to ADMIN; this router checks independently as well (payment-service's
 * port is reachable without the gateway), and answers 403 to anyone else. It has no write route and the report is built
 * inside a READ ONLY transaction (see admin-obligations.service.ts).
 *
 * Query: `limit` (1-200, default 50) caps each list; `staleMinutes` (default 30) is the age after which a PAID payment
 * that was never activated is listed.
 */
import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { buildObligationsReport, clampLimit, clampStaleMinutes } from '../services/admin-obligations.service';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.get('/', async (req: Request, res: Response) => {
  try {
    const report = await buildObligationsReport({
      limit: clampLimit(req.query.limit),
      staleMinutes: clampStaleMinutes(req.query.staleMinutes),
    });
    res.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] obligations report failed');
    res.status(500).json({ success: false, error: { code: 'OBLIGATIONS_REPORT_FAILED', message: 'Không tạo được báo cáo đối soát.' } });
  }
});

export default router;
