// NOTE: this script's index step (`indexResearchRecordsToQdrant`) uses the
// DEPRECATED `knowledge/pipeline/chunk.ts` + `index_to_qdrant.ts` path — a
// cruder, no-overlap chunker that also bypasses the production
// trust-scoring/safety-judge gate (`knowledge-pipeline/scoring.ts` +
// `safety-judge.ts`). It is kept working here only because
// `ENABLE_RESEARCH_AUTOMATION` / `researchScheduler.ts` may still depend on
// it externally. See `docs/ai-agent-system-feasibility-audit.md` section 1.3
// and `src/knowledge/README.md` for the consolidation decision and the
// recommended replacement (reshape approved records into
// `data/processed/evidence/*.jsonl` and run `runLocalEvidencePipeline()` /
// `POST /internal/knowledge/local-evidence` instead).
import path from "path";
import { readNormalizedJsonl } from "../knowledge/connectors";
import { readApprovedReviewRecords } from "../knowledge/pipeline/review_queue";
import { deduplicateResearchRecords } from "../knowledge/pipeline/deduplicate";
import { indexResearchRecordsToQdrant } from "../knowledge/pipeline/index_to_qdrant";

async function main(): Promise<void> {
  const normalizedPath =
    process.env.RESEARCH_NORMALIZED_PATH ||
    path.resolve(
      process.cwd(),
      "../../../data/research/normalized/latest.jsonl",
    );
  const normalized = readNormalizedJsonl(normalizedPath);
  const approved = readApprovedReviewRecords();
  const records = deduplicateResearchRecords([
    ...normalized.filter((record) => (record.evidence_score ?? 0) >= 0.65),
    ...approved,
  ]);
  if (records.length === 0)
    throw new Error(
      "No approved or high-confidence normalized research records to index.",
    );

  const result = await indexResearchRecordsToQdrant(records);
  console.log(
    JSON.stringify(
      { status: "PASS", records: records.length, ...result },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("FAIL knowledge:research:index");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
