/**
 * 14B.5 (PG-A7, GY-03) — the rules of web `GymManagePage` and the wizard steps it reuses
 * (`StepOpeningHours`, `StepFacilities`, `StepPhotos`, `StepVerification`), kept pure so they are
 * unit-tested. gym-service validates every write again (gym.schemas.ts, gym-hours.service.ts,
 * gym-photo.service.ts, gym.service.setOperationalStatus); these only keep the phone from offering
 * what the server would refuse.
 *
 * Who may do what (gym-service owner.routes.ts, "tiền và người thì chỉ chủ sở hữu"): name/address,
 * about/contact, location, hours, facilities, photos and documents are OWNER-only; a MANAGER of this
 * branch may read it, change its operational status (with the closure impact) and list members.
 */
import type {
  BranchDocumentType,
  DayScheduleType,
  GymFacility,
  GymOperatingHoursDay,
  PartnerDocumentStatus,
  WeekDay,
} from "../../types";

// ── Opening hours ──────────────────────────────────────────────────────────────────────────────

export const ALL_DAYS: WeekDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export const WEEKDAYS_AFTER_MONDAY: WeekDay[] = ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

export const DAY_LABEL: Record<WeekDay, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "Chủ nhật",
};

export const DAY_TYPE_OPTIONS: { value: DayScheduleType; label: string }[] = [
  { value: "CLOSED", label: "Đóng cửa" },
  { value: "OPEN", label: "Mở cửa" },
  { value: "ALL_DAY", label: "24 giờ" },
];

/** What the screen edits per day: the times as typed ("06:00"), so a half-typed value is not lost. */
export type HoursRow = { day: WeekDay; type: DayScheduleType; open: string; close: string };

