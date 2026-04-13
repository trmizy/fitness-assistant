import { Request, Response, NextFunction } from 'express';
import { logger, aiCoachQueriesTotal, aiCoachQueryDuration } from '@gym-coach/shared';
import { ragService } from '../services/rag.service';
import { conversationService } from '../services/conversation.service';
import { LlmError, formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { AskRequest, FeedbackRequest, GenerateWorkoutRequest } from '../schemas/ai.schemas';

export const aiController = {
  async ask(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    // userId is guaranteed by requireAuth middleware
    const { userId, authorizationHeader } = req.context;
    const { question } = req.body as AskRequest;

    try {
      const result = await ragService.rag(question, userId, authorizationHeader);

      aiCoachQueriesTotal.inc({ status: 'success' });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      res.json(formatSuccessResponse(result));
    } catch (err) {
      aiCoachQueriesTotal.inc({ status: 'failure' });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      if (err instanceof LlmError) {
        // Return structured 503 — do NOT leak infra details to the client.
        res.status(503).json(
          formatErrorResponse('LLM_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again shortly.'),
        );
        return;
      }
      logger.error({ err, userId }, 'Error in /ai/ask');
      next(err);
    }
  },

  async getConversations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    // limit is already parsed and validated by validateQuery middleware
    const limit = Number(req.query['limit']) || 10;

    try {
      const result = await conversationService.getConversations(userId, limit);
      res.json(formatSuccessResponse(result));
    } catch (err) {
      logger.error({ err, userId }, 'Error fetching conversations');
      next(err);
    }
  },

  async submitFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { conversationId, feedback } = req.body as FeedbackRequest;

    try {
      const result = await conversationService.submitFeedback(conversationId, feedback);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Error saving feedback');
      next(err);
    }
  },

  async getFeedbackStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await conversationService.getFeedbackStats();
      res.json(formatSuccessResponse(stats));
    } catch (err) {
      logger.error({ err }, 'Error fetching feedback stats');
      next(err);
    }
  },

  async generateWorkout(req: Request, res: Response, next: NextFunction): Promise<void> {
    const params = req.body as GenerateWorkoutRequest;

    try {
      const result = await conversationService.generateWorkout(params);
      res.json(formatSuccessResponse(result));
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(503).json(
          formatErrorResponse('LLM_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again shortly.'),
        );
        return;
      }
      logger.error({ err }, 'Error generating workout');
      next(err);
    }
  },
};
