/**
 * CL-18 "Chợ kế hoạch" — pure parts ported from web's `PlanMarketplacePage.tsx`.
 *
 * Three different products live in the market and must not blur together:
 *  - a published PLAN (free, or unlocked by a paid TrainingPackage) that the buyer ADOPTS into
 *    their own calendar — `POST /marketplace/plans/:id/adopt`;
 *  - a TrainingPackage, bought instantly from the CLIENT wallet (server-side wallet transfer);
 *  - a PersonalizedService (1-1), bought through a payment gateway — the order sits in
 *    PENDING_PAYMENT until the gateway webhook activates it (see personalizedOrder.ts).
 */
import type { PersonalizedServiceType, PublishedPlanListing } from "../../services/api";

export type MarketTab = "browse" | "pt-services" | "mine" | "buy-packages" | "my-orders";

/** The client's five tabs. Web's "Bán kế hoạch tập"/"Dịch vụ tôi cung cấp" are PT-only (PT-08/11). */
export const MARKET_TABS: { value: MarketTab; label: string }[] = [
  { value: "browse", label: "Miễn phí" },
  { value: "pt-services", label: "Dịch vụ PT" },
  { value: "buy-packages", label: "Gói tập PT" },
  { value: "mine", label: "Kế hoạch của tôi" },
  { value: "my-orders", label: "Đơn dịch vụ" },
];

export type BrowseSort = "recommended" | "recent" | "rating" | "quality";
export const SORT_OPTIONS: { value: BrowseSort; label: string }[] = [
  { value: "recommended", label: "Gợi ý cho bạn" },
  { value: "recent", label: "Mới nhất" },
  { value: "rating", label: "Đánh giá cao" },
  { value: "quality", label: "Điểm chất lượng" },
];

export const DURATION_FILTERS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "Mọi thời lượng" },
  { value: 4, label: "≤ 4 tuần" },
  { value: 8, label: "≤ 8 tuần" },
  { value: 12, label: "≤ 12 tuần" },
];

/** Web shows these in English; the product rule is Vietnamese labels for normal users. */
export const SERVICE_TYPE_LABELS: Record<PersonalizedServiceType, string> = {
  PERSONALIZED_WORKOUT: "Giáo án tập cá nhân hoá",
  PERSONALIZED_NUTRITION: "Tư vấn dinh dưỡng cá nhân hoá",
  WORKOUT_AND_NUTRITION: "Tập luyện + Dinh dưỡng",
  ONLINE_COACHING: "Huấn luyện online",
};

export const MODERATION_LABEL: Record<string, { label: string; tone: "neutral" | "info" | "success" | "danger" }> = {
  DRAFT: { label: "Nháp", tone: "neutral" },
  SUBMITTED: { label: "Chờ duyệt", tone: "info" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Bị từ chối", tone: "danger" },
};

export const COMPLAINT_TAG_LABEL: Record<string, string> = {
  too_hard: "Quá nặng",
  too_easy: "Quá dễ",
  equipment_mismatch: "Thiếu dụng cụ",
  unclear_instructions: "Hướng dẫn không rõ",
  boring: "Nhàm chán",
  time_commitment_too_high: "Tốn quá nhiều thời gian",
  not_matching_goal: "Không đúng mục tiêu",
  injury_risk: "Có nguy cơ chấn thương",
  other: "Khác",
};

export const DIFFICULTY_OPTIONS: { value: "too_easy" | "just_right" | "too_hard"; label: string }[] = [
  { value: "too_easy", label: "Quá dễ" },
  { value: "just_right", label: "Vừa sức" },
  { value: "too_hard", label: "Quá nặng" },
];

/** Sunday-first like `Date.getDay()` — the adopt endpoint takes these numbers as-is. */
export const ADOPT_WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function lowestPackagePrice(listing: Pick<PublishedPlanListing, "packages">): number | null {
  const packages = listing.packages ?? [];
  return packages.length > 0 ? Math.min(...packages.map((p) => p.price)) : null;
}

export function qualityScoreLabel(score: number | null | undefined): string | null {
  return score == null ? null : `${Math.round(score * 100)}/100`;
}

/** Web's default adopt pattern: every other day starting Monday (1, 3, 5, 0, …), `daysPerWeek` of them. */
export function defaultAdoptWeekdays(daysPerWeek: number): number[] {
  return Array.from({ length: daysPerWeek }, (_, i) => (i * 2 + 1) % 7);
}

export function toggleAdoptWeekday(selected: number[], weekday: number, limit: number): number[] {
  if (selected.includes(weekday)) return selected.filter((w) => w !== weekday);
  if (selected.length >= limit) return selected;
  return [...selected, weekday].sort((a, b) => a - b);
}

export type PreviewDay = {
  day: string;
  goal?: string;
  exercises: { exerciseId: string; name: string; sets: number; reps: string; restSeconds?: number }[];
  cardio?: string;
};

export const exerciseKey = (dayIdx: number, exIdx: number) => `${dayIdx}:${exIdx}`;

/**
 * The adopter's trimmed copy of the listing: excluded exercises dropped, sets overridden. Sent only
 * when something actually changed — the server then validates it against the listing (trim/adjust
 * only, same day count, no new exerciseIds).
 */
export function buildCustomizedSchedule(
  days: PreviewDay[],
  excluded: Set<string>,
  setsOverride: Record<string, number>,
) {
  const changed = excluded.size > 0 || Object.keys(setsOverride).length > 0;
  const customized = days.map((day, dayIdx) => ({
    day: day.day,
    exercises: day.exercises
      .map((ex, exIdx) => ({ ex, exIdx }))
      .filter(({ exIdx }) => !excluded.has(exerciseKey(dayIdx, exIdx)))
      .map(({ ex, exIdx }) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        sets: setsOverride[exerciseKey(dayIdx, exIdx)] ?? ex.sets,
        reps: ex.reps,
        restSeconds: ex.restSeconds,
      })),
  }));
  return {
    changed,
    customized: changed ? customized : undefined,
    emptyDay: changed && customized.some((d) => d.exercises.length === 0),
  };
}

export function adoptBlockedReason(input: {
  selectedWeekdays: number[];
  daysPerWeek: number;
  confirmedReplace: boolean;
  emptyDay: boolean;
}): string | null {
  if (input.selectedWeekdays.length !== input.daysPerWeek)
    return `Chọn đủ ${input.daysPerWeek} ngày tập trong tuần.`;
  if (input.emptyDay) return "Mỗi ngày cần giữ lại ít nhất 1 bài tập.";
  if (!input.confirmedReplace) return "Xác nhận thay thế chương trình tập hiện tại.";
  return null;
}

/** Adopt's 402 means "buy one of this listing's packages first" — not a generic failure. */
export function adoptErrorMessage(error: any): string {
  if (error?.response?.status === 402) return "Bạn cần mua gói trả phí của kế hoạch này trước khi áp dụng.";
  return error?.response?.data?.error?.message ?? "Không thể áp dụng kế hoạch này";
}

/** Republishing is offered on a live listing (iterate) and on a rejected one (fix & resubmit). */
export function canRepublish(status: string): boolean {
  return status === "APPROVED" || status === "REJECTED";
}
