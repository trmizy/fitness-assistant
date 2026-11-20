import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIdempotencyKey, canRevertPlan, deriveSyncState, keepKeyAfterError, mapRevertError, mapRevisionError, PT_OUTDATED_HINT,
  REVISION_MESSAGES, saveOutcomeFrom, saveSheetTitles, showPtOutdatedHint, validateInstruction,
} from "../planRevision";

/** TEST FIXTURE — pure derivation / copy, no network. Contract: K9 spec (docs/plan-review/aiplanspage-sync). */

const PLAN = "plan-1";
const err = (status: number, code?: string, message?: string) => ({ response: { status, data: { success: false, error: { code, message } } } });

test("sync: no program, or a program built from ANOTHER plan -> not saved, action 'Lưu vào lịch tập'", () => {
  for (const program of [null, { sourcePlanId: "other", aiPlanVersion: 5 }]) {
    const m = deriveSyncState({ program, planId: PLAN, planVersion: 2 })!;
    assert.equal(m.kind, "NOT_SAVED");
    assert.deepEqual(m.action, { id: "save", label: "Lưu vào lịch tập" });
  }
});

test("sync: program follows this plan at >= its version -> 'Lịch tập đang dùng bản mới nhất', no action", () => {
  for (const v of [2, 3]) {
    const m = deriveSyncState({ program: { sourcePlanId: PLAN, aiPlanVersion: v }, planId: PLAN, planVersion: 2 })!;
    assert.equal(m.kind, "SYNCED");
    assert.equal(m.title, "Lịch tập đang dùng bản mới nhất");
    assert.equal(m.action, null);
  }
});

test("sync: plan revised after the program followed it -> update available with the new version + 'Áp dụng bản mới'", () => {
  const m = deriveSyncState({ program: { sourcePlanId: PLAN, aiPlanVersion: 1 }, planId: PLAN, planVersion: 2 })!;
  assert.equal(m.kind, "UPDATE_AVAILABLE");
  assert.equal(m.title, "Có bản cập nhật mới (v2) chưa áp dụng vào lịch tập");
  assert.deepEqual(m.action, { id: "apply", label: "Áp dụng bản mới" });
  // a program with no aiPlanVersion at all counts as 0
  assert.equal(deriveSyncState({ program: { sourcePlanId: PLAN }, planId: PLAN, planVersion: 2 })!.kind, "UPDATE_AVAILABLE");
});

test("sync: saving beats everything (spinner, no action); failed -> message + 'Thử lại'; loading program -> hidden", () => {
  const saving = deriveSyncState({ program: null, planId: PLAN, planVersion: 1, saving: true })!;
  assert.equal(saving.kind, "SAVING");
  assert.equal(saving.busy, true);
  assert.equal(saving.action, null);
  const failed = deriveSyncState({ program: null, planId: PLAN, planVersion: 1, failedMessage: "Bạn đang có một buổi tập diễn ra dở dang." })!;
  assert.equal(failed.kind, "FAILED");
  assert.equal(failed.description, "Bạn đang có một buổi tập diễn ra dở dang.");
  assert.deepEqual(failed.action, { id: "retry", label: "Thử lại" });
  assert.equal(deriveSyncState({ program: undefined, planId: PLAN, planVersion: 1 }), null);
});

test("sync: never prints 'vundefined' / 'vNaN' for a missing or garbage version", () => {
  for (const planVersion of [undefined, null, "x", NaN, 0]) {
    const m = deriveSyncState({ program: { sourcePlanId: PLAN, aiPlanVersion: 0 }, planId: PLAN, planVersion })!;
    assert.doesNotMatch(`${m.title} ${m.description}`, /undefined|NaN|null/);
  }
});

test("K9: a re-save that applied the revision is NOT announced as 'đã lưu trước đó'", () => {
  const synced = saveOutcomeFrom({ alreadyExists: true, contentSynced: true, previousAiPlanVersion: 1 }, 2);
  assert.equal(synced.kind, "synced");
  assert.match(synced.message, /Đã cập nhật lịch tập theo phiên bản 2/);
  assert.doesNotMatch(synced.message, /trước đó/);
  assert.equal(saveOutcomeFrom({ alreadyExists: false }, 1).message, "Đã lưu kế hoạch vào lịch tập.");
  assert.equal(saveOutcomeFrom({ alreadyExists: true, contentSynced: false, previousAiPlanVersion: 2 }, 2).kind, "already_current");
  assert.equal(saveOutcomeFrom({ alreadyExists: true, contentSynced: false, previousAiPlanVersion: 1 }, 2).kind, "unchanged_content");
  assert.equal(saveOutcomeFrom({ alreadyExists: true, contentSynced: false, previousAiPlanVersion: null }, 2).kind, "unchanged_content");
});

test("save sheet: applying a newer version reads as an update, a first save as a save", () => {
  assert.equal(saveSheetTitles("UPDATE_AVAILABLE").confirm, "Áp dụng vào lịch tập");
  assert.equal(saveSheetTitles("NOT_SAVED").confirm, "Lưu lịch tập");
  assert.equal(saveSheetTitles(null).title, "Lưu vào lịch tập");
});

