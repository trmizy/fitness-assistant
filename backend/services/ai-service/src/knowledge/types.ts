export type ResearchSourceType = "api" | "webpage" | "manual_dataset";
export type AllowedContent =
  | "metadata_only"
  | "abstract"
  | "open_full_text"
  | "manual_summary";
export type TrustLevel = "high" | "medium" | "low";

export interface ResearchSource {
  id: string;
  name: string;
  type: ResearchSourceType;
  enabled: boolean;
  base_url: string;
  topics: string[];
  trust_level: TrustLevel;
  rate_limit_per_minute: number;
  requires_api_key: boolean;
  robots_policy_required: boolean;
  allowed_content: AllowedContent;
  notes: string;
}

export interface ResearchTopic {
  id: string;
  query: string;
  priority: number;
  max_results: number;
  min_year?: number;
  source_preferences: string[];
}

export interface NormalizedResearchRecord {
  external_id: string;
  title: string;
  abstract_or_summary: string;
  source: string;
  source_url: string;
  doi?: string;
  pmid?: string;
  authors?: string[];
  journal?: string;
  publisher?: string;
  year?: number;
  date?: string;
  license?: string;
  access_status?: string;
  topic: string;
  raw_metadata: Record<string, unknown>;
  fetched_at: string;
  retrieved_at?: string;
  checksum?: string;
  content_hash?: string;
  source_type?: string;
  evidence_score?: number;
  evidence_score_reason?: string[];
}

export interface ResearchConnectorFetchOptions {
  topic: ResearchTopic;
  source: ResearchSource;
  maxResults: number;
  timeoutMs: number;
  userAgent: string;
  contactEmail?: string;
}

export interface ResearchConnector {
  id: string;
  fetch(
    options: ResearchConnectorFetchOptions,
  ): Promise<NormalizedResearchRecord[]>;
}

export interface ReviewQueueRecord {
  status: "pending" | "approved" | "rejected" | "indexed";
  reason: string;
  source_metadata: NormalizedResearchRecord;
  preview_text: string;
  created_at: string;
  reviewed_at?: string;
}

export interface ResearchChunk {
  id: string;
  text: string;
  metadata: NormalizedResearchRecord & {
    chunk_id: string;
    content_hash: string;
  };
}
