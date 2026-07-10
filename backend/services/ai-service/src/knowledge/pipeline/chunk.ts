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
