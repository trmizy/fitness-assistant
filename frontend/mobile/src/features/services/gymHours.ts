/**
 * Giờ mở cửa + liên kết chia sẻ của chi tiết phòng gym phía KHÁCH (FIX5 / Q8, cùng luật với web
 * `utils/gymHours.ts` + `utils/shareLink.ts`).
 *
 * Dữ liệu là 7 dòng { day, type: OPEN | CLOSED | ALL_DAY, openMinute, closeMinute } do chủ gym nhập,
 * server trả trong `operatingHours` của GET /gyms/:id (công khai, [] = chưa có dữ liệu).
 *
 * Thuần (không React, không đồng hồ ẩn — `now` là tham số): chạy được bằng `npx tsx --test`.
 * Giờ hiểu theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè) chứ không theo múi giờ máy khách; tính bằng
 * số học thuần nên không phụ thuộc Intl của Hermes.
 *
 * Khác web ở một điểm: ca qua đêm (đóng cửa nhỏ hơn giờ mở, vd 18:00–02:00) được hiểu là qua nửa đêm.
 * Wizard hiện không cho nhập ca này, nhưng dữ liệu cũ/nhập tay vẫn phải hiện đúng.
 */

export type WeekDay = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
export type DayScheduleType = "OPEN" | "CLOSED" | "ALL_DAY";

