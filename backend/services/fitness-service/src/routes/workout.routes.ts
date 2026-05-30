import { Router } from 'express';
import { authMiddleware, internalAuthMiddleware } from '../middleware/auth.middleware';
import { workoutController } from '../controllers/workout.controller';

const router = Router();

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.post('/generate', authMiddleware, workoutController.generateWorkout as any);
router.post('/from-ai-plan', internalAuthMiddleware, workoutController.importAiPlan as any);
router.get('/prs', authMiddleware, workoutController.getPRs as any);
router.get('/schedules', authMiddleware, workoutController.listSchedules as any);
router.delete('/schedules/:id', authMiddleware, workoutController.deleteSchedule as any);

router.get('/programs/current', authMiddleware, workoutController.getCurrentProgram as any);
router.patch('/programs/:id', authMiddleware, workoutController.updateProgram as any);
router.delete('/programs/:id', authMiddleware, workoutController.deleteProgram as any);

router.patch('/program-days/:id', authMiddleware, workoutController.updateProgramDay as any);

router.patch('/program-exercises/:id', authMiddleware, workoutController.updateProgramExercise as any);
router.delete('/program-exercises/:id', authMiddleware, workoutController.deleteProgramExercise as any);

router.patch('/sets/:setId', authMiddleware, workoutController.updateSet as any);
router.get('/', authMiddleware, workoutController.listWorkouts as any);
router.get('/:id', authMiddleware, workoutController.getWorkout as any);
router.post('/', authMiddleware, workoutController.createWorkout as any);
router.put('/:id', authMiddleware, workoutController.updateWorkout as any);
router.delete('/:id', authMiddleware, workoutController.deleteWorkout as any);
// Append a single set to an existing workout (BUG-007 / BR-WK-02).
router.post('/:id/sets', authMiddleware, workoutController.addSet as any);

export default router;
