import { Router } from 'express';
import { aiController } from '../controllers/ai.controller';

const router = Router();

router.post('/ask', aiController.ask);
router.get('/conversations', aiController.getConversations);
router.post('/feedback', aiController.submitFeedback);
router.get('/feedback/stats', aiController.getFeedbackStats);
router.post('/generate-workout', aiController.generateWorkout);
router.post('/generate-plan', aiController.generatePlan);

export default router;
