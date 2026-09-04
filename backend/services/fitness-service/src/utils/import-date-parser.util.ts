/**
 * Roadmap P2 "Canonical import framework" (docs/features/
 * CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md +
 * docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * Provider-agnostic best-effort date parse, returning just the
 * YYYY-MM-DD calendar-day label (matching this codebase's own
 * convention — see schedule-lock.util.ts's module doc comment — of
 * treating a workout's date as a bare calendar-day label, not a
 * re-interpreted timezone instant). Returns null if genuinely
 * unparseable, so the caller can report a real row error instead of
 * guessing a date.
 *
 * Deliberately NEVER delegates to `new Date(someNonIsoString)` — for a
 * date-only (no explicit offset) string, JS's built-in parser treats it
 * as LOCAL midnight (implementation-defined for non-ISO formats), and
 * `.toISOString()` then converts that through the RUNNING PROCESS's own
 * timezone — on a host/container set to a positive UTC offset, that
 * silently shifts the date back a day. A first version of Hevy import's
 * date parser did exactly that and was caught by its own unit test (a
 * real bug of the exact same class already documented elsewhere in this
 * codebase re: Prisma + naive timestamps — see the roadmap's "Smart
 * set-by-set prefill" status-board entry). Every format below extracts
 * literal digits/month-names via regex and builds the label directly —
 * no ambient-timezone-dependent Date parsing at all.
 */

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseFlexibleDateToLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "2024-01-08" / "2024-01-08 09:15:00" / "2024-01-08T09:15:00[Z]"
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d}`;
  }

  // "8 Jan 2024" / "8 Jan 2024, 09:15"
  const dayMonYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (dayMonYear) {
    const [, day, monthName, year] = dayMonYear;
    const monthIndex = MONTH_NAMES.indexOf(monthName.slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${year}-${pad2(monthIndex + 1)}-${pad2(Number(day))}`;
  }

  // "Jan 8, 2024" / "Jan 8 2024, 09:15"
  const monDayYear = trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (monDayYear) {
    const [, monthName, day, year] = monDayYear;
    const monthIndex = MONTH_NAMES.indexOf(monthName.slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${year}-${pad2(monthIndex + 1)}-${pad2(Number(day))}`;
  }

  // "01/08/2024" (assumed MM/DD/YYYY, matching Hevy/Strong's US-default export locale)
  const slashDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashDate) {
    const [, mm, dd, yyyy] = slashDate;
    return `${yyyy}-${pad2(Number(mm))}-${pad2(Number(dd))}`;
  }

  return null;
}
