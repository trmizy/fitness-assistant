import { Request, Response } from 'express';
import { logger, aiCoachQueriesTotal, aiCoachQueryDuration, aiPlanGenerationsTotal } from '@gym-coach/shared';
import { ragService } from '../services/rag.service';
import { conversationService } from '../services/conversation.service';

function getAuthenticatedUserId(req: Request): string | null {
  const userId = req.headers['x-user-id'];
  if (Array.isArray(userId)) return userId[0] || null;
  return userId || null;
}

export const aiController = {
  async ask(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      const { question } = req.body;
      const userId = getAuthenticatedUserId(req);
      const authorizationHeader = req.headers.authorization;
      if (!question) {
        res.status(400).json({ error: 'No question provided' });
        return;
      }
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      const result = await ragService.rag(question, userId, authorizationHeader);

      // Record success metrics
      aiCoachQueriesTotal.inc({ status: 'success' });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      res.json(result);
    } catch (error) {
      aiCoachQueriesTotal.inc({ status: 'failure' });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      logger.error('Error in /ai/ask:', error);
      res.status(500).json({ error: 'Failed to process question' });
    }
  },

  async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthenticatedUserId(req);
      const { limit } = req.query;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      const result = await conversationService.getConversations(
        userId,
        limit ? parseInt(limit as string) : 10,
      );
      res.json(result);
    } catch (error) {
      logger.error('Error fetching conversations:', error);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  },

  async submitFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId, feedback } = req.body;
      const result = await conversationService.submitFeedback(
        conversationId,
        feedback,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error saving feedback:', error);
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  },

  async getFeedbackStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = await conversationService.getFeedbackStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error fetching feedback stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  },

  async generateWorkout(req: Request, res: Response): Promise<void> {
    try {
      const { goal, duration, equipment, bodyParts } = req.body;
      const result = await conversationService.generateWorkout({
        goal,
        duration,
        equipment,
        bodyParts,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error generating workout:', error);
      res.status(500).json({ error: 'Failed to generate workout' });
    }
  },

  async generatePlan(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthenticatedUserId(req);
      const { goal, durationWeeks, daysPerWeek } = req.body;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      const result = await conversationService.queuePlanGeneration({
        userId,
        goal,
        durationWeeks,
        daysPerWeek,
      });
      aiPlanGenerationsTotal.inc({ status: 'queued' });
      res.status(202).json(result);
    } catch (error) {
      aiPlanGenerationsTotal.inc({ status: 'failure' });
      logger.error('Error queuing plan generation:', error);
      res.status(500).json({ error: 'Failed to start plan generation' });
    }
  },
};
