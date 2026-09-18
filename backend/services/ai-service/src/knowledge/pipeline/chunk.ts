/**
 * DEPRECATED as an ingestion/chunking mechanism — do not add new callers.
 *
 * This is a hard 1200-char slice with NO overlap and NO sentence/word-
 * boundary snapping, so chunks routinely start/end mid-word and lose
 * context at boundaries. It writes into the same Qdrant collection
 * (`fitness_evidence`) as the production-wired chunker, which makes this
 * a second, lower-quality ingestion path rather than a distinct feature.
 *
 * Use `../../knowledge-pipeline/chunking.ts` (`chunkText`) instead — it
 * chunks with 160-char overlap and snaps both chunk ends and the next
 * chunk's start to a real word/sentence boundary (see the regression
 * test `src/__tests__/chunking.test.ts`). That module is the one wired
 * into the production BullMQ worker (`knowledge-pipeline/worker.ts`) via
 * `routes/internal.routes.ts`.
 *
 * Kept in place (not deleted) only because `scripts/researchIndex.ts`
 * still calls the sibling `index_to_qdrant.ts`, which depends on this
 * file, and that CLI script may still be relied on externally
 * (`ENABLE_RESEARCH_AUTOMATION` / `researchScheduler.ts`). See
 * `docs/ai-agent-system-feasibility-audit.md` section 1.3 ("Two
 * competing ingestion pipelines") for the full analysis, and
 * `src/knowledge/README.md` for the consolidation decision.
 */
import type { NormalizedResearchRecord, ResearchChunk } from "../types";
import { contentHash } from "./normalize";

export function chunkResearchRecord(
  record: NormalizedResearchRecord,
  maxChars = 1200,
): ResearchChunk[] {
  const text = [record.title, record.abstract_or_summary]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];
  const chunks: ResearchChunk[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    const part = text.slice(offset, offset + maxChars).trim();
    if (!part) continue;
    const hash = contentHash(`${record.external_id}:${offset}:${part}`);
    const chunkId = `${record.external_id}:${chunks.length}`.replace(
      /[^a-zA-Z0-9:_-]/g,
      "_",
    );
    chunks.push({
      id: `fitness_evidence_${hash.slice(0, 32)}`,
      text: part,
      metadata: {
        ...record,
        chunk_id: chunkId,
        content_hash: hash,
      },
    });
  }
  return chunks;
}
