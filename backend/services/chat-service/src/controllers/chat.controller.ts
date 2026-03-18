import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { chatService } from '../services/chat.service';
import {
  createDirectConversationSchema,
  paginationSchema,
  sendMessageSchema,
} from '../models/chat.models';
import type { AuthRequest } from '../middleware/auth.middleware';

function extractToken(req: AuthRequest): string {
  return req.headers.authorization?.substring(7) ?? '';
}

export const chatController = {
  async createDirectConversation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { targetUserId } = createDirectConversationSchema.parse(req.body);
      const result = await chatService.createOrGetDirectConversation(
        req.user!.id,
        targetUserId,
        extractToken(req),
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error(error, 'Create conversation error');
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  },

  async listConversations(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await chatService.listConversations(req.user!.id);
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'List conversations error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getMessages(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit } = paginationSchema.parse(req.query);
      const result = await chatService.getMessages(
        req.params.id,
        req.user!.id,
        page,
        limit,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid query params', details: error.errors });
        return;
      }
      logger.error(error, 'Get messages error');
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  },

  async sendMessage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { content } = sendMessageSchema.parse(req.body);
      const result = await chatService.sendMessage(req.params.id, req.user!.id, content);
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error(error, 'Send message error');
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  },
};
