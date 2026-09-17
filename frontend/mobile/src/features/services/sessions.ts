/**
 * CL-06/07/08's pure parts: a training session's state, what the client may do about it, and what
 * booking or cancelling one costs them.
 *
 * The state machine is the backend's and it is unusually strict about money, so the screen follows
 * it exactly rather than approximating:
 *
 *  - eight statuses, and **only COMPLETED consumes a session from the package quota**. A session
 *    sitting in REQUESTED, CONFIRMED, PENDING_CLIENT_CONFIRMATION, DISPUTED or PT_NO_SHOW_REPORTED
 *    has not been charged for yet, which is exactly what makes "còn lại" honest;
 *  - cancelling inside 24 hours is not free: the client loses the session and the trainer is
 *    compensated for it, so the sheet says so BEFORE the tap, not after;
 *  - a PT no-show can only be reported once the session has actually started (plus a grace
 *    period) — reporting earlier is refused server-side;
 *  - a session the PT marked as delivered waits for the client, and auto-confirms if they say
 *    nothing. The deadline comes from the server (`clientConfirmDeadline`); the constant below is
 *    only for wording when the server has not stamped one yet.
 */

/** Mirrors the backend's own constants (booking.service.ts). */
export const CANCEL_WINDOW_HOURS = 24;
export const NO_SHOW_GRACE_MINUTES = 15;
export const AUTO_CONFIRM_DAYS = 3;

export type SessionRow = {
  id: string;
  contractId: string;
  ptUserId: string;
  status: string;
  sessionMode: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  notes: string | null;
  cancellationReason: string | null;
  disputeReason: string | null;
  /** True once the session has actually been charged against the package. */
  deducted: boolean;
  ptAtFault: boolean;
  confirmDeadline: string | null;
  autoConfirmed: boolean;
};

export function normalizeSession(raw: any): SessionRow {
  return {
    id: String(raw?.id ?? ""),
    contractId: String(raw?.contractId ?? ""),
    ptUserId: String(raw?.ptUserId ?? ""),
    status: String(raw?.status ?? ""),
    sessionMode: raw?.sessionMode ?? null,
    startAt: raw?.scheduledStartAt ?? null,
    endAt: raw?.scheduledEndAt ?? null,
    location: raw?.location ?? null,
    notes: raw?.notes ?? null,
    cancellationReason: raw?.cancellationReason ?? null,
    disputeReason: raw?.disputeReason ?? null,
    deducted: raw?.sessionDeducted === true,
    ptAtFault: raw?.ptAtFault === true,
    confirmDeadline: raw?.clientConfirmDeadline ?? null,
    autoConfirmed: raw?.autoConfirmed === true,
  };
}

export function normalizeSessions(raw: any): SessionRow[] {
  const list = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map(normalizeSession)
    .filter((s: SessionRow) => s.id)
    .sort((a: SessionRow, b: SessionRow) => String(a.startAt ?? "").localeCompare(String(b.startAt ?? "")));
}

export type SessionTone = "success" | "warning" | "danger" | "neutral" | "info";

export const SESSION_STATUS: Record<string, { label: string; tone: SessionTone; note?: string }> = {
  REQUESTED: { label: "Chờ PT xác nhận", tone: "warning", note: "Huấn luyện viên chưa xác nhận buổi này." },
  CONFIRMED: { label: "Đã xác nhận", tone: "success" },
  PENDING_CLIENT_CONFIRMATION: {
    label: "Chờ bạn xác nhận",
    tone: "warning",
    note: "PT báo đã dạy buổi này. Xác nhận hoặc khiếu nại — quá hạn thì hệ thống tự xác nhận.",
  },
  DISPUTED: { label: "Đang khiếu nại", tone: "danger", note: "Quản trị viên sẽ xem xét và phân xử." },
  PT_NO_SHOW_REPORTED: {
    label: "Đã báo PT vắng",
    tone: "warning",
    note: "Đang chờ huấn luyện viên phản hồi báo cáo của bạn.",
  },
  COMPLETED: { label: "Hoàn thành", tone: "neutral" },
  CANCELLED: { label: "Đã huỷ", tone: "neutral" },
  NO_SHOW: { label: "Vắng mặt", tone: "danger" },
};

export function sessionStatus(status: string) {
  return SESSION_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as SessionTone };
}

