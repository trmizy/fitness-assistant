/**
 * Phase 10 — PT workspace helpers. Shapes are the real user-service answers behind
 * `/contracts/pt` and `/sessions/my-upcoming` (checked 24/9 against pt@example.com).
 *
 * Runs with: npx tsx --test src/features/__tests__/pt.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_TABS,
  DAY_LABELS,
  EMPTY_PACKAGE,
  STUDENT_FILTERS,
  contractTabCounts,
  contractsInTab,
  clientInitials,
  canProposeReschedule,
  canRespondToCollab,
  clientName,
  collabStatus,
  filterStudents,
  goalLabel,
  liveSessionCount,
  mondayOf,
  noShowReports,
  packageFormError,
  packageFormFrom,
  packagePayload,
  perSessionPrice,
  pendingPlans,
  planMeta,
  planSchedule,
  planTitle,
  ptAlerts,
  ptContractStatus,
  ptIncomingReschedule,
  ptOutgoingReschedule,
  ptPendingReschedule,
  ptSessionStatus,
  ptTransactionLabel,
  ratePercent,
  ratesError,
  ratesPayload,
  sellerNeedsAction,
  sellerOrderAction,
  sellerOrderLabel,
  relativeDayLabel,
  sessionTimeLabel,
  sessionsOf,
  studentCounts,
  studentsFromContracts,
  weekSessionCounts,
} from "../pt/pt";
import { CONTRACT_STATUS } from "../services/contracts";
import { SESSION_STATUS } from "../services/sessions";
import { ORDER_STATUS_LABEL } from "../plans/personalizedOrder";

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

describe("marketplace orders, seller side (PT-09)", () => {
  it("side-dependent wording is flipped; the rest falls through to the shared label", () => {
    assert.equal(sellerOrderLabel("IN_PROGRESS", ORDER_STATUS_LABEL.IN_PROGRESS), "Bạn đang soạn giáo án");
    assert.notEqual(sellerOrderLabel("IN_PROGRESS", ORDER_STATUS_LABEL.IN_PROGRESS), ORDER_STATUS_LABEL.IN_PROGRESS);
    assert.equal(sellerOrderLabel("COMPLETED", ORDER_STATUS_LABEL.COMPLETED), ORDER_STATUS_LABEL.COMPLETED);
    assert.equal(sellerOrderLabel("BRAND_NEW", "dự phòng"), "dự phòng");
  });

  it("each status offers at most the one action the server accepts", () => {
    assert.equal(sellerOrderAction("INTAKE_SUBMITTED"), "startReview");
    assert.equal(sellerOrderAction("PT_REVIEWING"), "deliver");
    assert.equal(sellerOrderAction("REVISION_REQUESTED"), "startRevision");
    assert.equal(sellerOrderAction("REVISION_IN_PROGRESS"), "deliver");
    assert.equal(sellerOrderAction("DRAFT_DELIVERED"), null, "chờ khách thì PT không có nút nào");
    assert.equal(sellerOrderAction("ACTIVE"), null);
    assert.equal(sellerOrderAction("CANCELLED"), null);
  });

  it("the queue leads with orders that owe the trainer work", () => {
    const rows = [
      { id: "a", status: "DRAFT_DELIVERED" },
      { id: "b", status: "INTAKE_SUBMITTED" },
      { id: "c", status: "REVISION_REQUESTED" },
      { status: "PT_REVIEWING" },
    ];
    assert.deepEqual(sellerNeedsAction(rows).map((o) => o.id), ["b", "c"]);
    assert.deepEqual(sellerNeedsAction(null), []);
  });
});

describe("service packages (PT-10)", () => {
  it("round-trips a package and keeps the per-session price a client can compare", () => {
    const f = packageFormFrom({ id: "p", name: "Gói 10", sessionCount: 10, price: "3000000.00", sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null });
    assert.equal(f.price, "3000000");
    assert.equal(f.validityDays, "");
    assert.equal(perSessionPrice({ price: "3000000.00", sessionCount: 10 }), 300000);
    assert.equal(perSessionPrice({ price: "100", sessionCount: 0 }), 0, "không chia cho 0");
  });

  it("catches the mistakes the server would reject", () => {
    const ok = { ...EMPTY_PACKAGE, name: "Gói", price: "1000000" };
    assert.equal(packageFormError(ok), null);
    assert.ok(packageFormError({ ...ok, name: "  " }));
    assert.ok(packageFormError({ ...ok, sessionCount: "0" }));
    assert.ok(packageFormError({ ...ok, sessionCount: "2.5" }));
    assert.ok(packageFormError({ ...ok, price: "0" }));
    assert.ok(packageFormError({ ...ok, sessionDurationMinutes: "0" }));
    assert.ok(packageFormError({ ...ok, validityDays: "-3" }));
    assert.equal(packageFormError({ ...ok, validityDays: "" }), null, "để trống = không hết hạn");
  });

  it("a cleared expiry is sent as null, not omitted, so it can actually be cleared", () => {
    assert.equal(packagePayload({ ...EMPTY_PACKAGE, name: "G", price: "1", validityDays: "" }).validityDays, null);
    assert.equal(packagePayload({ ...EMPTY_PACKAGE, name: "G", price: "1", validityDays: "90" }).validityDays, 90);
  });
});

describe("gym collaboration (PT-13)", () => {
  it("the three shares must sum to exactly 100% and the platform keeps its floor", () => {
    assert.equal(ratesError("60", "30", "10"), null);
    assert.match(ratesError("60", "30", "5")!, /nền tảng/);
    assert.match(ratesError("60", "20", "10")!, /90%/);
    assert.match(ratesError("60", "-20", "60")!, /âm/);
    assert.ok(ratesError("", "30", "10"));
  });

  it("percent in the form, fraction on the wire", () => {
    assert.deepEqual(ratesPayload("60", "30", "10"), { ptRate: "0.6000", gymRate: "0.3000", platformRate: "0.1000" });
    assert.equal(ratePercent("0.6000"), "60%");
    assert.equal(ratePercent("0.125"), "12.5%");
    assert.equal(ratePercent(null), "—");
  });

  it("whose turn it is comes from proposedBy, not from the status alone", () => {
    assert.equal(collabStatus({ status: "PENDING", proposedBy: "GYM" }).label, "Bạn cần trả lời");
    assert.equal(collabStatus({ status: "PENDING", proposedBy: "PT" }).label, "Chờ phòng gym trả lời");
    assert.equal(collabStatus({ status: "COUNTERED", proposedBy: "GYM" }).label, "Bạn cần trả lời");
    assert.equal(collabStatus({ status: "ACCEPTED", proposedBy: "PT" }).label, "Đang hợp tác");
    assert.equal(canRespondToCollab({ status: "PENDING", proposedBy: "GYM" }), true);
    assert.equal(canRespondToCollab({ status: "PENDING", proposedBy: "PT" }), false);
    assert.equal(canRespondToCollab({ status: "ACCEPTED", proposedBy: "GYM" }), false);
  });

  it("every real CollaborationStatus value has a Vietnamese label", () => {
    for (const s of ["PENDING", "COUNTERED", "ACCEPTED", "REJECTED", "EXPIRED", "TERMINATED"]) {
      assert.notEqual(collabStatus({ status: s }).label, s, `${s} chưa có nhãn`);
    }
    assert.equal(collabStatus(null).label, "Không rõ");
  });
});

describe("AI plan review (PT-12)", () => {
  const plan = {
    id: "p1",
    clientName: "Mai Anh",
    name: "PPL 6 tuần",
    goal: "MUSCLE_GAIN",
    duration: 6,
    daysPerWeek: 3,
    plan: {
      weeklySchedule: [
        { day: "Ngày 1 · Push", goal: "Ngực/vai", exercises: [{ name: "Bench", sets: 4, reps: 8, weight: 60, restSeconds: 90 }] },
        { day: "Ngày 2", exercises: [{ name: "Deadlift", sets: 4, reps: 5 }, { name: "Plank" }] },
        { goal: "Chân" },
      ],
    },
  };

  it("title falls back goal → neutral, and never shows an id", () => {
    assert.equal(planTitle(plan), "PPL 6 tuần");
    assert.equal(planTitle({ id: "x", goal: "Giảm mỡ" }), "Giảm mỡ");
    assert.equal(planTitle({ id: "x" }), "Giáo án AI");
    assert.equal(planTitle(null), "Giáo án AI");
  });

  it("meta only prints the parts that exist", () => {
    assert.equal(planMeta(plan), "6 tuần · 3 buổi/tuần");
    assert.equal(planMeta({ id: "x", duration: 4 }), "4 tuần");
    assert.equal(planMeta({ id: "x" }), "");
  });

  it("AI JSON is flattened defensively — missing parts are omitted, not printed as undefined", () => {
    const days = planSchedule(plan);
    assert.equal(days.length, 3);
    assert.equal(days[0].exercises[0], "Bench 4×8 @60kg (nghỉ 90s)");
    assert.equal(days[1].exercises[0], "Deadlift 4×5");
    assert.equal(days[1].exercises[1], "Plank", "bài không có set/rep vẫn hiện tên");
    assert.equal(days[1].goal, "");
    assert.equal(days[2].day, "Ngày 3", "thiếu tên ngày thì đánh số theo thứ tự");
    assert.deepEqual(planSchedule(null), []);
    assert.deepEqual(planSchedule({ id: "x", plan: { weeklySchedule: "rác" as never } }), []);
  });

  it("only rows with an id are reviewable", () => {
    assert.equal(pendingPlans([plan, { clientName: "không id" }]).length, 1);
    assert.deepEqual(pendingPlans(undefined), []);
  });
});

describe("contract tabs (PT-07)", () => {
  const contracts = [
    { id: "r1", clientUserId: "u1", status: "PENDING_REVIEW", createdAt: "2026-09-20" },
    { id: "r2", clientUserId: "u2", status: "PENDING_REVIEW", createdAt: "2026-09-22" },
    { id: "w1", clientUserId: "u3", status: "PENDING_PAYMENT", createdAt: "2026-09-10" },
    { id: "w2", clientUserId: "u4", status: "PENDING_SIGNATURE", createdAt: "2026-09-11" },
    { id: "a1", clientUserId: "u5", status: "ACTIVE", createdAt: "2026-09-01" },
    { id: "e1", clientUserId: "u6", status: "REJECTED", createdAt: "2026-08-01" },
  ];

  it("groups by the trainer's working order, newest first", () => {
    assert.deepEqual(contractsInTab(contracts, "requests").map((c) => c.id), ["r2", "r1"]);
    assert.deepEqual(contractsInTab(contracts, "active").map((c) => c.id), ["a1"]);
    assert.deepEqual(contractsInTab(contracts, "ended").map((c) => c.id), ["e1"]);
  });

  it("PENDING_SIGNATURE is grouped, not hidden, in case e-sign is switched back on", () => {
    assert.deepEqual(contractsInTab(contracts, "waiting").map((c) => c.id).sort(), ["w1", "w2"]);
  });

  it("every contract status lands in exactly one tab", () => {
    const all = ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"];
    for (const s of all) {
      const hits = CONTRACT_TABS.filter((t) => (t.statuses as readonly string[]).includes(s));
      assert.equal(hits.length, 1, `${s} phải thuộc đúng một tab`);
    }
  });

  it("counts per tab; bad input is empty, not a crash", () => {
    assert.deepEqual(contractTabCounts(contracts), { requests: 2, waiting: 2, active: 1, ended: 1 });
    assert.deepEqual(contractsInTab(null, "active"), []);
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

describe("reschedule proposals & no-show reports, trainer side", () => {
  const base = { id: "s1", status: "CONFIRMED", scheduledStartAt: "2026-10-01T08:00:00" };
  const now = new Date("2026-09-25T08:00:00");

  it("incoming/outgoing are the mirror of the client-side pair", () => {
    const fromClient = { ...base, rescheduleRequests: [{ id: "r", requestedBy: "CLIENT", status: "PENDING" }] };
    const fromPt = { ...base, rescheduleRequests: [{ id: "r", requestedBy: "PT", status: "PENDING" }] };
    assert.equal(ptIncomingReschedule(fromClient)?.id, "r");
    assert.equal(ptOutgoingReschedule(fromClient), null);
    assert.equal(ptOutgoingReschedule(fromPt)?.id, "r");
    assert.equal(ptIncomingReschedule(fromPt), null);
  });

  it("a closed proposal is not pending", () => {
    const answered = { ...base, rescheduleRequests: [{ id: "r", requestedBy: "CLIENT", status: "ACCEPTED" }] };
    assert.equal(ptPendingReschedule(answered), null);
    assert.equal(ptPendingReschedule({ ...base }), null);
  });

  it("proposing is offered only when the server would accept it", () => {
    assert.equal(canProposeReschedule(base, now), true);
    assert.equal(
      canProposeReschedule({ ...base, rescheduleRequests: [{ id: "r", requestedBy: "CLIENT", status: "PENDING" }] }, now),
      false,
      "server tr\u1ea3 409 khi \u0111\u00e3 c\u00f3 m\u1ed9t \u0111\u1ec1 ngh\u1ecb m\u1edf",
    );
    assert.equal(
      canProposeReschedule({ ...base, scheduledStartAt: "2026-09-25T14:00:00" }, now),
      false,
      "trong v\u00f2ng 12 gi\u1edd th\u00ec server t\u1eeb ch\u1ed1i",
    );
    assert.equal(canProposeReschedule({ ...base, status: "COMPLETED" }, now), false);
    assert.equal(canProposeReschedule({ ...base, scheduledStartAt: "r\u00e1c" }, now), false);
  });

  it("no-show reports tolerate every envelope shape and drop rows without an id", () => {
    assert.equal(noShowReports([{ id: "a" }, { nope: 1 }]).length, 1);
    assert.equal(noShowReports({ sessions: [{ id: "a" }] }).length, 1);
    assert.equal(noShowReports({ data: [{ id: "a" }] }).length, 1);
    assert.equal(noShowReports(null).length, 0);
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
