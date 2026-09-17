/**
 * The one list of PT specialties — ported verbatim from web's `constants/specialties.ts`.
 *
 * These strings are stored as-is in `UserProfile.specialties` and are what the PT search matches
 * against, so they are DATA, not labels: renaming one here without migrating the column would
 * orphan every trainer who picked it. The legacy map exists for rows the English→Vietnamese
 * migration missed, so a stale value still resolves to something real instead of dropping out of
 * every filter.
 */
export const SPECIALTIES = [
  "Tăng cơ",
  "Giảm mỡ",
  "Powerlifting",
  "Thể hình",
  "Calisthenics",
  "Yoga",
  "Phục hồi chấn thương",
  "Dinh dưỡng thể thao",
  "HIIT",
  "Functional Training",
  "Sức bền",
  "Dẻo dai & Vận động",
  "Thể thao thành tích",
  "Boxing & MMA",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export const LEGACY_SPECIALTY_MAP: Record<string, Specialty> = {
  "Muscle Gain": "Tăng cơ",
  "Fat Loss": "Giảm mỡ",
  Strength: "Powerlifting",
  Bodybuilding: "Thể hình",
  Rehabilitation: "Phục hồi chấn thương",
  "Sports Nutrition": "Dinh dưỡng thể thao",
  Endurance: "Sức bền",
  "Flexibility & Mobility": "Dẻo dai & Vận động",
  "Sports Performance": "Thể thao thành tích",
};

/** Normalises any stored value — new or legacy — to the current label. */
export function displaySpecialty(raw: string): string {
  return LEGACY_SPECIALTY_MAP[raw] ?? raw;
}

/**
 * The six quick-filter chips, plus "all". Web's list and the design's `QUICK_FILTERS` are the
 * same six in the same order — checked, not assumed.
 */
export const QUICK_FILTERS: readonly string[] = [
  "Giảm mỡ",
  "Tăng cơ",
  "Powerlifting",
  "Yoga",
  "HIIT",
  "Thể hình",
];
