/**
 * Phase 13 cụm C — AD-04 "Xử lý".
 *
 * Chạy: npx tsx --test src/features/__tests__/adminResolve.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RULINGS,
  complaintNextSteps,
  complaintResponseError,
  complaintRows,
  disputeRows,
  membershipIdError,
  refundAmountError,
  refundCalc,
  refundNoteError,
  refundRows,
  rulingNoteError,
} from "../admin/adminResolve";

describe("tranh chấp buổi tập", () => {
  it("ba kết luận, mỗi cái nói rõ hệ quả tiền", () => {
    assert.deepEqual(RULINGS.map((r) => r.value), ["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"]);
    assert.ok(RULINGS.every((r) => r.consequence.length > 20));
  });
  it("căn cứ phân xử bắt buộc", () => {
    assert.ok(rulingNoteError(""));
    assert.ok(rulingNoteError("ngắn"));
    assert.equal(rulingNoteError("Có ảnh check-in lúc 8:05 của khách"), null);
    assert.equal(disputeRows({ data: [{ id: "s" }, {}] }).length, 1);
  });
});

describe("hoàn tiền dịch vụ 1-1", () => {
  it("đọc số của máy chủ, không tự tính", () => {
    const c = refundCalc({ data: { totalPaid: "500000", alreadyRefunded: 0, refundableCeiling: 300000, milestones: { draftDelivered: true } } })!;
    assert.equal(c.totalPaid, 500000);
    assert.equal(c.refundableCeiling, 300000);
    assert.deepEqual(c.milestones, { intakeSubmitted: false, draftDelivered: true, accepted: false });
    assert.equal(refundCalc(null), null);
    assert.equal(refundRows([{ id: "o" }]).length, 1);
  });
  it("số tiền trong trần; ghi chú bắt buộc", () => {
    assert.ok(refundAmountError("", 300000));
    assert.ok(refundAmountError("0", 300000));
    assert.ok(refundAmountError("300001", 300000));
    assert.equal(refundAmountError("300.000", 300000), null);
    assert.ok(refundNoteError(""));
    assert.equal(refundNoteError("PT chưa giao bản nháp"), null);
  });
});

describe("khiếu nại phòng gym", () => {
  it("một chiều, xử lý xong là điểm cuối", () => {
    assert.deepEqual(complaintNextSteps("OPEN").map((s) => s.value), ["IN_PROGRESS", "RESOLVED"]);
    assert.deepEqual(complaintNextSteps("IN_PROGRESS").map((s) => s.value), ["RESOLVED"]);
    assert.deepEqual(complaintNextSteps("RESOLVED"), []);
  });
  it("đóng khiếu nại phải có phản hồi cho đối tác", () => {
    assert.ok(complaintResponseError("RESOLVED", ""));
    assert.equal(complaintResponseError("IN_PROGRESS", ""), null);
    assert.equal(complaintResponseError("RESOLVED", "Đã yêu cầu sửa máy chạy bộ trong 3 ngày"), null);
    assert.equal(complaintRows({ data: [{ id: "c", status: "OPEN" }] }).length, 1);
  });
});

describe("hoàn tiền gói hội viên ngoại lệ", () => {
  it("mã gói phải là UUID", () => {
    assert.ok(membershipIdError(""));
    assert.ok(membershipIdError("abc"));
    assert.equal(membershipIdError("b7697bab-b653-4f24-89d4-d9c0839100dd"), null);
  });
});
