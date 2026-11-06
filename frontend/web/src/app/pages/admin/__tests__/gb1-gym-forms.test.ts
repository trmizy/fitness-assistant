/**
 * gb1-gym-forms.test.ts
 * Unit tests for gym member forms (statement, document, appeal) and partyModel validations.
 * Test fixture: pure function tests, no DOM, no network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canRequestPartyAppeal,
  validateAppealReason,
  validateStatement,
  validateDocument,
  normalizeSha256,
  isSha256,
  APPEAL_NOTICE_TEXT,
  APPEAL_SUCCESS_TEXT,
} from "../../disputes/partyModel";
import { GYM_STATUS_LABEL } from "../complaints/gymCaseLabels";

describe("Gym member forms & party model validations (A48-A50, B3, B4)", () => {
  it("validateStatement accepts valid statement text", () => {
    const result = validateStatement(
      { text: "Nội dung phản ánh từ hội viên phòng gym", supplementReason: "" },
      false
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.text, "Nội dung phản ánh từ hội viên phòng gym");
      assert.equal("supplementReason" in result.body, false);
    }
  });

  it("validateStatement enforces supplementReason when required", () => {
    const resWithoutReason = validateStatement(
      { text: "Lời khai bổ sung lần 2", supplementReason: "" },
      true
    );
    assert.equal(resWithoutReason.ok, false);

    const resWithReason = validateStatement(
      { text: "Lời khai bổ sung lần 2", supplementReason: "Bổ sung bằng chứng hóa đơn" },
      true
    );
    assert.equal(resWithReason.ok, true);
    if (resWithReason.ok) {
      assert.equal(resWithReason.body.supplementReason, "Bổ sung bằng chứng hóa đơn");
    }
  });

  it("validateDocument validates description and 64-char hex sha256", () => {
    const validSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const invalidSha = "abc123notashahash";

    const validRes = validateDocument({
      description: "Biên lai thanh toán chuyển khoản",
      title: "BienLai.pdf",
      fileName: "bienlai.pdf",
      sha256: validSha,
    });
    assert.equal(validRes.ok, true);

    const invalidRes = validateDocument({
      description: "Biên lai thanh toán chuyển khoản",
      title: "BienLai.pdf",
      fileName: "bienlai.pdf",
      sha256: invalidSha,
    });
    assert.equal(invalidRes.ok, false);
  });

  it("normalizeSha256 handles sha256sum output with filename and uppercase", () => {
    const raw = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855  document.pdf";
    const normalized = normalizeSha256(raw);
    assert.equal(normalized, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(isSha256(normalized), true);
  });

  it("canRequestPartyAppeal respects appeal.canFile if provided by server", () => {
    assert.equal(canRequestPartyAppeal("IN_PROGRESS", { canFile: true }), true);
    assert.equal(canRequestPartyAppeal("DECISION_APPROVED", { canFile: false }), false);
    // When no appeal metadata, falls back to approved/closed status
    assert.equal(canRequestPartyAppeal("DECISION_APPROVED", null), true);
    assert.equal(canRequestPartyAppeal("CLOSED", null), true);
    assert.equal(canRequestPartyAppeal("IN_PROGRESS", null), false);
  });

  it("validateAppealReason checks min and max length", () => {
    assert.equal(validateAppealReason("").ok, false);
    assert.equal(validateAppealReason("   ").ok, false);
    assert.equal(validateAppealReason("Lý do khiếu nại lại").ok, true);
    const tooLong = "a".repeat(4001);
    assert.equal(validateAppealReason(tooLong).ok, false);
  });

  it("gym case status APPEAL_REVIEW has proper label", () => {
    assert.equal(GYM_STATUS_LABEL.APPEAL_REVIEW, "Đang xem xét lại");
  });

  it("appeal notice and success text match contract", () => {
    assert.ok(APPEAL_NOTICE_TEXT.includes("14 ngày"));
    assert.ok(APPEAL_SUCCESS_TEXT.includes("Kết quả hiện tại chưa thay đổi"));
  });
});
