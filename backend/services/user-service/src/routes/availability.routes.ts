import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { availabilityController } from '../controllers/availability.controller';

const router = Router();

// ── PT gets their own availability ──────────────────────────────
router.get('/me', authMiddleware, availabilityController.getMyAvailability as any);

// ── PT sets their own availability ───────────────────────────────
router.put('/me', authMiddleware, availabilityController.setAvailability as any);

// ── PT manages their own exceptions ─────────────────────────────
router.get('/me/exceptions', authMiddleware, availabilityController.getExceptions as any);
router.post('/me/exceptions', authMiddleware, availabilityController.addException as any);
router.delete('/me/exceptions/:id', authMiddleware, availabilityController.removeException as any);

// ── Public: get PT's availability (for clients booking) ─────────
router.get('/:ptUserId', availabilityController.getAvailability as any);
router.get('/:ptUserId/slots', availabilityController.getAvailableSlots as any);

export default router;
