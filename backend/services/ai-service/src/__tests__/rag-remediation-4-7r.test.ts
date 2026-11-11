/**
 * Phase 4.7R — RAG generalisation remediation (docs/ai-product/phase4-7r-rag-generalization-remediation.md).
 * Pure/fixture tests: payloads are shaped like the LIVE collections; no Qdrant, no Ollama, no LLM.
 * Evidence label: TEST FIXTURE (the live-Qdrant numbers are in the doc, not here).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, type GateThresholds } from "../llm/rag-gate";
import { detectConcepts } from "../llm/fitness-concepts";
import {
  retrieveV2, detectRangeConflict, detectScopeUncertainty, comparableScopes, rangeScope, isNonKnowledgeIntent, englishExpansion,
  type V2Io, type Candidate,
} from "../llm/retrieval-v2";
import { buildKnowledgeSource, classifySource, resolveYear, resolvePublisher, renderKnowledgeContext, buildKnowledgeContext } from "../llm/knowledge-source";
import { retrievalDocumentFromPayload } from "../llm/retriever";
import { compactRetrieval } from "../llm/prompt_builder";

// ── fixtures ──────────────────────────────────────────────────────────────

const evidence = (over: Record<string, unknown> = {}) => ({
  title: "ISSN Position Stand: Protein and Exercise (2017)", source_type: "curated_summary", category: "nutrition",
  content: "ISSN Protein Position Stand (2017) — daily protein intake of 1.4-2.0 g/kg body weight per day is sufficient for exercising individuals to build and maintain muscle.",
  source_url: "https://doi.org/10.1186/s12970-017-0177-8", evidence_level: "expert_consensus", created_from: "external_evidence_dataset",
  chunk_id: "issn-protein-2017-chunk-0000", source_file: "data/processed/evidence/issn-protein-2017.jsonl", ...over,
});
const paper = (title: string, content: string, over: Record<string, unknown> = {}) => ({
  title, source_type: "paper", category: "training", content, text: content, source_url: "https://doi.org/10.1000/x", evidence_level: "peer_reviewed",
  created_from: "knowledge_update_pipeline", extraction_method: "knowledge_update_pipeline", source_file: "pubmed:eutils",
  source_name: "PubMed E-utilities", published_at: "2026-04-01T00:00:00.000Z", document_id: `doc-${title.slice(0, 8)}`, chunk_id: `doc-${title.slice(0, 8)}:0`, ...over,
});
const faq = (q: string, a: string, id = "FAQ1") => ({ id: 1, faqId: id, questionVi: q, answerVi: a, category: "nutrition", tags: "" });
const catalogRow = (name: string, muscles: string) => ({ id: 3, exerciseName: name, typeOfActivity: "Strength", typeOfEquipment: "Bodyweight", bodyPart: "Lower Body", type: "Push", muscleGroupsActivated: muscles, instructions: "Stand and squat." });

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
const cand = (payload: Record<string, unknown>, cosine = 0.7): Candidate => {
  const doc = retrievalDocumentFromPayload("fitness_evidence", payload, cosine, `e-${Math.random()}`);
  const source = buildKnowledgeSource("fitness_evidence", payload, "x");
  return { doc, source, cosine, lexical: 0.5, blended: cosine, text: doc.pageContent.toLowerCase() };
};

// ── evaluator gate (the Phase 4.7 improvement threshold was printed but never evaluated) ──

const TH: GateThresholds = {
  topicHit_at3_inScope_min: 0.6, relevantCuratedEvidence_at3_sciQueries_min: 0.55, relevantCuratedEvidence_at3_improvement_over_baseline_min: 0.3,
  syntheticTop1Rate_noSynthQueries_max: 0.15, duplicateRate_max: 0.05, falseSourceRate_outOfScope_max: 0.2, emptyRetrievalRate_inScope_max: 0.25,
};
const M = { topicHit_at3_inScope: 0.7, relevantCuratedEvidence_at3_sciQueries: 0.8, syntheticTop1Rate_noSynthQueries: 0.05, duplicateRate: 0, falseSourceRate_outOfScope: 0.1, emptyRetrievalRate_inScope: 0.1 };

test("EVALUATOR GATE: the configured improvement threshold is loaded, printed and EVALUATED against the baseline", () => {
  const ok = evaluateGate(M, TH, { baseline: { relevantCuratedEvidence_at3_sciQueries: 0.1 } });
  assert.equal(ok.improvement.required, 0.3);
  assert.equal(ok.improvement.evaluated, true);
  assert.equal(ok.improvement.observed, 0.7);
  assert.equal(ok.checks.improvement_over_baseline, true);
  assert.equal(ok.passAll, true);
  const weak = evaluateGate(M, TH, { baseline: { relevantCuratedEvidence_at3_sciQueries: 0.7 } });
  assert.equal(weak.checks.improvement_over_baseline, false);
  assert.deepEqual(weak.failed, ["improvement_over_baseline"]);
  assert.equal(weak.passAll, false);
});

test("EVALUATOR GATE: an improvement threshold with no baseline fails closed (never silently passes), absolute misses are named", () => {
  const r = evaluateGate({ ...M, topicHit_at3_inScope: 0.58, falseSourceRate_outOfScope: 0.333 }, TH);
  assert.equal(r.improvement.evaluated, false);
  assert.equal(r.checks.improvement_over_baseline, false);
  assert.ok(r.failed.includes("topicHit_at3_inScope") && r.failed.includes("falseSourceRate_outOfScope"));
});

test("EVALUATOR GATE: predeclared per-domain floors are evaluated; a missing domain fails", () => {
  const th = { ...TH, domainFloors: { SAFETY: 0.5, HYPERTROPHY: 0.4 } };
  const r = evaluateGate(M, th, { baseline: { relevantCuratedEvidence_at3_sciQueries: 0.1 }, byDomain: { SAFETY: { topicHit_at3: 0.25 }, HYPERTROPHY: { topicHit_at3: 0.6 } } });
  assert.equal(r.domainFloors.SAFETY.pass, false);
  assert.equal(r.domainFloors.HYPERTROPHY.pass, true);
  assert.deepEqual(r.failed, ["domainFloor_SAFETY"]);
  const missing = evaluateGate(M, th, { baseline: { relevantCuratedEvidence_at3_sciQueries: 0.1 }, byDomain: { SAFETY: { topicHit_at3: 0.9 } } });
  assert.equal(missing.checks.domainFloor_HYPERTROPHY, false);
});

// ── concept-level normalisation ──────────────────────────────────────────

const ids = (q: string) => detectConcepts(q).concepts.map((c) => c.id);

test("NORMALISATION: slang and colloquial Vietnamese map to concepts (concept-level aliases, not sentences)", () => {
  assert.ok(ids("ăn bao nhiêu đạm là vừa").includes("protein"));
  assert.ok(ids("cơ nở nhanh hơn khi nào").includes("hypertrophy"));
  assert.ok(ids("hạ tạ từ từ có to cơ không").includes("tempo"));
  assert.ok(ids("tập với dây quấn hạn chế máu").includes("bfr"));
  assert.ok(ids("ép mạch máu khi tập").includes("bfr"));
  assert.ok(ids("tạ nhẹ nhiều rep hay tạ nặng").includes("load_intensity"));
  assert.ok(ids("đánh sát giới hạn từng set hay chừa lại vài rep").includes("failure"));
  assert.ok(ids("bao lâu thì nên đổi giáo án một lần").includes("periodization"));
  assert.ok(ids("hạ cân nhanh quá có mất cơ không").includes("fat_loss"));
  assert.ok(ids("InBody đo mỡ có chuẩn không").includes("bia"));
  assert.ok(ids("how many sets per week to grow muscle").includes("volume"));
});

test("NORMALISATION: the English phrase is the concept phrase — no association-driven additions", () => {
  assert.match(englishExpansion("protein khi cut"), /protein intake/);
  assert.equal(englishExpansion("giá bitcoin hôm nay"), "");
  assert.deepEqual(ids("cách pha cà phê cold brew tại nhà"), [], "a beverage recipe is not a caffeine-supplement question");
  assert.deepEqual(ids("cà phê muối pha thế nào cho ngon"), []);
  assert.ok(ids("uống cà phê trước buổi tập liều bao nhiêu mg").includes("caffeine"), "same word + a fitness cue DOES mean caffeine");
});

test("NORMALISATION: surface forms start at word boundaries (\"e co\" must not fire inside \"phe co\")", () => {
  assert.ok(!ids("pha ca phe cold brew").includes("soreness"));
  assert.ok(!ids("bước chân mỗi ngày bao nhiêu là hợp lý").some((i) => i === "legs_part"));
  assert.equal(detectConcepts("bước chân mỗi ngày bao nhiêu là hợp lý cho người tập").catalog.length, 0, "\"chân\" in \"bước chân\" is not a leg-exercise cue");
});

// ── retrieval behaviour with fixtures ────────────────────────────────────

test("HYPERTROPHY: a slang query is asked of the English evidence in English and finds the tempo paper", async () => {
  const tempo = paper("How Slow Should You Go? A Systematic Review With Meta-Analysis of the Effect of Resistance Training Repetition Tempo on Muscle Hypertrophy",
    "Repetition tempo and eccentric duration were compared; slow and fast repetition durations produced similar muscle hypertrophy.");
  const io = makeIo({ fitness_evidence: [{ id: "t", similarity: 0.7, payload: tempo }] });
  const r = await retrieveV2("hạ tạ từ từ có giúp cơ phát triển hơn không", io);
  assert.equal(r.isEmpty, false);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.title.startsWith("How Slow Should You Go"), true);
  assert.ok(io.calls.embed.some((e) => /repetition tempo/.test(e)), "the English concept phrase is embedded on its own");
  assert.ok(r.trace.concepts.includes("tempo"));
});

test("OOD: a beverage recipe does not retrieve the ISSN caffeine paper (no association expansion) and asks no evidence collection", async () => {
  const caffeine = evidence({ title: "International society of sports nutrition position stand: caffeine and exercise performance (Guest et al. 2021)", content: "Caffeine ergogenic aid dose 3-6 mg/kg", evidence_level: "expert_consensus" });
  const io = makeIo({ fitness_evidence: [{ id: "c", similarity: 0.7, payload: caffeine }], fitness_faq: [{ id: "f", similarity: 0.72, payload: faq("Cà phê đen có phù hợp cho người tập gym không?", "Cà phê đen ít calo, có caffeine.") }] });
  const r = await retrieveV2("cách pha cà phê cold brew tại nhà", io);
  assert.equal(r.isEmpty, true);
  assert.equal(r.reason, "NO_RELEVANT_KNOWLEDGE");
  assert.ok(!io.calls.search.includes("fitness_evidence"), "no fitness concept ⇒ research evidence is never even requested");
});

test("OOD: accented query terms are matched accent-preserving (\"ngân hàng\" ≠ \"ngắn\", \"hàng\" ≠ \"hang\")", async () => {
  const f = faq("Tôi đang giảm mỡ thì nghỉ giữa set bao lâu là tốt?", "Bài compound nên nghỉ ngắn hơn; ở hang động hay sân xuất phát đều giữ nhịp nhẹ.");
  const io = makeIo({ fitness_faq: [{ id: "f", similarity: 0.78, payload: f }] });
  const r = await retrieveV2("lãi suất ngân hàng tháng này bao nhiêu", io);
  assert.equal(r.isEmpty, true);
});

test("OOD INTENT: shopping / release-news requests are not knowledge questions (0 embeddings, 0 searches); a question that seeks knowledge is unaffected", async () => {
  assert.equal(isNonKnowledgeIntent("Apple Watch mới ra mắt khi nào"), true);
  assert.equal(isNonKnowledgeIntent("chọn máy chạy bộ nào tốt để mua"), true);
  assert.equal(isNonKnowledgeIntent("creatine có an toàn khi dùng lâu dài không"), false);
  assert.equal(isNonKnowledgeIntent("đồng hồ thông minh đo calo tiêu hao có tin được không"), false);
  const io = makeIo({ fitness_evidence: [{ id: "w", similarity: 0.8, payload: evidence({ title: "Accuracy in Wrist-Worn Measurements (Shcherbina 2017)", content: "wearable wrist heart rate energy expenditure accuracy" }) }] });
  const r = await retrieveV2("Apple Watch mới ra mắt khi nào", io);
  assert.equal(r.isEmpty, true);
  assert.equal(io.calls.embed.length, 0);
  assert.equal(io.calls.search.length, 0);
});

test("TOPIC GUARD: curated evidence about a different concept is dropped even at a high cosine", async () => {
  const unrelated = paper("Progressive Overload Affects the Magnitude of Muscle Hypertrophy", "Progressive overload and training volume affect hypertrophy of the elbow flexors.");
  const io = makeIo({ fitness_evidence: [{ id: "u", similarity: 0.82, payload: unrelated }] });
  const r = await retrieveV2("creatine có an toàn không", io);
  assert.equal(r.isEmpty, true);
  assert.ok(r.trace.dropped.offTopic >= 1);
});

test("TOPIC GUARD: practitioner / internal-guidance text stored as a curated_summary is REFERENCE, not scientific evidence", () => {
  const cycle = { title: "Tuần Deload — giảm tải chủ động khi mệt mỏi tích lũy", source_type: "curated_summary", evidence_level: "practitioner_consensus", created_from: "external_evidence_dataset", source_url: null, content: "Tuần deload giảm 40% volume." };
  assert.equal(classifySource("fitness_evidence", cycle), "CURATED_REFERENCE");
  assert.equal(classifySource("fitness_evidence", { ...cycle, evidence_level: "professional_source" }), "CURATED_REFERENCE");
  assert.equal(classifySource("fitness_evidence", evidence()), "CURATED_EVIDENCE");
});

test("DEFINITION: a terminology definition needs a passage TITLED for the term — an incidental mention of RPE in a paper is not a definition", async () => {
  const incidental = paper("Cool in theory, not in practice: Effects of interset palm cooling on resistance exercise performance", "Ratings of perceived exertion (RPE) were lower with palm cooling.");
  const rirFaq = faq("RIR là gì và dùng thế nào?", "RIR (reps in reserve) là số rep còn dư trước khi chạm failure.", "FAQ-RIR");
  const io1 = makeIo({ fitness_evidence: [{ id: "p", similarity: 0.7, payload: incidental }] });
  assert.equal((await retrieveV2("RIR là gì", io1)).isEmpty, true);
  const io2 = makeIo({ fitness_evidence: [{ id: "p", similarity: 0.7, payload: incidental }], fitness_faq: [{ id: "f", similarity: 0.8, payload: rirFaq }] });
  const r = await retrieveV2("RIR là gì", io2);
  assert.equal(r.documents.length, 1);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.synthetic, true);
});

test("SAFETY: only trusted curated evidence whose TITLE is about the condition may answer; synthetic FAQ and practitioner text never do", async () => {
  const pa = evidence({ title: "Physical Activity Guidelines for Americans 2nd Edition (HHS 2018)", content: "Regular activity lowers risk of heart disease and improves blood pressure." });
  const method = { title: "PHAT-inspired split", source_type: "coach_public_method", evidence_level: "practitioner_synthesis", created_from: "training_methods_manual_dataset", content: "heart rate zones for conditioning", source_url: null };
  const f = faq("Tim đập nhanh khi tập thì sao?", "Hãy nghỉ và theo dõi, nếu kéo dài hãy gặp bác sĩ.");
  const io = makeIo({ fitness_evidence: [{ id: "a", similarity: 0.75, payload: pa }, { id: "m", similarity: 0.75, payload: method }], fitness_faq: [{ id: "f", similarity: 0.85, payload: f }] });
  const none = await retrieveV2("tim đập loạn khi tập nặng", io);
  assert.equal(none.isEmpty, true, "abstain: the conservative safety policy handles this, not a loosely-related guideline or a FAQ");
  assert.ok(none.trace.dropped.safetyClass >= 1);

  const redS = evidence({ title: "IOC consensus statement on Relative Energy Deficiency in Sport (REDs), 2023 update", content: "Low energy availability in female athletes causes menstrual dysfunction and bone stress injury.", source_url: "https://doi.org/10.1136/bjsports-2023-106994" });
  const io2 = makeIo({ fitness_evidence: [{ id: "r", similarity: 0.72, payload: redS }], fitness_faq: [{ id: "f", similarity: 0.85, payload: faq("Ăn ít mà tập nhiều thì sao?", "Có thể thiếu năng lượng.") }] });
  const r = await retrieveV2("ăn ít mà tập nhiều mất kinh nguyệt có nguy hiểm không", io2);
  assert.equal(r.documents.length, 1);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.sourceClass, "CURATED_EVIDENCE");
});

test("SYNTHETIC FALLBACK: a non-safety concept with no curated evidence still returns the labelled internal reference", async () => {
  const io = makeIo({ fitness_faq: [{ id: "f", similarity: 0.8, payload: faq("Nên chia protein thành mấy bữa mỗi ngày?", "Chia protein đều vào 3–4 bữa giúp dễ đạt tổng lượng protein mỗi ngày.") }] });
  const r = await retrieveV2("nên ăn mấy bữa protein một ngày", io);
  assert.equal(r.documents.length, 1);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.synthetic, true);
  assert.match(compactRetrieval(r as any), /KHÔNG phải nghiên cứu khoa học/);
});

test("SOURCE PRIORITY: evidence beats reference beats synthetic on a science question, each labelled", async () => {
  const ev = paper("Effects of Unilateral vs. Bilateral Resistance Training Interventions on Strength", "Unilateral and bilateral training both improved inter-limb strength asymmetry.", { document_id: "uni" });
  const ref = { title: "Asymmetry correction method", source_type: "coach_public_method", evidence_level: "practitioner_synthesis", created_from: "training_methods_manual_dataset", content: "Unilateral work for the weaker side, asymmetry correction.", source_url: null, method_id: "asym" };
  const io = makeIo({
    fitness_evidence: [{ id: "e", similarity: 0.7, payload: ev }, { id: "r", similarity: 0.75, payload: { ...ref, source_type: "coach_public_method" } }],
    fitness_faq: [{ id: "f", similarity: 0.9, payload: faq("Chân trái yếu hơn chân phải thì tập unilateral thế nào?", "Tập một chân mỗi bên.", "FAQ-U") }],
  });
  const r = await retrieveV2("chân trái yếu hơn chân phải thì có nên tập một chân", io);
  const classes = r.documents.map((d) => (d.metadata as any).knowledgeSource.sourceClass);
  assert.equal(classes[0], "CURATED_EVIDENCE");
  assert.ok(classes.indexOf("CURATED_REFERENCE") < classes.indexOf("SYNTHETIC_KNOWLEDGE") || !classes.includes("CURATED_REFERENCE"));
});

test("CATALOG: a science question that merely mentions a body part is answered by evidence first, not exercise rows", async () => {
  const ev = paper("The Calculation, Thresholds and Reporting of Inter-Limb Strength Asymmetry: A Systematic Review", "Inter-limb asymmetry thresholds of 10-15% are commonly used in strength testing.", { document_id: "asym" });
  const io = makeIo({
    fitness_evidence: [{ id: "e", similarity: 0.68, payload: ev }],
    exercises: [{ id: "x", similarity: 0.8, payload: catalogRow("Lunges", "Quadriceps, Glutes") }],
  });
  const r = await retrieveV2("chân trái khỏe hơn chân phải cỡ nào thì phải chỉnh khi tập chân", io);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.sourceClass, "CURATED_EVIDENCE");
});

// ── conflict scope ───────────────────────────────────────────────────────

test("CONFLICT SCOPE: per-meal g/kg and per-day g/kg are NOT competing recommendations", async () => {
  const meal = evidence({ title: "ISSN Nutrient Timing", document_id: "timing", content: "An evenly spaced dose of 0.25-0.40 g/kg per meal of protein maximises muscle protein synthesis" });
  const day = evidence({ title: "ISSN Protein", document_id: "protein", content: "daily protein intake of 1.4-2.0 g/kg body weight per day is sufficient for exercising individuals" });
  assert.equal(detectRangeConflict([cand(meal), cand(day)]), null);
  assert.equal(detectScopeUncertainty([cand(meal), cand(day)]), true);
  const io = makeIo({ fitness_evidence: [{ id: "m", similarity: 0.75, payload: meal }, { id: "d", similarity: 0.74, payload: day }] });
  const r = await retrieveV2("liều protein mỗi bữa và mỗi ngày", io);
  assert.equal(r.documents.length, 2);
  assert.equal((r.documents[0].metadata as any).conflictNote, undefined, "no numeric conflict is declared");
  assert.equal((r.documents[0].metadata as any).conflictScopeUncertain, true);
  assert.match(compactRetrieval(r as any), /không so sánh trực tiếp/);
  assert.doesNotMatch(compactRetrieval(r as any), /không tự chọn một/);
});

test("CONFLICT SCOPE: body-weight vs fat-free-mass denominators and cut vs maintenance contexts are not directly comparable", () => {
  const bw = evidence({ document_id: "a", content: "protein 1.4-2.0 g/kg body weight per day for exercising individuals" });
  const ffm = evidence({ document_id: "b", content: "during energy restriction 2.3-3.1 g/kg of fat free mass per day may preserve muscle" });
  assert.equal(detectRangeConflict([cand(bw), cand(ffm)]), null);
  assert.equal(detectScopeUncertainty([cand(bw), cand(ffm)]), true);
});

test("CONFLICT SCOPE: two truly comparable daily body-weight ranges that disagree still trigger conflict handling", async () => {
  const a = evidence({ document_id: "a", title: "Source A", content: "daily protein intake of 1.0-1.2 g/kg body weight per day is adequate for general adults" });
  const b = evidence({ document_id: "b", title: "Source B", content: "daily protein intake of 1.6-2.2 g/kg body weight per day is recommended for general adults" });
  const c = detectRangeConflict([cand(a), cand(b)]);
  assert.ok(c);
  assert.equal(c!.unit, "g/kg");
  assert.equal(c!.sources.length, 2);
  assert.equal(detectScopeUncertainty([cand(a), cand(b)]), false);
});

test("CONFLICT SCOPE: an unreadable scope is UNKNOWN, never assumed comparable", () => {
  const s = rangeScope("protein 1.0-1.2 g/kg", 8, 20);
  assert.equal(s.time, "UNKNOWN");
  assert.equal(s.denominator, "UNKNOWN");
  assert.equal(comparableScopes(s, s), false);
});

// ── provenance trust ─────────────────────────────────────────────────────

test("PROVENANCE: a pipeline published_at nothing corroborates is NOT rendered as a publication year", () => {
  const p = paper("ACSM Position Stand. Resistance Training Prescription", "RT prescription overview.");
  const y = resolveYear(p);
  assert.equal(y.year, null);
  assert.equal(y.state, "SOURCE_PROVIDED");
  assert.equal(y.unverifiedYear, 2026);
  const s = buildKnowledgeSource("fitness_evidence", p, "p1");
  assert.equal(s.year, null);
  assert.equal(s.yearProvenance, "SOURCE_PROVIDED");
  assert.equal(s.url, "https://doi.org/10.1000/x", "title / URL / id stay usable");
  const text = renderKnowledgeContext(buildKnowledgeContext([{ pageContent: "[paper] x\nCategory: training\nbody", metadata: { knowledgeSource: s, knowledgeRelevance: "PRIMARY" } }]));
  assert.doesNotMatch(text, /2026/);
});

test("PROVENANCE: the year stated in the curated title is VERIFIED; a feed date corroborated by the URL is VERIFIED; an ingestion-timestamp date is INGESTION_DERIVED", () => {
  assert.deepEqual(resolveYear({ title: "ISSN position stand: caffeine and exercise performance (Guest et al. 2021)", published_at: null }), { year: 2021, state: "VERIFIED", unverifiedYear: null });
  const sd = resolveYear({ title: "Omega-3 fish oil shows promise", published_at: "2026-05-24T05:40:19.000Z", source_url: "https://www.sciencedaily.com/releases/2026/05/260524012959.htm" });
  assert.equal(sd.year, 2026);
  assert.equal(sd.state, "VERIFIED");
  const ing = resolveYear({ title: "Some web page", published_at: "2026-10-11T00:00:00.000Z", ingested_at: "2026-10-11T08:00:00.000Z" });
  assert.equal(ing.year, null);
  assert.equal(ing.state, "INGESTION_DERIVED");
  assert.equal(resolveYear({ title: "No date here" }).state, "UNKNOWN");
});

test("PROVENANCE: a collector name is not a publisher; a real source name is", () => {
  assert.deepEqual(resolvePublisher({ source_name: "PubMed E-utilities" }), { publisher: null, state: "INGESTION_DERIVED", collectedVia: "PubMed E-utilities" });
  assert.equal(resolvePublisher({ source_name: "Curated Local Evidence JSONL" }).publisher, null);
  assert.equal(resolvePublisher({ source_name: "ScienceDaily Fitness RSS" }).publisher, null);
  assert.equal(resolvePublisher({ source_name: "ACSM Trending Topics" }).publisher, "ACSM Trending Topics");
  assert.equal(resolvePublisher({ publisher: "American College of Sports Medicine", source_name: "PubMed E-utilities" }).publisher, "American College of Sports Medicine");
  assert.equal(resolvePublisher({}).state, "UNKNOWN");
});

// ── dedup & off-parity are covered by rag-retrieval-v2.test.ts; one cross-check here ──

test("DEDUP: an exact duplicate evidence point (re-ingestion) collapses to one document", async () => {
  const e = paper("Effects of Blood Flow Restriction Therapy in Individuals With Knee Osteoarthritis", "Blood flow restriction therapy improved knee strength.", { document_id: "bfr-a" });
  const io = makeIo({ fitness_evidence: [{ id: "1", similarity: 0.72, payload: e }, { id: "2", similarity: 0.72, payload: { ...e, document_id: "bfr-a-copy", chunk_id: "bfr-a-copy:0" } }] });
  const r = await retrieveV2("tập hạn chế máu BFR có ích không", io);
  assert.equal(r.documents.length, 1);
  assert.equal(r.trace.dropped.duplicate, 1);
});
