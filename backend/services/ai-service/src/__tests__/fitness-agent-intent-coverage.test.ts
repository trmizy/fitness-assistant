/**
 * Intent-routing coverage (full conversational verification). Found by the routing corpus
 * (test/ai-chat-full-verification/corpus/routing.json): realistic phrasing of supported actions fell through to the generic
 * LLM chat because the closed regex set only recognised narrow forms. These tests pin (a) the newly routed GENERAL phrasing
 * families and (b) that nothing that used to be a question/lookup/management request was re-routed into a creation flow.
 * Routing alone never writes: every creation intent still ends in a preview + explicit confirmation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

const kind = (text: string) => parseFitnessAgentIntent(text).kind;

test("roadmap-only creation phrasing routes to the create workflow (not generic chat)", () => {
  for (const t of ["Tạo cho tôi lộ trình giảm mỡ.", "Tạo lộ trình giảm mỡ cho tôi", "tạo lộ trình body đẹp hơn", "Lên roadmap cut cho tôi", "tao lo trinh giam mo", "Xây dựng lộ trình tăng cơ"]) {
    assert.equal(kind(t), "CREATE_PLAN_BUNDLE", t);
  }
});

test("roadmap management verbs keep their meaning (status/rebuild/archive/advance are NOT hijacked by the new creation rule)", () => {
  assert.equal(kind("Lộ trình của tôi hiện tại thế nào?"), "ROADMAP_STATUS");
  assert.equal(kind("Làm lại lộ trình cho tôi"), "ROADMAP_REBUILD");
  assert.equal(kind("Tạo lại lộ trình"), "ROADMAP_REBUILD");
  assert.equal(kind("Hủy lộ trình hiện tại"), "ROADMAP_ARCHIVE");
  assert.equal(kind("Chuyển sang giai đoạn tiếp theo của lộ trình"), "ROADMAP_ADVANCE");
});

test("how-to / definition questions about roadmaps are NOT creation requests", () => {
  for (const t of ["Lộ trình là gì?", "Tại sao cần lộ trình?", "Roadmap là gì"]) assert.equal(kind(t), null, t);
  // pre-existing: "... như thế nào" reads as a status question; the point is that it must not open the CREATE flow
  assert.notEqual(kind("Cách tạo lộ trình như thế nào?"), "CREATE_PLAN_BUNDLE");
});

test("program search verbs route to PROGRAM; create-verbs still mean CREATE_WORKOUT_PLAN", () => {
  for (const t of ["Tìm chương trình tập phù hợp với tôi.", "Có chương trình tập nào hợp với tôi không?", "Đề xuất giáo án cho người mới", "kiếm chương trình tập tại nhà"]) assert.equal(kind(t), "PROGRAM", t);
  assert.equal(kind("Thiết kế chương trình tập tăng cơ ở nhà"), "CREATE_WORKOUT_PLAN");
  assert.equal(kind("Chọn chương trình thứ 2"), "SELECT");
});

test("hiring a SPECIFIC recommended PT is a selection; a bare 'thuê PT' stays a PT search", () => {
  for (const t of ["Thuê PT này.", "thuê PT thứ 2", "Thuê PT số 1", "hire PT đầu tiên"]) assert.equal(kind(t), "SELECT", t);
  for (const t of ["Tôi muốn thuê PT", "Đừng hỏi nữa, cứ thuê PT.", "Tìm PT phù hợp rồi thuê luôn cho tôi.", "Tôi muốn thuê PT Nguyễn Fake ID 999999."]) assert.equal(kind(t), "PT", t);
});

test("English 'workout plan' and 'thực đơn ... N bữa' route to their creation flows; lookups/questions do not", () => {
  assert.equal(kind("tạo workout plan 4 days để cut"), "CREATE_WORKOUT_PLAN");
  assert.equal(kind("thuc don giam mo 4 bua"), "CREATE_NUTRITION_PLAN");
  for (const t of ["Thực đơn hôm nay của tôi có gì?", "Thực đơn của tôi có mấy bữa?", "Tại sao thực đơn 4 bữa này nhiều protein?", "Cho tôi xem thực đơn hôm nay"]) assert.equal(kind(t), null, t);
});

test("pure knowledge Q&A and off-topic never route to an action", () => {
  for (const t of ["Progressive overload là gì?", "Romanian deadlift tập cơ gì?", "Protein bao nhiêu là đủ?", "Có bài nào thay lat pulldown không?", "Thời tiết hôm nay thế nào?", "Viết code Java cho tôi."]) assert.equal(kind(t), null, t);
});
