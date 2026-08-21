/**
 * The one list of PT specialties.
 *
 * These strings are stored verbatim in `UserProfile.specialties` and are what the free-text
 * PT search matches against, so they are data, not labels — renaming one here without
 * migrating the column would orphan every trainer who had picked it.
 *
 * Vietnamese, because everything else the user reads is Vietnamese and the search is expected
 * to work when they type what they see. An English value like "Muscle Gain" meant a user
 * typing "tang co" — the obvious thing to type — found nothing, while the accent-insensitive
 * search worked perfectly on data nobody had.
 *
 * They were defined in three separate places before (the application form, the discovery
 * filter chips, and the filter's parallel value array), which is how the form's fourteen
 * options and the filter's six drifted apart.
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

/**
 * Old English values → the Vietnamese ones above.
 *
 * Kept after the data migration so a stale cached bundle, a half-filled draft application, or
 * a row the migration missed still resolves to something real instead of silently dropping
 * out of every filter.
 */
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

/** The six shown as quick filter chips on the discovery page, plus "all". */
export const QUICK_FILTERS: readonly string[] = [
  "Giảm mỡ",
  "Tăng cơ",
  "Powerlifting",
  "Yoga",
  "HIIT",
  "Thể hình",
];
