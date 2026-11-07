/**
 * gb2-followups.test.ts
 * Unit tests for Phase 2 follow-up features:
 * - Agreements (A41-A44, B7)
 * - Quota corrections (A48-A49)
 * - Appeal obligations (A51-A52)
 * - Deadlines model (A37, G31, G36)
 * - Stuck queue model (A38)
 * - Gym SLA labels (G31)
 * - Held money periodic review error codes (A39-A40)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agreementOutcomeLabel,
  agreementStatusLabel,
  agreementStatusTone,
  validateAgreementProposal,
  PROPOSE_AGREEMENT_CONFIRM,
  WITHDRAW_AGREEMENT_CONFIRM,
  RECORD_FINDING_AGREEMENT_CONFIRM,
  PARTY_CONFIRM_AGREEMENT_NOTE,
} from "../disputes/workspace/agreementModel";
import {
  DEADLINE_NOTE,
  deadlineDueText,
  deadlineKindLabel,
  deadlinePartyLabel,
  deadlineStatusLabel,
  deadlineStatusTone,
} from "../disputes/workspace/deadlinesModel";
import {
  QUEUE_VIEWS,
  STUCK_KINDS,
  stuckKindLabel,
  stuckKindTone,
  STUCK_NOTE,
  describeListFailure,
} from "../disputes/queue/queueModel";
import {
  slaStatusLabel,
  slaStatusTone,
} from "../complaints/gymCaseLabels";
import { parseDisputeError } from "../disputes/disputeCaseErrors";
import { exitRefCandidates } from "../reconciliation/moneyExceptions/heldMoneyModel";
import {
  quotaDelta,
  quotaSentence,
  quotaHistoryLine,
} from "../disputes/workspace/quotaCorrectionModel";
import { eventLabel } from "../disputes/workspace/workspaceModel";
import type { D65bSummary } from "../reconciliation/moneyExceptions/moneyExceptionTypes";

describe("Agreements model (A41-A44, B7)", () => {
  it("maps outcome labels in Vietnamese without raw English enums", () => {
    assert.equal(agreementOutcomeLabel("COMPLETED"), "Buổi tập được tính là đã hoàn thành");
    assert.equal(agreementOutcomeLabel("CANCELLED"), "Buổi tập huỷ, không trừ buổi");
    assert.equal(agreementOutcomeLabel("PT_NO_SHOW_CONFIRMED"), "Xác nhận huấn luyện viên vắng mặt");
    assert.equal(agreementOutcomeLabel("UNKNOWN"), "Phương án khác");
    assert.equal(agreementOutcomeLabel(null), "Phương án khác");
  });

  it("maps agreement statuses to Vietnamese labels and semantic tones", () => {
    assert.equal(agreementStatusLabel("PROPOSED"), "Đang chờ hai bên xác nhận");
    assert.equal(agreementStatusLabel("AGREED"), "Cả hai bên đã xác nhận");
    assert.equal(agreementStatusLabel("WITHDRAWN"), "Đã rút phương án");
    assert.equal(agreementStatusLabel("USED"), "Đã ghi nhận kết luận");
    assert.equal(agreementStatusLabel("UNKNOWN"), "Chưa rõ trạng thái");

    assert.equal(agreementStatusTone("PROPOSED"), "pending");
    assert.equal(agreementStatusTone("AGREED"), "success");
    assert.equal(agreementStatusTone("USED"), "info");
    assert.equal(agreementStatusTone("WITHDRAWN"), "neutral");
    assert.equal(agreementStatusTone("UNKNOWN"), "neutral");
  });

  it("validates proposal inputs correctly", () => {
    assert.equal(validateAgreementProposal(null, "note").ok, false);
    assert.equal(validateAgreementProposal("COMPLETED", "a".repeat(2001)).ok, false);
    assert.equal(validateAgreementProposal("COMPLETED", "").ok, false);
    assert.equal(validateAgreementProposal("COMPLETED", "Thoả thuận hợp lệ").ok, true);
    assert.equal(validateAgreementProposal("CANCELLED", "Lý do huỷ hợp lệ").ok, true);
  });

  it("contains clear Vietnamese confirmation texts and disclaimers", () => {
    assert.ok(PROPOSE_AGREEMENT_CONFIRM.includes("thoả thuận chung"));
    assert.ok(WITHDRAW_AGREEMENT_CONFIRM.includes("Rút phương án"));
    assert.ok(RECORD_FINDING_AGREEMENT_CONFIRM.includes("kết luận"));
    assert.ok(PARTY_CONFIRM_AGREEMENT_NOTE.includes("không phải phán quyết"));
  });
});

describe("Deadlines model (A37, G31, G36)", () => {
  it("preserves exact required legal notice text", () => {
    assert.equal(
      DEADLINE_NOTE,
      "Hết hạn chỉ ghi nhận việc không phản hồi, không phán quyết chống lại bên im lặng."
    );
  });

  it("maps deadline kind labels in Vietnamese", () => {
    assert.equal(deadlineKindLabel("PT_NO_SHOW_ANSWER"), "PT phản hồi báo vắng");
    assert.equal(deadlineKindLabel("COLLECT_EVIDENCE"), "Thu thập bằng chứng");
    assert.equal(deadlineKindLabel("AWAITING_PARTIES"), "Phản hồi thông tin");
    assert.equal(deadlineKindLabel("APPEAL_WINDOW"), "Thời hạn yêu cầu xem xét lại");
    assert.equal(deadlineKindLabel("CUSTOM_KIND"), "CUSTOM_KIND");
    assert.equal(deadlineKindLabel(null), "Thời hạn khác");
  });

  it("maps deadline party labels in Vietnamese", () => {
    assert.equal(deadlinePartyLabel("CLIENT"), "Khách");
    assert.equal(deadlinePartyLabel("PT"), "PT");
    assert.equal(deadlinePartyLabel("MEMBER"), "Hội viên");
    assert.equal(deadlinePartyLabel("GYM"), "Phòng tập");
    assert.equal(deadlinePartyLabel(null), "Bên liên quan");
  });

  it("maps deadline status labels and tones", () => {
    assert.equal(deadlineStatusLabel("OPEN"), "Đang mở");
    assert.equal(deadlineStatusLabel("SATISFIED"), "Đã hoàn thành");
    assert.equal(deadlineStatusLabel("EXPIRED"), "Đã hết hạn");
    assert.equal(deadlineStatusLabel("CANCELLED"), "Đã huỷ");
    assert.equal(deadlineStatusLabel(null), "Đang theo dõi");

    assert.equal(deadlineStatusTone("OPEN"), "info");
    assert.equal(deadlineStatusTone("SATISFIED"), "success");
    assert.equal(deadlineStatusTone("EXPIRED"), "danger");
    assert.equal(deadlineStatusTone("OTHER"), "neutral");
  });

  it("handles paused state and missing dueAt correctly", () => {
    assert.equal(deadlineDueText(null, false), "Đang tạm dừng");
    assert.equal(deadlineDueText("2026-11-10T12:00:00Z", true), "Đang tạm dừng");
    assert.notEqual(deadlineDueText("2026-11-10T12:00:00Z", false), "Đang tạm dừng");
  });
});

describe("Stuck queue model (A38)", () => {
  it("includes stuck view in QUEUE_VIEWS", () => {
    assert.ok(QUEUE_VIEWS.includes("stuck"));
    assert.ok(QUEUE_VIEWS.includes("cases"));
    assert.ok(QUEUE_VIEWS.includes("sessions"));
  });

  it("defines stuck kinds and maps Vietnamese labels and tones", () => {
    assert.deepEqual(STUCK_KINDS, ["POLICY_PENDING", "NEEDS_HUMAN", "EXEC_BLOCKED"]);
    assert.equal(stuckKindLabel("POLICY_PENDING"), "Chờ chốt chính sách");
    assert.equal(stuckKindLabel("NEEDS_HUMAN"), "Cần người xem xét");
    assert.equal(stuckKindLabel("EXEC_BLOCKED"), "Thực thi bị nghẽn");
    assert.equal(stuckKindLabel("UNKNOWN"), "UNKNOWN");

    assert.equal(stuckKindTone("POLICY_PENDING"), "warning");
    assert.equal(stuckKindTone("NEEDS_HUMAN"), "danger");
    assert.equal(stuckKindTone("EXEC_BLOCKED"), "danger");
    assert.equal(stuckKindTone("OTHER"), "info");

    assert.ok(STUCK_NOTE.includes("nghẽn quy trình"));
  });

  it("describes list failure for stuck view cleanly", () => {
    const errorView = parseDisputeError({
      response: {
        status: 500,
        data: { code: "INTERNAL_ERROR", message: "Lỗi kết nối" },
      },
    });
    const failure = describeListFailure(errorView, "stuck");
    assert.ok(failure.title.includes("danh sách hồ sơ cần người xử lý"));
    assert.ok(failure.body.includes("không có hồ sơ bị nghẽn nào"));
  });
});

describe("Gym SLA labels (G31)", () => {
  it("maps gym SLA states to Vietnamese labels and semantic tones", () => {
    assert.equal(slaStatusLabel("OK"), "Trong hạn xử lý");
    assert.equal(slaStatusLabel("WARNING"), "Cảnh báo tiến độ");
    assert.equal(slaStatusLabel("OVERDUE"), "Quá hạn SLA");
    assert.equal(slaStatusLabel("SLA_OVERDUE_ESCALATED"), "Quá hạn SLA (đã chuyển tiếp)");
    assert.equal(slaStatusLabel("UNKNOWN"), "Đang theo dõi");

    assert.equal(slaStatusTone("OK"), "info");
    assert.equal(slaStatusTone("WARNING"), "warning");
    assert.equal(slaStatusTone("OVERDUE"), "danger");
    assert.equal(slaStatusTone("SLA_OVERDUE_ESCALATED"), "danger");
    assert.equal(slaStatusTone("UNKNOWN"), "neutral");
  });
});

describe("Phase 2 error code mappings", () => {
  const checkError = (code: string, expectedSubstr: string) => {
    const parsed = parseDisputeError({
      response: { status: 400, data: { code } },
    });
    assert.ok(
      parsed.message.toLowerCase().includes(expectedSubstr.toLowerCase()),
      `Code ${code} message "${parsed.message}" does not include "${expectedSubstr}"`
    );
  };

  it("maps agreement error codes (A41-A44, B7)", () => {
    checkError("AGREEMENT_CONTENT_MISMATCH", "không khớp");
    checkError("AGREEMENT_ALREADY_CONFIRMED", "đã xác nhận");
    checkError("AGREEMENT_NOT_OPEN", "chờ xác nhận");
    checkError("AGREEMENT_NOT_AGREED", "chưa cùng xác nhận");
    checkError("AGREEMENT_NOT_FOUND", "phương án thoả thuận");
  });

  it("maps quota correction error codes (A48-A49)", () => {
    checkError("QUOTA_OUT_OF_BOUNDS", "ngoài khoảng");
    checkError("CORRECTION_ALREADY_APPLIED", "đã được áp dụng");
    checkError("QUOTA_CHANGED", "vừa thay đổi");
    checkError("CORRECTION_ALREADY_PROPOSED", "đang chờ duyệt");
    checkError("CORRECTION_NOT_FOUND", "không tìm thấy đề xuất");
    checkError("CONSEQUENCE_NOT_FOUND", "không tìm thấy hệ quả");
    checkError("CONSEQUENCE_NOT_OPEN", "đã được xử lý xong");
  });

  it("maps appeal obligation error codes (A51-A52)", () => {
    checkError("MONEY_NOT_ESTABLISHED", "chưa xác lập số tiền");
    checkError("CONTRACT_HAS_NO_PAYMENT", "chưa có khoản thanh toán");
    checkError("AMOUNT_EXCEEDS_CONTRACT", "vượt quá giá trị");
    checkError("OBLIGATION_UNAVAILABLE", "chưa kết nối được");
  });

  it("maps held money review error codes (A39-A40)", () => {
    checkError("EXIT_REF_REQUIRED", "cần chọn đề xuất");
    checkError("EXIT_REF_NOT_ALLOWED", "không kèm theo");
    checkError("EXIT_REF_NOT_FOUND", "không tìm thấy đề xuất");
    checkError("HELD_REVIEW_NOT_FOUND", "kỳ rà soát");
    checkError("HELD_REVIEW_CLOSED", "không còn ở trạng thái bị giữ");
  });
});

describe("Held money exitRefCandidates (P2-FIX-1)", () => {
  const dummyProposals = [
    {
      id: "prop-1",
      sessionId: "session-100",
      contractId: "contract-1",
      status: "PROPOSED",
      proposedBy: "adm-1",
      reason: "Đề xuất 1",
      evidenceRefs: [],
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "prop-2",
      sessionId: "session-100",
      contractId: "contract-1",
      status: "REJECTED",
      proposedBy: "adm-2",
      reason: "Đề xuất bị từ chối",
      evidenceRefs: [],
      createdAt: "2026-11-02T00:00:00Z",
    },
    {
      id: "prop-3",
      sessionId: "session-200",
      contractId: "contract-2",
      status: "PROPOSED",
      proposedBy: "adm-3",
      reason: "Đề xuất buổi khác",
      evidenceRefs: [],
      createdAt: "2026-11-03T00:00:00Z",
    },
  ] as unknown as D65bSummary[];

  it("filters proposals by sessionId and excludes REJECTED proposals", () => {
    const candidates = exitRefCandidates(dummyProposals, "session-100");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, "prop-1");
  });

  it("excludes all proposals from other sessions", () => {
    const candidates = exitRefCandidates(dummyProposals, "session-300");
    assert.equal(candidates.length, 0);
  });

  it("handles null or undefined proposals cleanly", () => {
    assert.deepEqual(exitRefCandidates(null, "session-100"), []);
    assert.deepEqual(exitRefCandidates(undefined, "session-100"), []);
    assert.deepEqual(exitRefCandidates([], "session-100"), []);
    assert.deepEqual(exitRefCandidates(dummyProposals, ""), []);
  });
});

describe("Quota correction direction & delta model (P2-FIX-2)", () => {
  it("calculates negative delta for give_back (Trả lại buổi cho khách)", () => {
    const res = quotaDelta("give_back", 1);
    assert.equal(res.ok, true);
    assert.equal(res.delta, -1);

    const res5 = quotaDelta("give_back", "5");
    assert.equal(res5.ok, true);
    assert.equal(res5.delta, -5);
  });

  it("calculates positive delta for charge (Tính thêm buổi đã dùng)", () => {
    const res = quotaDelta("charge", 3);
    assert.equal(res.ok, true);
    assert.equal(res.delta, 3);
  });

  it("rejects 0, 101, floats, and empty directions", () => {
    assert.equal(quotaDelta("give_back", 0).ok, false);
    assert.equal(quotaDelta("give_back", 101).ok, false);
    assert.equal(quotaDelta("give_back", 2.5).ok, false);
    assert.equal(quotaDelta("", 1).ok, false);
    assert.equal(quotaDelta(undefined, 1).ok, false);
  });

  it("formats pending row in words, never a signed number", () => {
    assert.equal(quotaSentence(-1), "Trả lại 1 buổi cho khách");
    assert.equal(quotaSentence(-5), "Trả lại 5 buổi cho khách");
    assert.equal(quotaSentence(2), "Tính thêm 2 buổi đã dùng");
    assert.equal(quotaSentence(0), "Không thay đổi số buổi");
  });

  it("formats history line for applied corrections", () => {
    const line = quotaHistoryLine({
      id: "corr-1",
      delta: -1,
      reason: "Đền bù",
      createdAt: "2026-11-01T00:00:00Z",
      appliedAt: "2026-11-02T10:00:00Z",
      usedBefore: 5,
      usedAfter: 4,
    });
    assert.ok(line.includes("số buổi đã dùng 5 → 4"));
  });
});

describe("Stuck queue audit label (P2-FIX-5)", () => {
  it("maps raw audit action enums to Vietnamese labels via eventLabel", () => {
    const label = eventLabel("DISPUTE_OPENED");
    assert.ok(label.length > 0);
    assert.doesNotMatch(label, /DISPUTE_OPENED/);
  });
});
