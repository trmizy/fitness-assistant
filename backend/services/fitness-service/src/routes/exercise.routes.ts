import { Router } from 'express';
import { exerciseController } from '../controllers/exercise.controller';

const router = Router();

router.get('/', exerciseController.listExercises);
router.get('/:id', exerciseController.getExercise);

export default router;
