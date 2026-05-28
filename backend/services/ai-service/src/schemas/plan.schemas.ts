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
  normalized.durationWeeks = asBoundedInt(parsed.durationWeeks, 4, 1, 52);
  normalized.daysPerWeek = asBoundedInt(parsed.daysPerWeek, 3, 1, 7);

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
          order: asBoundedInt(exercise.order, exerciseIndex + 1, 1, 30),
          name: asNonEmptyString(exercise.name, `Exercise ${exerciseIndex + 1}`),
          sets: asBoundedInt(exercise.sets, 3, 1, 10),
          reps: asNonEmptyString(exercise.reps, '8-12'),
          restSeconds: asBoundedInt(exercise.restSeconds, 60, 0, 600),
          note: typeof exercise.note === 'string' && exercise.note.trim() ? exercise.note.trim() : undefined,
        }));

      if (normalizedExercises.length === 0) {
        normalizedExercises.push({
          order: 1,
          name: 'Bodyweight Squat',
          sets: 3,
          reps: '10-12',
          restSeconds: 60,
          note: 'Auto-filled fallback exercise due to missing LLM exercise list.',
        });
      }

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
  weeklySchedule: z
    .array(WorkoutDaySchema)
    .min(1, 'weeklySchedule must not be empty'),
  progressionNotes: z.array(z.string().max(500)).max(20),
  recoveryNotes: z.array(z.string().max(500)).max(20),
  nutritionSummary: z.string().max(2000).optional(),
});
export type PlanContent = z.infer<typeof PlanContentSchema>;

/**
 * Attempts to parse and validate LLM-generated text as a PlanContent.
 * Returns the parsed content on success, or an error string on failure.
 */
export function parsePlanContent(raw: string): { ok: true; content: PlanContent } | { ok: false; reason: string } {
  // Pass 1: direct parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Pass 2: try to extract the JSON object from surrounding text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, reason: 'LLM did not return any JSON object' };
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Pass 3: attempt minor repairs (trailing commas, single quotes)
      try {
        const repaired = jsonMatch[0]
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']')
          .replace(/'/g, '"');
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
  adjustmentContext?: string,
): string {
  const adjustNote = adjustmentContext
    ? `\nAdjustment request from user: "${adjustmentContext}"\nApply this adjustment to the plan while keeping the goal and duration the same.\n`
    : '';

  return `You are an expert personal trainer.
Generate a ${durationWeeks}-week workout plan for the following goal:
- Goal: ${goal}
- Training days per week: ${daysPerWeek}
${adjustNote}
IMPORTANT: Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.
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
        { "order": 1, "name": "Bench Press", "sets": 4, "reps": "8-10", "restSeconds": 90, "note": "Control the descent" },
        { "order": 2, "name": "Overhead Press", "sets": 3, "reps": "10-12", "restSeconds": 75 }
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
- Each day must have 4–8 exercises
- sets: integer 1–8
- reps: a string like "10", "8-12", "AMRAP", or "30 sec"
- restSeconds: integer 30–600
- Return ONLY the JSON — no other text before or after`.trim();
}
