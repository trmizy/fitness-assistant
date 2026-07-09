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
import { aiQueue } from '../workers/ai.queue';
import {
  enqueueLocalEvidenceRefresh,
  enqueuePubMedRefresh,
  enqueueRssRefresh,
  enqueueWebRefresh,
  getKnowledgePipelineQueue,
  removeKnowledgeRefreshSchedules,
  scheduleKnowledgeRefreshes,
  updateKnowledgeQueueDepthMetrics,
} from '../knowledge-pipeline/queue';
import { knowledgeRepository } from '../knowledge-pipeline/repository';
import { embedAndUpsertDocument } from '../knowledge-pipeline/qdrant-writer';
import { formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { AdminRequestsQuery } from '../repositories/conversation.repository';

type KnowledgeJobKind = 'local' | 'pubmed' | 'rss' | 'web';

function readParam(req: Request, name: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && Object.prototype.hasOwnProperty.call(body, name)) return body[name];
  return req.query[name];
}

function readBoolean(req: Request, name: string, defaultValue: boolean): boolean {
  const value = readParam(req, name);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return defaultValue;
}

function readString(req: Request, name: string): string | undefined {
  const value = readParam(req, name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readLimit(req: Request, defaultValue: number, maxValue: number): number {
  const raw = Number(readParam(req, 'limit'));
  if (!Number.isFinite(raw)) return defaultValue;
  return Math.min(maxValue, Math.max(1, Math.floor(raw)));
}

function isKnowledgeJobKind(kind: string): kind is KnowledgeJobKind {
  return kind === 'local' || kind === 'pubmed' || kind === 'rss' || kind === 'web';
}

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

  /**
   * GET /admin/ai/knowledge
   * Knowledge-update pipeline dashboard data: recent runs, review queue,
   * live BullMQ counts, and scheduled repeatable jobs.
   */
  async getKnowledgePipeline(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const queue = getKnowledgePipelineQueue();
      const [runs, reviewItems, queueCounts, repeatable] = await Promise.all([
        knowledgeRepository.listPipelineRuns(10),
        knowledgeRepository.listReviewQueue(20),
        updateKnowledgeQueueDepthMetrics().catch(() => null),
        queue.getRepeatableJobs().catch(() => []),
      ]);

      res.json(formatSuccessResponse({
        generatedAt: new Date().toISOString(),
        runs,
        reviewItems,
        queue: {
          name: queue.name,
          ...(queueCounts ?? { waiting: null, active: null, completed: null, failed: null, delayed: null }),
          repeatable,
        },
      }));
    } catch (err) {
      logger.error({ err }, 'Admin knowledge pipeline query failed');
      next(err);
    }
  },

  /**
   * POST /admin/ai/knowledge/jobs/:kind
   * Queue a manual pipeline refresh. kind is one of: local, pubmed, rss, web.
   */
  async enqueueKnowledgePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { kind } = req.params;
    if (!isKnowledgeJobKind(kind)) {
      res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Unknown knowledge job kind'));
      return;
    }

    const embed = readBoolean(req, 'embed', true);
    const force = readBoolean(req, 'force', false);

    try {
      const job = kind === 'local'
        ? await enqueueLocalEvidenceRefresh({ embed, force, limit: readLimit(req, 25, 250) })
        : kind === 'pubmed'
          ? await enqueuePubMedRefresh({ embed, force, limit: readLimit(req, 10, 50), query: readString(req, 'query') })
          : kind === 'rss'
            ? await enqueueRssRefresh({ embed, force, limit: readLimit(req, 10, 50), sourceId: readString(req, 'sourceId') })
            : await enqueueWebRefresh({ embed, force, sourceId: readString(req, 'sourceId') });

      res.status(202).json(formatSuccessResponse({
        queued: true,
        kind,
        jobId: job.id,
        queue: job.queueName,
      }));
    } catch (err) {
      logger.error({ err, kind }, 'Admin enqueue knowledge pipeline failed');
      next(err);
    }
  },

  /**
   * POST /admin/ai/knowledge/review/:reviewId/approve
   * Approve a review item and optionally embed it immediately.
   */
  async approveKnowledgeReviewItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { reviewId } = req.params;

    try {
      const review = await knowledgeRepository.getReviewDocument(reviewId);
      if (!review) {
        res.status(404).json(formatErrorResponse('NOT_FOUND', `Knowledge review item ${reviewId} not found`));
        return;
      }

      await knowledgeRepository.approveReviewItem(review.reviewId, req.context?.userId ?? null);

      let embeddedChunks = 0;
      if (readBoolean(req, 'embed', true)) {
        embeddedChunks = await embedAndUpsertDocument(review.documentId, review.document, review.source);
      }

      res.json(formatSuccessResponse({
        approved: true,
        reviewId: review.reviewId,
        documentId: review.documentId,
        embeddedChunks,
      }));
    } catch (err) {
      logger.error({ err, reviewId }, 'Admin approve knowledge review item failed');
      next(err);
    }
  },

  /**
   * POST /admin/ai/knowledge/review/:reviewId/reject
   * Reject a pending review item.
   */
  async rejectKnowledgeReviewItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { reviewId } = req.params;

    try {
      const review = await knowledgeRepository.getReviewDocument(reviewId);
      if (!review) {
        res.status(404).json(formatErrorResponse('NOT_FOUND', `Knowledge review item ${reviewId} not found`));
        return;
      }

      await knowledgeRepository.rejectReviewItem(
        review.reviewId,
        req.context?.userId ?? null,
        readString(req, 'reason') ?? 'rejected_by_admin',
      );

      res.json(formatSuccessResponse({ rejected: true, reviewId: review.reviewId, documentId: review.documentId }));
    } catch (err) {
      logger.error({ err, reviewId }, 'Admin reject knowledge review item failed');
      next(err);
    }
  },

  /**
   * POST /admin/ai/knowledge/schedule
   * Register repeatable BullMQ jobs for the knowledge pipeline.
   */
  async scheduleKnowledgePipeline(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobs = await scheduleKnowledgeRefreshes();
      res.status(202).json(formatSuccessResponse({ scheduled: true, jobs }));
    } catch (err) {
      logger.error({ err }, 'Admin schedule knowledge pipeline failed');
      next(err);
    }
  },

  /**
   * DELETE /admin/ai/knowledge/schedule
   * Remove repeatable BullMQ jobs for the knowledge pipeline.
   */
  async clearKnowledgeSchedule(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const removed = await removeKnowledgeRefreshSchedules();
      res.json(formatSuccessResponse({ cleared: true, removed }));
    } catch (err) {
      logger.error({ err }, 'Admin clear knowledge schedule failed');
      next(err);
    }
  },
};
