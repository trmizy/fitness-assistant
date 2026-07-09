import crypto from 'crypto';
import type { NormalizedResearchRecord } from '../types';

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export function normalizeResearchRecord(record: NormalizedResearchRecord): NormalizedResearchRecord {
  const text = [record.title, record.abstract_or_summary].filter(Boolean).join('\n');
  const hash = contentHash(text);
  return {
    ...record,
    title: record.title.trim(),
    abstract_or_summary: record.abstract_or_summary.replace(/\s+/g, ' ').trim(),
    doi: record.doi?.trim().toLowerCase(),
    pmid: record.pmid?.trim(),
    retrieved_at: record.retrieved_at || record.fetched_at,
    checksum: record.checksum || hash,
    content_hash: record.content_hash || hash,
  };
}
