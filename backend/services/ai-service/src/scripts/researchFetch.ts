import path from "path";
import { enabledResearchSources } from "../knowledge/source_registry";
import { selectedResearchTopics } from "../knowledge/research_topics";
import { connectorRegistry, writeJsonl } from "../knowledge/connectors";
import {
  connectorTimeoutMs,
  researchUserAgent,
} from "../knowledge/connectors/connector.interface";
import { normalizeResearchRecord } from "../knowledge/pipeline/normalize";
import { deduplicateResearchRecords } from "../knowledge/pipeline/deduplicate";
import { scoreEvidence } from "../knowledge/pipeline/evidence_score";
import {
  appendReviewQueue,
  toReviewQueueRecord,
} from "../knowledge/pipeline/review_queue";
import type { NormalizedResearchRecord } from "../knowledge/types";

function readLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const maxResults = readLimit("RESEARCH_MAX_RESULTS_PER_TOPIC", 5);
  const topicLimit = readLimit("RESEARCH_TOPIC_LIMIT", 3);
  const timeoutMs = connectorTimeoutMs();
  const userAgent = researchUserAgent();
  const contactEmail =
    process.env.RESEARCH_CONTACT_EMAIL || process.env.CROSSREF_MAILTO;
  const topics = selectedResearchTopics(topicLimit);
  const sources = enabledResearchSources();
  const rawRecords: NormalizedResearchRecord[] = [];

  for (const topic of topics) {
    const sourceIds = topic.source_preferences.filter((sourceId) =>
      sources.some((source) => source.id === sourceId),
    );
    for (const sourceId of sourceIds) {
      const source = sources.find((item) => item.id === sourceId);
      const connector = connectorRegistry[sourceId];
      if (!source || !connector) continue;
      const records = await connector.fetch({
        topic,
        source,
        maxResults: Math.min(topic.max_results, maxResults),
        timeoutMs,
        userAgent,
        contactEmail,
      });
      rawRecords.push(...records);
    }
  }

  const normalized = deduplicateResearchRecords(
    rawRecords.map(normalizeResearchRecord).map(scoreEvidence),
  );
  const rawPath = path.resolve(
    process.cwd(),
    "../../../data/research/raw/latest.jsonl",
  );
  const normalizedPath = path.resolve(
    process.cwd(),
    "../../../data/research/normalized/latest.jsonl",
  );
  writeJsonl(rawPath, rawRecords);
  writeJsonl(normalizedPath, normalized);
  appendReviewQueue(normalized.map(toReviewQueueRecord));

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        rawRecords: rawRecords.length,
        normalizedRecords: normalized.length,
        rawPath,
        normalizedPath,
        reviewQueue: "data/research_review_queue.jsonl",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("FAIL knowledge:research:fetch");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
