/**
 * CL-06/07/08 logic. The session row below is a real one from GET /sessions/upcoming, and the slot
 * list is the real answer shape: a bare array of "HH:MM".
 *
 * Runs with: npx tsx --test src/features/__tests__/sessions.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  acceptedMoves,
  bookableSlots,
  bookingBlockedReason,
  buildBookingPayload,
  buildReschedulePayload,
  cancelCostsSession,
  cancelWarning,
  canReportNoShow,
  clientActions,
  confirmDeadlineText,
  consumesQuota,
  groupOf,
  hoursUntil,
  normalizeSession,
  normalizeSessions,
  normalizeSlots,
  normalizeRescheduleHistory,
  withRescheduleHistory,
  incomingReschedule,
  mergeSessionSources,
  outgoingReschedule,
  pendingReschedule,
  proposalOutcomeText,
  proposalSummary,
  rescheduleBlockedReason,
  reviewBlockedReason,
  sessionDurationMinutes,
  sessionStatus,
  type SessionRow,
} from "../services/sessions";

const RAW_SESSION = {
  id: "20c7d8c8-8695-4653-944f-0c2fd438d87e",
  contractId: "6db9017a-5b41-40a0-a60d-5d0ad2de20ce",
  clientUserId: "68aca044-a454-4434-9206-c8a43702f664",
  ptUserId: "e81ef52a-ad90-4a09-8903-2286c1cba5f6",
  status: "CONFIRMED",
  sessionMode: "OFFLINE",
  scheduledStartAt: "2026-09-17T15:00:00.000Z",
  scheduledEndAt: "2026-09-17T16:00:00.000Z",
  location: null,
  notes: null,
  sessionDeducted: false,
  ptAtFault: false,
  clientConfirmDeadline: null,
  autoConfirmed: false,
};

const at = (status: string, extra: Record<string, any> = {}): SessionRow =>
  normalizeSession({ ...RAW_SESSION, status, ...extra });

describe("normalizeSession", () => {
  it("reads a real row", () => {
    const session = normalizeSession(RAW_SESSION);
    assert.equal(session.id, RAW_SESSION.id);
    assert.equal(session.status, "CONFIRMED");
    assert.equal(session.startAt, RAW_SESSION.scheduledStartAt);
    assert.equal(session.deducted, false);
  });

  it("sorts by time and drops rows with no id", () => {
    const rows = normalizeSessions([
      { ...RAW_SESSION, id: "later", scheduledStartAt: "2026-09-20T10:00:00.000Z" },
      { ...RAW_SESSION, id: "sooner", scheduledStartAt: "2026-09-18T10:00:00.000Z" },
      { status: "CONFIRMED" },
    ]);
    assert.deepEqual(rows.map((s) => s.id), ["sooner", "later"]);
  });
});

describe("statuses and quota", () => {
  it("names all eight the backend can produce", () => {
    for (const status of [
      "REQUESTED",
      "CONFIRMED",
      "PENDING_CLIENT_CONFIRMATION",
      "DISPUTED",
      "PT_NO_SHOW_REPORTED",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ]) {
      assert.notEqual(sessionStatus(status).label, status, `${status} chưa có nhãn`);
    }
  });

  it("charges a session ONLY when it is COMPLETED", () => {
    assert.equal(consumesQuota(at("COMPLETED")), true);
    for (const status of [
      "REQUESTED",
      "CONFIRMED",
      "PENDING_CLIENT_CONFIRMATION",
      "DISPUTED",
      "PT_NO_SHOW_REPORTED",
      "CANCELLED",
      "NO_SHOW",
    ]) {
      assert.equal(consumesQuota(at(status)), false, `${status} không được trừ quota`);
    }
  });
});

describe("grouping", () => {
  const now = new Date("2026-09-17T10:00:00.000Z");

  it("puts anything with a deadline attached in the action list", () => {
    assert.equal(groupOf(at("PENDING_CLIENT_CONFIRMATION"), now), "action");
    assert.equal(groupOf(at("DISPUTED"), now), "action");
    assert.equal(groupOf(at("PT_NO_SHOW_REPORTED"), now), "action");
  });

  it("keeps a future confirmed session upcoming and a finished one in the past", () => {
    assert.equal(groupOf(at("CONFIRMED"), now), "upcoming");
    // Same session, seen the next morning: it is over, whatever the PT has filed.
    assert.equal(groupOf(at("CONFIRMED"), new Date("2026-09-18T08:00:00.000Z")), "past");
    assert.equal(groupOf(at("COMPLETED"), now), "past");
    assert.equal(groupOf(at("CANCELLED"), now), "past");
  });
});

describe("the 24-hour cancellation window", () => {
  it("is free outside the window and costs a session inside it", () => {
    const early = new Date("2026-09-16T10:00:00.000Z"); // 29 hours before
    const late = new Date("2026-09-17T09:00:00.000Z"); // 6 hours before
    assert.equal(cancelCostsSession(at("CONFIRMED"), early), false);
    assert.equal(cancelCostsSession(at("CONFIRMED"), late), true);
    assert.match(cancelWarning(at("CONFIRMED"), late), /TRỪ 1 buổi/);
    assert.match(cancelWarning(at("CONFIRMED"), early), /không bị trừ buổi/);
  });

  it("measures the hours from the session's own start time", () => {
    const hours = hoursUntil(at("CONFIRMED"), new Date("2026-09-17T13:00:00.000Z"));
    assert.equal(hours, 2);
    assert.equal(hoursUntil(normalizeSession({ ...RAW_SESSION, scheduledStartAt: null })), null);
  });
});

describe("reporting a PT no-show", () => {
  it("only after the session has started plus the grace period", () => {
    assert.equal(canReportNoShow(at("CONFIRMED"), new Date("2026-09-17T14:59:00.000Z")), false);
    // Started, but inside the 15-minute grace — the server refuses this too.
    assert.equal(canReportNoShow(at("CONFIRMED"), new Date("2026-09-17T15:10:00.000Z")), false);
    assert.equal(canReportNoShow(at("CONFIRMED"), new Date("2026-09-17T15:20:00.000Z")), true);
  });

  it("never on a session that is not confirmed", () => {
    assert.equal(canReportNoShow(at("REQUESTED"), new Date("2026-09-17T16:00:00.000Z")), false);
    assert.equal(canReportNoShow(at("COMPLETED"), new Date("2026-09-17T16:00:00.000Z")), false);
  });
});

describe("clientActions", () => {
  it("offers exactly what the state allows", () => {
    // 29 giờ trước buổi: đủ xa để đổi lịch được.
    const before = new Date("2026-09-16T10:00:00.000Z");
    assert.deepEqual(clientActions(at("CONFIRMED"), before), ["cancel", "reschedule"]);
    assert.deepEqual(clientActions(at("PENDING_CLIENT_CONFIRMATION"), before), ["confirm", "dispute"]);
    // A REQUESTED session cannot be moved — the PT simply confirms a different time.
    assert.deepEqual(clientActions(at("REQUESTED"), before), ["cancel"]);
    assert.deepEqual(clientActions(at("COMPLETED"), before), ["review"]);
  });

  it("adds the no-show report only once it is actually reportable, and drops reschedule by then", () => {
    const later = new Date("2026-09-17T15:30:00.000Z");
    assert.deepEqual(clientActions(at("CONFIRMED"), later), ["cancel", "report-no-show"]);
  });

  it("hides đổi lịch inside the 12-hour window instead of offering a guaranteed 400", () => {
    const sixHoursBefore = new Date("2026-09-17T09:00:00.000Z");
    assert.deepEqual(clientActions(at("CONFIRMED"), sixHoursBefore), ["cancel"]);
  });

  it("offers nothing while someone else owes a response, or when it is over", () => {
    assert.deepEqual(clientActions(at("DISPUTED")), []);
    assert.deepEqual(clientActions(at("PT_NO_SHOW_REPORTED")), []);
    assert.deepEqual(clientActions(at("CANCELLED")), []);
    assert.deepEqual(clientActions(at("NO_SHOW")), []);
  });
});

describe("the auto-confirm deadline", () => {
  it("counts down from the server's own deadline", () => {
    const session = at("PENDING_CLIENT_CONFIRMATION", {
      clientConfirmDeadline: "2026-09-20T10:00:00.000Z",
    });
    assert.match(confirmDeadlineText(session, new Date("2026-09-20T04:00:00.000Z"))!, /6 giờ/);
    assert.match(confirmDeadlineText(session, new Date("2026-09-18T10:00:00.000Z"))!, /2 ngày/);
    assert.match(confirmDeadlineText(session, new Date("2026-09-21T10:00:00.000Z"))!, /Sắp tự động/);
  });

  it("falls back to the rule when the server has not stamped a deadline", () => {
    assert.match(confirmDeadlineText(at("PENDING_CLIENT_CONFIRMATION"))!, /3 ngày/);
  });

  it("says nothing on a session that is not waiting for the client", () => {
    assert.equal(confirmDeadlineText(at("CONFIRMED")), null);
  });
});

describe("slots and booking", () => {
  it("reads the bare array and ignores anything that is not a time", () => {
    assert.deepEqual(normalizeSlots(["08:00", "09:00", "bad", 7]), ["08:00", "09:00"]);
  });

  it("hides slots already past — but only for today", () => {
    const now = new Date(2026, 8, 17, 10, 30);
    assert.deepEqual(bookableSlots(["08:00", "10:00", "11:00"], "2026-09-17", now), ["11:00"]);
    assert.deepEqual(bookableSlots(["08:00", "10:00"], "2026-09-18", now), ["08:00", "10:00"]);
  });

  it("sends a date and a time, and omits what was left blank", () => {
    assert.deepEqual(buildBookingPayload({ date: "2026-09-19", time: "08:00" }), {
      scheduledDate: "2026-09-19",
      scheduledTime: "08:00",
    });
    assert.deepEqual(
      buildBookingPayload({
        date: "2026-09-19",
        time: "08:00",
        sessionMode: "OFFLINE",
        location: "  Gym A  ",
        notes: "   ",
      }),
      {
        scheduledDate: "2026-09-19",
        scheduledTime: "08:00",
        sessionMode: "OFFLINE",
        location: "Gym A",
      },
    );
  });

  it("refuses to book what the server would refuse", () => {
    const ok = { contractStatus: "ACTIVE", sessionsLeft: 3, date: "2026-09-19", time: "08:00" };
    assert.equal(bookingBlockedReason(ok), null);
    assert.match(bookingBlockedReason({ ...ok, contractStatus: "PENDING_PAYMENT" })!, /đang hiệu lực/);
    assert.match(bookingBlockedReason({ ...ok, sessionsLeft: 0 })!, /hết số buổi/);
    assert.match(bookingBlockedReason({ ...ok, date: null })!, /Chọn ngày/);
    assert.match(bookingBlockedReason({ ...ok, time: null })!, /Chọn khung giờ/);
  });
});

describe("rescheduling and reviewing", () => {
  it("keeps the session's own length, and falls back to an hour only when it cannot tell", () => {
    assert.equal(sessionDurationMinutes(at("CONFIRMED")), 60);
    assert.equal(
      sessionDurationMinutes(
        normalizeSession({
          ...RAW_SESSION,
          scheduledStartAt: "2026-09-17T15:00:00.000Z",
          scheduledEndAt: "2026-09-17T16:30:00.000Z",
        }),
      ),
      90,
    );
    assert.equal(sessionDurationMinutes(normalizeSession({ ...RAW_SESSION, scheduledEndAt: null })), 60);
  });

  it("turns a date and a local time into the two instants the endpoint wants", () => {
    const payload = buildReschedulePayload(at("CONFIRMED"), "2026-09-19", "17:00")!;
    const start = new Date(payload.proposedStartAt);
    // Five in the afternoon where the phone is — whatever that is in UTC.
    assert.equal(start.getHours(), 17);
    assert.equal(start.getMinutes(), 0);
    assert.equal(
      Date.parse(payload.proposedEndAt) - Date.parse(payload.proposedStartAt),
      60 * 60_000,
    );
  });

  it("refuses nonsense rather than sending an Invalid Date", () => {
    assert.equal(buildReschedulePayload(at("CONFIRMED"), "không-phải-ngày", "17:00"), null);
    assert.equal(buildReschedulePayload(at("CONFIRMED"), "2026-09-19", "xx:yy"), null);
  });

  it("wants a star count between one and five", () => {
    assert.equal(reviewBlockedReason(5), null);
    assert.equal(reviewBlockedReason(1), null);
    assert.notEqual(reviewBlockedReason(0), null);
    assert.notEqual(reviewBlockedReason(6), null);
    assert.notEqual(reviewBlockedReason(4.5), null);
  });
});

describe("the reschedule rules", () => {
  it("mirrors all four server-side conditions", () => {
    // Đúng 400 mà máy chủ trả khi thử trong vòng 12 giờ (kiểm thật ngày 17/9).
    assert.match(
      rescheduleBlockedReason(at("CONFIRMED"), new Date("2026-09-17T06:00:00.000Z"))!,
      /12 giờ/,
    );
    assert.match(rescheduleBlockedReason(at("REQUESTED"))!, /đã được huấn luyện viên xác nhận/);
    assert.match(
      rescheduleBlockedReason(at("CONFIRMED"), new Date("2026-09-17T16:00:00.000Z"))!,
      /đã bắt đầu/,
    );
    assert.equal(rescheduleBlockedReason(at("CONFIRMED"), new Date("2026-09-16T10:00:00.000Z")), null);
  });
});

describe("reschedule proposals, both directions", () => {
  // The shape /sessions/upcoming attaches to a row, taken from a real request created on 17/9.
  const request = (overrides: Record<string, any> = {}) => ({
    id: "8312d46e-c12c-47e9-94e6-6eb28c3a9264",
    sessionId: RAW_SESSION.id,
    requestedBy: "PT",
    originalStartAt: "2026-09-18T09:00:00.000Z",
    originalEndAt: "2026-09-18T10:00:00.000Z",
    proposedStartAt: "2026-09-20T02:00:00.000Z",
    proposedEndAt: "2026-09-20T03:00:00.000Z",
    reason: "PT ban dot xuat",
    status: "PENDING",
    responseNote: null,
    ...overrides,
  });

  const withRequests = (...requests: any[]) =>
    normalizeSession({ ...RAW_SESSION, rescheduleRequests: requests });

  it("tells a proposal from the trainer apart from one the client sent", () => {
    const fromPt = withRequests(request());
    const fromClient = withRequests(request({ requestedBy: "CLIENT" }));
    assert.equal(incomingReschedule(fromPt)?.id, request().id);
    assert.equal(outgoingReschedule(fromPt), null);
    assert.equal(outgoingReschedule(fromClient)?.id, request().id);
    assert.equal(incomingReschedule(fromClient), null);
  });

  it("ignores proposals that are already settled", () => {
    const answered = withRequests(request({ status: "ACCEPTED" }), request({ id: "r2", status: "REJECTED" }));
    assert.equal(pendingReschedule(answered), null);
    assert.equal(incomingReschedule(answered), null);
  });

  it("moves a session the trainer is waiting on into the action list", () => {
    const now = new Date("2026-09-16T10:00:00.000Z");
    assert.equal(groupOf(withRequests(request()), now), "action");
    // The client's own proposal is not something they can act on — it stays where it was.
    assert.equal(groupOf(withRequests(request({ requestedBy: "CLIENT" })), now), "upcoming");
  });

  it("offers answering first, and never a second proposal while one is open", () => {
    const now = new Date("2026-09-16T10:00:00.000Z");
    const fromPt = withRequests(request());
    assert.deepEqual(clientActions(fromPt, now), ["answer-reschedule", "cancel"]);
    assert.match(rescheduleBlockedReason(fromPt, now)!, /trả lời đề nghị đó trước/);

    const fromClient = withRequests(request({ requestedBy: "CLIENT" }));
    assert.deepEqual(clientActions(fromClient, now), ["cancel"]);
    assert.match(rescheduleBlockedReason(fromClient, now)!, /đang chờ huấn luyện viên/);
  });

  it("says who proposed what, and what each answer does", () => {
    const summary = proposalSummary(normalizeSession({ ...RAW_SESSION, rescheduleRequests: [request()] }).reschedules[0]);
    assert.match(summary, /Huấn luyện viên đề nghị dời sang/);
    // Rejecting must never read as cancelling the session.
    assert.match(proposalOutcomeText("REJECT"), /KHÔNG huỷ buổi tập/);
    assert.match(proposalOutcomeText("ACCEPT"), /giờ mới/);
  });
});

describe("mergeSessionSources", () => {
  it("keeps the richer row when two endpoints answer with the same session", () => {
    // /sessions/upcoming knows about the open proposal; /sessions/contract/:id does not.
    const rich = normalizeSessions([
      {
        ...RAW_SESSION,
        rescheduleRequests: [
          { id: "r1", requestedBy: "PT", status: "PENDING", proposedStartAt: "2026-09-20T02:00:00.000Z" },
        ],
      },
    ]);
    const poor = normalizeSessions([{ ...RAW_SESSION }]);

    const merged = mergeSessionSources(rich, poor);
    assert.equal(merged.length, 1);
    // The bug this guards: the second source overwrote the first and the proposal vanished.
    assert.equal(merged[0].reschedules.length, 1);
  });

  it("still brings in sessions only the later source has", () => {
    const upcoming = normalizeSessions([{ ...RAW_SESSION, id: "a" }]);
    const history = normalizeSessions([
      { ...RAW_SESSION, id: "a" },
      { ...RAW_SESSION, id: "b", status: "COMPLETED" },
    ]);
    assert.deepEqual(mergeSessionSources(upcoming, history).map((s) => s.id), ["a", "b"]);
  });
});

describe("giới hạn hai lần dời lịch", () => {
  const moved = (times: number) =>
    normalizeSession({
      ...RAW_SESSION,
      rescheduleRequests: Array.from({ length: times }, (_, index) => ({
        id: `r${index}`,
        requestedBy: index % 2 === 0 ? "PT" : "CLIENT",
        status: "ACCEPTED",
      })),
    });

  it("đếm những lần ĐÃ ĐỔI, không đếm đề nghị bị từ chối hay thu hồi", () => {
    assert.equal(acceptedMoves(moved(2)), 2);
    const noisy = normalizeSession({
      ...RAW_SESSION,
      rescheduleRequests: [
        { id: "a", requestedBy: "PT", status: "REJECTED" },
        { id: "b", requestedBy: "CLIENT", status: "CANCELLED" },
        { id: "c", requestedBy: "PT", status: "ACCEPTED" },
      ],
    });
    assert.equal(acceptedMoves(noisy), 1);
  });

  it("chặn lần dời thứ ba đúng như 409 của máy chủ", () => {
    const far = new Date("2026-09-16T10:00:00.000Z");
    assert.equal(rescheduleBlockedReason(moved(1), far), null);
    assert.match(rescheduleBlockedReason(moved(2), far)!, /đã dời 2 lần/);
    assert.deepEqual(clientActions(moved(2), far), ["cancel"]);
  });
});

describe("lịch sử đổi lịch đọc riêng", () => {
  const history = [
    { id: "h1", requestedBy: "PT", status: "ACCEPTED", proposedStartAt: "2026-09-19T10:00:00.000Z" },
    { id: "h2", requestedBy: "PT", status: "ACCEPTED", proposedStartAt: "2026-09-19T09:00:00.000Z" },
    { id: "h3", requestedBy: "CLIENT", status: "REJECTED" },
  ];

  it("gộp lịch sử vào buổi tập mà không mất đề nghị đang chờ", () => {
    const pendingOnly = normalizeSession({
      ...RAW_SESSION,
      // Đây là tất cả những gì /sessions/upcoming đính kèm: chỉ cái đang chờ.
      rescheduleRequests: [{ id: "open", requestedBy: "PT", status: "PENDING" }],
    });
    const full = withRescheduleHistory(pendingOnly, normalizeRescheduleHistory(history));
    assert.equal(full.reschedules.length, 4);
    assert.equal(pendingReschedule(full)?.id, "open");
    assert.equal(acceptedMoves(full), 2);
    // Đang có đề nghị mở thì lý do đó nói trước — nó mới là việc người dùng làm được ngay.
    assert.match(
      rescheduleBlockedReason(full, new Date("2026-09-16T10:00:00.000Z"))!,
      /trả lời đề nghị đó trước/,
    );

    // Trả lời xong, trần 2 lần dời mới là thứ chặn.
    const answered = withRescheduleHistory(at("CONFIRMED"), normalizeRescheduleHistory(history));
    assert.equal(pendingReschedule(answered), null);
    assert.match(
      rescheduleBlockedReason(answered, new Date("2026-09-16T10:00:00.000Z"))!,
      /đã dời 2 lần/,
    );
  });

  it("không đụng gì khi lịch sử rỗng", () => {
    const session = at("CONFIRMED");
    assert.equal(withRescheduleHistory(session, []), session);
    assert.deepEqual(normalizeRescheduleHistory(null), []);
  });
});
