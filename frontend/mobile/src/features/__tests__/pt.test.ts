/**
 * Phase 10 — PT workspace helpers. Shapes are the real user-service answers behind
 * `/contracts/pt` and `/sessions/my-upcoming` (checked 24/9 against pt@example.com).
 *
 * Runs with: npx tsx --test src/features/__tests__/pt.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DAY_LABELS,
  STUDENT_FILTERS,
  clientInitials,
  clientName,
  filterStudents,
  goalLabel,
  liveSessionCount,
  mondayOf,
  ptAlerts,
  ptContractStatus,
  ptSessionStatus,
  ptTransactionLabel,
  relativeDayLabel,
  sessionTimeLabel,
  sessionsOf,
  studentCounts,
  studentsFromContracts,
  weekSessionCounts,
} from "../pt/pt";
import { CONTRACT_STATUS } from "../services/contracts";
import { SESSION_STATUS } from "../services/sessions";

describe("naming a client", () => {
  it("prefers the joined profile, falls back to the flat name, never shows an id", () => {
    assert.equal(clientName({ clientProfile: { firstName: "John", lastName: "Doe" } }), "John Doe");
    assert.equal(clientName({ clientProfile: { firstName: "John", lastName: null } }), "John");
    assert.equal(clientName({ clientProfile: null, clientName: "Trần Văn A" }), "Trần Văn A");
    assert.equal(clientName({ clientProfile: { firstName: "", lastName: "" }, clientName: "Bù" }), "Bù");
    assert.equal(clientName(null), "Học viên");
  });

  it("initials come from the profile, then the name, then '?'", () => {
    assert.equal(clientInitials({ clientProfile: { firstName: "John", lastName: "Doe" } }), "JD");
    assert.equal(clientInitials({ clientName: "Trần Văn A" }), "TA");
    assert.equal(clientInitials({ clientName: "Mai" }), "MA");
    assert.equal(clientInitials({}), "?");
  });

  it("goal labels reuse the profile option list — no second translation table", () => {
    assert.equal(goalLabel("MUSCLE_GAIN"), "Tăng cơ");
    assert.equal(goalLabel(null), "Chưa đặt mục tiêu");
    assert.equal(goalLabel("SOMETHING_NEW"), "something new");
  });
});

describe("status from the trainer's chair", () => {
  it("side-dependent wording is flipped, not duplicated", () => {
    assert.equal(ptContractStatus("PENDING_REVIEW").label, "Bạn cần duyệt");
    assert.notEqual(ptContractStatus("PENDING_REVIEW").label, CONTRACT_STATUS.PENDING_REVIEW.label);
    assert.equal(ptSessionStatus("REQUESTED").label, "Bạn cần xác nhận");
    assert.equal(ptSessionStatus("PT_NO_SHOW_REPORTED").label, "Học viên báo bạn vắng");
  });

  it("neutral statuses keep the shared label so the two workspaces cannot drift", () => {
    assert.equal(ptContractStatus("ACTIVE").label, CONTRACT_STATUS.ACTIVE.label);
    assert.equal(ptSessionStatus("COMPLETED").label, SESSION_STATUS.COMPLETED.label);
  });

  it("every real enum value has a Vietnamese label on the PT side too", () => {
    for (const s of ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"]) {
      assert.notEqual(ptContractStatus(s).label, s, `${s} chưa có nhãn PT`);
    }
    for (const s of ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "DISPUTED", "COMPLETED", "CANCELLED", "NO_SHOW", "PT_NO_SHOW_REPORTED"]) {
      assert.notEqual(ptSessionStatus(s).label, s, `${s} chưa có nhãn PT`);
    }
  });

  it("an unknown status degrades to itself rather than crashing", () => {
    assert.equal(ptContractStatus("BRAND_NEW").label, "BRAND_NEW");
    assert.equal(ptSessionStatus("").label, "Không rõ");
  });
});

describe("roster", () => {
  const contracts = [
    { id: "c1", clientUserId: "u1", status: "ACTIVE", packageName: "Gói 12 buổi", totalSessions: 12, usedSessions: 5, clientProfile: { firstName: "John", lastName: "Doe", goal: "MUSCLE_GAIN" } },
    { id: "c2", clientUserId: "u2", status: "PENDING_REVIEW", packageName: "  ", totalSessions: 8, usedSessions: 0, clientName: "Mai Anh" },
    { id: "c3", clientUserId: "u3", status: "COMPLETED", packageName: "Gói 10 buổi", totalSessions: 10, usedSessions: 11, clientProfile: { firstName: "Bảo", lastName: "Trân" } },
    { id: "", clientUserId: "x", status: "ACTIVE" },
  ];

  it("maps the real contract shape; progress is clamped and a blank package gets a name", () => {
    const rows = studentsFromContracts(contracts);
    assert.equal(rows.length, 3, "dòng không có id bị bỏ");
    assert.equal(rows[0].progress, 5 / 12);
    assert.equal(rows[1].packageName, "Gói huấn luyện");
    assert.equal(rows[2].progress, 1, "dạy dư buổi không làm vòng tiến độ tràn");
    assert.equal(studentsFromContracts(null).length, 0);
  });

  it("a contract with no package size does not divide by zero", () => {
    const [r] = studentsFromContracts([{ id: "c", clientUserId: "u", status: "ACTIVE" }]);
    assert.equal(r.progress, 0);
    assert.equal(r.total, 0);
  });

  it("filters by status group and searches name or package", () => {
    const rows = studentsFromContracts(contracts);
    assert.deepEqual(filterStudents(rows, "", "active").map((r) => r.contractId), ["c1"]);
    assert.deepEqual(filterStudents(rows, "", "pending").map((r) => r.contractId), ["c2"]);
    assert.deepEqual(filterStudents(rows, "", "done").map((r) => r.contractId), ["c3"]);
    assert.equal(filterStudents(rows, "", "all").length, 3);
    assert.deepEqual(filterStudents(rows, "mai", "all").map((r) => r.contractId), ["c2"]);
    assert.deepEqual(filterStudents(rows, "12 buổi", "all").map((r) => r.contractId), ["c1"]);
    assert.equal(filterStudents(rows, "không có ai", "all").length, 0);
  });

  it("every contract status falls into exactly one chip, so nobody disappears from the roster", () => {
    const all = ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"];
    for (const s of all) {
      const hits = STUDENT_FILTERS.filter((f) => f.key !== "all" && (f.statuses as readonly string[]).includes(s));
      assert.equal(hits.length, 1, `${s} phải thuộc đúng một bộ lọc`);
    }
  });

  it("counts per chip", () => {
    const c = studentCounts(studentsFromContracts(contracts));
    assert.deepEqual(c, { active: 1, pending: 1, done: 1, all: 3 });
  });
});

describe("dashboard", () => {
  const sessions = sessionsOf([
    { id: "s1", status: "CONFIRMED", scheduledStartAt: "2026-09-21T08:00:00" },
    { id: "s2", status: "REQUESTED", scheduledStartAt: "2026-09-23T10:00:00" },
    { id: "s3", status: "CANCELLED", scheduledStartAt: "2026-09-23T14:00:00" },
    { id: "s4", status: "CONFIRMED", scheduledStartAt: "2026-09-27T09:00:00" },
    { id: "bad", status: "CONFIRMED" },
  ]);

  it("drops rows the UI cannot place on a calendar", () => {
    assert.equal(sessions.length, 4);
    assert.equal(sessionsOf(undefined).length, 0);
  });

  it("week starts on Monday, including when today is Sunday", () => {
    assert.equal(mondayOf(new Date(2026, 8, 23)).getDate(), 21);
    assert.equal(mondayOf(new Date(2026, 8, 27)).getDate(), 21, "chủ nhật vẫn thuộc tuần bắt đầu thứ 2");
    assert.equal(mondayOf(new Date(2026, 8, 21)).getHours(), 0);
  });

  it("counts land on the right weekday", () => {
    const counts = weekSessionCounts(sessions, mondayOf(new Date(2026, 8, 23)));
    assert.equal(counts.length, DAY_LABELS.length);
    assert.equal(counts[0], 1, "T2");
    assert.equal(counts[2], 2, "T4 — cả buổi đã huỷ vẫn nằm trên lịch");
    assert.equal(counts[6], 1, "CN");
  });

  it("the KPI counts only sessions that still oblige the trainer", () => {
    assert.equal(liveSessionCount(sessions), 3);
  });
});

describe("alerts", () => {
  const now = new Date(2026, 8, 24, 12);
  const sessions = sessionsOf([
    { id: "s1", status: "REQUESTED", scheduledStartAt: "2026-09-25T08:00:00" },
    { id: "s2", status: "REQUESTED", scheduledStartAt: "2026-09-26T08:00:00" },
    { id: "s3", status: "CONFIRMED", scheduledStartAt: "2026-09-26T09:00:00" },
  ]);
  const contracts = [
    { id: "c1", clientUserId: "u1", status: "PENDING_REVIEW", clientName: "Mai Anh" },
    { id: "c2", clientUserId: "u2", status: "ACTIVE", endDate: "2026-09-28T00:00:00", clientProfile: { firstName: "John", lastName: "Doe" } },
    { id: "c3", clientUserId: "u3", status: "ACTIVE", endDate: "2026-12-01T00:00:00", clientName: "Xa" },
    { id: "c4", clientUserId: "u4", status: "ACTIVE", endDate: "2026-09-01T00:00:00", clientName: "Đã quá hạn" },
  ];

  it("urgent first: sessions to confirm, then contracts to accept, then expiries", () => {
    const a = ptAlerts(contracts, sessions, now);
    assert.deepEqual(a.map((x) => x.key), ["sessions-to-confirm", "contracts-pending", "expiring-c2"]);
    assert.match(a[0].text, /2 buổi tập/);
    assert.match(a[2].text, /John Doe/);
  });

  it("a contract already past its end date is history, not a warning", () => {
    const a = ptAlerts(contracts, sessions, now);
    assert.equal(a.some((x) => x.key === "expiring-c4"), false);
  });

  it("nothing pending means no alerts at all", () => {
    assert.deepEqual(ptAlerts([], [], now), []);
    assert.deepEqual(ptAlerts(null, [], now), []);
  });
});

describe("PT ledger labels", () => {
  it("names every real payment-service description a PT wallet can hold", () => {
    const real: [string, string, string][] = [
      ["Contract e200e8a0 session 5d8ca6dd — session earned", "CREDIT", "Thu nhập buổi tập"],
      ["Contract e200e8a0 session 264a82a6 — release to available", "DEBIT", "Chuyển sang số dư khả dụng"],
      ["Contract c7b24bd3 termination — pending released on termination", "DEBIT", "Giải phóng tiền tạm giữ"],
      ["Contract 106a4922 termination — final settlement", "DEBIT", "Tất toán hợp đồng"],
      ["PT_CONTRACT f79b46e4 — PT share", "CREDIT", "Phần chia của huấn luyện viên"],
      ["Personalized service order 44f55854 admin refund — refund funded from pending", "DEBIT", "Hoàn tiền cho khách"],
      ["Payment received", "CREDIT", "Học viên thanh toán"],
    ];
    for (const [desc, type, want] of real) assert.equal(ptTransactionLabel(desc, type), want, desc);
  });

  it("never leaks a uuid or an enum, and keeps plain Vietnamese text as written", () => {
    assert.equal(ptTransactionLabel("Contract 1f0e2a3b-1111-2222-3333-444455556666 SETTLED_X", "DEBIT"), "Tiền ra khỏi ví");
    assert.equal(ptTransactionLabel(null, "CREDIT"), "Tiền vào ví");
    assert.equal(ptTransactionLabel("Thưởng huấn luyện viên xuất sắc", "CREDIT"), "Thưởng huấn luyện viên xuất sắc");
  });
});

describe("time labels", () => {
  it("24h time, Vietnamese weekday, relative day for the near ones", () => {
    assert.equal(sessionTimeLabel("2026-09-24T08:05:00"), "08:05");
    assert.equal(sessionTimeLabel("rác"), "");
    const now = new Date(2026, 8, 24, 12);
    assert.equal(relativeDayLabel("2026-09-24T18:00:00", now), "Hôm nay");
    assert.equal(relativeDayLabel("2026-09-25T06:00:00", now), "Ngày mai");
    assert.equal(relativeDayLabel("2026-09-23T06:00:00", now), "Hôm qua");
    assert.equal(relativeDayLabel("2026-09-28T06:00:00", now), "T2, 28/09");
  });
});
