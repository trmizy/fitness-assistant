/**
 * FIX4-GYMCASE (N15A-02..05, 07) - CODE AUDIT-level unit tests of the pure label / model helpers of the admin gym-case screens (no browser).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deadlineStatusLabel, deadlineStatusTone } from "../disputes/workspace/deadlinesModel";
import { gymEventLabel, gymOutcomeConsequence, gymStatusLabelFor, gymWaitingNote, GYM_OUTCOME_LABEL } from "../complaints/gymCaseLabels";
import { adminDid, askedPartiesText, eventActor, eventNote, executeAmountText, executionRound, investigatorText, replacementState, reporterText } from "../complaints/gymCaseModel";
import { rememberGymAdminNames, clearGymAdminNames } from "../complaints/gymAdminNames";

const UUID = "d0d00000-1111-4222-8333-444444444444";

describe("N15A-02: every deadline status has a Vietnamese label", () => {
  it("MET / OPEN / EXPIRED / SATISFIED / PAUSED and an unknown code never show raw", () => {
    assert.equal(deadlineStatusLabel("MET"), "Đã phản hồi");
    assert.equal(deadlineStatusLabel("OPEN"), "Đang mở");
    assert.equal(deadlineStatusLabel("EXPIRED"), "Đã hết hạn");
    assert.equal(deadlineStatusLabel("SATISFIED"), "Đã hoàn thành");
    assert.equal(deadlineStatusLabel("SOMETHING_NEW"), "Đang theo dõi");
    assert.equal(deadlineStatusLabel(undefined), "Đang theo dõi");
    assert.equal(deadlineStatusTone("MET"), "success");
  });
});

describe("N15A-07: the status text follows who was asked", () => {
  it("asking only the gym never says the member was told", () => {
    const mi = { askedParties: ["GYM"], pendingParties: ["GYM"] };
    assert.equal(gymStatusLabelFor("AWAITING_PARTIES", mi), "Chờ phòng gym bổ sung");
    const note = gymWaitingNote("AWAITING_PARTIES", "NOT_STARTED", mi);
    assert.match(note, /phòng gym bổ sung/);
    assert.match(note, /Chủ phòng gym đã được báo/);
    assert.doesNotMatch(note, /Hội viên đã được báo/);
  });
  it("member only / both / already answered", () => {
    assert.equal(gymStatusLabelFor("AWAITING_PARTIES", { askedParties: ["MEMBER"] }), "Chờ khách bổ sung");
    assert.match(gymWaitingNote("AWAITING_PARTIES", "NOT_STARTED", { askedParties: ["MEMBER"], pendingParties: ["MEMBER"] }), /Hội viên đã được báo/);
    assert.equal(gymStatusLabelFor("AWAITING_PARTIES", { askedParties: ["MEMBER", "GYM"] }), "Chờ khách và phòng gym bổ sung");
    assert.match(gymWaitingNote("AWAITING_PARTIES", "NOT_STARTED", { askedParties: ["MEMBER", "GYM"], pendingParties: ["GYM"] }), /Đang chờ phòng gym bổ sung.*Cả hai bên đã được báo/);
    assert.match(gymWaitingNote("AWAITING_PARTIES", "NOT_STARTED", { askedParties: ["GYM"], pendingParties: [] }), /Đã nhận phản hồi của phòng gym/);
  });
  it("without the request info (older cases, lists) the wording is neutral, not 'hội viên'", () => {
    assert.equal(gymStatusLabelFor("AWAITING_PARTIES", null), "Chờ bổ sung thông tin");
    assert.doesNotMatch(gymWaitingNote("AWAITING_PARTIES", "NOT_STARTED", null), /Hội viên đã được báo/);
    assert.equal(gymStatusLabelFor("ASSESSING", { askedParties: ["GYM"] }), "Đang đánh giá");
  });
});

describe("N15A-03: admins and the reporter are shown by name, never a code", () => {
  it("history actors / investigator / approver", () => {
    clearGymAdminNames();
    rememberGymAdminNames([{ id: UUID, displayName: "Lê Quản Trị" }]);
    assert.equal(eventActor({ actorUserId: UUID, actorRole: "ADMIN" }, "me"), "Lê Quản Trị");
    assert.equal(eventActor({ actorUserId: "me", actorRole: "ADMIN" }, "me"), "Bạn");
    assert.equal(eventActor({ actorUserId: "d0d00000-ffff-4fff-8fff-ffffffffffff", actorRole: "ADMIN" }, "me"), "Quản trị viên khác");
    assert.equal(eventActor({ actorUserId: "m1", actorRole: "CUSTOMER" }, "me"), "Hội viên");
    assert.equal(eventActor({ actorUserId: "o1", actorRole: "GYM_OWNER" }, "me"), "Chủ phòng gym");
    assert.equal(eventActor({ actorUserId: "system", actorRole: "SYSTEM" }, "me"), "Hệ thống");
    assert.equal(investigatorText(UUID, "me"), "Người phụ trách: Lê Quản Trị");
    assert.equal(adminDid(UUID, "me", "duyệt"), "Lê Quản Trị duyệt");
    assert.equal(adminDid("me", "me", "ghi"), "bạn ghi");
    for (const text of [eventActor({ actorUserId: UUID, actorRole: "ADMIN" }, "me"), investigatorText("x-unknown", "me"), adminDid("x-unknown", "me")]) assert.doesNotMatch(text, /mã |d0d00000|[0-9a-f]{8}-/);
    clearGymAdminNames();
  });
  it("the reporter is named; without a name it is still not a code", () => {
    assert.equal(reporterText(UUID, "Nguyễn Văn A"), "Nguyễn Văn A");
    assert.doesNotMatch(reporterText(UUID, null), /mã |d0d00000/);
    assert.equal(reporterText(null, null), "Chưa gắn người phản ánh");
  });
});

describe("N15A-04: the replacement badge comes from approvedAt / rejectedAt", () => {
  it("pending, approved, rejected", () => {
    assert.equal(replacementState(null), null);
    assert.equal(replacementState({ approvedAt: null, rejectedAt: null }), "PENDING");
    assert.equal(replacementState({ approvedAt: "2026-11-15T01:00:00Z", rejectedAt: null }), "APPROVED");
    assert.equal(replacementState({ approvedAt: null, rejectedAt: "2026-11-15T01:00:00Z" }), "REJECTED");
  });
});

describe("N15A-05: execution wording", () => {
  it("the confirmation shows the SUPPLEMENT amount and says it is the difference", () => {
    const text = executeAmountText({
      decision: { proposalId: "p", approvalId: "a", outcome: "REFUND_APPEAL_SUPPLEMENT", outcomeLabel: "x" },
      refundQuote: { amount: "1203000", pricePaid: "1550000" },
      supplement: { amount: "347000.00", refundedSoFar: "1203000.00" },
    });
    assert.match(text, /347\.000/);
    assert.match(text, /chênh lệch/);
    assert.match(text, /1\.203\.000/); // only as "đã hoàn trước đó"
    assert.doesNotMatch(text.split("trước đó")[0], /1\.203\.000/);
  });
  it("a normal refund still shows the fixed quote", () => {
    const text = executeAmountText({ decision: { proposalId: "p", approvalId: "a", outcome: "REFUND_GYM_CLOSED", outcomeLabel: "x" }, refundQuote: { amount: "1203000", pricePaid: "1550000" }, supplement: null });
    assert.match(text, /1\.203\.000.*chốt theo ngày khiếu nại/);
  });
  it("rounds are numbered per decision: the supplement is Lần 2 even though its attempt restarts at 1", () => {
    const h = [{ decisionId: "a" }, { decisionId: "a" }, { decisionId: "b" }, { decisionId: "b" }];
    assert.deepEqual([0, 1, 2, 3].map((i) => executionRound(h, i)), [1, 1, 2, 2]);
    assert.equal(executionRound([{}], 0), 1);
  });
  it("every outcome has a 'Hệ quả' text, the supplement one explains the difference and the gym debt", () => {
    for (const o of Object.keys(GYM_OUTCOME_LABEL)) assert.ok(gymOutcomeConsequence(o).length > 20, o);
    assert.match(gymOutcomeConsequence("REFUND_APPEAL_SUPPLEMENT"), /CHÊNH LỆCH/);
    assert.match(gymOutcomeConsequence("REFUND_APPEAL_SUPPLEMENT"), /ghi nợ/);
    assert.match(gymOutcomeConsequence("RESOLVE_UPHELD"), /không có khoản tiền nào thay đổi/i);
    assert.equal(gymOutcomeConsequence("NOPE"), "");
  });
});

import { obligationReasonText } from "../adminReconciliation.utils";
describe("N15A-08: the GYM_DEBT reason is Vietnamese without ids", () => {
  it("rewrites the pre-15/11 English reason and shortens any other uuid", () => {
    const old = `Appeal supplement 347000: gym ${UUID} could fund 34700 of its 312300 share from its available balance; the platform fronted 277600 from REVENUE so the member was paid in full`;
    const text = obligationReasonText(old);
    assert.match(text, /^Hoàn thêm 347\.000 ₫ cho hội viên sau kháng nghị/);
    assert.match(text, /nền tảng đã ứng 277\.600 ₫/);
    assert.doesNotMatch(text, /Appeal|[0-9a-f]{8}-[0-9a-f]{4}/);
    assert.equal(obligationReasonText("Hoàn thêm 1 ₫ …"), "Hoàn thêm 1 ₫ …");
    assert.doesNotMatch(obligationReasonText(`gym ${UUID} nợ`), /[0-9a-f]{8}-[0-9a-f]{4}/);
    assert.equal(obligationReasonText(null), "—");
  });
});

describe("N15A-01: who was asked, from the viewer's side", () => {
  it("member sees Bạn / Phòng gym, the gym sees Phòng gym của bạn / Hội viên", () => {
    assert.equal(askedPartiesText(["MEMBER"], "MEMBER"), "Bạn");
    assert.equal(askedPartiesText(["MEMBER", "GYM"], "MEMBER"), "Bạn và Phòng gym");
    assert.equal(askedPartiesText(["GYM"], "GYM"), "Phòng gym của bạn");
    assert.equal(askedPartiesText(["MEMBER", "GYM"], "GYM"), "Hội viên và Phòng gym của bạn");
    assert.equal(askedPartiesText(undefined, "GYM"), "");
  });
});

describe("N15A-03 (verify): history never shows a bare account id as a note", () => {
  it("hides the investigator id but keeps real text", () => {
    assert.equal(eventNote({ note: "da7bf157-ed4a-51db-a6dc-e88c3f8211c6" }), null);
    assert.equal(eventNote({ note: "Du can cu ket luan." }), "Du can cu ket luan.");
  });
});

describe("verify round: history labels for replacement / deadline events", () => {
  it("no longer reads \"Thao tác khác\"", () => {
    for (const a of ["REPLACEMENT_PROPOSED", "REPLACEMENT_APPROVED", "REPLACEMENT_REJECTED", "DEADLINE_STARTED", "APPEAL_FILED", "APPEAL_REVIEWER_ASSIGNED"]) assert.notEqual(gymEventLabel(a), "Thao tác khác");
  });
});
