import { z } from 'zod';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function asBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function asIntOrFallback(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function localizePlanNote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const key = normalizeTextKey(trimmed);
  if (/auto-repaired/i.test(trimmed)) {
    return 'Bài tập đã được tự động khớp với danh mục bài tập hợp lệ.';
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0370-\u04FF\u0E00-\u0E7F\u0E80-\u0EFF]|[ƷƵƳƪǍǭȸ½¿]|\uFFFD|\?|Āng|ᬺ|ǈi|ī|ǉ|ĝ|Âng|Ñ|Ȃ|ӣ/.test(trimmed)) {
    if (/7-9|giờ|phục hồi|hồi/i.test(trimmed)) {
      return 'Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.';
    }
    if (/đau|nhức|kéo dài|khối lượng|nghỉ/i.test(trimmed)) {
      return 'Nếu đau nhức kéo dài, hãy giảm khối lượng tập hoặc nghỉ thêm.';
    }
    if (/form|chuẩn|cường độ/i.test(trimmed)) {
      return 'Giữ form chuẩn trước khi tăng cường độ.';
    }
    if (/hoàn thành|hiệp|kỹ thuật|tạ|lặp/i.test(trimmed)) {
      return 'Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.';
    }
    if (/protein|calo|nước/i.test(trimmed)) {
      return 'Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.';
    }
    if (/10|15|cardio|warm|khởi/i.test(trimmed)) {
      return 'Khởi động nhẹ 5-10 phút trước buổi tập.';
    }
    return 'Tập trung vào kỹ thuật chuẩn, kiểm soát nhịp tập và tăng tiến từ từ.';
  }
  const exactMap: Record<string, string> = {
    'add load or reps gradually when all sets feel controlled.':
      'Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.',
    'add load or reps gradually when all sets feel controlled':
      'Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.',
    'sleep 7-9 hours and keep at least one recovery day weekly.':
      'Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.',
    'sleep 7-9 hours and keep at least one recovery day weekly':
      'Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.',
    'protein 1.8-2.2 g/kg/day and calories aligned with the goal.':
      'Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.',
    'protein 1.8-2.2 g/kg/day and calories aligned with the goal':
      'Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.',
    'main lift': 'Bài chính, ưu tiên kỹ thuật chắc và kiểm soát nhịp tập.',
    'accessory lift': 'Bài bổ trợ, tập kiểm soát và không đánh đổi form để tăng tạ.',
    'optional 10 min easy warm-up': 'Có thể khởi động nhẹ 10 phút trước buổi tập.',
    'control the descent': 'Kiểm soát pha hạ tạ, giữ form ổn định.',
    '10 min treadmill warm-up': 'Khởi động 10 phút trên máy chạy bộ.',
  };
  if (exactMap[key]) return exactMap[key];

  if (/add .*load|add .*reps|progress/i.test(trimmed)) {
    return 'Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.';
  }
  if (/sleep|recovery|stretch/i.test(trimmed)) {
    return 'Ngủ 7-9 giờ mỗi ngày, giãn cơ nhẹ sau buổi tập và giữ ít nhất một ngày phục hồi mỗi tuần.';
  }
  if (/protein|calorie|caloric|nutrition/i.test(trimmed)) {
    return 'Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.';
  }
  if (/warm[- ]?up|treadmill/i.test(trimmed)) {
    return 'Khởi động nhẹ 5-10 phút trước buổi tập.';
  }
  if (/main lift/i.test(trimmed)) {
    return 'Bài chính, ưu tiên kỹ thuật chắc và kiểm soát nhịp tập.';
  }
  if (/accessory/i.test(trimmed)) {
    return 'Bài bổ trợ, tập kiểm soát và không đánh đổi form để tăng tạ.';
  }

  return trimmed;
}

function localizeDayGoal(value: string, dayIndex: number): string {
  const trimmed = localizePlanNote(value);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0370-\u04FF\u0E00-\u0E7F\u0E80-\u0EFF]|[ƷƵƳƪǍǭȸ½¿]|\uFFFD|\?|Āng|ᬺ|ǈi|ī|ǉ|ĝ|Âng|Ñ|Ȃ|ӣ/.test(value)) {
    if (/tay trước/i.test(value)) return 'Lưng + Tay trước';
    if (/tay sau/i.test(value)) return 'Ngực + Vai + Tay sau';
    if (/vai/i.test(value)) return 'Vai + Tay';
    if (/chân|mong|mông/i.test(value)) return 'Chân + Mông';
    return `Buổi tập ${dayIndex + 1}`;
  }
  return trimmed;
}