export interface HoursDay {
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

/** "05:00 - 21:00" / "Mở 24 giờ" / "Đóng cửa". Ca qua đêm thêm "(hôm sau)". */
export function hoursLabel(d: HoursDay): string {
  if (d.type === "ALL_DAY") return "Mở 24 giờ";
  if (d.type === "OPEN" && d.openMinute != null && d.closeMinute != null) {
    const overnight = isOvernight(d);
    return `${formatMinutes(d.openMinute)} - ${formatMinutes(d.closeMinute)}${overnight ? " (hôm sau)" : ""}`;
  }
  return "Đóng cửa";
}

function isOvernight(d: HoursDay): boolean {
  return d.type === "OPEN" && d.openMinute != null && d.closeMinute != null && d.closeMinute < d.openMinute;
}

/** Chuẩn hoá dữ liệu server: bỏ rác, đủ thứ tự Thứ 2..Chủ nhật; [] khi không có dữ liệu thật. */
export function normalizeHours(raw: unknown): HoursDay[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const byDay = new Map<string, any>();
  for (const r of raw) if (r && typeof r.day === "string") byDay.set(r.day, r);
  return WEEK_ORDER.map((day) => {
    const r = byDay.get(day);
    const type: DayScheduleType = r?.type === "OPEN" || r?.type === "ALL_DAY" ? r.type : "CLOSED";
    if (type === "OPEN" && (typeof r.openMinute !== "number" || typeof r.closeMinute !== "number" || r.openMinute === r.closeMinute)) {
      return { day, type: "CLOSED", openMinute: null, closeMinute: null };
    }
    return { day, type, openMinute: type === "OPEN" ? r.openMinute : null, closeMinute: type === "OPEN" ? r.closeMinute : null };
  });
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Thứ + số phút trong ngày của `now` theo giờ Việt Nam. */
export function vietnamClock(now: Date): { day: WeekDay; minute: number } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const jsDay = vn.getUTCDay(); // 0 = Chủ nhật
  return { day: WEEK_ORDER[(jsDay + 6) % 7], minute: vn.getUTCHours() * 60 + vn.getUTCMinutes() };
}

export type OpenNow =
  | { state: "open"; label: string }
  | { state: "closed"; label: string }
  | { state: "unknown"; label: string };

function nextOpening(hours: HoursDay[], from: WeekDay, minute: number): { dayOffset: number; day: WeekDay; at: number } | null {
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

/** Trạng thái "đang mở/đóng" lúc `now` (giờ VN) + câu mô tả ngắn cho huy hiệu. */
export function openNowStatus(hoursRaw: unknown, now: Date = new Date()): OpenNow {
  const hours = normalizeHours(hoursRaw);
  if (hours.length === 0) return { state: "unknown", label: "" };
  const { day, minute } = vietnamClock(now);
  const idx = WEEK_ORDER.indexOf(day);
  const today = hours[idx];
  const yesterday = hours[(idx + 6) % 7];

  if (today.type === "ALL_DAY") return { state: "open", label: "Đang mở cửa · 24 giờ" };

  // Ca qua đêm của hôm qua còn kéo sang sáng nay.
  if (isOvernight(yesterday) && minute < (yesterday.closeMinute as number)) {
    return { state: "open", label: `Đang mở cửa · đóng lúc ${formatMinutes(yesterday.closeMinute)}` };
  }
  if (today.type === "OPEN" && today.openMinute != null && today.closeMinute != null) {
    const overnight = isOvernight(today);
    const openNow = overnight ? minute >= today.openMinute : minute >= today.openMinute && minute < today.closeMinute;
    if (openNow) return { state: "open", label: `Đang mở cửa · đóng lúc ${formatMinutes(today.closeMinute)}` };
  }

  const next = nextOpening(hours, day, minute);
  if (!next) return { state: "closed", label: "Đang đóng cửa" };
  const when = next.dayOffset === 0 ? "hôm nay" : next.dayOffset === 1 ? "ngày mai" : WEEKDAY_LABEL_VI[next.day];
  return { state: "closed", label: `Đang đóng cửa · mở lại ${formatMinutes(next.at)} ${when}` };
}

/** Các ngày nghỉ — "Nghỉ: Chủ nhật", rỗng khi mở cả tuần. */
export function closedDaysLabel(hoursRaw: unknown): string {
  const closed = normalizeHours(hoursRaw).filter((h) => h.type === "CLOSED");
  return closed.length ? `Nghỉ: ${closed.map((h) => WEEKDAY_LABEL_VI[h.day]).join(", ")}` : "";
}

/* ───────────────────────── Liên kết chia sẻ ───────────────────────── */

export const DEFAULT_WEB_ORIGIN = "https://gymini.vn";

/**
 * Gốc của web Gymini để dựng liên kết chia sẻ. App không có cấu hình riêng cho web, nên theo thứ tự:
 *   1. `EXPO_PUBLIC_WEB_URL` nếu build có đặt;
 *   2. suy ra từ địa chỉ gateway công khai `https://api.<miền>` → `https://<miền>` (eas.json: api.gymini.vn);
 *   3. mặc định https://gymini.vn (gateway dev LAN/emulator không phải địa chỉ web).
 */
export function webOrigin(opts: { webUrl?: string | null; apiUrl?: string | null } = {}): string {
  const clean = (u?: string | null) => (u ?? "").trim().replace(/\/+$/, "");
  const explicit = clean(opts.webUrl);
  if (/^https?:\/\/[^/\s]+$/i.test(explicit)) return explicit;
  const api = clean(opts.apiUrl);
  const m = /^(https:\/\/)api\.([^/\s:]+\.[^/\s:]+)$/i.exec(api);
  if (m) return `${m[1]}${m[2]}`;
  return DEFAULT_WEB_ORIGIN;
}

/** Liên kết chi tiết một phòng gym — cùng dạng với web (`/gyms/:id`): đăng nhập rồi mở đúng gym. */
export function publicGymUrl(gymId: string, origin: string = DEFAULT_WEB_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/gyms/${encodeURIComponent(gymId)}`;
}

/**
 * Nội dung bảng chia sẻ của hệ điều hành. Android chỉ đọc `message` nên URL phải nằm trong đó;
 * iOS nhận `url` riêng (để tránh hiện URL hai lần) — nơi gọi chọn theo Platform.OS.
 */
export function gymShareContent(
  gym: { id: string; name: string },
  origin?: string,
): { title: string; text: string; url: string; messageWithUrl: string } {
  const url = publicGymUrl(gym.id, origin);
  const text = `${gym.name} — phòng gym trên Gymini`;
  return { title: gym.name, text, url, messageWithUrl: `${text}\n${url}` };
}
