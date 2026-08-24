import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dumbbell,
  ChevronLeft,
  ChevronRight,
  Plus,
  Lock,
  AlertCircle,
  Share2,
  Star,
  ArrowUpDown,
  ChevronDown,
  Clock,
  MessageSquare,
  Timer,
  Target,
  BarChart3,
  Zap,
  Calendar,
  CalendarDays,
  TrendingUp,
  Play,
  GripVertical,
  Trash2,
  Check,
  X,
  SkipForward,
  Pause,
  RotateCcw,
  Trophy,
  PartyPopper,
  Search,
  SlidersHorizontal,
  Loader2,
  Repeat,
} from "lucide-react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import { ImageWithFallback } from "../../components/figma/ImageWithFallback";
import { RulerSlider } from "../../components/RulerSlider";
import {
  parseInitialWorkoutLogState,
  resolveExerciseIndexFromId,
  computeWorkoutLogSearchParams,
} from "./workout-log-url.utils";
import { mergeRealWorkoutData } from "./workout-log-completion-merge.utils";
import { selectSmartSetPrefill, type SmartPrefillSource } from "./smart-set-prefill.utils";
import {
  persistActiveLogDraft,
  readPersistedActiveLogDraft,
  clearPersistedActiveLogDraft,
} from "./active-log-draft.utils";
import { computeNextExerciseRestSeconds } from "./exercise-group.utils";
import {
  enqueueWorkoutEvent,
  getPendingWorkoutEvents,
  removeWorkoutEvent,
  buildQueuedSetEvent,
} from "./active-workout-offline-queue.utils";
import {
  computeMuscleGroupDistribution,
  computeActivityTypeDistribution,
} from "./workout-analytics.utils";
import {
  isScheduleDateApiValueLocked,
  isScheduleDateApiValuePast,
  scheduledDateLabelFromApi,
  calendarDateLabel,
  scheduleLockDirection,
  APP_SCHEDULE_TIME_ZONE,
} from "./schedule-lock.utils";
import { requestWakeLockSafe, releaseWakeLockSafe } from "./wake-lock.utils";
import {
  api,
  workoutService,
  inbodyService,
  sessionFeedbackService,
  exerciseService,
  type WorkoutScheduleRecord,
  type SessionFeedbackDifficulty,
  type SessionFeedbackEnjoyment,
  type SessionFeedbackWouldRepeat,
  type SessionFeedbackPerceivedProgress,
  type ExerciseFeedbackIssueType,
  type ExerciseFeedbackItemInput,
  type SessionSkipReason,
  type ExerciseSubstitute,
  type WorkoutSessionSummary,
  type PreviousPerformance,
  type ExerciseProgression,
} from "../../services/api";
import { StarRating } from "../../components/StarRating";
import ExerciseMuscleMap from "../../components/ExerciseMuscleMap";

// Format helper
const formatVideoUrlToImg = (
  videoUrl: string | null | undefined,
  frame: 0 | 1,
) => {
  if (!videoUrl) return null;
  // If it's already a github raw url ending in .jpg, just replace the last part
  if (
    videoUrl.includes("yuhonas/free-exercise-db") &&
    videoUrl.endsWith(".jpg")
  ) {
    return videoUrl.replace(/\/[^\/]+$/, `/${frame}.jpg`);
  }
  return videoUrl; // Fallback
};

/* ───── ExerciseFlipDemo ─────
 * Animates between img1 (start position) and img2 (end position).
 * Both images come from yuhonas/free-exercise-db GitHub raw content.
 * Falls back gracefully if either image fails to load.
 */
function ExerciseFlipDemo({
  img1,
  img2,
  alt,
  className = "",
}: {
  img1: string | null | undefined;
  img2: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [showSecond, setShowSecond] = useState(false);
  const [img1Loaded, setImg1Loaded] = useState(false);
  const [img2Loaded, setImg2Loaded] = useState(false);

  const [img1Error, setImg1Error] = useState(false);
  const [img2Error, setImg2Error] = useState(false);

  const canAnimate = img1Loaded && img2Loaded && !img1Error && !img2Error;

  useEffect(() => {
    if (!canAnimate) return;
    const interval = setInterval(() => setShowSecond((v) => !v), 1500);
    return () => clearInterval(interval);
  }, [canAnimate]);

  // Fallback if no source provided, or if the primary image failed to load
  if (!img1 || img1Error) {
    return (
      <div
        className={`relative flex items-center justify-center bg-zinc-900/60 border border-zinc-800/30 rounded-2xl overflow-hidden ${className}`}
      >
        <Dumbbell className="w-10 h-10 text-zinc-700" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Image 1 — starting position */}
      <img
        src={img1}
        alt={`${alt} - start`}
        onLoad={() => setImg1Loaded(true)}
        onError={() => setImg1Error(true)}
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
        style={{ opacity: showSecond && !img2Error ? 0 : 1 }}
      />
      {/* Image 2 — end position */}
      {img2 && !img2Error && (
        <img
          src={img2}
          alt={`${alt} - end`}
          onLoad={() => setImg2Loaded(true)}
          onError={() => setImg2Error(true)}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
          style={{ opacity: showSecond ? 1 : 0 }}
        />
      )}
      {/* Placeholder while loading */}
      {!img1Loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
        </div>
      )}
      {/* Animation indicator */}
      {canAnimate && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${!showSecond ? "bg-emerald-400" : "bg-zinc-600"}`}
          />
          <span
            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${showSecond ? "bg-emerald-400" : "bg-zinc-600"}`}
          />
        </div>
      )}
    </div>
  );
}

/* ───── Data ───── */
const heroImg =
  "https://images.unsplash.com/photo-1628935291759-bbaf33a66dc6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxneW0lMjB3b3Jrb3V0JTIwbXVzY2xlJTIwdHJhaW5pbmclMjBkYXJrfGVufDF8fHx8MTc3NjA2NjY0NHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

const GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Cải thiện sức khỏe",
  lose_fat: "Giảm mỡ",
  gain_muscle: "Tăng cơ",
  maintain: "Duy trì",
  improve_health: "Cải thiện sức khỏe",
};

const MUSCLE_FILTERS = [
  { label: "Tất cả", bodyPart: "", muscleGroup: "" },
  { label: "Ngực", bodyPart: "", muscleGroup: "chest" },
  { label: "Lưng", bodyPart: "", muscleGroup: "back" },
  { label: "Chân", bodyPart: "LOWER_BODY", muscleGroup: "" },
  { label: "Vai", bodyPart: "", muscleGroup: "shoulders" },
  { label: "Tay trước", bodyPart: "", muscleGroup: "biceps" },
  { label: "Tay sau", bodyPart: "", muscleGroup: "triceps" },
  { label: "Core", bodyPart: "CORE", muscleGroup: "" },
  { label: "Toàn thân", bodyPart: "FULL_BODY", muscleGroup: "" },
];

