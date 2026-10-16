/**
 * CL-12 — the buyer's side of a 1-1 personalized service order, ported from web's
 * `PersonalizedServiceOrderPage.tsx` and checked against ai-service's
 * `personalized-service.service.ts` (the state machine is the server's; nothing here advances it).
 *
 * The enum has 16 statuses (doc 03 says 18 — the code is authoritative). The design groups them
 * into a 4-step timeline; every status maps onto exactly one step or onto an off-track state
 * (cancelled/refund/dispute) so no order can render as "nowhere".
 */
import type { PersonalizedServiceOrderStatus } from "../../services/api";

export const ORDER_STATUS_LABEL: Record<PersonalizedServiceOrderStatus, string> = {
  PENDING_PAYMENT: "Chờ xác nhận thanh toán",
  PURCHASED: "Đã mua",
  INTAKE_PENDING: "Chờ điền phiếu Intake",
  INTAKE_SUBMITTED: "Đã gửi phiếu — chờ PT xem",
  PT_REVIEWING: "PT đang phân tích",
  IN_PROGRESS: "PT đang soạn giáo án",
  DRAFT_DELIVERED: "PT đã gửi bản nháp",
  REVISION_REQUESTED: "Đã yêu cầu chỉnh sửa",
  REVISION_IN_PROGRESS: "PT đang chỉnh sửa",
  ACCEPTED: "Đã chấp nhận",
  ACTIVE: "Đang đồng hành",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã huỷ",
  REFUND_REQUESTED: "Đang yêu cầu hoàn tiền",
  REFUNDED: "Đã hoàn tiền",
  DISPUTED: "Đang khiếu nại",
};

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export function orderStatusTone(status: PersonalizedServiceOrderStatus): Tone {
  switch (status) {
    case "COMPLETED":
    case "ACCEPTED":
    case "ACTIVE":
      return "success";
    case "REVISION_REQUESTED":
    case "REFUND_REQUESTED":
    case "PENDING_PAYMENT":
      return "warning";
    case "DISPUTED":
    case "CANCELLED":
      return "danger";
    case "REFUNDED":
      return "neutral";
    default:
      return "info";
  }
}

export const ORDER_TIMELINE = [
  { key: "INTAKE", label: "Điền phiếu Intake" },
  { key: "PT_WORK", label: "PT đang soạn giáo án" },
  { key: "DRAFT", label: "Nhận bản nháp" },
  { key: "ACTIVE", label: "Đồng hành & check-in" },
] as const;

/**
 * Index of the CURRENT timeline step (0..3), `4` once completed, or `null` for an order that is
 * off the happy path (awaiting payment, cancelled, refund/dispute) — those render a banner instead.
 */
export function timelineIndex(status: PersonalizedServiceOrderStatus): number | null {
  switch (status) {
    case "PURCHASED":
    case "INTAKE_PENDING":
      return 0;
    case "INTAKE_SUBMITTED":
    case "PT_REVIEWING":
    case "IN_PROGRESS":
      return 1;
    case "DRAFT_DELIVERED":
    case "REVISION_REQUESTED":
    case "REVISION_IN_PROGRESS":
      return 2;
    case "ACCEPTED":
    case "ACTIVE":
      return 3;
    case "COMPLETED":
      return 4;
    default:
      return null;
  }
}

export function timelineHint(status: PersonalizedServiceOrderStatus): string | null {
  switch (status) {
    case "INTAKE_PENDING":
    case "PURCHASED":
      return "Chọn dữ liệu chia sẻ với PT";
    case "INTAKE_SUBMITTED":
      return "PT sẽ bắt đầu xem phiếu của bạn";
    case "PT_REVIEWING":
    case "IN_PROGRESS":
      return "PT đang soạn giáo án riêng cho bạn";
    case "DRAFT_DELIVERED":
      return "Xem bản nháp, chấp nhận hoặc yêu cầu sửa";
    case "REVISION_REQUESTED":
    case "REVISION_IN_PROGRESS":
      return "PT sẽ gửi lại bản chỉnh sửa";
    case "ACCEPTED":
    case "ACTIVE":
      return "Check-in mỗi tuần để PT theo dõi tiến độ";
    default:
      return null;
  }
}

