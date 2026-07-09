import path from 'path';
import { readNormalizedJsonl } from '../knowledge/connectors';
import { deduplicateResearchRecords } from '../knowledge/pipeline/deduplicate';

async function main(): Promise<void> {
  const normalizedPath = process.env.RESEARCH_NORMALIZED_PATH || path.resolve(process.cwd(), '../../../data/research/normalized/latest.jsonl');
  const records = deduplicateResearchRecords(readNormalizedJsonl(normalizedPath));
  const withTitle = records.filter((record) => record.title);
  const withUrl = records.filter((record) => record.source_url);
  const withStableId = records.filter((record) => record.doi || record.pmid || record.external_id);
  const highScore = records.filter((record) => (record.evidence_score ?? 0) >= 0.65);
  const topics = Array.from(new Set(records.map((record) => record.topic))).sort();

  console.log(JSON.stringify({
    status: records.length > 0 ? 'PASS' : 'WARN',
    mode: 'offline-eval',
    normalizedPath,
    records: records.length,
    coverage: {
      title: records.length ? withTitle.length / records.length : 0,
      sourceUrl: records.length ? withUrl.length / records.length : 0,
      stableId: records.length ? withStableId.length / records.length : 0,
      highEvidenceScore: records.length ? highScore.length / records.length : 0,
    },
    topics,
    note: records.length > 0 ? 'Run ai:eval:retrieval after indexing to measure Qdrant retrieval quality.' : 'No normalized research records found; run knowledge:research:fetch first.',
  }, null, 2));
}

main().catch((err) => {
  console.error('FAIL knowledge:research:eval');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