/** The one rule the whole quota display rests on. */
export function consumesQuota(session: SessionRow): boolean {
  return session.status === "COMPLETED";
}

export type SessionGroup = "action" | "upcoming" | "past";

/**
 * Which list a session belongs in. "Cần bạn xử lý" comes first because those are the ones with a
 * deadline attached — a session waiting on the client auto-confirms if ignored.
 */
export function groupOf(session: SessionRow, now: Date = new Date()): SessionGroup {
  if (["PENDING_CLIENT_CONFIRMATION", "DISPUTED", "PT_NO_SHOW_REPORTED"].includes(session.status)) {
    return "action";
  }
  if (["REQUESTED", "CONFIRMED"].includes(session.status)) {
    const end = session.endAt ? Date.parse(session.endAt) : NaN;
    // A confirmed session whose time has passed is not "upcoming" any more, even though the PT has
    // not filed it yet — showing it under Sắp tới is how a screen starts lying about the calendar.
    return Number.isFinite(end) && end < now.getTime() ? "past" : "upcoming";
  }
  return "past";
}

export function hoursUntil(session: SessionRow, now: Date = new Date()): number | null {
  if (!session.startAt) return null;
  const start = Date.parse(session.startAt);
  if (!Number.isFinite(start)) return null;
  return (start - now.getTime()) / 3_600_000;
}

/** Inside the 24-hour window, cancelling costs the client the session. */
export function cancelCostsSession(session: SessionRow, now: Date = new Date()): boolean {
  const hours = hoursUntil(session, now);
  return hours !== null && hours < CANCEL_WINDOW_HOURS;
}

export function cancelWarning(session: SessionRow, now: Date = new Date()): string {
  return cancelCostsSession(session, now)
    ? `Còn dưới ${CANCEL_WINDOW_HOURS} giờ nữa tới giờ tập: huỷ bây giờ sẽ TRỪ 1 buổi trong gói và huấn luyện viên vẫn được tính công buổi đó.`
    : `Còn hơn ${CANCEL_WINDOW_HOURS} giờ nữa: huỷ bây giờ không bị trừ buổi, bạn đặt lại lúc khác được.`;
}

/** The PT can only be reported absent once the session has started and the grace period is up. */
export function canReportNoShow(session: SessionRow, now: Date = new Date()): boolean {
  if (session.status !== "CONFIRMED" || !session.startAt) return false;
  const start = Date.parse(session.startAt);
  if (!Number.isFinite(start)) return false;
  return now.getTime() >= start + NO_SHOW_GRACE_MINUTES * 60_000;
}

/**
 * Rescheduling has its own four rules, all enforced server-side (booking.service.ts): the session
 * must be CONFIRMED (a REQUESTED one has not been agreed yet — the PT simply confirms a different
 * time instead), it must not have started, it must be at least 12 hours away, and a reason is
 * required. `null` means a proposal would be accepted.
 */
export const RESCHEDULE_WINDOW_HOURS = 12;

export function rescheduleBlockedReason(session: SessionRow, now: Date = new Date()): string | null {
  if (session.status !== "CONFIRMED") {
    return "Chỉ buổi đã được huấn luyện viên xác nhận mới đổi lịch được.";
  }
  const hours = hoursUntil(session, now);
  if (hours === null) return "Buổi tập chưa có giờ cụ thể.";
  if (hours <= 0) return "Buổi tập đã bắt đầu, không đổi lịch được nữa.";
  if (hours < RESCHEDULE_WINDOW_HOURS) {
    return `Chỉ đổi lịch được khi còn hơn ${RESCHEDULE_WINDOW_HOURS} giờ trước buổi tập.`;
  }
  return null;
}

export type SessionAction =
  | "cancel"
  | "reschedule"
  | "confirm"
  | "dispute"
  | "report-no-show"
  | "review";

/** Exactly the actions the server would accept from a client for this session, in this state. */
export function clientActions(session: SessionRow, now: Date = new Date()): SessionAction[] {
  switch (session.status) {
    case "REQUESTED":
    case "CONFIRMED": {
      const actions: SessionAction[] = ["cancel"];
      // Offered only when it would actually be accepted — the 12-hour rule is the server's, and a
      // button that always answers 400 is worse than no button.
      if (!rescheduleBlockedReason(session, now)) actions.push("reschedule");
      if (canReportNoShow(session, now)) actions.push("report-no-show");
      return actions;
    }
    case "PENDING_CLIENT_CONFIRMATION":
      return ["confirm", "dispute"];
    case "COMPLETED":
      return ["review"];
    default:
      // DISPUTED and PT_NO_SHOW_REPORTED are waiting on someone else; CANCELLED and NO_SHOW are done.
      return [];
  }
}

