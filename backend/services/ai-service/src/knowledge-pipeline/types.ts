export type KnowledgeSourceType = 'RSS' | 'API' | 'WEB' | 'LOCAL';
export type KnowledgeDocumentTopic =
  | 'TRAINING'
  | 'NUTRITION'
  | 'RECOVERY'
  | 'INJURY'
  | 'BODY_COMPOSITION'
  | 'GENERAL';
export type KnowledgeDocumentStatus = 'CRAWLED' | 'CLEANED' | 'SCORED' | 'EMBEDDED' | 'REJECTED' | 'REVIEW';

export type KnowledgeSource = {
  id: string;
  name: string;
  baseUrl: string;
  sourceType: KnowledgeSourceType;
  trustTier: number;
  isActive: boolean;
};

export type RawKnowledgeDocument = {
  sourceId: string;
  url: string;
  title: string;
  author?: string | null;
  language: string;
  contentHash: string;
  rawObjectKey: string;
  cleanText: string;
  sourceFile: string;
  sourceType?: string;
  evidenceLevel?: string;
  tags: string[];
  publishedAt?: Date | null;
};

export type ProcessedKnowledgeDocument = RawKnowledgeDocument & {
  topic: KnowledgeDocumentTopic;
  trustScore: number;
  qualityScore: number;
  safetyFlag: boolean;
  rejectionReason?: string | null;
};

export type PipelineCounters = {
  crawled: number;
  accepted: number;
  rejected: number;
  review: number;
  skipped: number;
  embeddedChunks: number;
};

export type LocalEvidencePipelineOptions = {
  limit?: number;
  embed?: boolean;
  force?: boolean;
};

export type PubMedPipelineOptions = {
  query?: string;
  limit?: number;
  embed?: boolean;
  force?: boolean;
};

export type RssPipelineOptions = {
  sourceId?: string;
  limit?: number;
  embed?: boolean;
  force?: boolean;
};

export type WebPipelineOptions = {
  sourceId?: string;
  embed?: boolean;
  force?: boolean;
};

export type LocalEvidencePipelineResult = PipelineCounters & {
  runId: string;
};

export type PubMedPipelineResult = PipelineCounters & {
  runId: string;
  query: string;
};

export type RssPipelineResult = PipelineCounters & {
  runId: string;
  sourceId: string;
};

export type WebPipelineResult = PipelineCounters & {
  runId: string;
  sourceId: string;
};
