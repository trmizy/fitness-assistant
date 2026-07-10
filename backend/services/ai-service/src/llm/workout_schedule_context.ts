import axios from "axios";
import { logger } from "@gym-coach/shared";
import {
  conversationRepository,
  PlanStatus,
} from "../repositories/conversation.repository";
import type { ResponseLanguage } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://fitness-service:3002"
    : "http://localhost:3002");

const TZ = "Asia/Ho_Chi_Minh";

export type WorkoutScheduleSource =
  | "scheduled_session"
  | "active_workout_program"
  | "generated_ai_plan"
  | "recent_workout_logs"
  | "none";

export interface WorkoutScheduleIntent {
  enabled: boolean;
  target:
    | "today"
    | "tomorrow"
    | "this_week"
    | "specific_weekday"
    | "specific_date"
    | "current_schedule";
  rawMessage?: string;
  normalizedMessage?: string;
  inheritedIntent?: boolean;
  parsedDate?: string;
  parsedDayOfWeek?: number;
  targetDate?: string;
  targetDayOfWeek?: string;
  weekStart?: string;
  weekEnd?: string;
  dateWeekdayMismatch?: boolean;
}

export interface WorkoutScheduleExercise {
  order?: number;
  exerciseId?: string;
  name: string;
  sets?: number | null;
  reps?: number | string | null;
  weight?: number | string | null;
  restSeconds?: number | null;
  notes?: string | null;
}

export interface WorkoutScheduleDayContext {
  date?: string;
  dayNumber?: number;
  title?: string;
  muscleGroups: string[];
  exercises: WorkoutScheduleExercise[];
  source: WorkoutScheduleSource;
}

export interface WorkoutScheduleContext {
  activePlanName?: string;
  planFrequency?: number;
  targetDate?: string;
  targetDayOfWeek?: string;
  weekStart?: string;
  weekEnd?: string;
  scheduledWorkoutFound: boolean;
  workoutName?: string;
  muscleGroups: string[];
  exercises: WorkoutScheduleExercise[];
  days?: WorkoutScheduleDayContext[];
  source: WorkoutScheduleSource;
  message?: string;
}

function authHeaders(
  authorizationHeader?: string,
): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateInTz(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromDateOnly(dateOnly: string): Date {
  // Use noon in Vietnam time so date-only math never slides to the previous UTC day.
  return new Date(`${dateOnly}T12:00:00+07:00`);
}

function addDays(dateOnly: string, days: number): string {
  const d = dateFromDateOnly(dateOnly);
  d.setDate(d.getDate() + days);
  return formatDateInTz(d);
}

function weekdayLabel(
  dateOnly: string,
  language: ResponseLanguage = "vi",
): string {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
    timeZone: TZ,
    weekday: "long",
  }).format(dateFromDateOnly(dateOnly));
}

function weekdayIndex(dateOnly: string): number {
  return dateFromDateOnly(dateOnly).getDay();
}

function mondayOf(dateOnly: string): string {
  const d = dateFromDateOnly(dateOnly);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDateInTz(d);
}

function detectSpecificWeekday(q: string): number | undefined {
  const m = q.match(/\bthu\s*(2|3|4|5|6|7)\b/);
  if (m) return Number(m[1]) - 1; // JS weekday: Mon=1..Sat=6
  if (/\b(thu\s*hai|monday)\b/.test(q)) return 1;
  if (/\b(thu\s*ba|tuesday)\b/.test(q)) return 2;
  if (/\b(thu\s*tu|wednesday)\b/.test(q)) return 3;
  if (/\b(thu\s*nam|thursday)\b/.test(q)) return 4;
  if (/\b(thu\s*sau|friday)\b/.test(q)) return 5;
  if (/\b(thu\s*bay|saturday)\b/.test(q)) return 6;
  if (/\b(chu nhat|sunday)\b/.test(q)) return 0;
  if (/\bmonday\b/.test(q)) return 1;
  if (/\btuesday\b/.test(q)) return 2;
  if (/\bwednesday\b/.test(q)) return 3;
  if (/\bthursday\b/.test(q)) return 4;
  if (/\bfriday\b/.test(q)) return 5;
  if (/\bsaturday\b/.test(q)) return 6;
  return undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseExplicitDate(q: string, today: string): string | undefined {
  const currentYear = Number(today.slice(0, 4));
  const numeric = q.match(
    /\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/,
  );
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const vi = q.match(
    /\b(?:ngay\s*)?(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*nam\s*(\d{2,4}))?\b/,
  );
  if (vi) {
    const day = Number(vi[1]);
    const month = Number(vi[2]);
    const year = vi[3]
      ? Number(vi[3].length === 2 ? `20${vi[3]}` : vi[3])
      : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const monthNumbers: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const en = q.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})(?:,?\s*(\d{2,4}))?\b/,
  );
  if (en) {
    const month = monthNumbers[en[1]];
    const day = Number(en[2]);
    const year = en[3]
      ? Number(en[3].length === 2 ? `20${en[3]}` : en[3])
      : currentYear;
    if (month && day >= 1 && day <= 31)
      return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return undefined;
}

