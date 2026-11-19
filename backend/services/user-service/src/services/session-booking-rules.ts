/**
 * Pure rules for booking sessions - nothing here reads the database or the clock, so they are unit-tested directly
 * (src/__tests__/session-daily-cap-and-batch.test.ts). booking.service.ts feeds them the rows it read under the locks.
 *
 * DAILY CAP: a client may hold at most MAX_CLIENT_SESSIONS_PER_DAY live sessions starting on the same calendar day
 * (server-local day, the same day the slot rules use), counted over ALL of their PTs together. "Live" = every status
 * in ACTIVE_SESSION_STATUSES (sessionRepository): REQUESTED (not yet PT-confirmed) counts exactly like CONFIRMED;
 * CANCELLED / COMPLETED / NO_SHOW do not.
 */

export const MAX_CLIENT_SESSIONS_PER_DAY = 2;
/** 409 - the client already holds the daily maximum of live sessions on that day. */
export const CLIENT_DAILY_SESSION_LIMIT = "CLIENT_DAILY_SESSION_LIMIT";

/** Slots one batch request may carry (also bounded by the contract's remaining sessions). */
export const MAX_BATCH_SESSIONS = 10;
/** 400/409 - a batch booking was refused as a whole; the body lists the reason per slot. */
export const BATCH_BOOKING_REJECTED = "BATCH_BOOKING_REJECTED";
export const BATCH_DUPLICATE_SLOT = "BATCH_DUPLICATE_SLOT";
export const BATCH_OVERLAPPING_SLOTS = "BATCH_OVERLAPPING_SLOTS";

export interface SlotProblem {
  status: number;
  code?: string;
  message: string;
  /** Structured context of a coded refusal (e.g. { gymId } of SESSION_NOT_COVERED_BY_MEMBERSHIP), forwarded to the client. */
  details?: Record<string, unknown>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the server-local calendar day of `d`. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight (server-local) at the start of `d`'s day, and of the next day. */
export function localDayBounds(d: Date): { from: Date; to: Date } {
  return {
    from: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
  };
}

export function dailyCapMessage(dayKey: string, max = MAX_CLIENT_SESSIONS_PER_DAY): string {
  const [, mm, dd] = dayKey.split("-");
  return `Mỗi ngày bạn chỉ được đặt tối đa ${max} buổi tập (tính cả buổi đang chờ huấn luyện viên xác nhận). Ngày ${dd}/${mm} đã đủ ${max} buổi — hãy chọn ngày khác.`;
}

export function dailyCapProblem(dayKey: string, max = MAX_CLIENT_SESSIONS_PER_DAY): SlotProblem {
  return { status: 409, code: CLIENT_DAILY_SESSION_LIMIT, message: dailyCapMessage(dayKey, max) };
}

/**
 * Daily cap for new starts, given the live sessions the client already has. A new start fits while
 * (existing on its day + new starts of that day accepted before it) < max; the ones that do not fit are returned
 * by their index in `newStarts`. A single booking is the one-element case.
 */
export function overCapSlots(
  existingStarts: Date[],
  newStarts: Date[],
  max = MAX_CLIENT_SESSIONS_PER_DAY,
): Map<number, SlotProblem> {
  const perDay = new Map<string, number>();
  for (const s of existingStarts) {
    const k = localDayKey(s);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const rejected = new Map<number, SlotProblem>();
  newStarts.forEach((start, index) => {
    const k = localDayKey(start);
    const n = perDay.get(k) ?? 0;
    if (n >= max) rejected.set(index, dailyCapProblem(k, max));
    else perDay.set(k, n + 1);
  });
  return rejected;
}

/**
 * Problems inside one batch of slots for the SAME PT and client, before anything is read from the database: a slot
 * chosen twice, or two slots that overlap in time. The later one of a pair is the one flagged.
 */
export function batchInternalProblems(
  starts: Date[],
  durationMin: number,
): Map<number, SlotProblem> {
  const out = new Map<number, SlotProblem>();
  const durMs = durationMin * 60_000;
  starts.forEach((start, i) => {
    for (let j = 0; j < i; j++) {
      const other = starts[j];
      if (other.getTime() === start.getTime()) {
        out.set(i, { status: 400, code: BATCH_DUPLICATE_SLOT, message: "Khung giờ này bị chọn hai lần trong cùng một lần đặt." });
        return;
      }
      if (start.getTime() < other.getTime() + durMs && other.getTime() < start.getTime() + durMs) {
        out.set(i, { status: 400, code: BATCH_OVERLAPPING_SLOTS, message: "Khung giờ này chồng lên một khung giờ khác bạn đã chọn trong cùng một lần đặt." });
        return;
      }
    }
  });
  return out;
}

export interface BatchSlotError extends SlotProblem {
  index: number;
  scheduledDate: string;
  scheduledTime: string;
}

/** The HTTP status of a rejected batch: 409 when any slot is a conflict/cap, else 400. */
export function batchStatus(errors: Pick<SlotProblem, "status">[]): number {
  return errors.some((e) => e.status === 409) ? 409 : 400;
}
