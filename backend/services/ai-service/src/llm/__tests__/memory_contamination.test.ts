import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySpeechAct, classifyMessageSpeechAct } from "../speech_act";
import { classifyMemoryFact, classifyMemoryDomain } from "../memory_policy";
import { selectPromptMemories } from "../memory_selection";
import { persistDeterministicMemoryCandidates } from "../memory_extraction";
import { removeUnsupportedUserClaims } from "../context_fidelity_guard";
import { conversationRepository } from "../../repositories/conversation.repository";

test("speech act: questions, hypotheticals, commands, statements (VI + EN)", () => {
  const cases: Array<[string, string]> = [
    ["Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?", "QUESTION"],
    ["Em vừa sinh con được 6 tuần, giờ tập bụng được chưa", "QUESTION"], // no "?"
    ["Ăn chay thì có tăng cơ được không", "QUESTION"],
    ["Tập 5 buổi mỗi tuần liệu có quá nhiều với người mới không", "QUESTION"],
    ["Vậy tôi nên tăng tạ thế nào", "QUESTION"],
    ["Nếu tôi ăn chay thì có tăng cơ được không", "HYPOTHETICAL"],
    ["Giả sử tôi tập 6 buổi một tuần", "HYPOTHETICAL"],
    ["Lên giúp em một buổi tập chân nhé.", "COMMAND"],
    ["Hãy đổi bài squat sang leg press", "COMMAND"],
    ["Tôi không ăn thịt.", "STATEMENT"], // a negation is not a question
    ["Tôi không thích chạy bộ", "STATEMENT"],
    ["Tôi chưa tập bài nào bao giờ", "STATEMENT"],
    ["Em thích tập buổi tối", "STATEMENT"],
    ["Nhớ giúp tôi là tôi ăn chay", "STATEMENT"],
    ["Should I train fasted?", "QUESTION"],
    ["I don't eat pork.", "STATEMENT"],
  ];
  for (const [s, act] of cases) assert.equal(classifySpeechAct(s), act, s);
  assert.equal(classifyMessageSpeechAct("Em tập lúc 6 giờ sáng. Thế buổi sáng em nên ăn gì?"), "QUESTION");
});

test("memory policy: questions and hypotheticals are never saved as facts (eval B4-37 / B4-25)", () => {
  assert.equal(classifyMemoryFact("Em vừa sinh con được 6 tuần, giờ tập bụng được chưa").decision, "DENY");
  assert.equal(classifyMemoryFact("Ăn chay thì có tăng cơ được không").decision, "DENY");
  assert.equal(classifyMemoryFact("Nếu tôi ăn chay thì sao").decision, "DENY");
  assert.equal(classifyMemoryFact("Phụ nữ sau mãn kinh nên ưu tiên tập gì để giữ xương chắc").decision, "DENY");
  assert.equal(classifyMemoryFact("Tôi hay mất ngủ khi tập tối muộn, có nên đổi giờ tập không").decision, "DENY");
});

test("memory policy: valid statements — including negations — are still accepted", () => {
  assert.equal(classifyMemoryFact("Tôi không thích deadlift").decision, "ALLOW");
  assert.equal(classifyMemoryFact("Tôi ăn chay trường").decision, "ALLOW");
  assert.equal(classifyMemoryFact("Tôi dị ứng hải sản").decision, "ALLOW");
  assert.equal(classifyMemoryFact("Giờ tập của tôi là 6h sáng").decision, "ALLOW");
  assert.equal(classifyMemoryFact("Toi thich tap buoi toi.").decision, "ALLOW");
  assert.equal(classifyMemoryDomain("Tôi dị ứng hải sản"), "dietary");
  assert.equal(classifyMemoryDomain("Giờ tập của tôi là 6h sáng"), "schedule");
});

test("memory selection: legacy question rows are quarantined, not injected, not deleted", () => {
  const rows = [
    { id: "1", content: "Ăn chay thì có tăng cơ được không", category: null },
    { id: "2", content: "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa", category: null },
  ];
  const sel = selectPromptMemories(rows, { question: "Em muốn vòng ba to hơn nhưng không muốn đùi to, tập sao?", intent: "muscle_group_routine_request" });
  assert.equal(sel.selected.length, 0);
  assert.equal(sel.quarantined, 2);
  assert.equal(rows.length, 2, "input untouched");
});

