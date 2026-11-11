/**
 * "Điều chỉnh" for a saved workout plan (POST /plans/adjust) — turns the user's free text into constraints the worker can
 * ENFORCE on the exercise pool the model chooses from (adjust eval 2026-11-11: 13/25 passed, Opus compliance 1.79/5, because
 * the model only ever saw ~7 pre-ranked candidates per day that ignored the request, and never saw the plan it was adjusting).
 *
 * The model still builds the adjusted plan. This module only decides which catalog exercises are allowed / must be offered,
 * and which explicit numbers the user typed in the text box. Pure: no I/O, no LLM.
 */
import { normalizeAgentText } from "../fitness-agent-intent";

export type AdjustFocus = "CORE" | "TRICEPS" | "BICEPS" | "GLUTES_HAMSTRINGS" | "CHEST" | "BACK" | "SHOULDERS" | "LEGS";
export type EquipmentOnly = "DUMBBELL" | "BODYWEIGHT" | "FREE_WEIGHT";

export interface WorkoutAdjustmentConstraints {
  /** Applied to the English catalog exercise name. */
  excludeNamePatterns: RegExp[];
  /** Short Vietnamese labels of what was excluded, for the prompt. */
  excludeLabels: string[];
  equipmentOnly?: EquipmentOnly;
  addFocus: AdjustFocus[];
  cardioEachDay: boolean;
  beginnerSafe: boolean;
  lighterVolume: boolean;
  strengthFocus: boolean;
  /** Numbers typed in the text ("còn 2 buổi", "mỗi buổi 4 bài") — used only when the numeric input was left empty. */
  daysPerWeek?: number;
  exercisesPerDay?: number;
  /** 0-based day indexes the user wants turned into a full-body session ("đổi buổi 1 thành toàn thân"). */
  fullBodyDays: number[];
}

/** Direct glute/hamstring work first, so the offered candidates are the ones the request is really about. */
export const GLUTE_HAM_PRIORITY = /hip thrust|glute bridge|romanian|\brdl\b|leg curl|hamstring curl|glute|kickback|abduct|step.?up|bridge/i;

const SQUAT = /squat/i;
const DEEP_KNEE = /pistol|sissy|deep|split squat|overhead squat|jump squat|bulgarian/i;
const HINGE = /deadlift|good morning|bent.?over|stiff.?leg|romanian|\brdl\b/i;
const JUMP = /jump|plyo|box|hop|skip|burpee|skater|jack|clap|bound/i;
const LUNGE = /lunge|split squat|bulgarian/i;
const OVERHEAD = /overhead|military|shoulder press|arnold|push press|behind.?neck|handstand|snatch|jerk|z press|pike|landmine press/i;
const PULLUP_BAR = /pull.?up|chin.?up|muscle.?up|hanging|toes.?to.?bar/i;
const MACHINE_NAME = /machine|smith|lever|leg press|hack|pec deck|leg extension|selectorized/i;
const ADVANCED_NAME = /snatch|clean|jerk|pistol|muscle.?up|nordic|commando|behind.?neck|plyo|jump|burpee|handstand|one.?arm push|single.?arm push|clap|dragon flag|front lever|archer|planche|human flag/i;

/** English exercise vocabulary accepted from a generic "bỏ X" phrase — anything else is too risky to turn into a filter. */
const ENGLISH_EXERCISE_WORDS = ["squat", "deadlift", "lunge", "bench press", "bench", "row", "curl", "fly", "dip", "dips", "burpee", "burpees", "plank", "crunch", "pull up", "pullup", "push up", "pushup", "hip thrust", "thrust", "shrug", "kettlebell", "leg press", "good morning"];

const NUM_WORDS: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, sau: 6, bay: 7, tam: 8 };
const num = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s]);