/** Server's cancelOrder set, exactly: "PT chưa bắt đầu làm việc" (§XXXII). */
export const CANCELLABLE = new Set<PersonalizedServiceOrderStatus>([
  "PENDING_PAYMENT",
  "PURCHASED",
  "INTAKE_PENDING",
  "INTAKE_SUBMITTED",
]);

const CLOSED = new Set<PersonalizedServiceOrderStatus>(["CANCELLED", "REFUNDED", "COMPLETED"]);
const FLAGGED = new Set<PersonalizedServiceOrderStatus>(["REFUND_REQUESTED", "DISPUTED"]);

export function canCancel(status: PersonalizedServiceOrderStatus): boolean {
  return CANCELLABLE.has(status);
}

/**
 * After the PT started, a refund is a REQUEST an admin decides (never automatic). Before that the
 * right action is cancel (automatic full refund), so refund is not offered there — same split as
 * the web and the design. The server itself would also accept it earlier; the UI keeps one door
 * per situation.
 */
export function canRequestRefund(status: PersonalizedServiceOrderStatus): boolean {
  return !CANCELLABLE.has(status) && !CLOSED.has(status) && !FLAGGED.has(status);
}

/**
 * A separate door from refund (the web merges them into one button; the backend has two endpoints,
 * and the design shows two). `openDispute` has no status guard server-side, so the UI is the only
 * thing keeping it off orders where a dispute is meaningless (unpaid, closed, already flagged).
 */
export function canDispute(status: PersonalizedServiceOrderStatus): boolean {
  return status !== "PENDING_PAYMENT" && !CLOSED.has(status) && !FLAGGED.has(status);
}

export function isPtWorking(status: PersonalizedServiceOrderStatus): boolean {
  return ["INTAKE_SUBMITTED", "PT_REVIEWING", "IN_PROGRESS", "REVISION_REQUESTED", "REVISION_IN_PROGRESS"].includes(status);
}

export function revisionsLabel(order: { revisionCount?: number; revisionLimitSnapshot?: number | null }): string {
  if (order.revisionLimitSnapshot == null) return "Chỉnh sửa không giới hạn";
  const left = Math.max(0, order.revisionLimitSnapshot - (order.revisionCount ?? 0));
  return `Còn ${left}/${order.revisionLimitSnapshot} lượt yêu cầu chỉnh sửa`;
}

export function canRequestRevision(order: {
  status: PersonalizedServiceOrderStatus;
  revisionCount?: number;
  revisionLimitSnapshot?: number | null;
}): boolean {
  if (order.status !== "DRAFT_DELIVERED") return false;
  if (order.revisionLimitSnapshot == null) return true;
  return (order.revisionCount ?? 0) < order.revisionLimitSnapshot;
}

export const REVISION_CATEGORIES = [
  { value: "EXERCISE", label: "Bài tập" },
  { value: "SCHEDULE", label: "Lịch tập" },
  { value: "DIFFICULTY", label: "Độ khó" },
  { value: "EQUIPMENT", label: "Thiết bị" },
  { value: "NUTRITION", label: "Dinh dưỡng" },
  { value: "OTHER", label: "Khác" },
];

export const GOAL_OPTIONS = [
  { value: "MUSCLE_GAIN", label: "Tăng cơ" },
  { value: "WEIGHT_LOSS", label: "Giảm mỡ" },
  { value: "MAINTENANCE", label: "Duy trì vóc dáng" },
  { value: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao" },
];
export const EXPERIENCE_OPTIONS = [
  { value: "BEGINNER", label: "Mới bắt đầu" },
  { value: "INTERMEDIATE", label: "Đã biết tập" },
  { value: "ADVANCED", label: "Nâng cao" },
];
export const GENDER_OPTIONS = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
];
export const INTAKE_LOCATION_OPTIONS = [
  { value: "GYM", label: "Phòng gym" },
  { value: "HOME", label: "Tại nhà" },
  { value: "BOTH", label: "Cả hai" },
];
export const DEFAULT_CONSENT = ["basic_info", "training_goals", "experience"];

export function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export type IntakeForm = {
  age: string;
  gender: string;
  heightCm: string;
  weight: string;
  targetWeight: string;
  goal: string;
  experienceLevel: string;
  injuries: string;
  daysPerWeek: string;
  trainingLocation: string;
  notes: string;
};

export function emptyIntake(): IntakeForm {
  return {
    age: "",
    gender: "",
    heightCm: "",
    weight: "",
    targetWeight: "",
    goal: "",
    experienceLevel: "",
    injuries: "",
    daysPerWeek: "4",
    trainingLocation: "GYM",
    notes: "",
  };
}

