import { Counter, Gauge, Histogram } from 'prom-client';
import { register } from '@gym-coach/shared';

export const knowledgePipelineRunsTotal = new Counter({
  name: 'knowledge_pipeline_runs_total',
  help: 'Total knowledge pipeline runs by run type and status',
  labelNames: ['run_type', 'status'],
  registers: [register],
});

export const knowledgePipelineRunDuration = new Histogram({
  name: 'knowledge_pipeline_run_duration_seconds',
  help: 'Knowledge pipeline run duration in seconds',
  labelNames: ['run_type'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

export const knowledgeDocumentsTotal = new Counter({
  name: 'knowledge_documents_total',
  help: 'Knowledge documents processed by source and status',
  labelNames: ['source', 'status'],
  registers: [register],
});

export const knowledgeDocumentsRejectedTotal = new Counter({
  name: 'knowledge_documents_rejected_total',
  help: 'Knowledge documents rejected by source and reason',
  labelNames: ['source', 'reason'],
  registers: [register],
});

export const knowledgeChunksEmbeddedTotal = new Counter({
  name: 'knowledge_chunks_embedded_total',
  help: 'Knowledge chunks embedded and upserted to vector DB',
  labelNames: ['source'],
  registers: [register],
});

export const knowledgeQueueDepth = new Gauge({
  name: 'knowledge_queue_depth',
  help: 'Knowledge pipeline BullMQ queue depth by state',
  labelNames: ['state'],
  registers: [register],
});