function isScheduleConversation(chatHistory?: any[]): boolean {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return false;
  return chatHistory.slice(0, 4).some((entry) => {
    const text = normalizeText(
      `${entry?.question ?? ""} ${entry?.answer ?? ""}`,
    );
    return /(lich tap|tap gi|workout schedule|scheduled_session|theo lich|ngay mai|hom nay|thu\s*[2-7])/.test(
      text,
    );
  });
}

function isWorkoutSafetyQuestion(q: string): boolean {
  return (
    /(chan thuong|injury|pain|dau\s*(goi|lung|vai|khop)|bi dau|gay chan thuong|co bi chan thuong|co gay chan thuong)/.test(
      q,
    ) ||
    (/co\s*(nen|the)\b/.test(q) && /\bkhong\b/.test(q))
  );
}

function asksStoredWorkoutDetails(q: string): boolean {
  return /(lich tap|lich cua toi|toi tap gi|tap gi|workout schedule|what should i train)/.test(
    q,
  );
}

function hasScheduleFollowUpSignal(q: string): boolean {
  return /(^|\b)(con|vay|the|thi sao|what about|how about|and|then)\b/.test(q);
}

function asksForWeeklySchedule(q: string): boolean {
  return (
    /(lich tap|workout schedule|training schedule|workout plan)/.test(q) &&
    /(1\s*tuan|mot\s*tuan|ca\s*tuan|tuan\s*nay|weekly|one\s*week|7\s*ngay)/.test(
      q,
    )
  );
}

function isWorkoutPlanCreationRequest(q: string): boolean {
  const hasCreateVerb =
    /\b(tao|lap|len|thiet ke|build|create|generate|make)\b/.test(q);
  const hasPlanNoun =
    /(lich tap|ke hoach tap|chuong trinh tap|workout plan|training plan|program)/.test(
      q,
    );
  const wantsDifferentPlan =
    /(khac voi|doi lich|lich moi|plan moi|chuong trinh moi|khac lich hien tai)/.test(
      q,
    );
  return (hasCreateVerb && hasPlanNoun) || (hasPlanNoun && wantsDifferentPlan);
}

