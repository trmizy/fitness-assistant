/**
 * Giờ mở cửa của phòng gym phía KHÁCH (chi tiết gym công khai). Dữ liệu là 7 dòng
 * { day, type: OPEN | CLOSED | ALL_DAY, openMinute, closeMinute } do chủ gym nhập ở wizard,
 * server trả trong `operatingHours` của GET /gyms/:id ([] = chưa có dữ liệu).
 *
 * Thuần (không React, không đồng hồ ẩn — `now` là tham số): chạy được bằng `npx tsx --test`.
 * Giờ hiểu theo giờ Việt Nam (Asia/Ho_Chi_Minh), không theo múi giờ máy khách — một phòng gym
 * ở TP.HCM mở 05:00 thì khách đang ở nước ngoài cũng phải thấy "05:00".
 */
import type { DayScheduleType, WeekDay } from "../types";

export interface PublicHoursDay {
  day: WeekDay;
  type: DayScheduleType;
  openMinute: number | null;
  closeMinute: number | null;
}

export const WEEK_ORDER: WeekDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export const WEEKDAY_LABEL_VI: Record<WeekDay, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "Chủ nhật",
};

export function formatMinutes(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "05:00 - 21:00" / "Mở 24 giờ" / "Đóng cửa". */
export function hoursLabel(d: PublicHoursDay): string {
  if (d.type === "ALL_DAY") return "Mở 24 giờ";
  if (d.type === "OPEN" && d.openMinute != null && d.closeMinute != null) return `${formatMinutes(d.openMinute)} - ${formatMinutes(d.closeMinute)}`;
  return "Đóng cửa";
}

/** Chuẩn hoá dữ liệu server: bỏ rác, đủ thứ tự Thứ 2..Chủ nhật; [] khi không có dữ liệu thật. */
export function normalizeHours(raw: unknown): PublicHoursDay[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const byDay = new Map<string, any>();
  for (const r of raw) if (r && typeof r.day === "string") byDay.set(r.day, r);
  return WEEK_ORDER.map((day) => {
    const r = byDay.get(day);
    const type: DayScheduleType = r?.type === "OPEN" || r?.type === "ALL_DAY" ? r.type : "CLOSED";
    if (type === "OPEN" && (typeof r.openMinute !== "number" || typeof r.closeMinute !== "number")) {
      return { day, type: "CLOSED", openMinute: null, closeMinute: null };
    }
    return { day, type, openMinute: type === "OPEN" ? r.openMinute : null, closeMinute: type === "OPEN" ? r.closeMinute : null };
  });
}

const VN_TZ = "Asia/Ho_Chi_Minh";
const EN_WEEKDAY_TO_KEY: Record<string, WeekDay> = {
  Monday: "MONDAY", Tuesday: "TUESDAY", Wednesday: "WEDNESDAY", Thursday: "THURSDAY", Friday: "FRIDAY", Saturday: "SATURDAY", Sunday: "SUNDAY",
};

/** Thứ + số phút trong ngày của `now` theo giờ Việt Nam. */
export function vietnamClock(now: Date): { day: WeekDay; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: VN_TZ, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = EN_WEEKDAY_TO_KEY[get("weekday")] ?? "MONDAY";
  return { day, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export type OpenNow =
  | { state: "open"; label: string }
  | { state: "closed"; label: string }
  | { state: "unknown"; label: string };

function nextOpening(hours: PublicHoursDay[], from: WeekDay, minute: number): { dayOffset: number; day: WeekDay; at: number | null } | null {
  const startIdx = WEEK_ORDER.indexOf(from);
  for (let off = 0; off <= 7; off++) {
    const d = hours[(startIdx + off) % 7];
    if (d.type === "ALL_DAY") return { dayOffset: off, day: d.day, at: 0 };
    if (d.type === "OPEN" && d.openMinute != null && (off > 0 || d.openMinute > minute)) {
      return { dayOffset: off, day: d.day, at: d.openMinute };
    }
  }
  return null;
}

/** Trạng thái "đang mở/đóng" của chi nhánh lúc `now` (giờ VN) + câu mô tả ngắn cho huy hiệu. */
export function openNowStatus(hoursRaw: unknown, now: Date = new Date()): OpenNow {
  const hours = normalizeHours(hoursRaw);
  if (hours.length === 0) return { state: "unknown", label: "" };
  const { day, minute } = vietnamClock(now);
  const today = hours.find((h) => h.day === day)!;
  if (today.type === "ALL_DAY") return { state: "open", label: "Đang mở cửa · 24 giờ" };
  if (today.type === "OPEN" && today.openMinute != null && today.closeMinute != null && minute >= today.openMinute && minute < today.closeMinute) {
    return { state: "open", label: `Đang mở cửa · đóng lúc ${formatMinutes(today.closeMinute)}` };
  }
  const next = nextOpening(hours, day, minute);
  if (!next) return { state: "closed", label: "Đang đóng cửa" };
  const when = next.dayOffset === 0 ? "hôm nay" : next.dayOffset === 1 ? "ngày mai" : WEEKDAY_LABEL_VI[next.day];
  return { state: "closed", label: `Đang đóng cửa · mở lại ${formatMinutes(next.at)} ${when}` };
}

/** Các ngày nghỉ (CLOSED) — "Nghỉ: Chủ nhật", rỗng khi mở cả tuần. */
export function closedDaysLabel(hoursRaw: unknown): string {
  const closed = normalizeHours(hoursRaw).filter((h) => h.type === "CLOSED");
  return closed.length ? `Nghỉ: ${closed.map((h) => WEEKDAY_LABEL_VI[h.day]).join(", ")}` : "";
}
