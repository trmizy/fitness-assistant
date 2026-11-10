/**
 * Real Bug D follow-up (2026-10-23, user-designed feature) — lets a user
 * replace ONE exercise in their ALREADY-SAVED active WorkoutProgram via
 * chat ("thay bài child's pose bằng bài barbell row"). Before this, the
 * exact same phrase fell through to general LLM chat, which fabricated an
 * entirely invented weekly table and presented it as if applied — nothing
 * was ever persisted (see workout-guards.ts's doc comment for the full
 * incident). This module only PARSES the request and matches it against
 * the REAL saved program (pure, no I/O) — fitness-agent.service.ts does
 * the actual catalog lookup and PATCH write, through the existing
 * FitnessAgentAction propose/confirm/execute lifecycle.
 *
 * Day selection deliberately stays free-text ("chỉ buổi 2", "buổi 2 và 3")
 * instead of a new tick-box UI, per product decision to reuse existing
 * chat infra — the preview lists every day the old exercise appears in,
 * and parseDayFilter narrows that list on a follow-up message.
 */
import { normalizeAgentText } from "../fitness-agent-intent";

export interface ParsedSubstituteRequest { oldKeyword: string; newKeyword: string }

// "thay bài X bằng/thành/sang bài Y" / "đổi X thành Y". Deliberately
// excludes a bare ordinal ("thay bài 1 thành Y") — resolving "bài 1" needs
// a single unambiguous day context this parser doesn't have; that case
// falls through to the existing honest-refusal guard (workout-guards.ts),
// same documented-gap philosophy as extract-exercise-revision-keyword's
// own known residual gap.
const REPLACE_RE = /\b(?:thay\s+the|thay|doi)\b\s+(?:bai\s*(?:tap)?\s+)?(.+?)\s+(?:thanh|bang|sang)\s+(?:bai\s*(?:tap)?\s+)?(.+)/;

export function parseSubstituteSavedExerciseRequest(rawMessage: string): ParsedSubstituteRequest | null {
  // Accent stripping makes "bụng ĐÓI" collapse to "doi", the same token as "ĐỔI" (swap). Only treat "doi" as the verb when
  // the user did not literally write the accented "đói" (and no "đổi"), e.g. "Chạy bộ lúc bụng đói buổi sáng có đốt mỡ
  // nhiều hơn không?" was parsed as a swap of "buổi" for "có đốt mỡ nhiều hơn không" (eval B1-06, 2026-11-10).
  const lowered = rawMessage.toLowerCase();
  if (/đói/.test(lowered) && !/đổi/.test(lowered)) return null;
  const normalized = normalizeAgentText(rawMessage);
  const match = REPLACE_RE.exec(normalized);
  if (!match) return null;
  const oldKeyword = match[1].trim();
  const newKeyword = match[2].trim();
  if (!oldKeyword || !newKeyword) return null;
  // "buổi sáng" / "bữa sáng" is a time of day, not an exercise: "buoi" + "sang" must not read as "X sang Y".
  if (/^(?:buoi|bua)$/.test(oldKeyword)) return null;
  // A question is never a swap instruction ("... nhiều hơn không?", "... là gì?").
  if (/\b(?:khong|nhieu hon|bao nhieu|la gi|the nao)$/.test(newKeyword)) return null;
  // Sanity cap — same spirit as extractExerciseRevisionKeyword's word-count
  // guard: a real exercise name is short; a long leftover means this isn't
  // actually a named-exercise swap.
  if (oldKeyword.split(" ").length > 6 || newKeyword.split(" ").length > 6) return null;
  // A bare ordinal/number old-reference ("bai 1", "so 1") has no safe,
  // unambiguous day context here — leave it to the existing guard.
  if (/^(?:bai\s*)?(?:so\s*)?\d+$/.test(oldKeyword)) return null;
  return { oldKeyword, newKeyword };
}

const DAY_FILTER_RE = /\bbuoi\s*(?:so\s*)?(\d+)\b/g;

/** "chỉ buổi 2", "buổi 2 và 3" — narrows a pending preview's day list. Returns null when the message names no day at all. */
export function parseDayFilter(rawMessage: string): number[] | null {
  const normalized = normalizeAgentText(rawMessage);
  const nums = new Set<number>();
  for (const m of normalized.matchAll(DAY_FILTER_RE)) nums.add(Number(m[1]));
  return nums.size ? [...nums].sort((a, b) => a - b) : null;
}

export interface ProgramExerciseOccurrence {
  programExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  dayNumber: number;
  dayTitle?: string;
}

export type FindOccurrencesResult =
  | { kind: "none" }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "found"; occurrences: ProgramExerciseOccurrence[] };

/**
 * Scans the raw /workouts/programs/current response (fetchCurrentProgram's
 * return value — real Prisma rows, unmapped) for every day containing an
 * exercise whose name matches `oldKeyword`. If the match set spans more
 * than one DISTINCT real exercise (e.g. "press" matching both "Overhead
 * Press" and "Bench Press"), this refuses to guess and asks the caller to
 * be more specific instead of silently touching the wrong one.
 */
export function findOccurrencesByName(program: any, oldKeyword: string): FindOccurrencesResult {
  const needle = normalizeAgentText(oldKeyword);
  const days = Array.isArray(program?.days) ? program.days : [];
  const all: ProgramExerciseOccurrence[] = [];
  for (const day of days) {
    const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
    for (const ex of exercises) {
      const name: string = ex?.exercise?.exerciseName ?? ex?.exerciseName ?? "";
      if (!name || !ex?.id) continue;
      const normalizedName = normalizeAgentText(name);
      if (normalizedName === needle || normalizedName.includes(needle) || needle.includes(normalizedName)) {
        all.push({
          programExerciseId: ex.id, exerciseId: ex.exerciseId ?? ex.exercise?.id,
          exerciseName: name, dayNumber: Number(day?.dayNumber ?? 0), dayTitle: day?.title,
        });
      }
    }
  }
  if (!all.length) return { kind: "none" };
  const exact = all.filter((o) => normalizeAgentText(o.exerciseName) === needle);
  const pool = exact.length ? exact : all;
  const distinctIds = [...new Set(pool.map((o) => o.exerciseId))];
  if (distinctIds.length > 1) {
    const names = [...new Set(pool.map((o) => o.exerciseName))];
    return { kind: "ambiguous", names };
  }
  return { kind: "found", occurrences: pool };
}