export function parseWorkoutAdjustment(raw: string): WorkoutAdjustmentConstraints {
  const s = normalizeAgentText(raw ?? "");
  const c: WorkoutAdjustmentConstraints = {
    excludeNamePatterns: [], excludeLabels: [], addFocus: [],
    cardioEachDay: false, beginnerSafe: false, lighterVolume: false, strengthFocus: false, fullBodyDays: [],
  };
  for (const m of s.matchAll(/\bbuoi\s*(\d)\b[^.]{0,30}?\b(toan than|full body)\b/g)) {
    const i = Number(m[1]) - 1; if (i >= 0 && i < 7 && !c.fullBodyDays.includes(i)) c.fullBodyDays.push(i);
  }
  const ex = (re: RegExp, label: string) => { c.excludeNamePatterns.push(re); c.excludeLabels.push(label); };
  const removing = /\b(bo|khong|tranh|loai|thay|doi|ngung|dung|han che|kieng)\b/.test(s);

  // ── pain / injury → movement exclusions ──────────────────────────────────
  if (/dau (dau )?goi|goi (bi )?dau|chan thuong goi/.test(s)) { ex(JUMP, "bài nhảy/bật"); ex(DEEP_KNEE, "squat sâu/một chân"); ex(LUNGE, "lunge/split squat"); }
  if (/dau vai|vai (bi )?dau|chan thuong vai/.test(s)) { ex(OVERHEAD, "đẩy qua đầu"); ex(/upright row|behind.?neck|\bdips?\b/i, "upright row/dips"); }
  if (/dau lung|lung (bi )?dau|thoat vi|chan thuong lung/.test(s)) ex(HINGE, "deadlift/gập người mang tạ");

  // ── explicit removals ─────────────────────────────────────────────────────
  if (removing) {
    if (/squat sau/.test(s)) ex(DEEP_KNEE, "squat sâu");
    else if (/\bsquat\b/.test(s)) ex(SQUAT, "squat");
    if (/deadlift|gap nguoi/.test(s)) ex(HINGE, "deadlift/gập người mang tạ");
    if (/\bnhay\b|\bbat\b|plyo|jump/.test(s)) ex(JUMP, "bài nhảy/bật");
    if (/burpee/.test(s)) ex(/burpee/i, "burpee");
    if (/\blunge\b/.test(s)) ex(LUNGE, "lunge");
    if (/qua dau|overhead/.test(s)) ex(OVERHEAD, "đẩy qua đầu");
    if (/bench press/.test(s)) ex(/bench press/i, "bench press");
    for (const w of ENGLISH_EXERCISE_WORDS) {
      if (["squat", "deadlift", "lunge", "bench press", "bench", "burpee", "burpees"].includes(w)) continue; // handled above
      if (new RegExp(`\\b(?:bo|khong|tranh|loai)\\b(?:\\s+\\S+){0,3}?\\s+${w.replace(/ /g, "\\s*-?\\s*")}\\b`).test(s)) ex(new RegExp(w.replace(/ /g, "[\\s-]?"), "i"), w);
    }
  }
  if (/khong co xa|khong co thanh xa|bo .*keo xa|khong .*keo xa/.test(s)) ex(PULLUP_BAR, "kéo xà");

  // ── equipment ─────────────────────────────────────────────────────────────
  if (/khong (co )?dung cu|trong luong co the|bodyweight|tay khong/.test(s)) c.equipmentOnly = "BODYWEIGHT";
  else if (/chi co ta don|chi (dung|tap) ta don|toan bo .*ta don|dumbbell only|chi co dumbbell/.test(s)) c.equipmentOnly = "DUMBBELL";
  else if (/khong (thich|muon|dung) (tap )?may|ta tu do|free weight/.test(s)) c.equipmentOnly = "FREE_WEIGHT";

  // ── focus to add ──────────────────────────────────────────────────────────
  const adding = /\b(them|tang|tap trung|uu tien|nhieu hon|bo sung)\b/.test(s);
  if (adding) {
    if (/\bbung\b|core|co bung/.test(s)) c.addFocus.push("CORE");
    if (/tay sau|tricep/.test(s)) c.addFocus.push("TRICEPS");
    if (/tay truoc|bicep/.test(s)) c.addFocus.push("BICEPS");
    if (/\bmong\b|dui sau|glute|hamstring/.test(s)) c.addFocus.push("GLUTES_HAMSTRINGS");
    if (/\bnguc\b|chest/.test(s)) c.addFocus.push("CHEST");
    if (/\blung\b|xo\b|\bback\b/.test(s) && !/dau lung/.test(s)) c.addFocus.push("BACK");
    if (/\bvai\b|shoulder/.test(s) && !/dau vai/.test(s)) c.addFocus.push("SHOULDERS");
  }
  c.cardioEachDay = /cardio|di bo|dap xe|chay bo nhe/.test(s) && /\b(them|cuoi|moi buoi|sau buoi)\b/.test(s);

  // ── level / volume / intensity ────────────────────────────────────────────
  c.beginnerSafe = /moi tap|nguoi moi|don gian|de hon|bai kho|qua kho|nhe nhang/.test(s);
  c.lighterVolume = /nhe hon|it hiep|it set|giam hiep|giam set|hay met|de met|qua suc/.test(s);
  c.strengthFocus = /rep thap|ta nang|suc manh|strength|nang nang/.test(s);

  // ── numbers typed in the text ─────────────────────────────────────────────
  // A count only counts with clear framing: "còn/xuống/lên/chỉ N buổi", "N buổi (mỗi/một/1) tuần"; "mỗi buổi (chỉ) N bài",
  // "chỉ/còn N bài", "N bài mỗi buổi". "buổi 1" (an ordinal) and "thêm 2 bài bụng" (an addition) are NOT counts.
  const N = "(\\d|mot|hai|ba|bon|nam|sau|bay|tam)";
  const days =
    new RegExp(`\\b(?:con|xuong|len|chi|giam|tang)\\s+(?:con\\s+)?${N}\\s+buoi\\b`).exec(s) ??
    new RegExp(`\\b${N}\\s+buoi\\s*(?:\\/|moi|mot|1)?\\s*tuan\\b`).exec(s);
  if (days) { const n = num(days[1]); if (n && n >= 1 && n <= 7) c.daysPerWeek = n; }
  const per =
    new RegExp(`\\bmoi buoi\\s+(?:chi\\s+|tap\\s+|co\\s+)?${N}\\s+bai\\b`).exec(s) ??
    new RegExp(`\\b(?:chi|con)\\s+(?:con\\s+)?${N}\\s+bai\\b`).exec(s) ??
    new RegExp(`\\b${N}\\s+bai(?:\\s+tap)?\\s+(?:moi|mot|1)\\s+buoi\\b`).exec(s);
  if (per && !/\bthem\b/.test(s.slice(Math.max(0, per.index - 6), per.index + 1))) { const n = num(per[1]); if (n && n >= 1 && n <= 8) c.exercisesPerDay = n; }
  return c;
}