export function detectWorkoutScheduleIntent(
  question: string,
  chatHistory?: any[],
): WorkoutScheduleIntent {
  const q = normalizeText(question);
  const today = formatDateInTz(new Date());
  const parsedDate = parseExplicitDate(q, today);
  const parsedDayOfWeek = detectSpecificWeekday(q);
  const inheritedIntent = isScheduleConversation(chatHistory);

  if (
    /^(tao|create|generate|lap)\b/.test(q) ||
    isWorkoutPlanCreationRequest(q)
  ) {
    return {
      enabled: false,
      target: "current_schedule",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
    };
  }

  const scheduleSignals =
    /(hom nay|ngay mai|tuan nay|tuan sau|lich tap|lich cua toi|toi tap gi|tap gi|workout schedule|train today|train tomorrow|workout today|workout tomorrow|what should i train|what about)/;
  const hasDateOrDay =
    parsedDate !== undefined || parsedDayOfWeek !== undefined;
  const hasDirectScheduleSignal =
    scheduleSignals.test(q) || asksForWeeklySchedule(q);
  const inheritedFollowUp =
    inheritedIntent &&
    (hasDateOrDay ||
      hasScheduleFollowUpSignal(q) ||
      /(hom nay|ngay mai|today|tomorrow)/.test(q));
  if (isWorkoutSafetyQuestion(q) && !asksStoredWorkoutDetails(q)) {
    return {
      enabled: false,
      target: "current_schedule",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      parsedDate,
      parsedDayOfWeek,
    };
  }
  const asksWorkoutLookup =
    hasDirectScheduleSignal || hasDateOrDay || inheritedFollowUp;

  if (!asksWorkoutLookup) {
    return {
      enabled: false,
      target: "current_schedule",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      parsedDate,
      parsedDayOfWeek,
    };
  }

  if (parsedDate) {
    const mismatch =
      parsedDayOfWeek !== undefined &&
      weekdayIndex(parsedDate) !== parsedDayOfWeek;
    return {
      enabled: true,
      target: "specific_date",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      parsedDate,
      parsedDayOfWeek,
      targetDate: parsedDate,
      targetDayOfWeek: weekdayLabel(parsedDate),
      dateWeekdayMismatch: mismatch,
    };
  }

  if (asksForWeeklySchedule(q)) {
    const start = mondayOf(today);
    return {
      enabled: true,
      target: "this_week",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      weekStart: start,
      weekEnd: addDays(start, 6),
    };
  }

  if (/(ngay mai|tomorrow)/.test(q)) {
    const targetDate = addDays(today, 1);
    return {
      enabled: true,
      target: "tomorrow",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      parsedDayOfWeek,
      targetDate,
      targetDayOfWeek: weekdayLabel(targetDate),
    };
  }

  if (parsedDayOfWeek !== undefined) {
    const startOfThisWeek = mondayOf(today);
    const searchStart = /(tuan sau|next week)/.test(q)
      ? addDays(startOfThisWeek, 7)
      : /(tuan nay|this week)/.test(q) || inheritedIntent
        ? startOfThisWeek
        : today;
    let targetDate = searchStart;
    for (let i = 0; i < 7; i += 1) {
      const candidate = addDays(searchStart, i);
      if (weekdayIndex(candidate) === parsedDayOfWeek) {
        targetDate = candidate;
        break;
      }
    }
    return {
      enabled: true,
      target: "specific_weekday",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      parsedDayOfWeek,
      targetDate,
      targetDayOfWeek: weekdayLabel(targetDate),
    };
  }

  if (/(tuan nay|this week)/.test(q)) {
    const start = mondayOf(today);
    return {
      enabled: true,
      target: "this_week",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      weekStart: start,
      weekEnd: addDays(start, 6),
    };
  }

  if (/(hom nay|today|what should i train|toi tap gi|tap gi)/.test(q)) {
    return {
      enabled: true,
      target: "today",
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      targetDate: today,
      targetDayOfWeek: weekdayLabel(today),
    };
  }

  return {
    enabled: true,
    target: "current_schedule",
    rawMessage: question,
    normalizedMessage: q,
    inheritedIntent,
    targetDate: today,
    targetDayOfWeek: weekdayLabel(today),
  };
}

function unwrap<T>(payload: any): T {
  return (payload?.data?.data ?? payload?.data ?? payload) as T;
}

function dateOnly(value: unknown): string | undefined {
  if (!value) return undefined;
  return String(value).slice(0, 10);
}

function exerciseName(ex: any): string {
  return (
    ex?.exercise?.exerciseName ||
    ex?.exerciseName ||
    ex?.name ||
    ex?.title ||
    "Unknown Exercise"
  );
}

function muscleGroupsFromExercises(
  exercises: WorkoutScheduleExercise[],
  rawExercises?: any[],
): string[] {
  const groups = new Set<string>();
  for (const raw of rawExercises || []) {
    const exercise = raw?.exercise ?? raw;
    const list = exercise?.muscleGroupsActivated;
    if (Array.isArray(list)) {
      for (const item of list) if (item) groups.add(String(item));
    }
    if (exercise?.bodyPart) groups.add(String(exercise.bodyPart));
  }
  for (const ex of exercises) {
    const note = `${ex.notes ?? ""} ${ex.name}`;
    if (/chest|press|bench/i.test(note)) groups.add("Chest");
    if (/back|row|pulldown|pull-up/i.test(note)) groups.add("Back");
    if (/leg|squat|lunge|deadlift/i.test(note)) groups.add("Legs");
    if (/shoulder|raise|overhead/i.test(note)) groups.add("Shoulders");
    if (/biceps|curl/i.test(note)) groups.add("Biceps");
    if (/triceps|pushdown|extension/i.test(note)) groups.add("Triceps");
    if (/core|abs|plank/i.test(note)) groups.add("Core");
  }
  return Array.from(groups).slice(0, 6);
}

