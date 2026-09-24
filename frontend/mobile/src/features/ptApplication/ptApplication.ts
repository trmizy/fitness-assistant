/**
 * CL-22 — pure parts of "Ứng tuyển Huấn luyện viên" (web's PTApplicationPage + the server's own
 * submit() checks in user-service pt_application.service.ts). Every per-step check mirrors a rule
 * the server enforces at submit time, so the step bar never says "done" for a step the server
 * would reject.
 */
import type { PTApplication, PTApplicationStatus, PTApplicationTrainingLocation, PTAvailabilityBlock } from "../../services/api";

export const STEPS = [
  { key: "personal", title: "Thông tin cá nhân", desc: "Số điện thoại, giấy tờ, địa chỉ hiện tại" },
  { key: "identity", title: "Xác thực danh tính", desc: "CCCD mặt trước, mặt sau & ảnh chân dung" },
  { key: "experience", title: "Kinh nghiệm", desc: "Số năm & quá trình huấn luyện" },
  { key: "certs", title: "Chứng chỉ", desc: "Bằng cấp, chứng chỉ chuyên môn" },
  { key: "focus", title: "Hướng huấn luyện", desc: "Chuyên môn và học viên bạn theo đuổi" },
  { key: "availability", title: "Dịch vụ & Lịch", desc: "Hình thức, giá, lịch rảnh, nơi tập" },
  { key: "portfolio", title: "Portfolio", desc: "Mạng xã hội & hình ảnh minh chứng (tuỳ chọn)" },
  { key: "review", title: "Xem lại & Nộp", desc: "Kiểm tra thông tin trước khi gửi" },
] as const;

export const EXPERIENCE_OPTIONS = [
  { value: "<1", label: "Dưới 1 năm" },
  { value: "1-3", label: "1 - 3 năm" },
  { value: "3-5", label: "3 - 5 năm" },
  { value: "5-10", label: "5 - 10 năm" },
  { value: "10+", label: "Hơn 10 năm" },
];

// Stored verbatim (English) exactly as web stores them — only the label shown here is Vietnamese.
export const TARGET_OPTIONS: { value: string; label: string }[] = [
  { value: "Beginners", label: "Người mới tập" },
  { value: "Weight-loss clients", label: "Người muốn giảm cân" },
  { value: "Postpartum women", label: "Phụ nữ sau sinh" },
  { value: "Advanced trainees", label: "Người tập lâu năm" },
  { value: "Office workers", label: "Dân văn phòng" },
  { value: "Athletes", label: "Vận động viên" },
  { value: "Rehab clients", label: "Người cần phục hồi" },
  { value: "Seniors", label: "Người cao tuổi" },
  { value: "Teens / Youth", label: "Thanh thiếu niên" },
  { value: "Competitive bodybuilders", label: "VĐV thể hình thi đấu" },
];

export const GOAL_OPTIONS: { value: string; label: string }[] = [
  { value: "Fat Loss & Body Recomposition", label: "Giảm mỡ & tái cấu trúc cơ thể" },
  { value: "Muscle Building & Hypertrophy", label: "Tăng cơ" },
  { value: "Strength & Powerlifting", label: "Sức mạnh & Powerlifting" },
  { value: "Rehabilitation & Injury Recovery", label: "Phục hồi chấn thương" },
  { value: "Sports Performance", label: "Thành tích thể thao" },
  { value: "General Fitness & Health", label: "Thể lực & sức khoẻ chung" },
];

export const SERVICE_MODES = [
  { value: "ONLINE", label: "Online", desc: "Huấn luyện qua video call" },
  { value: "OFFLINE", label: "Trực tiếp", desc: "Tại phòng gym / địa điểm" },
  { value: "HYBRID", label: "Kết hợp", desc: "Cả online và trực tiếp" },
] as const;

export const DURATIONS = [30, 45, 60, 90];

export const DAYS = [
  { value: "Mon", label: "Thứ 2", short: "T2" },
  { value: "Tue", label: "Thứ 3", short: "T3" },
  { value: "Wed", label: "Thứ 4", short: "T4" },
  { value: "Thu", label: "Thứ 5", short: "T5" },
  { value: "Fri", label: "Thứ 6", short: "T6" },
  { value: "Sat", label: "Thứ 7", short: "T7" },
  { value: "Sun", label: "Chủ nhật", short: "CN" },
];
const dayLabel = (d: string) => DAYS.find((x) => x.value === d)?.label ?? d;

