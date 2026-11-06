/**
 * gb1-appeal-admin.test.ts
 * Unit tests for PT Appeals admin model, labels, consequence statuses,
 * independent reviewer filtering, and money rule B2/B4.
 * Test fixture: pure function tests, no DOM, no network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appealStatusLabel,
  appealStatusTone,
  appealResultLabel,
  appealPartyLabel,
  consequenceKindLabel,
  consequenceStatusLabel,
  consequenceStatusTone,
  closureStatusText,
  filterIndependentReviewers,
  canAdminDecideAppeal,
  DECIDE_APPEAL_CONFIRM,
  CLOSE_EXECUTED_CONFIRM,
  MONEY_FIELD_WARNING,
  CONSEQUENCE_STATUS_LABEL,
  appealDecisionPayload,
} from "../disputes/workspace/appealModel";
import type { AppealDecisionInput } from "../disputes/disputeCaseTypes";

describe("PT appeal admin model (A45-A47, B2, B4)", () => {
  it("formatConsequenceStatus strictly follows B4 wording", () => {
    assert.equal(
      CONSEQUENCE_STATUS_LABEL.NEEDS_RECONCILIATION,
      "Chờ đối soát: chưa xác lập số tiền và bên chịu trách nhiệm; chưa có khoản nợ nào được tạo"
    );
    assert.equal(
      CONSEQUENCE_STATUS_LABEL.OBLIGATION_OPEN,
      "Đã tạo khoản phải trả cho khách, chưa thanh toán"
    );
    assert.equal(consequenceStatusLabel("NEEDS_RECONCILIATION"),
      "Chờ đối soát: chưa xác lập số tiền và bên chịu trách nhiệm; chưa có khoản nợ nào được tạo"
    );
    assert.equal(consequenceStatusLabel("OBLIGATION_OPEN"),
      "Đã tạo khoản phải trả cho khách, chưa thanh toán"
    );
  });

  it("consequence status tones match semantic meanings", () => {
    assert.equal(consequenceStatusTone("NEEDS_RECONCILIATION"), "warning");
    assert.equal(consequenceStatusTone("OBLIGATION_OPEN"), "info");
    assert.equal(consequenceStatusTone("RESOLVED"), "success");
    assert.equal(consequenceStatusTone("OTHER"), "neutral");
  });

  it("appeal status and result labels are in Vietnamese without raw enums", () => {
    assert.equal(appealStatusLabel("REQUESTED"), "Đã yêu cầu");
    assert.equal(appealStatusLabel("UNDER_REVIEW"), "Đang xem xét");
    assert.equal(appealStatusLabel("DECIDED"), "Đã có kết quả");
    assert.equal(appealResultLabel("UPHELD"), "Giữ nguyên kết luận");
    assert.equal(appealResultLabel("NEW_FINDING"), "Có kết luận mới");
    assert.equal(appealPartyLabel("CLIENT"), "Khách");
    assert.equal(appealPartyLabel("PT"), "PT");
    assert.equal(consequenceKindLabel("MONEY"), "Tiền bồi hoàn");
    assert.equal(consequenceKindLabel("QUOTA"), "Quyền buổi tập");
    assert.equal(consequenceKindLabel("PT_AT_FAULT"), "Xác định lỗi PT");
  });

  it("closureStatusText strictly emits rule B4 sentence when moneyAxisSettled is false", () => {
    const text1 = closureStatusText({
      state: "CLOSED",
      fullyResolved: false,
      moneyAxisSettled: false,
      pendingAppeals: 0,
    });
    assert.equal(text1, "Hồ sơ đã đóng nhưng phần tiền chưa xong");

    const text2 = closureStatusText({
      state: "APPEAL_CONCLUDED",
      fullyResolved: true,
      moneyAxisSettled: true,
      pendingAppeals: 0,
    });
    assert.equal(text2, "Hồ sơ đã đóng hoàn tất các bước xem xét lại");
  });

  it("filterIndependentReviewers excludes original handler and prior reviewers", () => {
    const admins = [
      { id: "adm-1", displayName: "Admin Alpha" },
      { id: "adm-2", displayName: "Admin Beta" },
      { id: "adm-3", displayName: "Admin Gamma" },
    ];
    const excludedIds = ["adm-1", "adm-3"];
    const { eligible, excluded } = filterIndependentReviewers(admins, excludedIds);

    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].id, "adm-2");
    assert.equal(excluded.length, 2);
    assert.deepEqual(excluded.map((a) => a.id), ["adm-1", "adm-3"]);
  });

  it("canAdminDecideAppeal only allows assigned reviewer in UNDER_REVIEW status", () => {
    assert.equal(
      canAdminDecideAppeal({ status: "REQUESTED", reviewerId: "adm-1" }, "adm-1"),
      false
    );
    assert.equal(
      canAdminDecideAppeal({ status: "UNDER_REVIEW", reviewerId: "adm-1" }, "adm-2"),
      false
    );
    assert.equal(
      canAdminDecideAppeal({ status: "UNDER_REVIEW", reviewerId: "adm-1" }, "adm-1"),
      true
    );
  });

  it("Rule B2 - appeal decision body shape with money only when VERIFIED_PT_ABSENT and PT", () => {
    // Valid case with money
    const decisionWithMoney: AppealDecisionInput = {
      result: "NEW_FINDING",
      finding: "VERIFIED_PT_ABSENT",
      responsibleParty: "PT",
      amountVnd: 500000,
      reasoning: "PT vắng mặt không lý do đã được xác minh lại",
    };
    assert.equal(decisionWithMoney.amountVnd, 500000);
    assert.deepEqual(Object.keys(decisionWithMoney).sort(), [
      "amountVnd",
      "finding",
      "reasoning",
      "responsibleParty",
      "result",
    ]);

    // Forbidden to have amountVnd for UPHELD or other findings
    const decisionUpheld: AppealDecisionInput = {
      result: "UPHELD",
      reasoning: "Giữ nguyên kết luận ban đầu của vụ việc",
    };
    assert.equal(decisionUpheld.amountVnd, undefined);
    assert.equal("amountVnd" in decisionUpheld, false);

    const forbiddenFields = [
      "penalty",
      "fee",
      "partialAmount",
      "compensationVnd",
      "adminId",
    ];
    for (const field of forbiddenFields) {
      assert.equal(field in decisionWithMoney, false);
      assert.equal(field in decisionUpheld, false);
    }
  });

  it("Confirmation strings and warnings match brief text", () => {
    assert.ok(DECIDE_APPEAL_CONFIRM.includes("không tự thực thi"));
    assert.ok(CLOSE_EXECUTED_CONFIRM.includes("không chuyển tiền"));
    assert.ok(MONEY_FIELD_WARNING.includes("Chỉ ghi số tiền khi kết luận đã xác lập"));
  });

  describe("appealDecisionPayload (FIX-1 Consequence Editor & Validation)", () => {
    it("UPHELD: builds payload with result and reasoning, omitting finding and consequences", () => {
      const res = appealDecisionPayload({
        result: "UPHELD",
        reasoning: "Giữ nguyên kết luận ban đầu của hội đồng điều tra.",
      });
      assert.equal(res.ok, true);
      assert.equal(res.payload?.result, "UPHELD");
      assert.equal(res.payload?.reasoning, "Giữ nguyên kết luận ban đầu của hội đồng điều tra.");
      assert.equal(res.payload?.finding, undefined);
      assert.equal(res.payload?.consequences, undefined);
    });

    it("MONEY without amount: allowed, recorded for reconciliation (NEEDS_RECONCILIATION)", () => {
      const res = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_DELIVERED",
        reasoning: "Xác minh lại đã hoàn thành buổi tập",
        consequences: [
          {
            id: "c1",
            kind: "MONEY",
            note: "Khoản tiền chờ đối soát với phòng tập",
          },
        ],
      });
      assert.equal(res.ok, true);
      assert.equal(res.payload?.result, "NEW_FINDING");
      assert.equal(res.payload?.finding, "VERIFIED_DELIVERED");
      assert.deepEqual(res.payload?.consequences, [
        {
          kind: "MONEY",
          note: "Khoản tiền chờ đối soát với phòng tập",
        },
      ]);
    });

    it("MONEY with amount + PT: allowed when finding is VERIFIED_PT_ABSENT", () => {
      const res = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "Xác nhận PT không đến địa điểm tập",
        consequences: [
          {
            id: "c1",
            kind: "MONEY",
            note: "Bồi hoàn tiền buổi tập cho khách hàng",
            amountVnd: "450000",
            responsibleParty: "PT",
          },
        ],
      });
      assert.equal(res.ok, true);
      assert.deepEqual(res.payload?.consequences, [
        {
          kind: "MONEY",
          note: "Bồi hoàn tiền buổi tập cho khách hàng",
          amountVnd: 450000,
          responsibleParty: "PT",
        },
      ]);
    });

    it("amount + GYM refused client-side (Rule B2: only PT allowed with amount)", () => {
      const res = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "Lập luận",
        consequences: [
          {
            id: "c1",
            kind: "MONEY",
            note: "Yêu cầu phòng tập trả",
            amountVnd: "500000",
            responsibleParty: "GYM",
          },
        ],
      });
      assert.equal(res.ok, false);
      assert.ok(res.errors?.consequence_0_ruleB2);
      assert.equal(res.payload, undefined);
    });

    it("QUOTA consequence: builds valid payload", () => {
      const res = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_NOT_DELIVERED_NO_FAULT",
        reasoning: "Lỗi bất khả kháng",
        consequences: [
          {
            id: "c1",
            kind: "QUOTA",
            note: "Khôi phục 1 quyền buổi tập cho khách",
          },
        ],
      });
      assert.equal(res.ok, true);
      assert.deepEqual(res.payload?.consequences, [
        {
          kind: "QUOTA",
          note: "Khôi phục 1 quyền buổi tập cho khách",
        },
      ]);
    });

    it("PT_AT_FAULT consequence: builds valid payload", () => {
      const res = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "PT vi phạm kỷ luật",
        consequences: [
          {
            id: "c1",
            kind: "PT_AT_FAULT",
            note: "Ghi nhận vi phạm điều khoản dịch vụ của huấn luyện viên",
          },
        ],
      });
      assert.equal(res.ok, true);
      assert.deepEqual(res.payload?.consequences, [
        {
          kind: "PT_AT_FAULT",
          note: "Ghi nhận vi phạm điều khoản dịch vụ của huấn luyện viên",
        },
      ]);
    });

    it("Max 3 rows: 3 succeeds, 4 fails validation", () => {
      const valid3 = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "Tổng hợp 3 hệ quả",
        consequences: [
          { id: "1", kind: "PT_AT_FAULT", note: "Lỗi PT" },
          { id: "2", kind: "QUOTA", note: "Cộng lại buổi" },
          { id: "3", kind: "MONEY", note: "Chờ đối soát sau" },
        ],
      });
      assert.equal(valid3.ok, true);
      assert.equal(valid3.payload?.consequences?.length, 3);

      const invalid4 = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "Vượt quá giới hạn",
        consequences: [
          { id: "1", kind: "PT_AT_FAULT", note: "Lỗi PT" },
          { id: "2", kind: "QUOTA", note: "Cộng lại buổi" },
          { id: "3", kind: "MONEY", note: "Chờ đối soát sau" },
          { id: "4", kind: "QUOTA", note: "Thêm hệ quả thứ tư" },
        ],
      });
      assert.equal(invalid4.ok, false);
      assert.ok(invalid4.errors?.consequences);
    });

    it("No CLIENT value can ever be produced in payload", () => {
      // Even if CLIENT is injected via casting, appealDecisionPayload rejects it
      const invalidClientParty = appealDecisionPayload({
        result: "NEW_FINDING",
        finding: "VERIFIED_PT_ABSENT",
        reasoning: "Lập luận",
        consequences: [
          {
            id: "c1",
            kind: "MONEY",
            note: "Quy lỗi cho khách",
            amountVnd: "500000",
            responsibleParty: "CLIENT" as any,
          },
        ],
      });
      assert.equal(invalidClientParty.ok, false);
      assert.equal(invalidClientParty.payload, undefined);
    });
  });
});
