/**
 * Phase 2 (AI plan) — deterministic understanding of two workout-DRAFT revisions that the generic weekday branch used to
 * mis-handle, destroying the draft:
 *   "Đổi buổi thứ 6 sang thứ 7"      (MOVE one session)  was read as "I can train on Fri and Sat" -> 4 sessions became 2
 *   "Thay buổi thứ 7 thành tập chân"  (REPLACE a session's focus) was read as "I can train on Sat" -> 4 sessions became 1
 * and the health-flavoured "Tôi bị đau chân, bỏ bài tập chân", whose whole phrase was taken as an exercise NAME and answered
 * with "the draft has nothing related, nothing to change" (a false reassurance).
 *
 * Pure functions over the diacritic-stripped, lower-cased text (`normalizeAgentText`), unit-testable without any I/O.
 * These extend the existing typed revision vocabulary (revision/types.ts: CHANGE_TRAINING_DAY); no new framework.
 */

const WEEKDAY = String.raw`(?:thu\s*([2-7])|t([2-7])|chu nhat|cn)`;
const WEEKDAY_ANY = new RegExp(String.raw`\b${WEEKDAY}\b`, "g");

/** Agent/JS weekday numbering: 0 = Sunday, 1 = Monday .. 6 = Saturday. */
function weekdayOf(m: RegExpMatchArray): number {
  const n = Number(m[1] ?? m[2]);
  return Number.isInteger(n) ? n - 1 : 0;
}

export type WorkoutSessionRequest =
  | { kind: "MOVE_SESSION"; from: number; to: number }
  | { kind: "REPLACE_SESSION_FOCUS"; from: number; focus: string };

const CUE = String.raw`(?:doi|chuyen|dich|di chuyen|doi lich|keo|doi cho|thay|move)`;
const OBJ = String.raw`(?:buoi|ngay|lich)?\s*(?:tap)?\s*(?:cua)?\s*`;
const MOVE_RE = new RegExp(String.raw`\b${CUE}\s+${OBJ}${WEEKDAY}\s+(?:sang|qua|vao|thanh|den|toi|bang|-+>|=>)\s*(?:ngay\s+)?${WEEKDAY}\b`);
const FOCUS_RE = new RegExp(String.raw`\b${CUE}\s+(?:buoi|ngay)\s+${WEEKDAY}\s+(?:thanh|sang|bang|qua)\s+(?:buoi\s+)?(.+)$`);

/**
 * Recognises "move a session to another weekday" and "make a session something else". Returns null for anything else —
 * in particular "Tôi tập được thứ 3, 5, 7" (a SELECTION of days) and "Thứ 4 tôi bận" (unavailability) are untouched.
 */
export function parseWorkoutSessionRequest(normalizedText: string): WorkoutSessionRequest | null {
  const s = normalizedText.replace(/[.,!?;]/g, " ").replace(/\s+/g, " ").trim();
  const move = s.match(MOVE_RE);
  if (move) {
    // MOVE_RE has two WEEKDAY groups: (1,2) = from, (3,4) = to
    const from = move[1] ?? move[2] ? Number(move[1] ?? move[2]) - 1 : 0;
    const to = move[3] ?? move[4] ? Number(move[3] ?? move[4]) - 1 : 0;
    return { kind: "MOVE_SESSION", from, to };
  }
  const focus = s.match(FOCUS_RE);
  if (focus) {
    const from = focus[1] ?? focus[2] ? Number(focus[1] ?? focus[2]) - 1 : 0;
    const rest = (focus[3] ?? "").trim();
    // "đổi thứ 6 sang 3 buổi" / "…sang 45 phút" are count/duration changes, and "… sang thứ 7" is a MOVE: not ours.
    if (!rest || /\d/.test(rest) || new RegExp(String.raw`^(?:ngay\s+)?${WEEKDAY}\b`).test(rest)) return null;
    return { kind: "REPLACE_SESSION_FOCUS", from, focus: rest };
  }
  return null;
}

/** How many distinct weekdays a text names — used by callers/tests to sanity check parser inputs. */
export function weekdaysNamed(normalizedText: string): number[] {
  return [...new Set([...normalizedText.matchAll(WEEKDAY_ANY)].map(weekdayOf))];
}

export type BodyPartKey = "LEGS" | "CHEST" | "BACK" | "SHOULDERS" | "ARMS" | "CORE";

