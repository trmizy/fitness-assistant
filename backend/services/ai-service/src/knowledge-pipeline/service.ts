import { logger } from '@gym-coach/shared';
import { KNOWLEDGE_PIPELINE } from './config';
import { listLocalEvidenceDocuments } from './local-evidence';
import {
  knowledgeChunksEmbeddedTotal,
  knowledgeDocumentsRejectedTotal,
  knowledgeDocumentsTotal,
  knowledgePipelineRunDuration,
  knowledgePipelineRunsTotal,
} from './metrics';
import { fetchPubMedDocuments } from './pubmed';
import { embedAndUpsertDocument, findSemanticDuplicateDocument } from './qdrant-writer';
import { knowledgeRepository } from './repository';
import { fetchRssDocuments } from './rss';
import { judgeDocumentSafety } from './safety-judge';
import { processKnowledgeDocument, statusForProcessedDocument } from './scoring';
import { fetchWebDocument } from './web';
import type {
  KnowledgeSource,
  LocalEvidencePipelineOptions,
  LocalEvidencePipelineResult,
  PipelineCounters,
  PubMedPipelineOptions,
  PubMedPipelineResult,
  RawKnowledgeDocument,
  RssPipelineOptions,
  RssPipelineResult,
  WebPipelineOptions,
  WebPipelineResult,
} from './types';

function emptyCounters(): PipelineCounters {
  return {
    crawled: 0,
    accepted: 0,
    rejected: 0,
    review: 0,
    skipped: 0,
    embeddedChunks: 0,
  };
}

async function processRawDocuments(
  source: KnowledgeSource,
  docs: RawKnowledgeDocument[],
  counters: PipelineCounters,
  options: { embed?: boolean; force?: boolean },
): Promise<void> {
  for (const rawDoc of docs) {
    counters.crawled += 1;
    const { id: documentId, inserted } = await knowledgeRepository.insertDocumentIfNew(rawDoc, Boolean(options.force));
    if (!inserted) {
      counters.skipped += 1;
      knowledgeDocumentsTotal.labels(source.id, 'skipped').inc();
      continue;
    }

    let processed = processKnowledgeDocument(rawDoc, source.trustTier);
    if (KNOWLEDGE_PIPELINE.enableLlmSafetyJudge && !processed.safetyFlag) {
      const judge = await judgeDocumentSafety(rawDoc);
      if (judge && !judge.safe) {
        processed = {
          ...processed,
          safetyFlag: true,
          rejectionReason: `llm_safety_${judge.category || 'unknown'}`,
        };
      }
    }
    const gate = statusForProcessedDocument(processed);

    if (gate === 'reject') {
      counters.rejected += 1;
      knowledgeDocumentsTotal.labels(source.id, 'rejected').inc();
      knowledgeDocumentsRejectedTotal.labels(source.id, processed.rejectionReason ?? 'unknown').inc();
      await knowledgeRepository.markProcessed(documentId, processed, 'REJECTED');
      continue;
    }

    if (gate === 'review') {
      counters.review += 1;
      knowledgeDocumentsTotal.labels(source.id, 'review').inc();
      await knowledgeRepository.markProcessed(documentId, processed, 'REVIEW');
      await knowledgeRepository.addReviewItem(documentId, processed.rejectionReason ?? 'trust_score_requires_review');
      continue;
    }

    if (options.embed !== false) {
      const duplicate = await findSemanticDuplicateDocument(documentId, processed);
      if (duplicate) {
        counters.rejected += 1;
        knowledgeDocumentsTotal.labels(source.id, 'rejected').inc();
        knowledgeDocumentsRejectedTotal.labels(source.id, 'semantic_duplicate').inc();
        await knowledgeRepository.markProcessed(
          documentId,
          { ...processed, rejectionReason: `semantic_duplicate:${duplicate.vectorId}` },
          'REJECTED',
        );
        logger.info({ documentId, duplicate }, 'Knowledge document rejected as semantic duplicate');
        continue;
      }
    }

    counters.accepted += 1;
    knowledgeDocumentsTotal.labels(source.id, 'accepted').inc();
    await knowledgeRepository.markProcessed(documentId, processed, 'SCORED');

    if (options.embed !== false) {
      const embeddedChunks = await embedAndUpsertDocument(documentId, processed, source);
      counters.embeddedChunks += embeddedChunks;
      knowledgeChunksEmbeddedTotal.labels(source.id).inc(embeddedChunks);
    }
  }
}

export async function runLocalEvidencePipeline(
  options: LocalEvidencePipelineOptions = {},
): Promise<LocalEvidencePipelineResult> {
  await knowledgeRepository.ensureDefaultSources();
  const source = await knowledgeRepository.findSourceById(KNOWLEDGE_PIPELINE.localEvidenceSourceId);
  if (!source) {
    throw new Error(`Knowledge source not found: ${KNOWLEDGE_PIPELINE.localEvidenceSourceId}`);
  }

  const runId = await knowledgeRepository.createPipelineRun('manual_local_evidence');
  const counters = emptyCounters();
  const endTimer = knowledgePipelineRunDuration.labels('manual_local_evidence').startTimer();

  try {
    const docs = listLocalEvidenceDocuments(options.limit);
    logger.info({ runId, docs: docs.length, embed: options.embed !== false }, 'Knowledge local evidence pipeline started');

    await processRawDocuments(source, docs, counters, options);

    await knowledgeRepository.markSourceCrawled(source.id);
    await knowledgeRepository.finishPipelineRun(runId, 'SUCCESS', counters);
    knowledgePipelineRunsTotal.labels('manual_local_evidence', 'success').inc();
    logger.info({ runId, counters }, 'Knowledge local evidence pipeline finished');
    return { runId, ...counters };
  } catch (err) {
    await knowledgeRepository.finishPipelineRun(runId, 'FAILED', counters);
    knowledgePipelineRunsTotal.labels('manual_local_evidence', 'failed').inc();
    logger.error({ err, runId, counters }, 'Knowledge local evidence pipeline failed');
    throw err;
  } finally {
    endTimer();
  }
}

