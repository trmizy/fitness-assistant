/**
 * RAG ingest core (M9.6-T5) — PURE: reads the local source files and builds the documents that would be embedded and upserted. No network, no AWS, no embedding call, no vector-store
 * import. Everything the AWS window needs to decide on (which documents, which ids, how many tokens, what it costs) is computed here and written to a manifest, so it can be reviewed
 * BEFORE any resource is started.
 *
 * Four datasets → four indexes:
 *   exercises  → exercises          data/processed/rag/exercises.csv                  project exercise catalogue                      (retriever class CATALOG)
 *   knowledge  → fitness_knowledge  data/catalog/rag/gym_rag_master_dataset.csv       PROJECT-AUTHORED SYNTHETIC domain dataset       (retriever class SYNTHETIC_KNOWLEDGE)
 *   faq        → fitness_faq        data/catalog/qa/gym_faq_qa.csv                    synthetic FAQ (source_group=synthetic_knowledge) (retriever class SYNTHETIC_KNOWLEDGE)
 *   evidence   → fitness_evidence   data/processed/evidence/*.jsonl                   curated SUMMARIES that cite a source URL
 * HONESTY: the knowledge / faq data is generated domain knowledge (data/README_vi.txt says so); it is NOT scientific evidence and nothing here labels it as such. The evidence chunks are
 * project-written summaries with a `source_url`; they have NOT been independently checked against the cited papers by this pipeline.
 *
 * Stable ids: `id = UUID derived from sha256(dataset \0 key)` — independent of file order, `--limit`, run time and content, so a re-ingest overwrites the same document instead of adding a
 * duplicate (the key is the document's own identifier: exercise name, doc_id, faq_id, chunk id). A UUID is valid for Qdrant and for OpenSearch `_id` alike. The content hash is stored
 * separately so a changed document is detectable.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type DatasetName = "exercises" | "knowledge" | "faq" | "evidence";
export type IngestProfile = "demo" | "full";
export const ALL_DATASETS: readonly DatasetName[] = ["exercises", "knowledge", "faq", "evidence"];
export const INDEX_OF: Readonly<Record<DatasetName, string>> = { exercises: "exercises", knowledge: "fitness_knowledge", faq: "fitness_faq", evidence: "fitness_evidence" };
export const SOURCE_PATH: Readonly<Record<DatasetName, string>> = {
  exercises: "data/processed/rag/exercises.csv",
  knowledge: "data/catalog/rag/gym_rag_master_dataset.csv",
  faq: "data/catalog/qa/gym_faq_qa.csv",
  evidence: "data/processed/evidence",
};
/** The legacy `--collection=` names (and the legacy "all" = the three CSV collections, evidence was never part of it). */
export const LEGACY_COLLECTION_TO_DATASET: Readonly<Record<string, DatasetName>> = { exercises: "exercises", fitness_knowledge: "knowledge", fitness_faq: "faq", fitness_evidence: "evidence" };