const BODY_PARTS: Array<{ re: RegExp; label: string; key: BodyPartKey }> = [
  { re: /\b(chan|dui|bap chan|gan kheo|tu dau|mong)\b/, label: "chân", key: "LEGS" },
  { re: /\b(nguc)\b/, label: "ngực", key: "CHEST" },
  { re: /\b(lung)\b/, label: "lưng", key: "BACK" },
  { re: /\b(vai)\b/, label: "vai", key: "SHOULDERS" },
  { re: /\b(bung|core)\b/, label: "bụng", key: "CORE" },
  { re: /\b(tay|co tay|khuyu tay)\b/, label: "tay", key: "ARMS" },
  // A knee problem is handled as LEGS: every catalog exercise that loads the knee is a quadriceps/hamstring/glute/calf one.
  { re: /\b(goi|dau goi)\b/, label: "gối", key: "LEGS" },
];

/** Canonical Exercise muscle strings (fitness-service catalog `muscle_groups_activated`) per body-part group. */
const GROUP_MUSCLES: Record<BodyPartKey, ReadonlySet<string>> = {
  LEGS: new Set(["quadriceps", "quads", "hamstrings", "glutes", "calves", "adductors", "abductors"]),
  CHEST: new Set(["chest", "upper_chest"]),
  BACK: new Set(["lats", "middle back", "mid_back", "upper_back", "back", "traps", "lower_traps", "lower back", "spinal_erectors"]),
  SHOULDERS: new Set(["shoulders", "front_delts", "side_delts", "rear_delts", "rotator_cuff"]),
  ARMS: new Set(["biceps", "triceps", "forearms"]),
  CORE: new Set(["abdominals", "abs", "obliques", "transverse_abs", "core"]),
};
const GROUP_BODYPART: Partial<Record<BodyPartKey, string>> = { LEGS: "LOWER_BODY", CORE: "CORE" };

export interface MuscleProfile { id: string; name?: string; bodyPart?: string | null; muscleGroups?: string[] | null }

/**
 * Whether the catalog says this exercise loads the body-part group (primary OR secondary muscle: deliberately conservative —
 * "lưng" also removes squats/deadlifts because they load the lower back, and the reply says so).
 */
export function exerciseLoadsGroup(profile: MuscleProfile, key: BodyPartKey): boolean {
  const muscles = (profile.muscleGroups ?? []).map((m) => String(m).toLowerCase());
  if (muscles.some((m) => GROUP_MUSCLES[key].has(m))) return true;
  const bp = GROUP_BODYPART[key];
  return !!bp && profile.bodyPart === bp;
}

export interface BodyPartRemovalPlan {
  removed: Array<{ day: string; name: string }>;
  /** exercises whose muscle profile the catalog did not return: kept, and reported (unknown is never "safe"). */
  unknown: Array<{ day: string; name: string }>;
  /** the schedule without the matching exercises; sessions that would be left empty are NOT in it. */
  keptSchedule: any[];
  keptIndexes: number[];
  emptiedDays: string[];
}

/** Pure: what removing every exercise that loads `key` would do to a draft. Never mutates its input. */
export function planBodyPartRemoval(schedule: any[], profiles: ReadonlyMap<string, MuscleProfile>, key: BodyPartKey): BodyPartRemovalPlan {
  const removed: BodyPartRemovalPlan["removed"] = [];
  const unknown: BodyPartRemovalPlan["unknown"] = [];
  const keptSchedule: any[] = [];
  const keptIndexes: number[] = [];
  const emptiedDays: string[] = [];
  schedule.forEach((day: any, index: number) => {
    const exercises: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
    const keep: any[] = [];
    for (const e of exercises) {
      const p = profiles.get(String(e.exerciseId));
      if (!p) { unknown.push({ day: String(day.day), name: String(e.name) }); keep.push(e); continue; }
      if (exerciseLoadsGroup(p, key)) removed.push({ day: String(day.day), name: String(e.name) });
      else keep.push(e);
    }
    if (keep.length === 0) { emptiedDays.push(String(day.day)); return; }
    keptSchedule.push({ ...day, exercises: keep.map((e, i) => ({ ...e, order: i + 1 })) });
    keptIndexes.push(index);
  });
  return { removed, unknown, keptSchedule, keptIndexes, emptiedDays };
}

const CLEAR_CUE = /\b(het dau|khoi dau|khong con dau|het chan thuong|khoi chan thuong|het dau nhuc|tap (?:\w+ ){0,2}lai duoc|tap duoc (?:\w+ ){0,2}roi|bo han che|khong can tranh)\b/;
/** "Hết đau chân rồi / tập chân lại được" — lifts the temporary avoidance of a body part. Questions are ignored. */
export function detectBodyPartClear(rawText: string, normalizedText: string): { key: BodyPartKey; part: string } | null {
  if (/\?/.test(rawText) || !CLEAR_CUE.test(normalizedText)) return null;
  const bodyText = normalizedText.replace(/\bchan thuong\b/g, " ");
  const hit = BODY_PARTS.find((b) => b.re.test(bodyText));
  return hit ? { key: hit.key, part: hit.label } : null;
}

