import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { contractController } from '../controllers/contract.controller';

const router = Router();

// ── New contract request flow ─────────────────────────────────────
router.post('/request', authMiddleware, contractController.requestContract as any);
router.patch('/:id/accept', authMiddleware, contractController.acceptContract as any);
router.patch('/:id/reject', authMiddleware, contractController.rejectContract as any);
router.patch('/:id/cancel', authMiddleware, contractController.cancelContract as any);

// ── Relationship check (for call permission) ─────────────────────
router.get('/check-relationship', authMiddleware, contractController.checkRelationship as any);

// ── PT earnings ───────────────────────────────────────────────────
router.get('/pt/earnings', authMiddleware, contractController.getEarnings as any);

// ── PT endpoints ──────────────────────────────────────────────────
router.post('/', authMiddleware, contractController.create as any);
router.get('/pt', authMiddleware, contractController.getByPT as any);

// ── Client endpoints ──────────────────────────────────────────────
router.get('/client', authMiddleware, contractController.getByClient as any);

// ── Shared endpoints ──────────────────────────────────────────────
router.get('/:id', authMiddleware, contractController.getById as any);
router.patch('/:id/status', authMiddleware, contractController.updateStatus as any);
router.put('/:id', authMiddleware, contractController.update as any);
router.post('/:id/session', authMiddleware, contractController.logSession as any);

export default router;