export function minutesToTime(m: number | null | undefined): string {
  if (m == null) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function timeToMinutes(t: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Server rows (missing days are CLOSED, as `getGymHours` fills them) → editable rows in week order. */
export function hoursRows(days: readonly GymOperatingHoursDay[] | null | undefined): HoursRow[] {
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  return ALL_DAYS.map((day) => {
    const d = byDay.get(day);
    return { day, type: d?.type ?? "CLOSED", open: minutesToTime(d?.openMinute), close: minutesToTime(d?.closeMinute) };
  });
}

/** Switching a day to "Mở cửa" starts it at web's default 06:00–22:00 unless it already had times. */
export function setDayType(rows: HoursRow[], day: WeekDay, type: DayScheduleType): HoursRow[] {
  return rows.map((r) =>
    r.day === day ? { ...r, type, open: type === "OPEN" ? r.open || "06:00" : r.open, close: type === "OPEN" ? r.close || "22:00" : r.close } : r,
  );
}

export function copyMondayTo(rows: HoursRow[], days: readonly WeekDay[]): HoursRow[] {
  const monday = rows.find((r) => r.day === "MONDAY");
  if (!monday) return rows;
  return rows.map((r) => (days.includes(r.day) ? { ...r, type: monday.type, open: monday.open, close: monday.close } : r));
}

/** web `validateOpeningHours` — the same checks gym-hours.service.ts makes. */
export function hoursIssues(rows: readonly HoursRow[]): string[] {
  const issues: string[] = [];
  for (const r of rows) {
    if (r.type !== "OPEN") continue;
    const open = timeToMinutes(r.open);
    const close = timeToMinutes(r.close);
    if (open == null || close == null) issues.push(`${DAY_LABEL[r.day]}: nhập giờ theo dạng HH:MM`);
    else if (open >= close) issues.push(`${DAY_LABEL[r.day]}: giờ mở cửa phải trước giờ đóng cửa`);
  }
  if (!rows.some((r) => r.type === "OPEN" || r.type === "ALL_DAY")) issues.push("Cần ít nhất một ngày mở cửa (hoặc mở 24 giờ)");
  return issues;
}

/** `PUT /owner/gyms/:id/hours` body — all 7 days, minutes only on an "OPEN" day. */
export function hoursPayload(gymId: string, rows: readonly HoursRow[]): GymOperatingHoursDay[] {
  return rows.map((r) => ({
    id: null,
    gymId,
    day: r.day,
    type: r.type,
    openMinute: r.type === "OPEN" ? timeToMinutes(r.open) : null,
    closeMinute: r.type === "OPEN" ? timeToMinutes(r.close) : null,
  }));
}

export function hoursDirty(rows: readonly HoursRow[], saved: readonly GymOperatingHoursDay[] | null | undefined): boolean {
  return JSON.stringify(rows) !== JSON.stringify(hoursRows(saved));
}

// ── Facilities ─────────────────────────────────────────────────────────────────────────────────

export const FACILITY_LABEL: Record<GymFacility, string> = {
  FREE_WEIGHTS: "Tạ tự do",
  CARDIO_MACHINES: "Máy cardio",
  FUNCTIONAL_TRAINING_AREA: "Khu tập functional",
  GROUP_CLASSES: "Lớp tập nhóm",
  YOGA_STUDIO: "Phòng Yoga",
  SWIMMING_POOL: "Hồ bơi",
  PERSONAL_TRAINER: "Huấn luyện viên cá nhân",
  INBODY_SCAN: "Máy đo InBody",
  LOCKER_ROOM: "Phòng thay đồ / tủ khoá",
  SHOWER: "Phòng tắm",
  SAUNA: "Xông hơi",
  TOWEL_SERVICE: "Dịch vụ khăn tắm",
  PARKING: "Bãi đỗ xe",
  WIFI: "Wifi miễn phí",
  AIR_CONDITIONING: "Máy lạnh",
  DRINKING_WATER: "Nước uống miễn phí",
  KIDS_AREA: "Khu vui chơi trẻ em",
  VENDING_MACHINE: "Máy bán hàng tự động",
};

export const FACILITY_GROUPS: { label: string; items: GymFacility[] }[] = [
  { label: "Thiết bị tập luyện", items: ["FREE_WEIGHTS", "CARDIO_MACHINES", "FUNCTIONAL_TRAINING_AREA", "SWIMMING_POOL", "INBODY_SCAN"] },
  { label: "Lớp học & huấn luyện", items: ["GROUP_CLASSES", "YOGA_STUDIO", "PERSONAL_TRAINER"] },
  { label: "Tiện nghi", items: ["LOCKER_ROOM", "SHOWER", "SAUNA", "TOWEL_SERVICE", "AIR_CONDITIONING", "DRINKING_WATER"] },
  { label: "Khác", items: ["PARKING", "WIFI", "KIDS_AREA", "VENDING_MACHINE"] },
];

export function toggleFacility(list: readonly GymFacility[], f: GymFacility): GymFacility[] {
  return list.includes(f) ? list.filter((x) => x !== f) : [...list, f];
}

export function sameFacilities(a: readonly GymFacility[], b: readonly GymFacility[] | null | undefined): boolean {
  const s = new Set(b ?? []);
  return a.length === s.size && a.every((f) => s.has(f));
}

// ── About & contact ────────────────────────────────────────────────────────────────────────────

export const ABOUT_MAX = 300;

/** gym.schemas.ts: description ≤ 300, phone ≤ 20, email valid or empty. */
export function aboutError(f: { description: string; phone: string; email: string }): string | null {
  if (f.description.trim().length > ABOUT_MAX) return `Giới thiệu tối đa ${ABOUT_MAX} ký tự`;
  if (f.phone.trim().length > 20) return "Số điện thoại tối đa 20 ký tự";
  const email = f.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Email không đúng định dạng";
  return null;
}

/** Name/address: both required, ≤ 150 / ≤ 300 (gym.schemas.ts). */
export function nameAddressError(f: { name: string; address: string }): string | null {
  if (!f.name.trim()) return "Nhập tên chi nhánh";
  if (f.name.trim().length > 150) return "Tên tối đa 150 ký tự";
  if (!f.address.trim()) return "Nhập địa chỉ";
  if (f.address.trim().length > 300) return "Địa chỉ tối đa 300 ký tự";
  return null;
}

// ── Photos ─────────────────────────────────────────────────────────────────────────────────────

export const MAX_PHOTOS = 20;

/** Swap a photo with its neighbour; the new id order is what `PUT .../photos/reorder` takes. */
export function movedPhotoIds(ids: readonly string[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── Branch documents ───────────────────────────────────────────────────────────────────────────

export const BRANCH_DOC_ORDER: BranchDocumentType[] = ["LEASE_OR_PROPERTY_DOC", "FIRE_SAFETY_CERTIFICATE", "FACILITY_PHOTOS"];

export const BRANCH_DOC_LABEL: Record<BranchDocumentType, string> = {
  LEASE_OR_PROPERTY_DOC: "Hợp đồng thuê / giấy tờ sở hữu mặt bằng",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
  FACILITY_PHOTOS: "Ảnh thực địa cơ sở vật chất",
};

export const PARTNER_DOC_LABEL: Record<string, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  REPRESENTATIVE_ID: "CCCD người đại diện",
  PREMISES_PROOF: "Giấy tờ mặt bằng (đối tác)",
  TAX_CODE_CERTIFICATE: "Chứng nhận mã số thuế",
  SITE_PHOTOS: "Ảnh thực địa (đối tác)",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC (đối tác)",
};

export const DOC_STATUS: Record<PartnerDocumentStatus, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  PENDING: { label: "Chưa nộp", tone: "neutral" },
  RECEIVED: { label: "Đang chờ xem xét", tone: "warning" },
  VERIFIED: { label: "Đã xác minh", tone: "success" },
  REJECTED: { label: "Bị từ chối — cần nộp lại", tone: "danger" },
};

export function docStatus(status: string | null | undefined) {
  return DOC_STATUS[(status ?? "PENDING") as PartnerDocumentStatus] ?? DOC_STATUS.PENDING;
}

export function isPdfToken(token: string | null | undefined): boolean {
  return !!token && token.toLowerCase().endsWith(".pdf");
}

// ── Operational status ─────────────────────────────────────────────────────────────────────────

export type ClosingMode = "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED";

/** gym.service.setOperationalStatus: permanent is final; only a temporarily closed branch reopens. */
export function operationalActions(status: string | null | undefined): { reopen: boolean; closeTemporarily: boolean; closePermanently: boolean } {
  if (status === "PERMANENTLY_CLOSED") return { reopen: false, closeTemporarily: false, closePermanently: false };
  if (status === "TEMPORARILY_CLOSED") return { reopen: true, closeTemporarily: false, closePermanently: true };
  return { reopen: false, closeTemporarily: true, closePermanently: true };
}

/** Optional reopen date for a temporary closure: YYYY-MM-DD, today or later (web's date input `min`). */
export function reopenDateError(value: string, todayKey: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00`).getTime())) return "Ngày theo dạng YYYY-MM-DD";
  if (v < todayKey) return "Ngày mở lại không thể ở quá khứ";
  return null;
}

export function closePayload(mode: ClosingMode, reason: string, reopenDate: string) {
  return {
    operationalStatus: mode,
    reason: reason.trim(),
    ...(mode === "TEMPORARILY_CLOSED" && reopenDate.trim() ? { expectedReopenAt: reopenDate.trim() } : {}),
  };
}

/** One line under the branch title when it is not open (web's red status line). */
export function closedLine(g: { operationalStatus?: string | null; closureReason?: string | null; expectedReopenAt?: string | null }): string | null {
  if (!g.operationalStatus || g.operationalStatus === "OPEN") return null;
  const head = g.operationalStatus === "TEMPORARILY_CLOSED" ? "Đang tạm đóng cửa" : "Đã đóng cửa vĩnh viễn";
  const reason = g.closureReason ? ` — ${g.closureReason}` : "";
  const reopen =
    g.operationalStatus === "TEMPORARILY_CLOSED" && g.expectedReopenAt
      ? ` · Dự kiến mở lại: ${new Date(g.expectedReopenAt).toLocaleDateString("vi-VN")}`
      : "";
  return `${head}${reason}${reopen}`;
}
