import path from 'path';
import { readNormalizedJsonl } from '../knowledge/connectors';
import { readApprovedReviewRecords } from '../knowledge/pipeline/review_queue';
import { deduplicateResearchRecords } from '../knowledge/pipeline/deduplicate';
import { indexResearchRecordsToQdrant } from '../knowledge/pipeline/index_to_qdrant';

async function main(): Promise<void> {
  const normalizedPath = process.env.RESEARCH_NORMALIZED_PATH || path.resolve(process.cwd(), '../../../data/research/normalized/latest.jsonl');
  const normalized = readNormalizedJsonl(normalizedPath);
  const approved = readApprovedReviewRecords();
  const records = deduplicateResearchRecords([...normalized.filter((record) => (record.evidence_score ?? 0) >= 0.65), ...approved]);
  if (records.length === 0) throw new Error('No approved or high-confidence normalized research records to index.');

  const result = await indexResearchRecordsToQdrant(records);
  console.log(JSON.stringify({ status: 'PASS', records: records.length, ...result }, null, 2));
}

main().catch((err) => {
  console.error('FAIL knowledge:research:index');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
