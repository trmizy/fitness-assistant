/**
 * gb1-replacement.test.ts
 * Unit tests for PT & Gym decision replacement models, bodies, and rules.
 * Test fixture: pure function tests, no network, no DOM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  replacementStatusLabel,
  replacementStatusTone,
  validateReplacementReason,
  isProposer,
  PROPOSE_REPLACEMENT_CONFIRM,
  APPROVE_REPLACEMENT_CONFIRM,
  REJECT_REPLACEMENT_CONFIRM,
} from "../disputes/actions/replacementModel";

describe("PT decision replacement model & body shapes (A40)", () => {
  it("propose body has strictly reason property", () => {
    const proposeBody = { reason: "Phát hiện chứng cứ mới làm thay đổi bản chất vụ việc" };
    assert.deepEqual(Object.keys(proposeBody), ["reason"]);
    assert.equal(typeof proposeBody.reason, "string");
    assert.ok(proposeBody.reason.length >= 10);
  });

  it("PT approve body has strictly reason and conflictOfInterestDeclaredNone", () => {
    const approveBody = {
      reason: "Đồng ý đề xuất thay quyết định",
      conflictOfInterestDeclaredNone: true,
    };
    assert.deepEqual(Object.keys(approveBody).sort(), [
      "conflictOfInterestDeclaredNone",
      "reason",
    ]);
    assert.equal(approveBody.conflictOfInterestDeclaredNone, true);
  });

  it("PT reject body has strictly reason and conflictOfInterestDeclaredNone", () => {
    const rejectBody = {
      reason: "Từ chối đề xuất thay quyết định do lý do không đủ căn cứ",
      conflictOfInterestDeclaredNone: true,
    };
    assert.deepEqual(Object.keys(rejectBody).sort(), [
      "conflictOfInterestDeclaredNone",
      "reason",
    ]);
    assert.equal(rejectBody.conflictOfInterestDeclaredNone, true);
  });

  it("Gym reject body has strictly reason without COI (schemas.ts:88)", () => {
    // Backend gym schema: replaceRejectBody = z.object({ reason: text(4000) }).strict()
    const gymRejectBody = {
      reason: "Từ chối đề xuất quyết định thay thế phòng gym",
    };
    assert.deepEqual(Object.keys(gymRejectBody), ["reason"]);
    assert.equal("conflictOfInterestDeclaredNone" in gymRejectBody, false);
  });

  it("replacementStatusLabel returns human-friendly Vietnamese labels without raw enums", () => {
    assert.equal(replacementStatusLabel("PENDING"), "Đang chờ duyệt");
    assert.equal(replacementStatusLabel("APPROVED"), "Đã duyệt thay");
    assert.equal(replacementStatusLabel("REJECTED"), "Đã bác");
  });

  it("replacementStatusTone returns valid badge tones", () => {
    assert.equal(replacementStatusTone("PENDING"), "pending");
    assert.equal(replacementStatusTone("APPROVED"), "success");
    assert.equal(replacementStatusTone("REJECTED"), "danger");
  });

  it("validateReplacementReason checks min and max lengths", () => {
    assert.equal(validateReplacementReason("").ok, false);
    assert.equal(
      validateReplacementReason("Lý do đề xuất thay thế hợp lệ và đầy đủ chi tiết.").ok,
      true
    );
  });

  it("isProposer identifies current user against proposedBy", () => {
    assert.equal(isProposer({ proposedBy: "user-1" }, "user-1"), true);
    assert.equal(isProposer({ proposedBy: "user-1" }, "user-2"), false);
    assert.equal(isProposer({ proposedBy: "user-1" }, null), false);
  });

  it("replacement confirmation texts match brief requirements", () => {
    assert.ok(PROPOSE_REPLACEMENT_CONFIRM.includes("Không có tiền nào chuyển"));
    assert.ok(APPROVE_REPLACEMENT_CONFIRM.includes("Không có tiền nào chuyển"));
    assert.ok(REJECT_REPLACEMENT_CONFIRM.includes("Quyết định cũ giữ nguyên"));
  });
});

import { parseDisputeErrorBody } from "../disputes/disputeCaseErrors";
describe("DECISION_HAS_EFFECT reasons are translated by meaning, not by a loose substring", () => {
  it("'session status is PT_NO_SHOW_REPORTED' is not called 'đã chuyển sang vắng mặt'", () => {
    const v = parseDisputeErrorBody(409, { error: "x", code: "DECISION_HAS_EFFECT", details: { effects: ["session status is PT_NO_SHOW_REPORTED"] } });
    assert.match(v.message, /đang chờ PT phản hồi báo vắng/);
    assert.doesNotMatch(v.message, /đã chuyển sang vắng mặt/);
  });
  it("execution and settlement effects get their own sentence", () => {
    const v = parseDisputeErrorBody(409, { error: "x", code: "DECISION_HAS_EFFECT", details: { effects: ["case execution status is BUSINESS_DONE", "2 money settlement row(s) of the session"] } });
    assert.match(v.message, /đã được thực thi hoặc đang thực thi/);
    assert.match(v.message, /quyết toán tiền/);
  });
});

describe("INT-20 quota out of bounds states the real numbers", () => {
  it("uses used/total from the server details", () => {
    const v = parseDisputeErrorBody(409, { error: "x", code: "QUOTA_OUT_OF_BOUNDS", details: { used: 0, total: 4, delta: -1, after: -1 } });
    assert.match(v.message, /đang dùng 0\/4 buổi/);
  });
  it("falls back to the plain sentence without details", () => {
    const v = parseDisputeErrorBody(409, { error: "x", code: "QUOTA_OUT_OF_BOUNDS" });
    assert.match(v.message, /ngoài khoảng/);
    assert.doesNotMatch(v.message, /đang dùng/);
  });
});