function normalizePlanCandidate(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;

  const wrapped =
    isRecord(parsed.plan) && (Array.isArray(parsed.plan.weeklySchedule) || Array.isArray(parsed.plan.weekly_schedule))
      ? parsed.plan
      : isRecord(parsed.workout_plan) && (Array.isArray(parsed.workout_plan.weeklySchedule) || Array.isArray(parsed.workout_plan.weekly_schedule))
        ? parsed.workout_plan
        : isRecord(parsed.workout) && (Array.isArray(parsed.workout.weeklySchedule) || Array.isArray(parsed.workout.weekly_schedule))
          ? parsed.workout
          : parsed;

  const normalized: UnknownRecord = { ...wrapped };

  const normalizedGoal = asNonEmptyString(wrapped.goal, asNonEmptyString(wrapped.name, 'General fitness'));
  normalized.goal = normalizedGoal;
  normalized.durationWeeks = asIntOrFallback(wrapped.durationWeeks ?? wrapped.duration, 4);
  normalized.daysPerWeek = asIntOrFallback(wrapped.daysPerWeek, 3);
  if (wrapped.exercisesPerDay !== undefined) {
    normalized.exercisesPerDay = asIntOrFallback(wrapped.exercisesPerDay, 4);
  }

  const schedule = Array.isArray(wrapped.weeklySchedule)
    ? wrapped.weeklySchedule
    : Array.isArray(wrapped.weekly_schedule)
      ? wrapped.weekly_schedule
      : [];
  normalized.weeklySchedule = schedule
    .filter((item) => isRecord(item))
    .map((dayItem, dayIndex) => {
      const dayLabel = asNonEmptyString(dayItem.day, `Day ${dayIndex + 1}`);
      const dayGoal = asNonEmptyString(dayItem.goal, asNonEmptyString(dayItem.focus, 'General training'));

      const exercises = Array.isArray(dayItem.exercises) ? dayItem.exercises : [];
      const normalizedExercises = exercises
        .filter((exercise) => isRecord(exercise))
        .map((exercise, exerciseIndex) => ({
          exerciseId: asNonEmptyString((exercise as any).exerciseId || (exercise as any).id, ''),
          order: asBoundedInt(exercise.order, exerciseIndex + 1, 1, 30),
          name: asNonEmptyString(exercise.name, `Exercise ${exerciseIndex + 1}`),
          sets: asBoundedInt(exercise.sets, 3, 1, 10),
          reps: asNonEmptyString(exercise.reps, '8-12'),
          restSeconds: asBoundedInt(exercise.restSeconds, 60, 0, 600),
          note: typeof exercise.note === 'string' && exercise.note.trim() ? localizePlanNote(exercise.note) : undefined,
        }));

      return {
        day: dayLabel,
        goal: localizeDayGoal(dayGoal, dayIndex),
        exercises: normalizedExercises,
        cardio: typeof dayItem.cardio === 'string' && dayItem.cardio.trim() ? localizePlanNote(dayItem.cardio) : undefined,
      };
    });

  const progression = Array.isArray(wrapped.progressionNotes) ? wrapped.progressionNotes : [];
  normalized.progressionNotes = progression
    .filter((note) => typeof note === 'string' && note.trim().length > 0)
    .map((note) => localizePlanNote(note));
  if ((normalized.progressionNotes as string[]).length === 0) {
    normalized.progressionNotes = [
      'Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.',
      'Giữ form chuẩn trước khi tăng cường độ.',
    ];
  }

  const recovery = Array.isArray(wrapped.recoveryNotes) ? wrapped.recoveryNotes : [];
  normalized.recoveryNotes = recovery
    .filter((note) => typeof note === 'string' && note.trim().length > 0)
    .map((note) => localizePlanNote(note));
  if ((normalized.recoveryNotes as string[]).length === 0) {
    normalized.recoveryNotes = [
      'Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.',
      'Nếu đau nhức kéo dài, hãy giảm khối lượng tập hoặc nghỉ thêm.',
    ];
  }

  if (typeof wrapped.nutritionSummary === 'string' && wrapped.nutritionSummary.trim().length > 0) {
    normalized.nutritionSummary = localizePlanNote(wrapped.nutritionSummary);
  } else {
    normalized.nutritionSummary = 'Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.';
  }

  return normalized;
}

// ── Request schemas ────────────────────────────────────────────────────────────

