/**
 * Phase 13 cụm B — đơn ứng tuyển PT và kế hoạch trên chợ.
 *
 * Chạy: npx tsx --test src/features/__tests__/adminModeration.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  absoluteUrl,
  applicantEmail,
  applicantName,
  listingAnalysis,
  listingRejectError,
  listingSchedule,
  ptActions,
  ptAwaitingCount,
  ptCertificates,
  ptDocuments,
  ptMessageError,
  ptReviewPayload,
  ptWaitingText,
  sortPtQueue,
} from "../admin/adminModeration";

describe("đơn PT — app tự chặn vì máy chủ không kiểm trạng thái", () => {
  it("hành động theo trạng thái", () => {
    assert.deepEqual(ptActions("SUBMITTED"), ["UNDER_REVIEW", "APPROVE", "REQUEST_INFO", "REJECT"]);
    assert.deepEqual(ptActions("UNDER_REVIEW"), ["APPROVE", "REQUEST_INFO", "REJECT"]);
    for (const s of ["DRAFT", "NEEDS_MORE_INFO", "APPROVED", "REJECTED", undefined]) assert.deepEqual(ptActions(s), []);
    assert.ok(ptWaitingText("NEEDS_MORE_INFO"));
    assert.equal(ptWaitingText("SUBMITTED"), null);
  });

  it("một ô lời nhắn cho người nộp, đi đúng trường máy chủ đọc", () => {
    assert.deepEqual(ptReviewPayload("REQUEST_INFO", " Thiếu ảnh CCCD mặt sau "), { adminNote: "Thiếu ảnh CCCD mặt sau" });
    assert.deepEqual(ptReviewPayload("REJECT", "Chứng chỉ không hợp lệ"), { rejectionReason: "Chứng chỉ không hợp lệ" });
    assert.deepEqual(ptReviewPayload("APPROVE", "bất kỳ"), {});
    assert.ok(ptMessageError("REJECT", ""));
    assert.ok(ptMessageError("REQUEST_INFO", "ngắn"));
    assert.equal(ptMessageError("APPROVE", ""), null);
  });

  it("hàng chờ: việc cần làm trước, nộp sớm lên đầu", () => {
    const rows = [
      { id: "a", status: "APPROVED", submittedAt: "2026-09-01T00:00:00Z" },
      { id: "b", status: "SUBMITTED", submittedAt: "2026-09-24T00:00:00Z" },
      { id: "c", status: "UNDER_REVIEW", submittedAt: "2026-09-20T00:00:00Z" },
      { id: "d", status: "SUBMITTED", submittedAt: "2026-09-10T00:00:00Z" },
    ];
    assert.deepEqual(sortPtQueue(rows).map((r) => r.id), ["d", "b", "c", "a"]);
    assert.equal(ptAwaitingCount(rows), 3);
  });

  it("người nộp, giấy tờ, chứng chỉ, đường dẫn", () => {
    const app = {
      id: "x",
      status: "SUBMITTED",
      user: { firstName: "John", lastName: "Doe", email: "john@x" },
      idCardFrontUrl: "/pt-applications/documents/a.jpg?exp=1&sig=2",
      idCardBackUrl: null,
      portraitPhotoUrl: "",
      certificates: [{ certificateName: "NASM-CPT", issuingOrganization: "NASM", isCurrentlyValid: true, certificateFileUrl: "/c.pdf" }],
    };
    assert.equal(applicantName(app), "John Doe");
    assert.equal(applicantEmail(app), "john@x");
    assert.deepEqual(ptDocuments(app).map((d) => d.label), ["CCCD mặt trước", "NASM-CPT"]);
    assert.deepEqual(ptCertificates(app), [{ name: "NASM-CPT", issuer: "NASM", valid: true }]);
    assert.equal(absoluteUrl("http://localhost:3000/", "/pt-applications/documents/a.jpg"), "http://localhost:3000/pt-applications/documents/a.jpg");
    assert.equal(absoluteUrl("http://h", "https://cdn/x"), "https://cdn/x");
  });
});

describe("kế hoạch trên chợ", () => {
  const listing = {
    id: "l",
    title: "Kế hoạch A",
    sourcePlan: { plan: { weeklySchedule: [{ day: "Day 1", goal: "Full body", exercises: [{ name: "Squat", sets: 3, reps: "10" }] }] } },
    moderationAnalyses: [
      { aiRecommendation: "likely_unsafe", usedFallback: true, ruleFlags: ["NO_REST_DAY", "LẠ"], similarListings: [{ title: "B", similarityScore: 0.91 }] },
    ],
  };

  it("phân tích tự động chỉ để tham khảo — nhãn tiếng Việt, cờ lạ giữ nguyên", () => {
    const a = listingAnalysis(listing)!;
    assert.equal(a.recommendation.tone, "danger");
    assert.equal(a.usedFallback, true);
    assert.deepEqual(a.flags, ["Không có ngày nghỉ (7/7 ngày)", "LẠ"]);
    assert.deepEqual(a.similar, ["B (91%)"]);
    assert.equal(listingAnalysis({ id: "x", title: "t" }), null);
  });

  it("lịch tập đọc đúng trường day/goal/exercises", () => {
    assert.deepEqual(listingSchedule(listing), [{ title: "Day 1 · Full body", exercises: ["Squat — 3×10"] }]);
  });

  it("từ chối cần lý do đọc được", () => {
    assert.ok(listingRejectError(""));
    assert.equal(listingRejectError("Lịch 7/7 ngày không có nghỉ"), null);
  });
});
