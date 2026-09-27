/**
 * Phase 13 — WB-17 "Duyệt hồ sơ đối tác".
 *
 * Điểm cốt lõi: **máy chủ quyết định có duyệt được hay không**. `approve.blockers` do
 * `computeApproveBlockers` của gym-service tính và đã kèm câu tiếng Việt; ứng dụng chỉ hiển thị lại,
 * không dựng luật duyệt lần thứ hai.
 *
 * Chạy: npx tsx --test src/features/__tests__/adminApplications.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CHANGE_REQUEST,
  REVIEW_TABS,
  adminDocuments,
  adminIssues,
  applicationCounts,
  applicationRows,
  applicationSubtitle,
  applicationTitle,
  approveBlockers,
  canApprove,
  changeRequestError,
  changeRequestPayload,
  documentsAwaitingReview,
  rejectError,
  sortByWaiting,
  verificationStatus,
  waitingDays,
  waitingLabel,
} from "../adminApplications/adminApplications";

describe("hàng chờ", () => {
  it("đọc mọi kiểu bọc và bỏ dòng không có id", () => {
    const items = [{ id: "a" }, { id: "b" }, { nope: true }];
    assert.equal(applicationRows({ items }).length, 2);
    assert.equal(applicationRows({ data: { items } }).length, 2);
    assert.equal(applicationRows(items).length, 2);
    assert.equal(applicationRows(null).length, 0);
    assert.deepEqual(applicationCounts({ counts: { IN_REVIEW: 3 } }), { IN_REVIEW: 3 });
    assert.deepEqual(applicationCounts(null), {});
  });

  it("bốn hàng chờ theo PartnerVerificationStatus, nhãn nói theo việc phải làm", () => {
    assert.deepEqual(REVIEW_TABS.map((t) => t.value), ["IN_REVIEW", "NEEDS_INFO", "VERIFIED", "REJECTED"]);
    // Với admin, IN_REVIEW nghĩa là "đang chờ MÌNH xem" — không dịch thẳng tên enum.
    assert.equal(verificationStatus("IN_REVIEW").label, "Chờ duyệt");
    assert.equal(verificationStatus("NEEDS_INFO").label, "Đã yêu cầu sửa");
    assert.equal(verificationStatus("LẠ").label, "LẠ");
  });

  it("tên hiển thị lùi dần, không bao giờ để trống", () => {
    assert.equal(applicationTitle({ id: "1", brandName: "Gymini" }), "Gymini");
    assert.equal(applicationTitle({ id: "1", legalName: "Cty TNHH X" }), "Cty TNHH X");
    assert.equal(applicationTitle({ id: "1", contactEmail: "a@b.c" }), "a@b.c");
    assert.equal(applicationTitle({ id: "1" }), "Hồ sơ chưa đặt tên");
    assert.equal(applicationSubtitle({ id: "1", firstBranchName: "CN 1", contactEmail: "a@b.c" }), "CN 1 · a@b.c");
    assert.equal(applicationSubtitle({ id: "1" }), "Chưa có chi nhánh");
  });

  it("hồ sơ nộp lâu nhất lên đầu — hàng chờ xử lý theo thứ tự đến", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const rows = [
      { id: "moi", submittedAt: "2026-09-26T00:00:00Z" },
      { id: "cu", submittedAt: "2026-09-20T00:00:00Z" },
      { id: "giua", submittedAt: "2026-09-24T00:00:00Z" },
    ];
    assert.deepEqual(sortByWaiting(rows).map((r) => r.id), ["cu", "giua", "moi"]);
    assert.equal(waitingDays(rows[1], now), 7);
    assert.equal(waitingLabel(rows[0], now), "1 ngày trước");
    assert.equal(waitingLabel({ id: "x", submittedAt: now.toISOString() }, now), "Hôm nay");
    assert.equal(waitingDays({ id: "x" }, now), null);
    // Chưa nộp thì lấy ngày tạo, chứ không bỏ khỏi hàng chờ.
    assert.equal(waitingDays({ id: "x", createdAt: "2026-09-25T00:00:00Z" }, now), 2);
  });
});

describe("máy chủ quyết định có duyệt được không", () => {
  it("lấy nguyên câu của máy chủ, không diễn giải lại", () => {
    const d = {
      approve: {
        canApprove: false,
        blockers: [
          { code: "ISSUES_UNRESOLVED", message: "Còn 2 vấn đề chưa được đóng" },
          { code: "DOCUMENT_NOT_VERIFIED", message: "Giấy tờ BUSINESS_LICENSE chưa được chấp nhận" },
        ],
      },
    };
    assert.deepEqual(approveBlockers(d), [
      "Còn 2 vấn đề chưa được đóng",
      "Giấy tờ BUSINESS_LICENSE chưa được chấp nhận",
    ]);
    assert.equal(canApprove(d), false);
  });

  it("không có chướng ngại nào thì mới cho duyệt — và thiếu dữ liệu là KHÔNG cho", () => {
    assert.equal(canApprove({ approve: { canApprove: true, blockers: [] } }), true);
    assert.deepEqual(approveBlockers({ approve: { canApprove: true, blockers: [] } }), []);
    // Máy chủ chưa trả gì thì không được suy ra là duyệt được.
    assert.equal(canApprove(null), false);
    assert.equal(canApprove({}), false);
    assert.equal(canApprove({ approve: { canApprove: null } }), false);
  });

  it("chướng ngại không có câu chữ vẫn phải hiện, và KHÔNG đoán lý do", () => {
    const out = approveBlockers({ approve: { canApprove: false, blockers: [{ code: "X" }] } });
    assert.equal(out.length, 1);
    assert.equal(out[0], "Còn một điều kiện chưa đạt");
  });
});

describe("giấy tờ và góp ý", () => {
  const d = {
    documents: [
      { docType: "BUSINESS_LICENSE", hasFile: true, status: "RECEIVED" },
      { docType: "REPRESENTATIVE_ID", hasFile: true, status: "VERIFIED" },
      { docType: "PREMISES_PROOF", hasFile: false, status: "PENDING" },
      { noType: true },
    ],
    issues: [{ id: "i1", status: "OPEN" }, { noId: true }],
  };

  it("đúng việc admin phải làm: giấy tờ ĐÃ NỘP mà chưa chấp nhận", () => {
    assert.equal(adminDocuments(d).length, 3);
    assert.equal(adminIssues(d).length, 1);
    const awaiting = documentsAwaitingReview(d);
    assert.deepEqual(awaiting.map((x: any) => x.docType), ["BUSINESS_LICENSE"]);
    // Chưa nộp thì không phải việc của admin; đã xác minh thì xong rồi.
    assert.equal(documentsAwaitingReview(null).length, 0);
  });
});

describe("yêu cầu chỉnh sửa và từ chối", () => {
  it("yêu cầu rỗng bị chặn — ứng viên phải biết sửa gì", () => {
    assert.ok(changeRequestError(EMPTY_CHANGE_REQUEST));
    assert.ok(changeRequestError({ ...EMPTY_CHANGE_REQUEST, message: "sửa đi" }), "quá ngắn để hiểu");
    assert.equal(
      changeRequestError({ ...EMPTY_CHANGE_REQUEST, message: "Ảnh giấy phép bị mờ, chụp lại giúp" }),
      null,
    );
    // Chỉ ghi chú cho giấy tờ cũng là một yêu cầu hợp lệ.
    assert.equal(
      changeRequestError({ ...EMPTY_CHANGE_REQUEST, documents: [{ docType: "BUSINESS_LICENSE", note: "Mờ" }] }),
      null,
    );
  });

  it("payload bỏ phần trống, không gửi mục rỗng", () => {
    const p = changeRequestPayload({
      category: "PHOTOS",
      message: "  Ảnh mặt tiền bị thiếu  ",
      documents: [
        { docType: "BUSINESS_LICENSE", note: " Mờ " },
        { docType: "PREMISES_PROOF", note: "   " },
      ],
    });
    assert.deepEqual(p.issues, [{ category: "PHOTOS", message: "Ảnh mặt tiền bị thiếu" }]);
    assert.deepEqual(p.documents, [{ docType: "BUSINESS_LICENSE", note: "Mờ" }]);

    const onlyDocs = changeRequestPayload({ category: "LEGAL", message: "   ", documents: [] });
    assert.deepEqual(onlyDocs.issues, [], "không đẻ ra một mục rỗng");
  });

  it("từ chối bắt buộc có lý do đọc được — đó là điểm cuối với ứng viên", () => {
    assert.ok(rejectError(""));
    assert.ok(rejectError("không đạt"));
    assert.equal(rejectError("Giấy phép kinh doanh không khớp địa chỉ cơ sở"), null);
  });
});