export const GeneratePlanRequestSchema = z.object({
  goal: z
    .string({ required_error: 'goal is required' })
    .min(1, 'goal must not be empty')
    .max(200, 'goal must be at most 200 characters'),
  durationWeeks: z
    .number({ required_error: 'durationWeeks is required' })
    .int()
    .min(1, 'durationWeeks must be at least 1')
    .max(52, 'durationWeeks must be at most 52'),
  daysPerWeek: z
    .number({ required_error: 'daysPerWeek is required' })
    .int()
    .min(1, 'daysPerWeek must be at least 1')
    .max(7, 'daysPerWeek must be at most 7'),
  exercisesPerDay: z
    .number()
    .int()
    .min(1, 'exercisesPerDay must be at least 1')
    .max(8, 'exercisesPerDay must be at most 8')
    .default(4),
  trainingLocation: z.enum(['HOME', 'GYM']).default('GYM').optional(),
  equipmentPreference: z.enum(['MACHINE_ONLY', 'MIXED_GYM']).default('MIXED_GYM').optional(),
  contractId: z.string().uuid('contractId must be a valid UUID').optional(),
});
export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;

export const ExplainPlanRequestSchema = z.object({
  planId: z
    .string({ required_error: 'planId is required' })
    .uuid('planId must be a valid UUID'),
});
export type ExplainPlanRequest = z.infer<typeof ExplainPlanRequestSchema>;

export const AdjustPlanRequestSchema = z.object({
  planId: z
    .string({ required_error: 'planId is required' })
    .uuid('planId must be a valid UUID'),
  adjustments: z
    .string({ required_error: 'adjustments is required' })
    .min(5, 'adjustments must be at least 5 characters')
    .max(1000, 'adjustments must be at most 1000 characters'),
  daysPerWeek: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional(),
  exercisesPerDay: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional(),
});
export type AdjustPlanRequest = z.infer<typeof AdjustPlanRequestSchema>;

export const SavePlanToWorkoutLogRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  repeatWeeks: z
    .number()
    .int()
    .min(1, 'repeatWeeks must be at least 1')
    .max(52, 'repeatWeeks must be at most 52')
    .optional(),
  selectedWeekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .optional(),
  /** true (default) = archive existing programs + delete their future schedules */
  replaceExisting: z.boolean().default(true).optional(),
});
export type SavePlanToWorkoutLogRequest = z.infer<typeof SavePlanToWorkoutLogRequestSchema>;

// ── Plan content schema (validated against LLM output) ────────────────────────

export const ExerciseItemSchema = z.object({
  exerciseId: z.string().min(1, 'exerciseId is required'),
  order: z.number().int().min(1).max(30),
  name: z.string().min(1).max(200),
  sets: z.number().int().min(1).max(10),
  /** Flexible: "10", "8-12", "AMRAP", "30 seconds" */
  reps: z.string().min(1).max(50),
  restSeconds: z.number().int().min(0).max(600),
  note: z.string().max(300).optional(),
});
export type ExerciseItem = z.infer<typeof ExerciseItemSchema>;

export const WorkoutDaySchema = z.object({
  day: z.string().min(1).max(50),
  goal: z.string().min(1).max(200),
  exercises: z
    .array(ExerciseItemSchema)
    .min(1, 'each day must have at least one exercise')
    .max(20),
  cardio: z.string().max(300).optional(),
});
export type WorkoutDay = z.infer<typeof WorkoutDaySchema>;

/**
 * Structured workout plan content — persisted as the `plan` JSON column.
 * Validated against LLM output before storage.
 */
export const PlanContentSchema = z.object({
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  exercisesPerDay: z.number().int().min(1).max(8).optional(),
  weeklySchedule: z
    .array(WorkoutDaySchema)
    .min(1, 'weeklySchedule must not be empty'),
  progressionNotes: z.array(z.string().max(500)).max(20),
  recoveryNotes: z.array(z.string().max(500)).max(20),
  nutritionSummary: z.string().max(2000).optional(),
}).refine((content) => content.weeklySchedule.length === content.daysPerWeek, {
  message: 'weeklySchedule must contain exactly daysPerWeek day objects',
  path: ['weeklySchedule'],
});
export type PlanContent = z.infer<typeof PlanContentSchema>;

/**
 * Attempts to parse and validate LLM-generated text as a PlanContent.
 * Returns the parsed content on success, or an error string on failure.
 */