export interface IngestDoc {
  dataset: DatasetName;
  index: string;
  /** the document's own identifier in its source (exercise name / doc_id / faq_id / chunk id) */
  key: string;
  /** deterministic UUID — see header */
  id: string;
  /** the exact text that is embedded */
  text: string;
  payload: Record<string, unknown>;
  /** sha256 of the embedded text + the payload (changes when the document changes) */
  contentHash: string;
  tokenEstimate: number;
  /** stratum used by the demo selection (body part, doc_type, source file) */
  group: string;
}
export interface ExclusionLog { [reason: string]: number }
export interface LoadedDataset { dataset: DatasetName; sourceFile: string; sourceFileSha256: string; docs: IngestDoc[]; excluded: ExclusionLog; totalSourceRecords: number }

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** Rough, tokenizer-independent estimate (chars / 3.2, Vietnamese-leaning). NOT a Cohere token count: it is only used to size cost. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.2);
export function stableId(dataset: DatasetName, key: string): string {
  const h = sha256(`${dataset}\u0000${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; // UUID-shaped (version nibble 5, RFC variant a)
}
const normalizeForDup = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const bump = (log: ExclusionLog, reason: string): void => { log[reason] = (log[reason] ?? 0) + 1; };

/** RFC 4180 CSV: quoted fields, "" escapes, commas and NEWLINES inside quotes (the old line-splitting reader broke on a multi-line field). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field.trim()); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "").trim()); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/, "").trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}
function csvRecords(file: string, required: string[]): { headers: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) throw new Error(`${file}: empty or header-only CSV`);
  const headers = rows[0]; const missing = required.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`${file}: missing required columns: ${missing.join(", ")}`);
  return { headers, records: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))) };
}

/** Finds the repo root (the directory holding data/catalog). RAG_DATA_ROOT overrides. */
export function resolveDataRoot(start: string = process.cwd()): string {
  const env = process.env.RAG_DATA_ROOT; if (env) return path.resolve(env);
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(dir, "data", "catalog"))) return dir; const up = path.dirname(dir); if (up === dir) break; dir = up; }
  throw new Error("Cannot locate the data root (a directory containing data/catalog). Set RAG_DATA_ROOT.");
}
const fileSha = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function finalize(dataset: DatasetName, key: string, text: string, payload: Record<string, unknown>, group: string): IngestDoc {
  const id = stableId(dataset, key);
  const full = { ...payload, id, document_id: key, corpus_dataset: dataset };
  return { dataset, index: INDEX_OF[dataset], key, id, text, payload: full, contentHash: sha256(`${text}\u0000${JSON.stringify(payload)}`), tokenEstimate: estimateTokens(text), group };
}

// ── loaders (ALL valid records of a source, in file order; selection is a separate step) ────────────────────────────────────────────────────────────
export function loadExercises(root: string): LoadedDataset {
  const file = path.join(root, SOURCE_PATH.exercises);
  const { records } = csvRecords(file, ["exercise_name", "type_of_activity", "type_of_equipment", "body_part", "type", "muscle_groups_activated", "instructions"]);
  const excluded: ExclusionLog = {}; const seen = new Set<string>(); const docs: IngestDoc[] = [];
  for (const r of records) {
    const name = r.exercise_name.trim();
    if (!name) { bump(excluded, "missing_name"); continue; }
    if (r.instructions.trim().length < 40) { bump(excluded, "missing_or_short_instructions"); continue; }
    if (!r.body_part.trim() || !r.type_of_equipment.trim()) { bump(excluded, "missing_metadata"); continue; }
    if (seen.has(normalizeForDup(name))) { bump(excluded, "duplicate_key"); continue; }
    seen.add(normalizeForDup(name));
    const payload = {
      exerciseName: name, typeOfActivity: r.type_of_activity, typeOfEquipment: r.type_of_equipment, bodyPart: r.body_part, type: r.type,
      muscleGroupsActivated: r.muscle_groups_activated, instructions: r.instructions, source_type: "exercise_catalog", source_file: SOURCE_PATH.exercises,
    };
    docs.push(finalize("exercises", name, `${name} ${r.type_of_activity} ${r.type_of_equipment} ${r.body_part} ${r.muscle_groups_activated} ${r.instructions}`, payload, r.body_part));
  }
  return { dataset: "exercises", sourceFile: SOURCE_PATH.exercises, sourceFileSha256: fileSha(file), docs, excluded, totalSourceRecords: records.length };
}
export function loadKnowledge(root: string): LoadedDataset {
  const file = path.join(root, SOURCE_PATH.knowledge);
  const { records } = csvRecords(file, ["doc_id", "title_vi", "content_vi", "category", "tags", "doc_type"]);
  const excluded: ExclusionLog = {}; const seen = new Set<string>(); const docs: IngestDoc[] = [];
  for (const r of records) {
    if (!r.doc_id.trim()) { bump(excluded, "missing_key"); continue; }
    if (seen.has(r.doc_id)) { bump(excluded, "duplicate_key"); continue; }
    seen.add(r.doc_id);
    const payload = { docId: r.doc_id, titleVi: r.title_vi, contentVi: r.content_vi, category: r.category, tags: r.tags, doc_type: r.doc_type, source_type: "synthetic_domain_dataset", source_file: SOURCE_PATH.knowledge };
    docs.push(finalize("knowledge", r.doc_id, `${r.title_vi} ${r.content_vi} ${r.category} ${r.tags}`, payload, r.doc_type));
  }
  return { dataset: "knowledge", sourceFile: SOURCE_PATH.knowledge, sourceFileSha256: fileSha(file), docs, excluded, totalSourceRecords: records.length };
}
export function loadFaq(root: string): LoadedDataset {
  const file = path.join(root, SOURCE_PATH.faq);
  const { records } = csvRecords(file, ["faq_id", "question_vi", "answer_vi", "category", "tags"]);
  const excluded: ExclusionLog = {}; const seen = new Set<string>(); const docs: IngestDoc[] = [];
  for (const r of records) {
    if (!r.faq_id.trim()) { bump(excluded, "missing_key"); continue; }
    if (seen.has(r.faq_id)) { bump(excluded, "duplicate_key"); continue; }
    seen.add(r.faq_id);
    const payload = { faqId: r.faq_id, questionVi: r.question_vi, answerVi: r.answer_vi, category: r.category, tags: r.tags, source_type: "synthetic_domain_dataset", source_group: r.source_group ?? "", source_file: SOURCE_PATH.faq };
    docs.push(finalize("faq", r.faq_id, `${r.question_vi} ${r.answer_vi} ${r.category} ${r.tags}`, payload, r.category));
  }
  return { dataset: "faq", sourceFile: SOURCE_PATH.faq, sourceFileSha256: fileSha(file), docs, excluded, totalSourceRecords: records.length };
}
interface EvidenceLine { id?: string; title?: string; source_type?: string; category?: string; content?: string; source_url?: string; evidence_level?: string; tags?: string[]; chunk_index?: number; total_chunks?: number; extraction_method?: string }
/** Local JSONL evidence → documents with the SAME payload shape ingestEvidence.ts wrote to Qdrant, but with no QdrantClient dependency. `sourceUrl` is kept as given (may be null). */
export function loadEvidence(root: string): LoadedDataset {
  const dir = path.join(root, SOURCE_PATH.evidence);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const excluded: ExclusionLog = {}; const seen = new Set<string>(); const docs: IngestDoc[] = []; let total = 0; const hasher = createHash("sha256");
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8"); hasher.update(f).update(raw);
    for (const line of raw.split("\n").filter((l) => l.trim())) {
      total++; let c: EvidenceLine;
      try { c = JSON.parse(line) as EvidenceLine; } catch { bump(excluded, "unparsable_line"); continue; }
      const key = (c.id ?? "").trim() || `${f}#${c.chunk_index ?? total}`;
      if (!c.content || c.content.trim().length < 20) { bump(excluded, "missing_or_short_content"); continue; }
      if (!c.title || !c.category) { bump(excluded, "missing_metadata"); continue; }
      if (seen.has(key)) { bump(excluded, "duplicate_key"); continue; }
      seen.add(key);
      const payload = {
        title: c.title, source_type: c.source_type || "curated_summary", category: c.category, content: c.content, source_url: c.source_url ?? null, evidence_level: c.evidence_level ?? "unknown",
        tags: c.tags ?? [], chunk_index: c.chunk_index ?? 0, total_chunks: c.total_chunks ?? 1, extraction_method: c.extraction_method ?? "knowledge_curated",
        created_from: "external_evidence_dataset", source_file: `${SOURCE_PATH.evidence}/${f}`, chunk_id: key,
      };
      docs.push(finalize("evidence", key, [c.title, c.category, c.content, (c.tags ?? []).join(" ")].join(" "), payload, f.replace(/\.jsonl$/, "")));
    }
  }
  return { dataset: "evidence", sourceFile: `${SOURCE_PATH.evidence}/*.jsonl (${files.length} files)`, sourceFileSha256: hasher.digest("hex"), docs, excluded, totalSourceRecords: total };
}
export const LOADERS: Readonly<Record<DatasetName, (root: string) => LoadedDataset>> = { exercises: loadExercises, knowledge: loadKnowledge, faq: loadFaq, evidence: loadEvidence };

