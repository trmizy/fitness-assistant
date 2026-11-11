/**
 * Phase 4.7R3 — symptom safety guard + Programming closure (docs/ai-product/phase4-7r3-symptom-safety-programming-closure.md).
 * TEST FIXTURE: deterministic; no Qdrant / Ollama / LLM. Assertions describe signal CLASSES, not held-out sentences.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveSafetySignals } from "../llm/safety-signals";
import { detectConcepts } from "../llm/fitness-concepts";
import { retrieveV2, type V2Io } from "../llm/retrieval-v2";
import { retrievalDocumentFromPayload, ragRetrievalV2Enabled } from "../llm/retriever";
import { classifyInterpretationQuestion } from "../conversational-intelligence/global/personalized-interpretation";

const lvl = (q: string) => resolveSafetySignals(q).level;
const cls = (q: string) => resolveSafetySignals(q).signals.map((s) => s.cls);
const ids = (q: string) => detectConcepts(q).concepts.map((c) => c.id);

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
const cat = (name: string) => ({ id: 3, exerciseName: name, typeOfActivity: "Strength", typeOfEquipment: "Bodyweight", bodyPart: "Core", type: "Static", muscleGroupsActivated: "Abdominals", instructions: "Hold." });

// ── signal classes ───────────────────────────────────────────────────────

test("SAFETY SIGNALS: post-surgical and postpartum state are HIGH_RISK (class, not one sentence)", () => {
  for (const q of ["mới mổ ruột thừa tuần trước, bao giờ tập bụng lại", "sau phẫu thuật thay khớp gối tập chân thế nào", "hậu phẫu thoát vị bẹn khi nào mang vác", "after knee surgery when can I squat", "sinh mổ xong bao lâu thì tập core lại"]) {
    assert.equal(lvl(q), "HIGH_RISK", q);
    assert.ok(cls(q).includes("POST_SURGICAL_STATE"), q);
  }
  for (const q of ["sinh thường được 6 tuần có tập lại tạ chưa", "tập core sau sinh bắt đầu từ bài nào", "đang cho con bú tuần thứ ba tập cardio được chưa", "postpartum diastasis recti workout"]) assert.equal(lvl(q), "HIGH_RISK", q);
  assert.ok(cls("tập tạ nặng lúc đang có thai").includes("PREGNANCY_STATE"));
});

test("SAFETY SIGNALS: radiating pain, neurological cue, sudden pop/snap, acute trauma, cardio red flags, fainting", () => {
  assert.ok(cls("đau lan xuống chân sau khi gánh tạ nặng").includes("RADIATING_PAIN"));
  assert.ok(cls("đau chạy từ hông xuống tận mắt cá khi nâng tạ").includes("RADIATING_PAIN"));
  assert.ok(cls("pain shooting down my leg after deadlifts").includes("RADIATING_PAIN"));
  assert.ok(cls("tê bì hai bàn chân sau khi squat nặng").includes("NEUROLOGICAL_SYMPTOM"));
  assert.ok(cls("bỗng yếu hẳn một bên tay khi đẩy tạ").includes("NEUROLOGICAL_SYMPTOM"));
  assert.ok(cls("vừa nghe tiếng bục ở bắp chân khi bật nhảy").includes("SUDDEN_POP_OR_SNAP"));
  assert.ok(cls("nghe rắc một tiếng ở đầu gối rồi khuỵu xuống").includes("SUDDEN_POP_OR_SNAP"));
  assert.ok(cls("felt a pop in my knee during squats").includes("SUDDEN_POP_OR_SNAP"));
  assert.ok(cls("trượt chân ngã mạnh, cổ chân sưng to không đi được").includes("ACUTE_TRAUMA_EVENT"));
  assert.ok(cls("tức nặng giữa ngực và vã mồ hôi lạnh khi tập").includes("CHEST_OR_CARDIO_RED_FLAG"));
  assert.ok(cls("chest pain while running").includes("CHEST_OR_CARDIO_RED_FLAG"));
  assert.ok(cls("chạy tới giữa chừng thì choáng và suýt ngất").includes("SEVERE_DIZZINESS_OR_FAINTING"));
  assert.ok(cls("ngất ngay sau set deadlift nặng").includes("SEVERE_DIZZINESS_OR_FAINTING"));
  for (const q of ["đau lan xuống chân kèm tê", "ho ra máu sau buổi chạy cường độ cao", "thở không nổi dù mới khởi động, tim đập loạn"]) assert.equal(lvl(q), "HIGH_RISK", q);
});

test("SAFETY NEGATIVE CONTROLS: ordinary soreness, benign fatigue, normal exertion and prevention phrasing are NOT safety signals", () => {
  for (const q of ["đau cơ nhẹ hai ngày sau buổi tập chân là bình thường", "ê ẩm đùi sau squat nặng hôm qua", "mỏi lưng nhẹ sau deadlift", "mệt rã rời sau buổi cardio dài", "tim đập nhanh khi chạy nước rút là bình thường", "tập vai thế nào để không đau", "bài kéo tay sau nên tập thế nào", "tập ngực nặng hôm nay, ngực nặng cả buổi", "rơi tạ xuống sàn thì làm sao cho an toàn", "đạp xe xuống dốc nhanh có tốt cho tim mạch không"]) {
    assert.equal(lvl(q), "NONE", q);
  }
});

test("SAFETY COMPOSITION: pain alone is not high risk; pain + location is CAUTION; pain + radiation/neurological/event is HIGH_RISK; general-knowledge phrasing is downgraded", () => {
  assert.equal(lvl("đau khớp gối khi leo cầu thang"), "CAUTION");
  assert.equal(lvl("đau lan xuống chân kèm tê"), "HIGH_RISK");
  assert.equal(lvl("đau thần kinh tọa là gì"), "CAUTION", "a general question about a symptom class is not a personal red flag");
  assert.equal(lvl("đau nhói đột ngột ở vai"), "HIGH_RISK");
});

test("SAFETY accent policy: 'mở/mỡ/mờ' never become post-operative 'mổ'", () => {
  assert.equal(lvl("cờ vua mở đầu như thế nào cho người mới"), "NONE");
  assert.equal(lvl("giảm mỡ vừa mới bắt đầu nên ăn gì"), "NONE");
  assert.equal(lvl("mơ hồ về lịch tập"), "NONE");
  assert.equal(lvl("sau mo tap bung duoc chua"), "HIGH_RISK", "unaccented typing keeps the explicit accentless alias");
});

// ── precedence / structural invariant ────────────────────────────────────

test("PRECEDENCE: a recognised symptom/state beats exercise, catalog and programming terms — no embedding, no generic content", async () => {
  const io = makeIo({
    fitness_evidence: [{ id: "a", similarity: 0.8, payload: paper("Unilateral Plyometric Training Effectively Reduces Lower Limb Asymmetry", "plyometric jump training reduces asymmetry in athletes") }],
    exercises: [{ id: "x", similarity: 0.8, payload: cat("Plank") }],
    fitness_faq: [{ id: "f", similarity: 0.9, payload: faq("Tập core sau sinh thế nào?", "Tập plank mỗi ngày.") }],
  });
  for (const q of ["vừa nghe tiếng bục ở bắp chân khi bật nhảy", "sinh mổ xong bao lâu thì tập core lại", "đau lan xuống chân sau khi gánh tạ nặng", "nhịp tim tăng vọt rồi hụt hơi khi đang squat"]) {
    const r = await retrieveV2(q, io);
    assert.equal(r.isEmpty, true, q);
    assert.equal(r.trace.embeddings, 0, `${q}: safety resolution precedes every embedding`);
  }
  assert.equal(io.calls.search.length, 0);
});

test("STRUCTURAL INVARIANT: under any safety level only trusted curated evidence TITLED for the condition can be the supporting context", async () => {
  const oa = paper("Effects of Blood Flow Restriction Therapy in Individuals With Knee Osteoarthritis: Overview of Systematic Reviews", "BFR therapy improved knee function in osteoarthritis.", { document_id: "oa" });
  const generic = paper("Progressive Overload Affects the Magnitude of Muscle Hypertrophy", "overload and training of the knee extensors", { document_id: "g" });
  const io = makeIo({ fitness_evidence: [{ id: "g", similarity: 0.85, payload: generic }, { id: "o", similarity: 0.74, payload: oa }], fitness_faq: [{ id: "f", similarity: 0.9, payload: faq("Đau gối khi tập thì sao?", "Nghỉ ngơi.") }], exercises: [{ id: "x", similarity: 0.9, payload: cat("Leg Press") }] });
  const r = await retrieveV2("đau khớp gối do thoái hóa, tập BFR được không", io);
  assert.ok(r.documents.length >= 1);
  assert.ok(r.documents.every((d) => (d.metadata as any).knowledgeSource.sourceClass === "CURATED_EVIDENCE" && /Osteoarthritis/i.test((d.metadata as any).knowledgeSource.title)));
});

test("MISSING TRUSTED SAFETY EVIDENCE ⇒ abstention (never the closest generic article)", async () => {
  const generic = paper("Progressive Overload Affects the Magnitude of Muscle Hypertrophy", "heavy load training of the lower back muscles", { document_id: "g" });
  const io = makeIo({ fitness_evidence: [{ id: "g", similarity: 0.85, payload: generic }] });
  for (const q of ["thoát vị đĩa đệm L4 L5 có tập hip thrust được không", "huyết áp cao 150 trên 95 tập nặng được không", "đang mang bầu ba tháng cuối tập squat được không"]) {
    const r = await retrieveV2(q, io);
    assert.equal(r.isEmpty, true, q);
  }
});

test("SAFETY OVERRIDES PERSONALIZATION: a personal-metric question that carries a symptom/state is not claimed by the interpretation layer", () => {
  assert.equal(classifyInterpretationQuestion("Squat của tôi đang tăng nhưng giờ đau lan xuống chân, điều đó có ý nghĩa gì?"), null);
  assert.equal(classifyInterpretationQuestion("Protein của tôi thấp hơn target, mới mổ xong có ý nghĩa gì?"), null);
  assert.ok(classifyInterpretationQuestion("Protein logged của tôi thấp hơn target 10g, điều đó có ý nghĩa gì?"), "the ordinary personal interpretation is unaffected");
});

// ── programming ──────────────────────────────────────────────────────────

test("PROGRAMMING: concept-level aliases for everyday phrasing resolve (no sentence memorisation)", () => {
  assert.ok(ids("dừng cách giới hạn mấy rep là đủ kích thích").includes("failure"));
  assert.ok(ids("đánh tới fail ở set cuối thôi hay mọi set").includes("failure"));
  assert.ok(ids("thứ tự bài trong buổi: bài nặng đầu hay bài cô lập đầu").includes("pre_exhaustion"));
  assert.ok(ids("khi nào nên làm mới hẳn giáo trình tập").includes("periodization"));
  assert.ok(ids("buổi tập kéo dài 90 phút có quá dài không").includes("session_duration"));
  assert.ok(ids("vol tuần của lưng nên là mấy set").includes("volume"));
  assert.ok(ids("quá tải tiến triển theo kiểu double progression").includes("progressive_overload"));
  assert.ok(ids("tập mỗi nhóm hai lần một tuần ổn không").includes("frequency"));
  assert.ok(ids("khi nào volume chạm MRV").includes("volume_landmarks"));
});

test("PROGRAMMING CONTENT GAP stays a gap: a related-but-unrelated paper does not count for a vocabulary definition", async () => {
  const unrelated = paper("Progressive Overload Affects the Magnitude of Muscle Hypertrophy", "Progressive overload and training volume affect hypertrophy; drop sets were not studied.", { document_id: "po" });
  const io = makeIo({ fitness_evidence: [{ id: "p", similarity: 0.78, payload: unrelated }] });
  assert.equal((await retrieveV2("superset là gì", io)).isEmpty, true);
  assert.equal((await retrieveV2("RPE 8 nghĩa là sao", io)).isEmpty, true, "RPE/RIR mention-only guard preserved");
});

// ── R2 regressions ───────────────────────────────────────────────────────

test("R2 REGRESSIONS: diacritic, ambiguous English, association, recovery context, plus the V3 classes (activity word prefix, 'đồng hồ' = clock)", async () => {
  assert.ok(!ids("canh nêm đậm đà thêm muối").includes("protein"));
  assert.ok(!ids("món canh thanh đạm cho người già").includes("protein_safety"));
  assert.equal(detectConcepts("bench warrant nghĩa là gì trong luật hình sự").status, "AMBIGUOUS");
  assert.ok(!ids("quán cà phê nào yên tĩnh").includes("caffeine"));
  assert.ok(!ids("làm sao để ngủ ngon hơn khi trời nóng").includes("sleep"));
  assert.ok(!ids("đi bơi buổi sáng nước biển lạnh quá có nên xuống không").includes("cardio"), "đi bơi ≠ đi bộ");
  assert.ok(!ids("đi bộ trong công viên buổi tối có mát không").includes("cardio"), "an everyday activity word needs training/benefit context");
  assert.ok(ids("đi bộ mỗi ngày có giúp giảm mỡ không").includes("cardio"));
  assert.ok(!ids("rối loạn đồng hồ sinh học khi bay qua nhiều múi giờ").includes("wearable"));
  assert.ok(ids("đồng hồ thông minh đo nhịp tim có chính xác không").includes("wearable"));
});

// ── frozen baseline / flags ──────────────────────────────────────────────

test("QDRANT FROZEN: this phase's snapshots carry the same id/content hashes and counts as the end of 4.7R2", () => {
  const dir = path.resolve(__dirname, "../../../../../data/eval/retrieval");
  const a = JSON.parse(fs.readFileSync(path.join(dir, "qdrant-snapshot-post-phase4-7r2-2026-10-11.json"), "utf8")).collections;
  const b = JSON.parse(fs.readFileSync(path.join(dir, "qdrant-snapshot-pre-phase4-7r3-2026-10-11.json"), "utf8")).collections;
  const expected: Record<string, number> = { fitness_evidence: 187, fitness_knowledge: 7072, fitness_faq: 5946, exercises: 207 };
  for (const [c, n] of Object.entries(expected)) { assert.equal(b[c].points, n); assert.equal(a[c].idSetHash, b[c].idSetHash); assert.equal(a[c].contentSetHash, b[c].contentSetHash); }
});

test("OFF-MODE: RAG_RETRIEVAL_V2 stays default OFF", () => {
  const prev = process.env.RAG_RETRIEVAL_V2;
  delete process.env.RAG_RETRIEVAL_V2;
  try { assert.equal(ragRetrievalV2Enabled(), false); } finally { if (prev !== undefined) process.env.RAG_RETRIEVAL_V2 = prev; }
});
