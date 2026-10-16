/**
 * Phase 4.6 — explicit source classes + provenance for retrieved knowledge
 * (docs/ai-product/phase4-6-rag-grounding-hardening.md).
 *
 * Pure, no I/O. The class is decided from ingestion identity + payload facts,
 * not from a collection name alone, and is what lets the generator context
 * (and a later "nguồn nào?" answer) tell scientific evidence from internal
 * reference text, synthetic FAQ and the exercise catalog.
 */

export type SourceClass =
  | "CURATED_EVIDENCE"      // peer-reviewed paper / position stand / government or clinical guideline (fitness_evidence)
  | "CURATED_REFERENCE"     // curated but not scientific evidence: practitioner methods, unknown-level web (fitness_evidence)
  | "SYNTHETIC_KNOWLEDGE"   // generated catalog text: fitness_knowledge, fitness_faq (source_group=synthetic_knowledge)
  | "CATALOG"               // exercise catalog rows (exercises)
  | "OTHER";

/** how far a bibliographic field can be trusted (Phase 4.7R) */
export type ProvenanceState = "VERIFIED" | "SOURCE_PROVIDED" | "INGESTION_DERIVED" | "UNKNOWN";

export interface RetrievedKnowledgeSource {
  sourceClass: SourceClass;
  sourceId: string | null;
  title: string | null;
  /** a real publisher/organisation only — never the collector ("PubMed E-utilities", "Curated Local Evidence JSONL") */
  publisher: string | null;
  /** publication year ONLY when yearProvenance === "VERIFIED"; an unverified pipeline date is never exposed here */
  year: number | null;
  url: string | null;
  section: string | null;
  /** true for generated content that must never be presented as research */
  synthetic: boolean;
  evidenceLevel: string | null;
  yearProvenance?: ProvenanceState;
  publisherProvenance?: ProvenanceState;
  /** the ingestion channel (feed / API / local dataset) — kept for audit, never rendered as a publisher */
  collectedVia?: string | null;
}

const SCIENTIFIC_LEVELS = new Set([
  "peer_reviewed", "systematic_review", "primary_research", "government_guideline", "clinical_guideline", "expert_consensus",
]);