function mapProgramExercises(rawExercises?: any[]): WorkoutScheduleExercise[] {
  if (!Array.isArray(rawExercises)) return [];
  return rawExercises
    .slice()
    .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
    .map((ex, idx) => ({
      order: Number(ex?.order ?? idx + 1),
      exerciseId: ex?.exerciseId ?? ex?.exercise?.id,
      name: exerciseName(ex),
      sets: ex?.sets ?? null,
      reps: ex?.reps ?? null,
      weight: ex?.weight ?? null,
      restSeconds: ex?.restSeconds ?? null,
      notes: ex?.notes ?? null,
    }));
}

function contextFromProgramDay(
  day: any,
  date: string | undefined,
  source: WorkoutScheduleSource,
): WorkoutScheduleDayContext {
  const exercises = mapProgramExercises(day?.exercises);
  return {
    date,
    dayNumber: day?.dayNumber,
    title: day?.title,
    muscleGroups: muscleGroupsFromExercises(exercises, day?.exercises),
    exercises,
    source,
  };
}

function contextFromSchedule(
  schedule: any,
  targetDate?: string,
): WorkoutScheduleContext | null {
  const day = schedule?.programDay;
  if (!day) return null;
  const dayContext = contextFromProgramDay(
    day,
    dateOnly(schedule?.date) ?? targetDate,
    "scheduled_session",
  );
  const program = day?.program;
  return {
    activePlanName: program?.name,
    planFrequency: program?.daysPerWeek,
    targetDate: dayContext.date ?? targetDate,
    targetDayOfWeek: dayContext.date
      ? weekdayLabel(dayContext.date)
      : undefined,
    scheduledWorkoutFound: dayContext.exercises.length > 0,
    workoutName: dayContext.title,
    muscleGroups: dayContext.muscleGroups,
    exercises: dayContext.exercises,
    days: [dayContext],
    source: "scheduled_session",
  };
}

function getProgramDays(program: any): any[] {
  return Array.isArray(program?.days)
    ? program.days
        .slice()
        .sort(
          (a: any, b: any) =>
            Number(a?.dayNumber ?? 0) - Number(b?.dayNumber ?? 0),
        )
    : [];
}

function dayContextFromCurrentProgram(
  program: any,
  intent: WorkoutScheduleIntent,
): WorkoutScheduleContext | null {
  const days = getProgramDays(program);
  if (!program || days.length === 0) return null;

  if (intent.target === "this_week") {
    const mappedDays = days.map((day: any, idx: number) =>
      contextFromProgramDay(
        day,
        intent.weekStart ? addDays(intent.weekStart, idx) : undefined,
        "active_workout_program",
      ),
    );
    return {
      activePlanName: program.name,
      planFrequency: program.daysPerWeek,
      weekStart: intent.weekStart,
      weekEnd: intent.weekEnd,
      targetDate: intent.targetDate,
      targetDayOfWeek: intent.targetDayOfWeek,
      scheduledWorkoutFound: mappedDays.some((d) => d.exercises.length > 0),
      workoutName: program.name,
      muscleGroups: Array.from(
        new Set(mappedDays.flatMap((d) => d.muscleGroups)),
      ).slice(0, 8),
      exercises: mappedDays[0]?.exercises ?? [],
      days: mappedDays,
      source: "active_workout_program",
    };
  }

  const scheduleRows = Array.isArray(program?.schedules)
    ? program.schedules
    : [];
  const exact = scheduleRows.find(
    (s: any) => intent.targetDate && dateOnly(s?.date) === intent.targetDate,
  );
  if (exact?.programDay) {
    return contextFromSchedule(exact, intent.targetDate);
  }
  if (intent.target === "specific_date") {
    return null;
  }

  const targetIdx = intent.targetDate ? weekdayIndex(intent.targetDate) : 1;
  const matchingSchedule = scheduleRows.find((s: any) => {
    const d = dateOnly(s?.date);
    return d && weekdayIndex(d) === targetIdx && s?.programDay;
  });
  if (matchingSchedule?.programDay) {
    return contextFromSchedule(
      { ...matchingSchedule, date: intent.targetDate ?? matchingSchedule.date },
      intent.targetDate,
    );
  }

  const selected =
    days[
      Math.max(
        0,
        Math.min(
          days.length - 1,
          targetIdx === 0 ? days.length - 1 : targetIdx - 1,
        ),
      )
    ] ?? days[0];
  const dayContext = contextFromProgramDay(
    selected,
    intent.targetDate,
    "active_workout_program",
  );
  return {
    activePlanName: program.name,
    planFrequency: program.daysPerWeek,
    targetDate: intent.targetDate,
    targetDayOfWeek: intent.targetDayOfWeek,
    scheduledWorkoutFound: dayContext.exercises.length > 0,
    workoutName: dayContext.title,
    muscleGroups: dayContext.muscleGroups,
    exercises: dayContext.exercises,
    days: [dayContext],
    source: "active_workout_program",
  };
}