function labelizeEnum(value?: string | null) {
  if (!value) return "--";
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupTitle(value?: string | null) {
  if (!value) return "Khác";
  return labelizeEnum(value);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseApiDateOnly(value: string | Date) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toApiDateTime(date: Date) {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  ).toISOString();
}

function getMonthRange(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function goalLabel(goal?: string | null) {
  if (!goal) return "Chưa xác định";
  return GOAL_LABELS[goal] || goal;
}

function normalizeLoggingMode(value: unknown, exercise?: any): ExerciseLoggingMode {
  if (
    value === "REPS_LOAD" ||
    value === "BODYWEIGHT_REPS" ||
    value === "TIME" ||
    value === "TIME_LOAD" ||
    value === "DISTANCE_TIME"
  ) {
    return value;
  }
  if (exercise?.typeOfActivity === "CARDIO") return "DISTANCE_TIME";
  if (exercise?.type === "HOLD") return "TIME";
  if (exercise?.typeOfEquipment === "BODYWEIGHT") return "BODYWEIGHT_REPS";
  return "REPS_LOAD";
}

function exerciseLoggingMode(exercise: any): ExerciseLoggingMode {
  return normalizeLoggingMode(exercise?.loggingMode, {
    typeOfActivity: exercise?.activityType,
    typeOfEquipment: exercise?.equipment,
    type: exercise?.movementType,
  });
}

function exerciseRequiresExternalWeight(exercise: any) {
  const mode = exerciseLoggingMode(exercise);
  return mode === "REPS_LOAD" || mode === "TIME_LOAD";
}

function exerciseAllowsExternalWeight(exercise: any) {
  const mode = exerciseLoggingMode(exercise);
  return mode === "REPS_LOAD" || mode === "TIME_LOAD" || mode === "BODYWEIGHT_REPS";
}

function exerciseUsesExternalWeight(exercise: any) {
  return exerciseRequiresExternalWeight(exercise);
}

function formatSecondsCompact(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${minutes}m`;
}

function formatDistanceCompact(meters?: number | null) {
  if (meters == null || !Number.isFinite(meters)) return "";
  if (meters >= 1000) {
    const km = Math.round((meters / 1000) * 100) / 100;
    return `${Number.isInteger(km) ? km.toFixed(0) : km}km`;
  }
  return `${Math.round(meters)}m`;
}

function formatExercisePrescription(input: {
  sets?: number | null;
  reps?: number | null;
  weight?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  restSeconds?: number | null;
  loggingMode?: ExerciseLoggingMode;
}) {
  const sets = input.sets ?? 1;
  const mode = input.loggingMode ?? "REPS_LOAD";
  const parts: string[] = [];
  if (mode === "TIME" || mode === "TIME_LOAD") {
    parts.push(`${sets}x${formatSecondsCompact(input.durationSeconds) || "time"}`);
  } else if (mode === "DISTANCE_TIME") {
    const distance = formatDistanceCompact(input.distanceMeters) || "distance";
    const duration = formatSecondsCompact(input.durationSeconds);
    parts.push(duration ? `${distance} / ${duration}` : distance);
  } else {
    parts.push(`${sets}x${input.reps ?? 10}`);
  }
  if ((mode === "REPS_LOAD" || mode === "TIME_LOAD" || mode === "BODYWEIGHT_REPS") && input.weight) {
    parts.push(`${input.weight} kg`);
  }
  if (input.restSeconds) parts.push(`nghi ${input.restSeconds}s`);
  return parts.join(" · ");
}

function formatPerformanceSetLabel(set: {
  weightKg?: number | null;
  bodyWeightAtSetKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}) {
  const pieces: string[] = [];
  if (set.distanceMeters != null) pieces.push(formatDistanceCompact(set.distanceMeters));
  if (set.durationSeconds != null) pieces.push(formatSecondsCompact(set.durationSeconds));
  if (set.bodyWeightAtSetKg != null) pieces.push(`BW ${set.bodyWeightAtSetKg}kg`);
  if (set.weightKg != null) pieces.push(`${set.weightKg}kg`);
  if (set.reps != null) pieces.push(`${set.reps} reps`);
  return pieces.filter(Boolean).join(" / ") || "Logged";
}

// Roadmap P1.3 "Superset / exercise grouping".
const GROUP_TYPE_LABEL_VI: Record<string, string> = {
  SUPERSET: "Superset",
  TRISET: "Triset",
  CIRCUIT: "Circuit",
};

function mapProgramExercise(ex: any) {
  const exercise = ex.exercise || {};
  const loggingMode = normalizeLoggingMode(exercise.loggingMode, exercise);
  const durationSeconds = ex.duration ?? null;
  return {
    id: ex.id,
    programExerciseId: ex.id,
    dbId: ex.exerciseId || exercise.id,
    name: exercise.exerciseName || "Bài tập",
    prescription: formatExercisePrescription({
      sets: ex.sets ?? 3,
      reps: ex.reps ?? null,
      weight: ex.weight ?? null,
      durationSeconds,
      distanceMeters: null,
      restSeconds: ex.restSeconds ?? null,
      loggingMode,
    }),
    sets: ex.sets ?? 3,
    durationSeconds,
    distanceMeters: null,
    reps: ex.reps ?? 10,
    restSeconds: ex.restSeconds ?? 90,
    notes: ex.notes ?? "",
    img: formatVideoUrlToImg(exercise.videoUrl, 0),
    img2: formatVideoUrlToImg(exercise.videoUrl, 1),
    type: (exercise.typeOfActivity === "CARDIO" ? "cardio" : "strength") as
      | "cardio"
      | "strength",
    bodyPart: exercise.bodyPart,
    equipment: exercise.typeOfEquipment,
    loggingMode,
    activityType: exercise.typeOfActivity,
    movementType: exercise.type,
    description: exercise.instructions,
    muscles: exercise.muscleGroupsActivated || [],
    tips: [],
  };
}

// Fixed color palette assigned by rank (largest slice first) — colors are a
// presentation detail, decoupled from the real computed percentages in
// workout-analytics.utils.ts.
const ANALYTICS_CHART_COLORS = [
  "#22c55e",
  "#2dd4bf",
  "#a3e635",
  "#34d399",
  "#86efac",
  "#5eead4",
];

function withChartColors<T extends { name: string; value: number }>(
  slices: T[],
): (T & { color: string })[] {
  return slices.map((s, i) => ({
    ...s,
    color: ANALYTICS_CHART_COLORS[i % ANALYTICS_CHART_COLORS.length],
  }));
}

const DAYS_IN_APRIL = 30;
const FIRST_DAY_OFFSET = 2;
const trainingMarkers = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 29];

type MetricKey = "weight" | "bodyfat" | "muscle" | "water";
type MetricUnit = "kg" | "%";
type MetricDataKey = "kg" | "pct";
type BodyMetricPoint = {
  week: string;
  fullDate: string;
  kg?: number;
  pct?: number;
};
type BodyMetricOption = {
  key: MetricKey;
  label: string;
  unit: MetricUnit;
  color: string;
  current: string;
  target?: string;
  data: BodyMetricPoint[];
  dataKey: MetricDataKey;
  domain: [number, number] | ["auto", "auto"];
  hasData: boolean;
  canPersist: boolean;
};

const METRIC_BASE_OPTIONS: Array<
  Pick<
    BodyMetricOption,
    "key" | "label" | "unit" | "color" | "dataKey" | "canPersist"
  >
> = [
  {
    key: "weight",
    label: "Cân nặng",
    unit: "kg",
    color: "#10b981",
    dataKey: "kg",
    canPersist: true,
  },
  {
    key: "bodyfat",
    label: "Mỡ cơ thể",
    unit: "%",
    color: "#f59e0b",
    dataKey: "pct",
    canPersist: true,
  },
  {
    key: "muscle",
    label: "Cơ bắp",
    unit: "kg",
    color: "#3b82f6",
    dataKey: "kg",
    canPersist: true,
  },
  {
    key: "water",
    label: "Nước cơ thể",
    unit: "%",
    color: "#06b6d4",
    dataKey: "pct",
    canPersist: false,
  },
];

function inBodyDateKey(entry: any): string {
  const raw = entry?.dateOnly ?? entry?.date ?? entry?.createdAt;
  const s = raw ? String(raw) : "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmy2 = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy2) return `${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return "9999-12-31";
}

function parseInBodyMeasurementDate(entry: any): Date {
  const key = inBodyDateKey(entry);
  if (key === "9999-12-31") return new Date(NaN);
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function metricNumber(...values: any[]): number | null {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bodyMetricValue(entry: any, key: MetricKey): number | null {
  if (!entry) return null;
  if (key === "weight") return metricNumber(entry.weight, entry.weightKg);
  if (key === "muscle")
    return metricNumber(
      entry.muscleMass,
      entry.muscleMassKg,
      entry.skeletalMuscleKg,
    );
  if (key === "water") {
    return metricNumber(
      entry.bodyWaterPct,
      entry.bodyWaterPercentage,
      entry.bodyWater,
      entry.waterPct,
      entry.totalBodyWaterPct,
    );
  }

  const bodyFatPct = metricNumber(entry.bodyFatPct, entry.bodyFatPercentage);
  if (bodyFatPct !== null) return bodyFatPct;
  const bodyFatKg = metricNumber(entry.bodyFat, entry.bodyFatKg);
  const weight = metricNumber(entry.weight, entry.weightKg);
  if (bodyFatKg !== null && weight && weight > 0) {
    return Math.round((bodyFatKg / weight) * 1000) / 10;
  }
  return null;
}

function bodyFatKgFromEntry(entry: any): number | null {
  const bodyFatKg = metricNumber(entry?.bodyFat, entry?.bodyFatKg);
  if (bodyFatKg !== null) return bodyFatKg;
  const pct = bodyMetricValue(entry, "bodyfat");
  const weight = bodyMetricValue(entry, "weight");
  if (pct !== null && weight !== null) return Math.round(weight * pct) / 100;
  return null;
}

function metricTarget(profile: any, key: MetricKey): number | null {
  if (!profile) return null;
  if (key === "weight")
    return metricNumber(profile.targetWeight, profile.targetWeightKg);
  if (key === "bodyfat")
    return metricNumber(profile.targetBodyFatPct, profile.bodyFatTargetPct);
  if (key === "muscle")
    return metricNumber(
      profile.targetMuscleMass,
      profile.targetMuscleMassKg,
      profile.skeletalMuscleTargetKg,
    );
  return metricNumber(
    profile.targetBodyWaterPct,
    profile.bodyWaterTargetPct,
    profile.waterTargetPct,
  );
}

function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value === null) return "--";
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

function metricDomain(
  data: BodyMetricPoint[],
  dataKey: MetricDataKey,
): [number, number] | ["auto", "auto"] {
  const values = data
    .map((point) => point[dataKey])
    .filter((value): value is number => Number.isFinite(value));
  if (!values.length) return ["auto", "auto"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, dataKey === "pct" ? 2 : 1);
  const pad = span * 0.25;
  return [Math.floor((min - pad) * 10) / 10, Math.ceil((max + pad) * 10) / 10];
}

type TimeFilter = "last" | "week" | "month" | "all";
type PlanView = "main" | "dayDetail" | "activeExercise";

type ManualBuilderExercise = {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSeconds: number;
};

type ManualBuilderDay = {
  dayNumber: number;
  title: string;
  exercises: ManualBuilderExercise[];
};

type ActiveExerciseLog = {
  weightKg: string;
  bodyWeightAtSetKg: string;
  durationSeconds: string;
  distanceMeters: string;
  /** Editable only for BODYWEIGHT_REPS (roadmap P1.1 "bodyweight reps
   * editable prefill") — other modes still derive reps from the fixed
   * program prescription at completion time. */
  reps: string;
  noWeight: boolean;
  rpe: number;
  rir: number;
};

type ExerciseLoggingMode =
  | "REPS_LOAD"
  | "BODYWEIGHT_REPS"
  | "TIME"
  | "TIME_LOAD"
  | "DISTANCE_TIME";

// Roadmap P1.3 "Superset / exercise grouping" — attached to a dayExercises
// entry when its programExerciseId is a member of some
// WorkoutProgramExerciseGroup. See exercise-group.utils.ts for how this
// drives rest-timer duration.
type GroupMetadata = {
  groupId: string;
  groupType: string;
  groupOrder: number;
  restBetweenExercisesSeconds: number | null;
  restAfterRoundSeconds: number | null;
};

// Roadmap P1.1 "true set-by-set table UI" — one row of the real, persisted
// WorkoutSet skeleton startSchedule already pre-creates. Mirrors exactly
// the fields PATCH /workouts/sets/:setId accepts, so a row can always be
// sent back as-is.
type WorkoutSetRow = {
  id: string;
  setNumber: number;
  completed: boolean;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  bodyWeightAtSetKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
};

const MANUAL_WEEKDAYS = [
  { value: 1, short: "T2", label: "Thứ 2" },
  { value: 2, short: "T3", label: "Thứ 3" },
  { value: 3, short: "T4", label: "Thứ 4" },
  { value: 4, short: "T5", label: "Thứ 5" },
  { value: 5, short: "T6", label: "Thứ 6" },
  { value: 6, short: "T7", label: "Thứ 7" },
  { value: 0, short: "CN", label: "Chủ nhật" },
];

const DEFAULT_MANUAL_WEEKDAYS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 3, 5, 0],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 0],
};

function buildManualDays(
  daysPerWeek: number,
  previous: ManualBuilderDay[] = [],
) {
  return Array.from({ length: daysPerWeek }, (_, index) => {
    const previousDay = previous[index];
    return {
      dayNumber: index + 1,
      title: previousDay?.title || `Buổi ${index + 1}`,
      exercises: previousDay?.exercises || [],
    };
  });
}

// Real bug found via direct user report: every locked-day message in this
// file used to say "đã qua" (already passed) unconditionally, including
// for FUTURE days (only today is ever editable — see schedule-lock.utils
// .ts). Centralizes the correct, direction-aware wording so every call
// site shows the right reason instead of guessing/hardcoding "past".
function lockedDayMessage(
  apiDateValue: string | Date | undefined | null,
  action: string = "chỉnh sửa",
): string {
  const direction = apiDateValue ? scheduleLockDirection(apiDateValue) : "past";
  return direction === "future"
    ? `Chưa đến ngày tập này nên chưa thể ${action}.`
    : `Ngày này đã qua nên không thể ${action}.`;
}

function lockedDayBadgeLabel(apiDateValue: string | Date | undefined | null): string {
  if (!apiDateValue) return "Ngày đã qua";
  const direction = scheduleLockDirection(apiDateValue);
  return direction === "future" ? "Chưa đến ngày" : "Ngày đã qua";
}

function scheduleProgressPercent(schedule?: WorkoutScheduleRecord | null) {
  if (!schedule) return 0;
  // The mere existence of a linked workout/workoutId is NOT proof of
  // completion — a workout row can exist while still IN_PROGRESS (or even
  // for a future, not-yet-started session). Only the backend-decided
  // `status` (driven by the actual set/exercise data, not by row existence)
  // may claim 100%; otherwise fall back to the real progressPercent.
  if (schedule.status === "COMPLETED") return 100;
  const progress = Number(schedule.progressPercent ?? 0);
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
}

// Accent helpers
const G = {
  text: "text-emerald-400",
  textSoft: "text-emerald-300",
  textMuted: "text-emerald-400/60",
  glow: "shadow-[0_0_20px_rgba(16,185,129,0.2)]",
  glowSm: "shadow-[0_0_10px_rgba(16,185,129,0.15)]",
  glowLg: "shadow-[0_0_30px_rgba(16,185,129,0.25)]",
  border: "border-emerald-500/20",
  borderHover: "hover:border-emerald-500/30",
  bg: "bg-emerald-500/10",
  bgSoft: "bg-emerald-500/5",
  ring: "#10b981",
  ringDark: "#064e3b",
};

/** Small pill-toggle group — used for difficulty/enjoyment/wouldRepeat, which
 * read far more clearly as three tap targets than as a select on mobile. */
function FeedbackToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg py-2 text-[11px] font-semibold border transition-all ${
            value === opt.value
              ? "bg-emerald-500 border-emerald-500 text-black"
              : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const EXERCISE_ISSUE_TAGS: Array<{ value: ExerciseFeedbackIssueType; label: string }> = [
  { value: "liked", label: "Thích bài này" },
  { value: "too_heavy", label: "Quá nặng" },
  { value: "too_light", label: "Quá nhẹ" },
  { value: "too_many_sets", label: "Nhiều set quá" },
  { value: "too_few_sets", label: "Ít set quá" },
  { value: "uncomfortable", label: "Khó chịu" },
  { value: "pain", label: "Bị đau" },
  { value: "boring", label: "Nhàm chán" },
  { value: "confusing", label: "Khó hiểu cách tập" },
  { value: "equipment_unavailable", label: "Thiếu dụng cụ" },
];

/** Post-session feedback — completion form. Phase 2 of
 * docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md. Every field is optional except
 * nothing (low-friction by design: a user can submit just a star rating and
 * close it), submitted via the schedule-addressable endpoint so it works
 * for sessions outside a training cycle too. */
function SessionFeedbackModal({
  scheduleId,
  exercises,
  onClose,
}: {
  scheduleId: string;
  exercises: Array<{ exerciseId: string; name: string }>;
  onClose: () => void;
}) {
  const [readinessScore, setReadinessScore] = useState(6);
  const [sessionRpe, setSessionRpe] = useState(6);
  const [painScore, setPainScore] = useState(0);
  const [fatigueAfterSession, setFatigueAfterSession] = useState(5);
  const [painLocation, setPainLocation] = useState("");
  const [sessionRating, setSessionRating] = useState(0);
  const [difficulty, setDifficulty] = useState<SessionFeedbackDifficulty | undefined>();
  const [enjoyment, setEnjoyment] = useState<SessionFeedbackEnjoyment | undefined>();
  const [wouldRepeatSession, setWouldRepeatSession] = useState<SessionFeedbackWouldRepeat | undefined>();
  const [perceivedProgress, setPerceivedProgress] = useState<SessionFeedbackPerceivedProgress | undefined>();
  const [notes, setNotes] = useState("");
  const [showExerciseDetail, setShowExerciseDetail] = useState(false);
  const [exerciseTags, setExerciseTags] = useState<Record<string, ExerciseFeedbackIssueType | undefined>>({});

  const toggleExerciseTag = (exerciseId: string, tag: ExerciseFeedbackIssueType) => {
    setExerciseTags((prev) => ({ ...prev, [exerciseId]: prev[exerciseId] === tag ? undefined : tag }));
  };

  const submitMutation = useMutation({
    mutationFn: () => {
      const exerciseFeedback: ExerciseFeedbackItemInput[] = Object.entries(exerciseTags)
        .filter(([, issueType]) => Boolean(issueType))
        .map(([exerciseId, issueType]) => ({ exerciseId, issueType }));
      return sessionFeedbackService.submit(scheduleId, {
        readinessScore,
        sessionRpe,
        painScore,
        fatigueAfterSession,
        painLocation: painScore > 0 ? painLocation.trim() || undefined : undefined,
        sessionRating: sessionRating > 0 ? sessionRating : undefined,
        difficulty,
        enjoyment,
        wouldRepeatSession,
        perceivedProgress,
        notes: notes.trim() || undefined,
        exerciseFeedback: exerciseFeedback.length ? exerciseFeedback : undefined,
      });
    },
    onSuccess: () => {
      toast.success("Đã ghi nhận cảm nhận buổi tập");
      onClose();
    },
    onError: () => {
      toast.error("Không thể ghi nhận cảm nhận buổi tập");
    },
  });

  const sliders: Array<{
    label: string;
    hint: string;
    value: number;
    setValue: (v: number) => void;
    min: number;
    max: number;
    step: number;
    formatValue?: (v: number) => string;
  }> = [
    { label: "Chất lượng buổi tập", hint: "1 = rất tệ, 10 = xuất sắc", value: readinessScore, setValue: setReadinessScore, min: 1, max: 10, step: 1 },
    { label: "Mức độ gắng sức (RPE)", hint: "1 = rất nhẹ, 10 = tối đa", value: sessionRpe, setValue: setSessionRpe, min: 1, max: 10, step: 0.5, formatValue: (v) => `RPE ${v}` },
    { label: "Mức độ đau/khó chịu", hint: "0 = không đau, 10 = đau dữ dội", value: painScore, setValue: setPainScore, min: 0, max: 10, step: 1 },
    { label: "Mệt mỏi sau buổi tập", hint: "1 = còn khỏe, 10 = kiệt sức", value: fatigueAfterSession, setValue: setFatigueAfterSession, min: 1, max: 10, step: 1 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60 sticky top-0 bg-zinc-900 z-10">
          <h3 className="text-zinc-100 font-bold text-sm">Cảm nhận buổi tập này thế nào?</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-col items-center gap-1.5 pb-1">
            <StarRating value={sessionRating} onChange={setSessionRating} size={28} />
            <p className="text-[10px] text-zinc-600">Đánh giá tổng thể (không bắt buộc)</p>
          </div>

          <div>
            <p className="text-xs text-zinc-300 font-semibold mb-1.5">Độ khó buổi tập</p>
            <FeedbackToggleGroup
              options={[
                { value: "too_easy" as const, label: "Quá dễ" },
                { value: "just_right" as const, label: "Vừa sức" },
                { value: "too_hard" as const, label: "Quá nặng" },
              ]}
              value={difficulty}
              onChange={setDifficulty}
            />
          </div>

          <div>
            <p className="text-xs text-zinc-300 font-semibold mb-1.5">Bạn có thích buổi tập này không?</p>
            <FeedbackToggleGroup
              options={[
                { value: "low" as const, label: "Không thích" },
                { value: "medium" as const, label: "Bình thường" },
                { value: "high" as const, label: "Rất thích" },
              ]}
              value={enjoyment}
              onChange={setEnjoyment}
            />
          </div>

          {sliders.map((s) => (
            <div key={s.label}>
              <RulerSlider
                label={s.label}
                min={s.min}
                max={s.max}
                step={s.step}
                formatValue={s.formatValue}
                value={s.value}
                onChange={s.setValue}
              />
              <p className="text-[10px] text-zinc-600 mt-1">{s.hint}</p>
            </div>
          ))}

          {painScore > 0 && (
            <input
              type="text"
              value={painLocation}
              onChange={(e) => setPainLocation(e.target.value)}
              placeholder="Vị trí đau (vd: vai trái, đầu gối phải)"
              className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
            />
          )}

          <div>
            <p className="text-xs text-zinc-300 font-semibold mb-1.5">Bạn có muốn tập lại buổi này không?</p>
            <FeedbackToggleGroup
              options={[
                { value: "yes" as const, label: "Có" },
                { value: "unsure" as const, label: "Chưa chắc" },
                { value: "no" as const, label: "Không" },
              ]}
              value={wouldRepeatSession}
              onChange={setWouldRepeatSession}
            />
          </div>

          <div>
            <p className="text-xs text-zinc-300 font-semibold mb-1.5">So với buổi trước</p>
            <select
              value={perceivedProgress ?? ""}
              onChange={(e) => setPerceivedProgress((e.target.value || undefined) as SessionFeedbackPerceivedProgress | undefined)}
              className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
            >
              <option value="">Chưa chọn</option>
              <option value="better_than_last_time">Tốt hơn lần trước</option>
              <option value="same">Như cũ</option>
              <option value="worse">Kém hơn</option>
              <option value="unsure">Chưa chắc</option>
            </select>
          </div>

          {exercises.length > 0 && (
            <div className="border-t border-zinc-800/60 pt-3">
              <button
                type="button"
                onClick={() => setShowExerciseDetail((v) => !v)}
                className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-300"
              >
                <span>Chi tiết từng bài tập (không bắt buộc)</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showExerciseDetail ? "rotate-180" : ""}`} />
              </button>
              {showExerciseDetail && (
                <div className="mt-3 space-y-3">
                  {exercises.map((ex) => (
                    <div key={ex.exerciseId}>
                      <p className="text-[11px] text-zinc-300 mb-1">{ex.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {EXERCISE_ISSUE_TAGS.map((tag) => (
                          <button
                            key={tag.value}
                            type="button"
                            onClick={() => toggleExerciseTag(ex.exerciseId, tag.value)}
                            className={`px-2 py-1 rounded-full text-[10px] border transition-all ${
                              exerciseTags[ex.exerciseId] === tag.value
                                ? "bg-emerald-500/90 border-emerald-500 text-black font-semibold"
                                : "bg-zinc-800/50 border-zinc-700/40 text-zinc-500 hover:bg-zinc-800"
                            }`}
                          >
                            {tag.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ghi chú thêm (không bắt buộc)"
            rows={2}
            className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
          />

          <div className="flex gap-2 pt-1 sticky bottom-0 bg-zinc-900 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition-all"
            >
              Bỏ qua
            </button>
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 py-2.5 text-xs font-bold text-black transition-all"
            >
              {submitMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const MOVEMENT_PATTERN_LABEL: Record<string, string> = {
  HORIZONTAL_PUSH: "Đẩy ngang",
  VERTICAL_PUSH: "Đẩy dọc",
  HORIZONTAL_PULL: "Kéo ngang",
  VERTICAL_PULL: "Kéo dọc",
  SQUAT: "Squat",
  HINGE: "Hinge (gập hông)",
  LUNGE: "Lunge",
  HIP_EXTENSION: "Duỗi hông",
  HIP_ABDUCTION_ADDUCTION: "Dạng/khép hông",
  KNEE_EXTENSION: "Duỗi gối",
  KNEE_FLEXION: "Gập gối",
  ELBOW_FLEXION: "Gập khuỷu tay",
  ELBOW_EXTENSION: "Duỗi khuỷu tay",
  SHOULDER_ISOLATION: "Cô lập vai",
  CALF_RAISE: "Nhón bắp chân",
  CORE_FLEXION: "Gập bụng",
  CORE_ROTATION: "Xoay thân",
  CORE_ANTI_EXTENSION: "Giữ vững core",
  CARRY: "Mang vác",
  LOCOMOTION: "Di chuyển",
  CARDIO: "Cardio",
  MOBILITY: "Vận động linh hoạt",
  OTHER: "Khác",
};

/** Gym-onboarding project follow-up §9 — "Can't do this exercise? Swap
 * exercise." Session-only: replaces what gets LOGGED for this specific
 * slot (dayExercises[activeExIdx].dbId/name) without touching the
 * underlying WorkoutProgramExercise/plan — future sessions/weeks still see
 * the originally-planned exercise. The swap is recorded into that
 * exercise's own log note (existing WorkoutExercise.notes field) rather
 * than a new table, so it's visible in history without a schema change. */
function SwapExerciseModal({
  currentExerciseId,
  currentExerciseName,
  otherExerciseIdsToday,
  onSelect,
  onClose,
}: {
  currentExerciseId: string;
  currentExerciseName: string;
  otherExerciseIdsToday: string[];
  onSelect: (substitute: ExerciseSubstitute) => void;
  onClose: () => void;
}) {
  const substitutesQuery = useQuery({
    queryKey: ["exercise-substitutes", currentExerciseId, otherExerciseIdsToday],
    queryFn: () =>
      exerciseService.getSubstitutes(currentExerciseId, {
        excludeExerciseIds: otherExerciseIdsToday,
        limit: 6,
      }),
  });

  return (
    <div
      data-testid="swap-exercise-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
              <Repeat className="w-4 h-4 text-emerald-400" /> Đổi bài tập
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Không thể tập "{currentExerciseName}"? Chọn bài thay thế phù hợp với thiết bị và nhóm cơ.
            </p>
          </div>
          <button
            data-testid="swap-exercise-modal-close"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {substitutesQuery.isLoading && (
          <div data-testid="swap-exercise-loading" className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          </div>
        )}

        {substitutesQuery.isError && (
          <p data-testid="swap-exercise-error" className="text-xs text-zinc-500 py-6 text-center">Không thể tải danh sách bài thay thế. Vui lòng thử lại.</p>
        )}

        {substitutesQuery.data && substitutesQuery.data.length === 0 && (
          <p data-testid="swap-exercise-empty" className="text-xs text-zinc-500 py-6 text-center">
            Không tìm thấy bài thay thế phù hợp với thiết bị bạn đã lưu. Hãy cập nhật thiết bị trong Hồ sơ → Thiết bị tập luyện.
          </p>
        )}

        <div data-testid="swap-exercise-candidates" className="space-y-2">
          {substitutesQuery.data?.map((sub) => (
            <button
              key={sub.id}
              type="button"
              data-testid={`swap-exercise-candidate-${sub.id}`}
              onClick={() => onSelect(sub)}
              className="w-full text-left flex items-center justify-between gap-3 rounded-xl border border-zinc-700/60 hover:border-emerald-500/50 bg-zinc-800/40 hover:bg-emerald-500/5 p-3 transition-all"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-200 truncate">{sub.exerciseName}</p>
                <p className="mt-0.5 text-[11px] text-emerald-400/90">{sub.reason}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {MOVEMENT_PATTERN_LABEL[sub.movementPattern ?? ""] ?? sub.movementPattern ?? "—"}
                  {sub.muscleGroupsActivated.length > 0 ? ` · ${sub.muscleGroupsActivated.join(", ")}` : ""}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Short feedback form for SKIPPED / CANCELLED sessions — deliberately a
 * different, shorter shape than the completion form per Phase 2 spec:
 * skipReason is the only required field. */
function SkipCancelFeedbackModal({
  scheduleId,
  onClose,
}: {
  scheduleId: string;
  onClose: () => void;
}) {
  const [skipReason, setSkipReason] = useState<SessionSkipReason | "">("");
  const [notes, setNotes] = useState("");
  const [shouldAdjustPlan, setShouldAdjustPlan] = useState(false);
  const [makeupDay, setMakeupDay] = useState("");

  const reasonOptions: Array<{ value: SessionSkipReason; label: string }> = [
    { value: "fatigue", label: "Quá mệt" },
    { value: "pain", label: "Đau/chấn thương" },
    { value: "schedule_conflict", label: "Bận việc khác" },
    { value: "motivation", label: "Không có động lực" },
    { value: "illness", label: "Bị ốm" },
    { value: "equipment_unavailable", label: "Thiếu dụng cụ" },
    { value: "too_hard_previous_session", label: "Buổi trước quá nặng" },
    { value: "other", label: "Lý do khác" },
  ];

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!skipReason) throw new Error("skipReason required");
      return sessionFeedbackService.submit(scheduleId, {
        skipReason,
        notes: notes.trim() || undefined,
        shouldAdjustPlan,
        userAvailableMakeupDay: makeupDay || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Đã ghi nhận lý do bỏ buổi tập");
      onClose();
    },
    onError: () => {
      toast.error("Không thể ghi nhận. Vui lòng chọn lý do.");
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
          <h3 className="text-zinc-100 font-bold text-sm">Vì sao bạn bỏ buổi tập này?</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-1.5">
            {reasonOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSkipReason(opt.value)}
                className={`rounded-lg py-2 px-2 text-[11px] font-semibold border transition-all text-left ${
                  skipReason === opt.value
                    ? "bg-emerald-500 border-emerald-500 text-black"
                    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={shouldAdjustPlan}
              onChange={(e) => setShouldAdjustPlan(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 accent-emerald-500"
            />
            Tôi muốn điều chỉnh lại kế hoạch tập
          </label>

          <div>
            <p className="text-[11px] text-zinc-500 mb-1">Ngày bạn có thể tập bù (không bắt buộc)</p>
            <input
              type="date"
              value={makeupDay}
              onChange={(e) => setMakeupDay(e.target.value)}
              className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ghi chú thêm (không bắt buộc)"
            rows={2}
            className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
          />

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition-all"
            >
              Bỏ qua
            </button>
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !skipReason}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 py-2.5 text-xs font-bold text-black transition-all"
            >
              {submitMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Roadmap P1.2 "Reschedule workout"
 * (docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md) — a simple date
 * picker + optional reason, mirroring SkipCancelFeedbackModal's structural
 * pattern above. The actual authorization (source not-started, target
 * today-or-future, no conflict) is fully re-checked server-side; this
 * modal's own `min` on the date input is just a UX nicety, never trusted
 * as the real guard. */
function RescheduleModal({
  scheduleId,
  currentDateLabel,
  onClose,
  onRescheduled,
}: {
  scheduleId: string;
  currentDateLabel: string;
  onClose: () => void;
  onRescheduled: () => void;
}) {
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const todayValue = toDateInputValue(new Date());

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!newDate) throw new Error("newDate required");
      return workoutService.rescheduleSchedule(scheduleId, newDate, reason.trim() || undefined);
    },
    onSuccess: () => {
      toast.success("Đã dời lịch buổi tập.");
      onRescheduled();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Không thể dời lịch buổi tập này.");
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
          <h3 className="text-zinc-100 font-bold text-sm">Dời lịch buổi tập</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-500">
            Hiện đang lên lịch: <span className="text-zinc-300">{currentDateLabel}</span>
          </p>

          <div>
            <p className="text-[11px] text-zinc-500 mb-1">Ngày mới (hôm nay hoặc sau)</p>
            <input
              type="date"
              data-testid="reschedule-date-input"
              value={newDate}
              min={todayValue}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Lý do dời lịch (không bắt buộc)"
            rows={2}
            className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
          />

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition-all"
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="reschedule-submit-button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !newDate}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 py-2.5 text-xs font-bold text-black transition-all"
            >
              {submitMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Dời lịch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Roadmap P1.5 "Custom exercises"
 * (docs/features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md) — a minimal creation
 * form (reuses the SAME enums/options the catalog picker's own filters
 * already fetch, so a custom exercise can never submit a value the
 * backend's own validation would reject). A blocked (duplicate) response
 * shows the real candidate(s) `detectDuplicate` found and requires an
 * explicit "create anyway" to bypass — never silently allowed/merged. */
function CreateCustomExerciseModal({
  exerciseOptions,
  onClose,
  onCreated,
}: {
  exerciseOptions: any;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [exerciseName, setExerciseName] = useState("");
  const [typeOfActivity, setTypeOfActivity] = useState("STRENGTH");
  const [typeOfEquipment, setTypeOfEquipment] = useState("BODYWEIGHT");
  const [bodyPart, setBodyPart] = useState("FULL_BODY");
  const [type, setType] = useState("PUSH");
  const [loggingMode, setLoggingMode] = useState("REPS_LOAD");
  const [muscleGroupsText, setMuscleGroupsText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [candidates, setCandidates] = useState<
    Array<{ id: string; name: string; confidence: number; proposedAction: string }> | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (confirmCreateAnyway: boolean) => {
    if (!exerciseName.trim()) {
      toast.error("Vui lòng nhập tên bài tập.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await workoutService.createCustomExercise({
        exerciseName: exerciseName.trim(),
        typeOfActivity,
        typeOfEquipment,
        bodyPart,
        type,
        muscleGroupsActivated: muscleGroupsText
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        instructions: instructions.trim() || undefined,
        loggingMode,
        confirmCreateAnyway,
      });
      if (result.blocked) {
        setCandidates(result.candidates);
        return;
      }
      toast.success(`Đã tạo bài tập "${exerciseName}".`);
      onCreated();
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể tạo bài tập tùy chỉnh.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
          <h3 className="text-zinc-100 font-bold text-sm">Tạo bài tập tùy chỉnh</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {candidates ? (
            <>
              <p className="text-xs text-amber-300">
                Có thể trùng với bài tập đã có trong hệ thống:
              </p>
              <div className="space-y-2">
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-zinc-300"
                  >
                    <p className="text-zinc-100">{c.name}</p>
                    <p className="text-zinc-500 mt-0.5">{c.proposedAction}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCandidates(null)}
                  className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition-all"
                >
                  Sửa lại
                </button>
                <button
                  type="button"
                  data-testid="confirm-create-anyway-button"
                  onClick={() => void submit(true)}
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 py-2.5 text-xs font-bold text-black transition-all"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Vẫn tạo bài mới
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-1">Tên bài tập</span>
                <input
                  data-testid="custom-exercise-name-input"
                  type="text"
                  value={exerciseName}
                  onChange={(e) => setExerciseName(e.target.value)}
                  className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-sky-500/50"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[11px] text-zinc-500 mb-1">Nhóm cơ</span>
                  <select
                    value={bodyPart}
                    onChange={(e) => setBodyPart(e.target.value)}
                    className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                  >
                    {(exerciseOptions.bodyParts || ["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"]).map(
                      (v: string) => (
                        <option key={v} value={v}>
                          {labelizeEnum(v)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[11px] text-zinc-500 mb-1">Thiết bị</span>
                  <select
                    value={typeOfEquipment}
                    onChange={(e) => setTypeOfEquipment(e.target.value)}
                    className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                  >
                    {(exerciseOptions.equipments || ["BODYWEIGHT"]).map((v: string) => (
                      <option key={v} value={v}>
                        {labelizeEnum(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[11px] text-zinc-500 mb-1">Loại hoạt động</span>
                  <select
                    value={typeOfActivity}
                    onChange={(e) => setTypeOfActivity(e.target.value)}
                    className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                  >
                    {(exerciseOptions.activityTypes || ["STRENGTH"]).map((v: string) => (
                      <option key={v} value={v}>
                        {labelizeEnum(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[11px] text-zinc-500 mb-1">Kiểu chuyển động</span>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                  >
                    {(exerciseOptions.types || ["PUSH", "PULL", "HOLD", "STRETCH"]).map((v: string) => (
                      <option key={v} value={v}>
                        {labelizeEnum(v)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-1">Cách ghi log</span>
                <select
                  data-testid="custom-exercise-logging-mode-select"
                  value={loggingMode}
                  onChange={(e) => setLoggingMode(e.target.value)}
                  className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                >
                  <option value="REPS_LOAD">Tạ × Reps</option>
                  <option value="BODYWEIGHT_REPS">Reps (bodyweight)</option>
                  <option value="TIME">Thời gian</option>
                  <option value="TIME_LOAD">Tạ + Thời gian</option>
                  <option value="DISTANCE_TIME">Quãng đường + Thời gian</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-1">
                  Nhóm cơ tác động (phân tách bằng dấu phẩy)
                </span>
                <input
                  type="text"
                  value={muscleGroupsText}
                  onChange={(e) => setMuscleGroupsText(e.target.value)}
                  placeholder="chest, triceps"
                  className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-sky-500/50"
                />
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Hướng dẫn thực hiện (không bắt buộc)"
                rows={2}
                className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50"
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition-all"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  data-testid="submit-create-custom-exercise-button"
                  onClick={() => void submit(false)}
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-60 py-2.5 text-xs font-bold text-black transition-all"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Tạo bài tập
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Feedback status indicator for the day-detail view of a completed/partial
 * session — Phase 2 spec: "feedback status in history." Lets the user open
 * the same completion form again to add or edit their feedback. */
function SessionFeedbackStatusRow({
  scheduleId,
  onOpenFeedback,
}: {
  scheduleId: string;
  onOpenFeedback: () => void;
}) {
  const statusQuery = useQuery({
    queryKey: ["session-feedback", scheduleId],
    queryFn: () => sessionFeedbackService.get(scheduleId),
  });

  if (statusQuery.isLoading) return null;
  const hasFeedback = Boolean(statusQuery.data?.feedback) && !statusQuery.data?.feedbackMissing;

  return (
    <button
      onClick={onOpenFeedback}
      className={`w-full mt-2 py-2 rounded-xl border text-[11px] transition-all flex items-center justify-center gap-1.5 ${
        hasFeedback
          ? "border-emerald-800/40 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
          : "border-amber-800/40 bg-amber-500/5 text-amber-300/90 hover:bg-amber-500/10"
      }`}
    >
      <MessageSquare className="w-3 h-3" />
      {hasFeedback ? "Đã ghi cảm nhận · Xem/sửa" : "Chưa ghi cảm nhận · Thêm ngay"}
    </button>
  );
}

export function WorkoutLogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore navigation position from the URL on first mount — this is what
  // survives a hard refresh (unlike component state or location.state, which
  // are wiped when the page reloads). Read once via lazy initializers so the
  // correct view renders on the very first paint instead of flashing "main"
  // and then jumping. The `exercise` id gets resolved into an array index
  // once program data has loaded (see the day-sync effect below); the write
  // side that keeps the URL in sync as the user navigates lives in its own
  // effect further down.
  const initialWorkoutLogState = parseInitialWorkoutLogState(searchParams);
  const initialExerciseIdFromUrl = initialWorkoutLogState.exerciseId;

  const [muscleFilter, setMuscleFilter] = useState<TimeFilter>("week");
  const [exerciseFilter, setExerciseFilter] = useState<TimeFilter>("week");
  const [planView, setPlanView] = useState<PlanView>(initialWorkoutLogState.planView);
  const [selectedDay, setSelectedDay] = useState(initialWorkoutLogState.day);
  const [dayExercises, setDayExercises] = useState<any[]>([]);
  // Gym-onboarding project follow-up §9 — session-only exercise swap. Notes
  // keyed by dayExercises index so the log note only applies to the
  // specific slot that was swapped, not every exercise in the session.
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapNotes, setSwapNotes] = useState<Record<number, string>>({});
  const [currentWorkoutId, setCurrentWorkoutId] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    null,
  );
  // Roadmap P1.1 "true set-by-set table UI" — the real per-set skeleton
  // (id, setNumber, completed, logged fields), keyed by programExerciseId,
  // fetched once per workoutId via GET /workouts/:id (already returns
  // exercises[].workoutSets[] ordered by setNumber — see
  // docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md). `undefined` for
  // a given programExerciseId means "not loaded yet" — callers must treat
  // that the same as "unknown, fall back to today's exercise-level
  // completion" rather than assuming zero sets.
  const [workoutSetsByExercise, setWorkoutSetsByExercise] = useState<
    Record<string, WorkoutSetRow[]>
  >({});
  const workoutSetsFetchedForWorkoutIdRef = useRef<string | null>(null);
  const workoutStartAttemptedForScheduleIdRef = useRef<string | null>(null);
  // Roadmap P1.4 "Active-workout offline resilience" — how many set
  // complete/undo events are sitting in the durable local queue, not yet
  // confirmed synced. 0 = fully synced; the drain effect below keeps this
  // current. Deliberately a count, not a boolean: distinguishes "nothing
  // pending" from "syncing" from "queue not empty" for the UI indicator.
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const isDrainingOfflineQueueRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [selectedExercise, setSelectedExercise] = useState<any | null>(null);
  const [selectedProgramDayId, setSelectedProgramDayId] = useState<
    string | null
  >(null);

  // Dynamic Navigation & Stats
  // Roadmap P1.2 "Reschedule workout" found this real, pre-existing gap:
  // aiSchedules is only ever fetched for `calendarMonth`'s range
  // (getMonthRange below), but this defaulted to `new Date()` (today's
  // month) regardless of the URL's own `date` param — so deep-linking (or
  // rescheduling) into a DIFFERENT month than the current one silently
  // showed "nothing scheduled" even though a real schedule existed there,
  // simply because it was never fetched. Mirrors selectedDate's own
  // URL-restoration pattern immediately below.
  const [calendarMonth, setCalendarMonth] = useState(() =>
    initialWorkoutLogState.date ? parseApiDateOnly(initialWorkoutLogState.date) : new Date(),
  );
  const [latestInBody, setLatestInBody] = useState<any>(null);
  const [inbodyHistory, setInbodyHistory] = useState<any[]>([]);
  const [workoutStats, setWorkoutStats] = useState<any>(null);
  const [currentProgram, setCurrentProgram] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  // Progressive disclosure per persona (see ExperienceLevel on UserProfile):
  // an unset/unknown level defaults to showing the beginner hint too, since
  // omitting a real explanation is worse than showing one extra time to
  // someone who didn't need it. Intermediate/advanced users, who explicitly
  // set their level, never see it. Dismissal is session-only (no backend
  // field for "hint dismissed" exists, and adding one isn't warranted for a
  // one-line hint) — it simply reappears on next visit, which is
  // acceptable for a piece of educational copy, not a nag/blocking modal.
  const isBeginnerProfile =
    userProfile?.experienceLevel !== "INTERMEDIATE" &&
    userProfile?.experienceLevel !== "ADVANCED";
  // Auto-shown for a detected/unknown-level (beginner-default) profile;
  // intermediate/advanced users start with it collapsed but can always
  // reopen it via the "RPE/RIR là gì?" button rendered whenever this is
  // false — the explanation is never permanently unreachable for anyone,
  // it just doesn't interrupt an experienced user unprompted.
  const [showRpeRirHint, setShowRpeRirHint] = useState(isBeginnerProfile);
  const [daysSinceInBody, setDaysSinceInBody] = useState<number | null>(null);
  const [workoutCache, setWorkoutCache] = useState<Record<string, any>>({});
  const [aiSchedules, setAiSchedules] = useState<WorkoutScheduleRecord[]>([]);
  // Track the actual calendar date being edited (not the plan day number) —
  // restored from the URL's `date` param when present (see
  // workout-log-url.utils.ts's doc comment on why `day` alone can't
  // disambiguate which real calendar occurrence was being viewed before a
  // reload), so a locked past session doesn't silently get reinterpreted as
  // today's (unlocked) one after a hard refresh.
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    initialWorkoutLogState.date
      ? parseApiDateOnly(initialWorkoutLogState.date)
      : new Date(),
  );

  const handlePrevMonth = () => {
    setCalendarMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
    );
  };
  const handleNextMonth = () => {
    setCalendarMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
    );
  };

  const queryClient = useQueryClient();
  // Same query key as InBodyModule.tsx's own history query — sharing this
  // key (rather than this page's previous private useState+manual-refetch
  // pair) means an InBody entry created/edited on ANY screen (Profile,
  // Dashboard, InBodyModule, or here) invalidates one cache entry that all
  // of them read from, so this page reflects it too without a manual F5.
  const inbodyHistoryQuery = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory,
  });

  const applyInBodyHistory = useCallback((value: any) => {
    const sorted = Array.isArray(value)
      ? [...value].sort((a: any, b: any) => {
          const cmp = inBodyDateKey(b).localeCompare(inBodyDateKey(a));
          if (cmp !== 0) return cmp;
          return (
            Date.parse(String(b?.createdAt ?? 0)) -
            Date.parse(String(a?.createdAt ?? 0))
          );
        })
      : [];

    setInbodyHistory(sorted);
    const inbody = sorted[0] ?? null;
    if (!inbody) {
      setLatestInBody(null);
      setDaysSinceInBody(null);
      return;
    }

    setLatestInBody(inbody);
    const measuredAt = parseInBodyMeasurementDate(inbody);
    const fallbackCreatedAt = new Date(inbody.createdAt);
    const metricDate = !Number.isNaN(measuredAt.getTime())
      ? measuredAt
      : fallbackCreatedAt;
    const diff = Number.isNaN(metricDate.getTime())
      ? null
      : Math.floor((Date.now() - metricDate.getTime()) / (1000 * 60 * 60 * 24));
    setDaysSinceInBody(diff);
  }, []);

  // Derive latestInBody/inbodyHistory/daysSinceInBody from the SHARED
  // ["inbody-history"] query above, instead of only the page's own
  // one-shot fetch below — this is what actually makes an InBody update
  // made elsewhere (e.g. InBodyModule) show up here after a cache
  // invalidation, without waiting for this effect's own fetch.
  useEffect(() => {
    if (inbodyHistoryQuery.data !== undefined) {
      applyInBodyHistory(inbodyHistoryQuery.data);
    }
  }, [inbodyHistoryQuery.data, applyInBodyHistory]);

  // Fetch initial workout and stats from DB
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        const { profileService } = await import("../../services/api");
        // InBody history is no longer fetched here — it comes from the
        // shared ["inbody-history"] query (inbodyHistoryQuery) above, so
        // this page reflects updates made on other screens too.
        const [
          historyResult,
          statsResult,
          schedulesResult,
          programResult,
          profileResult,
        ] = await Promise.allSettled([
          workoutService.getHistory(1, 50), // Fetch last 50 workouts to fill cache
          workoutService.getStats(),
          workoutService.getSchedules(100, getMonthRange(calendarMonth)),
          workoutService.getCurrentProgram(),
          profileService.getProfile(),
        ]);

        if (programResult.status === "fulfilled") {
          setCurrentProgram(programResult.value);
        }
        if (profileResult.status === "fulfilled") {
          setUserProfile(profileResult.value?.profile ?? profileResult.value);
        }

        // 1. Build Workout Cache
        const cache: Record<string, any> = {};
        const history =
          historyResult.status === "fulfilled" ? historyResult.value : null;
        if (history && Array.isArray(history)) {
          history.forEach((w: any) => {
            const d = new Date(w.date).toDateString();
            cache[d] = w;
          });
        }
        setWorkoutCache(cache);

        // 2. Set current day exercises from cache if exists
        const todayStr = new Date().toDateString();
        if (cache[todayStr]) {
          const latest = cache[todayStr];
          setCurrentWorkoutId(latest.id);
          const mapped = latest.exercises.map((we: any) => ({
            id: we.id,
            dbId: we.exerciseId,
            name: we.exercise.exerciseName,
            prescription: `${we.sets}×${we.reps || 10}${we.weight ? "×" + we.weight + " kg" : ""}`,
            img: formatVideoUrlToImg(we.exercise.videoUrl, 0),
            img2: formatVideoUrlToImg(we.exercise.videoUrl, 1),
            type: (we.exercise.typeOfActivity === "CARDIO"
              ? "cardio"
              : "strength") as "cardio" | "strength",
            description: we.exercise.instructions,
            muscles: we.exercise.muscleGroupsActivated || [],
            tips: [],
            weight: we.weight ?? null,
            rpe: we.workoutSets?.[0]?.rpe ?? null,
            rir: we.workoutSets?.[0]?.rir ?? null,
          }));
          setDayExercises(mapped);
        } else {
          // Fallback if no workout for today
          setDayExercises([]);
        }

        setWorkoutStats(
          statsResult.status === "fulfilled" ? statsResult.value : null,
        );
        const schedules =
          schedulesResult.status === "fulfilled" ? schedulesResult.value : [];
        setAiSchedules(Array.isArray(schedules) ? schedules : []);
      } catch (err) {
        console.error("Failed to fetch all data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, [calendarMonth, applyInBodyHistory]);

  useEffect(() => {
    const scheduleForSelectedDate = aiSchedules.find((schedule) => {
      if (!schedule?.date) return false;
      const sameDate = isSameCalendarDay(parseApiDateOnly(schedule.date), selectedDate);
      const sameDay =
        schedule.programDay?.dayNumber == null ||
        Number(schedule.programDay.dayNumber) === Number(selectedDay);
      return sameDate && sameDay;
    });
    const scheduleProgramDay = scheduleForSelectedDate?.programDay;
    const programDays =
      Array.isArray(currentProgram?.days) && currentProgram.days.length > 0
        ? currentProgram.days
        : scheduleProgramDay
          ? [scheduleProgramDay]
          : [];
    if (!Array.isArray(programDays) || programDays.length === 0) {
      setSelectedProgramDayId(null);
      return;
    }

    const selected =
      programDays.find((day: any) => day.dayNumber === selectedDay) ||
      programDays[0];

    const mapped = (selected.exercises || []).map(mapProgramExercise);
    // Roadmap P1.3 "Superset / exercise grouping" — attach each exercise's
    // group metadata (if any), derived fresh from `selected.exerciseGroups`
    // every time this effect runs. Deliberately NOT baked into
    // mapProgramExercise itself (which only sees one exercise at a time,
    // not the day's group list).
    const groupByProgramExerciseId = new Map<string, GroupMetadata>();
    for (const group of (selected as any).exerciseGroups ?? []) {
      for (const member of group.members ?? []) {
        groupByProgramExerciseId.set(member.programExerciseId, {
          groupId: group.id,
          groupType: group.type,
          groupOrder: member.order,
          restBetweenExercisesSeconds: group.restBetweenExercisesSeconds ?? null,
          restAfterRoundSeconds: group.restAfterRoundSeconds ?? null,
        });
      }
    }
    for (const ex of mapped as any[]) {
      const meta = groupByProgramExerciseId.get(ex.programExerciseId);
      if (meta) Object.assign(ex, meta);
    }

    // mapProgramExercise only knows the PLAN template (sets/reps prescribed,
    // no actual numbers logged) — merge in the REAL weight/RPE/RIR from
    // whatever was actually logged on the specific calendar date being
    // viewed, when a workout exists for it. Without this, opening any day
    // other than "today" (the one other place this data gets read — see the
    // history-cache block in fetchAllData above) silently showed blank/
    // template prescriptions instead of what was actually recorded, most
    // visibly as "0 kg" on weighted exercises for a completed past day.
    // Real completion state (which exercises actually have every set marked
    // done) for the same date — computed alongside the weight/RPE/RIR merge
    // above so the "Xong X/Y" progress ring and per-exercise checkmarks
    // reflect history too, not just a freshly-reset live-session counter.
    const cachedWorkout = workoutCache[selectedDate.toDateString()];
    const { merged: mergedExercises, completedIndices: realCompletedIndices } =
      mergeRealWorkoutData(mapped, cachedWorkout);

    setSelectedDay(selected.dayNumber);
    setSelectedProgramDayId(selected.id);
    setDayExercises(mergedExercises);
    setEditExercises(mergedExercises);
    // Always resync completion state to what's really logged for this date —
    // this effect only re-fires on day/program navigation (not on every set
    // completed during a live session, which updates completedExercises
    // directly via handleCompleteExercise), so this can't clobber in-progress
    // live logging.
    setCompletedExercises(realCompletedIndices);
    if (planView !== "activeExercise") {
      setActiveExerciseLogs({});
      setShowCompletion(false);
    }

    // Resolve the exercise id captured from the URL at mount into an actual
    // array index, exactly once per page load (never on later day/program
    // switches the user makes by hand). A missing/stale id (exercise no
    // longer in this day) falls back to the first exercise instead of
    // crashing or looping — the URL-sync effect below then corrects the URL
    // to match via replace.
    if (!appliedPendingExerciseRef.current) {
      appliedPendingExerciseRef.current = true;
      if (pendingExerciseIdRef.current) {
        setActiveExIdx(resolveExerciseIndexFromId(mapped, pendingExerciseIdRef.current));
      }
      pendingExerciseIdRef.current = null;
    }
  }, [currentProgram, selectedDay, planView, selectedDate, workoutCache, aiSchedules]);

  // Calendar schedule modal
  const [showCalendarAdd, setShowCalendarAdd] = useState(false);
  const [scheduleDateInput, setScheduleDateInput] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [scheduleProgramDayId, setScheduleProgramDayId] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  type WeekdaySlot = { enabled: boolean; time: string };
  const [weekdaySlots, setWeekdaySlots] = useState<Record<number, WeekdaySlot>>(
    {
      1: { enabled: true, time: "07:00" },
      3: { enabled: true, time: "07:00" },
      5: { enabled: true, time: "09:00" },
    },
  );
  const [exceptions, setExceptions] = useState<Set<number>>(new Set());
  const WD_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const derivedMarkers: number[] = [];

  const [showManualBuilder, setShowManualBuilder] = useState(false);
  const [savingManualProgram, setSavingManualProgram] = useState(false);
  const [manualProgramName, setManualProgramName] = useState(
    "Chương trình thủ công",
  );
  const [manualDurationWeeks, setManualDurationWeeks] = useState("4");
  const [manualStartDate, setManualStartDate] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [manualDaysPerWeek, setManualDaysPerWeek] = useState(3);
  const [manualSelectedWeekdays, setManualSelectedWeekdays] = useState<
    number[]
  >(DEFAULT_MANUAL_WEEKDAYS[3]);
  const [manualDays, setManualDays] = useState<ManualBuilderDay[]>(() =>
    buildManualDays(3),
  );
  const [manualEditingDayIndex, setManualEditingDayIndex] = useState<
    number | null
  >(null);

  // Build per-day schedule info for the calendar
  const schedulesByDay = (() => {
    const map = new Map<number, CalendarDayInfo[]>();
    try {
      for (const s of aiSchedules || []) {
        const d = parseApiDateOnly(s.date);
        if (isNaN(d.getTime())) continue;
        if (
          d.getFullYear() !== calendarMonth.getFullYear() ||
          d.getMonth() !== calendarMonth.getMonth()
        )
          continue;
        const day = d.getDate();
        const rawTitle = s.programDay?.title || "";
        const dayTitle =
          rawTitle ||
          `Buổi tập ${s.programDay?.dayNumber ?? ""}`.trim() ||
          "Buổi tập";
        const exerciseCount = s.programDay?.exercises?.length ?? 0;
        const list = map.get(day) ?? [];
        list.push({
          title: dayTitle,
          scheduleId: s.id,
          exerciseCount,
          programName: s.programDay?.program?.name,
          sourceType: s.programDay?.program?.sourceType,
          status: s.status,
          workoutId: s.workoutId || s.workout?.id || null,
          isLocked: isScheduleDateApiValueLocked(s.date),
        });
        map.set(day, list);
      }
    } catch {
      /* keep empty map */
    }
    return map;
  })();

  // Fallback flat markers for backward compat
  const calendarMarkers = Array.from(schedulesByDay.keys()).sort(
    (a, b) => a - b,
  );

  // "Buổi tập sắp tới" (Upcoming) must mean exactly that — today or a real
  // future date, using the same Asia/Ho_Chi_Minh-aware comparison as the
  // past-date lock, not just "the first N rows of whatever date range
  // happens to be loaded" (which silently included already-past sessions
  // whenever the loaded page/month started before today). Also excludes
  // duplicate-date rows sharing a calendar day (kept the earliest-created
  // one) so this list can't show the same day twice under two labels.
  const upcomingSchedules = (() => {
    const seenDates = new Set<string>();
    return (aiSchedules || [])
      .filter((s) => !isScheduleDateApiValuePast(s.date))
      .filter((s) => {
        const label = scheduledDateLabelFromApi(s.date);
        if (seenDates.has(label)) return false;
        seenDates.add(label);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  // Real muscle-group / activity-type distribution, computed from actual
  // logged workout history in workoutCache — replaces what used to be two
  // hardcoded, fabricated percentage arrays identical for every user (see
  // workout-analytics.utils.ts's doc comment). Empty array is a real,
  // honest "no data in this range" state, not something to paper over.
  const loggedWorkoutsForAnalytics = Object.values(workoutCache);
  const muscleChartData = withChartColors(
    computeMuscleGroupDistribution(loggedWorkoutsForAnalytics as any, muscleFilter),
  );
  const exerciseTypeData = withChartColors(
    computeActivityTypeDistribution(loggedWorkoutsForAnalytics as any, exerciseFilter),
  );

  // Log modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [logMetric, setLogMetric] = useState<MetricKey>("weight");
  const [logValue, setLogValue] = useState("");
  const [isSavingMetric, setIsSavingMetric] = useState(false);
  const [activeCharts, setActiveCharts] = useState<Set<MetricKey>>(
    new Set<MetricKey>(["weight"]),
  );

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editExercises, setEditExercises] = useState<any[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Roadmap P1.3 "Superset / exercise grouping" — a separate selection mode
  // layered on top of the existing edit-mode list (createExerciseGroup is
  // its own immediate backend call, not deferred to handleSaveWorkout's
  // reorder/field-edit flow).
  const [groupSelectionMode, setGroupSelectionMode] = useState(false);
  const [selectedForGroup, setSelectedForGroup] = useState<Set<string>>(new Set());
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  // Sensible real-world defaults (real, common superset practice: little to
  // no rest between paired exercises, a real rest once the round is done) —
  // editable before creating the group, not hidden/hardcoded.
  const [groupRestBetween, setGroupRestBetween] = useState(30);
  const [groupRestAfterRound, setGroupRestAfterRound] = useState(90);

  const refetchProgramAndSchedules = useCallback(async () => {
    const [program, schedules] = await Promise.all([
      workoutService.getCurrentProgram(),
      workoutService.getSchedules(100, getMonthRange(calendarMonth)),
    ]);
    setCurrentProgram(program);
    setAiSchedules(Array.isArray(schedules) ? schedules : []);
  }, [calendarMonth]);

  // Roadmap P1.4 "Active-workout offline resilience" — drains the durable
  // local queue (see active-workout-offline-queue.utils.ts). Deliberately
  // conservative: rather than trying to replay each event's exact UI
  // side-effects (the user may have navigated to a different exercise/day
  // by the time a queued event from minutes ago finally syncs, and
  // blindly mutating CURRENT state from a stale event risks corrupting
  // whatever is on screen NOW), it just replays each event's raw request,
  // then does ONE refetch of program+schedules once the whole queue has
  // drained — reconciling the UI with the true, authoritative server
  // state rather than guessing it locally. This is also where a genuine
  // whole-workout completion (if the queued event turns out to have been
  // the one that finished the day) gets its real celebration/summary —
  // never shown from an offline guess, only once actually confirmed
  // synced (see the impact analysis's "Conflict strategy").
  const drainOfflineQueue = useCallback(async () => {
    if (isDrainingOfflineQueueRef.current) return;
    const pending = await getPendingWorkoutEvents();
    if (pending.length === 0) {
      setPendingSyncCount(0);
      return;
    }
    isDrainingOfflineQueueRef.current = true;
    setIsSyncingOffline(true);
    let syncedCount = 0;
    let droppedCount = 0;
    try {
      for (const event of pending) {
        try {
          await api.request({ method: event.method, url: event.url, data: event.body });
          await removeWorkoutEvent(event.eventId);
          syncedCount += 1;
        } catch (error: any) {
          if (!error?.response) {
            // Still offline (or the network dropped again mid-drain) —
            // stop here, leave the rest queued, try again on the next
            // 'online' event or mount.
            break;
          }
          // A real server-side rejection (e.g. the schedule's day locked
          // over while this sat queued) — can't safely retry this one
          // forever. Drop it and keep draining the rest, surfacing what
          // happened rather than silently discarding it.
          await removeWorkoutEvent(event.eventId);
          droppedCount += 1;
          toast.error(
            `Không thể đồng bộ một mục đã lưu offline: ${error?.response?.data?.error ?? "lỗi không xác định"}`,
          );
        }
      }
    } finally {
      const remaining = await getPendingWorkoutEvents();
      setPendingSyncCount(remaining.length);
      setIsSyncingOffline(false);
      isDrainingOfflineQueueRef.current = false;
    }
    if (syncedCount > 0) {
      toast.success(`Đã đồng bộ ${syncedCount} thay đổi đã lưu offline.`);
      await refetchProgramAndSchedules();
      // A queued event may have been the one that finally finished the
      // whole workout — re-derive completion state for whichever exercise
      // is on screen now via the normal per-set skeleton refetch, rather
      // than guessing here.
      workoutSetsFetchedForWorkoutIdRef.current = null;
    }
    void droppedCount; // surfaced via the per-event toast above already
  }, [refetchProgramAndSchedules]);

  useEffect(() => {
    void drainOfflineQueue();
    const onOnline = () => void drainOfflineQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [drainOfflineQueue]);

  const findScheduleForDate = useCallback(
    (date: Date) => {
      return (
        aiSchedules.find((schedule) =>
          isSameCalendarDay(parseApiDateOnly(schedule.date), date),
        ) || null
      );
    },
    [aiSchedules],
  );

  const selectedSchedule = useCallback(() => {
    if (selectedScheduleId) {
      const byId = aiSchedules.find(
        (schedule) => schedule.id === selectedScheduleId,
      );
      if (byId) return byId;
    }
    return findScheduleForDate(selectedDate);
  }, [aiSchedules, findScheduleForDate, selectedDate, selectedScheduleId]);

  // Past-date lock (client-side hint only — see schedule-lock.utils.ts).
  // The backend independently rejects any mutation for a locked day
  // regardless of what this value says, so a stale/direct URL landing on
  // planView=activeExercise for a past day still can't actually save
  // anything even before this flag re-renders.
  const isSelectedDayLocked = useMemo(() => {
    const schedule = selectedSchedule();
    const dateValue = schedule?.date ?? toApiDateTime(selectedDate);
    return isScheduleDateApiValueLocked(dateValue);
  }, [selectedSchedule, selectedDate]);

  const applyScheduleProgress = useCallback(
    (scheduleId: string, result: any) => {
      setAiSchedules((previous) =>
        previous.map((schedule) => {
          if (schedule.id !== scheduleId) return schedule;
          return {
            ...schedule,
            workoutId: result.workoutId ?? schedule.workoutId,
            workout: result.workoutId
              ? { ...(schedule.workout || {}), id: result.workoutId }
              : schedule.workout,
            status:
              result.dayStatus === "completed" ? "COMPLETED" : "IN_PROGRESS",
            progressPercent: result.progressPercent,
            completedExercises: result.completedExercises,
            totalExercises: result.totalExercises,
            completedSets: result.completedSets,
            totalSets: result.totalSets,
            completedAt: result.completedAt ?? schedule.completedAt,
          };
        }),
      );
    },
    [],
  );

  const openScheduleModal = useCallback(
    (date = selectedDate) => {
      setScheduleDateInput(toDateInputValue(date));
      const firstDay = currentProgram?.days?.[0];
      setScheduleProgramDayId((prev) => prev || firstDay?.id || "");
      setScheduleNotes("");
      setShowCalendarAdd(true);
    },
    [currentProgram, selectedDate],
  );

  const handleCreateSchedule = async () => {
    if (!currentProgram?.days?.length) {
      toast.error("Bạn chưa có chương trình tập. Hãy tạo AI Plan trước.");
      return;
    }
    if (!scheduleDateInput) {
      toast.error("Vui lòng chọn ngày tập.");
      return;
    }
    if (!scheduleProgramDayId) {
      toast.error("Vui lòng chọn buổi tập.");
      return;
    }

    setSavingSchedule(true);
    try {
      const result: any = await workoutService.createSchedule({
        date: scheduleDateInput,
        programDayId: scheduleProgramDayId,
        notes: scheduleNotes.trim() || undefined,
      });
      await refetchProgramAndSchedules();
      setSelectedDate(new Date(`${scheduleDateInput}T00:00:00`));
      setShowCalendarAdd(false);
      toast.success(
        result?.alreadyExists
          ? "Ngày này đã có lịch tập."
          : "Đã thêm lịch tập.",
      );
    } catch (error: any) {
      const message =
        error?.response?.status === 409
          ? "Ngày này đã có lịch tập."
          : error?.response?.data?.error ||
            "Không thể thêm lịch tập. Vui lòng thử lại.";
      toast.error(message);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCreateManualProgram = async () => {
    const durationWeeks = Number(manualDurationWeeks);
    if (!manualProgramName.trim()) {
      toast.error("Vui lòng nhập tên chương trình");
      return;
    }
    if (
      !Number.isFinite(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      toast.error("Số tuần phải trong khoảng 1-52");
      return;
    }
    if (manualSelectedWeekdays.length !== manualDaysPerWeek) {
      toast.error(`Vui lòng chọn đủ ${manualDaysPerWeek} ngày tập trong tuần`);
      return;
    }
    const emptyDay = manualDays.find((day) => day.exercises.length === 0);
    if (emptyDay) {
      toast.error(`Buổi ${emptyDay.dayNumber} cần ít nhất 1 bài tập`);
      return;
    }

    setSavingManualProgram(true);
    try {
      const result: any = await workoutService.createManualProgram({
        name: manualProgramName.trim(),
        goal: userProfile?.goal || null,
        durationWeeks,
        daysPerWeek: manualDaysPerWeek,
        startDate: manualStartDate,
        repeatWeeks: durationWeeks,
        selectedWeekdays: manualSelectedWeekdays,
        replaceExisting: true,
        days: manualDays.map((day) => ({
          dayNumber: day.dayNumber,
          title: day.title.trim() || `Buổi ${day.dayNumber}`,
          exercises: day.exercises.map((exercise, index) => ({
            exerciseId: exercise.exerciseId,
            order: index + 1,
            sets: exercise.sets,
            reps: exercise.reps,
            restSeconds: exercise.restSeconds,
          })),
        })),
      });
      await refetchProgramAndSchedules();
      setShowManualBuilder(false);
      toast.success(
        `Đã tạo chương trình thủ công với ${result?.createdScheduleCount ?? 0} lịch tập`,
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error || "Không thể tạo chương trình thủ công",
      );
    } finally {
      setSavingManualProgram(false);
    }
  };

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refetchProgramAndSchedules();
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refetchProgramAndSchedules]);

  // Roadmap P1.3 "Superset / exercise grouping" — an immediate backend
  // call (not deferred to handleSaveWorkout), so grouping never gets
  // silently lost if the user exits edit mode without hitting "Lưu ngay".
  // Type is derived from how many were selected (2=SUPERSET, 3=TRISET,
  // 4+=CIRCUIT) — no separate type-picker UI, keeping the selection flow
  // to one action.
  const handleCreateGroup = async () => {
    if (!selectedProgramDayId || selectedForGroup.size < 2) return;
    setIsCreatingGroup(true);
    try {
      const type = selectedForGroup.size === 2 ? "SUPERSET" : selectedForGroup.size === 3 ? "TRISET" : "CIRCUIT";
      await workoutService.createExerciseGroup(
        selectedProgramDayId,
        [...selectedForGroup],
        type,
        groupRestBetween,
        groupRestAfterRound,
      );
      toast.success(`Đã nhóm ${selectedForGroup.size} bài tập thành ${GROUP_TYPE_LABEL_VI[type]}.`);
      setGroupSelectionMode(false);
      setSelectedForGroup(new Set());
      setEditMode(false);
      await refetchProgramAndSchedules();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể nhóm các bài tập này.");
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleUngroupExercises = async (groupId: string) => {
    try {
      await workoutService.ungroupExercises(groupId);
      toast.success("Đã bỏ nhóm bài tập.");
      await refetchProgramAndSchedules();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể bỏ nhóm bài tập này.");
    }
  };

  const handleSaveWorkout = async (silent = false) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (selectedProgramDayId && currentProgram) {
        if (editExercises.length === 0) {
          throw new Error("Mỗi ngày tập cần ít nhất 1 bài tập.");
        }
        const existingIds = new Set(
          (currentProgram.days || [])
            .flatMap((day: any) => day.exercises || [])
            .map((exercise: any) => exercise.id),
        );

        for (const [index, ex] of editExercises.entries()) {
          const payload = {
            exerciseId: ex.dbId,
            order: index + 1,
            sets: Number(ex.sets) || 3,
            reps: Number(ex.reps) || 10,
            restSeconds: Number(ex.restSeconds) || 90,
            notes: ex.notes || null,
          };

          if (!payload.exerciseId) {
            throw new Error(
              `Exercise "${ex.name}" does not have a database ID.`,
            );
          }

          if (ex.programExerciseId && existingIds.has(ex.programExerciseId)) {
            await workoutService.updateProgramExercise(
              ex.programExerciseId,
              payload,
            );
          } else {
            await workoutService.addProgramExercise(
              selectedProgramDayId,
              payload,
            );
          }
        }

        const editedIds = new Set(
          editExercises.map((ex) => ex.programExerciseId).filter(Boolean),
        );
        const selectedDayModel = (currentProgram.days || []).find(
          (day: any) => day.id === selectedProgramDayId,
        );
        for (const existing of selectedDayModel?.exercises || []) {
          if (!editedIds.has(existing.id)) {
            await workoutService.deleteProgramExercise(existing.id);
          }
        }

        await refetchProgramAndSchedules();
        setDayExercises(editExercises);
        if (!silent) setEditMode(false);
        return;
      }

      const saveDate = selectedDate;
      const payload = {
        name: `Workout for ${saveDate.toLocaleDateString()}`,
        date: toApiDateTime(saveDate),
        exercises: editExercises.map((ex) => {
          // Ensure we have a valid UUID for exerciseId
          // If it's a seed ID or missing, we need to skip it or handle it
          const exerciseId = ex.dbId;
          if (!exerciseId || exerciseId.startsWith("seed")) {
            throw new Error(
              `Exercise "${ex.name}" does not have a valid database ID. Please remove and re-add it from the search list.`,
            );
          }
          return {
            exerciseId: exerciseId,
            sets: 3,
            reps: 10,
            weight: 0,
          };
        }),
      };

      if (currentWorkoutId) {
        await workoutService.updateWorkout(currentWorkoutId, payload);
      } else {
        const res = await workoutService.logWorkout(payload);
        if (res && res.id) {
          setCurrentWorkoutId(res.id);
          // Update cache with the new workout
          const dStr = saveDate.toDateString();
          setWorkoutCache({
            ...workoutCache,
            [dStr]: {
              ...res,
              exercises: editExercises.map((e) => ({
                ...e,
                exercise: {
                  exerciseName: e.name,
                  videoUrl: e.img,
                  instructions: e.description,
                  muscleGroupsActivated: e.muscles,
                },
              })),
            },
          });
        }
      }

      setDayExercises(editExercises);
      if (!silent) setEditMode(false);
    } catch (err: any) {
      console.error("Failed to save workout:", err);
      const msg = err.response?.data?.error || err.message || "Unknown error";
      if (!silent) alert(`Không thể lưu buổi tập: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Auto-save effect
  useEffect(() => {
    if (editMode && editExercises.length > 0) {
      const timer = setTimeout(() => {
        handleSaveWorkout(true); // silent save
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [editExercises, editMode]);

  // Active workout state
  const [activeExIdx, setActiveExIdx] = useState(0);
  // The exercise id read from the URL at mount, and whether we've already
  // attempted to resolve it into an activeExIdx once dayExercises loaded —
  // guarded so this only ever runs once per page load, never on later
  // day/program switches the user makes by hand.
  const pendingExerciseIdRef = useRef<string | null>(initialExerciseIdFromUrl);
  const appliedPendingExerciseRef = useRef(false);

  // Keep the URL in sync with in-app navigation (day / exercise / tab) so a
  // hard refresh — or opening the same URL in a new tab — lands back on the
  // exact same workout position. Deliberately NOT reactive to `searchParams`
  // itself (only to the navigation state that should drive it), and always
  // uses replace so switching exercises doesn't spam browser history.
  useEffect(() => {
    // Skip while the initial URL-driven exercise restoration is still
    // pending — otherwise this would prematurely overwrite the just-read
    // exercise id with index 0 before it's had a chance to resolve.
    if (planView === "activeExercise" && !appliedPendingExerciseRef.current) return;

    const next = computeWorkoutLogSearchParams({
      planView,
      selectedDay,
      selectedDateLabel: planView === "main" ? null : toDateInputValue(selectedDate),
      currentExerciseId: dayExercises[activeExIdx]?.id,
    });
    const nextStr = next.toString();
    if (nextStr !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planView, selectedDay, selectedDate, activeExIdx, dayExercises]);

  const [completedExercises, setCompletedExercises] = useState<Set<number>>(
    new Set(),
  );
  const [activeExerciseLogs, setActiveExerciseLogs] = useState<
    Record<number, ActiveExerciseLog>
  >({});
  const activeExerciseLogsRef = useRef<Record<number, ActiveExerciseLog>>({});
  useEffect(() => {
    activeExerciseLogsRef.current = activeExerciseLogs;
  }, [activeExerciseLogs]);
  const [isCompletingWorkout, setIsCompletingWorkout] = useState(false);
  const [showExerciseDetail, setShowExerciseDetail] = useState<any | null>(
    null,
  );
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [restTimerRunning, setRestTimerRunning] = useState(false);
  const [restSeconds, setRestSeconds] = useState(90);
  const [showCompletion, setShowCompletion] = useState(false);
  // PR/volume for the just-finished session — fetched once the workout is
  // saved (see loadCompletionSummary), shown on the completion screen.
  // Non-critical: if this fails to load the completion screen still works,
  // it just skips the PR/volume block (see loadCompletionSummary's catch).
  const [completionSummary, setCompletionSummary] = useState<WorkoutSessionSummary | null>(null);
  // "Previous performance" reference context (gap analysis P0 #1) — keyed by
  // exercise dbId so it's cached across navigating back/forth between
  // exercises in the same session. Deliberately never mixed into
  // activeExerciseLogs (the user's actual input) — this is read-only
  // reference, never a prefilled/editable value.
  const [previousPerformanceByExercise, setPreviousPerformanceByExercise] = useState<
    Record<string, PreviousPerformance | null>
  >({});
  // Deterministic per-exercise progression (docs/TRAINING_PROGRESSION_ARCHITECTURE.md)
  // — same caching-by-exercise-dbId pattern as previousPerformanceByExercise
  // above, and equally never fed back into activeExerciseLogs: this is the
  // engine's committed target/explanation, shown as reference, never a
  // silently-applied prefill.
  const [progressionByExercise, setProgressionByExercise] = useState<
    Record<string, ExerciseProgression | null>
  >({});
  const [smartPrefillSourceByExercise, setSmartPrefillSourceByExercise] = useState<
    Record<string, SmartPrefillSource>
  >({});
  const [feedbackPrompt, setFeedbackPrompt] = useState<{ scheduleId: string } | null>(null);
  const [skipCancelPrompt, setSkipCancelPrompt] = useState<{ scheduleId: string } | null>(null);
  // Roadmap P1.2 "Reschedule workout".
  const [reschedulePrompt, setReschedulePrompt] = useState<{
    scheduleId: string;
    currentDateLabel: string;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock end-timestamp for the rest timer (gap analysis P0 "Rest
  // timer — fragile": setInterval alone drifts under background-tab
  // throttling because it just decrements a counter once per tick instead
  // of checking real elapsed time). Ticking against this instead of blindly
  // decrementing keeps the displayed time accurate even if a tick or two
  // gets throttled/delayed.
  const restEndAtRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Roadmap P1.5 "Custom exercises" — the create-form modal, layered on
  // top of the existing Add Exercise picker (opened from within it).
  const [showCreateCustomExercise, setShowCreateCustomExercise] = useState(false);

  // Add Exercise Modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [debouncedDbSearch, setDebouncedDbSearch] = useState("");
  const [dbExercises, setDbExercises] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [exerciseOptions, setExerciseOptions] = useState<any>({});
  const [pickerBodyPart, setPickerBodyPart] = useState("");
  const [pickerMuscleGroup, setPickerMuscleGroup] = useState("");
  const [pickerEquipment, setPickerEquipment] = useState("");
  const [pickerActivityType, setPickerActivityType] = useState("");
  const [pickerSort, setPickerSort] = useState<
    "name" | "bodyPart" | "equipment"
  >("bodyPart");
  const [replaceExerciseIndex, setReplaceExerciseIndex] = useState<
    number | null
  >(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDbSearch(dbSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [dbSearch]);

  useEffect(() => {
    if (!showAddExercise) return;
    workoutService
      .getExerciseFilterOptions()
      .then(setExerciseOptions)
      .catch(() => setExerciseOptions({}));
  }, [showAddExercise]);

  const clearExerciseFilters = useCallback(() => {
    setDbSearch("");
    setPickerBodyPart("");
    setPickerMuscleGroup("");
    setPickerEquipment("");
    setPickerActivityType("");
    setPickerSort("bodyPart");
  }, []);

  const openManualBuilder = useCallback(() => {
    setManualProgramName("Chương trình thủ công");
    setManualDurationWeeks("4");
    setManualStartDate(toDateInputValue(new Date()));
    setManualDaysPerWeek(3);
    setManualSelectedWeekdays(DEFAULT_MANUAL_WEEKDAYS[3]);
    setManualDays(buildManualDays(3));
    setManualEditingDayIndex(null);
    clearExerciseFilters();
    setShowManualBuilder(true);
  }, [clearExerciseFilters]);

  const updateManualDaysPerWeek = useCallback((nextDaysPerWeek: number) => {
    setManualDaysPerWeek(nextDaysPerWeek);
    setManualSelectedWeekdays(DEFAULT_MANUAL_WEEKDAYS[nextDaysPerWeek]);
    setManualDays((previous) => buildManualDays(nextDaysPerWeek, previous));
  }, []);

  const toggleManualWeekday = useCallback(
    (weekday: number) => {
      setManualSelectedWeekdays((previous) => {
        if (previous.includes(weekday)) {
          return previous.filter((item) => item !== weekday);
        }
        if (previous.length >= manualDaysPerWeek) {
          toast.error(`Chỉ chọn ${manualDaysPerWeek} ngày tập trong tuần`);
          return previous;
        }
        return MANUAL_WEEKDAYS.map((option) => option.value).filter((value) =>
          [...previous, weekday].includes(value),
        );
      });
    },
    [manualDaysPerWeek],
  );

  const preselectExerciseFilter = useCallback((exercise: any) => {
    setDbSearch("");
    setPickerEquipment("");
    setPickerActivityType("");
    const muscles = Array.isArray(exercise?.muscles)
      ? exercise.muscles.map((m: string) => m.toLowerCase())
      : [];
    if (exercise?.bodyPart === "CORE" || muscles.includes("abdominals")) {
      setPickerBodyPart("CORE");
      setPickerMuscleGroup("");
    } else if (
      exercise?.bodyPart === "LOWER_BODY" ||
      muscles.some((m: string) =>
        ["quadriceps", "hamstrings", "glutes", "calves"].includes(m),
      )
    ) {
      setPickerBodyPart("LOWER_BODY");
      setPickerMuscleGroup("");
    } else if (muscles.includes("chest")) {
      setPickerBodyPart("");
      setPickerMuscleGroup("chest");
    } else if (
      muscles.some((m: string) =>
        ["lats", "middle back", "lower back", "traps"].includes(m),
      )
    ) {
      setPickerBodyPart("");
      setPickerMuscleGroup("back");
    } else if (muscles.includes("shoulders")) {
      setPickerBodyPart("");
      setPickerMuscleGroup("shoulders");
    } else if (muscles.includes("biceps")) {
      setPickerBodyPart("");
      setPickerMuscleGroup("biceps");
    } else if (muscles.includes("triceps")) {
      setPickerBodyPart("");
      setPickerMuscleGroup("triceps");
    } else {
      setPickerBodyPart(exercise?.bodyPart || "");
      setPickerMuscleGroup("");
    }
  }, []);

  const exercisesQuery = useQuery({
    queryKey: [
      "exercises",
      debouncedDbSearch,
      pickerBodyPart,
      pickerMuscleGroup,
      pickerEquipment,
      pickerActivityType,
      1,
    ],
    queryFn: () =>
      workoutService.getExercises({
        search: debouncedDbSearch || undefined,
        bodyPart: pickerBodyPart || undefined,
        muscleGroup: pickerMuscleGroup || undefined,
        equipment: pickerEquipment || undefined,
        activityType: pickerActivityType || undefined,
        page: 1,
        limit: 60,
      }),
    enabled: showAddExercise,
    staleTime: 30_000,
  });

  // Roadmap P1.5 "Custom exercises" — the caller's own custom exercises,
  // fetched separately from the public catalog search above (they're
  // deliberately never returned by it — see the impact analysis's "no
  // catalog contamination"). Shown as its own "Của tôi" section in the
  // picker below, unfiltered by the catalog's own bodyPart/equipment/
  // search filters — a disclosed simplification (a real user's own custom
  // list stays small, so always showing all of it is a reasonable
  // trade-off against the complexity of applying the same filters
  // client-side to a differently-shaped query).
  const myCustomExercisesQuery = useQuery({
    queryKey: ["my-custom-exercises"],
    queryFn: () => workoutService.listMyCustomExercises(),
    enabled: showAddExercise,
    staleTime: 10_000,
  });

  useEffect(() => {
    setDbLoading(exercisesQuery.isFetching);
    if (exercisesQuery.isError) {
      setDbError("Không tải được danh sách bài tập");
      setDbExercises([]);
      return;
    }
    setDbError(null);
    setDbExercises(
      Array.isArray(exercisesQuery.data) ? exercisesQuery.data : [],
    );
  }, [exercisesQuery.data, exercisesQuery.isError, exercisesQuery.isFetching]);

  const sortedDbExercises = [...dbExercises].sort((a, b) => {
    if (pickerSort === "bodyPart") {
      return (
        String(a.bodyPart || "").localeCompare(String(b.bodyPart || "")) ||
        String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""))
      );
    }
    if (pickerSort === "equipment") {
      return (
        String(a.typeOfEquipment || "").localeCompare(
          String(b.typeOfEquipment || ""),
        ) ||
        String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""))
      );
    }
    return String(a.exerciseName || "").localeCompare(
      String(b.exerciseName || ""),
    );
  });

  const groupedDbExercises = sortedDbExercises.reduce(
    (groups: Record<string, any[]>, exercise) => {
      const key =
        pickerSort === "equipment"
          ? groupTitle(exercise.typeOfEquipment)
          : groupTitle(exercise.bodyPart);
      groups[key] = groups[key] || [];
      groups[key].push(exercise);
      return groups;
    },
    {},
  );

  const handleAddFromDB = async (dbEx: any) => {
    const newEx = {
      id: Date.now(), // temporary UI id
      dbId: dbEx.id,
      name: dbEx.exerciseName,
      prescription: "3×10", // Default prescription
      sets: 3,
      reps: 10,
      restSeconds: 90,
      notes: "",
      img: formatVideoUrlToImg(dbEx.videoUrl, 0),
      img2: formatVideoUrlToImg(dbEx.videoUrl, 1),
      type: (dbEx.typeOfActivity === "CARDIO" ? "cardio" : "strength") as
        | "cardio"
        | "strength",
      bodyPart: dbEx.bodyPart,
      equipment: dbEx.typeOfEquipment,
      activityType: dbEx.typeOfActivity,
      movementType: dbEx.type,
      description: dbEx.instructions,
      muscles: dbEx.muscleGroupsActivated || [],
      tips: [],
    };
    if (showManualBuilder && manualEditingDayIndex !== null) {
      setManualDays((previous) =>
        previous.map((day, index) => {
          if (index !== manualEditingDayIndex) return day;
          return {
            ...day,
            exercises: [
              ...day.exercises,
              {
                exerciseId: dbEx.id,
                exerciseName: dbEx.exerciseName,
                sets: 3,
                reps: 10,
                restSeconds: 90,
              },
            ],
          };
        }),
      );
      setShowAddExercise(false);
      return;
    }
    if (replaceExerciseIndex !== null) {
      const next = [...editExercises];
      const existing = next[replaceExerciseIndex];
      if (existing?.programExerciseId) {
        setDbLoading(true);
        try {
          await workoutService.updateProgramExercise(
            existing.programExerciseId,
            { exerciseId: dbEx.id },
          );
          next[replaceExerciseIndex] = {
            ...newEx,
            id: existing.id,
            programExerciseId: existing.programExerciseId,
          };
          setEditExercises(next);
          setDayExercises(next);
          await refetchProgramAndSchedules();
          toast.success("Đã đổi bài tập");
        } catch (error) {
          console.error("Failed to replace exercise:", error);
          toast.error("Không thể đổi bài tập. Vui lòng thử lại.");
          setDbLoading(false);
          return;
        } finally {
          setDbLoading(false);
        }
      } else {
        next[replaceExerciseIndex] = {
          ...newEx,
          id: existing?.id,
          programExerciseId: existing?.programExerciseId,
        };
        setEditExercises(next);
      }
      setReplaceExerciseIndex(null);
    } else {
      setEditExercises([...editExercises, newEx]);
    }
    setShowAddExercise(false);
  };

  // Timer effect
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

  // Rest timer persistence — survives navigating away/back within the SPA
  // AND a full page reload (gap flagged in review: the earlier wall-clock
  // fix made the countdown ACCURATE but not persisted across a remount).
  // Scoped per schedule so a stale timer from a different session never
  // bleeds into a new one. localStorage access is defensively wrapped —
  // private-browsing/storage-blocked contexts must never break the timer,
  // just silently skip persistence.
  const restTimerStorageKey = (scheduleId: string | null) =>
    `fitness-assistant:rest-timer:${scheduleId ?? "freeform"}`;

  const persistRestTimer = (scheduleId: string | null, endAt: number) => {
    try {
      localStorage.setItem(
        restTimerStorageKey(scheduleId),
        JSON.stringify({ endAt, scheduleId }),
      );
    } catch {
      // ignore — persistence is a convenience, never a hard dependency
    }
  };

  const clearPersistedRestTimer = (scheduleId: string | null) => {
    try {
      localStorage.removeItem(restTimerStorageKey(scheduleId));
    } catch {
      // ignore
    }
  };

  // Restore a still-running rest timer once, when we know which schedule
  // we're looking at (covers both a fresh page load and navigating back
  // into activeExercise view). Only ever resumes a timer that is still in
  // the future and belongs to THIS schedule — a stale/expired/foreign entry
  // is silently discarded, never resurrected.
  const restTimerRestoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (planView !== "activeExercise") return;
    // FINAL P0 CLOSURE PASS fix (BUG-03): a direct page load/reload landing
    // straight in activeExercise view (via URL restoration) never runs any
    // of the click handlers that call setSelectedScheduleId — that state
    // stays null for the whole session unless the user has clicked through
    // the calendar or just completed an exercise. selectedSchedule() is the
    // one place this codebase already solves exactly this problem (falls
    // back to a date-based lookup against aiSchedules when the id state
    // isn't set yet — see its own definition above), so the rest timer must
    // key off THAT, not the raw state, or a real (non-freeform) timer can
    // never be found again after a reload even though it was persisted
    // correctly under the real schedule id in the first place.
    const key = selectedSchedule()?.id ?? null;
    if (restTimerRestoredForRef.current === (key ?? "freeform")) return;
    restTimerRestoredForRef.current = key ?? "freeform";
    try {
      const raw = localStorage.getItem(restTimerStorageKey(key));
      if (!raw) return;
      const saved = JSON.parse(raw) as { endAt: number; scheduleId: string | null };
      const remaining = Math.round((saved.endAt - Date.now()) / 1000);
      if (remaining > 0) {
        restEndAtRef.current = saved.endAt;
        setRestSeconds(remaining);
        setRestTimerRunning(true);
      } else {
        clearPersistedRestTimer(key);
      }
    } catch {
      // ignore — corrupt/inaccessible storage just means no restore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planView, selectedScheduleId, aiSchedules, selectedDate]);

  // Rest timer effect — ticks against a stored wall-clock end-timestamp
  // (restEndAtRef) rather than blindly decrementing a counter, so the
  // displayed time stays accurate even if a tick gets delayed/throttled
  // (e.g. a backgrounded mobile tab), instead of silently drifting behind
  // real elapsed time.
  useEffect(() => {
    if (!restTimerRunning) {
      if (restRef.current) clearInterval(restRef.current);
      restEndAtRef.current = null;
      return;
    }
    if (restEndAtRef.current == null) {
      restEndAtRef.current = Date.now() + restSeconds * 1000;
    }
    persistRestTimer(selectedSchedule()?.id ?? null, restEndAtRef.current);
    const tick = () => {
      const endAt = restEndAtRef.current;
      const remaining = endAt == null ? 0 : Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setRestSeconds(remaining);
      if (remaining <= 0) {
        setRestTimerRunning(false);
        restEndAtRef.current = null;
        clearPersistedRestTimer(selectedSchedule()?.id ?? null);
      }
    };
    tick();
    restRef.current = setInterval(tick, 1000);
    return () => {
      if (restRef.current) clearInterval(restRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restTimerRunning]);

  // Screen Wake Lock — progressive enhancement (gap analysis P0 "Rest
  // timer"). Feature-detected: on a browser without support, wakeLockRef
  // just stays null and the timer/workout logging work exactly as before —
  // this is never a hard dependency (task's own instruction: "Không để Wake
  // Lock thành dependency"). Held while either timer is actively running.
  useEffect(() => {
    const nav = navigator as any;
    const active = restTimerRunning || timerRunning;
    if (active && !wakeLockRef.current) {
      requestWakeLockSafe(nav).then((lock) => {
        wakeLockRef.current = lock;
      });
    } else if (!active && wakeLockRef.current) {
      releaseWakeLockSafe(wakeLockRef.current);
      wakeLockRef.current = null;
    }
    return () => {
      if (!restTimerRunning && !timerRunning && wakeLockRef.current) {
        releaseWakeLockSafe(wakeLockRef.current);
        wakeLockRef.current = null;
      }
    };
  }, [restTimerRunning, timerRunning]);

  // "Previous performance" fetch — gap analysis P0 #1. Loads once per
  // exercise per session (cached in previousPerformanceByExercise), fires
  // whenever the active exercise changes. Non-critical: a failed fetch just
  // leaves the reference card absent, never blocks logging.
  useEffect(() => {
    const curEx = dayExercises[activeExIdx];
    const exerciseDbId = curEx?.dbId;
    if (!exerciseDbId || previousPerformanceByExercise[exerciseDbId] !== undefined) {
      return;
    }
    let cancelled = false;
    workoutService
      .getPreviousPerformance(exerciseDbId)
      .then((result) => {
        if (!cancelled) {
          setPreviousPerformanceByExercise((prev) => ({ ...prev, [exerciseDbId]: result }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviousPerformanceByExercise((prev) => ({ ...prev, [exerciseDbId]: null }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeExIdx, dayExercises, previousPerformanceByExercise]);

  // Deterministic per-exercise progression fetch — same shape/caching
  // pattern as the previous-performance effect above. Non-critical: a
  // failed fetch just leaves the target/explanation card absent.
  useEffect(() => {
    const curEx = dayExercises[activeExIdx];
    const exerciseDbId = curEx?.dbId;
    if (!exerciseDbId || progressionByExercise[exerciseDbId] !== undefined) {
      return;
    }
    let cancelled = false;
    workoutService
      .getExerciseProgression(exerciseDbId)
      .then((result) => {
        if (!cancelled) {
          setProgressionByExercise((prev) => ({ ...prev, [exerciseDbId]: result }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProgressionByExercise((prev) => ({ ...prev, [exerciseDbId]: null }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeExIdx, dayExercises, progressionByExercise]);

  // Roadmap P1.1 "true set-by-set table UI" — the real per-set skeleton
  // (see docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md's audit
  // findings: startSchedule already pre-creates one WorkoutSet row per
  // planned set the moment the session starts). Fetched once per workoutId
  // via GET /workouts/:id, which already returns exercises[].workoutSets[]
  // ordered by setNumber. Only applies to the schedule-linked path — the
  // ad-hoc/freeform logging branch has no schedule/workoutId to key off and
  // keeps its existing single-value-per-exercise behavior untouched.
  useEffect(() => {
    if (planView !== "activeExercise") return;
    const schedule = selectedSchedule();
    if (!schedule?.id) return;
    const workoutId = schedule.workoutId || (schedule as any)?.workout?.id || currentWorkoutId;

    if (!workoutId) {
      // Reaching the active view via a direct/deep-link URL (rather than
      // clicking "Bắt đầu tập") never calls startSchedule, so no
      // WorkoutExercise/WorkoutSet skeleton exists yet — without eagerly
      // creating it here, the table (and per-set undo/prefill) would never
      // appear for that very common landing path; the first completion
      // would silently fall straight to the old bulk-complete path instead,
      // defeating this whole feature for it. Never attempted on a locked
      // day (matches "Bắt đầu tập"'s own disabled state there — a locked
      // day with no existing session must stay read-only) or more than
      // once per schedule.
      if (isSelectedDayLocked) return;
      if (workoutStartAttemptedForScheduleIdRef.current === schedule.id) return;
      workoutStartAttemptedForScheduleIdRef.current = schedule.id;
      workoutService
        .startSchedule(schedule.id)
        .then((started: any) => {
          applyScheduleProgress(schedule.id, started);
          setSelectedScheduleId(schedule.id);
          if (started?.workoutId) setCurrentWorkoutId(started.workoutId);
        })
        .catch(() => {
          // Non-critical: same fallback as below — the table just won't
          // appear, and completion falls back to the old bulk path.
          workoutStartAttemptedForScheduleIdRef.current = null;
        });
      return;
    }

    if (workoutSetsFetchedForWorkoutIdRef.current === workoutId) return;
    workoutSetsFetchedForWorkoutIdRef.current = workoutId;
    workoutService
      .getWorkout(workoutId)
      .then((workout: any) => {
        const byProgramExerciseId: Record<string, WorkoutSetRow[]> = {};
        for (const exercise of workout?.exercises ?? []) {
          if (!exercise.programExerciseId) continue;
          byProgramExerciseId[exercise.programExerciseId] = (exercise.workoutSets ?? [])
            .slice()
            .sort((a: any, b: any) => a.setNumber - b.setNumber)
            .map((set: any) => ({
              id: set.id,
              setNumber: set.setNumber,
              completed: Boolean(set.completed),
              weight: set.weight ?? null,
              reps: set.reps ?? null,
              rpe: set.rpe ?? null,
              rir: set.rir ?? null,
              bodyWeightAtSetKg: set.bodyWeightAtSetKg ?? null,
              durationSeconds: set.durationSeconds ?? null,
              distanceMeters: set.distanceMeters ?? null,
            }));
        }
        setWorkoutSetsByExercise((prev) => ({ ...prev, ...byProgramExerciseId }));
      })
      .catch(() => {
        // Non-critical: falls back to today's exercise-level completion —
        // see curExSetRows === undefined handling at every call site below.
        workoutSetsFetchedForWorkoutIdRef.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkoutId, selectedScheduleId, currentProgram, aiSchedules, selectedDate, planView, isSelectedDayLocked]);

  // Smart set prefill (roadmap P1.1), with session-resume draft restoration
  // (roadmap P1.7) taking priority. This initializes the editable draft for
  // the active exercise only after both async context calls have settled, so a
  // slower deterministic target can still beat raw previous-performance data.
  // It never marks a set/exercise complete and never overwrites a draft once
  // the user has edited it.
  useEffect(() => {
    const curEx = dayExercises[activeExIdx];
    const exerciseDbId = curEx?.dbId;
    if (!exerciseDbId) return;
    if (completedExercises.has(activeExIdx)) return;
    if (activeExerciseLogsRef.current[activeExIdx]) return;

    // A real, recent (<=12h old) draft the user already typed into THIS
    // exact schedule+exercise pair — e.g. after a reload mid-set — always
    // wins over recomputing a fresh prefill. Synchronous (no network
    // round-trip needed), so it reappears immediately rather than waiting
    // on previous-performance/progression to resolve.
    const restoredDraft = readPersistedActiveLogDraft(
      selectedSchedule()?.id ?? null,
      exerciseDbId,
    );
    if (restoredDraft) {
      const next = {
        ...activeExerciseLogsRef.current,
        [activeExIdx]: restoredDraft,
      };
      activeExerciseLogsRef.current = next;
      setActiveExerciseLogs(next);
      return;
    }

    const previous = previousPerformanceByExercise[exerciseDbId];
    const progression = progressionByExercise[exerciseDbId];
    if (previous === undefined || progression === undefined) return;

    // Roadmap P1.1 "true set-by-set table UI" — when the real per-set
    // skeleton has loaded, prefer THIS set's own previous actual (set 3
    // should reference set 3's own history) over always set 1's. Falls
    // back to the pre-existing behavior (undefined targetSetNumber) when
    // the skeleton hasn't loaded yet — never blocks prefill on it.
    const setRows = curEx?.programExerciseId
      ? workoutSetsByExercise[curEx.programExerciseId]
      : undefined;
    const targetSetNumber = setRows?.find((row) => !row.completed)?.setNumber;

    const selected = selectSmartSetPrefill({
      loggingMode: exerciseLoggingMode(curEx),
      progression,
      previousSets: previous?.hasHistory ? previous.sets : [],
      exerciseDefaults: {
        weight: curEx?.weight ?? null,
        bodyWeightAtSetKg: curEx?.bodyWeightAtSetKg ?? null,
        reps: curEx?.reps ?? null,
        durationSeconds: curEx?.durationSeconds ?? null,
        distanceMeters: curEx?.distanceMeters ?? null,
        rpe: curEx?.rpe ?? null,
        rir: curEx?.rir ?? null,
      },
      userCurrentWeightKg: userProfile?.currentWeight ?? null,
      targetSetNumber,
    });

    setSmartPrefillSourceByExercise((prev) => ({
      ...prev,
      [exerciseDbId]: selected.source,
    }));
    const next = {
      ...activeExerciseLogsRef.current,
      [activeExIdx]: selected.draft,
    };
    activeExerciseLogsRef.current = next;
    setActiveExerciseLogs(next);
  }, [
    activeExIdx,
    completedExercises,
    dayExercises,
    previousPerformanceByExercise,
    progressionByExercise,
    userProfile?.currentWeight,
    workoutSetsByExercise,
  ]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const fireConfetti = useCallback(() => {
    const duration = 4000;
    const end = Date.now() + duration;
    const colors = [
      "#10b981",
      "#22c55e",
      "#a3e635",
      "#34d399",
      "#6ee7b7",
      "#ffffff",
    ];
    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    // Big burst first
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { y: 0.6 },
      colors,
      scalar: 1.2,
    });
    frame();
  }, []);

  const loadCompletionSummary = async (workoutId: string) => {
    try {
      const summary = await workoutService.getSessionSummary(workoutId);
      setCompletionSummary(summary);
    } catch (err) {
      // Non-critical: the completion screen already shows without it.
      console.warn("[WorkoutLogPage] Could not load session summary", err);
    }
  };

  const persistCompletedWorkout = async () => {
    const scheduleForSave = selectedSchedule();
    const saveDate = scheduleForSave?.date
      ? parseApiDateOnly(scheduleForSave.date)
      : selectedDate;
    const scheduleWorkoutId =
      scheduleForSave?.workoutId || scheduleForSave?.workout?.id || null;
    const scheduleId = selectedScheduleId || scheduleForSave?.id || undefined;
    const payload = {
      scheduleId,
      name: `Workout for ${saveDate.toLocaleDateString()}`,
      date: toApiDateTime(saveDate),
      duration: Math.max(1, Math.ceil(timerSeconds / 60)),
      exercises: dayExercises.map((exercise, index) => {
        const log = activeExerciseLogsRef.current[index] ?? activeExerciseLogs[index];
        const weight = log?.noWeight ? undefined : Number(log?.weightKg);
        const bodyWeightAtSetKg = Number(log?.bodyWeightAtSetKg);
        const durationSecondsValue = Number(log?.durationSeconds);
        const distanceMetersValue = Number(log?.distanceMeters);
        // Roadmap P1.1 "bodyweight reps editable prefill" — same gating as
        // the completeScheduleExercise path above: only BODYWEIGHT_REPS has
        // a real editable reps control, so only it can override the fixed
        // program prescription here.
        const repsValue =
          exerciseLoggingMode(exercise) === "BODYWEIGHT_REPS" ? Number(log?.reps) : NaN;
        // exercise.dbId already reflects any session-only swap (see
        // handleSelectSwap) — logging the substitute's real id here is the
        // ACCURATE record of what was actually performed, not a corruption
        // of history. swapNotes carries the "swapped from X" note through.
        const notesParts = [
          log?.noWeight ? "Không dùng tạ" : undefined,
          swapNotes[index],
        ].filter(Boolean);
        return {
          exerciseId: exercise.dbId,
          sets: Number(exercise.sets) || 1,
          reps:
            Number.isFinite(repsValue) && repsValue > 0
              ? repsValue
              : Number(exercise.reps) || undefined,
          duration:
            Number.isFinite(durationSecondsValue) && durationSecondsValue > 0
              ? durationSecondsValue
              : exercise.durationSeconds ?? exercise.duration ?? undefined,
          durationSeconds:
            Number.isFinite(durationSecondsValue) && durationSecondsValue > 0
              ? durationSecondsValue
              : undefined,
          distanceMeters:
            Number.isFinite(distanceMetersValue) && distanceMetersValue > 0
              ? distanceMetersValue
              : undefined,
          weight: Number.isFinite(weight) ? weight : undefined,
          bodyWeightAtSetKg:
            Number.isFinite(bodyWeightAtSetKg) && bodyWeightAtSetKg > 0
              ? bodyWeightAtSetKg
              : undefined,
          rpe: log?.rpe,
          rir: log?.rir,
          notes: notesParts.length > 0 ? notesParts.join(" · ") : undefined,
        };
      }),
    };

    const workoutIdForSave = currentWorkoutId || scheduleWorkoutId;
    const saved = workoutIdForSave
      ? await workoutService.updateWorkout(workoutIdForSave, payload)
      : await workoutService.logWorkout(payload);
    if (scheduleId) setSelectedScheduleId(scheduleId);
    if (saved?.id) setCurrentWorkoutId(saved.id);
    await refetchProgramAndSchedules();
    return saved?.id as string | undefined;
  };

  const handleCompleteExercise = async () => {
    if (isSelectedDayLocked) {
      toast.error(
        lockedDayMessage(selectedSchedule()?.date ?? toApiDateTime(selectedDate)),
      );
      return;
    }
    const currentLog = activeExerciseLogsRef.current[activeExIdx] ?? activeExerciseLogs[activeExIdx];
    const needsWeight = exerciseUsesExternalWeight(dayExercises[activeExIdx]);
    if (needsWeight && !currentLog?.noWeight) {
      const weight = Number(currentLog?.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        toast.error(
          "Vui lòng nhập tổng số kg tạ cho bài này hoặc chọn Không dùng tạ.",
        );
        return;
      }
    }
    const completingLoggingMode = exerciseLoggingMode(dayExercises[activeExIdx]);
    if (completingLoggingMode === "TIME" || completingLoggingMode === "TIME_LOAD") {
      const duration = Number(currentLog?.durationSeconds);
      if (!Number.isFinite(duration) || duration <= 0) {
        toast.error("Vui lòng nhập thời gian thực hiện cho bài này.");
        return;
      }
    }
    if (completingLoggingMode === "DISTANCE_TIME") {
      const distance = Number(currentLog?.distanceMeters);
      const duration = Number(currentLog?.durationSeconds);
      if ((!Number.isFinite(distance) || distance <= 0) && (!Number.isFinite(duration) || duration <= 0)) {
        toast.error("Vui lòng nhập quãng đường hoặc thời gian cho bài cardio này.");
        return;
      }
    }

    const scheduleForCompletion = selectedSchedule();
    const currentExercise = dayExercises[activeExIdx];

    // Roadmap P1.1 "true set-by-set table UI" — a genuinely multi-set
    // exercise (real skeleton loaded, >1 planned set) ALWAYS completes via
    // the per-row PATCH /workouts/sets/:setId, for BOTH an interior set and
    // the set that closes out the exercise. It must never fall through to
    // completeScheduleExercise below: that call's "re-completion" branch
    // unconditionally overwrites EVERY sibling WorkoutSet's weight/reps/etc
    // with the one value it was given, which would silently corrupt the
    // other already-independently-logged sets' distinct values — see
    // docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md. A genuine 1-set
    // exercise (or the skeleton not having loaded yet, or the ad-hoc/
    // freeform no-schedule path) keeps using the existing bulk path exactly
    // as before — there is no sibling set to protect there.
    const setRowsForCurEx = currentExercise?.programExerciseId
      ? workoutSetsByExercise[currentExercise.programExerciseId]
      : undefined;
    const activeSetRowForCompletion = setRowsForCurEx?.find((row) => !row.completed);
    // Computed BEFORE this completion, so it reflects "how many were still
    // incomplete including the one about to be completed" — 1 means this
    // IS the closing set. Passed explicitly rather than inferred from the
    // server response, so there's no ambiguity about which set closed out.
    const remainingSetCountBeforeThis = setRowsForCurEx?.filter((row) => !row.completed).length ?? 0;
    if (
      scheduleForCompletion?.id &&
      setRowsForCurEx &&
      setRowsForCurEx.length > 1 &&
      activeSetRowForCompletion?.id
    ) {
      await handleCompletePerSetRow(
        currentExercise,
        activeSetRowForCompletion,
        currentLog,
        scheduleForCompletion.id,
        remainingSetCountBeforeThis <= 1,
      );
      return;
    }

    const previousCompleted = completedExercises;
    const newCompleted = new Set(completedExercises);

    // `dayExercises` is built from `currentProgram` (the LATEST program), but
    // a schedule that was created before the program got edited/regenerated
    // is still permanently linked to its OWN (possibly now-archived)
    // programDay — its exercises keep their original ids even though
    // `currentProgram`'s same-numbered day now has different ones. If the
    // user started this session before that edit, `currentExercise
    // .programExerciseId` is a stale id the schedule's real programDay never
    // had, and the backend correctly rejects it ("Planned exercise not
    // found in this schedule"). Self-heal by resolving against the
    // schedule's own authoritative programDay.exercises (already returned
    // by GET /workouts/schedules) before ever trusting the stale id.
    const scheduleProgramExercises = (scheduleForCompletion as any)?.programDay?.exercises as
      | Array<{ id: string; exercise?: { id: string } }>
      | undefined;
    let resolvedProgramExerciseId = currentExercise?.programExerciseId;
    if (scheduleProgramExercises && scheduleProgramExercises.length > 0 && resolvedProgramExerciseId) {
      const stillValid = scheduleProgramExercises.some((e) => e.id === resolvedProgramExerciseId);
      if (!stillValid) {
        const byCatalogId = scheduleProgramExercises.find((e) => e.exercise?.id === currentExercise?.dbId);
        const fallback = byCatalogId?.id ?? scheduleProgramExercises[activeExIdx]?.id;
        if (fallback) {
          console.warn(
            "[WorkoutLogPage] programExerciseId stale for this schedule (program was edited after this session started) — self-healed via schedule.programDay",
            { stale: resolvedProgramExerciseId, resolved: fallback },
          );
          resolvedProgramExerciseId = fallback;
        }
      }
    }

    setIsCompletingWorkout(true);
    try {
      if (scheduleForCompletion?.id && resolvedProgramExerciseId) {
        // What was ACTUALLY performed — currentExercise.dbId already
        // reflects any session-only swap (handleSelectSwap), and this is
        // the ONLY call site that persists it; without sending it here the
        // swap only ever existed in this tab's local state. Same shape as
        // persistCompletedWorkout's ad-hoc-workout payload below, kept
        // consistent so both logging paths record the same thing.
        const weight = currentLog?.noWeight ? undefined : Number(currentLog?.weightKg);
        const bodyWeightAtSetKg = Number(currentLog?.bodyWeightAtSetKg);
        const durationSecondsValue = Number(currentLog?.durationSeconds);
        const distanceMetersValue = Number(currentLog?.distanceMeters);
        // Roadmap P1.1 "bodyweight reps editable prefill" — reps is only a
        // real editable control for BODYWEIGHT_REPS today (see the RulerSlider
        // gate above); every other mode omits it, exactly as before this
        // change, so the backend keeps falling back to the fixed program
        // prescription for them (workout.service.ts completeScheduleExercise,
        // unchanged).
        const repsValue =
          exerciseLoggingMode(currentExercise) === "BODYWEIGHT_REPS"
            ? Number(currentLog?.reps)
            : NaN;
        const notesParts = [
          currentLog?.noWeight ? "Không dùng tạ" : undefined,
          swapNotes[activeExIdx],
        ].filter(Boolean);
        const payload = {
          exerciseId: currentExercise.dbId || undefined,
          weight: Number.isFinite(weight) ? weight : undefined,
          reps: Number.isFinite(repsValue) && repsValue > 0 ? repsValue : undefined,
          bodyWeightAtSetKg:
            Number.isFinite(bodyWeightAtSetKg) && bodyWeightAtSetKg > 0
              ? bodyWeightAtSetKg
              : undefined,
          // TIME/TIME_LOAD/DISTANCE_TIME (openGym P0-completion pass) —
          // real, separate fields, never folded into `weight`. See
          // docs/OPENGYM_P0_COMPLETION_REPORT.md's "Bugs found" for the
          // exact bug this replaces (duration silently stored as kg).
          durationSeconds: Number.isFinite(durationSecondsValue) && durationSecondsValue > 0 ? durationSecondsValue : undefined,
          distanceMeters: Number.isFinite(distanceMetersValue) && distanceMetersValue > 0 ? distanceMetersValue : undefined,
          rpe: currentLog?.rpe,
          rir: currentLog?.rir,
          notes: notesParts.length > 0 ? notesParts.join(" · ") : undefined,
        };
        let result: any;
        try {
          result = await workoutService.completeScheduleExercise(
            scheduleForCompletion.id,
            resolvedProgramExerciseId,
            payload,
          );
        } catch (networkError: any) {
          // Roadmap P1.4 "Active-workout offline resilience" — same
          // offline-vs-real-error distinction as handleCompletePerSetRow.
          // Covers the bulk completion path: a 1-set exercise, the
          // exercise-closing set of a multi-set exercise's skeleton not
          // having loaded yet, or the ad-hoc/freeform path all reach here.
          if (networkError?.response) throw networkError;
          const eventId = crypto.randomUUID();
          await enqueueWorkoutEvent({
            eventId,
            type: "EXERCISE_COMPLETED",
            createdAt: Date.now(),
            method: "POST",
            url: `/workouts/schedules/${scheduleForCompletion.id}/exercises/${resolvedProgramExerciseId}/complete`,
            body: { ...payload, eventId },
          });
          setPendingSyncCount((n) => n + 1);
          newCompleted.add(activeExIdx);
          setCompletedExercises(newCompleted);
          if (currentExercise?.dbId) {
            clearPersistedActiveLogDraft(scheduleForCompletion.id, currentExercise.dbId);
          }
          setIsCompletingWorkout(false);
          setTimerRunning(false);
          setTimerSeconds(0);
          if (activeExIdx >= dayExercises.length - 1) {
            // Deliberately NOT the completion screen/confetti/PR summary —
            // see the impact analysis's "Conflict strategy".
            toast.success("Đã lưu buổi tập (offline) — sẽ đồng bộ và hiển thị kết quả khi có mạng.");
          } else {
            setRestSeconds(
              computeNextExerciseRestSeconds(currentExercise as any, dayExercises[activeExIdx + 1] as any),
            );
            setRestTimerRunning(true);
            setActiveExIdx(activeExIdx + 1);
            toast.success(`Đã lưu "${currentExercise?.name}" (offline) — sẽ đồng bộ khi có mạng.`);
          }
          return;
        }
        applyScheduleProgress(scheduleForCompletion.id, result);
        if (result.workoutId) setCurrentWorkoutId(result.workoutId);
        setSelectedScheduleId(scheduleForCompletion.id);
        newCompleted.add(activeExIdx);
        setCompletedExercises(newCompleted);
        // A completed exercise's draft is now a real persisted set — never
        // resurrect it as an editable draft on some future re-visit.
        if (currentExercise?.dbId) {
          clearPersistedActiveLogDraft(scheduleForCompletion.id, currentExercise.dbId);
        }

        if (
          result.progressPercent >= 100 ||
          result.completedExercises >= result.totalExercises
        ) {
          setTimerRunning(false);
          setTimerSeconds(0);
          setShowCompletion(true);
          if (result.workoutId) void loadCompletionSummary(result.workoutId);
          if (result.trainingCycleId) {
            setFeedbackPrompt({ scheduleId: scheduleForCompletion.id });
          }
          setTimeout(() => fireConfetti(), 300);
          toast.success("Da luu hoan thanh buoi tap.");
          void refetchProgramAndSchedules();
          return;
        }
      } else {
        newCompleted.add(activeExIdx);
        setCompletedExercises(newCompleted);
        if (currentExercise?.dbId) {
          clearPersistedActiveLogDraft(selectedSchedule()?.id ?? null, currentExercise.dbId);
        }
        if (newCompleted.size === dayExercises.length) {
          const savedWorkoutId = await persistCompletedWorkout();
          setShowCompletion(true);
          if (savedWorkoutId) void loadCompletionSummary(savedWorkoutId);
          setTimeout(() => fireConfetti(), 300);
          toast.success("Da luu hoan thanh buoi tap.");
          return;
        }
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          "Khong the luu trang thai hoan thanh bai tap.",
      );
      setCompletedExercises(previousCompleted);
      return;
    } finally {
      setIsCompletingWorkout(false);
      setTimerRunning(false);
      setTimerSeconds(0);
    }
    if (activeExIdx < dayExercises.length - 1) {
      const undoExIdx = activeExIdx;
      const undoScheduleId = scheduleForCompletion?.id;
      const undoProgramExerciseId = resolvedProgramExerciseId;
      const undoExerciseName = currentExercise?.name;
      // Roadmap P1.3 "Superset / exercise grouping" — short rest advancing
      // to a fellow group member, real rest once the group's last member
      // is done; unchanged default-90 for an ungrouped exercise.
      setRestSeconds(
        computeNextExerciseRestSeconds(currentExercise as any, dayExercises[activeExIdx + 1] as any),
      );
      setRestTimerRunning(true);
      setActiveExIdx(activeExIdx + 1);
      // Roadmap P1.6 "undo last set" — only offered right after completing a
      // NON-final exercise (see docs/features/UNDO_LAST_SET_IMPACT_ANALYSIS.md
      // for why the final exercise, which triggers the whole-workout
      // completion screen/PR summary/cycle-feedback prompt, is deliberately
      // out of scope). Undoing restores the exact values just submitted —
      // never a blank input — so correcting a mistake is "undo, fix, submit
      // again", not "undo, re-enter everything".
      if (undoScheduleId && undoProgramExerciseId) {
        toast(`Đã hoàn thành "${undoExerciseName}"`, {
          action: {
            label: "Hoàn tác",
            onClick: () => {
              void handleUndoExerciseCompletion(
                undoExIdx,
                undoScheduleId,
                undoProgramExerciseId,
                currentLog,
              );
            },
          },
          duration: 8_000,
        });
      }
    }
  };

  // Roadmap P1.1 "true set-by-set table UI" — completes ONE interior set
  // (interior OR the set that closes out the exercise — see
  // handleCompleteExercise's own comment for why the closing set must ALSO
  // go through this per-row path rather than completeScheduleExercise for
  // a genuinely multi-set exercise). Uses updateSet's now-included
  // `progress` field (see workout.service.ts's updateSet, same
  // WorkoutProgressSummary shape completeScheduleExercise already
  // returns) to learn whether that was the exercise's last remaining set,
  // and if so runs the EXACT same advance/whole-workout-completion tail
  // handleCompleteExercise's own bulk path already used — just reached via
  // a safe per-row write instead of one that would have overwritten every
  // sibling set's distinct values.
  const handleCompletePerSetRow = async (
    currentExercise: any,
    setRow: WorkoutSetRow,
    currentLog: ActiveExerciseLog | undefined,
    scheduleId: string,
    isClosingSet: boolean,
  ) => {
    const programExerciseId = currentExercise.programExerciseId as string;
    const exIdx = activeExIdx;
    setIsCompletingWorkout(true);
    try {
      const weight = currentLog?.noWeight ? undefined : Number(currentLog?.weightKg);
      const bodyWeightAtSetKg = Number(currentLog?.bodyWeightAtSetKg);
      const durationSecondsValue = Number(currentLog?.durationSeconds);
      const distanceMetersValue = Number(currentLog?.distanceMeters);
      const repsValue =
        exerciseLoggingMode(currentExercise) === "BODYWEIGHT_REPS"
          ? Number(currentLog?.reps)
          : NaN;
      const patch = {
        weight: Number.isFinite(weight) ? weight : undefined,
        reps: Number.isFinite(repsValue) && repsValue > 0 ? repsValue : undefined,
        bodyWeightAtSetKg:
          Number.isFinite(bodyWeightAtSetKg) && bodyWeightAtSetKg > 0
            ? bodyWeightAtSetKg
            : undefined,
        durationSeconds:
          Number.isFinite(durationSecondsValue) && durationSecondsValue > 0
            ? durationSecondsValue
            : undefined,
        distanceMeters:
          Number.isFinite(distanceMetersValue) && distanceMetersValue > 0
            ? distanceMetersValue
            : undefined,
        rpe: currentLog?.rpe,
        rir: currentLog?.rir,
        completed: true,
      };

      let updated: any;
      try {
        updated = await workoutService.updateSet(setRow.id, patch);
      } catch (networkError: any) {
        // Roadmap P1.4 "Active-workout offline resilience" — `!response`
        // means the request never reached the server at all (offline, DNS
        // failure, timeout) as opposed to the server actively rejecting
        // it (a real validation/lock/conflict error, which must still
        // surface normally, never silently queued). Queue it durably,
        // apply the SAME optimistic local state a successful call would
        // have produced, and stop here — the drain effect confirms the
        // real outcome (including any whole-workout celebration) once
        // reconnected, never guessed from here.
        if (networkError?.response) throw networkError;
        const eventId = crypto.randomUUID();
        await enqueueWorkoutEvent(
          buildQueuedSetEvent({ eventId, setId: setRow.id, type: "SET_COMPLETED", patch }),
        );
        setPendingSyncCount((n) => n + 1);

        setWorkoutSetsByExercise((prev) => {
          const rows = prev[programExerciseId] ?? [];
          return {
            ...prev,
            [programExerciseId]: rows.map((row) =>
              row.id === setRow.id ? { ...row, completed: true, ...patch } : row,
            ),
          };
        });
        if (currentExercise?.dbId) clearPersistedActiveLogDraft(scheduleId, currentExercise.dbId);

        if (isClosingSet) {
          setCompletedExercises((prev) => new Set(prev).add(exIdx));
          if (exIdx < dayExercises.length - 1) {
            setTimerRunning(false);
            setTimerSeconds(0);
            setRestSeconds(
              computeNextExerciseRestSeconds(currentExercise as any, dayExercises[exIdx + 1] as any),
            );
            setRestTimerRunning(true);
            setActiveExIdx(exIdx + 1);
            toast.success(`Đã lưu "${currentExercise?.name}" (offline) — sẽ đồng bộ khi có mạng.`);
          } else {
            // Deliberately NOT the completion screen/confetti/PR summary —
            // those require the server's own numbers, never shown from an
            // offline guess (see impact analysis's "Conflict strategy").
            toast.success("Đã lưu buổi tập (offline) — sẽ đồng bộ và hiển thị kết quả khi có mạng.");
          }
        } else {
          const nextLogs = { ...activeExerciseLogsRef.current };
          delete nextLogs[exIdx];
          activeExerciseLogsRef.current = nextLogs;
          setActiveExerciseLogs(nextLogs);
          setRestSeconds(90);
          setRestTimerRunning(true);
          toast.success(`Đã lưu set ${setRow.setNumber} (offline) — sẽ đồng bộ khi có mạng.`);
        }
        return;
      }

      setWorkoutSetsByExercise((prev) => {
        const rows = prev[programExerciseId] ?? [];
        return {
          ...prev,
          [programExerciseId]: rows.map((row) =>
            row.id === setRow.id
              ? {
                  ...row,
                  completed: true,
                  weight: updated?.weight ?? row.weight,
                  reps: updated?.reps ?? row.reps,
                  rpe: updated?.rpe ?? row.rpe,
                  rir: updated?.rir ?? row.rir,
                  bodyWeightAtSetKg: updated?.bodyWeightAtSetKg ?? row.bodyWeightAtSetKg,
                  durationSeconds: updated?.durationSeconds ?? row.durationSeconds,
                  distanceMeters: updated?.distanceMeters ?? row.distanceMeters,
                }
              : row,
          ),
        };
      });

      if (currentExercise?.dbId) {
        clearPersistedActiveLogDraft(scheduleId, currentExercise.dbId);
      }

      const result = updated?.progress;

      if (isClosingSet && result) {
        applyScheduleProgress(scheduleId, result);
        if (result.workoutId) setCurrentWorkoutId(result.workoutId);
        setSelectedScheduleId(scheduleId);
        setCompletedExercises((prev) => new Set(prev).add(exIdx));

        if (result.progressPercent >= 100 || result.completedExercises >= result.totalExercises) {
          setTimerRunning(false);
          setTimerSeconds(0);
          setShowCompletion(true);
          if (result.workoutId) void loadCompletionSummary(result.workoutId);
          if (result.trainingCycleId) {
            setFeedbackPrompt({ scheduleId });
          }
          setTimeout(() => fireConfetti(), 300);
          toast.success("Da luu hoan thanh buoi tap.");
          void refetchProgramAndSchedules();
          return;
        }

        // Exercise closed, more exercises remain — same advance/undo-toast
        // tail as handleCompleteExercise's bulk path (roadmap P1.6),
        // including resetting the elapsed-time ring for the new exercise
        // (deliberately NOT reset for an interior same-exercise set below —
        // it should keep running across a multi-set exercise's own sets).
        if (exIdx < dayExercises.length - 1) {
          setTimerRunning(false);
          setTimerSeconds(0);
          // Roadmap P1.3 "Superset / exercise grouping" — same group-aware
          // rest as handleCompleteExercise's bulk path above.
          setRestSeconds(
            computeNextExerciseRestSeconds(currentExercise as any, dayExercises[exIdx + 1] as any),
          );
          setRestTimerRunning(true);
          setActiveExIdx(exIdx + 1);
          toast(`Đã hoàn thành "${currentExercise?.name}"`, {
            action: {
              label: "Hoàn tác",
              onClick: () => {
                void handleUndoSetRow(exIdx, programExerciseId, setRow.id, currentLog, true);
              },
            },
            duration: 8_000,
          });
        }
        return;
      }

      // Interior set — stay on this exercise, advance to the next row.
      // Force a fresh prefill for it — otherwise the smart-prefill effect's
      // own "already have a draft, do nothing" guard would leave the
      // just-submitted (now stale) values sitting there.
      const nextLogs = { ...activeExerciseLogsRef.current };
      delete nextLogs[exIdx];
      activeExerciseLogsRef.current = nextLogs;
      setActiveExerciseLogs(nextLogs);

      setRestSeconds(90);
      setRestTimerRunning(true);

      toast(`Đã hoàn thành set ${setRow.setNumber}`, {
        action: {
          label: "Hoàn tác",
          onClick: () => {
            void handleUndoSetRow(exIdx, programExerciseId, setRow.id, currentLog, false);
          },
        },
        duration: 8_000,
      });
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error || "Không thể lưu trạng thái hoàn thành set.",
      );
    } finally {
      setIsCompletingWorkout(false);
    }
  };

  // Roadmap P1.1 "true set-by-set table UI" — reverts ONE set via the same
  // safe PATCH /workouts/sets/:setId, regardless of whether it was an
  // interior set or the one that closed out the exercise. `wasClosingSet`
  // gates the extra exercise-level state reversal (completedExercises,
  // activeExIdx, and — for the rare case this was also the day's very last
  // set — the whole-workout completion screen); every one of those setters
  // is a safe no-op for an interior-set undo (it never changed them in the
  // first place), so this stays correct without branching on it internally.
  const handleUndoSetRow = async (
    exIdx: number,
    programExerciseId: string,
    setId: string,
    submittedLog: ActiveExerciseLog | undefined,
    wasClosingSet: boolean,
  ) => {
    try {
      let queuedOffline = false;
      try {
        await workoutService.updateSet(setId, { completed: false });
      } catch (networkError: any) {
        // Roadmap P1.4 — same offline-vs-real-error distinction as
        // handleCompletePerSetRow above.
        if (networkError?.response) throw networkError;
        const eventId = crypto.randomUUID();
        await enqueueWorkoutEvent(
          buildQueuedSetEvent({ eventId, setId, type: "SET_UNDONE", patch: { completed: false } }),
        );
        setPendingSyncCount((n) => n + 1);
        queuedOffline = true;
      }
      setWorkoutSetsByExercise((prev) => {
        const rows = prev[programExerciseId] ?? [];
        return {
          ...prev,
          [programExerciseId]: rows.map((row) =>
            row.id === setId ? { ...row, completed: false } : row,
          ),
        };
      });
      if (wasClosingSet) {
        setCompletedExercises((prev) => {
          const next = new Set(prev);
          next.delete(exIdx);
          return next;
        });
        setShowCompletion(false);
        setCompletionSummary(null);
        setFeedbackPrompt(null);
      }
      setActiveExIdx(exIdx);
      setRestTimerRunning(false);
      clearPersistedRestTimer(selectedSchedule()?.id ?? null);
      if (submittedLog) {
        const nextLogs = { ...activeExerciseLogsRef.current, [exIdx]: submittedLog };
        activeExerciseLogsRef.current = nextLogs;
        setActiveExerciseLogs(nextLogs);
      }
      toast.success(
        queuedOffline
          ? "Đã hoàn tác (offline) — sẽ đồng bộ khi có mạng."
          : "Đã hoàn tác set vừa hoàn thành.",
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error || "Không thể hoàn tác. Bạn có thể sửa và hoàn thành lại set.",
      );
    }
  };

  // Reverts one exercise's completion — see the toast action above for the
  // only place this is wired up. Restores the just-submitted draft values
  // (never blank) and cancels the rest timer that completion started.
  const handleUndoExerciseCompletion = async (
    exIdx: number,
    scheduleId: string,
    programExerciseId: string,
    submittedLog: ActiveExerciseLog | undefined,
  ) => {
    try {
      const result = await workoutService.undoCompleteScheduleExercise(
        scheduleId,
        programExerciseId,
      );
      applyScheduleProgress(scheduleId, result);
      setCompletedExercises((prev) => {
        const next = new Set(prev);
        next.delete(exIdx);
        return next;
      });
      setActiveExIdx(exIdx);
      setRestTimerRunning(false);
      clearPersistedRestTimer(scheduleId);
      if (submittedLog) {
        const nextLogs = {
          ...activeExerciseLogsRef.current,
          [exIdx]: submittedLog,
        };
        activeExerciseLogsRef.current = nextLogs;
        setActiveExerciseLogs(nextLogs);
      }
      toast.success("Đã hoàn tác bài tập vừa hoàn thành.");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error || "Không thể hoàn tác. Bạn có thể sửa và hoàn thành lại bài tập.",
      );
    }
  };

  const handleSkipExercise = () => {
    if (activeExIdx >= dayExercises.length - 1) return;
    setTimerRunning(false);
    setTimerSeconds(0);
    setRestSeconds(90);
    setRestTimerRunning(true);
    setActiveExIdx((index) => Math.min(index + 1, dayExercises.length - 1));
  };

  // Reset workout when leaving active view
  useEffect(() => {
    if (planView !== "activeExercise") {
      setActiveExIdx(0);
      setCompletedExercises(new Set());
      setTimerRunning(false);
      setTimerSeconds(0);
      setRestTimerRunning(false);
      clearPersistedRestTimer(selectedSchedule()?.id ?? null);
      restTimerRestoredForRef.current = null;
      setShowCompletion(false);
      setCompletionSummary(null);
      setActiveExerciseLogs({});
      setIsCompletingWorkout(false);
      // Same "deliberate exit, not a transient blip" semantics as the rest
      // timer just above — a user who intentionally backs out of the active
      // view should not have their old drafts silently reappear on some
      // later, unrelated visit to this same day.
      const scheduleIdForCleanup = selectedSchedule()?.id ?? null;
      dayExercises.forEach((ex) => {
        if (ex?.dbId) clearPersistedActiveLogDraft(scheduleIdForCleanup, ex.dbId);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planView]);

  const bodyMetricHistoryAsc = useMemo(() => {
    return [...inbodyHistory]
      .sort((a: any, b: any) => {
        const cmp = inBodyDateKey(a).localeCompare(inBodyDateKey(b));
        if (cmp !== 0) return cmp;
        return (
          Date.parse(String(a?.createdAt ?? 0)) -
          Date.parse(String(b?.createdAt ?? 0))
        );
      })
      .slice(-8);
  }, [inbodyHistory]);

  const metricOptions = useMemo<BodyMetricOption[]>(() => {
    const latestMetricEntry =
      bodyMetricHistoryAsc[bodyMetricHistoryAsc.length - 1] ?? latestInBody;

    return METRIC_BASE_OPTIONS.map((base) => {
      const data = bodyMetricHistoryAsc
        .map((entry, index) => {
          const value = bodyMetricValue(entry, base.key);
          if (value === null) return null;
          const rounded = Math.round(value * 10) / 10;
          const measuredAt = parseInBodyMeasurementDate(entry);
          const week = Number.isNaN(measuredAt.getTime())
            ? `L${index + 1}`
            : measuredAt.toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
              });
          const fullDate = Number.isNaN(measuredAt.getTime())
            ? "Không rõ ngày đo"
            : measuredAt.toLocaleDateString("vi-VN");
          return base.dataKey === "kg"
            ? { week, fullDate, kg: rounded }
            : { week, fullDate, pct: rounded };
        })
        .filter((point): point is BodyMetricPoint => Boolean(point));
      const currentValue = bodyMetricValue(latestMetricEntry, base.key);
      const targetValue = metricTarget(userProfile, base.key);

      return {
        ...base,
        current: formatMetricValue(currentValue, base.unit),
        target:
          targetValue === null
            ? undefined
            : formatMetricValue(targetValue, base.unit),
        data,
        domain: metricDomain(data, base.dataKey),
        hasData: data.length > 0,
      };
    });
  }, [bodyMetricHistoryAsc, latestInBody, userProfile]);

  const selectedLogMetric =
    metricOptions.find((m) => m.key === logMetric) ?? metricOptions[0];

  const handleSaveMetricLog = async () => {
    if (!selectedLogMetric) return;
    if (!selectedLogMetric.canPersist) {
      toast.warning(
        "Chỉ số nước cơ thể chưa có cột lưu trong InBody. Hãy nhập qua phiếu InBody khi backend hỗ trợ.",
      );
      return;
    }

    const value = Number(logValue);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Vui lòng nhập giá trị hợp lệ.");
      return;
    }

    const source = latestInBody ?? inbodyHistory[0] ?? {};
    let weight = bodyMetricValue(source, "weight");
    let muscleMass = bodyMetricValue(source, "muscle");
    let bodyFatPct = bodyMetricValue(source, "bodyfat");
    let bodyFat = bodyFatKgFromEntry(source);

    if (logMetric === "weight") {
      weight = value;
      if (bodyFatPct !== null) bodyFat = Math.round(weight * bodyFatPct) / 100;
      else if (bodyFat !== null && weight > 0)
        bodyFatPct = Math.round((bodyFat / weight) * 1000) / 10;
    } else if (logMetric === "bodyfat") {
      bodyFatPct = value;
      bodyFat = weight !== null ? Math.round(weight * value) / 100 : null;
    } else if (logMetric === "muscle") {
      muscleMass = value;
    }

    if (weight === null || muscleMass === null || bodyFat === null) {
      toast.error(
        "Cần có đủ cân nặng, cơ bắp và mỡ cơ thể để ghi InBody. Hãy nhập InBody đầy đủ trước.",
      );
      return;
    }

    const height = metricNumber(
      source.height,
      source.heightCm,
      userProfile?.heightCm,
      userProfile?.height,
    );
    const bmi =
      height && height > 0
        ? Math.round((weight / (height / 100) ** 2) * 10) / 10
        : undefined;

    setIsSavingMetric(true);
    try {
      await inbodyService.create({
        date: new Date().toISOString(),
        weight: Math.round(weight * 10) / 10,
        height: height ?? undefined,
        bmi,
        muscleMass: Math.round(muscleMass * 10) / 10,
        bodyFat: Math.round(bodyFat * 10) / 10,
        bodyFatPct:
          bodyFatPct === null ? undefined : Math.round(bodyFatPct * 10) / 10,
        status: "manual",
      });
      // Invalidate the SHARED cache key (not just this page's own state) so
      // every screen reading ["inbody-history"] — including this one —
      // picks up the new entry without a manual reload.
      await queryClient.invalidateQueries({ queryKey: ["inbody-history"] });
      const next = new Set(activeCharts);
      next.add(logMetric);
      setActiveCharts(next);
      setShowLogModal(false);
      setLogValue("");
      toast.success("Đã lưu chỉ số cơ thể.");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error || "Không thể lưu chỉ số cơ thể.",
      );
    } finally {
      setIsSavingMetric(false);
    }
  };

  const profileGoal = userProfile?.goal;
  const programGoal = currentProgram?.goal;
  const hasGoalMismatch = Boolean(
    profileGoal && programGoal && profileGoal !== programGoal,
  );

  return (
    <div className="p-5 md:p-8 space-y-7 max-w-[1400px] mx-auto">
      {/* ─── Page Header ─── */}
      <div className="relative">
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-emerald-500/[0.04] rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -top-16 right-32 w-56 h-56 bg-green-500/[0.03] rounded-full blur-[60px] pointer-events-none" />

        <div className="relative flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3.5 mb-1.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-green-600/10 border border-emerald-500/15 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                <Dumbbell className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-2xl text-white tracking-tight">
                  Workout Log
                </h1>
                <p className="text-zinc-500 text-sm">
                  Lên kế hoạch và theo dõi quá trình tập luyện
                </p>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            {[
              {
                label: "Kế hoạch",
                value: currentProgram?.name || "Chưa có",
                icon: Zap,
              },
              {
                label: "Tuần này",
                value: `${workoutStats?.weeklyWorkouts || 0} / ${currentProgram?.daysPerWeek || 0} buổi`,
                icon: Calendar,
              },
              {
                label: "Chuỗi ngày tập",
                value: `${workoutStats?.currentStreakDays ?? 0} ngày`,
                icon: TrendingUp,
              },
            ].map((s) => (
              <div
                key={s.label}
                className="px-4 py-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800/50 min-w-[130px]"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <s.icon className="w-3 h-3 text-emerald-500/60" />
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                    {s.label}
                  </span>
                </div>
                <p className="text-sm text-zinc-300">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════ WORKOUT LOG — MAIN ═══════════════ */}
      {hasGoalMismatch && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-200">
                Lịch tập chưa đồng bộ với mục tiêu mới
              </p>
              <p className="text-xs text-amber-100/70 mt-1">
                Mục tiêu hồ sơ của bạn đã đổi sang {goalLabel(profileGoal)},
                nhưng lịch tập hiện tại vẫn là {goalLabel(programGoal)}.
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() =>
                navigate(
                  `/client/plans?goal=${encodeURIComponent(profileGoal || "")}`,
                )
              }
              className="px-3 py-2 rounded-xl bg-amber-400 text-black text-xs font-semibold hover:bg-amber-300 transition-colors"
            >
              Cập nhật lịch theo mục tiêu mới
            </button>
            <button className="px-3 py-2 rounded-xl border border-amber-500/25 text-amber-200 text-xs hover:bg-amber-500/10 transition-colors">
              Giữ lịch hiện tại
            </button>
          </div>
        </div>
      )}

      {planView === "main" && (
        <div className="space-y-7">
          {/* Reminder - Only show if > 7 days or no data */}
          {(daysSinceInBody === null || daysSinceInBody > 7) && (
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/12 bg-gradient-to-r from-emerald-950/30 via-emerald-950/15 to-transparent p-5">
              <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/[0.04] rounded-full blur-[60px]" />
              <div className="relative flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-emerald-100/90">
                    Đã đến lúc cập nhật chỉ số cơ thể
                  </p>
                  <p className="text-xs text-emerald-500/40 mt-0.5">
                    {daysSinceInBody !== null
                      ? `Cập nhật ${daysSinceInBody} ngày trước · Nên quét InBody`
                      : "Chưa có dữ liệu InBody · Bắt đầu bằng cách tải ảnh lên"}
                  </p>
                </div>
                <button
                  onClick={() => setShowLogModal(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/15 text-xs text-emerald-300 hover:bg-emerald-500/15 transition-all shrink-0"
                >
                  Cập nhật ngay
                </button>
              </div>
            </div>
          )}

          {/* Cinematic Hero */}
          <div className="group relative rounded-2xl overflow-hidden border border-zinc-700/20 h-60">
            <img
              src={heroImg}
              alt="Training"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/15" />
            <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/15 via-transparent to-transparent" />

            <button className="absolute top-4 left-4 w-10 h-10 rounded-xl bg-black/25 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/40 transition-all">
              <Share2 className="w-4 h-4 text-white/50" />
            </button>

            <div className="absolute top-4 right-4 flex gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/15 text-[11px] text-amber-300 backdrop-blur-md">
                <Star className="w-3 h-3" /> 4.8
              </span>
              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/15 text-[11px] text-emerald-300 backdrop-blur-md">
                At Gym
              </span>
              <span className="px-3 py-1.5 rounded-xl bg-zinc-500/10 border border-zinc-500/15 text-[11px] text-zinc-300 backdrop-blur-md">
                Intermediate
              </span>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6">
              <span className="text-[10px] text-emerald-400/50 uppercase tracking-[0.2em] mb-1.5 block">
                Chương trình
              </span>
              <h2 className="text-2xl text-white mb-2 tracking-tight">
                {currentProgram ? currentProgram.name : "Chưa có chương trình"}
              </h2>
              {currentProgram && (
                <button
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Ẩn chương trình hiện tại? Workout đã hoàn thành sẽ không bị xóa.",
                      )
                    )
                      return;
                    await workoutService.archiveProgram(currentProgram.id);
                    await refetchProgramAndSchedules();
                  }}
                  className="mb-2 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/10 text-[11px] text-red-300 hover:bg-red-500/15"
                >
                  Ẩn chương trình
                </button>
              )}
              {currentProgram && (
                <div className="flex items-center gap-4 text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Dumbbell className="w-3 h-3 text-emerald-500/50" />{" "}
                    {currentProgram.durationWeeks || 4} tuần
                  </span>
                  <span className="text-zinc-700">·</span>
                  <span>
                    {currentProgram.daysPerWeek ||
                      workoutStats?.workoutsPerWeek ||
                      3}{" "}
                    buổi/tuần
                  </span>
                  <span className="text-zinc-700">·</span>
                  {currentProgram.sourceType === "AI_PLAN" && (
                    <>
                      <span className="px-2 py-0.5 rounded-full border border-sky-500/25 bg-sky-500/10 text-sky-300">
                        AI
                      </span>
                      <span className="text-zinc-700">·</span>
                    </>
                  )}
                  {currentProgram.goal && (
                    <>
                      <span>{goalLabel(currentProgram.goal)}</span>
                      <span className="text-zinc-700">·</span>
                    </>
                  )}
                  <span>
                    Đã hoàn thành:{" "}
                    <span className="text-emerald-400">
                      {workoutStats?.totalWorkouts || 0}
                    </span>
                  </span>
                </div>
              )}
              <div className="mt-3 h-1.5 bg-white/[0.05] rounded-full overflow-hidden max-w-md">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.35)] transition-all duration-1000"
                  style={{
                    width: `${Math.min(100, ((workoutStats?.totalWorkouts || 0) / 36) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Training Days + Upcoming Sessions — the actionable core: what's the
              program's structure (left) and which real calendar dates it's
              actually scheduled onto (right). */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* Training Days */}
            <div className="xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title="Ngày tập" />
                <button
                  onClick={openManualBuilder}
                  className="px-3 py-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/15"
                >
                  Tạo thủ công
                </button>
              </div>
              <div className="space-y-3">
                {currentProgram?.days?.length ? (
                  currentProgram.days.map((w: any) => {
                    const schedules = [
                      ...aiSchedules.filter(
                        (schedule) => schedule.programDay?.id === w.id,
                      ),
                      ...(Array.isArray(w.schedules) ? w.schedules : []),
                    ];
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const nextSchedule =
                      schedules.find(
                        (schedule: any) =>
                          !schedule.workoutId &&
                          new Date(schedule.date) >= todayStart,
                      ) ||
                      schedules.find((schedule: any) => !schedule.workoutId) ||
                      schedules[0] ||
                      aiSchedules.find(
                        (schedule) => schedule.programDay?.id === w.id,
                      );
                    const dayProgress = scheduleProgressPercent(nextSchedule);
                    return (
                      <button
                        key={`td-${w.day || w.dayNumber}`}
                        data-testid={`training-day-card-${w.day || w.dayNumber}`}
                        onClick={() => {
                          if (!w.locked) {
                            setSelectedDay(w.day || w.dayNumber);
                            setSelectedDate(
                              nextSchedule?.date
                                ? new Date(nextSchedule.date)
                                : new Date(),
                            );
                            setSelectedScheduleId(nextSchedule?.id || null);
                            setCurrentWorkoutId(
                              nextSchedule?.workoutId ||
                                nextSchedule?.workout?.id ||
                                null,
                            );
                            setPlanView("dayDetail");
                          }
                        }}
                        disabled={w.locked}
                        className={`group/card w-full rounded-2xl border p-5 transition-all text-left relative overflow-hidden ${
                          w.locked
                            ? "bg-zinc-900/20 border-zinc-800/25 opacity-40 cursor-not-allowed"
                            : "bg-zinc-900/50 border-zinc-800/30 hover:border-emerald-500/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.04)] active:scale-[0.99]"
                        }`}
                      >
                        {!w.locked && (
                          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 to-emerald-500/0 group-hover/card:from-emerald-500/[0.02] group-hover/card:to-transparent transition-all duration-300" />
                        )}

                        <div className="relative flex items-center gap-4">
                          {/* Ring */}
                          <div className="relative shrink-0">
                            <svg width="52" height="52" viewBox="0 0 52 52">
                              <circle
                                cx="26"
                                cy="26"
                                r="22"
                                fill="none"
                                stroke={w.locked ? "#18181b" : "#064e3b"}
                                strokeWidth="3"
                              />
                              {!w.locked && dayProgress > 0 && (
                                <circle
                                  cx="26"
                                  cy="26"
                                  r="22"
                                  fill="none"
                                  stroke="#10b981"
                                  strokeWidth="3"
                                  strokeDasharray={`${(dayProgress / 100) * 138} 138`}
                                  strokeLinecap="round"
                                  transform="rotate(-90 26 26)"
                                />
                              )}
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              {w.locked ? (
                                <Lock className="w-4 h-4 text-zinc-700" />
                              ) : (
                                <span className="text-[11px] text-emerald-400">
                                  {dayProgress}%
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-zinc-100">
                              Ngày {w.day || w.dayNumber}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5 truncate">
                              {w.title}
                            </p>
                            {!w.locked && (
                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />{" "}
                                  {w.duration || "1h"}
                                </span>
                                <span className="text-[10px] text-zinc-600">
                                  {w.exercises?.length || w.exercises || 0} bài
                                  tập
                                </span>
                              </div>
                            )}
                          </div>

                          {!w.locked && (
                            <ChevronRight className="w-4 h-4 text-zinc-700 group-hover/card:text-emerald-400 transition-colors shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-6 text-center">
                    <p className="text-sm text-zinc-400">
                      Bạn chưa có lịch tập hiện tại
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button
                        onClick={openManualBuilder}
                        className="px-3 py-2 rounded-lg border border-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-800"
                      >
                        Tạo thủ công
                      </button>
                      <button
                        onClick={() => navigate("/client/plans")}
                        className="px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400"
                      >
                        Tạo bằng AI
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Sessions */}
            <div className="xl:col-span-3">
              <GlassPanel
                title="Buổi tập sắp tới"
                icon={<Dumbbell className="w-4 h-4 text-emerald-400" />}
              >
                <div className="space-y-2.5">
                  {upcomingSchedules.length > 0 ? (
                    upcomingSchedules.slice(0, 5).map((schedule) => {
                      const programDay = schedule.programDay;
                      const programName = programDay?.program?.name || "AI Plan";
                      const dayTitle =
                        programDay?.title || `Day ${programDay?.dayNumber || 1}`;
                      const exerciseCount = programDay?.exercises?.length || 0;
                      return (
                        <div
                          key={schedule.id}
                          className="group/item rounded-xl border p-3.5 transition-all bg-zinc-800/20 border-zinc-700/25 hover:border-emerald-500/20 hover:bg-zinc-800/40"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500/8 border border-emerald-500/15">
                              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-zinc-200 truncate">
                                {dayTitle}
                              </p>
                              <p className="text-[11px] text-zinc-500 truncate">
                                {new Date(schedule.date).toLocaleDateString(
                                  "vi-VN",
                                )}{" "}
                                · {exerciseCount} bài · {programName}
                              </p>
                            </div>
                            <span className="text-[10px] px-2 py-1 rounded-full border border-emerald-500/20 text-emerald-300">
                              AI
                            </span>
                            <button
                              onClick={() => {
                                setSelectedDay(programDay?.dayNumber || 1);
                                setSelectedDate(new Date(schedule.date));
                                setSelectedScheduleId(schedule.id);
                                setCurrentWorkoutId(
                                  schedule.workoutId ||
                                    schedule.workout?.id ||
                                    null,
                                );
                                setPlanView("dayDetail");
                              }}
                              className="text-[10px] px-2 py-1 rounded-full border border-zinc-700/50 text-zinc-300 hover:bg-zinc-800"
                            >
                              Sửa
                            </button>
                            <button
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    "Xóa lịch tập này khỏi lịch? Workout đã hoàn thành sẽ không bị xóa.",
                                  )
                                )
                                  return;
                                await workoutService.deleteSchedule(schedule.id);
                                await refetchProgramAndSchedules();
                              }}
                              className="text-[10px] px-2 py-1 rounded-full border border-red-500/25 text-red-300 hover:bg-red-500/10"
                            >
                              Ẩn
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-700/30 bg-zinc-900/25 p-4 text-center">
                      <p className="text-sm text-zinc-400">
                        Bạn chưa có lịch tập sắp tới
                      </p>
                      <button
                        onClick={() => navigate("/client/plans")}
                        className="mt-3 px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors"
                      >
                        Tạo bằng AI
                      </button>
                    </div>
                  )}
                </div>
              </GlassPanel>
            </div>
          </div>

          {/* Calendar + Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/[0.02] rounded-full blur-[60px] pointer-events-none" />
              <div className="relative">
                <div className="flex items-center justify-between mb-5">
                  <SectionTitle title="Lịch tập" />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCalendarAdd(true)}
                      className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20"
                    >
                      <Plus className="w-3 h-3" /> Thêm
                    </button>
                    <button
                      onClick={() => setCalendarExpanded(!calendarExpanded)}
                      className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                      {calendarExpanded ? "Thu gọn" : "Mở rộng"}
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-300 ${!calendarExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                </div>
                {calendarExpanded && (
                  <CalendarGrid
                    schedulesByDay={schedulesByDay}
                    markers={calendarMarkers}
                    month={calendarMonth}
                    onPrevMonth={handlePrevMonth}
                    onNextMonth={handleNextMonth}
                    onDayClick={(day) => {
                      const clickedDate = new Date(
                        calendarMonth.getFullYear(),
                        calendarMonth.getMonth(),
                        day,
                      );
                      const dStr = clickedDate.toDateString();
                      setSelectedDate(clickedDate);
                      const scheduleForDay = findScheduleForDate(clickedDate);
                      setSelectedDay(scheduleForDay?.programDay?.dayNumber || day);
                      setSelectedScheduleId(scheduleForDay?.id || null);
                      setCurrentWorkoutId(
                        scheduleForDay?.workoutId ||
                          scheduleForDay?.workout?.id ||
                          null,
                      );

                      // Prefer the persisted schedule. Workout history can contain legacy
                      // date-shifted rows, so it is only a fallback for unscheduled days.
                      if (scheduleForDay?.programDay?.dayNumber) {
                        setSelectedDay(scheduleForDay.programDay.dayNumber);
                        setPlanView("dayDetail");
                      } else if (workoutCache[dStr]) {
                        const w = workoutCache[dStr];
                        setCurrentWorkoutId(w.id);
                        const mapped = w.exercises.map((we: any) => ({
                          id: we.id,
                          dbId: we.exerciseId,
                          name: we.exercise.exerciseName,
                          prescription: `${we.sets}×${we.reps || 10}${we.weight ? "×" + we.weight + " kg" : ""}`,
                          img: formatVideoUrlToImg(we.exercise.videoUrl, 0),
                          img2: formatVideoUrlToImg(we.exercise.videoUrl, 1),
                          type: (we.exercise.typeOfActivity === "CARDIO"
                            ? "cardio"
                            : "strength") as "cardio" | "strength",
                          description: we.exercise.instructions,
                          muscles: we.exercise.muscleGroupsActivated || [],
                          tips: [],
                        }));
                        setDayExercises(mapped);
                        setPlanView("dayDetail");
                      } else if (isScheduleDateApiValuePast(toApiDateTime(clickedDate))) {
                        // Only PAST is blocked here, not future: creating a
                        // brand-new schedule for a future day is exactly
                        // what planning ahead means, and the backend
                        // (createSchedule) never locks it — unlike editing/
                        // completing an EXISTING logged workout, which is
                        // locked to today only.
                        toast.error("Ngày này đã qua nên không thể tạo lịch tập mới.");
                      } else {
                        openScheduleModal(clickedDate);
                      }
                    }}
                  />
                )}
              </div>
            </div>

            <GlassPanel
              title="Chỉ số cơ thể"
              icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
              actionLabel="+ Log"
              onAction={() => setShowLogModal(true)}
            >
              {/* Weight journey — starting/current/target/remaining. Spec
                  §27: startingWeight is the IMMUTABLE journey-start
                  snapshot, never overwritten by later InBody syncs. */}
              {(() => {
                const startingWeight = userProfile?.startingWeight;
                const currentWeight = latestInBody?.weight ?? userProfile?.currentWeight;
                const targetWeight = userProfile?.targetWeight;
                if (startingWeight == null || currentWeight == null) return null;
                const changed = Math.round((startingWeight - currentWeight) * 10) / 10;
                const remaining =
                  targetWeight != null
                    ? Math.round((currentWeight - targetWeight) * 10) / 10
                    : null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 pb-4 border-b border-zinc-800/40">
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">
                        Bắt đầu
                      </p>
                      <p className="text-sm text-zinc-200">{startingWeight} kg</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">
                        Hiện tại
                      </p>
                      <p className="text-sm text-zinc-200">{currentWeight} kg</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">
                        Đã thay đổi
                      </p>
                      <p
                        className={`text-sm ${changed > 0 ? "text-emerald-400" : changed < 0 ? "text-amber-400" : "text-zinc-400"}`}
                      >
                        {changed > 0 ? "−" : changed < 0 ? "+" : ""}
                        {Math.abs(changed)} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">
                        Còn lại
                      </p>
                      <p className="text-sm text-zinc-200">
                        {remaining == null
                          ? "Chưa đặt mục tiêu"
                          : remaining === 0
                            ? "Đã đạt mục tiêu"
                            : `${Math.abs(remaining)} kg`}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Active metric chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                {metricOptions.map((m) => {
                  const isActive = activeCharts.has(m.key);
                  return (
                    <button
                      key={m.key}
                      onClick={() => {
                        const next = new Set(activeCharts);
                        if (isActive && next.size > 1) next.delete(m.key);
                        else next.add(m.key);
                        setActiveCharts(next);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] border transition-all ${
                        isActive
                          ? "border-opacity-30 bg-opacity-10"
                          : "border-zinc-700/20 bg-zinc-800/20 text-zinc-600 hover:text-zinc-400"
                      }`}
                      style={
                        isActive
                          ? {
                              borderColor: m.color + "40",
                              backgroundColor: m.color + "15",
                              color: m.color,
                            }
                          : {}
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Chart area */}
              {Array.from(activeCharts).map((chartKey) => {
                const m = metricOptions.find((o) => o.key === chartKey);
                if (!m) return null;
                return (
                  <div key={chartKey} className="mb-4 last:mb-0">
                    <p className="text-xs text-zinc-500 mb-2">
                      {m.label}:{" "}
                      <span style={{ color: m.color }}>{m.current}</span>
                      {m.target ? (
                        <>
                          {" "}
                          · Mục tiêu:{" "}
                          <span className="text-zinc-400">{m.target}</span>
                        </>
                      ) : null}
                    </p>
                    <div className="h-40">
                      {m.hasData ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={m.data as any}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#18181b"
                            />
                            <XAxis
                              dataKey="week"
                              tick={{ fontSize: 10, fill: "#3f3f46" }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={m.domain as any}
                              tick={{ fontSize: 10, fill: "#3f3f46" }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                fontSize: 12,
                                borderRadius: 14,
                                border: "1px solid #1e1e24",
                                backgroundColor: "rgba(8,8,12,0.96)",
                                color: "#e4e4e7",
                              }}
                              formatter={(v: number) => [
                                `${v}${m.unit === "%" ? "%" : ` ${m.unit}`}`,
                                m.label,
                              ]}
                              labelFormatter={(_, payload) =>
                                payload?.[0]?.payload?.fullDate || ""
                              }
                            />
                            <Line
                              type="monotone"
                              dataKey={m.dataKey}
                              stroke={m.color}
                              strokeWidth={2.5}
                              dot={{ r: 3, fill: m.color, strokeWidth: 0 }}
                              activeDot={{
                                r: 6,
                                fill: m.color,
                                stroke: "#0a0a0f",
                                strokeWidth: 3,
                              }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/20 flex items-center justify-center px-4 text-center">
                          <span className="text-xs text-zinc-500">
                            Chưa có dữ liệu {m.label.toLowerCase()} trong
                            InBody.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </GlassPanel>
          </div>

          {/* Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Muscle Group Training */}
            <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/[0.02] rounded-full blur-[40px] pointer-events-none" />
              <div className="relative">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center">
                    <Target className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm text-zinc-100">Phân bổ nhóm cơ</h3>
                </div>
                <TimeFilterBar
                  value={muscleFilter}
                  onChange={setMuscleFilter}
                />
                {muscleChartData.length === 0 ? (
                  <div className="mt-6 py-8 text-center">
                    <p className="text-xs text-zinc-500">
                      Chưa có dữ liệu buổi tập nào trong khoảng thời gian này.
                    </p>
                  </div>
                ) : (
                <div className="flex items-start gap-8 mt-6">
                  <div className="shrink-0" style={{ width: 180, height: 180 }}>
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart
                          margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <Pie
                            data={muscleChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={62}
                            paddingAngle={2.5}
                            dataKey="value"
                            strokeWidth={0}
                            label={({
                              cx,
                              cy,
                              midAngle,
                              outerRadius,
                              value,
                              name,
                            }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = outerRadius + 18;
                              const x =
                                cx + radius * Math.cos(-midAngle * RADIAN);
                              const y =
                                cy + radius * Math.sin(-midAngle * RADIAN);
                              return (
                                <text
                                  x={x}
                                  y={y}
                                  fill="#d4d4d8"
                                  textAnchor={x > cx ? "start" : "end"}
                                  dominantBaseline="central"
                                  fontSize={10}
                                >
                                  {value}%
                                </text>
                              );
                            }}
                            labelLine={false}
                          >
                            {muscleChartData.map((d) => (
                              <Cell key={`mc-${d.name}`} fill={d.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <span className="text-base text-white">{muscleChartData.length}</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">
                            Nhóm
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3 pt-1">
                    {muscleChartData.map((d) => (
                      <div
                        key={`ml-${d.name}`}
                        className="flex items-center gap-3"
                      >
                        <span
                          className="w-3 h-3 rounded-[4px] shrink-0"
                          style={{
                            backgroundColor: d.color,
                            boxShadow: `0 0 8px ${d.color}40`,
                          }}
                        />
                        <span className="text-xs text-zinc-300 flex-1 min-w-[64px]">
                          {d.name}
                        </span>
                        <div className="w-24 h-[7px] bg-zinc-800/80 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${d.value * 2}%`,
                              backgroundColor: d.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 w-10 text-right tabular-nums">
                          {d.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>

            {/* Exercise Type Distribution */}
            <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/[0.02] rounded-full blur-[40px] pointer-events-none" />
              <div className="relative">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm text-zinc-100">
                    Phân bổ loại bài tập
                  </h3>
                </div>
                <TimeFilterBar
                  value={exerciseFilter}
                  onChange={setExerciseFilter}
                />
                {exerciseTypeData.length === 0 ? (
                  <div className="mt-6 py-8 text-center">
                    <p className="text-xs text-zinc-500">
                      Chưa có dữ liệu buổi tập nào trong khoảng thời gian này.
                    </p>
                  </div>
                ) : (
                <div className="flex items-start gap-8 mt-6">
                  <div className="shrink-0" style={{ width: 180, height: 180 }}>
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart
                          margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <Pie
                            data={exerciseTypeData}
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={62}
                            paddingAngle={2.5}
                            dataKey="value"
                            strokeWidth={0}
                            label={({
                              cx,
                              cy,
                              midAngle,
                              outerRadius,
                              value,
                              name,
                            }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = outerRadius + 18;
                              const x =
                                cx + radius * Math.cos(-midAngle * RADIAN);
                              const y =
                                cy + radius * Math.sin(-midAngle * RADIAN);
                              return (
                                <text
                                  x={x}
                                  y={y}
                                  fill="#d4d4d8"
                                  textAnchor={x > cx ? "start" : "end"}
                                  dominantBaseline="central"
                                  fontSize={10}
                                >
                                  {value}%
                                </text>
                              );
                            }}
                            labelLine={false}
                          >
                            {exerciseTypeData.map((d) => (
                              <Cell key={`et-${d.name}`} fill={d.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <span className="text-base text-white">{exerciseTypeData.length}</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">
                            Loại
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4 pt-2">
                    {exerciseTypeData.map((d) => (
                      <div
                        key={`el-${d.name}`}
                        className="flex items-center gap-3"
                      >
                        <span
                          className="w-3 h-3 rounded-[4px] shrink-0"
                          style={{
                            backgroundColor: d.color,
                            boxShadow: `0 0 8px ${d.color}40`,
                          }}
                        />
                        <span className="text-xs text-zinc-300 flex-1 min-w-[64px]">
                          {d.name}
                        </span>
                        <div className="w-24 h-[7px] bg-zinc-800/80 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${d.value * 2}%`,
                              backgroundColor: d.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 w-10 text-right tabular-nums">
                          {d.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ DAY DETAIL ═══════════════ */}
      {planView === "dayDetail" &&
        (() => {
          const programDays = currentProgram?.days || [];
          const wd =
            programDays.find((d: any) => d.dayNumber === selectedDay) ||
            programDays[0];
          const detailSchedule = selectedSchedule();
          const detailProgress = scheduleProgressPercent(detailSchedule);
          // Guard against the exact flash-of-wrong-empty-state pattern this
          // pass fixed elsewhere: `currentProgram` is only null while the
          // initial fetch is still in flight (or failed) — without this
          // check, deep-linking straight into a day view briefly claimed
          // "you have no training days" before the real program arrived.
          if (isLoading) {
            return (
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/20 p-8 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
              </div>
            );
          }
          if (!wd) {
            return (
              <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-8 text-center">
                <p className="text-sm text-zinc-400">
                  Bạn chưa có ngày tập trong chương trình hiện tại
                </p>
                <button
                  onClick={() => navigate("/client/plans")}
                  className="mt-4 px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400"
                >
                  Tạo bằng AI
                </button>
              </div>
            );
          }
          return (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setPlanView("main")}
                  className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all"
                >
                  <ChevronLeft className="w-5 h-5 text-zinc-400" />
                </button>
                <div>
                  <h2 className="text-lg text-white tracking-tight">
                    Ngày {selectedDay} — Chi tiết bài tập
                  </h2>
                  <p className="text-xs text-zinc-500">{wd.title}</p>
                </div>
                {isSelectedDayLocked ? (
                  <span className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/8 text-xs text-amber-300/80">
                    <Lock className="w-3 h-3" /> {lockedDayBadgeLabel(detailSchedule?.date ?? toApiDateTime(selectedDate))} — chỉ xem
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      const title = window.prompt("Tên buổi tập", wd.title || "");
                      if (!title || title === wd.title) return;
                      await workoutService.updateProgramDay(wd.id, { title });
                      await refetchProgramAndSchedules();
                    }}
                    className="ml-auto px-3 py-2 rounded-xl border border-zinc-700/40 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Sửa tên buổi
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Summary */}
                <div className="rounded-2xl border border-zinc-800/30 bg-gradient-to-b from-zinc-900/50 to-zinc-900/30 p-6 relative overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/[0.03] rounded-full blur-[40px]" />
                  <div className="relative">
                    <div className="flex justify-center mb-6">
                      <div className="relative">
                        <svg width="110" height="110" viewBox="0 0 110 110">
                          <circle
                            cx="55"
                            cy="55"
                            r="48"
                            fill="none"
                            stroke="#064e3b"
                            strokeWidth="4"
                          />
                          {detailProgress > 0 && (
                            <circle
                              cx="55"
                              cy="55"
                              r="48"
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="4"
                              strokeDasharray={`${(detailProgress / 100) * 302} 302`}
                              strokeLinecap="round"
                              transform="rotate(-90 55 55)"
                            />
                          )}
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <span className="text-2xl text-emerald-400">
                              {detailProgress}%
                            </span>
                            <p className="text-[9px] text-zinc-600 mt-0.5">
                              Hoàn thành
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-center mb-5">
                      <h3 className="text-base text-zinc-100 mb-0.5">
                        Ngày {selectedDay}
                      </h3>
                      <p className="text-xs text-zinc-500">{wd.title}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                      <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                        <Clock className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                        <p className="text-sm text-zinc-200">
                          {wd.duration || "1h"}
                        </p>
                        <p className="text-[10px] text-zinc-600">Thời gian</p>
                      </div>
                      <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                        <Dumbbell className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                        <p className="text-sm text-zinc-200">
                          {wd.exercises?.length || wd.exercises || 0}
                        </p>
                        <p className="text-[10px] text-zinc-600">Bài tập</p>
                      </div>
                    </div>

                    {(() => {
                      const hasExistingSession = Boolean(
                        detailSchedule?.workoutId || detailSchedule?.workout?.id,
                      );
                      // A locked day with no session ever started must not
                      // let the user create new backdated log data. A locked
                      // day that already HAS a session stays reachable —
                      // read-only viewing of what was actually logged is
                      // required even once a day is locked (the individual
                      // log controls inside are separately disabled via
                      // isSelectedDayLocked once there).
                      const blockedByLock = isSelectedDayLocked && !hasExistingSession;
                      return (
                    <button
                      data-testid="start-workout-button"
                      onClick={async () => {
                        if (blockedByLock) {
                          toast.error(
                            lockedDayMessage(
                              detailSchedule?.date ?? toApiDateTime(selectedDate),
                              "tạo buổi tập mới",
                            ),
                          );
                          return;
                        }
                        if (detailSchedule?.id) {
                          try {
                            const started = await workoutService.startSchedule(
                              detailSchedule.id,
                            );
                            applyScheduleProgress(detailSchedule.id, started);
                            setSelectedScheduleId(detailSchedule.id);
                            setCurrentWorkoutId(
                              started.workoutId ||
                                detailSchedule.workoutId ||
                                detailSchedule.workout?.id ||
                                null,
                            );
                          } catch (error: any) {
                            toast.error(
                              error?.response?.data?.error ||
                                "Khong the bat dau buoi tap. Vui long thu lai.",
                            );
                            return;
                          }
                        } else {
                          setCurrentWorkoutId(
                            detailSchedule?.workoutId ||
                              detailSchedule?.workout?.id ||
                              null,
                          );
                        }
                        setPlanView("activeExercise");
                      }}
                      disabled={blockedByLock}
                      className="w-full py-3.5 rounded-xl bg-emerald-500 text-black text-sm tracking-wider transition-all hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500 disabled:hover:shadow-none"
                    >
                      <Play className="w-4 h-4" />{" "}
                      {blockedByLock
                        ? scheduleLockDirection(detailSchedule?.date ?? toApiDateTime(selectedDate)) === "future"
                          ? "CHƯA ĐẾN NGÀY — KHÔNG THỂ TẠO"
                          : "NGÀY ĐÃ QUA — KHÔNG THỂ TẠO"
                        : isSelectedDayLocked
                          ? "XEM LẠI (CHỈ XEM)"
                          : "BẮT ĐẦU TẬP"}
                    </button>
                      );
                    })()}

                    {/* Skip/cancel — only offered before any session was
                     * started for this day (backend rejects skip/cancel once
                     * a workout is logged) and never on a locked past day. */}
                    {(() => {
                      const hasExistingSession = Boolean(
                        detailSchedule?.workoutId || detailSchedule?.workout?.id,
                      );
                      if (!detailSchedule?.id || hasExistingSession || isSelectedDayLocked) return null;
                      if (detailSchedule.status === "SKIPPED" || detailSchedule.status === "CANCELLED") {
                        return (
                          <button
                            onClick={() => setSkipCancelPrompt({ scheduleId: detailSchedule.id })}
                            className="w-full mt-2 py-2 rounded-xl border border-zinc-700/40 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all flex items-center justify-center gap-1.5"
                          >
                            {detailSchedule.status === "SKIPPED" ? "Đã bỏ qua buổi này" : "Đã hủy buổi này"} · Ghi lý do
                          </button>
                        );
                      }
                      return (
                        <button
                          onClick={async () => {
                            try {
                              await workoutService.skipSchedule(detailSchedule.id);
                              await refetchProgramAndSchedules();
                              setSkipCancelPrompt({ scheduleId: detailSchedule.id });
                            } catch (error: any) {
                              toast.error(
                                error?.response?.data?.error || "Không thể bỏ qua buổi tập này.",
                              );
                            }
                          }}
                          className="w-full mt-2 py-2 rounded-xl border border-zinc-700/40 text-[11px] text-zinc-500 hover:text-amber-300 hover:bg-zinc-800/40 transition-all flex items-center justify-center gap-1.5"
                        >
                          <SkipForward className="w-3 h-3" /> Bỏ qua buổi tập này
                        </button>
                      );
                    })()}

                    {/* Reschedule — roadmap P1.2. Deliberately NOT gated on
                     * isSelectedDayLocked (unlike skip/cancel above): a
                     * missed PAST session must be reschedulable (the whole
                     * point of the feature), and so must a future one.
                     * Backend independently re-checks status==="NOT_STARTED"
                     * — this is the same condition, just mirrored here so
                     * the button doesn't invite an action the server will
                     * reject anyway. */}
                    {(() => {
                      const hasExistingSession = Boolean(
                        detailSchedule?.workoutId || detailSchedule?.workout?.id,
                      );
                      if (!detailSchedule?.id || hasExistingSession) return null;
                      if (detailSchedule.status !== "NOT_STARTED") return null;
                      return (
                        <button
                          data-testid="reschedule-trigger"
                          onClick={() =>
                            setReschedulePrompt({
                              scheduleId: detailSchedule.id,
                              currentDateLabel: parseApiDateOnly(
                                detailSchedule.date,
                              ).toLocaleDateString("vi-VN"),
                            })
                          }
                          className="w-full mt-2 py-2 rounded-xl border border-zinc-700/40 text-[11px] text-zinc-500 hover:text-sky-300 hover:bg-zinc-800/40 transition-all flex items-center justify-center gap-1.5"
                        >
                          <CalendarDays className="w-3 h-3" /> Dời lịch buổi tập
                        </button>
                      );
                    })()}

                    {detailSchedule?.id &&
                      (detailSchedule.status === "COMPLETED" || detailSchedule.status === "PARTIALLY_COMPLETED") && (
                        <SessionFeedbackStatusRow
                          scheduleId={detailSchedule.id}
                          onOpenFeedback={() => setFeedbackPrompt({ scheduleId: detailSchedule.id })}
                        />
                      )}
                  </div>
                </div>

                {/* Exercises */}
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between">
                    <SectionTitle
                      title="Bài tập"
                      badge={`${editMode ? editExercises.length : dayExercises.length}`}
                    />
                    {editMode ? (
                      <div className="flex items-center gap-2">
                        {editMode && (
                          <span className="text-[10px] text-zinc-500 italic mr-2">
                            {isSaving ? "Đang lưu..." : "Đã lưu"}
                          </span>
                        )}
                        {/* Roadmap P1.3 "Superset / exercise grouping". */}
                        <button
                          data-testid="group-selection-toggle"
                          onClick={() => {
                            setGroupSelectionMode((prev) => !prev);
                            setSelectedForGroup(new Set());
                          }}
                          className={`flex items-center gap-1.5 text-xs transition-colors px-3 py-1.5 rounded-lg border ${
                            groupSelectionMode
                              ? "text-sky-300 bg-sky-500/10 border-sky-500/25"
                              : "text-zinc-400 hover:text-zinc-300 bg-zinc-800/40 border-zinc-700/25 hover:border-zinc-600/30"
                          }`}
                        >
                          <Repeat className="w-3 h-3" /> {groupSelectionMode ? "Hủy nhóm bài" : "Nhóm bài"}
                        </button>
                        <button
                          onClick={() => {
                            setDayExercises(editExercises);
                            setEditMode(false);
                            setGroupSelectionMode(false);
                            setSelectedForGroup(new Set());
                          }}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/25 hover:border-zinc-600/30"
                        >
                          <Check className="w-3 h-3 text-emerald-400" /> Xong
                        </button>
                        <button
                          onClick={() => handleSaveWorkout(false)}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/15 hover:border-emerald-500/25 disabled:opacity-50"
                        >
                          {isSaving ? (
                            <div className="w-3 h-3 border border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          {isSaving ? "Đang lưu..." : "Lưu ngay"}
                        </button>
                      </div>
                    ) : isSelectedDayLocked ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-amber-300/70 px-3 py-1.5 rounded-lg border border-amber-500/15 bg-amber-500/5">
                        <Lock className="w-3 h-3" /> Đã khóa
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditExercises([...dayExercises]);
                          setEditMode(true);
                        }}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20"
                      >
                        <ArrowUpDown className="w-3 h-3" /> Sửa
                      </button>
                    )}
                  </div>

                  {editMode ? (
                    /* ── Edit Mode: reorderable list ── */
                    <div className="space-y-2 mt-4">
                      {groupSelectionMode && (
                        <div
                          data-testid="group-selection-bar"
                          className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 space-y-2.5"
                        >
                          <p className="text-xs text-sky-200">
                            Chọn ít nhất 2 bài tập để nhóm thành superset/triset/circuit — đang chọn{" "}
                            {selectedForGroup.size}.
                          </p>
                          <div className="flex items-center gap-4 flex-wrap">
                            <label className="flex items-center gap-1.5 text-[11px] text-sky-200/80">
                              Nghỉ giữa các bài (s)
                              <input
                                type="number"
                                data-testid="group-rest-between-input"
                                min={0}
                                max={300}
                                value={groupRestBetween}
                                onChange={(e) => setGroupRestBetween(Number(e.target.value) || 0)}
                                className="w-16 rounded-lg bg-zinc-800/60 border border-zinc-700/60 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-sky-500/50"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-sky-200/80">
                              Nghỉ sau mỗi round (s)
                              <input
                                type="number"
                                data-testid="group-rest-after-round-input"
                                min={0}
                                max={600}
                                value={groupRestAfterRound}
                                onChange={(e) => setGroupRestAfterRound(Number(e.target.value) || 0)}
                                className="w-16 rounded-lg bg-zinc-800/60 border border-zinc-700/60 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-sky-500/50"
                              />
                            </label>
                            <button
                              data-testid="create-group-button"
                              onClick={handleCreateGroup}
                              disabled={selectedForGroup.size < 2 || isCreatingGroup}
                              className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-black bg-sky-400 hover:bg-sky-300 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-all"
                            >
                              {isCreatingGroup && <Loader2 className="w-3 h-3 animate-spin" />}
                              Tạo nhóm ({selectedForGroup.size})
                            </button>
                          </div>
                        </div>
                      )}
                      {isLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center space-y-4">
                          <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                          <p className="text-xs text-zinc-500">Đang tải...</p>
                        </div>
                      ) : (
                        editExercises.map((ex, i) => (
                          <div
                            key={`edit-${ex.id}`}
                            draggable
                            onDragStart={() => setDragIdx(i)}
                            onDragOver={(e) => {
                              e.preventDefault();
                            }}
                            onDrop={() => {
                              if (dragIdx === null || dragIdx === i) return;
                              const items = [...editExercises];
                              const [moved] = items.splice(dragIdx, 1);
                              items.splice(i, 0, moved);
                              setEditExercises(items);
                              setDragIdx(null);
                            }}
                            onDragEnd={() => setDragIdx(null)}
                            className={`rounded-2xl border p-4 flex items-start gap-4 transition-all ${
                              dragIdx === i
                                ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.08)]"
                                : "border-zinc-800/30 bg-zinc-900/40 hover:border-zinc-700/40"
                            }`}
                          >
                            {/* Roadmap P1.3 "Superset / exercise grouping"
                                — checkbox only while actively selecting;
                                an already-grouped exercise can't be
                                selected again (must ungroup first). */}
                            {groupSelectionMode && (
                              <input
                                type="checkbox"
                                data-testid={`group-select-checkbox-${ex.id}`}
                                checked={selectedForGroup.has(ex.id)}
                                disabled={Boolean(ex.groupId)}
                                onChange={(e) => {
                                  setSelectedForGroup((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(ex.id);
                                    else next.delete(ex.id);
                                    return next;
                                  });
                                }}
                                className="mt-1.5 w-4 h-4 rounded border-zinc-700 bg-zinc-800 accent-sky-500 disabled:opacity-30"
                              />
                            )}
                            <div className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 transition-colors">
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <span className="w-6 h-6 rounded-lg bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center text-[10px] text-zinc-500 shrink-0">
                              {i + 1}
                            </span>
                            <div
                              className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-zinc-700/25"
                              onClick={() => setShowExerciseDetail(ex)}
                            >
                              <ExerciseFlipDemo
                                img1={ex.img}
                                img2={ex.img2}
                                alt={ex.name}
                                className="w-full h-full"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-zinc-100 truncate">
                                {ex.name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {ex.prescription}
                              </p>
                              {ex.groupId && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span
                                    data-testid={`edit-group-badge-${ex.id}`}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-300"
                                  >
                                    {GROUP_TYPE_LABEL_VI[ex.groupType] ?? "Nhóm bài"} · Bài {ex.groupOrder + 1}
                                  </span>
                                  {!groupSelectionMode && (
                                    <button
                                      type="button"
                                      data-testid={`ungroup-button-${ex.id}`}
                                      onClick={() => void handleUngroupExercises(ex.groupId)}
                                      className="text-[10px] text-zinc-600 hover:text-amber-400 transition-colors"
                                    >
                                      Bỏ nhóm
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="mt-3 w-full max-w-xs space-y-3">
                                {(
                                  [
                                    { key: "sets", label: "Số set", min: 1, max: 10, step: 1, fallback: 3, majorTickInterval: 5 },
                                    { key: "reps", label: "Số reps", min: 1, max: 50, step: 1, fallback: 10, majorTickInterval: 5 },
                                    { key: "restSeconds", label: "Nghỉ (giây)", min: 0, max: 300, step: 15, fallback: 90, majorTickInterval: 60 },
                                  ] as const
                                ).map(({ key, label, min, max, step, fallback, majorTickInterval }) => (
                                  <RulerSlider
                                    key={key}
                                    label={label}
                                    min={min}
                                    max={max}
                                    step={step}
                                    majorTickInterval={majorTickInterval}
                                    unit={key === "restSeconds" ? "s" : undefined}
                                    value={Number(ex[key]) || fallback}
                                    onChange={(nextValue) => {
                                      const next = [...editExercises];
                                      next[i] = { ...next[i], [key]: nextValue };
                                      next[i].prescription =
                                        `${next[i].sets ?? 3}×${next[i].reps ?? 10}${next[i].restSeconds ? ` · nghỉ ${next[i].restSeconds}s` : ""}`;
                                      setEditExercises(next);
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            <span
                              className={`text-[10px] px-2.5 py-1 rounded-lg border shrink-0 ${
                                ex.type === "cardio"
                                  ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                                  : "text-green-300 border-green-500/15 bg-green-500/6"
                              }`}
                            >
                              {ex.type === "cardio" ? "Cardio" : "Strength"}
                            </span>
                            <button
                              onClick={() => {
                                setReplaceExerciseIndex(i);
                                preselectExerciseFilter(ex);
                                setShowAddExercise(true);
                              }}
                              className="px-2.5 py-1 rounded-lg border border-zinc-700/40 text-[10px] text-zinc-300 hover:bg-zinc-800 shrink-0"
                            >
                              Đổi bài
                            </button>
                            <button
                              onClick={() => {
                                if (editExercises.length <= 1) {
                                  alert("Mỗi ngày tập cần ít nhất 1 bài tập.");
                                  return;
                                }
                                if (
                                  !window.confirm(
                                    "Xóa bài tập này khỏi ngày tập?",
                                  )
                                )
                                  return;
                                setEditExercises(
                                  editExercises.filter((_, j) => j !== i),
                                );
                              }}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/8 transition-all shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                      {!isLoading && (
                        <button
                          onClick={() => {
                            clearExerciseFilters();
                            setReplaceExerciseIndex(null);
                            setShowAddExercise(true);
                          }}
                          className="w-full rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/20 p-4 flex items-center justify-center gap-2 text-xs text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/20 transition-all"
                        >
                          <Plus className="w-4 h-4" /> Thêm bài tập
                        </button>
                      )}
                    </div>
                  ) : (
                    /* ── Normal Mode: clickable cards ── */
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                      {isLoading ? (
                        <div className="col-span-full py-12 flex flex-col items-center justify-center space-y-4">
                          <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                          <p className="text-xs text-zinc-500">
                            Đang tải bài tập...
                          </p>
                        </div>
                      ) : (
                        dayExercises.map((ex, i) => (
                          <div
                            key={`ex-${i}-${ex.name}`}
                            onClick={() => setShowExerciseDetail(ex)}
                            className="group/ex rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-4 flex items-center gap-4 hover:border-emerald-500/15 hover:shadow-[0_0_20px_rgba(16,185,129,0.03)] transition-all cursor-pointer relative overflow-hidden"
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 group-hover/ex:from-emerald-500/[0.015] to-transparent transition-all duration-300" />
                            <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-zinc-700/25">
                              <ExerciseFlipDemo
                                img1={ex.img}
                                img2={ex.img2}
                                alt={ex.name}
                                className="w-full h-full"
                              />
                            </div>
                            <div className="relative flex-1 min-w-0">
                              <p className="text-sm text-zinc-100 truncate">
                                {ex.name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-1">
                                {ex.prescription}
                              </p>
                            </div>
                            <span
                              className={`relative text-[10px] px-2.5 py-1 rounded-lg border shrink-0 ${
                                ex.type === "cardio"
                                  ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                                  : "text-green-300 border-green-500/15 bg-green-500/6"
                              }`}
                            >
                              {ex.type === "cardio" ? "Cardio" : "Strength"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* ═══════════════ ACTIVE EXERCISE ═══════════════ */}
      {planView === "activeExercise" &&
        !showCompletion &&
        (() => {
          if (isLoading) {
            // Still fetching program data after a fresh mount/refresh — show
            // a spinner instead of misreporting "this day has no exercises"
            // (dayExercises is transiently empty while data loads) or
            // flashing exercise #1 before jumping to the restored position.
            return (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
              </div>
            );
          }
          if (dayExercises.length === 0) {
            return (
              <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-8 text-center">
                <p className="text-sm text-zinc-400">
                  Ngày tập này chưa có bài tập
                </p>
                <button
                  onClick={() => setPlanView("dayDetail")}
                  className="mt-4 px-3 py-2 rounded-lg border border-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-800"
                >
                  Quay lai
                </button>
              </div>
            );
          }
          const curEx = dayExercises[activeExIdx];
          const isCompleted = completedExercises.has(activeExIdx);
          const progressPct =
            (completedExercises.size / dayExercises.length) * 100;
          const requiresExternalWeight = exerciseUsesExternalWeight(curEx);
          const curExLoggingMode = exerciseLoggingMode(curEx);
          const allowsExternalWeight = exerciseAllowsExternalWeight(curEx);
          const needsDuration =
            curExLoggingMode === "TIME" ||
            curExLoggingMode === "TIME_LOAD" ||
            curExLoggingMode === "DISTANCE_TIME";
          const needsDistance = curExLoggingMode === "DISTANCE_TIME";
          const activeLog = activeExerciseLogs[activeExIdx] || {
            weightKg: curEx?.weight != null ? String(curEx.weight) : "",
            bodyWeightAtSetKg:
              curEx?.bodyWeightAtSetKg != null
                ? String(curEx.bodyWeightAtSetKg)
                : userProfile?.currentWeight != null
                  ? String(userProfile.currentWeight)
                  : "",
            durationSeconds: curEx?.durationSeconds != null ? String(curEx.durationSeconds) : "",
            distanceMeters: curEx?.distanceMeters != null ? String(curEx.distanceMeters) : "",
            reps: curEx?.reps != null ? String(curEx.reps) : "",
            noWeight: !requiresExternalWeight,
            rpe: curEx?.rpe ?? 7,
            rir: curEx?.rir ?? 2,
          };
          const smartPrefillSource = curEx?.dbId
            ? smartPrefillSourceByExercise[curEx.dbId]
            : undefined;
          // Roadmap P1.1 "true set-by-set table UI" — curExSetRows is
          // `undefined` until the real per-set skeleton has loaded (or for
          // the ad-hoc/freeform path, which never has one); every call site
          // below must treat that the same as "fall back to today's
          // exercise-level completion", never assume zero sets.
          const curExSetRows: WorkoutSetRow[] | undefined = curEx?.programExerciseId
            ? workoutSetsByExercise[curEx.programExerciseId]
            : undefined;
          const activeSetRowIndex = curExSetRows
            ? curExSetRows.findIndex((row) => !row.completed)
            : -1;
          const activeSetRow = activeSetRowIndex >= 0 ? curExSetRows![activeSetRowIndex] : undefined;
          const incompleteSetCount = curExSetRows
            ? curExSetRows.filter((row) => !row.completed).length
            : 0;
          // Defaults to true (today's single bulk-complete behavior) when
          // the skeleton hasn't loaded yet or there's nothing to key off —
          // safe because that's exactly what happens today for every
          // exercise, never a regression.
          const isLastRemainingSet = curExSetRows ? incompleteSetCount <= 1 : true;
          const previousSetForRow = (setNumber: number) =>
            curEx?.dbId
              ? previousPerformanceByExercise[curEx.dbId]?.sets?.find(
                  (s: any) => s.setNumber === setNumber,
                )
              : undefined;
          const updateActiveLog = (patch: Partial<ActiveExerciseLog>) => {
            const prev = activeExerciseLogsRef.current;
            const nextLog = {
                weightKg:
                  prev[activeExIdx]?.weightKg ??
                  (curEx?.weight != null ? String(curEx.weight) : ""),
                bodyWeightAtSetKg:
                  prev[activeExIdx]?.bodyWeightAtSetKg ??
                  (curEx?.bodyWeightAtSetKg != null
                    ? String(curEx.bodyWeightAtSetKg)
                    : userProfile?.currentWeight != null
                      ? String(userProfile.currentWeight)
                      : ""),
                durationSeconds:
                  prev[activeExIdx]?.durationSeconds ??
                  (curEx?.durationSeconds != null ? String(curEx.durationSeconds) : ""),
                distanceMeters:
                  prev[activeExIdx]?.distanceMeters ??
                  (curEx?.distanceMeters != null ? String(curEx.distanceMeters) : ""),
                reps:
                  prev[activeExIdx]?.reps ??
                  (curEx?.reps != null ? String(curEx.reps) : ""),
                noWeight:
                  prev[activeExIdx]?.noWeight ?? !requiresExternalWeight,
                rpe: prev[activeExIdx]?.rpe ?? curEx?.rpe ?? 7,
                rir: prev[activeExIdx]?.rir ?? curEx?.rir ?? 2,
                ...patch,
              };
            const next = {
              ...prev,
              [activeExIdx]: nextLog,
            };
            activeExerciseLogsRef.current = next;
            setActiveExerciseLogs(next);
            // Session-resume draft persistence (roadmap P1.7) — only from
            // real user edits (this function), never from the smart-prefill
            // effect's own initial write, so a reload before the user has
            // touched anything just re-computes the same deterministic
            // prefill fresh instead of persisting a redundant copy of it.
            if (curEx?.dbId) {
              persistActiveLogDraft(selectedSchedule()?.id ?? null, curEx.dbId, nextLog);
            }
          };
          // Gym-onboarding project follow-up §9 — session-only swap: only
          // dayExercises[activeExIdx] changes (local state), never the
          // underlying WorkoutProgramExercise — future weeks still show the
          // originally-planned exercise. sets/reps/restSeconds/prescription
          // are kept from the original slot (a substitute inherits the same
          // prescription intent); only identity fields change.
          const handleSelectSwap = (substitute: ExerciseSubstitute) => {
            const originalName = curEx.name;
            setDayExercises((prev) =>
              prev.map((ex, i) =>
                i === activeExIdx
                  ? {
                      ...ex,
                      dbId: substitute.id,
                      name: substitute.exerciseName,
                      bodyPart: substitute.bodyPart,
                      img: null,
                      img2: null,
                    }
                  : ex,
              ),
            );
            setSwapNotes((prev) => ({
              ...prev,
              [activeExIdx]: `Đã đổi từ "${originalName}" sang "${substitute.exerciseName}"`,
            }));
            setShowSwapModal(false);
            toast.success(`Đã đổi sang "${substitute.exerciseName}" cho buổi tập này`);
          };
          return (
            <div className="space-y-6">
              {showSwapModal && (
                <SwapExerciseModal
                  currentExerciseId={curEx.dbId}
                  currentExerciseName={curEx.name}
                  otherExerciseIdsToday={dayExercises
                    .filter((_, i) => i !== activeExIdx)
                    .map((ex) => ex.dbId)
                    .filter(Boolean)}
                  onSelect={handleSelectSwap}
                  onClose={() => setShowSwapModal(false)}
                />
              )}
              {/* Header */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setPlanView("dayDetail")}
                  className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all"
                >
                  <ChevronLeft className="w-5 h-5 text-zinc-400" />
                </button>
                <div className="flex-1">
                  <h2 className="text-base text-white">
                    <span className="text-emerald-400">{activeExIdx + 1}</span>
                    <span className="text-zinc-600">
                      /{dayExercises.length}
                    </span>{" "}
                    <span className="text-zinc-300">
                      {curEx.type === "cardio" ? "Cardio" : "Strength"} —{" "}
                      {curEx.name}
                    </span>
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <p className="text-xs text-zinc-500">{curEx.prescription}</p>
                    {/* Roadmap P1.3 "Superset / exercise grouping" — visual
                        pairing indicator. Sequenced exercise-then-exercise
                        this pass (see impact analysis's Scope decision),
                        not truly interleaved — the badge communicates "you
                        are doing a superset" without implying set-by-set
                        alternation that doesn't happen yet. */}
                    {(curEx as any).groupId && (
                      <span
                        data-testid="exercise-group-badge"
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-300"
                      >
                        {GROUP_TYPE_LABEL_VI[(curEx as any).groupType] ?? "Nhóm bài"}
                        {" · Bài "}
                        {(curEx as any).groupOrder + 1}/
                        {dayExercises.filter((e: any) => e.groupId === (curEx as any).groupId).length}
                      </span>
                    )}
                    {!isSelectedDayLocked && !isCompleted && (
                      <button
                        type="button"
                        data-testid="swap-exercise-trigger"
                        onClick={() => setShowSwapModal(true)}
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-400/90 hover:text-emerald-300"
                      >
                        <Repeat className="w-3 h-3" /> Không tập được? Đổi bài
                      </button>
                    )}
                  </div>
                </div>
                {/* Timer button — no historical per-exercise duration is
                    stored anywhere (only WorkoutSchedule.durationSeconds for
                    the whole session, which this view doesn't read), so a
                    past/locked day genuinely has no elapsed time to show;
                    disabling the Start control here just stops it from
                    inviting a live timer on content that's already done. */}
                {!timerRunning ? (
                  <button
                    onClick={() => setTimerRunning(true)}
                    disabled={isSelectedDayLocked}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/15 text-sm text-emerald-300 hover:bg-emerald-500/15 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)] transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/10 disabled:hover:shadow-none"
                  >
                    <Play className="w-4 h-4" />{" "}
                    {timerSeconds > 0 ? "Tiếp tục" : "Bắt giờ"}
                  </button>
                ) : (
                  <button
                    onClick={() => setTimerRunning(false)}
                    className="px-5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/15 text-sm text-amber-300 hover:bg-amber-500/15 transition-all flex items-center gap-2"
                  >
                    <Pause className="w-4 h-4" /> Tạm dừng
                  </button>
                )}
              </div>

              {/* Overall progress bar */}
              <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/30 p-3 flex items-center gap-4">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">
                  Tiến độ
                </span>
                <div className="flex-1 h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.35)]"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xs text-emerald-400 shrink-0">
                  {completedExercises.size}/{dayExercises.length}
                </span>
              </div>

              {/* Roadmap P1.4 "Active-workout offline resilience" — always
                  visible sync state (acceptance criteria: "user knows
                  whether workout is saved locally / syncing / synced").
                  Rendered only when there's something to say — a fully
                  synced session shows nothing extra here at all. */}
              {(pendingSyncCount > 0 || isSyncingOffline) && (
                <div
                  data-testid="offline-sync-indicator"
                  data-pending-count={pendingSyncCount}
                  data-syncing={isSyncingOffline}
                  className={`rounded-xl border p-2.5 flex items-center gap-2 text-xs ${
                    isSyncingOffline
                      ? "border-sky-500/20 bg-sky-500/5 text-sky-300"
                      : "border-amber-500/20 bg-amber-500/5 text-amber-300"
                  }`}
                >
                  {isSyncingOffline ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {isSyncingOffline
                    ? "Đang đồng bộ..."
                    : `${pendingSyncCount} thay đổi đã lưu offline, chờ đồng bộ`}
                </div>
              )}

              {/* "Previous performance" — reference context only, never a
                  recommendation/prefill (docs/TRAINING_PROGRESSION_ARCHITECTURE.md
                  §3, §7: "previous performance" must stay visually distinct
                  from any target). Absent while loading/failed/no-history —
                  never a broken-looking placeholder. */}
              {(() => {
                const prevPerf = curEx?.dbId
                  ? previousPerformanceByExercise[curEx.dbId]
                  : undefined;
                if (!prevPerf || !prevPerf.hasHistory) return null;
                return (
                  <div
                    className="rounded-2xl bg-sky-500/5 border border-sky-500/15 p-4"
                    data-testid="previous-performance-card"
                  >
                    <p className="text-xs text-sky-300 flex items-center gap-1.5 mb-2">
                      <Clock className="w-3.5 h-3.5" /> Lần trước
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {prevPerf.sets.map((s) => (
                        <span
                          key={s.setNumber}
                          className="px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/50 text-xs text-zinc-300"
                        >
                          {formatPerformanceSetLabel(s)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Deterministic per-exercise progression — "today's target" +
                  "why", per docs/TRAINING_PROGRESSION_ARCHITECTURE.md §7.
                  The WHY line is a template keyed by reasonCodes[0], never
                  an LLM call — renders correctly with AI fully absent. AI
                  explanation is a separate optional endpoint and cannot
                  override this deterministic target. Visually
                  separate from the "Lần trước" card above: one is what
                  happened, this is what the deterministic engine proposes
                  next — never conflated into one block. */}
              {(() => {
                const progression = curEx?.dbId ? progressionByExercise[curEx.dbId] : undefined;
                if (!progression || progression.status === "INSUFFICIENT_DATA") return null;
                const REASON_TEXT: Record<string, string> = {
                  COMPLETED_ALL_PRESCRIBED_REPS_WITHIN_TARGET_RIR:
                    "Hoàn thành đủ số rep quy định trong ngưỡng nỗ lực mục tiêu.",
                  TOP_OF_REP_RANGE_REACHED_ON_ALL_SETS: "Đã đạt mức rep cao nhất của khoảng quy định.",
                  RIR_TARGET_MET_WITH_HEADROOM_TO_SPARE: "Vẫn còn dư sức theo RIR — có thể tăng tải.",
                  BELOW_TOP_OF_REP_RANGE_ADD_A_REP_BEFORE_ADDING_LOAD:
                    "Chưa đạt đỉnh khoảng rep — nên tăng rep trước khi tăng tải.",
                  PERFORMANCE_DIPPED_SINGLE_SESSION_REVIEW_BEFORE_CHANGING_LOAD:
                    "Hiệu suất giảm nhẹ 1 buổi — giữ nguyên, xem lại trước khi đổi tải.",
                  MISSED_TARGET_TWO_OR_MORE_SESSIONS_IN_A_ROW:
                    "Hụt mục tiêu 2 buổi liên tiếp — nên giảm tải để hồi phục.",
                  BODYWEIGHT_REPS_IMPROVED_OR_HAD_HEADROOM: "Số rep bodyweight tăng — có thể tăng thêm rep.",
                  BODYWEIGHT_REPS_STABLE_NOT_YET_READY_TO_ADD_REPS: "Số rep ổn định — giữ nguyên buổi tới.",
                  TIMED_EXERCISE_DURATION_OR_DISTANCE_IMPROVED: "Thời gian/quãng đường đã cải thiện.",
                  TIMED_EXERCISE_NO_IMPROVEMENT_YET: "Chưa cải thiện — giữ nguyên mục tiêu buổi tới.",
                  REPEAT_SAME_LOAD_UNTIL_PRESCRIBED_REPS_MET_CLEANLY:
                    "Lặp lại cùng mức tải đến khi hoàn thành đủ rep quy định.",
                  CYCLE_DELOAD_OVERRIDES_LOCAL_SIGNAL:
                    "Chu kỳ tập hiện đang ở giai đoạn giảm tải — ưu tiên hồi phục hơn tăng tải cục bộ.",
                  CYCLE_REBUILD_BLOCKS_AUTOMATIC_LOCAL_INCREASE:
                    "Chu kỳ tập cần xem lại tổng thể — chưa tự động tăng tải bài này.",
                };
                const why = REASON_TEXT[progression.reasonCodes[0]] ?? "Dựa trên hiệu suất buổi trước.";
                const STATUS_LABEL: Record<string, string> = {
                  INCREASE_LOAD: "Tăng tải",
                  INCREASE_REPS: "Tăng rep",
                  INCREASE_SETS: "Tăng set",
                  DELOAD: "Giảm tải",
                  REVIEW: "Xem lại",
                  KEEP: "Giữ nguyên",
                };
                return (
                  <div
                    className="rounded-2xl bg-emerald-500/5 border border-emerald-500/15 p-4"
                    data-testid="exercise-progression-card"
                  >
                    <p className="text-xs text-emerald-300 flex items-center gap-1.5 mb-2">
                      <TrendingUp className="w-3.5 h-3.5" /> Hôm nay: {STATUS_LABEL[progression.status] ?? progression.status}
                    </p>
                    {progression.nextTarget && (
                      <p className="text-sm text-zinc-200 mb-1">
                        {progression.nextTarget.weightKg != null ? `${progression.nextTarget.weightKg}kg` : ""}
                        {progression.nextTarget.weightKg != null && progression.nextTarget.reps != null ? " × " : ""}
                        {progression.nextTarget.reps != null ? `${progression.nextTarget.reps} reps` : ""}
                        {progression.nextTarget.durationSeconds != null ? `${progression.nextTarget.durationSeconds}s` : ""}
                      </p>
                    )}
                    <p className="text-xs text-zinc-400">{why}</p>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Media + Info */}
                <div className="space-y-5">
                  {/* Rest timer banner */}
                  {restTimerRunning && restSeconds > 0 && (
                    <div data-testid="rest-timer-banner" className="rounded-2xl border border-amber-500/15 bg-amber-950/20 p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
                          <Timer className="w-4 h-4 text-amber-400" />
                        </div>
                        <div>
                          <p className="text-sm text-amber-200">
                            Nghỉ giữa set
                          </p>
                          <p className="text-xs text-amber-400/50">
                            Nghỉ ngơi trước set tiếp
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span data-testid="rest-timer-remaining-seconds" data-remaining-seconds={restSeconds} className="text-2xl text-amber-300 tabular-nums">
                          {formatTime(restSeconds)}
                        </span>
                        <button
                          onClick={() => {
                            setRestTimerRunning(false);
                            setRestSeconds(90);
                            clearPersistedRestTimer(selectedSchedule()?.id ?? null);
                          }}
                          className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center hover:bg-amber-500/20 transition-all"
                        >
                          <SkipForward className="w-3.5 h-3.5 text-amber-400" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-emerald-500/10 bg-emerald-950/20 p-4 flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center shrink-0">
                      <BarChart3 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <p className="text-xs text-emerald-200/60">
                      Hoạt ảnh bài tập — bấm để xem chi tiết
                    </p>
                  </div>

                  {/* Exercise flip animation demo */}
                  <div
                    data-testid="active-exercise-demo-open-detail"
                    onClick={() => setShowExerciseDetail(curEx)}
                    className="rounded-2xl overflow-hidden border border-zinc-800/30 aspect-video relative group cursor-pointer"
                  >
                    <ExerciseFlipDemo
                      img1={curEx.img}
                      img2={(curEx as any).img2}
                      alt={curEx.name}
                      className="w-full h-full rounded-2xl"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                        <Play className="w-6 h-6 text-white ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="text-center space-y-2 py-2">
                    <h3 className="text-xl text-white tracking-tight">
                      {curEx.name}
                    </h3>
                    <p className="text-sm text-zinc-500">
                      Lịch tập:{" "}
                      <span className="text-emerald-400/70">
                        {curEx.prescription}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Right: Timer rings + Logging + Navigation */}
                <div className="space-y-5">
                  {/* Timer & Stats rings */}
                  <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-8">
                    <div className="flex items-center justify-center gap-10">
                      {/* Elapsed Timer */}
                      <div className="flex flex-col items-center gap-2.5">
                        <div
                          className="relative"
                          style={{ width: 90, height: 90 }}
                        >
                          <svg width="90" height="90" viewBox="0 0 90 90">
                            <circle
                              cx="45"
                              cy="45"
                              r="39"
                              fill="none"
                              stroke="#064e3b"
                              strokeWidth="3"
                            />
                            <circle
                              cx="45"
                              cy="45"
                              r="39"
                              fill="none"
                              stroke={timerRunning ? "#10b981" : "#22c55e"}
                              strokeWidth="3"
                              strokeDasharray={`${Math.min((timerSeconds / 600) * 245, 245)} 245`}
                              strokeLinecap="round"
                              transform="rotate(-90 45 45)"
                              className="transition-all duration-1000"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span
                              className={`text-base tabular-nums ${timerRunning ? "text-emerald-400" : "text-zinc-300"}`}
                            >
                              {formatTime(timerSeconds)}
                            </span>
                          </div>
                          {timerRunning && (
                            <div className="absolute inset-0 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.15)] animate-pulse" />
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-500">
                          Đã qua
                        </span>
                      </div>
                      {/* Rest */}
                      <div className="flex flex-col items-center gap-2.5">
                        <div
                          className="relative"
                          style={{ width: 90, height: 90 }}
                        >
                          <svg width="90" height="90" viewBox="0 0 90 90">
                            <circle
                              cx="45"
                              cy="45"
                              r="39"
                              fill="none"
                              stroke="#18181b"
                              strokeWidth="3"
                            />
                            {restTimerRunning && (
                              <circle
                                cx="45"
                                cy="45"
                                r="39"
                                fill="none"
                                stroke="#f59e0b"
                                strokeWidth="3"
                                strokeDasharray={`${(restSeconds / 90) * 245} 245`}
                                strokeLinecap="round"
                                transform="rotate(-90 45 45)"
                                className="transition-all duration-1000"
                              />
                            )}
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            {restTimerRunning ? (
                              <span className="text-base text-amber-300 tabular-nums">
                                {formatTime(restSeconds)}
                              </span>
                            ) : (
                              <Timer className="w-5 h-5 text-zinc-600" />
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] text-zinc-500">Nghỉ</span>
                      </div>
                      {/* Set Progress */}
                      <div className="flex flex-col items-center gap-2.5">
                        <div
                          className="relative"
                          style={{ width: 90, height: 90 }}
                        >
                          <svg width="90" height="90" viewBox="0 0 90 90">
                            <circle
                              cx="45"
                              cy="45"
                              r="39"
                              fill="none"
                              stroke="#064e3b"
                              strokeWidth="3"
                            />
                            <circle
                              cx="45"
                              cy="45"
                              r="39"
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="3"
                              strokeDasharray={`${(progressPct / 100) * 245} 245`}
                              strokeLinecap="round"
                              transform="rotate(-90 45 45)"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-base text-emerald-400">
                              {completedExercises.size}/{dayExercises.length}
                            </span>
                          </div>
                        </div>
                        <span className="text-[11px] text-zinc-500">Xong</span>
                      </div>
                    </div>
                  </div>

                  {/* Set overview table — roadmap P1.1 "true set-by-set
                      table UI" (§6/§11's own mockup). Only rendered once
                      the real per-set skeleton has loaded for a
                      schedule-linked session with more than one set — a
                      1-set exercise, the ad-hoc/freeform path, or a
                      not-yet-loaded skeleton all keep today's plain single-
                      value "Ghi chép" card below exactly as-is (see
                      docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md's
                      "Layout decision" — inputs stay in that card, this
                      table is Previous/Recommended/status reference plus
                      one-tap-undo for already-completed rows). */}
                  {curExSetRows && curExSetRows.length > 1 && (
                    <div
                      data-testid="set-overview-table"
                      className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 overflow-hidden"
                    >
                      <div className="px-4 pt-4 pb-1 text-xs text-zinc-600 uppercase tracking-wider">
                        Các set
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-zinc-600 text-left">
                              <th className="px-4 py-2 font-normal">Set</th>
                              <th className="px-4 py-2 font-normal">Lần trước</th>
                              <th className="px-4 py-2 font-normal">Đề xuất</th>
                              <th className="px-4 py-2 font-normal">Hôm nay</th>
                            </tr>
                          </thead>
                          <tbody>
                            {curExSetRows.map((row, rowIdx) => {
                              const isActiveRow = rowIdx === activeSetRowIndex;
                              const prevSet = previousSetForRow(row.setNumber);
                              const nextTarget = curEx?.dbId
                                ? progressionByExercise[curEx.dbId]?.nextTarget
                                : undefined;
                              const recommendedLabel = nextTarget
                                ? [
                                    nextTarget.weightKg != null ? `${nextTarget.weightKg}kg` : null,
                                    nextTarget.reps != null ? `${nextTarget.reps} reps` : null,
                                    nextTarget.durationSeconds != null ? `${nextTarget.durationSeconds}s` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" × ")
                                : "—";
                              return (
                                <tr
                                  key={row.id}
                                  data-testid={`set-row-${row.setNumber}`}
                                  data-set-completed={row.completed}
                                  data-set-active={isActiveRow}
                                  className={`border-t border-zinc-800/30 ${isActiveRow ? "bg-emerald-500/5" : ""}`}
                                >
                                  <td className="px-4 py-2.5 text-zinc-300">{row.setNumber}</td>
                                  <td className="px-4 py-2.5 text-zinc-500">
                                    {prevSet ? formatPerformanceSetLabel(prevSet) : "—"}
                                  </td>
                                  <td className="px-4 py-2.5 text-emerald-400/80">
                                    {row.completed ? "—" : recommendedLabel}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {row.completed ? (
                                      <span className="inline-flex items-center gap-1.5 text-emerald-400">
                                        <Check className="w-3.5 h-3.5" />
                                        {[
                                          row.weight != null ? `${row.weight}kg` : null,
                                          row.reps != null ? `${row.reps} reps` : null,
                                          row.durationSeconds != null ? `${row.durationSeconds}s` : null,
                                          row.distanceMeters != null ? `${row.distanceMeters}m` : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" × ")}
                                        {/* Only the MOST RECENTLY completed row ever gets an
                                            inline undo — every set completes strictly in
                                            order through this table (only the first
                                            incomplete row is ever the active/completable
                                            one), so "the row right before the active one"
                                            (or the last row, once every set is done) is
                                            always unambiguously the most recent completion.
                                            Never offered on an earlier completed row —
                                            undoing THAT one out of order isn't a scenario
                                            this pass's design/tests cover. */}
                                        {!isSelectedDayLocked &&
                                          row.completed &&
                                          (activeSetRowIndex === -1
                                            ? rowIdx === curExSetRows.length - 1
                                            : rowIdx === activeSetRowIndex - 1) && (
                                          <button
                                            type="button"
                                            data-testid={`undo-set-${row.setNumber}`}
                                            onClick={() =>
                                              void handleUndoSetRow(
                                                activeExIdx,
                                                curEx.programExerciseId,
                                                row.id,
                                                activeExerciseLogsRef.current[activeExIdx],
                                                activeSetRowIndex === -1,
                                              )
                                            }
                                            className="ml-1 text-zinc-600 hover:text-amber-400 transition-colors"
                                            aria-label={`Hoàn tác set ${row.setNumber}`}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        )}
                                      </span>
                                    ) : isActiveRow ? (
                                      <span className="text-emerald-300/80">Đang nhập bên dưới ↓</span>
                                    ) : (
                                      <span className="text-zinc-700">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Log Entry */}
                  <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 space-y-4">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider">
                      Ghi chép
                      {curExSetRows && curExSetRows.length > 1 && activeSetRow && (
                        <span className="normal-case text-zinc-500"> — Set {activeSetRow.setNumber}/{curExSetRows.length}</span>
                      )}
                    </p>
                    {isSelectedDayLocked && (
                      <div
                        role="status"
                        className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3"
                      >
                        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-xs text-amber-200/90">
                          {lockedDayMessage(selectedSchedule()?.date ?? toApiDateTime(selectedDate))} Dữ liệu bên dưới chỉ hiển thị để xem lại.
                        </p>
                      </div>
                    )}
                    {/* Weight input — REPS_LOAD / TIME_LOAD / BODYWEIGHT_REPS
                        only. TIME/DISTANCE_TIME never show this at all
                        (openGym P0-completion pass — a plank/run has no
                        weight to record); TIME_LOAD (e.g. weighted carry)
                        shows both this AND the duration control below. */}
                    {(curExLoggingMode === "REPS_LOAD" ||
                      curExLoggingMode === "TIME_LOAD" ||
                      curExLoggingMode === "BODYWEIGHT_REPS") && (
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <RulerSlider
                          className="min-w-0 flex-1"
                          label="Khối lượng tạ"
                          min={0}
                          max={300}
                          step={0.5}
                          majorTickInterval={10}
                          unit="kg"
                          disabled={isSelectedDayLocked || activeLog.noWeight}
                          value={activeLog.noWeight ? 0 : Number(activeLog.weightKg) || 0}
                          onChange={(next) =>
                            updateActiveLog({
                              weightKg: String(next),
                              noWeight: false,
                            })
                          }
                        />
                        {/* h-16 matches RulerSlider's own track height exactly, so
                            `sm:items-end` lines this button's bottom edge up with
                            the track's bottom edge instead of floating vertically
                            centered against the slider's full label+value+track
                            block (which used to put it overlapping the value
                            text and the top of the track — see git history). */}
                        <button
                          type="button"
                          data-testid="no-weight-toggle"
                          onClick={() =>
                            updateActiveLog({
                              noWeight: !activeLog.noWeight,
                              weightKg: "",
                            })
                          }
                          disabled={isSelectedDayLocked || !allowsExternalWeight}
                          className={`h-16 shrink-0 rounded-xl border px-4 text-sm font-medium transition-all ${
                            activeLog.noWeight
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : "border-zinc-700/40 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-800"
                          } disabled:cursor-default`}
                        >
                          Không dùng tạ
                        </button>
                      </div>
                    )}
                    {requiresExternalWeight && !activeLog.noWeight && (
                      <p className="text-[11px] text-amber-300/80">
                        Bắt buộc nhập tổng kg tạ trước khi hoàn thành bài này.
                      </p>
                    )}

                    {/* Duration input — TIME / TIME_LOAD / DISTANCE_TIME.
                        Real, separate field (WorkoutSet.durationSeconds) —
                        this replaces an earlier version of this screen that
                        relabeled the WEIGHT slider as "Thời gian (phút)" and
                        silently stored the value as kg (a real bug found and
                        fixed this pass, see docs/OPENGYM_P0_COMPLETION_REPORT.md
                        "Bugs found"). Minutes in the UI (familiar unit for a
                        plank/carry/run), converted to whole seconds on write. */}
                    {curExLoggingMode === "BODYWEIGHT_REPS" && (
                      <label className="block">
                        <span className="block text-[11px] text-zinc-500 mb-1">
                          Body weight at set (kg)
                        </span>
                        <input
                          data-testid="bodyweight-at-set-input"
                          type="number"
                          min="1"
                          max="500"
                          step="0.1"
                          disabled={isSelectedDayLocked}
                          value={activeLog.bodyWeightAtSetKg}
                          onChange={(event) =>
                            updateActiveLog({ bodyWeightAtSetKg: event.target.value })
                          }
                          className="w-full rounded-xl border border-zinc-700/40 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40 disabled:opacity-50"
                        />
                      </label>
                    )}

                    {/* Reps input — BODYWEIGHT_REPS only (roadmap P1.1
                        "bodyweight reps editable prefill"). Reps is the
                        actual progress axis for this mode (see
                        exercise-progression.engine.ts's
                        BODYWEIGHT_REP_CLIMB policy — reps go up, not load),
                        so unlike REPS_LOAD/TIME_LOAD it needs a real editable
                        control here rather than always trusting the fixed
                        program prescription. Sent as `reps` in the
                        completeScheduleExercise payload below; omitting it
                        (blank) preserves the exact old behavior — the
                        backend already falls back to the planned reps when
                        none is supplied (workout.service.ts
                        completeScheduleExercise, unchanged this pass). */}
                    {curExLoggingMode === "BODYWEIGHT_REPS" && (
                      <RulerSlider
                        className="min-w-0"
                        label="Số reps"
                        min={1}
                        max={100}
                        step={1}
                        majorTickInterval={5}
                        disabled={isSelectedDayLocked}
                        value={Number(activeLog.reps) || 0}
                        onChange={(next) => updateActiveLog({ reps: String(Math.round(next)) })}
                      />
                    )}

                    {needsDuration && (
                      <RulerSlider
                        className="min-w-0"
                        label="Thời gian"
                        min={0}
                        max={180}
                        step={0.25}
                        majorTickInterval={5}
                        unit="phút"
                        disabled={isSelectedDayLocked}
                        value={(Number(activeLog.durationSeconds) || 0) / 60}
                        onChange={(nextMinutes) =>
                          updateActiveLog({ durationSeconds: String(Math.round(nextMinutes * 60)) })
                        }
                      />
                    )}
                    {needsDistance && (
                      <RulerSlider
                        className="min-w-0"
                        label="Quãng đường"
                        min={0}
                        max={50}
                        step={0.1}
                        majorTickInterval={5}
                        unit="km"
                        disabled={isSelectedDayLocked}
                        value={(Number(activeLog.distanceMeters) || 0) / 1000}
                        onChange={(nextKm) =>
                          updateActiveLog({ distanceMeters: String(Math.round(nextKm * 1000)) })
                        }
                      />
                    )}
                    {(curExLoggingMode === "TIME" || curExLoggingMode === "TIME_LOAD") &&
                      !(Number(activeLog.durationSeconds) > 0) && (
                        <p className="text-[11px] text-amber-300/80">
                          Bắt buộc nhập thời gian trước khi hoàn thành bài này.
                        </p>
                      )}
                    {smartPrefillSource && (
                      <p
                        data-testid="smart-prefill-source"
                        data-source={smartPrefillSource}
                        className="text-[11px] text-emerald-300/75"
                      >
                        Đã điền sẵn từ{" "}
                        {smartPrefillSource === "progression"
                          ? "mục tiêu hôm nay"
                          : smartPrefillSource === "previous"
                            ? "lần trước"
                            : "kế hoạch"}
                      </p>
                    )}

                    {showRpeRirHint && (
                      <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/8 p-3">
                        <MessageSquare className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1.5">
                          <p className="text-[11px] text-sky-100/90">
                            <strong>RPE</strong> (mức độ gắng sức): set vừa rồi khó đến đâu, từ 1
                            (rất nhẹ) đến 10 (dùng hết sức). Cách ước lượng dễ nhất: đếm xem nếu
                            cố thêm, bạn còn làm được <strong>mấy reps nữa</strong> thì mới thật sự
                            kiệt sức (thất bại) — đó chính là <strong>RIR</strong>.
                          </p>
                          <ul className="text-[10px] text-sky-200/80 space-y-0.5 pl-3.5 list-disc">
                            <li>Còn làm thêm được ≥4 reps → RPE 6 (còn dư sức nhiều)</li>
                            <li>Còn làm thêm được 2 reps → RPE 8</li>
                            <li>Còn làm thêm được 1 rep → RPE 9</li>
                            <li>Không thể làm thêm rep nào → RPE 10 (RIR = 0, hết sức)</li>
                          </ul>
                          <p className="text-[10px] text-sky-300/70">
                            Không có câu trả lời "đúng/sai" — cứ ước lượng theo cảm nhận thật của
                            bạn, sẽ chính xác dần sau vài buổi tập.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowRpeRirHint(false)}
                          aria-label="Đóng giải thích RPE/RIR"
                          className="text-sky-400/60 hover:text-sky-300 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {/* The auto-shown hint above only appears once per session for
                        a detected-beginner profile and can be dismissed — this
                        button stays available to EVERYONE, always, so "what do
                        RPE/RIR mean" is never more than one tap away regardless
                        of profile or whether the hint was already closed. */}
                    {!showRpeRirHint && (
                      <button
                        type="button"
                        onClick={() => setShowRpeRirHint(true)}
                        className="flex items-center gap-1.5 text-[11px] text-sky-400/80 hover:text-sky-300 transition-colors -mb-1"
                      >
                        <MessageSquare className="w-3 h-3" /> RPE/RIR là gì?
                      </button>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <RulerSlider
                        label="Mức độ gắng sức (RPE)"
                        min={1}
                        max={10}
                        step={0.5}
                        majorTickInterval={1}
                        formatValue={(v) => `RPE ${v}`}
                        disabled={isSelectedDayLocked}
                        value={activeLog.rpe}
                        onChange={(next) => updateActiveLog({ rpe: next })}
                      />
                      <RulerSlider
                        label="Số reps còn có thể làm (RIR)"
                        min={0}
                        max={5}
                        step={1}
                        majorTickInterval={1}
                        disabled={isSelectedDayLocked}
                        value={activeLog.rir}
                        onChange={(next) => updateActiveLog({ rir: next })}
                      />
                    </div>

                    <button
                      disabled={isSelectedDayLocked}
                      className="flex items-center gap-2 text-xs text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:hover:text-zinc-500 disabled:cursor-not-allowed"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Thêm ghi chú
                    </button>
                  </div>

                  {/* Navigation buttons */}
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => {
                        if (activeExIdx > 0) {
                          setActiveExIdx(activeExIdx - 1);
                          setTimerRunning(false);
                          setTimerSeconds(0);
                        }
                      }}
                      disabled={activeExIdx === 0}
                      className="min-w-0 py-3.5 px-1 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                    >
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                      <span className="truncate">Trước</span>
                    </button>
                    <button
                      data-testid="complete-exercise-button"
                      onClick={handleCompleteExercise}
                      disabled={isSelectedDayLocked || isCompleted || isCompletingWorkout}
                      className={`min-w-0 py-3.5 px-1 rounded-xl text-sm transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
                        isSelectedDayLocked || isCompleted || isCompletingWorkout
                          ? "bg-emerald-500/10 border border-emerald-500/15 text-emerald-500/50 cursor-not-allowed"
                          : "bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-[0.98]"
                      }`}
                    >
                      <Check className="w-4 h-4 shrink-0" />
                      <span className="truncate">
                        {isCompleted
                          ? "Xong"
                          : curExSetRows && curExSetRows.length > 1 && activeSetRow
                            ? `Hoàn thành Set ${activeSetRow.setNumber}`
                            : "Hoàn thành"}
                      </span>
                    </button>
                    <button
                      onClick={handleSkipExercise}
                      disabled={isSelectedDayLocked || activeExIdx === dayExercises.length - 1}
                      className="min-w-0 py-3.5 px-1 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                    >
                      <span className="truncate">Bỏ qua</span>
                      <SkipForward className="w-4 h-4 shrink-0" />
                    </button>
                  </div>

                  {/* Exercise list mini nav */}
                  <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-4">
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
                      Danh sách bài tập
                    </p>
                    <div className="space-y-1.5">
                      {dayExercises.map((ex, i) => {
                        const done = completedExercises.has(i);
                        const active = i === activeExIdx;
                        return (
                          <button
                            key={`nav-${i}`}
                            onClick={() => {
                              setActiveExIdx(i);
                              setTimerRunning(false);
                              setTimerSeconds(0);
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${
                              active
                                ? "bg-emerald-500/8 border border-emerald-500/15"
                                : "hover:bg-zinc-800/30 border border-transparent"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                                done
                                  ? "bg-emerald-500 text-black"
                                  : active
                                    ? "bg-emerald-500/15 border border-emerald-500/25"
                                    : "bg-zinc-800/40 border border-zinc-700/25"
                              }`}
                            >
                              {done ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <span className="text-[10px] text-zinc-500">
                                  {i + 1}
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-xs truncate ${done ? "text-zinc-500 line-through" : active ? "text-emerald-300" : "text-zinc-400"}`}
                            >
                              {ex.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ═══════════════ WORKOUT COMPLETION ═══════════════ */}
      {planView === "activeExercise" && showCompletion && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-8 max-w-lg mx-auto">
            {/* Trophy */}
            <div className="relative inline-block">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-500/20 to-green-600/10 border-2 border-emerald-500/25 flex items-center justify-center mx-auto shadow-[0_0_60px_rgba(16,185,129,0.2)]">
                <Trophy className="w-14 h-14 text-emerald-400" />
              </div>
              <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20">
                <PartyPopper className="w-5 h-5 text-emerald-300" />
              </div>
            </div>

            <div>
              <h2 className="text-3xl text-white tracking-tight mb-3">
                Hoàn thành buổi tập!
              </h2>
              <p className="text-zinc-400 text-sm">
                Xuất sắc ngày {selectedDay} — hoàn thành {dayExercises.length}{" "}
                bài tập! Hãy duy trì phong độ.
              </p>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-center gap-6">
              {[
                {
                  label: "Bài tập",
                  value: `${dayExercises.length}/${dayExercises.length}`,
                  icon: Dumbbell,
                },
                {
                  label: "Thời gian",
                  value: formatTime(timerSeconds || 0),
                  icon: Clock,
                },
                { label: "Trạng thái", value: "Hoàn thành", icon: Check },
              ].map((s) => (
                <div
                  key={s.label}
                  className="px-5 py-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/30 min-w-[120px]"
                >
                  <s.icon className="w-4 h-4 text-emerald-500/60 mx-auto mb-2" />
                  <p className="text-sm text-emerald-300">{s.value}</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* PR / volume summary — spec: "kết thúc workout → hiển thị PR
                và tiến độ". Loaded async right after the workout is saved
                (see loadCompletionSummary); simply absent while loading or
                if it failed to load, never a broken/empty-looking block. */}
            {completionSummary && (
              <div
                className="space-y-3 max-w-md mx-auto text-left"
                data-testid="workout-completion-summary"
              >
                {completionSummary.prs.length > 0 && (
                  <div
                    className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4"
                    data-testid="workout-completion-prs"
                  >
                    <p className="text-xs text-emerald-300 flex items-center gap-1.5 mb-2">
                      <Trophy className="w-3.5 h-3.5" /> Kỷ lục cá nhân mới
                    </p>
                    <div className="space-y-1.5">
                      {completionSummary.prs.map((pr) => (
                        <div
                          key={pr.exerciseId}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-zinc-300 truncate pr-2">{pr.exerciseName}</span>
                          {pr.prType === "REPS" ? (
                            <span className="text-emerald-400 shrink-0">
                              {pr.reps} reps
                              <span className="text-zinc-500 text-xs">
                                {" "}
                                (trước: {pr.previousBestReps} reps)
                              </span>
                            </span>
                          ) : (
                            <span className="text-emerald-400 shrink-0">
                              {pr.weightKg}kg{pr.reps ? ` × ${pr.reps}` : ""}
                              <span className="text-zinc-500 text-xs">
                                {" "}
                                (trước: {pr.previousBestWeightKg}kg)
                              </span>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  className="rounded-2xl bg-zinc-900/50 border border-zinc-800/30 p-4 flex items-center justify-between"
                  data-testid="workout-completion-volume"
                >
                  <span className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500/60" /> Tổng khối lượng buổi tập
                  </span>
                  <span className="text-sm text-emerald-300">
                    {completionSummary.totalVolumeKg.toLocaleString("vi-VN")} kg
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => {
                  setPlanView("dayDetail");
                }}
                className="px-8 py-3.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-all"
              >
                Quay lại chi tiết
              </button>
              <button
                onClick={() => {
                  setPlanView("main");
                }}
                className="px-8 py-3.5 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] flex items-center gap-2"
              >
                <Trophy className="w-4 h-4" /> Xem tất cả ngày
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackPrompt && (
        <SessionFeedbackModal
          scheduleId={feedbackPrompt.scheduleId}
          exercises={dayExercises.map((ex: any) => ({ exerciseId: ex.dbId, name: ex.name }))}
          onClose={() => setFeedbackPrompt(null)}
        />
      )}

      {skipCancelPrompt && (
        <SkipCancelFeedbackModal
          scheduleId={skipCancelPrompt.scheduleId}
          onClose={() => setSkipCancelPrompt(null)}
        />
      )}

      {reschedulePrompt && (
        <RescheduleModal
          scheduleId={reschedulePrompt.scheduleId}
          currentDateLabel={reschedulePrompt.currentDateLabel}
          onClose={() => setReschedulePrompt(null)}
          onRescheduled={() => void refetchProgramAndSchedules()}
        />
      )}

      {showCreateCustomExercise && (
        <CreateCustomExerciseModal
          exerciseOptions={exerciseOptions}
          onClose={() => setShowCreateCustomExercise(false)}
          onCreated={() => void myCustomExercisesQuery.refetch()}
        />
      )}

      {/* ═══════════════ EXERCISE DETAIL MODAL ═══════════════ */}
      {showExerciseDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowExerciseDetail(null)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setShowExerciseDetail(null)}
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-xl bg-black/40 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/60 transition-all"
            >
              <Plus className="w-4 h-4 text-white/60 rotate-45" />
            </button>

            {/* Exercise Demo — flip animation between image 0 and 1 */}
            <div className="aspect-video w-full rounded-t-2xl overflow-hidden bg-zinc-950 relative">
              <ExerciseFlipDemo
                img1={showExerciseDetail.img}
                img2={(showExerciseDetail as any).img2}
                alt={showExerciseDetail.name}
                className="w-full h-full"
              />
              {/* Overlay label */}
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm border border-white/[0.06] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-zinc-400">Demo bài tập</span>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl text-white tracking-tight">
                    {showExerciseDetail.name}
                  </h2>
                  <p className="text-sm text-emerald-400 mt-1">
                    {showExerciseDetail.prescription || "Chưa có lịch tập"}
                  </p>
                </div>
                <span
                  className={`text-[11px] px-3 py-1.5 rounded-xl border shrink-0 ${
                    showExerciseDetail.type === "cardio"
                      ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                      : "text-green-300 border-green-500/15 bg-green-500/6"
                  }`}
                >
                  {showExerciseDetail.type === "cardio" ? "Cardio" : "Strength"}
                </span>
              </div>

              {/* Description */}
              <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
                  Mô tả
                </p>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {showExerciseDetail.description}
                </p>
              </div>

              {/* Muscles & Tips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
                    Cơ mục tiêu
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {showExerciseDetail.muscles.map((m: string) => (
                      <span
                        key={m}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/12 text-xs text-emerald-300"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
                    Mẹo hay
                  </p>
                  <ul className="space-y-2">
                    {showExerciseDetail.tips?.map((t: string, i: number) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs text-zinc-400"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Gate 6 — real muscle-map SVG (ExerciseMuscle data, never
                  guessed), separate from the plain-text tag list above
                  (that reads the legacy free-text muscleGroupsActivated
                  column; this reads the new canonical Muscle taxonomy with
                  a real primary/secondary split). Only rendered when a
                  real DB exercise id is known — a manually-typed custom
                  exercise (no dbId) has nothing to look up. */}
              {showExerciseDetail.dbId && (
                <div
                  data-testid="exercise-muscle-map"
                  className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4"
                >
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
                    Sơ đồ nhóm cơ
                  </p>
                  <ExerciseMuscleMap exerciseId={showExerciseDetail.dbId} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ CALENDAR SCHEDULE MODAL ═══════════════ */}
      {showManualBuilder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowManualBuilder(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg text-white">
                  Tạo chương trình thủ công
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Chọn lịch trong tuần, rồi tự custom bài tập cho từng buổi.
                </p>
              </div>
              <button
                onClick={() => setShowManualBuilder(false)}
                className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-zinc-400">
                  Tên chương trình
                </span>
                <input
                  value={manualProgramName}
                  onChange={(event) => setManualProgramName(event.target.value)}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-zinc-400">
                  Ngày bắt đầu
                </span>
                <input
                  type="date"
                  value={manualStartDate}
                  onChange={(event) => setManualStartDate(event.target.value)}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50 [color-scheme:dark]"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-zinc-400">
                  Số tuần
                </span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={manualDurationWeeks}
                  onChange={(event) =>
                    setManualDurationWeeks(event.target.value)
                  }
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                />
              </label>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-zinc-100 font-semibold">
                    Số buổi và ngày tập
                  </p>
                  <p className="text-xs text-zinc-500">
                    Chọn đúng số ngày bằng số buổi/tuần.
                  </p>
                </div>
                <select
                  value={manualDaysPerWeek}
                  onChange={(event) =>
                    updateManualDaysPerWeek(Number(event.target.value))
                  }
                  className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                    <option key={value} value={value}>
                      {value} buổi/tuần
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                {MANUAL_WEEKDAYS.map((weekday) => {
                  const active = manualSelectedWeekdays.includes(weekday.value);
                  return (
                    <button
                      key={weekday.value}
                      type="button"
                      onClick={() => toggleManualWeekday(weekday.value)}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${active ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-200"}`}
                    >
                      <span className="block font-semibold">
                        {weekday.short}
                      </span>
                      <span className="block text-[10px] opacity-70">
                        {weekday.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {manualDays.map((day, dayIndex) => (
                <div
                  key={day.dayNumber}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-center text-xs font-semibold">
                      {day.dayNumber}
                    </span>
                    <input
                      value={day.title}
                      onChange={(event) =>
                        setManualDays((previous) =>
                          previous.map((item, index) =>
                            index === dayIndex
                              ? { ...item, title: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setManualEditingDayIndex(dayIndex);
                        clearExerciseFilters();
                        setReplaceExerciseIndex(null);
                        setShowAddExercise(true);
                      }}
                      className="px-3 py-2 rounded-xl bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400"
                    >
                      Thêm bài
                    </button>
                  </div>
                  <div className="space-y-2">
                    {day.exercises.length === 0 ? (
                      <p className="text-xs text-zinc-500 rounded-lg border border-dashed border-zinc-800 p-3">
                        Chưa có bài tập.
                      </p>
                    ) : (
                      day.exercises.map((exercise, exerciseIndex) => (
                        <div
                          key={`${exercise.exerciseId}-${exerciseIndex}`}
                          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-zinc-100">
                              {exerciseIndex + 1}. {exercise.exerciseName}
                            </p>
                            <p className="text-[10px] text-zinc-500">
                              {exercise.sets}x{exercise.reps} · nghỉ{" "}
                              {exercise.restSeconds}s
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setManualDays((previous) =>
                                previous.map((item, index) =>
                                  index === dayIndex
                                    ? {
                                        ...item,
                                        exercises: item.exercises.filter(
                                          (_, removeIndex) =>
                                            removeIndex !== exerciseIndex,
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="h-8 w-8 rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 flex items-center justify-center hover:bg-red-500/20"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowManualBuilder(false)}
                className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateManualProgram}
                disabled={savingManualProgram}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingManualProgram
                  ? "Đang lưu..."
                  : "Lưu chương trình thủ công"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCalendarAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCalendarAdd(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg text-white">Thêm lịch tập</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Chọn ngày và buổi tập từ chương trình hiện tại
                </p>
              </div>
              <button
                onClick={() => setShowCalendarAdd(false)}
                className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {!currentProgram?.days?.length ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-100">
                  Bạn chưa có chương trình tập. Hãy tạo AI Plan hoặc tạo chương
                  trình thủ công trước.
                </p>
                <button
                  onClick={() => navigate("/client/plans")}
                  className="mt-3 px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400"
                >
                  Tạo AI Plan
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="block text-xs font-semibold text-zinc-400">
                      Ngày tập
                    </span>
                    <input
                      type="date"
                      value={scheduleDateInput}
                      onChange={(event) =>
                        setScheduleDateInput(event.target.value)
                      }
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50 [color-scheme:dark]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs font-semibold text-zinc-400">
                      Buổi tập
                    </span>
                    <select
                      value={scheduleProgramDayId}
                      onChange={(event) =>
                        setScheduleProgramDayId(event.target.value)
                      }
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Chọn buổi tập</option>
                      {(currentProgram.days || []).map((day: any) => (
                        <option key={day.id} value={day.id}>
                          Ngày {day.dayNumber} - {day.title || "Buổi tập"} (
                          {day.exercises?.length || 0} bài)
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {(() => {
                  const day = (currentProgram.days || []).find(
                    (item: any) => item.id === scheduleProgramDayId,
                  );
                  const exercises = day?.exercises || [];
                  return day ? (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                      <div className="text-sm text-zinc-100 font-semibold">
                        {day.title || `Ngày ${day.dayNumber}`}
                      </div>
                      <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto">
                        {exercises.length > 0 ? (
                          exercises.map((exercise: any, index: number) => (
                            <div
                              key={exercise.id || index}
                              className="flex items-center justify-between gap-3 text-xs text-zinc-400"
                            >
                              <span className="truncate">
                                {index + 1}.{" "}
                                {exercise.exercise?.exerciseName || "Bài tập"}
                              </span>
                              <span className="text-zinc-600 shrink-0">
                                {exercise.sets || 3}x{exercise.reps || 10}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">
                            Buổi này chưa có bài tập.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}

                <label className="space-y-1 block">
                  <span className="block text-xs font-semibold text-zinc-400">
                    Ghi chú
                  </span>
                  <textarea
                    value={scheduleNotes}
                    onChange={(event) => setScheduleNotes(event.target.value)}
                    rows={3}
                    placeholder="Ghi chú tùy chọn..."
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50 resize-none"
                  />
                </label>
              </>
            )}

            {/* ── Step 1: Weekday selection ── */}
            <div className="hidden">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
                1 · Ngày & giờ tập
              </p>
              <div className="space-y-2">
                {WD_LABELS.map((label, idx) => {
                  const slot = weekdaySlots[idx];
                  const enabled = !!slot?.enabled;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        enabled
                          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
                          : "border-zinc-800/30 bg-zinc-800/15"
                      }`}
                    >
                      {/* Toggle */}
                      <button
                        onClick={() => {
                          const next = { ...weekdaySlots };
                          if (enabled) {
                            delete next[idx];
                          } else {
                            next[idx] = { enabled: true, time: "07:00" };
                          }
                          setWeekdaySlots(next);
                        }}
                        className={`relative rounded-full transition-all shrink-0 ${enabled ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.2)]" : "bg-zinc-700"}`}
                        style={{ width: 38, height: 22 }}
                      >
                        <div
                          className={`absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white shadow-md transition-transform ${enabled ? "left-[19px]" : "left-[3px]"}`}
                        />
                      </button>

                      <span
                        className={`text-sm w-12 shrink-0 ${enabled ? "text-zinc-100" : "text-zinc-600"}`}
                      >
                        {label}
                      </span>

                      {enabled ? (
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) =>
                            setWeekdaySlots({
                              ...weekdaySlots,
                              [idx]: { ...slot, time: e.target.value },
                            })
                          }
                          className="ml-auto px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/25 text-sm text-emerald-300 focus:outline-none focus:border-emerald-500/25 transition-all [color-scheme:dark]"
                        />
                      ) : (
                        <span className="ml-auto text-xs text-zinc-700">
                          Ngày nghỉ
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="hidden rounded-xl bg-emerald-950/20 border border-emerald-500/10 p-3.5 flex items-center gap-3">
              <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-200/70">
                <span className="text-emerald-300">
                  {Object.keys(weekdaySlots).length} ngày/tuần
                </span>{" "}
                →{" "}
                <span className="text-emerald-300">
                  {derivedMarkers.length} buổi
                </span>{" "}
                trong tháng 4/2026
              </p>
            </div>

            {/* ── Step 2: Exceptions ── */}
            <div className="hidden">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
                2 · Ngoại lệ{" "}
                <span className="normal-case text-zinc-700">
                  — bấm ngày để bỏ qua
                </span>
              </p>
              <div className="rounded-xl bg-zinc-800/20 border border-zinc-800/25 p-4">
                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {WD_LABELS.map((d) => (
                    <span
                      key={d}
                      className="text-[9px] text-zinc-700 uppercase tracking-wider"
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {(() => {
                    const cells: (number | null)[] = [];
                    for (let i = 0; i < FIRST_DAY_OFFSET; i++) cells.push(null);
                    for (let d = 1; d <= DAYS_IN_APRIL; d++) cells.push(d);
                    while (cells.length % 7 !== 0) cells.push(null);
                    return cells.map((day, i) => {
                      if (day === null) return <span key={`exc-e-${i}`} />;
                      const dow = (day + FIRST_DAY_OFFSET - 1) % 7;
                      const isScheduled = !!weekdaySlots[dow]?.enabled;
                      const isException = exceptions.has(day);
                      const isActive = isScheduled && !isException;
                      return (
                        <button
                          key={`exc-${day}`}
                          onClick={() => {
                            if (!isScheduled) return;
                            const next = new Set(exceptions);
                            if (isException) next.delete(day);
                            else next.add(day);
                            setExceptions(next);
                          }}
                          disabled={!isScheduled}
                          className={`w-full aspect-square rounded-lg text-[11px] transition-all ${
                            isException
                              ? "bg-red-500/10 text-red-400 border border-red-500/20 line-through"
                              : isActive
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 hover:bg-emerald-500/20"
                                : "text-zinc-700 cursor-default"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    });
                  })()}
                </div>
                {exceptions.size > 0 && (
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-[11px] text-red-400/60">
                      {exceptions.size} ngày bị bỏ qua
                    </p>
                    <button
                      onClick={() => setExceptions(new Set())}
                      className="text-[11px] text-zinc-500 hover:text-zinc-400 flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Xóa tất cả
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCalendarAdd(false)}
                className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateSchedule}
                disabled={savingSchedule || !currentProgram?.days?.length}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingSchedule ? "Đang lưu..." : "Lưu lịch tập"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ LOG METRIC MODAL ═══════════════ */}
      {showLogModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowLogModal(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg text-white">Ghi chỉ số</h2>
              <button
                onClick={() => setShowLogModal(false)}
                className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {/* Metric type selector */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">
                Loại chỉ số
              </p>
              <div className="grid grid-cols-2 gap-2">
                {metricOptions.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setLogMetric(m.key)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      logMetric === m.key
                        ? "border-opacity-30 bg-opacity-10"
                        : "border-zinc-800/30 bg-zinc-800/20 hover:border-zinc-700/40"
                    }`}
                    style={
                      logMetric === m.key
                        ? {
                            borderColor: m.color + "40",
                            backgroundColor: m.color + "10",
                          }
                        : {}
                    }
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      <span
                        className={`text-sm ${logMetric === m.key ? "text-zinc-100" : "text-zinc-400"}`}
                      >
                        {m.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600">
                      Hiện tại: {m.current}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Value input */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">
                Giá trị
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={logValue}
                  onChange={(e) => setLogValue(e.target.value)}
                  placeholder={`Nhập ${selectedLogMetric?.unit ?? ""}...`}
                  className="flex-1 px-5 py-4 rounded-xl bg-zinc-800/30 border border-zinc-700/25 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/25 focus:ring-1 focus:ring-emerald-500/10 transition-all"
                />
                <span className="text-sm text-zinc-500">
                  {selectedLogMetric?.unit}
                </span>
              </div>
              {!selectedLogMetric?.canPersist && (
                <p className="text-xs text-amber-300/80 mt-2">
                  Chỉ số này chưa có cột lưu trong InBody, nên không thể ghi vào
                  DB lúc này.
                </p>
              )}
            </div>

            {/* Auto-add chart toggle */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-400">
                Thêm biểu đồ vào Dashboard
              </span>
              <div
                className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                  activeCharts.has(logMetric)
                    ? "bg-emerald-500 border-emerald-500"
                    : "border-zinc-700 hover:border-zinc-600"
                }`}
              >
                {activeCharts.has(logMetric) && (
                  <Check className="w-3 h-3 text-black" />
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowLogModal(false)}
                className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveMetricLog}
                disabled={isSavingMetric || !selectedLogMetric?.canPersist}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingMetric ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══════════════ ADD EXERCISE FROM DB MODAL ═══════════════ */}
      {showAddExercise && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddExercise(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-700/30 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800/50 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {replaceExerciseIndex !== null
                      ? "Đổi bài tập"
                      : "Thêm bài tập"}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Dữ liệu lấy trực tiếp từ Exercise DB
                  </p>
                </div>
                {/* Roadmap P1.5 "Custom exercises". */}
                <button
                  type="button"
                  data-testid="create-custom-exercise-trigger"
                  onClick={() => setShowCreateCustomExercise(true)}
                  className="shrink-0 flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 px-3 py-2 rounded-lg border border-sky-500/25 bg-sky-500/10 hover:bg-sky-500/15 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Tạo bài tập tùy chỉnh
                </button>
                <button
                  onClick={() => setShowAddExercise(false)}
                  className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center hover:bg-zinc-700 transition-colors shrink-0"
                >
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  placeholder="Tìm bài tập..."
                  className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {MUSCLE_FILTERS.map((filter) => {
                  const active =
                    pickerBodyPart === filter.bodyPart &&
                    pickerMuscleGroup === filter.muscleGroup;
                  return (
                    <button
                      key={filter.label}
                      type="button"
                      onClick={() => {
                        setPickerBodyPart(filter.bodyPart);
                        setPickerMuscleGroup(filter.muscleGroup);
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                        active
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-zinc-700/50 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <label className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
                  </span>
                  <select
                    value={pickerEquipment}
                    onChange={(e) => setPickerEquipment(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"
                  >
                    <option value="">Tất cả thiết bị</option>
                    {(exerciseOptions.equipments || []).map(
                      (equipment: string) => (
                        <option key={equipment} value={equipment}>
                          {labelizeEnum(equipment)}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                <select
                  value={pickerActivityType}
                  onChange={(e) => setPickerActivityType(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"
                >
                  <option value="">Tất cả loại bài</option>
                  {(exerciseOptions.activityTypes || []).map(
                    (activity: string) => (
                      <option key={activity} value={activity}>
                        {labelizeEnum(activity)}
                      </option>
                    ),
                  )}
                </select>

                <select
                  value={pickerSort}
                  onChange={(e) =>
                    setPickerSort(
                      e.target.value as "name" | "bodyPart" | "equipment",
                    )
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"
                >
                  <option value="bodyPart">Sắp xếp theo nhóm cơ</option>
                  <option value="equipment">Sắp xếp theo thiết bị</option>
                  <option value="name">Sắp xếp A-Z</option>
                </select>

                <button
                  type="button"
                  onClick={clearExerciseFilters}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Xóa bộ lọc
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Roadmap P1.5 "Custom exercises" — always shown when the
                  owner has any, regardless of the catalog's own search/
                  filter state above (they're a separate query, never
                  filtered the same way — see the impact analysis's
                  disclosed simplification). */}
              {Array.isArray(myCustomExercisesQuery.data) && myCustomExercisesQuery.data.length > 0 && (
                <section data-testid="my-custom-exercises-section" className="space-y-2 mb-5">
                  <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm py-1 flex items-center gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-sky-300 font-semibold">
                      Của tôi
                    </div>
                    <div className="h-px flex-1 bg-zinc-800" />
                    <div className="text-[10px] text-zinc-500">
                      {myCustomExercisesQuery.data.length} bài
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {myCustomExercisesQuery.data.map((ex: any) => (
                      <div
                        key={ex.id}
                        data-testid={`my-custom-exercise-${ex.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleAddFromDB(ex)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") handleAddFromDB(ex);
                        }}
                        className="w-full text-left p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 hover:border-sky-500/40 transition-all flex items-center gap-4 group cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-200 truncate">{ex.exerciseName}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">
                              {labelizeEnum(ex.bodyPart)}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">
                              {labelizeEnum(ex.typeOfEquipment)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`archive-custom-exercise-${ex.id}`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await workoutService.archiveCustomExercise(ex.id);
                              await myCustomExercisesQuery.refetch();
                              toast.success("Đã lưu trữ bài tập tùy chỉnh.");
                            } catch (error: any) {
                              toast.error(error?.response?.data?.error || "Không thể lưu trữ bài tập này.");
                            }
                          }}
                          className="shrink-0 text-zinc-600 hover:text-amber-400 transition-colors"
                          aria-label={`Lưu trữ ${ex.exerciseName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <Plus className="w-4 h-4 text-sky-500/0 group-hover:text-sky-400 transition-colors shrink-0" />
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {dbLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <div
                      key={item}
                      className="h-20 rounded-xl border border-zinc-800/50 bg-zinc-800/20 animate-pulse"
                    />
                  ))}
                </div>
              ) : dbError ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-red-300">{dbError}</p>
                  <button
                    type="button"
                    onClick={() => void exercisesQuery.refetch()}
                    className="mt-3 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Thử lại
                  </button>
                </div>
              ) : sortedDbExercises.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-zinc-500">
                    Không tìm thấy bài tập phù hợp
                  </p>
                  <button
                    type="button"
                    onClick={clearExerciseFilters}
                    className="mt-3 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Xóa bộ lọc
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.entries(groupedDbExercises).map(
                    ([group, exercises]) => {
                      const groupExercises = exercises as any[];
                      return (
                        <section key={group} className="space-y-2">
                          <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm py-1 flex items-center gap-2">
                            <div className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold">
                              {group}
                            </div>
                            <div className="h-px flex-1 bg-zinc-800" />
                            <div className="text-[10px] text-zinc-500">
                              {groupExercises.length} bài
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {groupExercises.map((ex: any) => (
                              <button
                                key={ex.id}
                                onClick={() => handleAddFromDB(ex)}
                                className="w-full text-left p-3 rounded-xl border border-zinc-800/40 bg-zinc-800/20 hover:bg-zinc-800/60 hover:border-emerald-500/30 transition-all flex items-center gap-4 group"
                              >
                                <div className="w-14 h-14 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-zinc-700/50">
                                  <ExerciseFlipDemo
                                    img1={formatVideoUrlToImg(ex.videoUrl, 0)}
                                    img2={formatVideoUrlToImg(ex.videoUrl, 1)}
                                    alt={ex.exerciseName}
                                    className="w-full h-full"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-zinc-200 truncate">
                                    {ex.exerciseName}
                                  </p>
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">
                                      {labelizeEnum(ex.bodyPart)}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">
                                      {labelizeEnum(ex.typeOfEquipment)}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">
                                      {labelizeEnum(ex.typeOfActivity)}
                                    </span>
                                  </div>
                                  {Array.isArray(ex.muscleGroupsActivated) &&
                                    ex.muscleGroupsActivated.length > 0 && (
                                      <p className="mt-1.5 text-[10px] text-zinc-500 truncate">
                                        {ex.muscleGroupsActivated.join(", ")}
                                      </p>
                                    )}
                                </div>
                                <Plus className="w-4 h-4 text-emerald-500/0 group-hover:text-emerald-400 transition-colors shrink-0" />
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* Sub-components                         */
/* ═══════════════════════════════════════ */

function GlassPanel({
  title,
  icon,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/[0.02] rounded-full blur-[40px] pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="w-8 h-8 rounded-xl bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center">
                {icon}
              </div>
            )}
            <h3 className="text-sm text-zinc-100">{title}</h3>
          </div>
          {actionLabel && (
            <button
              onClick={onAction}
              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20"
            >
              <Plus className="w-3 h-3" /> {actionLabel}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionTitle({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-1 h-5 rounded-full bg-gradient-to-b from-emerald-400 to-green-600" />
      <h3 className="text-sm text-zinc-100">{title}</h3>
      {badge && (
        <span className="text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-md border border-zinc-700/25">
          {badge}
        </span>
      )}
    </div>
  );
}

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  last: "Mới nhất",
  week: "Tuần",
  month: "Tháng",
  all: "Tất cả",
};

function TimeFilterBar({
  value,
  onChange,
}: {
  value: TimeFilter;
  onChange: (v: TimeFilter) => void;
}) {
  return (
    <div className="flex bg-zinc-800/30 rounded-xl p-1 border border-zinc-700/20 w-fit mt-1">
      {(["last", "week", "month", "all"] as TimeFilter[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-4 py-1.5 rounded-lg text-xs transition-all ${
            value === v
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 shadow-[0_0_8px_rgba(16,185,129,0.06)]"
              : "text-zinc-500 hover:text-zinc-400 border border-transparent"
          }`}
        >
          {TIME_FILTER_LABELS[v]}
        </button>
      ))}
    </div>
  );
}

type CalendarDayInfo = {
  title: string;
  scheduleId: string;
  exerciseCount: number;
  programName?: string;
  sourceType?: string | null;
  status?: WorkoutScheduleRecord["status"];
  workoutId?: string | null;
  /** true when this day's calendar date is strictly before the user's
   * current local day (Asia/Ho_Chi_Minh) — read-only in the UI. This is a
   * client-side hint only; the backend independently enforces the same
   * rule on every mutating endpoint regardless of what the UI shows. */
  isLocked?: boolean;
};

function CalendarGrid({
  schedulesByDay,
  markers,
  month,
  onPrevMonth,
  onNextMonth,
  onDayClick,
}: {
  schedulesByDay?: Map<number, CalendarDayInfo[]>;
  markers?: number[]; // fallback: plain day markers
  month: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (day: number) => void;
}) {
  const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIdx, 1).getDay();
  const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const monthLabel = month.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayDate = new Date();
  const isCurrentMonth =
    todayDate.getFullYear() === year && todayDate.getMonth() === monthIdx;
  const todayDay = isCurrentMonth ? todayDate.getDate() : -1;
  // Locked-day styling uses the same Asia/Ho_Chi_Minh "today" label as the
  // backend lock check (not just browser-local today/month), so a day cell
  // never shows as unlocked when the corresponding schedule mutation would
  // actually be rejected server-side.
  const todayLabel = calendarDateLabel(new Date(), APP_SCHEDULE_TIME_ZONE);

  // Use schedulesByDay if available, else fall back to markers[]
  const hasSchedules = schedulesByDay && schedulesByDay.size > 0;
  const activeMarkers = markers ?? [];

  // Short title: truncate at first " + " or limit chars
  function shortTitle(title: string): string {
    const parts = title.split(/\s*\+\s*/);
    if (parts.length >= 2) return `${parts[0].trim()} + ${parts[1].trim()}`;
    return title.slice(0, 14);
  }

  return (
    <div>
      <div className="flex items-center justify-center gap-6 mb-4">
        <button
          onClick={onPrevMonth}
          aria-label="Tháng trước"
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-500" />
        </button>
        <span className="text-sm text-zinc-200 min-w-[120px] text-center">
          {monthLabel}
        </span>
        <button
          onClick={onNextMonth}
          aria-label="Tháng sau"
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {dayLabels.map((d) => (
          <span
            key={d}
            className="text-[10px] text-zinc-600 py-1 uppercase tracking-wider"
          >
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} className="h-[52px]" />;
          const dayInfos = hasSchedules ? (schedulesByDay!.get(day) ?? []) : [];
          const isTraining = hasSchedules
            ? dayInfos.length > 0
            : activeMarkers.includes(day);
          const isToday = day === todayDay;
          const firstInfo = dayInfos[0];
          const extraCount = dayInfos.length > 1 ? dayInfos.length - 1 : 0;
          // Locked and completed are independent booleans on purpose — a
          // past day can be both (completed AND now read-only) or locked
          // with nothing logged at all; collapsing them into one state
          // would lose real information the calendar needs to show.
          const cellDateLabel = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          // Locked in EITHER direction (only today is editable — see
          // schedule-lock.utils.ts); the "< todayLabel" past-only fallback
          // here previously diverged from that rule the same way the
          // now-fixed isScheduleDateApiValueLocked used to.
          const isLocked = hasSchedules
            ? dayInfos.some((info) => info.isLocked)
            : cellDateLabel !== todayLabel;
          const lockDirection: "past" | "future" | undefined = !isLocked
            ? undefined
            : cellDateLabel < todayLabel
              ? "past"
              : "future";
          const lockedReasonLabel = lockDirection === "future" ? "chưa đến ngày" : "ngày đã qua";
          const isCompleted = dayInfos.some((info) => info.status === "COMPLETED");

          return (
            <div
              key={`d-${day}`}
              onClick={() => onDayClick(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDayClick(day);
                }
              }}
              role="button"
              tabIndex={0}
              title={
                firstInfo
                  ? `${firstInfo.title}${firstInfo.exerciseCount ? ` · ${firstInfo.exerciseCount} bài` : ""}${firstInfo.programName ? `\n${firstInfo.programName}` : ""}${isLocked ? `\n(Đã khóa — ${lockedReasonLabel}, chỉ xem)` : ""}`
                  : isLocked
                    ? `${lockedReasonLabel === "chưa đến ngày" ? "Chưa đến ngày" : "Ngày đã qua"} — chỉ xem`
                    : undefined
              }
              aria-label={
                isTraining
                  ? `${firstInfo?.title ?? "Buổi tập"}, ngày ${day}${isLocked ? `, đã khóa vì ${lockedReasonLabel}` : ""}${isCompleted ? ", đã hoàn thành" : ""}`
                  : isToday
                    ? `Hôm nay, ngày ${day}`
                    : `Ngày ${day}`
              }
              className={`relative w-full h-[52px] flex flex-col items-center pt-1.5 rounded-xl text-xs transition-all cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 ${
                isTraining
                  ? isLocked
                    ? "bg-emerald-800/60 text-emerald-100/80 hover:bg-emerald-800/70"
                    : "bg-emerald-500 text-black shadow-[0_0_14px_rgba(16,185,129,0.3)] hover:bg-emerald-400"
                  : isToday
                    ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-400"
              }`}
            >
              {isLocked && (
                <Lock
                  aria-hidden="true"
                  className={`absolute top-1 right-1 w-2.5 h-2.5 ${isTraining ? "text-black/50" : "text-zinc-600"}`}
                />
              )}
              <span
                className={`text-[11px] font-medium leading-none ${isTraining ? (isLocked ? "text-emerald-50" : "text-black font-bold") : isToday ? "text-emerald-400" : ""}`}
              >
                {day}
              </span>
              {isTraining && firstInfo && (
                <span
                  className={`mt-[3px] text-[7px] leading-tight truncate w-full text-center px-0.5 ${isLocked ? "text-emerald-100/70" : "text-black/80"}`}
                >
                  {shortTitle(firstInfo.title)}
                </span>
              )}
              {isTraining && !firstInfo && (
                <span className="mt-[5px] block w-1.5 h-1.5 rounded-full bg-black/60 shadow-[0_0_4px_rgba(0,0,0,0.2)]" />
              )}
              {isCompleted && (
                <Check
                  aria-hidden="true"
                  className={`absolute bottom-1 left-1 w-2.5 h-2.5 ${isTraining ? "text-black/60" : "text-emerald-500"}`}
                />
              )}
              {extraCount > 0 && isTraining && (
                <span className="text-[6.5px] text-black/70 font-semibold leading-none mt-0.5">
                  +{extraCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
