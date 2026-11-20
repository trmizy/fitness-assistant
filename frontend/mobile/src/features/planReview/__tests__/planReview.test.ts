import test from "node:test";
import assert from "node:assert/strict";
import {
  canSendNegativeDecision, clientAction, clientStatusLabel, isOpenStatus, newIdempotencyKey, planReviewErrorMessage,
  ptCanDecide, snapshotDays, snapshotTitle, STATUS_META, type PlanReviewStatus,
} from "../planReview";

test("every status has a Vietnamese label and a tone (no raw enum ever reaches the UI)", () => {
  const all: PlanReviewStatus[] = ["PENDING_REVIEW", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "CANCELLED", "SUPERSEDED", "ACCESS_REVOKED"];
  for (const s of all) assert.ok(STATUS_META[s].label && !/_/.test(STATUS_META[s].label), s);
});

test("an approval that no longer applies (A -> B -> A or any edit) is never shown as 'approved'", () => {
  assert.equal(clientStatusLabel({ status: "APPROVED", effectiveState: "APPROVED_CURRENT" }).label, "PT đã duyệt");
  const stale = clientStatusLabel({ status: "APPROVED", effectiveState: "APPROVED_OUTDATED" });
  assert.match(stale.label, /cần gửi lại/);
  assert.equal(stale.tone, "warning");
});

test("client actions: none -> submit; open -> cancel only (never two open requests); decided/closed -> resubmit", () => {
  assert.equal(clientAction(undefined), "SUBMIT");
  assert.equal(clientAction({ status: "PENDING_REVIEW" }), "CANCEL");
  assert.equal(clientAction({ status: "IN_REVIEW" }), "CANCEL");
  for (const s of ["APPROVED", "CHANGES_REQUESTED", "REJECTED", "CANCELLED", "SUPERSEDED", "ACCESS_REVOKED"] as const) assert.equal(clientAction({ status: s }), "RESUBMIT", s);
});

test("PT can decide only on open requests; negative decisions need a real note", () => {
  assert.equal(ptCanDecide({ status: "PENDING_REVIEW" }), true);
  assert.equal(ptCanDecide({ status: "IN_REVIEW" }), true);
  assert.equal(ptCanDecide({ status: "APPROVED" }), false);
  assert.equal(isOpenStatus("CANCELLED"), false);
  assert.equal(canSendNegativeDecision("  "), false);
  assert.equal(canSendNegativeDecision("ab"), false);
  assert.equal(canSendNegativeDecision("Thêm bài vai"), true);
  assert.equal(canSendNegativeDecision("x".repeat(1001)), false);
});

test("idempotency keys are unique per attempt and long enough for the server (>= 8 chars)", () => {
  const a = newIdempotencyKey(), b = newIdempotencyKey();
  assert.notEqual(a, b);
  assert.ok(a.length >= 8 && a.length <= 100);
});

test("error mapping: offline, expired token, stale version, contract ended, server down — all readable sentences", () => {
  assert.match(planReviewErrorMessage(new Error("Network Error")), /Không có kết nối mạng/);
  assert.match(planReviewErrorMessage({ response: { status: 401, data: {} } }), /hết hạn/);
  assert.match(planReviewErrorMessage({ response: { status: 409, data: { code: "STALE_REVISION" } } }), /đã thay đổi/);
  assert.match(planReviewErrorMessage({ response: { status: 409, data: { code: "REVISION_OUTDATED" } } }), /đã thay đổi/);
  assert.match(planReviewErrorMessage({ response: { status: 403, data: { code: "NO_ACTIVE_CONTRACT" } } }), /hợp đồng PT/);
  assert.match(planReviewErrorMessage({ response: { status: 503, data: {} } }), /thử lại/);
  assert.doesNotMatch(planReviewErrorMessage({ response: { status: 409, data: { code: "STALE_REVISION" } } }), /STALE_REVISION/);
});

test("snapshot display tolerates missing fields and never crashes", () => {
  assert.deepEqual(snapshotDays(null), []);
  assert.deepEqual(snapshotDays({ days: "nope" }), []);
  const days = snapshotDays({ days: [{ dayNumber: 1, title: "Ngực", exercises: [{ name: "Bench", sets: 3, reps: 10, restSeconds: 90 }, {}] }, {}] });
  assert.equal(days[0].exercises[0].detail, "3 hiệp × 10 · nghỉ 90s");
  assert.equal(days[0].exercises[1].name, "Bài tập");
  assert.equal(days[1].title, "Buổi 2");
  assert.equal(snapshotTitle({ name: "Giảm mỡ" }), "Giảm mỡ");
  assert.equal(snapshotTitle(undefined), "Kế hoạch tập luyện");
});