export const STATUS_META: Record<PTApplicationStatus | "NONE", { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  NONE: { label: "Chưa đăng ký", tone: "neutral" },
  DRAFT: { label: "Bản nháp", tone: "neutral" },
  SUBMITTED: { label: "Đã nộp", tone: "info" },
  UNDER_REVIEW: { label: "Đang xét duyệt", tone: "warning" },
  NEEDS_MORE_INFO: { label: "Cần bổ sung", tone: "warning" },
  APPROVED: { label: "Được duyệt", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
};

/** Which view a status gets: the wizard (editable) or the status page. */
export function applicationView(status: PTApplicationStatus | null | undefined): "wizard" | "status" {
  return !status || status === "DRAFT" ? "wizard" : "status";
}

// ── Form state ─────────────────────────────────────────────────────────────────────────

export type LocForm = { provinceCode: string; wardCode: string; gymName: string; addressLine: string; isPrimary: boolean; note: string };
export const EMPTY_LOC: LocForm = { provinceCode: "", wardCode: "", gymName: "", addressLine: "", isPrimary: false, note: "" };
export const EMPTY_CERT = { certificateName: "", issuingOrganization: "", isCurrentlyValid: true, certificationStatus: "Valid" };

export function emptyApplication(): PTApplication {
  return {
    mainSpecialties: [],
    targetClientGroups: [],
    primaryTrainingGoals: [],
    availabilityBlocks: [],
    sessionDurationMinutes: 60,
    certificates: [{ ...EMPTY_CERT }],
    media: [],
    applicationTrainingLocations: [],
  };
}

/** Hydrate once from the server (web's hydratedRef rule: later saves never overwrite typing). */
export function formFromServer(app: PTApplication | null): { form: PTApplication; locations: LocForm[] } {
  const base = emptyApplication();
  if (!app) return { form: base, locations: [{ ...EMPTY_LOC, isPrimary: true }] };
  const form: PTApplication = {
    ...base,
    ...app,
    mainSpecialties: app.mainSpecialties ?? [],
    targetClientGroups: app.targetClientGroups ?? [],
    primaryTrainingGoals: app.primaryTrainingGoals ?? [],
    availabilityBlocks: app.availabilityBlocks ?? [],
    sessionDurationMinutes: app.sessionDurationMinutes || 60,
    certificates: app.certificates?.length ? app.certificates : [{ ...EMPTY_CERT }],
    media: app.media ?? [],
  };
  const saved = app.applicationTrainingLocations ?? [];
  const locations = saved.length
    ? saved.map((l, i) => ({
        provinceCode: l.provinceCode != null ? String(l.provinceCode) : "",
        wardCode: l.wardCode != null ? String(l.wardCode) : "",
        gymName: l.gymName ?? "",
        addressLine: l.addressLine ?? "",
        isPrimary: l.isPrimary ?? i === 0,
        note: l.note ?? "",
      }))
    : [{ ...EMPTY_LOC, isPrimary: true }];
  return { form, locations };
}

/** Same filter the server applies: a province plus a gym name or an address. */
export function validLocations(locs: LocForm[]): PTApplicationTrainingLocation[] {
  const kept = locs.filter((l) => l.provinceCode && (l.gymName.trim() || l.addressLine.trim()));
  const primaryIdx = Math.max(0, kept.findIndex((l) => l.isPrimary));
  return kept.map((l, i) => ({
    provinceCode: Number(l.provinceCode),
    wardCode: l.wardCode ? Number(l.wardCode) : undefined,
    gymName: l.gymName.trim() || undefined,
    addressLine: l.addressLine.trim() || undefined,
    isPrimary: i === primaryIdx,
    note: l.note.trim() || undefined,
  }));
}

/** Body for POST /pt-applications/me/draft — the form plus the cleaned training locations. */
export function draftPayload(form: PTApplication, locs: LocForm[]): Partial<PTApplication> {
  const { id: _id, status: _status, adminNote: _a, rejectionReason: _r, submittedAt: _s, reviewedAt: _v, ...rest } = form;
  const certificates = (form.certificates ?? []).filter((c) => c.certificateName.trim() || c.issuingOrganization.trim() || c.certificateFileUrl);
  return { ...rest, certificates, availableDays: [...new Set((form.availabilityBlocks ?? []).map((b) => b.dayOfWeek))], applicationTrainingLocations: validLocations(locs) };
}

// ── Availability ───────────────────────────────────────────────────────────────────────

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMinutes = (mins: number) => {
  const w = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, "0")}:${String(w % 60).padStart(2, "0")}`;
};

/** Web's addBlockForDay: 08:00 first; a further block starts an hour after that day's last end. */
export function addBlock(blocks: PTAvailabilityBlock[], day: string, sessionMinutes: number): PTAvailabilityBlock[] {
  const sameDay = blocks.filter((b) => b.dayOfWeek === day);
  const width = Math.max(sessionMinutes || 60, 60);
  const start = sameDay.length ? fromMinutes(Math.max(...sameDay.map((b) => toMinutes(b.endTime))) + 60) : "08:00";
  return [...blocks, { dayOfWeek: day, startTime: start, endTime: fromMinutes(toMinutes(start) + width) }];
}

export function isTime(v: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Web's validateAvailability: at least one block, valid order, no overlap, each fits one session. */
export function availabilityError(blocks: PTAvailabilityBlock[], sessionMinutes: number): string | null {
  if (!blocks.length) return "Thêm ít nhất một khung giờ rảnh.";
  for (const b of blocks) {
    if (!isTime(b.startTime) || !isTime(b.endTime)) return `Giờ ở ${dayLabel(b.dayOfWeek)} chưa đúng dạng HH:MM.`;
    if (b.startTime >= b.endTime) return `Giờ bắt đầu phải trước giờ kết thúc (${dayLabel(b.dayOfWeek)}).`;
  }
  for (const d of DAYS) {
    const day = blocks.filter((b) => b.dayOfWeek === d.value).sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < day.length - 1; i += 1) if (day[i].endTime > day[i + 1].startTime) return `Khung giờ ${d.label} bị trùng nhau.`;
  }
  const dur = sessionMinutes || 60;
  for (const b of blocks) {
    const w = toMinutes(b.endTime) - toMinutes(b.startTime);
    if (w > 0 && w < dur) return `Khung ${dayLabel(b.dayOfWeek)} ${b.startTime}-${b.endTime} ngắn hơn một buổi ${dur} phút — học viên sẽ không đặt được.`;
  }
  return null;
}

// ── Step checks (server submit() rules, checked where the field is entered) ──────────────

const pos = (n: number | null | undefined) => typeof n === "number" && n > 0;

export function pricingError(f: PTApplication): string | null {
  const mode = f.serviceMode;
  if (!mode) return "Chọn hình thức dịch vụ.";
  if ((mode === "ONLINE" || mode === "HYBRID") && !pos(f.onlinePricePerSession)) return "Nhập giá Online mỗi buổi (> 0).";
  if ((mode === "OFFLINE" || mode === "HYBRID") && !pos(f.offlinePricePerSession)) return "Nhập giá trực tiếp mỗi buổi (> 0).";
  for (const v of [f.onlinePackagePrice, f.offlinePackagePrice]) if (v != null && v <= 0) return "Giá gói phải lớn hơn 0.";
  if ((pos(f.onlinePackagePrice) || pos(f.offlinePackagePrice)) && !pos(f.sessionsPerPackage)) return "Có giá gói thì cần nhập số buổi trong gói.";
  return null;
}

export function stepError(step: number, f: PTApplication, locs: LocForm[]): string | null {
  switch (STEPS[step]?.key) {
    case "personal":
      if (!f.phoneNumber?.trim()) return "Nhập số điện thoại.";
      if (!f.nationalIdNumber?.trim()) return "Nhập số CCCD / hộ chiếu.";
      if (!f.currentAddress?.trim()) return "Nhập địa chỉ hiện tại.";
      return null;
    case "identity":
      return f.idCardFrontUrl && f.idCardBackUrl && f.portraitPhotoUrl ? null : "Tải lên đủ CCCD mặt trước, mặt sau và ảnh chân dung.";
    case "experience":
      return f.yearsOfExperience ? null : "Chọn số năm kinh nghiệm.";
    case "focus":
      return f.mainSpecialties.length ? null : "Chọn ít nhất một chuyên môn.";
    case "availability": {
      const p = pricingError(f);
      if (p) return p;
      const a = availabilityError(f.availabilityBlocks ?? [], f.sessionDurationMinutes ?? 60);
      if (a) return a;
      if ((f.serviceMode === "OFFLINE" || f.serviceMode === "HYBRID") && validLocations(locs).length === 0) {
        return "Dịch vụ trực tiếp cần ít nhất 1 nơi tập hợp lệ (chọn tỉnh/thành và tên phòng gym hoặc địa chỉ).";
      }
      return null;
    }
    default:
      return null;
  }
}

/** First step (index) whose check fails, or -1 — the "Xem lại" screen jumps there. */
export function firstInvalidStep(f: PTApplication, locs: LocForm[]): number {
  for (let i = 0; i < STEPS.length; i += 1) if (stepError(i, f, locs)) return i;
  return -1;
}

/** Server errors are English sentences for some rules ("Missing required field for submission: x"). */
export function submitErrorMessage(e: any): string {
  const raw = String(e?.response?.data?.error ?? e?.message ?? "");
  const field = raw.match(/Missing required field for submission: (\w+)/)?.[1];
  const FIELD: Record<string, string> = {
    phoneNumber: "số điện thoại",
    nationalIdNumber: "số CCCD",
    currentAddress: "địa chỉ",
    idCardFrontUrl: "ảnh CCCD mặt trước",
    idCardBackUrl: "ảnh CCCD mặt sau",
    portraitPhotoUrl: "ảnh chân dung",
    yearsOfExperience: "số năm kinh nghiệm",
    serviceMode: "hình thức dịch vụ",
  };
  if (field) return `Còn thiếu ${FIELD[field] ?? field}.`;
  if (/specialty/i.test(raw)) return "Chọn ít nhất một chuyên môn.";
  if (/already/i.test(raw)) return "Đơn đã được nộp hoặc đang xử lý.";
  if (/[À-ỹ]/.test(raw)) return raw;
  return "Nộp đơn thất bại. Kiểm tra các mục bắt buộc rồi thử lại.";
}