/** How long the client has left before the session auto-confirms itself. */
export function confirmDeadlineText(session: SessionRow, now: Date = new Date()): string | null {
  if (session.status !== "PENDING_CLIENT_CONFIRMATION") return null;
  if (!session.confirmDeadline) {
    return `Nếu bạn không phản hồi, hệ thống tự xác nhận sau ${AUTO_CONFIRM_DAYS} ngày.`;
  }
  const deadline = Date.parse(session.confirmDeadline);
  if (!Number.isFinite(deadline)) return null;
  const hours = Math.max(0, Math.round((deadline - now.getTime()) / 3_600_000));
  if (hours <= 0) return "Sắp tự động xác nhận.";
  if (hours < 24) return `Tự động xác nhận sau khoảng ${hours} giờ nữa.`;
  return `Tự động xác nhận sau khoảng ${Math.round(hours / 24)} ngày nữa.`;
}

/** `GET /availability/:ptUserId/slots?date=` answers a bare array of "HH:MM". */
export function normalizeSlots(raw: any): string[] {
  const list = Array.isArray(raw?.slots) ? raw.slots : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list.map((slot: any) => String(slot)).filter((slot: string) => /^\d{2}:\d{2}$/.test(slot));
}

/**
 * A slot earlier today is offered by the endpoint (it works per day, not per minute) but cannot be
 * booked — dropping it here saves the user a refusal they can do nothing about.
 */
export function bookableSlots(slots: string[], date: string, now: Date = new Date()): string[] {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (date !== today) return slots;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return slots.filter((slot) => {
    const [h, m] = slot.split(":").map(Number);
    return h * 60 + m > minutesNow;
  });
}

/** The body for `POST /sessions`: a date and a time, not an ISO instant. */
export function buildBookingPayload(input: {
  date: string;
  time: string;
  sessionMode?: string | null;
  location?: string;
  notes?: string;
  durationMin?: number;
}): {
  scheduledDate: string;
  scheduledTime: string;
  sessionMode?: string;
  location?: string;
  notes?: string;
  durationMin?: number;
} {
  const location = input.location?.trim();
  const notes = input.notes?.trim();
  return {
    scheduledDate: input.date,
    scheduledTime: input.time,
    ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
    ...(input.durationMin ? { durationMin: input.durationMin } : {}),
  };
}

/** How long this session runs, from its own times — 60 minutes only when the row says nothing. */
export function sessionDurationMinutes(session: SessionRow): number {
  const start = session.startAt ? Date.parse(session.startAt) : NaN;
  const end = session.endAt ? Date.parse(session.endAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 60;
  return Math.round((end - start) / 60_000);
}

/**
 * `POST /sessions/:id/reschedule` wants two ISO instants, not a date and a time. The new start is
 * built in the DEVICE's timezone — "17:00" means five in the afternoon where the client is, and
 * `toISOString()` is what turns that into the instant the server stores.
 */
export function buildReschedulePayload(
  session: SessionRow,
  date: string,
  time: string,
): { proposedStartAt: string; proposedEndAt: string } | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const start = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + sessionDurationMinutes(session) * 60_000);
  return { proposedStartAt: start.toISOString(), proposedEndAt: end.toISOString() };
}

/** A review needs a star count in 1..5; the comment is optional. */
export function reviewBlockedReason(rating: number): string | null {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "Chọn số sao từ 1 đến 5.";
  return null;
}

/** Why booking is off. null means it is on. */
export function bookingBlockedReason(input: {
  contractStatus: string;
  sessionsLeft: number;
  date: string | null;
  time: string | null;
}): string | null {
  if (input.contractStatus !== "ACTIVE") return "Chỉ đặt được buổi trên hợp đồng đang hiệu lực.";
  if (input.sessionsLeft <= 0) return "Gói đã dùng hết số buổi.";
  if (!input.date) return "Chọn ngày tập.";
  if (!input.time) return "Chọn khung giờ.";
  return null;
}
