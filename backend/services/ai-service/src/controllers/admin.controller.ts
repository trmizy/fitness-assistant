/**
 * Admin observability controller.
 *
 * All handlers read from real DB + BullMQ state.
 * No static payloads, no demo data.
 *
 * Routes (all require requireAuth — gateway enforces ADMIN role before forwarding):
 *   GET /admin/ai/overview
 *   GET /admin/ai/requests
 *   GET /admin/ai/requests/:id
 *   GET /admin/ai/queue
 *   GET /admin/ai/errors
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '@gym-coach/shared';
import { conversationRepository } from '../repositories/conversation.repository';
import { aiQueue } from '../workers/ai.worker';
import { formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { AdminRequestsQuery } from '../repositories/conversation.repository';

export const adminController = {
  /**
   * GET /admin/ai/overview
   * Aggregate stats: totals, avg latency, fallback rates, intent distribution,
   * language split, and plan job counts.
   * Also enriches with live BullMQ queue counts.
   */
  async getOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [dbStats, waiting, active, completed, failed, delayed] = await Promise.all([
        conversationRepository.adminGetOverviewStats(),
        aiQueue.getWaitingCount().catch(() => null),
        aiQueue.getActiveCount().catch(() => null),
        aiQueue.getCompletedCount().catch(() => null),
        aiQueue.getFailedCount().catch(() => null),
        aiQueue.getDelayedCount().catch(() => null),
      ]);

      res.json(
        formatSuccessResponse({
          generatedAt: new Date().toISOString(),
          conversations: dbStats.conversations,
          intents: dbStats.intents,
          languages: dbStats.languages,
          plans: {
            ...dbStats.plans,
            // BullMQ live counts (may be null if Redis is down)
            queue: {
              waiting:   waiting   ?? null,
              active:    active    ?? null,
              completed: completed ?? null,
              failed:    failed    ?? null,
              delayed:   delayed   ?? null,
            },
          },
        }),
      );
    } catch (err) {
      logger.error({ err }, 'Admin overview query failed');
      next(err);
    }
  },

  /**
   * GET /admin/ai/requests?filter=all|fallback|slow|warnings&intent=...&page=1&limit=20
   * Paginated list of conversations with observability metadata.
   * No raw answer text — just metadata for the table.
   */
  async listRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    const query: AdminRequestsQuery = {
      filter: (req.query['filter'] as AdminRequestsQuery['filter']) ?? 'all',
      intent: (req.query['intent'] as string) || undefined,
      page:   Math.max(1, Number(req.query['page'])  || 1),
      limit:  Math.min(100, Math.max(1, Number(req.query['limit']) || 20)),
    };

    try {
      const result = await conversationRepository.adminListRequests(query);
      res.json(formatSuccessResponse(result));
    } catch (err) {
      logger.error({ err, query }, 'Admin list requests failed');
      next(err);
    }
  },

  /**
   * GET /admin/ai/requests/:id
   * Full conversation detail for the trace drawer.
   * Returns question + answer text + all observability fields.
   */
  async getRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;

    try {
      const conversation = await conversationRepository.adminGetRequest(id);
      if (!conversation) {
        res.status(404).json(formatErrorResponse('NOT_FOUND', `Conversation ${id} not found`));
        return;
      }
      res.json(formatSuccessResponse({ conversation }));
    } catch (err) {
      logger.error({ err, id }, 'Admin get request detail failed');
      next(err);
    }
  },

  /**
   * GET /admin/ai/queue
   * Recent WorkoutPlan records (last 30) plus live BullMQ queue counts.
   */
  async getQueue(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [plans, waiting, active, completed, failed, delayed] = await Promise.all([
        conversationRepository.adminListPlans(30),
        aiQueue.getWaitingCount().catch(() => null),
        aiQueue.getActiveCount().catch(() => null),
        aiQueue.getCompletedCount().catch(() => null),
        aiQueue.getFailedCount().catch(() => null),
        aiQueue.getDelayedCount().catch(() => null),
      ]);

      res.json(
        formatSuccessResponse({
          generatedAt: new Date().toISOString(),
          queue: { waiting, active, completed, failed, delayed },
          plans,
        }),
      );
    } catch (err) {
      logger.error({ err }, 'Admin queue query failed');
      next(err);
    }
  },

  /**
   * GET /admin/ai/errors
   * Failed plans (any time) + conversations with validation warnings (last 7 days).
   */
  async getErrors(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const errors = await conversationRepository.adminGetErrors();
      res.json(formatSuccessResponse({ generatedAt: new Date().toISOString(), ...errors }));
    } catch (err) {
      logger.error({ err }, 'Admin errors query failed');
      next(err);
    }
  },
};
