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
  canProposeReplacement,
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

  it("canProposeReplacement requires DECISION_APPROVED, NOT_STARTED or EXEC_BLOCKED, and no pending replacement (FIX-3, A34)", () => {
    // Valid cases
    assert.equal(canProposeReplacement("DECISION_APPROVED", "NOT_STARTED", false), true);
    assert.equal(canProposeReplacement("DECISION_APPROVED", "EXEC_BLOCKED", false), true);

    // Blocked if already executed (BUSINESS_DONE, EXECUTING, NEEDS_HUMAN)
    assert.equal(canProposeReplacement("DECISION_APPROVED", "BUSINESS_DONE", false), false);
    assert.equal(canProposeReplacement("DECISION_APPROVED", "EXECUTING", false), false);
    assert.equal(canProposeReplacement("DECISION_APPROVED", "NEEDS_HUMAN", false), false);

    // Blocked if pending replacement exists
    assert.equal(canProposeReplacement("DECISION_APPROVED", "NOT_STARTED", true), false);

    // Blocked if case is not DECISION_APPROVED
    assert.equal(canProposeReplacement("IN_PROGRESS", "NOT_STARTED", false), false);
    assert.equal(canProposeReplacement("CLOSED", "NOT_STARTED", false), false);
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
