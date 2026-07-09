import { Router, Request, Response, NextFunction } from 'express';
import { conversationRepository } from '../repositories/conversation.repository';
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
import { runLocalEvidencePipeline, runPubMedPipeline, runRssPipeline, runWebPipeline } from '../knowledge-pipeline/service';

const router = Router();

function requireInternalSecret(req: Request, res: Response): boolean {
  const SECRET = process.env.INTERNAL_SERVICE_SECRET;
  if (!SECRET) {
    res.status(500).json({ error: 'Internal secret not configured' });
    return false;
  }
  if (!req.headers['x-service-secret'] || req.headers['x-service-secret'] !== SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

router.delete('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    await conversationRepository.deleteByUserId(req.params.userId);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/local-evidence', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const result = await runLocalEvidencePipeline({
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/local-evidence/async', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const job = await enqueueLocalEvidenceRefresh({
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.status(202).json({ queued: true, jobId: job.id, queue: job.queueName });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/pubmed', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const result = await runPubMedPipeline({
      query: typeof req.query['query'] === 'string' ? req.query['query'] : undefined,
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/pubmed/async', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const job = await enqueuePubMedRefresh({
      query: typeof req.query['query'] === 'string' ? req.query['query'] : undefined,
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.status(202).json({ queued: true, jobId: job.id, queue: job.queueName });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/rss', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const result = await runRssPipeline({
      sourceId: typeof req.query['sourceId'] === 'string' ? req.query['sourceId'] : undefined,
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/rss/async', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Number.isFinite(Number(req.query['limit'])) ? Number(req.query['limit']) : undefined;
    const job = await enqueueRssRefresh({
      sourceId: typeof req.query['sourceId'] === 'string' ? req.query['sourceId'] : undefined,
      limit,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.status(202).json({ queued: true, jobId: job.id, queue: job.queueName });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/web', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const result = await runWebPipeline({
      sourceId: typeof req.query['sourceId'] === 'string' ? req.query['sourceId'] : undefined,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/web/async', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const job = await enqueueWebRefresh({
      sourceId: typeof req.query['sourceId'] === 'string' ? req.query['sourceId'] : undefined,
      force: req.query['force'] === 'true',
      embed: req.query['embed'] !== 'false',
    });
    res.status(202).json({ queued: true, jobId: job.id, queue: job.queueName });
  } catch (err) {
    next(err);
  }
});

router.get('/knowledge/pipeline-runs', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query['limit']) || 10));
    const runs = await knowledgeRepository.listPipelineRuns(limit);
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

router.get('/knowledge/review-queue', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20));
    const items = await knowledgeRepository.listReviewQueue(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/review/:reviewId/approve', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const review = await knowledgeRepository.getReviewDocument(req.params.reviewId);
    if (!review) {
      res.status(404).json({ error: 'Review item not found' });
      return;
    }

    const reviewedBy = typeof req.query['reviewedBy'] === 'string' ? req.query['reviewedBy'] : null;
    await knowledgeRepository.approveReviewItem(review.reviewId, reviewedBy);

    let embeddedChunks = 0;
    if (req.query['embed'] !== 'false') {
      embeddedChunks = await embedAndUpsertDocument(review.documentId, review.document, review.source);
    }

    res.json({ approved: true, reviewId: review.reviewId, documentId: review.documentId, embeddedChunks });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/review/:reviewId/reject', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const reviewedBy = typeof req.query['reviewedBy'] === 'string' ? req.query['reviewedBy'] : null;
    const reason = typeof req.query['reason'] === 'string' ? req.query['reason'] : null;
    await knowledgeRepository.rejectReviewItem(req.params.reviewId, reviewedBy, reason);
    res.json({ rejected: true, reviewId: req.params.reviewId });
  } catch (err) {
    next(err);
  }
});

router.get('/knowledge/queue', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const queue = getKnowledgePipelineQueue();
    const counts = await updateKnowledgeQueueDepthMetrics();
    const repeatable = await queue.getRepeatableJobs();
    res.json({ queue: { name: queue.name, ...counts, repeatable } });
  } catch (err) {
    next(err);
  }
});

router.post('/knowledge/schedule', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const jobs = await scheduleKnowledgeRefreshes();
    res.status(202).json({ scheduled: true, jobs });
  } catch (err) {
    next(err);
  }
});

router.delete('/knowledge/schedule', async (req: Request, res: Response, next: NextFunction) => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const removed = await removeKnowledgeRefreshSchedules();
    res.json({ cleared: true, removed });
  } catch (err) {
    next(err);
  }
});

export default router;