export interface ExerciseLike { exerciseName?: string; name?: string; typeOfEquipment?: string | null; difficultyLevel?: string | null }

export function exerciseViolates(ex: ExerciseLike, c: WorkoutAdjustmentConstraints): boolean {
  const name = String(ex.exerciseName ?? ex.name ?? "");
  const eq = String(ex.typeOfEquipment ?? "").toUpperCase();
  if (c.excludeNamePatterns.some((re) => re.test(name))) return true;
  if (c.equipmentOnly === "BODYWEIGHT" && (eq !== "BODYWEIGHT" || /barbell|dumbbell|kettlebell|band|cable|machine|plate|ez.?bar/i.test(name))) return true;
  // "Chỉ có tạ đơn": dumbbell exercises only — bands/suspension/barbell variants mislabelled as bodyweight are excluded by name.
  if (c.equipmentOnly === "DUMBBELL" && (eq !== "DUMBBELLS" || /barbell|machine|smith|cable|lever|kettlebell|band|suspen|trx/i.test(name))) return true;
  if (c.equipmentOnly === "FREE_WEIGHT" && (["MACHINE", "CABLE"].includes(eq) || MACHINE_NAME.test(name))) return true;
  if (c.beginnerSafe && (/expert|advanced/i.test(String(ex.difficultyLevel ?? "")) || ADVANCED_NAME.test(name))) return true;
  return false;
}

// ── Level-based safety for EVERY generated plan (adjust eval 2026-11-11: a beginner's base plan held Snatch, Clean, Power Jerk,
// Neck Press, Guillotine Press, Muscle Up, Bench Press with Chains — the candidate pool never looked at experience level) ──────
/** High-risk for anyone; not prescribed by an unsupervised AI. */
const ALWAYS_UNSAFE = /neck press|guillotine|behind.?(the.?)?neck/i;
/** Technical, explosive or powerlifting-specialty variants: not for beginners or people 50+. */
// The catalog labels many strongman / sport-drill items "beginner STRENGTH" (Sled Push, Power Stairs, Scissors Jump, Tire Flip…);
// until the catalog is relabelled (a separate data-hygiene decision) the names are matched here. Stopgap, documented 2026-11-11.
const BEGINNER_UNSAFE = /snatch|clean|jerk|muscle.?up|nordic|commando|pistol|plyo|jump|bound|\bhop|clap|dragon flag|front lever|archer|planche|human flag|with chains|with bands|band(ed)? (bench|squat|deadlift)|board press|rack pull|powerlifting|log lift|zercher|jefferson|frankenstein|kipping|one.?arm push|single.?arm push|handstand|sled|tire|atlas|stone|keg|yoke|power stairs|iron cross|bradford|rocky press|otis|heavy bag|wall drill|acceleration|speed (box|squat|deadlift)|barbell good morning|good morning off pins|fallout|windmill|turkish/i;

export interface TraineeProfileLike { experienceLevel?: string | null; age?: number | null }

/** True when this catalog exercise should not be offered to this trainee at all. */
/**
 * Olympic lifts, strongman/sled drills and powerlifting-specialty setups need coaching and special equipment; an unsupervised
 * AI plan should not prescribe them to anyone below ADVANCED (swap test 2026-11-11: an INTERMEDIATE 28-year-old got Squat Jerk,
 * Power Snatch, Hang Clean, Reverse Band Sumo Deadlift). Plain plyometrics stay allowed for intermediates.
 */
