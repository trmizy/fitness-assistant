import { test } from "node:test";
import assert from "node:assert/strict";
import { rankChatDocuments, isTemplateGenerated, MAX_SYNTHETIC } from "../retrieval_ranking";
import { detectMythClaims, relevantClaimRules, formatClaimRulesForPrompt } from "../claim_rules";
import { compactRetrieval } from "../prompt_builder";

const doc = (id: string, source: string, score: number, pageContent: string) => ({ id, source, score, pageContent, category: "x", metadata: {} as any });
const faq = (id: string, name: string, score: number) =>
  doc(id, "qdrant:fitness_faq", score, `Q: Nên tập ${name} bao nhiêu set và rep?\nA: Với mục tiêu tăng cơ, ${name} thường hợp khoảng 8-20 reps. Nếu ưu tiên sức mạnh, thử 5-10 reps; nếu ưu tiên sức bền/cảm giác cơ, thử 15-30 reps. Nghỉ giữa set khoảng 45 giây và giữ tempo gợi ý 2-1-2-1.`);

test("RAG ranking: template FAQ rows are tagged, capped and collapsed; curated evidence is not crowded out (eval B1-21 / B2-49)", () => {
  const docs = [
    faq("f1", "Plank", 0.71), faq("f2", "Side Plank", 0.7), faq("f3", "Dead Bug", 0.69), faq("f4", "Bird Dog", 0.68),
    doc("e1", "qdrant:fitness_evidence", 0.62, "[meta_analysis] Weekly set volume and hypertrophy\nCategory: training | Evidence level: high\n10+ sets/week…"),
    doc("k1", "qdrant:fitness_knowledge", 0.6, "Title: Khối lượng tập\nContent: Số hiệp mỗi tuần cho mỗi nhóm cơ…"),
  ];
  const out = rankChatDocuments(docs as any, 5);
  const synthetic = out.filter((d: any) => d.metadata.synthetic);
  assert.equal(synthetic.length, MAX_SYNTHETIC);
  assert.ok(out.some((d) => d.id === "e1"), "evidence kept");
  assert.ok(out.some((d) => d.id === "k1"), "knowledge kept");
  assert.ok(isTemplateGenerated(docs[0] as any));
  assert.ok(!isTemplateGenerated(docs[4] as any));
  assert.match(compactRetrieval({ documents: out, isEmpty: false } as any), /Mẫu tự động từ thư viện bài tập — không phải bằng chứng khoa học/);
});

test("RAG ranking: same id keeps the best score; result never exceeds topK; input untouched", () => {
  const docs = [doc("a", "qdrant:fitness_knowledge", 0.5, "Title: A\nContent: một"), doc("a", "qdrant:fitness_knowledge", 0.7, "Title: A\nContent: một"), doc("b", "qdrant:exercises", 0.6, "Exercise: Plank")];
  const out = rankChatDocuments(docs as any, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 0.7);
  assert.equal(docs.length, 3);
});

// Knowledge regression: the six observed myths (+ spot reduction / rest) are detected in answers and their topic gets a short
// sourced rule. Each pair is (myth answer → detected, correct answer → not detected).
const MYTHS: Array<{ id: string; question: string; myth: string; correct: string }> = [
  { id: "knee_over_toes", question: "Khi tập lunge, đầu gối có được vượt qua mũi chân không?", myth: "Đầu gối **không nên** vượt qua mũi chân để bảo vệ khớp.", correct: "Đầu gối vượt mũi chân là bình thường nếu gối đi theo hướng mũi chân và không đau." },
  { id: "static_stretch_injury", question: "Có nên giãn cơ trước khi tập không?", myth: "Giãn cơ tĩnh trước khi tập giúp ngăn ngừa chấn thương.", correct: "Giãn cơ tĩnh trước tập không làm giảm chấn thương; nên khởi động động." },
  { id: "fasted_cardio", question: "Chạy bộ lúc bụng đói có giảm mỡ tốt hơn không?", myth: "Chạy lúc bụng đói giúp đốt mỡ nhiều hơn so với sau khi ăn.", correct: "Khi tổng năng lượng như nhau, cardio lúc đói không giảm mỡ nhiều hơn." },
  { id: "toning_light_weights", question: "Tập tạ nhẹ nhiều rep có làm săn chắc cơ hơn không?", myth: "Tạ nhẹ nhiều rep sẽ giúp săn chắc cơ, còn tạ nặng làm to cơ.", correct: "Săn chắc là có cơ và ít mỡ; 6–30 rep đều phát triển cơ nếu gần thất bại." },
  { id: "muscle_gain_rate", question: "Tôi nên đặt mục tiêu tăng bao nhiêu kg cơ mỗi tháng?", myth: "Bạn có thể tăng 1–2 kg cơ mỗi tháng.", correct: "Người mới thường tăng khoảng 0,5–1 kg cơ mỗi tháng trong năm đầu." },
  { id: "protein_older_adults", question: "Người trên 60 tuổi có cần nhiều protein hơn không?", myth: "Người cao tuổi không cần tăng protein so với người trẻ.", correct: "Người lớn tuổi nên ăn khoảng 1,0–1,2 g đạm/kg/ngày, cao hơn người trẻ." },
  { id: "spot_reduction", question: "Tập bụng nhiều có giảm mỡ bụng không?", myth: "Tập bụng mỗi ngày sẽ đốt mỡ bụng nhanh.", correct: "Tập bụng nhiều không giúp giảm mỡ bụng tại chỗ." },
];

test("knowledge regression: each myth is detected; the corrected statement is not", () => {
  for (const m of MYTHS) {
    assert.ok(detectMythClaims(m.myth).some((x) => x.id === m.id), `${m.id} not detected: ${m.myth}`);
    assert.ok(!detectMythClaims(m.correct).some((x) => x.id === m.id), `${m.id} false positive: ${m.correct}`);
  }
});

// Nova Pro recheck (2026-11-12): two CORRECT answers were flagged as myths — a conditional knee caveat (B1-17) and an explicit
// rejection of the toning claim (B4-06). Per-sentence evaluation with conditional / negation exemptions.
test("knowledge regression: conditional caveats and explicit rejections are not myths", () => {
  assert.deepEqual(detectMythClaims("Nếu không đau, đầu gối vượt mũi chân là bình thường. Nếu đang đau gối, hạn chế tạm thời việc đầu gối vượt mũi chân để giảm tải.").map((m) => m.id), []);
  assert.deepEqual(detectMythClaims("Theo Schoenfeld (2017), khoảng 6–30 rep đều phát triển cơ nếu tập gần thất bại, tạ nhẹ nhiều rep không có tác dụng \"tone\" riêng.").map((m) => m.id), []);
  assert.ok(detectMythClaims("Rep cao tạ nhẹ tập trung vào sức bền và giúp \"săn chắc\" cơ.").some((m) => m.id === "toning_light_weights"), "the real myth is still caught");
  assert.ok(detectMythClaims("Khi squat, tuyệt đối không để đầu gối vượt qua mũi chân.").some((m) => m.id === "knee_over_toes"), "the absolute rule is still caught");
});

test("knowledge regression: the topic rule is injected only for matching questions (context-on-demand)", () => {
  for (const m of MYTHS) assert.ok(relevantClaimRules(m.question).some((r) => r.id === m.id), `${m.id} rule not selected for: ${m.question}`);
  assert.equal(formatClaimRulesForPrompt("Ngâm nước đá sau khi tập có tốt không?"), "");
  assert.ok(formatClaimRulesForPrompt("Chạy bộ lúc bụng đói có giảm mỡ tốt hơn không?").length < 400, "short rule, not a canned answer");
});