export async function runPubMedPipeline(
  options: PubMedPipelineOptions = {},
): Promise<PubMedPipelineResult> {
  await knowledgeRepository.ensureDefaultSources();
  const source = await knowledgeRepository.findSourceById(KNOWLEDGE_PIPELINE.pubMedSourceId);
  if (!source) {
    throw new Error(`Knowledge source not found: ${KNOWLEDGE_PIPELINE.pubMedSourceId}`);
  }

  const query = options.query?.trim() || KNOWLEDGE_PIPELINE.pubMedDefaultQuery;
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const runId = await knowledgeRepository.createPipelineRun('manual_pubmed');
  const counters = emptyCounters();
  const endTimer = knowledgePipelineRunDuration.labels('manual_pubmed').startTimer();

  try {
    const docs = await fetchPubMedDocuments({ query, limit });
    logger.info({ runId, query, docs: docs.length, embed: options.embed !== false }, 'Knowledge PubMed pipeline started');

    await processRawDocuments(source, docs, counters, options);

    await knowledgeRepository.markSourceCrawled(source.id);
    await knowledgeRepository.finishPipelineRun(runId, 'SUCCESS', counters);
    knowledgePipelineRunsTotal.labels('manual_pubmed', 'success').inc();
    logger.info({ runId, query, counters }, 'Knowledge PubMed pipeline finished');
    return { runId, query, ...counters };
  } catch (err) {
    await knowledgeRepository.finishPipelineRun(runId, 'FAILED', counters);
    knowledgePipelineRunsTotal.labels('manual_pubmed', 'failed').inc();
    logger.error({ err, runId, query, counters }, 'Knowledge PubMed pipeline failed');
    throw err;
  } finally {
    endTimer();
  }
}

export async function runRssPipeline(
  options: RssPipelineOptions = {},
): Promise<RssPipelineResult> {
  await knowledgeRepository.ensureDefaultSources();
  const sourceId = options.sourceId?.trim() || KNOWLEDGE_PIPELINE.defaultRssSourceId;
  const source = await knowledgeRepository.findSourceById(sourceId);
  if (!source) {
    throw new Error(`Knowledge source not found: ${sourceId}`);
  }
  if (source.sourceType !== 'RSS') {
    throw new Error(`Knowledge source ${sourceId} is ${source.sourceType}, expected RSS`);
  }

  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const runId = await knowledgeRepository.createPipelineRun('manual_rss');
  const counters = emptyCounters();
  const endTimer = knowledgePipelineRunDuration.labels('manual_rss').startTimer();

  try {
    const docs = await fetchRssDocuments({ source, limit });
    logger.info({ runId, sourceId, docs: docs.length, embed: options.embed !== false }, 'Knowledge RSS pipeline started');

    await processRawDocuments(source, docs, counters, options);

    await knowledgeRepository.markSourceCrawled(source.id);
    await knowledgeRepository.finishPipelineRun(runId, 'SUCCESS', counters);
    knowledgePipelineRunsTotal.labels('manual_rss', 'success').inc();
    logger.info({ runId, sourceId, counters }, 'Knowledge RSS pipeline finished');
    return { runId, sourceId, ...counters };
  } catch (err) {
    await knowledgeRepository.finishPipelineRun(runId, 'FAILED', counters);
    knowledgePipelineRunsTotal.labels('manual_rss', 'failed').inc();
    logger.error({ err, runId, sourceId, counters }, 'Knowledge RSS pipeline failed');
    throw err;
  } finally {
    endTimer();
  }
}

export async function runWebPipeline(
  options: WebPipelineOptions = {},
): Promise<WebPipelineResult> {
  await knowledgeRepository.ensureDefaultSources();
  const sourceId = options.sourceId?.trim() || KNOWLEDGE_PIPELINE.defaultWebSourceId;
  const source = await knowledgeRepository.findSourceById(sourceId);
  if (!source) {
    throw new Error(`Knowledge source not found: ${sourceId}`);
  }
  if (source.sourceType !== 'WEB') {
    throw new Error(`Knowledge source ${sourceId} is ${source.sourceType}, expected WEB`);
  }

  const runId = await knowledgeRepository.createPipelineRun('manual_web');
  const counters = emptyCounters();
  const endTimer = knowledgePipelineRunDuration.labels('manual_web').startTimer();

  try {
    const docs = await fetchWebDocument(source);
    logger.info({ runId, sourceId, docs: docs.length, embed: options.embed !== false }, 'Knowledge web pipeline started');

    await processRawDocuments(source, docs, counters, options);

    await knowledgeRepository.markSourceCrawled(source.id);
    await knowledgeRepository.finishPipelineRun(runId, 'SUCCESS', counters);
    knowledgePipelineRunsTotal.labels('manual_web', 'success').inc();
    logger.info({ runId, sourceId, counters }, 'Knowledge web pipeline finished');
    return { runId, sourceId, ...counters };
  } catch (err) {
    await knowledgeRepository.finishPipelineRun(runId, 'FAILED', counters);
    knowledgePipelineRunsTotal.labels('manual_web', 'failed').inc();
    logger.error({ err, runId, sourceId, counters }, 'Knowledge web pipeline failed');
    throw err;
  } finally {
    endTimer();
  }
}