function aiPlanDays(planJson: any): any[] {
  if (Array.isArray(planJson?.weeklySchedule)) return planJson.weeklySchedule;
  if (Array.isArray(planJson?.workout_plan?.weeklySchedule))
    return planJson.workout_plan.weeklySchedule;
  if (Array.isArray(planJson?.plan?.weeklySchedule))
    return planJson.plan.weeklySchedule;
  if (Array.isArray(planJson?.workout?.weeklySchedule))
    return planJson.workout.weeklySchedule;
  return [];
}

function dayContextFromAiPlan(
  planRow: any,
  intent: WorkoutScheduleIntent,
): WorkoutScheduleContext | null {
  const days = aiPlanDays(planRow?.plan);
  if (!days.length) return null;

  const mapDay = (
    day: any,
    idx: number,
    date?: string,
  ): WorkoutScheduleDayContext => {
    const exercises = Array.isArray(day?.exercises)
      ? day.exercises.map((ex: any, exIdx: number) => ({
          order: ex?.order ?? exIdx + 1,
          exerciseId: ex?.exerciseId,
          name: exerciseName(ex),
          sets: ex?.sets ?? null,
          reps: ex?.reps ?? null,
          weight: ex?.weight ?? null,
          restSeconds: ex?.restSeconds ?? null,
          notes: ex?.note ?? ex?.notes ?? null,
        }))
      : [];
    return {
      date,
      dayNumber: Number(day?.day ?? day?.dayNumber ?? idx + 1),
      title: day?.goal ?? day?.focus ?? day?.title,
      muscleGroups: muscleGroupsFromExercises(exercises),
      exercises,
      source: "generated_ai_plan",
    };
  };

  if (intent.target === "this_week") {
    const mappedDays = days.map((day: any, idx: number) =>
      mapDay(
        day,
        idx,
        intent.weekStart ? addDays(intent.weekStart, idx) : undefined,
      ),
    );
    return {
      activePlanName: planRow.name,
      planFrequency: planRow.daysPerWeek,
      weekStart: intent.weekStart,
      weekEnd: intent.weekEnd,
      scheduledWorkoutFound: mappedDays.some((d) => d.exercises.length > 0),
      workoutName: planRow.name,
      muscleGroups: Array.from(
        new Set(mappedDays.flatMap((d) => d.muscleGroups)),
      ).slice(0, 8),
      exercises: mappedDays[0]?.exercises ?? [],
      days: mappedDays,
      source: "generated_ai_plan",
    };
  }
  if (intent.target === "specific_date") {
    return null;
  }

  const targetIdx = intent.targetDate ? weekdayIndex(intent.targetDate) : 1;
  const selected =
    days[
      Math.max(
        0,
        Math.min(
          days.length - 1,
          targetIdx === 0 ? days.length - 1 : targetIdx - 1,
        ),
      )
    ] ?? days[0];
  const dayContext = mapDay(
    selected,
    days.indexOf(selected),
    intent.targetDate,
  );
  return {
    activePlanName: planRow.name,
    planFrequency: planRow.daysPerWeek,
    targetDate: intent.targetDate,
    targetDayOfWeek: intent.targetDayOfWeek,
    scheduledWorkoutFound: dayContext.exercises.length > 0,
    workoutName: dayContext.title,
    muscleGroups: dayContext.muscleGroups,
    exercises: dayContext.exercises,
    days: [dayContext],
    source: "generated_ai_plan",
  };
}

function dayContextFromRecentLogs(
  logs: any[],
  intent: WorkoutScheduleIntent,
): WorkoutScheduleContext | null {
  const latest = Array.isArray(logs) ? logs[0] : null;
  if (!latest) return null;
  const rawExercises = Array.isArray(latest?.exercises) ? latest.exercises : [];
  const exercises = rawExercises.map((ex: any, idx: number) => ({
    order: idx + 1,
    exerciseId: ex?.exerciseId ?? ex?.exercise?.id,
    name: exerciseName(ex),
    sets: ex?.sets ?? null,
    reps: ex?.reps ?? null,
    weight: ex?.weight ?? null,
    notes: ex?.notes ?? null,
  }));
  return {
    targetDate: intent.targetDate,
    targetDayOfWeek: intent.targetDayOfWeek,
    scheduledWorkoutFound: false,
    workoutName: latest?.name,
    muscleGroups: muscleGroupsFromExercises(exercises, rawExercises),
    exercises,
    days: [
      {
        date: dateOnly(latest?.date),
        title: latest?.name,
        muscleGroups: muscleGroupsFromExercises(exercises, rawExercises),
        exercises,
        source: "recent_workout_logs",
      },
    ],
    source: "recent_workout_logs",
    message:
      "No stored schedule was found; only recent workout logs are available.",
  };
}

