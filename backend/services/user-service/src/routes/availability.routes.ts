import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { availabilityController } from '../controllers/availability.controller';

const router = Router();

// PT/Admin can read their own availability.
router.get('/me', authMiddleware, availabilityController.getMyAvailability as any);

// Only PT (or ADMIN as override) may modify the PT-side schedule — clients must NOT
// be able to PUT /availability/me and silently set another user's slots (BUG-031).
router.put('/me', authMiddleware, roleMiddleware(['PT', 'ADMIN']), availabilityController.setAvailability as any);

router.get('/me/exceptions', authMiddleware, availabilityController.getExceptions as any);
router.post('/me/exceptions', authMiddleware, roleMiddleware(['PT', 'ADMIN']), availabilityController.addException as any);
router.delete('/me/exceptions/:id', authMiddleware, roleMiddleware(['PT', 'ADMIN']), availabilityController.removeException as any);

// Public-ish: clients need to read a PT's availability to book.
router.get('/:ptUserId', availabilityController.getAvailability as any);
router.get('/:ptUserId/slots', availabilityController.getAvailableSlots as any);

export default router;