// ── selection ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Demo profile (the first AWS window): a SMALL, deterministic, auditable subset — 100–200 documents in total.
 *   exercises : the first 40 of a round-robin across body parts (valid records only)
 *   knowledge : doc_type workout_plan 20 + meal_plan 15 + food 15. EXCLUDED: `faq` (5 946 rows duplicated from fitness_faq), `exercise` (already in the exercises index),
 *               `workout_day` (fragments of a plan), `health_guidance` (synthetic medical-style advice: not presented as evidence in a first demo)
 *   evidence  : every chunk that cites an http(s) source_url (chunks without a source are excluded: no provenance)
 *   faq       : NONE (the FAQ is synthetic and duplicated)
 * Order inside a stratum is by sha256(dataset|key) so the choice does not depend on file order; strata are interleaved round-robin.
 */
export const DEMO_QUOTAS: { exercises: number; knowledge: Readonly<Record<string, number>>; evidence: number; faq: number } = {
  exercises: 40, knowledge: { workout_plan: 20, meal_plan: 15, food: 15 }, evidence: 80, faq: 0,
};
export interface SelectionResult { docs: IngestDoc[]; excluded: ExclusionLog; rule: string }
const byHash = (a: IngestDoc, b: IngestDoc): number => sha256(`${a.dataset}|${a.key}`).localeCompare(sha256(`${b.dataset}|${b.key}`));
function roundRobin(docs: IngestDoc[], quotaPerGroup?: Readonly<Record<string, number>>, total?: number): IngestDoc[] {
  const groups = new Map<string, IngestDoc[]>();
  for (const d of [...docs].sort(byHash)) { const g = groups.get(d.group) ?? []; g.push(d); groups.set(d.group, g); }
  const names = [...groups.keys()].sort(); const out: IngestDoc[] = []; const taken: Record<string, number> = {};
  for (let round = 0; ; round++) {
    let any = false;
    for (const g of names) {
      const list = groups.get(g)!; if (round >= list.length) continue;
      if (quotaPerGroup && (taken[g] ?? 0) >= (quotaPerGroup[g] ?? 0)) continue;
      out.push(list[round]); taken[g] = (taken[g] ?? 0) + 1; any = true;
      if (total !== undefined && out.length >= total) return out;
    }
    if (!any) break;
  }
  return out;
}
export function selectDocs(loaded: LoadedDataset, profile: IngestProfile): SelectionResult {
  const excluded: ExclusionLog = { ...loaded.excluded };
  if (profile === "full") return { docs: loaded.docs, excluded, rule: "full: every valid record of the source, in file order" };
  if (loaded.dataset === "faq") { excluded.demo_profile_excludes_synthetic_faq = loaded.docs.length; return { docs: [], excluded, rule: "demo: faq excluded (synthetic, duplicated in fitness_knowledge)" }; }
  if (loaded.dataset === "exercises") return { docs: roundRobin(loaded.docs, undefined, DEMO_QUOTAS.exercises), excluded: { ...excluded, not_selected: Math.max(0, loaded.docs.length - DEMO_QUOTAS.exercises) }, rule: `demo: ${DEMO_QUOTAS.exercises} exercises, round-robin over body_part, hash-ordered` };
  if (loaded.dataset === "knowledge") {
    const allowed = loaded.docs.filter((d) => d.group in DEMO_QUOTAS.knowledge);
    for (const d of loaded.docs) if (!(d.group in DEMO_QUOTAS.knowledge)) bump(excluded, `demo_excluded_doc_type:${d.group}`);
    const seenText = new Set<string>(); const usable: IngestDoc[] = [];
    for (const d of [...allowed].sort(byHash)) {
      const p = d.payload as { titleVi?: string; contentVi?: string };
      if (!p.titleVi?.trim() || (p.contentVi ?? "").trim().length < 40) { bump(excluded, "missing_or_short_content"); continue; }
      const h = sha256(normalizeForDup(p.contentVi ?? "")); if (seenText.has(h)) { bump(excluded, "duplicate_content"); continue; } seenText.add(h); usable.push(d);
    }
    const picked = roundRobin(usable, DEMO_QUOTAS.knowledge);
    return { docs: picked, excluded, rule: `demo: knowledge doc_types ${JSON.stringify(DEMO_QUOTAS.knowledge)}; faq / exercise / workout_day / health_guidance excluded; content-deduplicated` };
  }
  // evidence: provenance rule
  const usable: IngestDoc[] = []; const seenText = new Set<string>();
  for (const d of [...loaded.docs].sort(byHash)) {
    const url = (d.payload as { source_url?: unknown }).source_url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) { bump(excluded, "no_source_url"); continue; }
    const h = sha256(normalizeForDup(String((d.payload as { content?: unknown }).content ?? ""))); if (seenText.has(h)) { bump(excluded, "duplicate_content"); continue; } seenText.add(h); usable.push(d);
  }
  const picked = roundRobin(usable, undefined, DEMO_QUOTAS.evidence);
  return { docs: picked, excluded, rule: `demo: evidence chunks with an http(s) source_url, content-deduplicated, max ${DEMO_QUOTAS.evidence}; round-robin over source file` };
}

