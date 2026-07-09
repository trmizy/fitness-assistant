import fs from 'fs';
import path from 'path';
import type { NormalizedResearchRecord, ReviewQueueRecord } from '../types';

const REVIEW_QUEUE_PATH = path.resolve(process.cwd(), '../../../data/research_review_queue.jsonl');

export function shouldRequireReview(record: NormalizedResearchRecord): boolean {
  if (record.source.toLowerCase().includes('web')) return true;
  if ((record.evidence_score ?? 0) < 0.55) return true;
  if (!record.source_url || !record.title) return true;
  if (!record.pmid && !record.doi && record.source !== 'OpenAlex') return true;
  return false;
}

export function toReviewQueueRecord(record: NormalizedResearchRecord): ReviewQueueRecord {
  return {
    status: shouldRequireReview(record) ? 'pending' : 'approved',
    reason: shouldRequireReview(record) ? 'requires_manual_review' : 'metadata_complete_auto_approved',
    source_metadata: record,
    preview_text: record.abstract_or_summary.slice(0, 500),
    created_at: new Date().toISOString(),
  };
}

export function appendReviewQueue(records: ReviewQueueRecord[], filePath = REVIEW_QUEUE_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join('\n');
  if (lines) fs.appendFileSync(filePath, `${lines}\n`, 'utf8');
}

export function readApprovedReviewRecords(filePath = REVIEW_QUEUE_PATH): NormalizedResearchRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReviewQueueRecord)
    .filter((record) => record.status === 'approved' || record.status === 'indexed')
    .map((record) => record.source_metadata);
}
