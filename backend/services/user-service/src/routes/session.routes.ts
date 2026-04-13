import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { bookingController } from '../controllers/booking.controller';

const router = Router();

// ── Booking ──────────────────────────────────────────────────────────
router.post('/', authMiddleware, bookingController.bookSession as any);
router.get('/upcoming', authMiddleware, bookingController.getMyUpcoming as any);
router.get('/contract/:contractId', authMiddleware, bookingController.getContractSessions as any);

// ── Session actions ──────────────────────────────────────────────────
router.patch('/:id/confirm', authMiddleware, bookingController.confirmSession as any);
router.patch('/:id/complete', authMiddleware, bookingController.completeSession as any);
router.patch('/:id/cancel', authMiddleware, bookingController.cancelSession as any);
router.patch('/:id/no-show', authMiddleware, bookingController.markNoShow as any);
router.post('/:id/review', authMiddleware, bookingController.reviewSession as any);

export default router;