async function fetchSchedules(
  intent: WorkoutScheduleIntent,
  authHeader?: string,
): Promise<any[]> {
  if (!authHeader) return [];
  const params: Record<string, string | number> = { limit: 50 };
  if (intent.target === "this_week") {
    if (intent.weekStart) params.startDate = intent.weekStart;
    if (intent.weekEnd) params.endDate = intent.weekEnd;
  } else if (intent.targetDate) {
    params.startDate = intent.targetDate;
    params.endDate = intent.targetDate;
  }
  const res = await axios.get(`${FITNESS_SERVICE_URL}/workouts/schedules`, {
    headers: authHeaders(authHeader),
    params,
    timeout: 3500,
  });
  const data = unwrap<any>(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.schedules)) return data.schedules;
  return [];
}

async function fetchCurrentProgram(authHeader?: string): Promise<any | null> {
  if (!authHeader) return null;
  const res = await axios.get(
    `${FITNESS_SERVICE_URL}/workouts/programs/current`,
    {
      headers: authHeaders(authHeader),
      timeout: 3500,
    },
  );
  const data = unwrap<any>(res);
  return data?.program ?? data ?? null;
}

async function fetchRecentLogs(authHeader?: string): Promise<any[]> {
  if (!authHeader) return [];
  const res = await axios.get(`${FITNESS_SERVICE_URL}/workouts`, {
    headers: authHeaders(authHeader),
    params: { limit: 10 },
    timeout: 3500,
  });
  const data = unwrap<any>(res);
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.workouts)
      ? data.workouts
      : [];
}

function emptyContext(
  intent: WorkoutScheduleIntent,
  message?: string,
): WorkoutScheduleContext {
  return {
    targetDate: intent.targetDate,
    targetDayOfWeek: intent.targetDayOfWeek,
    weekStart: intent.weekStart,
    weekEnd: intent.weekEnd,
    scheduledWorkoutFound: false,
    muscleGroups: [],
    exercises: [],
    days: [],
    source: "none",
    message,
  };
}

export function buildWorkoutScheduleContextBlock(
  context: WorkoutScheduleContext,
): string {
  const lines = [
    "USER_WORKOUT_SCHEDULE_CONTEXT",
    `activePlanName=${context.activePlanName ?? "none"}`,
    `planFrequency=${context.planFrequency ?? "unknown"}`,
    `targetDate=${context.targetDate ?? "unknown"}`,
    `targetDayOfWeek=${context.targetDayOfWeek ?? "unknown"}`,
    `scheduledWorkoutFound=${context.scheduledWorkoutFound}`,
    `workoutName=${context.workoutName ?? "none"}`,
    `muscleGroups=${context.muscleGroups.length ? context.muscleGroups.join(", ") : "none"}`,
    `source=${context.source}`,
  ];
  if (context.days?.length) {
    for (const day of context.days.slice(0, 7)) {
      lines.push(
        `day=${day.date ?? day.dayNumber ?? "?"} | title=${day.title ?? "Workout"} | exercises=${day.exercises.length}`,
      );
      for (const ex of day.exercises.slice(0, 12)) {
        lines.push(
          `- ${ex.name} | sets=${ex.sets ?? "?"} | reps=${ex.reps ?? "?"} | rest=${ex.restSeconds ?? "?"}s`,
        );
      }
    }
  }
  if (context.message) lines.push(`message=${context.message}`);
  return lines.join("\n");
}

export function workoutScheduleSourceLabel(
  source: WorkoutScheduleSource,
  language: ResponseLanguage = "vi",
): string {
  if (language !== "vi") {
    return {
      scheduled_session: "Workout log",
      active_workout_program: "Saved workout schedule",
      generated_ai_plan: "Saved AI plan",
      recent_workout_logs: "Recent workout logs",
      none: "No stored data",
    }[source];
  }
  return {
    scheduled_session: "Nhật ký tập luyện",
    active_workout_program: "Lịch tập đã lưu",
    generated_ai_plan: "Kế hoạch AI đã lưu",
    recent_workout_logs: "Nhật ký tập gần đây",
    none: "Không có dữ liệu",
  }[source];
}