test("revision errors map to plain Vietnamese and say whether to reload", () => {
  const conflict = mapRevisionError(err(409, "VERSION_CONFLICT", "Kế hoạch đã được cập nhật (phiên bản 3, bạn đang xem 2)."));
  assert.equal(conflict.message, "Kế hoạch vừa được cập nhật ở nơi khác, hãy tải lại");
  assert.equal(conflict.reload, true);
  const busy = mapRevisionError(err(409, "REVISION_IN_PROGRESS", "english or whatever"));
  assert.equal(busy.message, "AI đang chỉnh kế hoạch này, vui lòng đợi");
  assert.equal(busy.reload, false);
  const ask = mapRevisionError(err(422, "NEEDS_CLARIFICATION", "Bạn muốn đổi bài thứ 2 của buổi nào: ngực hay lưng?"));
  assert.equal(ask.kind, "clarify");
  assert.equal(ask.message, "Bạn muốn đổi bài thứ 2 của buổi nào: ngực hay lưng?");
  assert.equal(mapRevisionError(err(422, "VALIDATION_ERROR", "Bài X không có trong kế hoạch.")).message, "Bài X không có trong kế hoạch.");
  const rate = mapRevisionError(err(429, "RATE_LIMITED", "Too many"));
  assert.equal(rate.kind, "rate");
  assert.match(rate.message, /^Bạn thao tác quá nhanh/);
  assert.equal(mapRevisionError(err(503)).message, REVISION_MESSAGES.unavailable);
  assert.equal(mapRevisionError(err(500)).message, REVISION_MESSAGES.server);
  assert.equal(mapRevisionError({ message: "Network Error" }).kind, "offline");
  for (const e of [err(409, "VERSION_CONFLICT"), err(429), err(503), err(500), {}, null]) {
    assert.doesNotMatch(mapRevisionError(e).message, /VERSION_CONFLICT|REVISION_IN_PROGRESS|RATE_LIMITED|undefined|\[object/);
  }
});

test("revert errors: busy / conflict mapped, the server's Vietnamese sentence (e.g. published on the marketplace) is kept", () => {
  assert.equal(mapRevertError(err(409, "REVISION_IN_PROGRESS")).message, "AI đang chỉnh kế hoạch này, vui lòng đợi");
  assert.equal(mapRevertError(err(409, "VERSION_CONFLICT")).reload, true);
  const published = mapRevertError(err(409, "VALIDATION_ERROR", "Kế hoạch này đang được đăng trên chợ nên không thể quay lại phiên bản trước tại chỗ."));
  assert.match(published.message, /đăng trên chợ/);
  assert.equal(mapRevertError(err(404)).message, REVISION_MESSAGES.revertGeneric);
});

test("idempotency key: stable per sheet + normalised text + plan version, charset accepted by the server", () => {
  const a = buildIdempotencyKey("s1", "Tăng  từ 4 lên 8 bài", 3);
  assert.equal(a, buildIdempotencyKey("s1", "  tăng từ 4 lên 8 bài ", 3)); // double tap / retry of the same text
  assert.notEqual(a, buildIdempotencyKey("s1", "Giảm còn 3 buổi", 3));
  assert.notEqual(a, buildIdempotencyKey("s1", "Tăng từ 4 lên 8 bài", 4)); // moved version = new action
  assert.notEqual(a, buildIdempotencyKey("s2", "Tăng từ 4 lên 8 bài", 3)); // another open sheet
  assert.match(a, /^[A-Za-z0-9._:-]{8,128}$/);
});

test("key is kept only when the server may not have seen the request (no answer / 408 / 502-504)", () => {
  assert.equal(keepKeyAfterError({ message: "timeout" }), true);
  for (const s of [408, 502, 503, 504]) assert.equal(keepKeyAfterError(err(s)), true, String(s));
  for (const s of [400, 409, 422, 429, 500]) assert.equal(keepKeyAfterError(err(s)), false, String(s));
});

test("instruction validation mirrors the server bounds (5..1000)", () => {
  assert.ok(validateInstruction("  ab "));
  assert.equal(validateInstruction("Tăng lên 8 bài"), null);
  assert.ok(validateInstruction("x".repeat(1001)));
});

test("revert is offered exactly when web offers it: COMPLETED + _metadata.revision.previousPlanId", () => {
  const rev = { status: "COMPLETED", plan: { _metadata: { revision: { previousPlanId: "p", inPlace: true } } } };
  assert.equal(canRevertPlan(rev), true);
  assert.equal(canRevertPlan({ ...rev, status: "PROCESSING" }), false);
  assert.equal(canRevertPlan({ status: "COMPLETED", plan: { _metadata: {} } }), false);
  assert.equal(canRevertPlan({ status: "COMPLETED", plan: null }), false);
  assert.equal(canRevertPlan(null), false);
});

test("PT hint: only for the program built from THIS plan, and only when the approval is outdated", () => {
  const prog = { sourcePlanId: PLAN };
  assert.equal(showPtOutdatedHint(prog, PLAN, { effectiveState: "APPROVED_OUTDATED" }), true);
  assert.equal(showPtOutdatedHint(prog, PLAN, { effectiveState: "APPROVED_CURRENT" }), false);
  assert.equal(showPtOutdatedHint(prog, PLAN, { effectiveState: "OPEN" }), false);
  assert.equal(showPtOutdatedHint(prog, PLAN, undefined), false);
  assert.equal(showPtOutdatedHint({ sourcePlanId: "x" }, PLAN, { effectiveState: "APPROVED_OUTDATED" }), false);
  assert.equal(showPtOutdatedHint(null, PLAN, { effectiveState: "APPROVED_OUTDATED" }), false);
  assert.equal(PT_OUTDATED_HINT, "PT đã duyệt bản cũ — mở Lịch tập để gửi lại");
});