const NON_ADVANCED_UNSAFE = /snatch|clean|jerk|muscle.?up|kipping|with chains|with bands|reverse band|band(ed)? (bench|squat|deadlift)|board press|pin press|powerlifting|log lift|zercher|jefferson|frankenstein|sled|tire|atlas|stone|keg|yoke|power stairs|iron cross|bradford|rocky press|otis|heavy bag|anti.?gravity press|rickshaw|speed (box|squat|deadlift)/i;

export function exerciseUnsafeForTrainee(ex: ExerciseLike, p: TraineeProfileLike | null | undefined): boolean {
  const name = String(ex.exerciseName ?? ex.name ?? "");
  if (ALWAYS_UNSAFE.test(name)) return true;
  const level = String(p?.experienceLevel ?? "");
  const novice = /beginner/i.test(level) || (typeof p?.age === "number" && p.age >= 50);
  if (novice) return /expert|advanced/i.test(String(ex.difficultyLevel ?? "")) || BEGINNER_UNSAFE.test(name);
  if (/advanced|expert|athlete/i.test(level)) return false;
  // Intermediate, or level unknown: no Olympic/strongman/powerlifting-specialty work and no catalog-"expert" items.
  return /expert/i.test(String(ex.difficultyLevel ?? "")) || NON_ADVANCED_UNSAFE.test(name);
}

/** Location to fetch the catalog with: equipment-only adjustments need the home pool (bodyweight/dumbbells). */
export function fetchLocationFor(c: WorkoutAdjustmentConstraints, current: string): string {
  return c.equipmentOnly === "BODYWEIGHT" || c.equipmentOnly === "DUMBBELL" ? "HOME" : current;
}

/** Muscle-group key used by the worker's exerciseMatchesMuscleGroup for each requested focus. */
export const FOCUS_GROUP: Record<AdjustFocus, string> = {
  CORE: "CORE", TRICEPS: "TRICEPS", BICEPS: "BICEPS", GLUTES_HAMSTRINGS: "GLUTES", CHEST: "CHEST", BACK: "BACK", SHOULDERS: "SHOULDERS", LEGS: "LEGS",
};
const FOCUS_VI: Record<AdjustFocus, string> = {
  CORE: "bụng/core", TRICEPS: "tay sau (triceps)", BICEPS: "tay trước (biceps)", GLUTES_HAMSTRINGS: "mông và đùi sau", CHEST: "ngực", BACK: "lưng", SHOULDERS: "vai", LEGS: "chân",
};

/** Hard rules for the model, in the same English style as the rest of the plan prompt. */
export function adjustmentPromptLines(c: WorkoutAdjustmentConstraints): string[] {
  const lines: string[] = [];
  if (c.excludeLabels.length) lines.push(`- The user asked to REMOVE: ${[...new Set(c.excludeLabels)].join(", ")}. Those exercises were removed from the catalog; never add them back.`);
  if (c.equipmentOnly === "DUMBBELL") lines.push("- The user only has dumbbells: use dumbbell exercises (bodyweight allowed), nothing with a barbell, machine or cable.");
  if (c.equipmentOnly === "BODYWEIGHT") lines.push("- The user has no equipment: bodyweight exercises only.");
  if (c.equipmentOnly === "FREE_WEIGHT") lines.push("- The user does not want machines: use free weights (barbell, dumbbell, kettlebell) and bodyweight.");
  for (const f of c.addFocus) lines.push(`- EVERY day must include at least one ${FOCUS_VI[f]} exercise (candidates are listed under each day).`);
  if (c.cardioEachDay) lines.push('- Fill the "cardio" field of EVERY day with a concrete light cardio finisher in Vietnamese, e.g. "Đi bộ nhanh hoặc đạp xe nhẹ 10-15 phút".');
  for (const i of c.fullBodyDays) lines.push(`- Day ${i + 1} must become a FULL-BODY session: at least one lower-body (squat/hinge/lunge/glute) AND one upper-body push AND one upper-body pull exercise (candidates are listed under Day ${i + 1}).`);
  if (c.beginnerSafe) lines.push("- The user wants simpler exercises: choose beginner-friendly, stable movements; no complex or explosive lifts.");
  if (c.lighterVolume) lines.push("- The user wants a lighter plan: 2 sets per exercise, moderate reps, longer rest.");
  if (c.strengthFocus) lines.push('- The user wants strength: main compound lifts 4-6 or 5-8 reps with 120-180 s rest; accessories 8-12.');
  return lines;
}
