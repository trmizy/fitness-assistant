/**
 * Phase 4.7R2 — OOD / safety / programming generalisation (docs/ai-product/phase4-7r2-ood-safety-generalization.md).
 * TEST FIXTURE: deterministic, no Qdrant / Ollama / LLM. Live-Qdrant numbers live in the doc and data/eval/retrieval/*.json.
 * These tests assert GENERIC behaviour classes, not held-out sentences.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { detectConcepts } from "../llm/fitness-concepts";
import { retrieveV2, type V2Io } from "../llm/retrieval-v2";
import { retrievalDocumentFromPayload, ragRetrievalV2Enabled } from "../llm/retriever";
import { evaluateGate } from "../llm/rag-gate";

const ids = (q: string) => detectConcepts(q).concepts.map((c) => c.id);
const status = (q: string) => detectConcepts(q).status;

type Hit = { id: string; similarity: number; payload: Record<string, unknown> };
function makeIo(by: Record<string, Hit[]>): V2Io & { calls: { embed: string[]; search: string[] } } {
  const calls = { embed: [] as string[], search: [] as string[] };
  return { calls, embed: async (t) => { calls.embed.push(t); return [0.1]; }, search: async (c) => { calls.search.push(c); return by[c] ?? []; }, toDoc: (c, p, s, id) => retrievalDocumentFromPayload(c, p, s, id) };
}
const paper = (title: string, content: string, over: Record<string, unknown> = {}) => ({
  title, source_type: "paper", category: "training", content, source_url: "https://doi.org/10.1000/x", evidence_level: "peer_reviewed",
  created_from: "knowledge_update_pipeline", source_file: "pubmed:eutils", document_id: `d-${title.slice(0, 6)}`, chunk_id: `d-${title.slice(0, 6)}:0`, ...over,
});
const faq = (q: string, a: string) => ({ id: 1, faqId: "F", questionVi: q, answerVi: a, category: "x", tags: "" });
const catalog = (name: string) => ({ id: 3, exerciseName: name, typeOfActivity: "Strength", typeOfEquipment: "Bodyweight", bodyPart: "Core", type: "Static", muscleGroupsActivated: "Abdominals", instructions: "Hold." });

// ── Vietnamese diacritics ────────────────────────────────────────────────

test("DIACRITICS: an accented word that folds to an alias token but is a DIFFERENT lexical item never activates the concept", () => {
  assert.ok(!ids("canh nêm đậm đà thêm bao nhiêu muối").includes("protein"), "đậm ≠ đạm");
  assert.ok(ids("ăn bao nhiêu đạm mỗi ngày").includes("protein"));
  // generic collision families (not one string): mỡ/mơ, cơ/cờ/cổ, tập/tạp, cân/căn, mất/mắt, nặng/nắng, bụng/bừng
  assert.ok(!ids("mơ hồ về tương lai nghề nghiệp").includes("fat_loss"));
  assert.ok(!ids("cờ vua mở đầu như thế nào").includes("hypertrophy"));
  assert.ok(!ids("tạp chí kiến trúc nào hay").includes("frequency"));
  assert.ok(!ids("căn hộ hai phòng ngủ giá nào").some((i) => ["energy_intake", "surplus_bulk", "fat_loss"].includes(i)));
  assert.ok(!ids("trời nắng gắt quá").includes("load_intensity"));
  assert.ok(ids("giảm cân nhanh có mất cơ không").includes("fat_loss"));
  assert.ok(ids("tập tạ nặng hay nhẹ").includes("load_intensity"));
});

test("DIACRITICS: unaccented input uses the explicit accentless alias; mixed/legit accented readings still resolve", () => {
  assert.ok(ids("an bao nhieu dam moi ngay de len co").includes("protein"));
  assert.ok(ids("tang ta deu moi tuan co can thiet khong").includes("progressive_overload"));
  assert.ok(ids("bao nhiêu set mỗi tuần thì đủ").includes("volume"), "bao nhiêu (nhiêu) is a legitimate reading");
  assert.ok(ids("đổi hẳn chương trình tập khi đã chững").includes("periodization"), "hẳn is a legitimate reading of 'han'");
  assert.ok(status("chóng mặt khi tập là dấu hiệu gì") === "SAFETY", "chóng mặt (mặt) is a legitimate reading");
  assert.ok(ids("ngũ cốc ăn sáng nên chọn loại nào").length === 0 || !ids("ngũ cốc ăn sáng nên chọn loại nào").includes("sleep"));
});

// ── ambiguous English terms ──────────────────────────────────────────────

test("AMBIGUOUS: a polysemous token alone is not enough — it needs positive fitness context, and incompatible context vetoes it", () => {
  for (const q of ["bench", "plank", "curl", "bench warrant nghĩa là gì", "curl command download file", "mua plank gỗ làm kệ", "press conference mấy giờ", "gửi bulk email", "split screen điện thoại", "sốt chấm dip"]) {
    const d = detectConcepts(q);
    assert.ok(d.concepts.length === 0 && d.catalog.length === 0, `${q}: no fitness concept activated`);
    assert.ok(["AMBIGUOUS", "OUT_OF_DOMAIN", "UNRESOLVED"].includes(d.status), q);
  }
  assert.equal(status("bench warrant nghĩa là gì trong luật hình sự"), "AMBIGUOUS");
});

test("AMBIGUOUS: the same token WITH fitness context (or a compound that names the exercise) is a fitness concept", () => {
  assert.ok(detectConcepts("plank giữ mấy giây mỗi hiệp để tập bụng").catalog.length > 0);
  assert.ok(detectConcepts("bench press nên để khuỷu tay thế nào").catalog.length > 0, "'bench press' is itself unambiguous");
  assert.ok(detectConcepts("hammer curl khác biceps curl ở đâu").catalog.length > 0);
  assert.ok(ids("đang cut thì nên giữ mức đạm thế nào").includes("fat_loss"));
  assert.ok(ids("tập tạ nặng 3 set 8 rep, cut mỡ").length > 0);
});

test("AMBIGUOUS/OOD happens BEFORE any embedding or search (no concept expansion for unsupported scope)", async () => {
  const io = makeIo({ fitness_evidence: [{ id: "e", similarity: 0.8, payload: paper("Progressive overload", "overload") }], exercises: [{ id: "x", similarity: 0.8, payload: catalog("Plank") }] });
  for (const q of ["bench warrant nghĩa là gì", "giá một tấm plank gỗ sồi dày 3 cm", "curl command to download a file"]) {
    const r = await retrieveV2(q, io);
    assert.equal(r.isEmpty, true, q);
    assert.equal(r.trace.embeddings, 0, q);
  }
  assert.equal(io.calls.search.length, 0);
  assert.equal(io.calls.embed.length, 0);
});

// ── associative overreach, recovery context ───────────────────────────────

test("ASSOCIATIVE: nothing is inferred by loose association (coffee ≠ caffeine, a beverage named water ≠ hydration, food flavour ≠ protein)", () => {
  assert.ok(!ids("cà phê muối pha thế nào cho ngon").includes("caffeine"));
  assert.ok(!ids("quán cà phê nào yên tĩnh để làm việc").includes("caffeine"));
  assert.ok(!ids("uống nước dừa mỗi ngày có tốt cho da không").includes("hydration"));
  assert.ok(!ids("nước ép cam bảo quản bao lâu").includes("hydration"));
  assert.ok(ids("tập ngoài trời nóng nên uống bao nhiêu nước").includes("hydration"));
  assert.ok(ids("cà phê trước buổi tập bao nhiêu mg").includes("caffeine"));
});

test("RECOVERY: sleep / stress / fatigue alone are ordinary life; they mean sports recovery only next to training context", () => {
  for (const q of ["làm sao để ngủ ngon hơn khi trời nóng", "mất ngủ vì áp lực công việc", "stress thi cử làm mình ăn không ngon", "nệm nào ngủ thoải mái hơn"]) assert.ok(!ids(q).some((i) => ["sleep", "stress", "overtraining", "recovery"].includes(i)), q);
  assert.ok(ids("ngủ ít trước buổi tập chân nặng thì hiệu suất giảm không").includes("sleep"));
  assert.ok(ids("sau buổi tập nặng mệt rã rời mấy ngày thì cần giảm tải").includes("deload"));
});

// ── safety recognition and fail-closed ───────────────────────────────────

test("SAFETY: natural-language families (not one string) are recognised as safety concepts", () => {
  const families: Record<string, string[]> = {
    pregnancy: ["đang mang bầu ba tháng cuối tập squat được không", "có thai tuần 20 tập tạ nặng", "tập tạ nặng lúc đang có thai tháng thứ năm", "pregnant women lifting weights", "mẹ bầu uống creatine được không", "sau sinh hai tháng khi nào tập lại"],
    hypertension: ["huyết áp tâm thu 160 tập tạ được không", "người cao huyết áp nên tránh bài nào", "hypertension and heavy deadlift", "huyet ap cao co tap ta nang duoc khong"],
    cardio: ["tim đập lệch nhịp khi gồng tạ", "tức ngực lan ra cánh tay lúc tập", "chest pain during squats", "người từng bị bệnh tim tập tạ", "chóng mặt khi tập là dấu hiệu gì"],
    diabetes: ["bị tiểu đường tập lúc đói có hạ đường huyết không", "diabetes insulin timing before gym", "đường huyết cao sau buổi tập"],
    spine: ["thoát vị đĩa đệm L4 L5 tập hip thrust", "đau thắt lưng mãn tính nên tránh bài nào", "sciatica nerve pain after deadlift", "lưng dưới nhói khi cúi cầm tạ"],
    acute: ["đau nhói đột ngột ở bắp đùi sau khi chạy nước rút", "bong gân cổ chân tập chân được chưa", "nghi gãy xương ngón tay khi rơi tạ", "đứt dây chằng chéo trước sau mổ"],
    reds: ["ăn rất ít mà vẫn tập nặng, tụt kinh nguyệt", "thiếu hụt năng lượng tương đối trong thể thao là gì"],
  };
  for (const [fam, qs] of Object.entries(families)) for (const q of qs) assert.equal(status(q), "SAFETY", `${fam}: ${q}`);
});

test("SAFETY FAIL-CLOSED: a recognised safety query never falls through to generic training evidence, FAQ, practitioner text or catalog", async () => {
  const generic = paper("Progressive Overload Affects the Magnitude of Muscle Hypertrophy", "Progressive overload and heavy load training increase hypertrophy and strength.");
  const bfr = paper("Blood Flow Restriction Training, Molecular Modulators, and Musculoskeletal Health", "BFR with low load improves muscle in the elderly; injury risk considerations.");
  const ff = faq("Tập nặng khi đang mang thai có được không?", "Hãy tập nhẹ nhàng và hỏi bác sĩ.");
  const io = makeIo({ fitness_evidence: [{ id: "g", similarity: 0.8, payload: generic }, { id: "b", similarity: 0.78, payload: bfr }], fitness_faq: [{ id: "f", similarity: 0.88, payload: ff }], exercises: [{ id: "x", similarity: 0.8, payload: catalog("Plank") }] });
  for (const q of ["tập tạ nặng lúc đang có thai tháng thứ năm", "huyết áp cao 150 trên 95 thì tập nặng được không", "tim đập lệch nhịp khi gồng tạ nặng", "lưng dưới nhói khi cúi xuống cầm tạ"]) {
    const r = await retrieveV2(q, io);
    assert.equal(r.isEmpty, true, q);
    assert.equal(r.documents.length, 0, q);
  }
});

test("SAFETY: relevant trusted curated evidence whose TITLE is about the condition IS returned", async () => {
  const oa = paper("Effects of Blood Flow Restriction Therapy in Individuals With Knee Osteoarthritis: Overview of Systematic Reviews", "BFR therapy improved knee strength in osteoarthritis.", { document_id: "oa" });
  const io = makeIo({ fitness_evidence: [{ id: "o", similarity: 0.74, payload: oa }], fitness_faq: [{ id: "f", similarity: 0.9, payload: faq("BFR có tốt không?", "Có.") }] });
  const r = await retrieveV2("tập BFR cho người thoái hóa khớp gối được không", io);
  assert.equal(r.documents.length, 1);
  assert.equal((r.documents[0].metadata as any).knowledgeSource.sourceClass, "CURATED_EVIDENCE");
});

// ── programming aliases & RPE guard ──────────────────────────────────────

test("PROGRAMMING: aliases for plan change, adherence, exercise order, rest interval, tempo and failure resolve", () => {
  assert.ok(ids("bao lâu thì nên đổi hẳn chương trình tập khi đã chững").includes("periodization"));
  assert.ok(ids("đánh giá mình có bám sát lịch tập hay không").includes("adherence"));
  assert.ok(ids("đánh bài cô lập trước rồi mới đến bài nhiều khớp").includes("pre_exhaustion"));
  assert.ok(ids("nghỉ bao nhiêu phút giữa các hiệp squat nặng").includes("rest_interval"));
  assert.ok(ids("nâng chậm hay nâng nhanh thì cơ to hơn").includes("tempo"));
  assert.ok(ids("tập tới thất bại cơ mỗi set có cần không").includes("failure"));
  assert.ok(ids("tần suất tập mỗi nhóm cơ hai lần hay ba lần mỗi tuần").includes("frequency"));
});

test("RPE/RIR GUARD (preserved): a passing mention is not support for a vocabulary concept", async () => {
  const incidental = paper("Cool in theory, not in practice: interset palm cooling", "Ratings of perceived exertion (RPE) were lower with palm cooling.");
  const r = await retrieveV2("RPE 8 nghĩa là sao khi tập tạ", makeIo({ fitness_evidence: [{ id: "p", similarity: 0.75, payload: incidental }] }));
  assert.equal(r.isEmpty, true);
});

test("OOD families (legal / software / material / weather / shopping / population / medical / food-composition) return NO_RELEVANT_KNOWLEDGE", async () => {
  const io = makeIo({ fitness_evidence: [{ id: "e", similarity: 0.8, payload: paper("ISSN Position Stand: Protein and Exercise (2017)", "protein intake g/kg", { evidence_level: "expert_consensus" }) }], fitness_faq: [{ id: "f", similarity: 0.8, payload: faq("Protein mỗi ngày bao nhiêu?", "1.6 g/kg") }] });
  for (const q of ["luật thuế thu nhập cá nhân năm nay có gì mới", "viết regex kiểm tra email trong javascript", "dự báo thời tiết cuối tuần ở Đà Lạt", "giá iphone mới nhất bao nhiêu tiền", "bé 5 tuổi biếng ăn thì nên bổ sung protein nào", "mật độ xương thấp ở người cao tuổi nên bổ sung gì", "bao nhiêu gram protein trong một ức gà"]) {
    const r = await retrieveV2(q, io);
    assert.equal(r.isEmpty, true, q);
  }
});

// ── frozen baseline & gate plumbing ──────────────────────────────────────

test("GATE: unsafeGenericSafetyFallthrough is a hard zero-gate (fails closed without data)", () => {
  const th = { topicHit_at3_inScope_min: 0.6, relevantCuratedEvidence_at3_sciQueries_min: 0.55, syntheticTop1Rate_noSynthQueries_max: 0.15, duplicateRate_max: 0.05, falseSourceRate_outOfScope_max: 0.2, emptyRetrievalRate_inScope_max: 0.25, unsafeGenericSafetyFallthrough_max: 0, domainFloors: { PROGRAMMING: 0.55 } };
  const m = { topicHit_at3_inScope: 0.8, relevantCuratedEvidence_at3_sciQueries: 0.8, syntheticTop1Rate_noSynthQueries: 0, duplicateRate: 0, falseSourceRate_outOfScope: 0.1, emptyRetrievalRate_inScope: 0.1 };
  const bad = evaluateGate({ ...m, unsafeGenericSafetyFallthrough: { n: 10, count: 1 } }, th, { byDomain: { PROGRAMMING: { topicHit_at3: 0.6 } } });
  assert.equal(bad.checks.unsafeGenericSafetyFallthrough, false);
  assert.equal(evaluateGate({ ...m, unsafeGenericSafetyFallthrough: { n: 10, count: 0 } }, th, { byDomain: { PROGRAMMING: { topicHit_at3: 0.6 } } }).passAll, true);
  assert.equal(evaluateGate(m, th, { byDomain: { PROGRAMMING: { topicHit_at3: 0.6 } } }).checks.unsafeGenericSafetyFallthrough, false);
  assert.equal(evaluateGate({ ...m, unsafeGenericSafetyFallthrough: { n: 10, count: 0 } }, th, { byDomain: { PROGRAMMING: { topicHit_at3: 0.4 } } }).checks.domainFloor_PROGRAMMING, false);
});

test("QDRANT FROZEN: the recorded snapshots for this phase carry identical id/content hashes and the expected counts", () => {
  const dir = path.resolve(__dirname, "../../../../../data/eval/retrieval");
  const pre = JSON.parse(fs.readFileSync(path.join(dir, "qdrant-snapshot-pre-phase4-7r2-2026-10-11.json"), "utf8")).collections;
  const prev = JSON.parse(fs.readFileSync(path.join(dir, "qdrant-snapshot-post-phase4-7r-ingest-2026-10-11.json"), "utf8")).collections;
  const expected: Record<string, number> = { fitness_evidence: 187, fitness_knowledge: 7072, fitness_faq: 5946, exercises: 207 };
  for (const [c, n] of Object.entries(expected)) {
    assert.equal(pre[c].points, n);
    assert.equal(pre[c].idSetHash, prev[c].idSetHash);
    assert.equal(pre[c].contentSetHash, prev[c].contentSetHash);
  }
});

test("OFF-MODE: RAG_RETRIEVAL_V2 stays default OFF", () => {
  const prev = process.env.RAG_RETRIEVAL_V2;
  delete process.env.RAG_RETRIEVAL_V2;
  try { assert.equal(ragRetrievalV2Enabled(), false); } finally { if (prev !== undefined) process.env.RAG_RETRIEVAL_V2 = prev; }
});
