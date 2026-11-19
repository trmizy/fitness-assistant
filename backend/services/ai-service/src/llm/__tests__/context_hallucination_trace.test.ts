/**
 * V1 stabilization (2026-11-12), Priority 2 — context hallucinations traced from the Nova Pro recheck (REAL HTTP/API, 80 cases).
 *
 * B3-41  "Tôi sắp 60 tuổi, tập tạ có an toàn không?" (persona: no injuries) → "Bạn đã báo cáo đau gói, vì vậy cần tránh…".
 *        Trace: profile.injuries empty (test DB), memories cleared, chat_history skipped (manifest), TurnFacts = age only, notes
 *        and CoachContext rebuilt offline contain no knee. The only block not reproducible offline is retrieval (Cohere
 *        embedding), and the corpus has many "Cẩn trọng nếu đau gối" chunks — source of the phrase NOT VERIFIED. The guard
 *        below removes an injury ATTRIBUTION nobody stated, whatever the source.
 * B4-46  turn 1 answer (stored in the test DB) SUGGESTED "Hạ xuống 55kg"; turn 2 answered "Khi bạn đã giảm tạ xuống 55kg…" —
 *        the model read its own earlier suggestion in chat_history as something the user did. Fix: the history block says which
 *        lines are the user's and that Coach lines are suggestions.
 * B4-25  "Ăn chay thì có tăng cơ được không?" (52 kg woman, NutritionGoal 1874 kcal) → "với meal plan 2800 kcal, mục tiêu đạm
 *        140-156 g". Those exact figures are RAG chunks MP0077/MP0078 (fitness_knowledge, category meal_plan); the prompt had no
 *        personal calorie block. Fix: a meal-plan TEMPLATE reaches the prompt as an example of foods/meal structure with its
 *        kcal/macro figures removed — RAG never supplies the user's numbers (NutritionGoal/engine stay authoritative).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { removeUnsupportedUserClaims } from "../context_fidelity_guard";
import { compactRetrieval, promptBuilder } from "../prompt_builder";
import { planContext } from "../context_plan";
import { inputParser } from "../input_parser";
import { recommendationEngine } from "../recommendation_engine";

const B341_ANSWER = [
  "Tập tạ ở tuổi 60 là hoàn toàn an toàn nếu được thực hiện đúng cách và tôn trọng giới hạn của cơ thể. 💪",
  "",
  "**Lưu ý an toàn:**",
  "- Bạn đã báo cáo đau gói, vì vậy cần tránh các bài tập gây tải trực tiếp lên khu vực này. Thay thế bằng các bài tập không gây đau.",
  "- Nếu triệu chứng đau gói trở nên tồi tệ hơn, hãy tham khảo ý kiến bác sĩ chỉnh hình.",
  "",
  "**Khuyến nghị:**",
  "- Bắt đầu với các bài tập nhẹ như **Bodyweight Squats**, **Wall Push-ups**.",
].join("\n");

test("B3-41: an injury nobody stated is not attributed to the user ('Bạn đã báo cáo đau gói' removed, the conditional safety note kept)", () => {
  const r = removeUnsupportedUserClaims(B341_ANSWER, { question: "Tôi sắp 60 tuổi, tập tạ có an toàn không?" });
  assert.doesNotMatch(r.answer, /báo cáo đau/);
  assert.match(r.answer, /Nếu triệu chứng đau gói trở nên tồi tệ hơn/);
  assert.match(r.answer, /Bodyweight Squats/);
  assert.match(r.answer, /hoàn toàn an toàn/);
});

test("B3-41 control: the same sentence stays when the injury IS on record (profile / asserted this turn)", () => {
  const r = removeUnsupportedUserClaims(B341_ANSWER, { question: "Tôi sắp 60 tuổi, tập tạ có an toàn không?", verifiedProfileFacts: { injury: true } });
  assert.equal(r.answer, B341_ANSWER);
});

test("injury evidence: the user's own first-person pain mention counts even inside a question", () => {
  const ans = "Với tình trạng đau gối của bạn, nên giảm biên độ squat và ưu tiên glute bridge.";
  assert.equal(removeUnsupportedUserClaims(ans, { question: "Tôi đau gối thì tập chân thế nào?" }).answer, ans);
  assert.equal(removeUnsupportedUserClaims(ans, { question: "Em bị đau gối, có nên tập squat không?" }).answer, ans);
});

test("B2-21/B3-19 shape: 'Với tình trạng đau gối…' for a technique question about the KNEE (đầu gối) is removed", () => {
  const ans = "Với tình trạng đau gối, bạn nên giới hạn góc gập 90°. Hãy giữ lưng thẳng khi squat.";
  const r = removeUnsupportedUserClaims(ans, { question: "Khi squat đầu gối có được vượt mũi chân không?" });
  assert.doesNotMatch(r.answer, /tình trạng đau gối/);
  assert.match(r.answer, /giữ lưng thẳng/);
});

test("knee TECHNIQUE wording and generic/conditional pain advice are never removed", () => {
  const ans = [
    "Bạn cần giữ đầu gối hướng theo mũi chân khi squat.",
    "Nếu bạn đau gối khi squat, hãy giảm biên độ.",
    "Người bị đau lưng nên khởi động kỹ hơn.",
    "Bạn có đang đau gối không?",
  ].join("\n");
  assert.equal(removeUnsupportedUserClaims(ans, { question: "Squat bao nhiêu hiệp là đủ?" }).answer, ans);
});

test("a hypothetical injury in the question is not a reported injury", () => {
  const ans = "Bạn đã báo cáo đau lưng nên tránh deadlift.";
  const r = removeUnsupportedUserClaims(ans + " Hãy tập plank.", { question: "Nếu tôi bị đau lưng thì có nên deadlift không?" });
  assert.doesNotMatch(r.answer, /báo cáo đau lưng/);
});

test("fidelity guard is idempotent: running it on its own output changes nothing", () => {
  const ctx = { question: "Tôi sắp 60 tuổi, tập tạ có an toàn không?" };
  const once = removeUnsupportedUserClaims(B341_ANSWER, ctx).answer;
  assert.equal(removeUnsupportedUserClaims(once, ctx).answer, once);
});

test("fidelity guard never removes a safety warning / referral, even next to a removed claim", () => {
  const ans = [
    "Bạn đã báo cáo đau lưng nên cần cẩn thận.",
    "Hãy dừng tập ngay và đi khám bác sĩ nếu thấy đau ngực, chóng mặt hoặc khó thở.",
    "Nếu bạn đang mang thai, hãy hỏi bác sĩ sản khoa trước khi tập.",
    "👨‍👩‍👧 Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên có chứng chỉ giám sát và trao đổi với phụ huynh.",
  ].join("\n");
  const r = removeUnsupportedUserClaims(ans, { question: "Tập tạ có tốt cho người lớn tuổi không?" });
  assert.doesNotMatch(r.answer, /báo cáo đau lưng/);
  for (const keep of ["đi khám bác sĩ nếu thấy đau ngực", "hỏi bác sĩ sản khoa", "trao đổi với phụ huynh"]) assert.match(r.answer, new RegExp(keep));
});

const MEAL_DOC = {
  id: "fitness_knowledge_682",
  pageContent: "Title: Meal plan Tăng cơ 2800 kcal - ăn chay có sữa/trứng\nContent: Meal plan: Meal plan Tăng cơ 2800 kcal - ăn chay có sữa/trứng. Mục tiêu: Tăng cơ. Khoảng 2800 kcal/ngày, protein mục tiêu khoảng 140 g, carb khoảng 384 g, fat khoảng 78 g. Gợi ý thời điểm ăn: Chia protein tương đối đều qua các bữa. Bố cục bữa: Bữa sáng: Đậu đỏ nấu chín, Lê, Táo | Bữa trưa: Sữa tươi không đường, Yến mạch.",
  score: 0.7, source: "qdrant:fitness_knowledge", category: "meal_plan", metadata: { chunk_id: 682 },
};
const OTHER_DOC = { id: "fitness_knowledge_1", pageContent: "Title: Protein\nContent: Người tập tạ cần khoảng 1.6 g/kg protein mỗi ngày.", score: 0.6, source: "qdrant:fitness_knowledge", category: "nutrition", metadata: {} };

test("B4-25: a meal-plan TEMPLATE reaches the prompt without its kcal/macro figures and labelled as an example", () => {
  const text = compactRetrieval({ documents: [MEAL_DOC, OTHER_DOC], isEmpty: false } as any);
  assert.doesNotMatch(text, /2800/);
  assert.doesNotMatch(text, /140 g|384 g|78 g/);
  assert.match(text, /THỰC ĐƠN MẪU/);
  assert.match(text, /Đậu đỏ nấu chín/, "the foods / meal structure stay usable");
  assert.match(text, /1\.6 g\/kg/, "non-template knowledge keeps its numbers");
});

test("B4-25 counterpart: when the user ASKS for the 2800 kcal sample menu, its figures stay (labelled as a sample, not their target)", () => {
  const text = compactRetrieval({ documents: [MEAL_DOC], isEmpty: false } as any, { question: "Cho tôi xem thực đơn mẫu 2800 kcal ăn chay" });
  assert.match(text, /2800 kcal/);
  assert.match(text, /140 g/);
  assert.match(text, /THỰC ĐƠN MẪU/);
  assert.match(text, /không phải mục tiêu/i);
});

const B446_ASSISTANT = "Hãy thử: 1. **Giảm tạ**: Hạ xuống **55kg** và tập 8-12 reps. 2. Sau đó tăng lên 57.5kg rồi 60kg.";
const B446_ANSWER = "Khi bạn đã giảm tạ xuống **55kg** và thoải mái với số lần lặp, hãy tăng dần theo Progressive Overload. Mỗi lần tăng 2.5kg khi hoàn thành đủ reps.";

test("B4-46 provenance: the assistant's own earlier SUGGESTION is not asserted as something the user did", () => {
  const r = removeUnsupportedUserClaims(B446_ANSWER, { question: "Vậy tôi nên tăng tạ thế nào?", sessionUserMessages: ["Bench press của tôi kẹt ở 60kg 3 tuần nay rồi."], assistantTurns: [B446_ASSISTANT] });
  assert.doesNotMatch(r.answer, /bạn đã giảm tạ xuống/);
  assert.match(r.answer, /Mỗi lần tăng 2\.5kg/);
});

test("B4-46 counterparts: a figure the USER stated, a conditional, a recommendation, or a verified record figure are kept", () => {
  const ctx = { question: "Vậy tôi nên tăng tạ thế nào?", assistantTurns: [B446_ASSISTANT] };
  const userSaid = "Bạn đã giảm tạ xuống 55kg, giờ hãy tăng 2.5kg mỗi tuần.";
  assert.equal(removeUnsupportedUserClaims(userSaid, { ...ctx, sessionUserMessages: ["Tôi đã giảm xuống 55kg rồi."] }).answer, userSaid);
  const conditional = "Nếu bạn đã giảm tạ xuống 55kg, hãy tăng dần.";
  assert.equal(removeUnsupportedUserClaims(conditional, ctx).answer, conditional);
  const advice = "Bạn nên giảm tạ xuống 55kg trong 1 tuần.";
  assert.equal(removeUnsupportedUserClaims(advice, ctx).answer, advice);
  const record = "Bạn đã giảm xuống 55kg theo lần đo InBody gần nhất.";
  assert.equal(removeUnsupportedUserClaims(record, { ...ctx, verifiedNumbers: [55] }).answer, record);
});

test("B4-25 control: a non-template document is rendered exactly as before", () => {
  assert.equal(compactRetrieval({ documents: [OTHER_DOC], isEmpty: false } as any), `1. ${OTHER_DOC.pageContent}`);
});

test("B4-46: the chat-history block says Coach lines are earlier SUGGESTIONS, not things the user did", () => {
  const profile: any = { age: 22, gender: "MALE", goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } };
  const q = "Vậy tôi nên tăng tạ thế nào?";
  const parsed = { ...inputParser.parse(q, profile), routeIntent: "general_fitness_knowledge" } as any;
  const rec = recommendationEngine.recommend(profile, parsed, "vi");
  const history = [{ question: "Bench press của tôi kẹt ở 60kg 3 tuần nay rồi.", answer: "Hãy thử: 1. **Giảm tạ**: Hạ xuống **55kg** và tập 8-12 reps." }];
  const plan = planContext({ intent: "general_fitness_knowledge", question: q, personalQuestion: true, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: true });
  const prompt = promptBuilder.build(q, parsed, { profile, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], memories: [] } as any, { documents: [], isEmpty: true } as any, rec, "vi", history as any, undefined, { contextPlan: plan } as any);
  const block = prompt.slice(prompt.indexOf("Lịch sử hội thoại"));
  assert.match(block, /Hạ xuống \*\*55kg\*\*/, "the history itself is still provided");
  assert.match(block, /gợi ý/i);
  assert.match(block, /không (được )?coi .*(user|người dùng) đã làm/i);
});