export function parsePlanContent(raw: string): { ok: true; content: PlanContent } | { ok: false; reason: string } {
  // Robust JSON extraction: handle code fences and surrounding explanation text
  function stripCodeFences(s: string) {
    return s.replace(/```\s*json\s*/i, '').replace(/```/g, '');
  }

  function extractFirstJsonObject(s: string): string | null {
    const start = s.indexOf('{');
    if (start < 0) return null;
    let inString = false;
    let escape = false;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return s.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  let parsed: unknown;
  const cleaned = stripCodeFences(raw);
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      return { ok: false, reason: 'LLM did not return any JSON object' };
    }
    try {
      parsed = JSON.parse(extracted);
    } catch {
      try {
        const repaired = extracted.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"');
        parsed = JSON.parse(repaired);
      } catch {
        return { ok: false, reason: 'JSON is malformed and could not be repaired' };
      }
    }
  }

  const normalizedParsed = normalizePlanCandidate(parsed);
  const result = PlanContentSchema.safeParse(normalizedParsed);
  if (!result.success) {
    const detail = result.error.errors
      .slice(0, 3)
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    return { ok: false, reason: `Schema validation failed: ${detail}` };
  }

  return { ok: true, content: result.data };
}

export type AllowedExerciseItem = {
  id: string;
  exerciseName: string;
  bodyPart?: string;
  typeOfActivity?: string;
  typeOfEquipment?: string;
  muscleGroupsActivated?: string[];
};

export type DayExerciseCatalog = {
  dayIndex: number;
  dayGoal: string;
  focusMuscleGroups: string[];
  exercises: AllowedExerciseItem[];
};

/** Build the LLM prompt requesting a structured workout plan JSON.
 *  When `exercisesByDay` is provided, each day gets its own exercise catalog —
 *  this prevents the LLM from picking Bench Press for a Legs day.
 */
