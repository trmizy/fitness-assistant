import { Router } from 'express';
import { authMiddleware, internalAuthMiddleware } from '../middleware/auth.middleware';
import { workoutController } from '../controllers/workout.controller';

const router = Router();

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.post('/generate', authMiddleware, workoutController.generateWorkout as any);
router.post('/from-ai-plan', internalAuthMiddleware, workoutController.importAiPlan as any);
router.get('/prs', authMiddleware, workoutController.getPRs as any);
router.get('/schedules', authMiddleware, workoutController.listSchedules as any);
router.patch('/sets/:setId', authMiddleware, workoutController.updateSet as any);
router.get('/', authMiddleware, workoutController.listWorkouts as any);
router.get('/:id', authMiddleware, workoutController.getWorkout as any);
router.post('/', authMiddleware, workoutController.createWorkout as any);
router.put('/:id', authMiddleware, workoutController.updateWorkout as any);
router.delete('/:id', authMiddleware, workoutController.deleteWorkout as any);
// Append a single set to an existing workout (BUG-007 / BR-WK-02).
router.post('/:id/sets', authMiddleware, workoutController.addSet as any);

export default router;
