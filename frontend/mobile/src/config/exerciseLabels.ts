/**
 * Vietnamese labels for the exercise catalog's enums, copied verbatim from web's
 * `pages/client/library/ExerciseLibraryPage.tsx` so the two apps never disagree about what an
 * enum value is called. These are presentation only — the wire values are the enums themselves,
 * and every lookup below falls back to the raw value rather than hiding an unmapped one.
 */

export const BODY_PART_LABELS: Record<string, string> = {
  UPPER_BODY: "Thân trên",
  LOWER_BODY: "Thân dưới",
  CORE: "Bụng/Core",
  FULL_BODY: "Toàn thân",
};

export const LOGGING_MODE_LABELS: Record<string, string> = {
  REPS_LOAD: "Số lần x Tạ",
  BODYWEIGHT_REPS: "Trọng lượng cơ thể",
  TIME: "Thời gian",
  TIME_LOAD: "Thời gian + Tạ",
  DISTANCE_TIME: "Quãng đường + Thời gian",
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Mới bắt đầu",
  intermediate: "Trung cấp",
  expert: "Nâng cao",
};

export function bodyPartLabel(value?: string | null): string {
  if (!value) return "—";
  // Case-insensitive on purpose: the exercise catalog sends `bodyPart` as UPPER_BODY, but the muscle
  // taxonomy sends the same enum as `anatomyRegion` in lowercase (core, full_body, lower_body…).
  // Seen on device: an exact-key lookup fell through to the raw value, and the section header's
  // `uppercase` class then made "full_body" look like an unmapped "FULL_BODY".
  return BODY_PART_LABELS[value.toUpperCase()] ?? value;
}

export function loggingModeLabel(value?: string | null): string {
  if (!value) return "—";
  return LOGGING_MODE_LABELS[value] ?? value;
}

export function difficultyLabel(value?: string | null): string {
  if (!value) return "";
  return DIFFICULTY_LABELS[String(value).toLowerCase()] ?? String(value);
}

/** `BARBELL_PLATE` → `barbell plate`, matching web's inline transform. */
export function equipmentLabel(value?: string | null): string {
  if (!value) return "—";
  return String(value).replace(/_/g, " ").toLowerCase();
}

/** The catalog page size web uses; kept identical so paging boundaries line up between apps. */
export const EXERCISE_PAGE_SIZE = 24;