const PRACTITIONER_LEVELS = new Set(["practitioner_consensus", "practitioner_synthesis", "professional_source", "practitioner"]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const yearInRange = (y: number) => Number.isFinite(y) && y >= 1950 && y <= 2100;

/**
 * Publication year with provenance (Phase 4.7R). Only a year the source itself states is exposed as `year`:
 *   VERIFIED         — the bibliographic parenthetical in the curated title ("(Guest et al. 2021)", "(2017)"), or a
 *                      feed `published_at` that the source URL independently corroborates (".../releases/2026/05/...")
 *   SOURCE_PROVIDED  — a pipeline `published_at` nothing corroborates (PubMed month-granular dates are written as the
 *                      first of the month): kept in `unverifiedYear`, NOT rendered as a publication year
 *   INGESTION_DERIVED— the date equals the collection/ingestion timestamp
 *   UNKNOWN          — nothing usable
 */
export function resolveYear(payload: Record<string, unknown>): { year: number | null; state: ProvenanceState; unverifiedYear: number | null } {
  const title = str(payload.title) ?? "";
  const tm = /\((?:[^()]*?\b)?((?:19|20)\d{2})\)/.exec(title) ?? /\b((?:19|20)\d{2})\b/.exec(title);
  const titleYear = tm ? Number(tm[1]) : NaN;
  if (yearInRange(titleYear)) return { year: titleYear, state: "VERIFIED", unverifiedYear: null };

  const published = str(payload.published_at);
  const pubYear = published ? Number(published.slice(0, 4)) : NaN;
  if (published && yearInRange(pubYear)) {
    const ingested = [payload.ingested_at, payload.created_at, payload.indexed_at].map(str).filter(Boolean) as string[];
    if (ingested.some((d) => d.slice(0, 10) === published.slice(0, 10))) return { year: null, state: "INGESTION_DERIVED", unverifiedYear: pubYear };
    const where = `${str(payload.source_url) ?? ""} ${str(payload.source_file) ?? ""}`;
    if (new RegExp(`(?:/|=|-|_)${pubYear}(?:/|-|_|\\b)`).test(where)) return { year: pubYear, state: "VERIFIED", unverifiedYear: null };
    return { year: null, state: "SOURCE_PROVIDED", unverifiedYear: pubYear };
  }
  return { year: null, state: "UNKNOWN", unverifiedYear: null };
}

/** Names that identify HOW a document was collected, not who published it. */
const COLLECTOR_NAME = /(e-?utilities|jsonl|\brss\b|pipeline|crawler|scraper|\bfeed\b|dataset|import)/i;

export function resolvePublisher(payload: Record<string, unknown>): { publisher: string | null; state: ProvenanceState; collectedVia: string | null } {
  const explicit = str(payload.publisher);
  if (explicit) return { publisher: explicit, state: "SOURCE_PROVIDED", collectedVia: str(payload.source_name) };
  const name = str(payload.source_name);
  if (!name) return { publisher: null, state: "UNKNOWN", collectedVia: null };
  if (COLLECTOR_NAME.test(name)) return { publisher: null, state: "INGESTION_DERIVED", collectedVia: name };
  return { publisher: name, state: "SOURCE_PROVIDED", collectedVia: name };
}

/** Last path segment without extension, e.g. data/processed/evidence/issn-protein-2017.jsonl → issn-protein-2017 */
function fileStem(p: string | null): string | null {
  if (!p) return null;
  const base = p.split(/[\\/]/).pop() ?? p;
  return base.replace(/\.[a-z0-9]+$/i, "") || null;
}

export function classifySource(collection: string, payload: Record<string, unknown>): SourceClass {
  if (collection === "exercises") return "CATALOG";
  if (collection === "fitness_knowledge" || collection === "fitness_faq") return "SYNTHETIC_KNOWLEDGE";
  if (collection === "fitness_evidence") {
    const sourceType = str(payload.source_type) ?? "";
    const level = str(payload.evidence_level) ?? "unknown";
    const createdFrom = str(payload.created_from) ?? "";
    if (sourceType === "coach_public_method" || createdFrom === "training_methods_manual_dataset") return "CURATED_REFERENCE";
    // internal coach guidance / practitioner synthesis is curated but NOT research, even when stored as a "curated_summary"
    if (PRACTITIONER_LEVELS.has(level)) return "CURATED_REFERENCE";
    if (SCIENTIFIC_LEVELS.has(level)) return "CURATED_EVIDENCE";
    if (sourceType === "paper" || sourceType === "curated_summary") return level === "unknown" ? "CURATED_REFERENCE" : "CURATED_EVIDENCE";
    return "CURATED_REFERENCE";
  }
  return "OTHER";
}

export function buildKnowledgeSource(collection: string, payload: Record<string, unknown>, pointId: string): RetrievedKnowledgeSource {
  const sourceClass = classifySource(collection, payload);
  const synthetic = sourceClass === "SYNTHETIC_KNOWLEDGE";
  if (collection === "fitness_evidence") {
    const chunkId = str(payload.chunk_id);
    const y = resolveYear(payload);
    const p = resolvePublisher(payload);
    return {
      sourceClass,
      sourceId: str(payload.document_id) ?? str(payload.method_id) ?? (chunkId ? chunkId.replace(/-chunk-\d+$/i, "") : null) ?? fileStem(str(payload.source_file)),
      title: str(payload.title),
      publisher: p.publisher,
      publisherProvenance: p.state,
      collectedVia: p.collectedVia,
      year: y.year,
      yearProvenance: y.state,
      url: (() => { const u = str(payload.source_url); return u && /^https?:\/\//i.test(u) ? u : null; })(),
      section: str(payload.section) ?? str(payload.heading),
      synthetic: false,
      evidenceLevel: str(payload.evidence_level),
    };
  }
  if (collection === "exercises") {
    return { sourceClass, sourceId: String(payload.id ?? pointId), title: str(payload.exerciseName), publisher: null, year: null, url: null, section: null, synthetic: false, evidenceLevel: null };
  }
  return {
    sourceClass,
    sourceId: str(payload.docId) ?? str(payload.faqId) ?? String(payload.id ?? pointId),
    title: str(payload.titleVi) ?? str(payload.questionVi),
    publisher: null, year: null, url: null, section: str(payload.category), synthetic, evidenceLevel: null,
  };
}

// ── Phase 4.6: the small structured context the generator receives ───────────

export interface KnowledgeContextItem {
  /** the passage that supports a claim — trimmed, never a raw payload */
  claimSupportText: string;
  source: RetrievedKnowledgeSource;
  relevance: "PRIMARY" | "SECONDARY";
  domain: string | null;
}

interface DocLike { pageContent: string; metadata: Record<string, unknown> }

export function stripEvidenceHeader(text: string): string {
  const lines = text.split("\n");
  // retrievalDocumentFromPayload: "[source_type] title" / "Category: … | Evidence level: …" / content
  if (lines.length >= 3 && /^Category: /.test(lines[1])) return lines.slice(2).join(" ").trim();
  return text.replace(/^(Title|Q): /, "").trim();
}

export function buildKnowledgeContext(docs: DocLike[]): KnowledgeContextItem[] {
  const items: KnowledgeContextItem[] = [];
  for (const d of docs) {
    const source = d.metadata.knowledgeSource as RetrievedKnowledgeSource | undefined;
    if (!source) continue;
    const domains = d.metadata.knowledgeDomains as string[] | undefined;
    items.push({
      claimSupportText: stripEvidenceHeader(d.pageContent),
      source,
      relevance: d.metadata.knowledgeRelevance === "PRIMARY" ? "PRIMARY" : "SECONDARY",
      domain: domains?.[0] ?? null,
    });
  }
  return items;
}

function cite(s: RetrievedKnowledgeSource): string {
  const who = [s.title, [s.publisher, s.year].filter(Boolean).join(", ")].filter((x) => x && String(x).length).join(" — ");
  const ref = s.url ? ` [nguồn: ${s.url}]` : s.sourceId ? ` [mã nguồn: ${s.sourceId}]` : "";
  return `${who}${ref}`;
}

/** Labelled blocks: scientific evidence is distinguishable from internal reference, synthetic fallback and the exercise catalog. */
export function renderKnowledgeContext(items: KnowledgeContextItem[], conflict?: { sources: Array<{ title: string | null; range: [number, number] }>; unit: string } | null): string {
  const by = (c: SourceClass) => items.filter((i) => i.source.sourceClass === c);
  const blocks: string[] = [];
  const ev = by("CURATED_EVIDENCE");
  if (ev.length) blocks.push(`[Bằng chứng khoa học (nguồn có thể trích dẫn):]\n${ev.map((i, n) => `E${n + 1}. ${cite(i.source)}\n${i.claimSupportText}`).join("\n\n")}`);
  if (conflict) {
    blocks.push(`[Lưu ý: các nguồn khoa học dưới đây đưa số liệu khác nhau (${conflict.unit}) — hãy nêu cả hai kèm bối cảnh, không tự chọn một:]\n${conflict.sources.map((s) => `- ${s.title ?? "nguồn"}: ${s.range[0]}–${s.range[1]} ${conflict.unit}`).join("\n")}`);
  }
  const ref = by("CURATED_REFERENCE");
  if (ref.length) blocks.push(`[Phương pháp/tài liệu tham khảo chuyên môn — không phải kết quả nghiên cứu:]\n${ref.map((i, n) => `R${n + 1}. ${i.source.title ?? ""}\n${i.claimSupportText}`).join("\n\n")}`);
  const syn = by("SYNTHETIC_KNOWLEDGE");
  if (syn.length) blocks.push(`[Tài liệu tham khảo nội bộ của Gymini — KHÔNG phải nghiên cứu khoa học, không trích dẫn như bằng chứng:]\n${syn.map((i, n) => `S${n + 1}. ${i.claimSupportText}`).join("\n\n")}`);
  const cat = by("CATALOG");
  if (cat.length) blocks.push(`[Danh mục bài tập (dữ liệu tham chiếu, không phải bằng chứng):]\n${cat.map((i, n) => `C${n + 1}. ${i.claimSupportText}`).join("\n\n")}`);
  return blocks.join("\n\n");
}
