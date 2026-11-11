/**
 * Phase 4.6 — RAG grounding hardening (docs/ai-product/phase4-6-rag-grounding-hardening.md).
 * Deterministic fixtures only: no Qdrant, no embedding service, no LLM.
 * (The live-Qdrant measurement is src/scripts/evaluateRagGrounding.ts.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeSource,
  buildKnowledgeContext,
  classifySource,
  renderKnowledgeContext,
} from "../llm/knowledge-source";
import {
  dedupeCandidates,
  detectRangeConflict,
  englishExpansion,
  inferDomains,
  retrieveV2,
  V2_CONFIG,
  type Candidate,
  type V2Io,
} from "../llm/retrieval-v2";
import { retrievalDocumentFromPayload, ragRetrievalV2Enabled } from "../llm/retriever";
import { compactRetrieval } from "../llm/prompt_builder";
import type { RetrievalDocument } from "../llm/types";

// ── payload fixtures shaped like the LIVE collections ────────────────────

const evidence = (over: Record<string, unknown> = {}) => ({
  title: "ISSN Position Stand: Protein and Exercise (2017)", source_type: "curated_summary", category: "nutrition",
  content: "ISSN Protein Position Stand (2017) — daily protein intake of 1.4-2.0 g/kg body weight is sufficient for exercising individuals to build and maintain muscle.",
  source_url: "https://doi.org/10.1186/s12970-017-0177-8", evidence_level: "expert_consensus", created_from: "external_evidence_dataset",
  chunk_id: "issn-protein-2017-chunk-0000", source_file: "data/processed/evidence/issn-protein-2017.jsonl", ...over,
});
const synthFaq = (q: string, a: string, id = "FAQ1") => ({ id: 1, faqId: id, questionVi: q, answerVi: a, category: "nutrition", tags: "" });
const synthKnowledge = (title: string, content: string, id = "CON1") => ({ id: 2, docId: id, titleVi: title, contentVi: content, category: "concepts", tags: "" });
const catalogRow = (name: string, muscles: string) => ({ id: 3, exerciseName: name, typeOfActivity: "Strength", typeOfEquipment: "Bodyweight", bodyPart: "Lower Body", type: "Push", muscleGroupsActivated: muscles, instructions: "Stand and squat." });
const method = () => ({ title: "PHAT-inspired power/hypertrophy split", source_type: "coach_public_method", category: "training_method", content: "PHAT split power and hypertrophy days.", evidence_level: "practitioner_synthesis", created_from: "training_methods_manual_dataset", method_id: "phat_inspired_split", source_url: null });

type Hit = { id: string; similarity: number; payload: Record<string, unknown> };
function makeIo(byCollection: Record<string, Hit[]>): V2Io & { calls: { embed: string[]; search: string[] } } {
  const calls = { embed: [] as string[], search: [] as string[] };
  return {
    calls,
    embed: async (t) => { calls.embed.push(t); return [0.1, 0.2]; },
    search: async (c) => { calls.search.push(c); return byCollection[c] ?? []; },
    toDoc: (c, p, s, id) => retrievalDocumentFromPayload(c, p, s, id),
  };
}

// ── source classification & provenance ───────────────────────────────────

test("source classes: evidence vs reference vs synthetic vs catalog — from payload facts, not just collection name", () => {
  assert.equal(classifySource("fitness_evidence", evidence()), "CURATED_EVIDENCE");
  assert.equal(classifySource("fitness_evidence", evidence({ source_type: "paper", evidence_level: "systematic_review", created_from: "knowledge_update_pipeline" })), "CURATED_EVIDENCE");
  assert.equal(classifySource("fitness_evidence", method()), "CURATED_REFERENCE");
  assert.equal(classifySource("fitness_evidence", evidence({ source_type: "web", evidence_level: "unknown" })), "CURATED_REFERENCE");
  assert.equal(classifySource("fitness_knowledge", synthKnowledge("a", "b")), "SYNTHETIC_KNOWLEDGE");
  assert.equal(classifySource("fitness_faq", synthFaq("q", "a")), "SYNTHETIC_KNOWLEDGE");
  assert.equal(classifySource("exercises", catalogRow("Squats", "Quadriceps")), "CATALOG");
});

test("provenance: curated evidence keeps title, sourceId, year, URL; synthetic is flagged synthetic and has no URL", () => {
  const s = buildKnowledgeSource("fitness_evidence", evidence(), "p1");
  assert.equal(s.title, "ISSN Position Stand: Protein and Exercise (2017)");
  assert.equal(s.sourceId, "issn-protein-2017");
  assert.equal(s.year, 2017);
  assert.equal(s.url, "https://doi.org/10.1186/s12970-017-0177-8");
  assert.equal(s.synthetic, false);
  const f = buildKnowledgeSource("fitness_faq", synthFaq("q?", "a"), "p2");
  assert.equal(f.synthetic, true);
  assert.equal(f.url, null);
  assert.equal(f.sourceClass, "SYNTHETIC_KNOWLEDGE");
  assert.equal(buildKnowledgeSource("fitness_evidence", evidence({ source_url: "local://x" }), "p3").url, null, "non-http source URLs are never presented as citations");
});

// ── domains & glossary ───────────────────────────────────────────────────

test("domain inference: multi-domain and unknown are both possible; deterministic", () => {
  assert.ok(inferDomains("creatine có cần cycle không?").includes("SUPPLEMENTS"));
  assert.ok(inferDomains("InBody đo mỡ có chính xác không?").includes("BODY_COMPOSITION"));
  assert.ok(inferDomains("protein khi cut nên hiểu thế nào?").includes("NUTRITION"));
  assert.ok(inferDomains("squat tác động nhóm cơ nào").includes("EXERCISE_CATALOG"));
  assert.deepEqual(inferDomains("giá bitcoin hôm nay"), []);
  assert.match(englishExpansion("protein khi cut"), /protein intake/);
});

// ── dedup ────────────────────────────────────────────────────────────────

function cand(collection: string, payload: Record<string, unknown>, cosine: number, lexical = 0.5): Candidate {
  const doc = retrievalDocumentFromPayload(collection, payload, cosine, `${collection}-${Math.random()}`);
  const source = buildKnowledgeSource(collection, payload, "x");
  return { doc, source, cosine, lexical, blended: cosine, text: doc.pageContent.toLowerCase() };
}

test("dedup: a templated FAQ restatement of the same answer is dropped in favour of the higher-authority candidate", () => {
  const body = "Protein 1.6 đến 2.2 g/kg mỗi ngày giúp duy trì khối lượng cơ khi giảm mỡ và hỗ trợ phục hồi sau tập luyện kháng lực";
  const a = cand("fitness_faq", synthFaq("Nên ăn bao nhiêu protein khi giảm mỡ?", body), 0.85);
  const b = cand("fitness_knowledge", synthKnowledge("Nên ăn bao nhiêu protein khi giảm mỡ?", body), 0.84);
  const e = cand("fitness_evidence", evidence({ content: body }), 0.7);
  const kept = dedupeCandidates([a, b, e]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source.sourceClass, "CURATED_EVIDENCE");
});

test("dedup does not merge distinct passages", () => {
  const a = cand("fitness_evidence", evidence({ content: "Creatine monohydrate 3-5 g/day is safe and effective for increasing strength and lean mass." }), 0.7);
  const b = cand("fitness_evidence", evidence({ title: "Caffeine", content: "Caffeine 3-6 mg/kg taken 60 minutes before exercise improves endurance performance in trained athletes." }), 0.7);
  assert.equal(dedupeCandidates([a, b]).length, 2);
});

// ── ranking / policy ─────────────────────────────────────────────────────

test("EVIDENCE PRIORITY: curated evidence wins slot 1 even when a synthetic row has the higher raw cosine", async () => {
  const io = makeIo({
    fitness_evidence: [{ id: "e1", similarity: 0.71, payload: evidence() }],
    fitness_faq: [{ id: "f1", similarity: 0.87, payload: synthFaq("Nên ăn bao nhiêu protein mỗi ngày?", "Khoảng 1.6 g/kg protein mỗi ngày cho người tập.") }],
    fitness_knowledge: [{ id: "k1", similarity: 0.86, payload: synthKnowledge("Protein mỗi ngày", "Protein mỗi ngày nên khoảng 1.6 g/kg cho người tập luyện.") }],
  });
  const r = await retrieveV2("protein mỗi ngày cần bao nhiêu gram/kg?", io);
  assert.equal(r.isEmpty, false);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.sourceClass, "CURATED_EVIDENCE");
  assert.ok(r.documents.some((d) => (d.metadata as any).knowledgeSource.sourceClass === "SYNTHETIC_KNOWLEDGE"), "synthetic stays available as labelled fallback");
});

test("SYNTHETIC-ONLY: no curated evidence → fallback still returned, explicitly marked synthetic and never rendered as research", async () => {
  const io = makeIo({
    fitness_faq: [{ id: "f1", similarity: 0.8, payload: synthFaq("Superset là gì?", "Superset là hai bài tập liên tiếp không nghỉ giữa hai bài.") }],
  });
  const r = await retrieveV2("superset là gì", io);
  assert.equal(r.isEmpty, false);
  const src = (r.documents[0].metadata as any).knowledgeSource;
  assert.equal(src.synthetic, true);
  const text = compactRetrieval(r as any);
  assert.match(text, /KHÔNG phải nghiên cứu khoa học/);
  assert.doesNotMatch(text, /Bằng chứng khoa học/);
});

test("NO-SOURCE: out-of-scope question gets no documents (not random low-score chunks)", async () => {
  const io = makeIo({
    fitness_evidence: [{ id: "e1", similarity: 0.66, payload: evidence({ title: "Deload", content: "Tuần deload giảm tải chủ động khi mệt mỏi tích lũy", source_type: "curated_summary" }) }],
    fitness_faq: [{ id: "f1", similarity: 0.76, payload: synthFaq("Nếu tôi rất đói khi đang cắt thì sao?", "Hãy tăng rau xanh và protein nạc trong các bữa ăn của bạn.") }],
  });
  const r = await retrieveV2("cách nấu phở bò chuẩn vị Hà Nội", io);
  assert.equal(r.isEmpty, true);
  assert.equal(r.reason, "NO_RELEVANT_KNOWLEDGE");
  assert.equal(r.documents.length, 0);
});

test("DOMAIN ROUTING: exercise catalog is only searched for catalog/technique questions and is labelled as catalog, not evidence", async () => {
  const ioSci = makeIo({ fitness_evidence: [{ id: "e", similarity: 0.7, payload: evidence() }], exercises: [{ id: "x", similarity: 0.72, payload: catalogRow("Squats", "Quadriceps, Glutes") }] });
  await retrieveV2("creatine có cần cycle không", ioSci);
  assert.ok(!ioSci.calls.search.includes("exercises"));
  const ioCat = makeIo({ exercises: [{ id: "x", similarity: 0.66, payload: catalogRow("Squats", "Quadriceps, Glutes") }], fitness_evidence: [{ id: "e", similarity: 0.7, payload: evidence() }] });
  const r = await retrieveV2("squat tác động nhóm cơ nào", ioCat);
  assert.ok(ioCat.calls.search.includes("exercises"));
  assert.equal((r.documents[0].metadata as any).knowledgeSource.sourceClass, "CATALOG");
  assert.match(compactRetrieval(r as any), /Danh mục bài tập \(dữ liệu tham chiếu, không phải bằng chứng\)/);
});

test("per-class floors are applied per class (a 0.6 evidence chunk passes, a 0.6 synthetic row does not)", async () => {
  const io = makeIo({
    fitness_evidence: [{ id: "e", similarity: 0.6, payload: evidence() }],
    fitness_faq: [{ id: "f", similarity: 0.6, payload: synthFaq("Protein mỗi ngày bao nhiêu?", "Protein khoảng 1.6 g/kg.") }],
  });
  const r = await retrieveV2("protein mỗi ngày bao nhiêu g/kg", io);
  const classes = r.documents.map((d) => (d.metadata as any).knowledgeSource.sourceClass);
  assert.deepEqual(classes, ["CURATED_EVIDENCE"]);
  assert.ok(V2_CONFIG.floors.SYNTHETIC_KNOWLEDGE > 0.6);
});

test("CONTEXT BOUND: never more than maxTotal documents and snippets are trimmed", async () => {
  const many = (n: number): Hit[] => Array.from({ length: n }, (_, i) => ({
    id: `e${i}`, similarity: 0.8 - i * 0.01,
    payload: evidence({ chunk_id: `c${i}`, document_id: `doc-${i}`, title: `Protein paper ${i}`, content: `protein intake g/kg muscle ${"x".repeat(900)} ${i}` }),
  }));
  const io = makeIo({ fitness_evidence: many(8), fitness_faq: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, similarity: 0.85, payload: synthFaq(`Protein câu ${i}?`, `Protein trả lời số ${i} khác nhau hoàn toàn ${"y".repeat(60)}${i}`) })) });
  const r = await retrieveV2("protein mỗi ngày bao nhiêu gram", io);
  assert.ok(r.documents.length <= V2_CONFIG.maxTotal);
  assert.ok(r.documents.every((d) => d.pageContent.length <= V2_CONFIG.maxSnippetChars + 1));
});

// ── conflict V0 ──────────────────────────────────────────────────────────

test("CONFLICT V0: two curated sources with disjoint g/kg ranges are both kept and flagged — nothing is silently chosen", async () => {
  const a = evidence({ title: "ISSN Protein", document_id: "issn-protein", content: "daily protein intake of 1.4-2.0 g/kg body weight per day is sufficient for exercising individuals" });
  const b = evidence({ title: "ISSN Diets", document_id: "issn-diets", chunk_id: "issn-diets-chunk-0", content: "a total daily protein intake of 2.3-3.1 g/kg body weight per day may be warranted to preserve muscle" });
  const io = makeIo({ fitness_evidence: [{ id: "a", similarity: 0.75, payload: a }, { id: "b", similarity: 0.74, payload: b }] });
  const r = await retrieveV2("khuyến nghị protein khi giảm cân so với lúc bình thường", io);
  assert.equal(r.documents.length, 2);
  assert.ok((r.documents[0].metadata as any).conflictNote);
  const text = compactRetrieval(r as any);
  assert.match(text, /không tự chọn một/);
  assert.match(text, /1\.4–2 g\/kg|1\.4–2\.0 g\/kg|1\.4–2/);
  assert.match(text, /2\.3–3\.1/);
});

test("conflict detection ignores overlapping ranges and a single source", () => {
  const c1 = cand("fitness_evidence", evidence({ document_id: "a", content: "1.4-2.0 g/kg" }), 0.7);
  const c2 = cand("fitness_evidence", evidence({ document_id: "b", content: "1.6-2.2 g/kg" }), 0.7);
  assert.equal(detectRangeConflict([c1, c2]), null);
  assert.equal(detectRangeConflict([c1]), null);
});

// ── citation readiness & off-mode parity ─────────────────────────────────

test("CITATION: context for curated evidence retains title, publisher/year where known, and URL — enough to answer 'nguồn nào?'", async () => {
  const io = makeIo({ fitness_evidence: [{ id: "e1", similarity: 0.75, payload: evidence({ source_name: "ISSN" }) }] });
  const r = await retrieveV2("protein mỗi ngày cần bao nhiêu gram/kg", io);
  const items = buildKnowledgeContext(r.documents);
  assert.equal(items[0].source.title, "ISSN Position Stand: Protein and Exercise (2017)");
  assert.equal(items[0].source.publisher, "ISSN");
  assert.equal(items[0].source.year, 2017);
  const text = renderKnowledgeContext(items);
  assert.match(text, /ISSN Position Stand/);
  assert.match(text, /doi\.org/);
  assert.doesNotMatch(text, /\bundefined\b|\bnull\b/);
});

test("OFF-MODE: flag default off; legacy prompt rendering is unchanged for documents without knowledgeSource", () => {
  const prev = process.env.RAG_RETRIEVAL_V2;
  delete process.env.RAG_RETRIEVAL_V2;
  assert.equal(ragRetrievalV2Enabled(), false);
  process.env.RAG_RETRIEVAL_V2 = "on";
  assert.equal(ragRetrievalV2Enabled(), true);
  if (prev === undefined) delete process.env.RAG_RETRIEVAL_V2; else process.env.RAG_RETRIEVAL_V2 = prev;

  const legacy: RetrievalDocument[] = [
    retrievalDocumentFromPayload("fitness_faq", synthFaq("Q?", "A."), 0.8, "1"),
    retrievalDocumentFromPayload("fitness_evidence", evidence(), 0.7, "2"),
  ];
  const text = compactRetrieval({ documents: legacy, isEmpty: false });
  assert.match(text, /1\. Q: Q\?\nA: A\./);
  assert.match(text, /\[Bằng chứng khoa học từ nghiên cứu:\]\nE1\. \[curated_summary\] ISSN Position Stand/);
  assert.doesNotMatch(text, /KHÔNG phải nghiên cứu/);
});