export function formatWorkoutScheduleAnswer(
  context: WorkoutScheduleContext,
  language: ResponseLanguage,
): string {
  const isVi = language === "vi";
  const targetLabel = context.targetDate
    ? `${context.targetDayOfWeek ?? ""} ${context.targetDate}`.trim()
    : context.weekStart && context.weekEnd
      ? `${context.weekStart} -> ${context.weekEnd}`
      : isVi
        ? "ngày này"
        : "that date";
  if (
    !context.scheduledWorkoutFound ||
    (!context.exercises.length &&
      !context.days?.some((d) => d.exercises.length))
  ) {
    if (context.source === "recent_workout_logs") {
      return isVi
        ? `Mình chưa thấy lịch tập cụ thể được lưu cho ${targetLabel}. Mình chỉ thấy lịch sử buổi tập gần nhất, nên chưa tự suy ra bài cho ngày này từ đó.`
        : `I cannot find a stored workout schedule for ${targetLabel}.`;
    }
    return isVi
      ? `Mình chưa thấy lịch tập cụ thể được lưu cho ${targetLabel}.`
      : `I cannot find a stored workout schedule for ${targetLabel}.`;
  }
  if (
    !context.scheduledWorkoutFound ||
    (!context.exercises.length &&
      !context.days?.some((d) => d.exercises.length))
  ) {
    if (context.source === "recent_workout_logs") {
      return isVi
        ? "Mình chưa thấy lịch tập đã lưu cho ngày này trong hệ thống. Mình chỉ thấy lịch sử buổi tập gần nhất, nên chưa nên tự suy ra bài hôm nay từ đó. Hãy lưu lịch tập vào Nhật ký tập hoặc AI Plans trước để mình đọc đúng lịch."
        : "I cannot find a stored workout schedule for that date. I only see recent workout logs, so I should not infer today’s workout from them. Save a workout schedule first and I can read it back exactly.";
    }
    return isVi
      ? "Mình chưa thấy lịch tập đã lưu cho ngày này trong hệ thống. Bạn có thể tạo/lưu lịch tập trong Nhật ký tập hoặc AI Plans, rồi hỏi lại mình sẽ đọc đúng lịch đã lưu."
      : "I cannot find a stored workout schedule for that date. Create or save a workout schedule first, then I can read the stored schedule exactly.";
  }

  const headingDate = context.targetDate
    ? `${context.targetDayOfWeek ?? ""} ${context.targetDate}`.trim()
    : context.weekStart && context.weekEnd
      ? `${context.weekStart} -> ${context.weekEnd}`
      : isVi
        ? "lịch hiện tại"
        : "current schedule";

  const intro = isVi
    ? `Theo lịch tập đã lưu, ${headingDate} của bạn là **${context.workoutName ?? context.activePlanName ?? "Workout"}**${context.activePlanName ? ` trong plan **${context.activePlanName}**` : ""}.`
    : `Based on your saved workout schedule, ${headingDate} is **${context.workoutName ?? context.activePlanName ?? "Workout"}**${context.activePlanName ? ` from **${context.activePlanName}**` : ""}.`;

  const renderExercises = (exercises: WorkoutScheduleExercise[]) =>
    exercises
      .map((ex, idx) => {
        const sets = ex.sets ?? "?";
        const reps = ex.reps ?? "?";
        const rest = ex.restSeconds ? `${ex.restSeconds}s` : "?";
        return `| ${idx + 1} | ${ex.name} | ${sets} | ${reps} | ${rest} |`;
      })
      .join("\n");

  if (context.days && context.days.length > 1) {
    const sections = context.days.map((day) => {
      const title = `### ${day.date ?? `Day ${day.dayNumber ?? ""}`} - ${day.title ?? "Workout"}`;
      return [
        title,
        "| # | Bài tập | Sets | Reps | Rest |",
        "|---|---------|------|------|------|",
        renderExercises(day.exercises),
      ].join("\n");
    });
    return [
      intro,
      "",
      ...sections,
      "",
      isVi
        ? `Nguồn: ${workoutScheduleSourceLabel(context.source, language)}.`
        : `Source: ${workoutScheduleSourceLabel(context.source, language)}.`,
    ].join("\n");
  }

  return [
    intro,
    "",
    context.muscleGroups.length
      ? `**Nhóm cơ:** ${context.muscleGroups.join(", ")}`
      : "",
    "",
    "| # | Bài tập | Sets | Reps | Rest |",
    "|---|---------|------|------|------|",
    renderExercises(context.exercises),
    "",
    isVi
      ? `Nguồn: ${workoutScheduleSourceLabel(context.source, language)}.`
      : `Source: ${workoutScheduleSourceLabel(context.source, language)}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const workoutScheduleContextResolver = {
  async resolve(
    intent: WorkoutScheduleIntent,
    userId?: string,
    authHeader?: string,
  ): Promise<WorkoutScheduleContext> {
    if (!intent.enabled || !userId) return emptyContext(intent);

    try {
      const schedules = await fetchSchedules(intent, authHeader);
      if (intent.target === "this_week" && schedules.length > 0) {
        const days = schedules
          .map((schedule) =>
            contextFromSchedule(schedule, dateOnly(schedule?.date)),
          )
          .filter(Boolean)
          .map((ctx) => ctx!.days?.[0])
          .filter(Boolean) as WorkoutScheduleDayContext[];
        return {
          activePlanName: schedules[0]?.programDay?.program?.name,
          planFrequency: schedules[0]?.programDay?.program?.daysPerWeek,
          weekStart: intent.weekStart,
          weekEnd: intent.weekEnd,
          scheduledWorkoutFound: days.some((d) => d.exercises.length > 0),
          workoutName: schedules[0]?.programDay?.program?.name,
          muscleGroups: Array.from(
            new Set(days.flatMap((d) => d.muscleGroups)),
          ).slice(0, 8),
          exercises: days[0]?.exercises ?? [],
          days,
          source: "scheduled_session",
        };
      }
      const exactSchedule = schedules.find(
        (s) => !intent.targetDate || dateOnly(s?.date) === intent.targetDate,
      );
      const exactContext = contextFromSchedule(
        exactSchedule,
        intent.targetDate,
      );
      if (exactContext?.scheduledWorkoutFound) return exactContext;
    } catch (err) {
      logger.warn({ err }, "Failed to load workout schedules for AI coach");
    }

    try {
      const program = await fetchCurrentProgram(authHeader);
      const programContext = dayContextFromCurrentProgram(program, intent);
      if (programContext?.scheduledWorkoutFound) return programContext;
    } catch (err) {
      logger.warn(
        { err },
        "Failed to load current workout program for AI coach",
      );
    }

    try {
      const plans = await conversationRepository.findPlansByUser(
        userId,
        PlanStatus.COMPLETED,
        5,
      );
      for (const plan of plans) {
        const planContext = dayContextFromAiPlan(plan, intent);
        if (planContext?.scheduledWorkoutFound) return planContext;
      }
    } catch (err) {
      logger.warn(
        { err },
        "Failed to load generated AI plans for AI coach schedule context",
      );
    }

    try {
      const logs = await fetchRecentLogs(authHeader);
      const logContext = dayContextFromRecentLogs(logs, intent);
      if (logContext) return logContext;
    } catch (err) {
      logger.warn(
        { err },
        "Failed to load recent workout logs for AI coach schedule context",
      );
    }

    return emptyContext(intent, "No stored workout schedule found.");
  },

  debug(
    intent: WorkoutScheduleIntent,
    context: WorkoutScheduleContext,
    userId?: string,
  ): void {
    if (process.env.DEBUG_WORKOUT_SCHEDULE !== "true") return;
    logger.info(
      {
        userId,
        rawMessage: intent.rawMessage,
        normalizedMessage: intent.normalizedMessage,
        inheritedIntent: intent.inheritedIntent ?? false,
        parsedDate: intent.parsedDate,
        parsedDayOfWeek: intent.parsedDayOfWeek,
        target: intent.target,
        targetDate: intent.targetDate,
        weekStart: intent.weekStart,
        weekEnd: intent.weekEnd,
        scheduleSource: context.source,
        activePlanName: context.activePlanName,
        planFrequency: context.planFrequency,
        scheduledWorkoutFound: context.scheduledWorkoutFound,
        exerciseCount: context.exercises.length,
        dayCount: context.days?.length ?? 0,
        fallbackBlocked: context.source === "none",
        dateWeekdayMismatch: intent.dateWeekdayMismatch ?? false,
      },
      "AI coach workout schedule context resolved",
    );
  },
};
