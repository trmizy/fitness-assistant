import type { RetrievalDocument } from "./types";

/**
 * Chat retrieval ranking (legacy V1 path, retriever.retrieveForChat). Pure and offline-testable.
 *
 * Problem (Qdrant :6340, 2026-11-11): fitness_faq holds 5.946 rows, most of them generated from the exercise catalog by a
 * template ("Nên tập X bao nhiêu set và rep?" → "Với mục tiêu tăng cơ, X thường hợp khoảng 8-20 reps. Nếu ưu tiên sức mạnh,
 * thử…"), against 87 rows of curated fitness_evidence. Pure cosine top-K let near-identical template rows crowd out
 * evidence, and the model copied them verbatim ("Plank … 8-20 hoặc 20-60 giây reps", eval B1-21; reps instead of weekly
 * sets, B2-49). Now:
 *  - template rows are tagged `metadata.synthetic = true` (rendered as such in the prompt) and slightly down-weighted;
 *  - curated evidence is slightly up-weighted;
 *  - near-duplicates (same template, different exercise) collapse to one;
 *  - at most MAX_SYNTHETIC template rows survive.
 * Collections are not modified or rebuilt.
 */
export const MAX_SYNTHETIC = 1;
const SYNTHETIC_PENALTY = 0.08;
const EVIDENCE_BONUS = 0.05;
const NEAR_DUPLICATE_JACCARD = 0.6;

const TEMPLATE_FAQ = [
  /Với mục tiêu tăng cơ, .{2,80} thường hợp khoảng/i,
  /Nếu ưu tiên sức mạnh, thử .{1,40}; nếu ưu tiên sức bền/i,
  /Nên tập .{2,80} bao nhiêu set và rep\?/i,
  /giữ tempo gợi ý \d-\d-\d-\d/i,
];

export function isTemplateGenerated(doc: RetrievalDocument): boolean {
  if (doc.source !== "qdrant:fitness_faq" && doc.source !== "qdrant:fitness_knowledge" && !/fitness_faq|fitness_knowledge/.test(doc.source)) return false;
  return TEMPLATE_FAQ.some((re) => re.test(doc.pageContent));
}

function shingles(text: string): Set<string> {
  const w = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(" "));
  return s;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let x = 0;
  for (const v of a) if (b.has(v)) x++;
  return x / (a.size + b.size - x);
}

export function rankChatDocuments(docs: RetrievalDocument[], topK: number): RetrievalDocument[] {
  const byId = new Map<string, RetrievalDocument>();
  for (const d of docs) {
    const e = byId.get(d.id);
    if (!e || e.score < d.score) byId.set(d.id, d);
  }
  const scored = [...byId.values()].map((d) => {
    const synthetic = isTemplateGenerated(d);
    const evidence = /fitness_evidence/.test(d.source);
    const adjusted = d.score - (synthetic ? SYNTHETIC_PENALTY : 0) + (evidence ? EVIDENCE_BONUS : 0);
    return { doc: synthetic ? { ...d, metadata: { ...d.metadata, synthetic: true } } : d, adjusted, synthetic, sh: shingles(d.pageContent) };
  });
  scored.sort((a, b) => b.adjusted - a.adjusted);
  const kept: typeof scored = [];
  let synth = 0;
  for (const s of scored) {
    if (s.synthetic && synth >= MAX_SYNTHETIC) continue;
    if (kept.some((k) => jaccard(k.sh, s.sh) >= NEAR_DUPLICATE_JACCARD)) continue;
    kept.push(s);
    if (s.synthetic) synth++;
    if (kept.length >= topK) break;
  }
  return kept.map((k) => k.doc);
}
