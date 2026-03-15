import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { workoutController } from '../controllers/workout.controller';

const router = Router();

// NOTE: /generate must be declared BEFORE /:id to avoid route shadowing
router.post('/generate', authMiddleware, workoutController.generateWorkout as any);
router.get('/', authMiddleware, workoutController.listWorkouts as any);
router.get('/:id', authMiddleware, workoutController.getWorkout as any);
router.post('/', authMiddleware, workoutController.createWorkout as any);
router.put('/:id', authMiddleware, workoutController.updateWorkout as any);
router.delete('/:id', authMiddleware, workoutController.deleteWorkout as any);

export default router;
