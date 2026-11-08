/**
 * Which statements revise a pending CREATE_PLAN_BUNDLE roadmap draft (user test in the chat UI, 2026-11-08: "thực đơn tôi
 * muốn có cá hồi" regenerated the roadmap). Diet/intensity constraints still revise the bundle by design.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRoadmapRevisionStatement } from "../services/fitness-agent.service";

test("roadmap / bundle revisions are recognized (incl. diet and intensity constraints)", () => {
  for (const s of ["Rút gọn lộ trình còn 12 tuần", "Bỏ giai đoạn nghỉ giữa kỳ", "Mình muốn tăng cơ ngực", "Trong 8 tuần thôi", "Tập nhẹ nhàng hơn giúp tôi", "ăn chay giúp tôi", "Đổi sang tăng cơ nạc"])
    assert.equal(isRoadmapRevisionStatement(s), true, s);
});

test("menu / dish / meal statements and bare acknowledgements are not roadmap revisions", () => {
  for (const s of ["thực đơn tôi muốn có cá hồi", "Bữa sáng mình thích ăn phở", "Món này mình không thích", "Cảm ơn bạn", "Ok", "oke nhé"])
    assert.equal(isRoadmapRevisionStatement(s), false, s);
});