export function buildPlanPrompt(
  goal: string,
  durationWeeks: number,
  daysPerWeek: number,
  exercisesPerDay = 4,
  adjustmentContext?: string,
  allowedExercises?: AllowedExerciseItem[],
  trainingLocation?: string,
  exercisesByDay?: DayExerciseCatalog[],
  equipmentPreference?: string,
  evidenceContext?: {
    bodyCompText?: string;
    evidenceText?: string;
  },
): string {
  const adjustNote = adjustmentContext
    ? `\nAdjustment request from user: "${adjustmentContext}"\nApply this adjustment to the plan while keeping the goal and duration the same.\n`
    : '';

  let locationNote: string;
  if (trainingLocation === 'HOME') {
    locationNote = 'Training location: HOME (bodyweight/dumbbell/resistance band only — NO barbell/machine/cable).\n';
  } else if (equipmentPreference === 'MACHINE_ONLY') {
    locationNote = 'Equipment: MACHINE ONLY (cable machines, weight stack machines, smith machine — NO free weights/barbell/dumbbell/bodyweight as main exercises).\n';
  } else {
    locationNote = 'Equipment: GYM MIXED (machine + cable + barbell + dumbbell + bodyweight all available).\n';
  }

  // Build per-day exercise catalog text (strict mode)
  let exerciseCatalogText = '';
  let exampleExerciseA: AllowedExerciseItem | undefined;
  let exampleExerciseB: AllowedExerciseItem | undefined;

  if (exercisesByDay && exercisesByDay.length > 0) {
    exampleExerciseA = exercisesByDay[0]?.exercises?.[0];
    exampleExerciseB = exercisesByDay[0]?.exercises?.[1] ?? exampleExerciseA;

    exerciseCatalogText = '\n=== EXERCISE CATALOG (PER DAY — STRICT) ===\n';
    exerciseCatalogText += 'For Day N, use ONLY ids listed under Day N.\n\n';

    for (const daySpec of exercisesByDay) {
      exerciseCatalogText += `[Day ${daySpec.dayIndex + 1}] ${daySpec.dayGoal} — muscles: ${daySpec.focusMuscleGroups.join(', ')}\n`;
      for (const ex of daySpec.exercises) {
        exerciseCatalogText += `  ${ex.id} | ${ex.exerciseName}\n`;
      }
      exerciseCatalogText += '\n';
    }
    exerciseCatalogText += '=== END CATALOG ===\n';
  } else if (allowedExercises && allowedExercises.length > 0) {
    // Fall back to flat list
    exampleExerciseA = allowedExercises[0];
    exampleExerciseB = allowedExercises[1] ?? allowedExercises[0];
    exerciseCatalogText = `\nAllowed exercises (id | name | muscles | equipment):\n${allowedExercises
      .map((e) => `${e.id} | ${e.exerciseName} | ${(e.muscleGroupsActivated ?? []).join(', ') || 'general'} | ${e.typeOfEquipment ?? 'ANY'}`)
      .join('\n')}\n\n`;
  }

  const exampleIdA = exampleExerciseA?.id ?? 'use-an-allowed-exercise-id';
  const exampleNameA = exampleExerciseA?.exerciseName ?? 'Bench Press';
  const exampleIdB = exampleExerciseB?.id ?? 'use-another-allowed-exercise-id';
  const exampleNameB = exampleExerciseB?.exerciseName ?? 'Overhead Press';

  const isMuscleGain = /tang.*co|tang co|muscle|hypertrophy|gain/i.test(goal);
  const goalInstruction = isMuscleGain
    ? 'Goal = Muscle Gain: Choose STRENGTH exercises (compound + isolation). Do NOT add HIIT or cardio as main exercises.'
    : 'Choose exercises appropriate for the stated goal.';

  return `You are an expert personal trainer.
Return ONLY one compact JSON object. No markdown, no explanation.
Goal: ${goal}
Duration weeks: ${durationWeeks}
Training days per week: ${daysPerWeek}
Exercises per training day: ${exercisesPerDay}
${locationNote}${adjustNote}
${goalInstruction}
Exercise source policy: use ONLY the exercise catalog supplied by fitness-service DB. Do NOT use Qdrant/RAG exercise documents when selecting AI Plan exercises.
${evidenceContext?.bodyCompText ? `\n=== BODY COMPOSITION ANALYSIS (RULE ENGINE) ===\n${evidenceContext.bodyCompText}\n=== END BODY COMPOSITION ANALYSIS ===\n` : ''}
${evidenceContext?.evidenceText ? `\n=== RETRIEVED FITNESS EVIDENCE (ALLOWED SOURCES ONLY) ===\n${evidenceContext.evidenceText}\n=== END RETRIEVED FITNESS EVIDENCE ===\n` : ''}
${exerciseCatalogText}
Use only exerciseId values from the catalog above. Never invent or guess an exerciseId.
Use the user profile, InBody/body metrics, recent workout logs, rule-engine analysis, and retrieved evidence when choosing split, volume, cardio, and nutrition guidance.
Do not diagnose disease or claim to treat medical conditions.
Do not invent titles, source_url values, papers, or guidelines. If you mention evidence, only refer to evidence listed in RETRIEVED FITNESS EVIDENCE.
All user-visible text (day goal, notes, cardio, progressionNotes, recoveryNotes, nutritionSummary) must be Vietnamese.
Keep exercise names exactly as they appear in the catalog.

Required JSON shape:
{
  "goal": "${goal}",
  "durationWeeks": ${durationWeeks},
  "daysPerWeek": ${daysPerWeek},
  "exercisesPerDay": ${exercisesPerDay},
  "weeklySchedule": [
    {
      "day": "Day 1",
      "goal": "Ngực + Vai + Tay sau",
      "exercises": [
        { "exerciseId": "${exampleIdA}", "order": 1, "name": "${exampleNameA}", "sets": 4, "reps": "8-12", "restSeconds": 90, "note": "Bài chính, ưu tiên kỹ thuật chắc và kiểm soát nhịp tập." },
        { "exerciseId": "${exampleIdB}", "order": 2, "name": "${exampleNameB}", "sets": 3, "reps": "10-12", "restSeconds": 75, "note": "Bài bổ trợ, tập kiểm soát và không đánh đổi form để tăng tạ." }
      ],
      "cardio": "Có thể khởi động nhẹ 10 phút trước buổi tập."
    }
  ],
  "progressionNotes": [
    "Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.",
    "Giữ form chuẩn trước khi tăng cường độ."
  ],
  "recoveryNotes": [
    "Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.",
    "Nếu đau nhức kéo dài, hãy giảm khối lượng tập hoặc nghỉ thêm."
  ],
  "nutritionSummary": "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước."
}

STRICT Rules:
- weeklySchedule length must be exactly ${daysPerWeek}.
- Each day must have exactly ${exercisesPerDay} exercises with valid exerciseIds from the catalog.
- Day ${exercisesByDay ? 'N can ONLY use exerciseIds listed under [Day N] in the catalog' : 'goal must describe the body-part split'}.
- Do NOT put a chest/upper-body exercise in a Legs day or vice versa.
- Day goal must name the muscle groups in Vietnamese (e.g. "Chân + Mông", "Ngực + Vai + Tay sau").
- Never output English notes or generic labels like "Training focus", "Main lift", "Workout Day".
- Output must be valid JSON only.
- Do not add fabricated citation fields. Evidence metadata will be attached by the server from retriever metadata.
- Return raw JSON only.`.trim();
}