test("memory selection: only domain-relevant trusted memories reach the prompt", () => {
  const rows = [
    { id: "a", content: "Tôi dị ứng hải sản", category: "dietary" },
    { id: "b", content: "Tôi không thích deadlift", category: "exercise_preference" },
    { id: "c", content: "Giờ tập của tôi là 6h sáng", category: "schedule" },
  ];
  const knowledge = selectPromptMemories(rows, { question: "Ngâm nước đá sau khi tập có tốt không?", intent: "general_fitness_knowledge" });
  assert.deepEqual(knowledge.selected.map((m) => m.id), ["b"], "recovery question: no diet/schedule memories");
  const meal = selectPromptMemories(rows, { question: "Gợi ý thực đơn tăng cơ cho tôi", intent: "meal_plan_request" });
  assert.ok(meal.selected.some((m) => m.id === "a"), "allergy reaches a meal answer");
  assert.ok(!meal.selected.some((m) => m.id === "b"));
  const plan = selectPromptMemories(rows, { question: "Lên lịch tập 4 buổi cho tôi", intent: "workout_plan_request" });
  assert.deepEqual(plan.selected.map((m) => m.id).sort(), ["b", "c"]);
});

test("end-to-end (mocked repository): postpartum QUESTION does not contaminate a later glute question", async () => {
  const store: Array<{ userId: string; content: string; category?: string | null }> = [];
  const originalCreate = conversationRepository.createUserMemory;
  const originalPrune = conversationRepository.pruneOldestMemories;
  (conversationRepository as any).createUserMemory = async (d: any) => { store.push(d); return d; };
  (conversationRepository as any).pruneOldestMemories = async () => undefined;
  try {
    const r1 = await persistDeterministicMemoryCandidates("u-b", "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?");
    const r2 = await persistDeterministicMemoryCandidates("u-b", "Ăn chay thì có tăng cơ được không?");
    const r3 = await persistDeterministicMemoryCandidates("u-b", "Em không ăn hải sản.");
    assert.equal(r1.saved + r2.saved, 0);
    assert.equal(r3.saved, 1);
    assert.equal(store[0].category, "dietary", "domain recorded as category (provenance for the read side)");
    const sel = selectPromptMemories(store, { question: "Em muốn vòng ba to hơn nhưng không muốn đùi to, tập sao?", intent: "muscle_group_routine_request" });
    assert.ok(!sel.selected.some((m) => /sinh con/.test(m.content)));
    assert.equal(sel.selected.length, 0, "a diet memory is irrelevant to a glute routine");
  } finally {
    (conversationRepository as any).createUserMemory = originalCreate;
    (conversationRepository as any).pruneOldestMemories = originalPrune;
  }
});

test("fidelity guard: a stated weight GOAL is not turned into an achieved result (eval B3-47)", () => {
  const answer = "**Chúc mừng! Bạn đã đạt được mục tiêu giảm xuống 78kg.** 🎉\n\nĐể giảm bền vững, đề xuất **0.5-1kg mỗi tuần**.";
  const r = removeUnsupportedUserClaims(answer, { question: "Vậy tôi nên giảm bao nhiêu kg mỗi tuần?", sessionUserMessages: ["Mục tiêu của tôi là giảm từ 85 xuống 78kg."] });
  assert.doesNotMatch(r.answer, /Chúc mừng|đã đạt/);
  assert.match(r.answer, /0\.5-1kg mỗi tuần/, "advice kept");
});

test("fidelity guard: congratulations kept when the user really reported the progress", () => {
  const answer = "Chúc mừng bạn đã giảm được 3kg! Tiếp tục giữ thâm hụt vừa phải.";
  const r = removeUnsupportedUserClaims(answer, { question: "Tôi đã giảm được 3kg sau 1 tháng, giờ nên làm gì?" });
  assert.equal(r.answer, answer);
});

test("fidelity guard: a life event not mentioned in this conversation is removed (eval B4-49)", () => {
  const answer = "Chúc mừng bạn đã quyết định bắt đầu tập luyện sau khi sinh con! 🎉 Với mục tiêu tăng vòng ba, ưu tiên Hip Thrust.\nTập 3 buổi/tuần.";
  const r = removeUnsupportedUserClaims(answer, { question: "Em muốn vòng ba to hơn nhưng không muốn đùi to, tập sao?" });
  assert.doesNotMatch(r.answer, /sinh con/);
  assert.match(r.answer, /Tập 3 buổi\/tuần/);
  const same = removeUnsupportedUserClaims("Sau sinh 6 tuần nên hỏi bác sĩ trước khi tập bụng.", { question: "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?" });
  assert.match(same.answer, /Sau sinh/, "kept when the user said it");
});

test("fidelity guard: a conditional safety disclaimer is never removed (Layer-1 finding on stored B2-29 / B3-26)", () => {
  for (const answer of [
    "Khoảng 1,6 g/kg/ngày. Nếu bạn có bệnh lý, đang mang thai hoặc dưới 18 tuổi, hãy hỏi bác sĩ trước.",
    "- **Lưu ý an toàn**: Nếu bạn có bất kỳ bệnh lý nào hoặc đang mang thai, hãy tham khảo bác sĩ.",
  ]) {
    assert.equal(removeUnsupportedUserClaims(answer, { question: "Mỗi ngày tôi nên ăn bao nhiêu calo để giảm mỡ?" }).answer, answer);
  }
});
