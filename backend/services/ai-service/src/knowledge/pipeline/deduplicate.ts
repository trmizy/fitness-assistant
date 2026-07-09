import type { NormalizedResearchRecord } from '../types';
import { normalizeTitle } from './normalize';

export function deduplicateResearchRecords(records: NormalizedResearchRecord[]): NormalizedResearchRecord[] {
  const seen = new Set<string>();
  const output: NormalizedResearchRecord[] = [];
  for (const record of records) {
    const keys = [
      record.doi ? `doi:${record.doi.toLowerCase()}` : '',
      record.pmid ? `pmid:${record.pmid}` : '',
      record.content_hash ? `hash:${record.content_hash}` : '',
      `title:${normalizeTitle(record.title)}`,
    ].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    output.push(record);
  }
  return output;
}