// ── manifest ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ManifestOptions { profile: IngestProfile; limit?: number; canary: boolean; indexSuffix: string; embeddingModel: string; dimension: number; pricePer1kTokensUsd: number; now?: Date }
export interface ManifestIndex {
  index: string; dataset: DatasetName; sourceFile: string; sourceFileSha256: string; sourceRecords: number; documents: number; tokenEstimate: number; estimatedEmbeddingCostUsd: number;
  selectionRule: string; excluded: ExclusionLog; documentsDetail: Array<{ id: string; key: string; group: string; contentHash: string; tokenEstimate: number }>;
}
export interface IngestManifest {
  schema: "gymini-rag-ingest-manifest/1"; generatedAt: string; profile: IngestProfile; canary: boolean; limitPerDataset: number | null; indexSuffix: string;
  embedding: { model: string; dimension: number; pricePer1kTokensUsd: number; priceSource: "ASSUMPTION — not verified against the AWS Pricing API; override with --embed-price-per-1k" };
  tokenEstimateMethod: "ceil(chars / 3.2) — a sizing estimate, NOT a Cohere tokenizer count";
  totals: { documents: number; tokenEstimate: number; estimatedEmbeddingCostUsd: number }; indexes: ManifestIndex[];
  provenanceNotes: string[];
}
export function buildManifest(selected: Array<{ loaded: LoadedDataset; selection: SelectionResult; docs: IngestDoc[] }>, o: ManifestOptions): IngestManifest {
  const indexes: ManifestIndex[] = selected.map(({ loaded, selection, docs }) => {
    const tokens = docs.reduce((a, d) => a + d.tokenEstimate, 0);
    return {
      index: `${INDEX_OF[loaded.dataset]}${o.indexSuffix}`, dataset: loaded.dataset, sourceFile: loaded.sourceFile, sourceFileSha256: loaded.sourceFileSha256, sourceRecords: loaded.totalSourceRecords, documents: docs.length,
      tokenEstimate: tokens, estimatedEmbeddingCostUsd: Number(((tokens / 1000) * o.pricePer1kTokensUsd).toFixed(6)), selectionRule: selection.rule, excluded: selection.excluded,
      documentsDetail: docs.map((d) => ({ id: d.id, key: d.key, group: d.group, contentHash: d.contentHash, tokenEstimate: d.tokenEstimate })),
    };
  });
  const tokenEstimate = indexes.reduce((a, i) => a + i.tokenEstimate, 0);
  return {
    schema: "gymini-rag-ingest-manifest/1", generatedAt: (o.now ?? new Date()).toISOString(), profile: o.profile, canary: o.canary, limitPerDataset: o.limit ?? null, indexSuffix: o.indexSuffix,
    embedding: { model: o.embeddingModel, dimension: o.dimension, pricePer1kTokensUsd: o.pricePer1kTokensUsd, priceSource: "ASSUMPTION — not verified against the AWS Pricing API; override with --embed-price-per-1k" },
    tokenEstimateMethod: "ceil(chars / 3.2) — a sizing estimate, NOT a Cohere tokenizer count",
    totals: { documents: indexes.reduce((a, i) => a + i.documents, 0), tokenEstimate, estimatedEmbeddingCostUsd: Number(((tokenEstimate / 1000) * o.pricePer1kTokensUsd).toFixed(6)) },
    indexes,
    provenanceNotes: [
      "exercises: project exercise catalogue (retriever source class CATALOG).",
      "fitness_knowledge / fitness_faq: PROJECT-AUTHORED SYNTHETIC domain dataset (data/README_vi.txt) — generated knowledge, NOT verified scientific evidence; the retriever already classes it SYNTHETIC_KNOWLEDGE.",
      "fitness_evidence: project-written curated SUMMARIES that cite a source URL; this pipeline did not check them against the cited papers. Only chunks with a source_url are selected in the demo profile.",
      "The FAQ is excluded from the demo profile (5 946 synthetic rows, duplicated inside fitness_knowledge).",
    ],
  };
}
