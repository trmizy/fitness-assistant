import test from "node:test";
import assert from "node:assert/strict";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

/**
 * Approved rule (2026-11-20): "Kiểm tra tiến độ" only EVALUATES. It never creates or activates a TrainingCycle; starting the next cycle/phase is a
 * separate, explicitly worded request that the agent turns into an ACTION_CONFIRMATION card (it is executed only after the user confirms).
 * Pure unit test (no DB, no model).
 */
const kind = (t: string) => parseFitnessAgentIntent(t).kind;

test("progress / status questions about the roadmap are READ-ONLY (ROADMAP_STATUS), never ROADMAP_ADVANCE", () => {
  for (const t of ["Kiểm tra tiến độ lộ trình", "kiểm tra tiến độ lộ trình của tôi", "Lộ trình của tôi tiến độ thế nào?", "Lộ trình hiện tại ra sao", "Xem lộ trình", "Lộ trình đang ở giai đoạn nào?"]) {
    assert.equal(kind(t), "ROADMAP_STATUS", t);
  }
});

test("only an explicit request to MOVE ON proposes an advance (which still needs a confirmation card before anything is written)", () => {
  for (const t of ["Chuyển lộ trình sang giai đoạn tiếp theo", "Cho lộ trình qua giai đoạn mới"]) assert.equal(kind(t), "ROADMAP_ADVANCE", t);
});
