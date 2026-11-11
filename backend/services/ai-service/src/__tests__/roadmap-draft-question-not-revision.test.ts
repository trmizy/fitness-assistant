import test from "node:test";
import assert from "node:assert/strict";
import { fitnessAgent } from "../services/fitness-agent.service";

/** Found by the persona journey evaluation: while a roadmap draft was pending, EVERY later message (exercise guidance, a nutrition question) was
 *  appended to the draft's constraints and regenerated the roadmap. A question that carries no revision wish must fall through to normal chat. */
const given = { id: "00000000-0000-4000-8000-000000000001", risk: "LOW", payload: { roadmapDraft: { goalType: "FAT_LOSS" } } };
const identity = { userId: "u-roadmap-question" } as never;

test("questions about other topics are not roadmap revisions (the draft is untouched and the turn falls through)", async () => {
  for (const q of [
    "Squat đúng kỹ thuật thế nào? Tôi hay thấy đau đầu gối",
    "Buổi tập đầu tiên tôi sẽ làm những gì? Hướng dẫn từng bước giúp tôi",
    "Tôi nên ăn gì mỗi ngày để giảm cân mà không bị đói?",
    "Creatine có cần thiết không, uống thế nào?",
  ]) assert.equal(await fitnessAgent.tryReviseRoadmapDraft(q, identity, "s-1", given), null, q);
});
