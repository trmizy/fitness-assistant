import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { ragService } from '../services/rag.service';
import { conversationService } from '../services/conversation.service';

export const aiController = {
  async ask(req: Request, res: Response): Promise<void> {
    try {
      const { question, userId } = req.body;
      if (!question) {
        res.status(400).json({ error: 'No question provided' });
        return;
      }
      const result = await ragService.rag(question, userId);
      res.json(result);
    } catch (error) {
      logger.error('Error in /ai/ask:', error);
      res.status(500).json({ error: 'Failed to process question' });
    }
  },

  async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const { userId, limit } = req.query;
      const result = await conversationService.getConversations(
        userId as string | undefined,
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
      const { userId, goal, durationWeeks, daysPerWeek } = req.body;
      const result = await conversationService.queuePlanGeneration({
        userId,
        goal,
        durationWeeks,
        daysPerWeek,
      });
      res.status(202).json(result);
    } catch (error) {
      logger.error('Error queuing plan generation:', error);
      res.status(500).json({ error: 'Failed to start plan generation' });
    }
  },
};
