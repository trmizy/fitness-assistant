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

function normalizePlanCandidate(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;

  const normalized: UnknownRecord = { ...parsed };

  const normalizedGoal = asNonEmptyString(parsed.goal, 'General fitness');
  normalized.goal = normalizedGoal;
  normalized.durationWeeks = asBoundedInt(parsed.durationWeeks ?? parsed.duration, 4, 1, 52);
  normalized.daysPerWeek = asBoundedInt(parsed.daysPerWeek, 3, 1, 7);
  if (parsed.exercisesPerDay !== undefined) {
    normalized.exercisesPerDay = asBoundedInt(parsed.exercisesPerDay, 4, 1, 8);
  }

  const schedule = Array.isArray(parsed.weeklySchedule) ? parsed.weeklySchedule : [];
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
          note: typeof exercise.note === 'string' && exercise.note.trim() ? exercise.note.trim() : undefined,
        }));

      return {
        day: dayLabel,
        goal: dayGoal,
        exercises: normalizedExercises,
        cardio: typeof dayItem.cardio === 'string' && dayItem.cardio.trim() ? dayItem.cardio.trim() : undefined,
      };
    });

  const progression = Array.isArray(parsed.progressionNotes) ? parsed.progressionNotes : [];
  normalized.progressionNotes = progression
    .filter((note) => typeof note === 'string' && note.trim().length > 0)
    .map((note) => note.trim());
  if ((normalized.progressionNotes as string[]).length === 0) {
    normalized.progressionNotes = [
      'Tăng tải dần theo khả năng hồi phục, ưu tiên kỹ thuật chuẩn trước khi tăng khối lượng tập.',
    ];
  }

  const recovery = Array.isArray(parsed.recoveryNotes) ? parsed.recoveryNotes : [];
  normalized.recoveryNotes = recovery
    .filter((note) => typeof note === 'string' && note.trim().length > 0)
    .map((note) => note.trim());
  if ((normalized.recoveryNotes as string[]).length === 0) {
    normalized.recoveryNotes = ['Ngủ đủ 7-9 tiếng và bố trí ít nhất 1 ngày hồi phục chủ động mỗi tuần.'];
  }

  if (typeof parsed.nutritionSummary === 'string' && parsed.nutritionSummary.trim().length > 0) {
    normalized.nutritionSummary = parsed.nutritionSummary.trim();
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

/** Build the LLM prompt requesting a structured workout plan JSON. */
export function buildPlanPrompt(
  goal: string,
  durationWeeks: number,
  daysPerWeek: number,
  exercisesPerDay = 4,
  adjustmentContext?: string,
  allowedExercises?: Array<{
    id: string;
    exerciseName: string;
    bodyPart?: string;
    typeOfActivity?: string;
    typeOfEquipment?: string;
    muscleGroupsActivated?: string[];
  }>,
): string {
  const adjustNote = adjustmentContext
    ? `\nAdjustment request from user: "${adjustmentContext}"\nApply this adjustment to the plan while keeping the goal and duration the same.\n`
    : '';

  const allowedListText = allowedExercises && allowedExercises.length
    ? `\nAllowed exercises (id | name | body | muscles | equipment):\n${allowedExercises
        .map((e) => `${e.id} | ${e.exerciseName} | ${e.bodyPart ?? 'ANY'} | ${(e.muscleGroupsActivated ?? []).join(', ') || 'general'} | ${e.typeOfEquipment ?? 'ANY'}`)
        .join('\n')}\n\n`
    : '';
  const exampleExerciseA = allowedExercises?.[0];
  const exampleExerciseB = allowedExercises?.[1] ?? allowedExercises?.[0];
  const exampleIdA = exampleExerciseA?.id ?? 'use-an-allowed-exercise-id';
  const exampleNameA = exampleExerciseA?.exerciseName ?? 'Bench Press';
  const exampleIdB = exampleExerciseB?.id ?? 'use-another-allowed-exercise-id';
  const exampleNameB = exampleExerciseB?.exerciseName ?? 'Overhead Press';

  return `You are an expert personal trainer.
Return ONLY one compact JSON object. No markdown, no explanation.
Goal: ${goal}
Duration weeks: ${durationWeeks}
Training days per week: ${daysPerWeek}
Exercises per training day: ${exercisesPerDay}
${adjustNote}
${allowedListText}Use only exerciseId values from the allowed exercises above.
Do not output an "allowedExercises" key. Do not use placeholder ids.
Use descriptive Vietnamese day goals/splits instead of generic labels.
For muscle gain/hypertrophy, prefer splits like "Nguc + Vai + Tay sau", "Lung + Tay truoc", "Chan + Mong", "Vai + Tay", "Upper Body", "Lower Body".
For fat-loss goals, use names like "Full Body Strength", "Lower Body + Conditioning", "Upper Body + Core".

Required JSON shape:
{
  "goal": "${goal}",
  "durationWeeks": ${durationWeeks},
  "daysPerWeek": ${daysPerWeek},
  "exercisesPerDay": ${exercisesPerDay},
  "weeklySchedule": [
    {
      "day": "Day 1",
      "goal": "Nguc + Vai + Tay sau",
      "exercises": [
        { "exerciseId": "${exampleIdA}", "order": 1, "name": "${exampleNameA}", "sets": 4, "reps": "8-12", "restSeconds": 90, "note": "Main lift" },
        { "exerciseId": "${exampleIdB}", "order": 2, "name": "${exampleNameB}", "sets": 3, "reps": "10-12", "restSeconds": 75, "note": "Accessory lift" }
      ],
      "cardio": "Optional 10 min easy warm-up"
    }
  ],
  "progressionNotes": ["Add load or reps gradually when all sets feel controlled."],
  "recoveryNotes": ["Sleep 7-9 hours and keep at least one recovery day weekly."],
  "nutritionSummary": "Protein 1.8-2.2 g/kg/day and calories aligned with the goal."
}

Rules:
- weeklySchedule length must be exactly ${daysPerWeek}.
- Each scheduled day must contain exactly ${exercisesPerDay} exercises.
- Day goal must describe the body-part split, not "Training focus" or "Workout Day".
- Every exerciseId must exactly match an allowed id.
- Choose exercises that fit each day goal/body-part split when possible.
- Return raw JSON only.`.trim();

  return `You are an expert personal trainer.
Generate a ${durationWeeks}-week workout plan for the following goal:
- Goal: ${goal}
- Training days per week: ${daysPerWeek}
${adjustNote}
${allowedListText}IMPORTANT: Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.
DO NOT include any explanatory text before or after the JSON. Do NOT wrap the JSON in triple-backticks (three backticks), do NOT prepend labels such as "JSON:" or "Response:", and do NOT output any comments or markdown. The output MUST be raw JSON only.
The JSON must match this EXACT structure:

{
  "goal": "${goal}",
  "durationWeeks": ${durationWeeks},
  "daysPerWeek": ${daysPerWeek},
  "weeklySchedule": [
    {
      "day": "Day 1 — Push",
      "goal": "Chest, shoulders, triceps",
      "exercises": [
        { "exerciseId": "${exampleIdA}", "order": 1, "name": "${exampleNameA}", "sets": 4, "reps": "8-10", "restSeconds": 90, "note": "Control the descent" },
        { "exerciseId": "${exampleIdB}", "order": 2, "name": "${exampleNameB}", "sets": 3, "reps": "10-12", "restSeconds": 75 }
      ],
      "cardio": "10 min treadmill warm-up"
    }
  ],
  "progressionNotes": [
    "Add 2.5 kg to compound lifts when you can complete all reps at RPE 7 or below for 2 consecutive sessions."
  ],
  "recoveryNotes": [
    "Sleep 7-9 hours. Stretch major muscle groups for 5-10 minutes post-session."
  ],
  "nutritionSummary": "Aim for ${goal.toLowerCase().includes('loss') ? 'a caloric deficit of 300–500 kcal' : 'a slight caloric surplus of 200–300 kcal'} with protein at 1.8–2.2 g per kg of bodyweight."
}

RULES:
- weeklySchedule must contain exactly ${daysPerWeek} day objects
- Every scheduled day must contain at least 1 exercise. Do not create a rest day inside weeklySchedule.
- If the plan needs rest or recovery, place that guidance in recoveryNotes, not as an empty day.
- For each exercise object: 'exerciseId' (string) is REQUIRED and MUST match one of the allowed exercise ids provided above; 'name' must match the canonical exercise name but may be repeated for clarity.
- sets: integer 1–8
- reps: a string like "10", "8-12", "AMRAP", or "30 sec"
- restSeconds: integer 30–600
- Return ONLY the JSON — no other text before or after`.trim();
}
