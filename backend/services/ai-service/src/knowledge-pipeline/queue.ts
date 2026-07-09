import { Queue } from 'bullmq';
import { redisConnection } from '../workers/ai.queue';
import { KNOWLEDGE_PIPELINE } from './config';
import { knowledgeQueueDepth } from './metrics';
import type { LocalEvidencePipelineOptions, PubMedPipelineOptions, RssPipelineOptions, WebPipelineOptions } from './types';

export type KnowledgePipelineJobName = 'local-evidence-refresh' | 'pubmed-refresh' | 'rss-refresh' | 'web-refresh';
export type KnowledgePipelineJobData = LocalEvidencePipelineOptions | PubMedPipelineOptions | RssPipelineOptions | WebPipelineOptions;

let knowledgeQueueInstance: Queue<KnowledgePipelineJobData, unknown, KnowledgePipelineJobName> | null = null;

export function getKnowledgePipelineQueue(): Queue<KnowledgePipelineJobData, unknown, KnowledgePipelineJobName> {
  if (!knowledgeQueueInstance) {
    knowledgeQueueInstance = new Queue<KnowledgePipelineJobData, unknown, KnowledgePipelineJobName>(
      KNOWLEDGE_PIPELINE.queueName,
      { connection: redisConnection },
    );
  }
  return knowledgeQueueInstance;
}

export async function enqueueLocalEvidenceRefresh(options: LocalEvidencePipelineOptions = {}) {
  return getKnowledgePipelineQueue().add('local-evidence-refresh', options, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 1,
  });
}

export async function enqueuePubMedRefresh(options: PubMedPipelineOptions = {}) {
  return getKnowledgePipelineQueue().add('pubmed-refresh', options, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 1,
  });
}

export async function enqueueRssRefresh(options: RssPipelineOptions = {}) {
  return getKnowledgePipelineQueue().add('rss-refresh', options, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 1,
  });
}

export async function enqueueWebRefresh(options: WebPipelineOptions = {}) {
  return getKnowledgePipelineQueue().add('web-refresh', options, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 1,
  });
}

export async function scheduleKnowledgeRefreshes(): Promise<Array<{ name: KnowledgePipelineJobName; jobId: string | undefined }>> {
  const queue = getKnowledgePipelineQueue();
  const localJob = await queue.add(
    'local-evidence-refresh',
    { embed: true },
    {
      jobId: 'scheduled-local-evidence-refresh',
      repeat: { pattern: process.env.KNOWLEDGE_LOCAL_CRON || '0 2 * * *' },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );
  const pubmedJob = await queue.add(
    'pubmed-refresh',
    { embed: true, limit: Number.parseInt(process.env.KNOWLEDGE_PUBMED_LIMIT || '10', 10) },
    {
      jobId: 'scheduled-pubmed-refresh',
      repeat: { pattern: process.env.KNOWLEDGE_PUBMED_CRON || '30 2 * * *' },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );
  const rssJob = await queue.add(
    'rss-refresh',
    {
      embed: true,
      limit: Number.parseInt(process.env.KNOWLEDGE_RSS_LIMIT || '10', 10),
      sourceId: process.env.KNOWLEDGE_RSS_SOURCE_ID,
    },
    {
      jobId: 'scheduled-rss-refresh',
      repeat: { pattern: process.env.KNOWLEDGE_RSS_CRON || '0 3 * * *' },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );
  const webJob = await queue.add(
    'web-refresh',
    { embed: true, sourceId: process.env.KNOWLEDGE_WEB_SOURCE_ID },
    {
      jobId: 'scheduled-web-refresh',
      repeat: { pattern: process.env.KNOWLEDGE_WEB_CRON || '30 3 * * *' },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  return [
    { name: 'local-evidence-refresh', jobId: localJob.id },
    { name: 'pubmed-refresh', jobId: pubmedJob.id },
    { name: 'rss-refresh', jobId: rssJob.id },
    { name: 'web-refresh', jobId: webJob.id },
  ];
}

export async function removeKnowledgeRefreshSchedules(): Promise<number> {
  const queue = getKnowledgePipelineQueue();
  const repeatable = await queue.getRepeatableJobs();
  const targets = repeatable.filter((job) =>
    job.name === 'local-evidence-refresh' ||
    job.name === 'pubmed-refresh' ||
    job.name === 'rss-refresh' ||
    job.name === 'web-refresh',
  );
  await Promise.all(targets.map((job) => queue.removeRepeatableByKey(job.key)));
  return targets.length;
}

export async function updateKnowledgeQueueDepthMetrics(): Promise<Record<string, number>> {
  const queue = getKnowledgePipelineQueue();
  const counts = {
    waiting: await queue.getWaitingCount(),
    active: await queue.getActiveCount(),
    completed: await queue.getCompletedCount(),
    failed: await queue.getFailedCount(),
    delayed: await queue.getDelayedCount(),
  };
  for (const [state, value] of Object.entries(counts)) {
    knowledgeQueueDepth.labels(state).set(value);
  }
  return counts;
}

export async function closeKnowledgePipelineQueue(): Promise<void> {
  if (!knowledgeQueueInstance) return;
  const queue = knowledgeQueueInstance;
  knowledgeQueueInstance = null;
  await queue.close();
}