/** Short answers to the agent's own yes/no question about a body-part change. Anything longer or different is not an answer. */
export function parseBodyPartDecisionAnswer(normalizedText: string): "YES" | "NO" | null {
  const s = normalizedText.replace(/[.,!?;]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.split(" ").length > 7) return null;
  // Anything about saving/confirming belongs to the confirmation boundary ("ok lưu đi" saves NOTHING and removes nothing).
  if (/\b(luu|save|xac nhan|chot|confirm|cap nhat)\b/.test(s)) return null;
  // Affirmations FIRST. Diacritic stripping merges "đúng" (right) and "đừng" (don't) into "dung", so only unambiguous forms count:
  // "dung roi/vay/the" = đúng rồi (YES), "dung bo/xoa/lam" = đừng bỏ (NO). "thoi bo luon di" (let's just drop it) is a YES although
  // it starts with "thoi" (enough/never mind).
  if (/^(?:ok|oke|okay|dong y|duoc|vang|u|uh|co|dung roi|dung vay|dung the|chinh xac|chuan|bo di|bo cac buoi do|bo luon|thoi bo|xoa di|lam di|cu bo)\b/.test(s)) return "YES";
  if (/^(?:khong|thoi khong|thoi|giu nguyen|giu lai|dung bo|dung xoa|dung lam|khong can|huy)\b/.test(s)) return "NO";
  return null;
}

const PAIN_WORDS = new Set(["dau", "nhuc", "injury", "sung", "viem"]);
const REMOVE_CUE = /\b(bo|khong tap|khong muon tap|tranh|loai bo|kieng|dung tap|khong the tap)\b/;
// "Hết đau chân" / "khỏi đau lưng" / "bớt đau": the pain is GONE — never a new constraint.
const PAIN_GONE = /\b(het|khoi|khong con|bot|do)\s+(?:\w+\s+)?(?:dau|nhuc|injury|sung|viem)\b/;
// Words the diacritic-stripped text confuses with a body part: "vài ngày" (a few days) vs "vai" (shoulder), "mong là" (hope) vs "mong" (buttocks).
const NOT_A_BODY_PART = [
  /\bvai (?=ngay|tuan|thang|lan|buoi|bai|phut|gio|nam|cai|hom|tieng)/g,
  /\bmong (?=la|ban|muon|se|duoc|rang|em|anh|chi|co|doi)/g,
];
// The body part as the OBJECT of a removal ("bỏ bài tập chân", "không tập ngực nữa", "đừng tập lưng").
const REMOVAL_OBJECT = /\b(?:bai tap|bai|nhom co|nhom|ngay|buoi)\s+(?:tap\s+)?(?:cho\s+)?(chan|dui|nguc|lung|vai|bung|tay|goi|mong)\b|\b(?:khong tap|dung tap|tranh tap|khong muon tap|khong the tap|thoi tap)\s+(chan|dui|nguc|lung|vai|bung|tay|goi|mong)\b/;

export interface BodyPartConstraintCue { part: string; key: BodyPartKey; pain: boolean; removal: boolean }

/**
 * A pain/injury statement and/or a request to drop a BODY PART ("bỏ bài tập chân", "tôi bị đau gối"). Precision matters more than
 * recall here (a false hit makes the agent ask about removing exercises the user never mentioned): a pain word only counts with a body
 * part within three words of it, injury phrases are folded to one token (so "chấn thương" = "chan thuong" is not read as "chân"),
 * common look-alike words are dropped, and "hết đau chân" is a recovery, not a constraint. Questions belong to normal chat.
 */
export function detectBodyPartConstraint(rawText: string, normalizedText: string): BodyPartConstraintCue | null {
  if (/\?/.test(rawText)) return null;
  let t = normalizedText.replace(/\b(?:chan thuong|bi thuong|cang co|bong gan)\b/g, " injury ");
  for (const re of NOT_A_BODY_PART) t = t.replace(re, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (PAIN_GONE.test(t)) return null;
  const tokens = t.split(" ");
  let painHit: (typeof BODY_PARTS)[number] | undefined;
  tokens.forEach((tok, i) => {
    if (painHit || !PAIN_WORDS.has(tok)) return;
    const window = tokens.slice(Math.max(0, i - 3), i + 5).join(" ");
    painHit = BODY_PARTS.find((b) => b.re.test(window));
  });
  const removal = REMOVE_CUE.test(t);
  let hit = painHit;
  if (!hit && removal) {
    const m = t.match(REMOVAL_OBJECT);
    const word = m?.[1] ?? m?.[2];
    if (word) hit = BODY_PARTS.find((b) => b.re.test(word));
  }
  if (!hit) return null;
  return { part: hit.label, key: hit.key, pain: !!painHit, removal };
}