/** Pre-fill from the saved profile (only what Onboarding/Profile already collected). */
export function intakeFromProfile(profile: any): IntakeForm {
  const form = emptyIntake();
  if (!profile) return form;
  if (profile.age) form.age = String(profile.age);
  if (profile.gender) form.gender = String(profile.gender);
  if (profile.heightCm) form.heightCm = String(profile.heightCm);
  if (profile.currentWeight) form.weight = String(profile.currentWeight);
  if (profile.targetWeight) form.targetWeight = String(profile.targetWeight);
  if (profile.goal) form.goal = String(profile.goal);
  if (profile.experienceLevel) form.experienceLevel = String(profile.experienceLevel);
  if (Array.isArray(profile.injuries)) form.injuries = profile.injuries.join(", ");
  return form;
}

/** Same payload web sends: numbers parsed, blanks omitted, injuries split on commas. */
export function buildIntakePayload(form: IntakeForm, consent: string[]) {
  const num = (v: string) => (v.trim() ? Number(v) : undefined);
  return {
    intakeData: {
      age: num(form.age),
      gender: form.gender || undefined,
      heightCm: num(form.heightCm),
      weight: num(form.weight),
      targetWeight: num(form.targetWeight),
      goal: form.goal || undefined,
      experienceLevel: form.experienceLevel || undefined,
      daysPerWeek: Number(form.daysPerWeek),
      trainingLocation: form.trainingLocation,
      injuries: form.injuries
        ? form.injuries.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      notes: form.notes.trim() || undefined,
    },
    consentCategories: [...consent],
  };
}

export function intakeBlockedReason(form: IntakeForm, consent: string[]): string | null {
  if (consent.length === 0) return "Chọn ít nhất 1 nhóm dữ liệu để chia sẻ với PT.";
  const days = Number(form.daysPerWeek);
  if (!Number.isInteger(days) || days < 1 || days > 7) return "Số ngày tập mỗi tuần phải từ 1 đến 7.";
  for (const [key, label] of [
    ["age", "Tuổi"],
    ["heightCm", "Chiều cao"],
    ["weight", "Cân nặng"],
    ["targetWeight", "Cân nặng mục tiêu"],
  ] as const) {
    const v = form[key].trim();
    if (v && !(Number(v) > 0)) return `${label} phải là số dương.`;
  }
  return null;
}

export type CheckInForm = {
  energyLevel: number;
  sleepQuality: number;
  stressLevel: number;
  painOrDiscomfort: number;
  overallRpe: string;
  workoutAdherence: string;
  nutritionAdherence: string;
  notes: string;
};

export function defaultCheckIn(): CheckInForm {
  return {
    energyLevel: 3,
    sleepQuality: 3,
    stressLevel: 3,
    painOrDiscomfort: 0,
    overallRpe: "7",
    workoutAdherence: "100",
    nutritionAdherence: "100",
    notes: "",
  };
}

export function checkInBlockedReason(form: CheckInForm): string | null {
  const rpe = Number(form.overallRpe);
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return "RPE phải từ 1 đến 10.";
  for (const [v, label] of [
    [form.workoutAdherence, "Tuân thủ tập"],
    [form.nutritionAdherence, "Tuân thủ ăn"],
  ] as const) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return `${label} phải từ 0 đến 100%.`;
  }
  return null;
}

export function buildCheckInPayload(form: CheckInForm) {
  return {
    energyLevel: form.energyLevel,
    sleepQuality: form.sleepQuality,
    stressLevel: form.stressLevel,
    overallRpe: Number(form.overallRpe),
    workoutAdherence: Number(form.workoutAdherence),
    nutritionAdherence: Number(form.nutritionAdherence),
    painOrDiscomfort: form.painOrDiscomfort,
    notes: form.notes.trim() || undefined,
  };
}

/** Distinct exerciseIds in a draft — its days hold ids only; names come from the catalog. */
export function draftExerciseIds(draft: any): string[] {
  const days: any[] = Array.isArray(draft?.days) ? draft.days : [];
  return [
    ...new Set(
      days.flatMap((d) => (Array.isArray(d?.exercises) ? d.exercises.map((e: any) => e?.exerciseId) : [])),
    ),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
}
