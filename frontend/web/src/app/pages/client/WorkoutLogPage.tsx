import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dumbbell, ChevronLeft, ChevronRight, Plus, Lock,
  AlertCircle, Share2, Star, ArrowUpDown, ChevronDown,
  Minus, Clock, MessageSquare, Timer, Target, BarChart3,
  Zap, Calendar, TrendingUp, Play, GripVertical, Trash2,
  Check, X, SkipForward, Pause, RotateCcw, Trophy, PartyPopper,
  Search, SlidersHorizontal
} from "lucide-react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid
} from "recharts";
import { ImageWithFallback } from "../../components/figma/ImageWithFallback";
import { workoutService, inbodyService, type WorkoutScheduleRecord } from "../../services/api";

// Format helper
const formatVideoUrlToImg = (videoUrl: string | null | undefined, frame: 0 | 1) => {
  if (!videoUrl) return null;
  // If it's already a github raw url ending in .jpg, just replace the last part
  if (videoUrl.includes('yuhonas/free-exercise-db') && videoUrl.endsWith('.jpg')) {
    return videoUrl.replace(/\/[^\/]+$/, `/${frame}.jpg`);
  }
  return videoUrl; // Fallback
};

/* ───── ExerciseFlipDemo ─────
 * Animates between img1 (start position) and img2 (end position).
 * Both images come from yuhonas/free-exercise-db GitHub raw content.
 * Falls back gracefully if either image fails to load.
 */
function ExerciseFlipDemo({ img1, img2, alt, className = "" }: {
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
      <div className={`relative flex items-center justify-center bg-zinc-900/60 border border-zinc-800/30 rounded-2xl overflow-hidden ${className}`}>
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
          <span className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${!showSecond ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${showSecond ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        </div>
      )}
    </div>
  );
}

/* ───── Data ───── */
const heroImg = "https://images.unsplash.com/photo-1628935291759-bbaf33a66dc6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxneW0lMjB3b3Jrb3V0JTIwbXVzY2xlJTIwdHJhaW5pbmclMjBkYXJrfGVufDF8fHx8MTc3NjA2NjY0NHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

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
  { label: "Full Body", bodyPart: "FULL_BODY", muscleGroup: "" },
];

function labelizeEnum(value?: string | null) {
  if (!value) return "--";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
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
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function toApiDateTime(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
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

function mapProgramExercise(ex: any) {
  const exercise = ex.exercise || {};
  return {
    id: ex.id,
    programExerciseId: ex.id,
    dbId: ex.exerciseId || exercise.id,
    name: exercise.exerciseName || "Bài tập",
    prescription: `${ex.sets ?? 3}×${ex.reps ?? 10}${ex.restSeconds ? ` · nghỉ ${ex.restSeconds}s` : ""}`,
    sets: ex.sets ?? 3,
    reps: ex.reps ?? 10,
    restSeconds: ex.restSeconds ?? 90,
    notes: ex.notes ?? "",
    img: formatVideoUrlToImg(exercise.videoUrl, 0),
    img2: formatVideoUrlToImg(exercise.videoUrl, 1),
    type: (exercise.typeOfActivity === "CARDIO" ? "cardio" : "strength") as "cardio" | "strength",
    bodyPart: exercise.bodyPart,
    equipment: exercise.typeOfEquipment,
    activityType: exercise.typeOfActivity,
    movementType: exercise.type,
    description: exercise.instructions,
    muscles: exercise.muscleGroupsActivated || [],
    tips: [],
  };
}

const weightData = [
  { week: "W1", kg: 80 }, { week: "W2", kg: 79.5 }, { week: "W3", kg: 79.2 },
  { week: "W4", kg: 78.8 }, { week: "W5", kg: 78.5 }, { week: "W6", kg: 78.3 },
  { week: "W7", kg: 78.1 }, { week: "W8", kg: 78 },
];

const muscleChartData = [
  { name: "Chest", value: 25, color: "#22c55e" },
  { name: "Back", value: 22, color: "#2dd4bf" },
  { name: "Legs", value: 20, color: "#a3e635" },
  { name: "Shoulders", value: 15, color: "#34d399" },
  { name: "Arms", value: 12, color: "#86efac" },
  { name: "Core", value: 6, color: "#5eead4" },
];

const exerciseTypeData = [
  { name: "Compound", value: 45, color: "#22c55e" },
  { name: "Isolation", value: 30, color: "#2dd4bf" },
  { name: "Cardio", value: 15, color: "#a3e635" },
  { name: "Stretch", value: 10, color: "#86efac" },
];

const DAYS_IN_APRIL = 30;
const FIRST_DAY_OFFSET = 2;
const trainingMarkers = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 29];


const bodyFatData = [
  { week: "W1", pct: 18.5 }, { week: "W2", pct: 18.3 }, { week: "W3", pct: 18.0 },
  { week: "W4", pct: 17.8 }, { week: "W5", pct: 17.5 }, { week: "W6", pct: 17.2 },
  { week: "W7", pct: 17.0 }, { week: "W8", pct: 16.8 },
];
const muscleMassData = [
  { week: "W1", kg: 35.2 }, { week: "W2", kg: 35.4 }, { week: "W3", kg: 35.5 },
  { week: "W4", kg: 35.7 }, { week: "W5", kg: 35.9 }, { week: "W6", kg: 36.0 },
  { week: "W7", kg: 36.2 }, { week: "W8", kg: 36.4 },
];
const waterData = [
  { week: "W1", pct: 55 }, { week: "W2", pct: 56 }, { week: "W3", pct: 55.5 },
  { week: "W4", pct: 56.5 }, { week: "W5", pct: 57 }, { week: "W6", pct: 56.8 },
  { week: "W7", pct: 57.2 }, { week: "W8", pct: 57.5 },
];

const metricOptions = [
  { key: "weight", label: "Cân nặng", unit: "kg", color: "#10b981", current: "78 kg", target: "75 kg", data: weightData, dataKey: "kg", domain: [76, 82] },
  { key: "bodyfat", label: "Mỡ cơ thể", unit: "%", color: "#f59e0b", current: "16.8%", target: "15%", data: bodyFatData, dataKey: "pct", domain: [15, 20] },
  { key: "muscle", label: "Cơ bắp", unit: "kg", color: "#3b82f6", current: "36.4 kg", target: "38 kg", data: muscleMassData, dataKey: "kg", domain: [34, 38] },
  { key: "water", label: "Nước cơ thể", unit: "%", color: "#06b6d4", current: "57.5%", target: "60%", data: waterData, dataKey: "pct", domain: [53, 60] },
] as const;

type Tab = "overview" | "plan";
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
  noWeight: boolean;
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

function buildManualDays(daysPerWeek: number, previous: ManualBuilderDay[] = []) {
  return Array.from({ length: daysPerWeek }, (_, index) => {
    const previousDay = previous[index];
    return {
      dayNumber: index + 1,
      title: previousDay?.title || `Buổi ${index + 1}`,
      exercises: previousDay?.exercises || [],
    };
  });
}

function exerciseUsesExternalWeight(exercise: any) {
  if (exercise?.type === "cardio") return false;
  const equipment = String(exercise?.equipment || "").toUpperCase();
  if (!equipment) return true;
  return !["BODYWEIGHT", "FOAM_ROLLER", "RESISTANCE_BAND"].includes(equipment);
}

function scheduleProgressPercent(schedule?: WorkoutScheduleRecord | null) {
  if (!schedule) return 0;
  if (schedule.status === "COMPLETED" || schedule.workoutId || schedule.workout?.id) return 100;
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

const WD_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const derivedMarkers: number[] = [];
const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

export function WorkoutLogPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [muscleFilter, setMuscleFilter] = useState<TimeFilter>("week");
  const [exerciseFilter, setExerciseFilter] = useState<TimeFilter>("week");
  const [planView, setPlanView] = useState<PlanView>("main");
  const [selectedDay, setSelectedDay] = useState(1);
  const [dayExercises, setDayExercises] = useState<any[]>([]);
  const currentWorkoutIdRef = useRef<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showOnOverview, setShowOnOverview] = useState(true);
  const [showAllPrograms, setShowAllPrograms] = useState(false);
  const [autoSchedule, setAutoSchedule] = useState(true);
  const [editableSchedule, setEditableSchedule] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<"day" | "cycle">("cycle");
  const [consecutiveTrain, setConsecutiveTrain] = useState(3);
  const [consecutiveRest, setConsecutiveRest] = useState(1);
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [selectedExercise, setSelectedExercise] = useState<any | null>(null);
  const selectedProgramDayIdRef = useRef<string | null>(null);

  // Dynamic Navigation & Stats
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [latestInBody, setLatestInBody] = useState<any>(null);
  const [workoutStats, setWorkoutStats] = useState<any>(null);
  const [currentProgram, setCurrentProgram] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [daysSinceInBody, setDaysSinceInBody] = useState<number | null>(null);
  const workoutCacheRef = useRef<Record<string, any>>({});
  const [aiSchedules, setAiSchedules] = useState<WorkoutScheduleRecord[]>([]);
  // Track the actual calendar date being edited (not the plan day number)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const handlePrevMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  // Fetch initial workout and stats from DB
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        const { inbodyService, profileService } = await import("../../services/api");
        const [historyResult, inbodyResult, statsResult, schedulesResult, programResult, profileResult] = await Promise.allSettled([
          workoutService.getHistory(1, 50), // Fetch last 50 workouts to fill cache
          inbodyService.getLatest(),
          workoutService.getStats(),
          workoutService.getSchedules(100, getMonthRange(calendarMonth)),
          workoutService.getCurrentProgram(),
          profileService.getProfile(),
        ]);

        if (programResult.status === 'fulfilled') {
          setCurrentProgram(programResult.value);
        }
        if (profileResult.status === 'fulfilled') {
          setUserProfile(profileResult.value?.profile ?? profileResult.value);
        }

        // 1. Build Workout Cache
        const cache: Record<string, any> = {};
        const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
        if (history && Array.isArray(history)) {
          history.forEach((w: any) => {
            const d = new Date(w.date).toDateString();
            cache[d] = w;
          });
        }
        workoutCacheRef.current = cache;

        // 2. Set current day exercises from cache if exists
        const todayStr = new Date().toDateString();
        if (cache[todayStr]) {
          const latest = cache[todayStr];
          currentWorkoutIdRef.current = latest.id;
          const mapped = latest.exercises.map((we: any) => ({
            id: we.id,
            dbId: we.exerciseId,
            name: we.exercise.exerciseName,
            prescription: `${we.sets}×${we.reps || 10}${we.weight ? '×' + we.weight + ' kg' : ''}`,
            img: formatVideoUrlToImg(we.exercise.videoUrl, 0),
            img2: formatVideoUrlToImg(we.exercise.videoUrl, 1),
            type: (we.exercise.typeOfActivity === "CARDIO" ? "cardio" : "strength") as "cardio" | "strength",
            description: we.exercise.instructions,
            muscles: we.exercise.muscleGroupsActivated || [],
            tips: [],
          }));
          setDayExercises(mapped);
        } else {
          // Fallback if no workout for today
          setDayExercises([]);
        }

        // 3. InBody Stats
        const inbody = inbodyResult.status === 'fulfilled' ? inbodyResult.value : null;
        if (inbody && inbody.createdAt) {
          setLatestInBody(inbody);
          const diff = Math.floor((Date.now() - new Date(inbody.createdAt).getTime()) / (1000 * 60 * 60 * 24));
          setDaysSinceInBody(diff);
        }
        setWorkoutStats(statsResult.status === 'fulfilled' ? statsResult.value : null);
        const schedules = schedulesResult.status === 'fulfilled' ? schedulesResult.value : [];
        setAiSchedules(Array.isArray(schedules) ? schedules : []);
      } catch (err) {
        console.error("Failed to fetch all data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, [calendarMonth]);


  // Calendar schedule modal
  const [showCalendarAdd, setShowCalendarAdd] = useState(false);
  const [scheduleDateInput, setScheduleDateInput] = useState(() => toDateInputValue(new Date()));
  const [scheduleProgramDayId, setScheduleProgramDayId] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  type WeekdaySlot = { enabled: boolean; time: string };
  const [weekdaySlots, setWeekdaySlots] = useState<Record<number, WeekdaySlot>>({
    1: { enabled: true, time: "07:00" },
    3: { enabled: true, time: "07:00" },
    5: { enabled: true, time: "09:00" },
  });
  const [exceptions, setExceptions] = useState<Set<number>>(new Set());
  const [showManualBuilder, setShowManualBuilder] = useState(false);
  const [savingManualProgram, setSavingManualProgram] = useState(false);
  const [manualProgramName, setManualProgramName] = useState("Chương trình thủ công");
  const [manualDurationWeeks, setManualDurationWeeks] = useState("4");
  const [manualStartDate, setManualStartDate] = useState(() => toDateInputValue(new Date()));
  const [manualDaysPerWeek, setManualDaysPerWeek] = useState(3);
  const [manualSelectedWeekdays, setManualSelectedWeekdays] = useState<number[]>(DEFAULT_MANUAL_WEEKDAYS[3]);
  const [manualDays, setManualDays] = useState<ManualBuilderDay[]>(() => buildManualDays(3));
  const manualEditingDayIndexRef = useRef<number | null>(null);

  // Build per-day schedule info for the calendar
  const schedulesByDay = (() => {
    const map = new Map<number, CalendarDayInfo[]>();
    try {
      for (const s of (aiSchedules || [])) {
        const d = parseApiDateOnly(s.date);
        if (isNaN(d.getTime())) continue;
        if (d.getFullYear() !== calendarMonth.getFullYear() || d.getMonth() !== calendarMonth.getMonth()) continue;
        const day = d.getDate();
        const rawTitle = s.programDay?.title || '';
        const dayTitle = rawTitle || `Buổi tập ${s.programDay?.dayNumber ?? ''}`.trim() || 'Buổi tập';
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
        });
        map.set(day, list);
      }
    } catch { /* keep empty map */ }
    return map;
  })();

  // Fallback flat markers for backward compat
  const calendarMarkers = Array.from(schedulesByDay.keys()).sort((a, b) => a - b);

  // Log modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [logMetric, setLogMetric] = useState<"weight" | "bodyfat" | "muscle" | "water">("weight");
  const [logValue, setLogValue] = useState("");
  const [activeCharts, setActiveCharts] = useState<Set<string>>(new Set(["weight"]));

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editExercises, setEditExercises] = useState<any[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const [prevCurrentProgramSync, setPrevCurrentProgramSync] = useState(currentProgram);
  const [prevSelectedDaySync, setPrevSelectedDaySync] = useState(selectedDay);
  if (prevCurrentProgramSync !== currentProgram || prevSelectedDaySync !== selectedDay) {
    setPrevCurrentProgramSync(currentProgram);
    const programDays = currentProgram?.days;
    if (!Array.isArray(programDays) || programDays.length === 0) {
      selectedProgramDayIdRef.current = null;
      setPrevSelectedDaySync(selectedDay);
    } else {
      const selected = programDays.find((day: any) => day.dayNumber === selectedDay) || programDays[0];
      setPrevSelectedDaySync(selected.dayNumber);
      setSelectedDay(selected.dayNumber);
      selectedProgramDayIdRef.current = selected.id;
      setDayExercises((selected.exercises || []).map(mapProgramExercise));
      setEditExercises((selected.exercises || []).map(mapProgramExercise));
    }
  }

  const refetchProgramAndSchedules = useCallback(async () => {
    const [program, schedules] = await Promise.all([
      workoutService.getCurrentProgram(),
      workoutService.getSchedules(100, getMonthRange(calendarMonth)),
    ]);
    setCurrentProgram(program);
    setAiSchedules(Array.isArray(schedules) ? schedules : []);
  }, [calendarMonth]);

  const findScheduleForDate = useCallback((date: Date) => {
    return aiSchedules.find((schedule) => isSameCalendarDay(parseApiDateOnly(schedule.date), date)) || null;
  }, [aiSchedules]);

  const selectedSchedule = useCallback(() => {
    if (selectedScheduleId) {
      const byId = aiSchedules.find((schedule) => schedule.id === selectedScheduleId);
      if (byId) return byId;
    }
    return findScheduleForDate(selectedDate);
  }, [aiSchedules, findScheduleForDate, selectedDate, selectedScheduleId]);

  const openScheduleModal = useCallback((date = selectedDate) => {
    setScheduleDateInput(toDateInputValue(date));
    const firstDay = currentProgram?.days?.[0];
    setScheduleProgramDayId((prev) => prev || firstDay?.id || "");
    setScheduleNotes("");
    setShowCalendarAdd(true);
  }, [currentProgram, selectedDate]);

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
      toast.success(result?.alreadyExists ? "Ngày này đã có lịch tập." : "Đã thêm lịch tập.");
    } catch (error: any) {
      const message = error?.response?.status === 409
        ? "Ngày này đã có lịch tập."
        : error?.response?.data?.error || "Không thể thêm lịch tập. Vui lòng thử lại.";
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
    if (!Number.isFinite(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
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
      toast.success(`Đã tạo chương trình thủ công với ${result?.createdScheduleCount ?? 0} lịch tập`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể tạo chương trình thủ công");
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

  const handleSaveWorkout = async (silent = false) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (selectedProgramDayIdRef.current && currentProgram) {
        if (editExercises.length === 0) {
          throw new Error("Mỗi ngày tập cần ít nhất 1 bài tập.");
        }
        const existingIds = new Set(
          (currentProgram.days || [])
            .flatMap((day: any) => (day.exercises || []).map((exercise: any) => exercise.id)),
        );

        const savePayloads = editExercises.map((ex, index) => {
          const payload = {
            exerciseId: ex.dbId,
            order: index + 1,
            sets: Number(ex.sets) || 3,
            reps: Number(ex.reps) || 10,
            restSeconds: Number(ex.restSeconds) || 90,
            notes: ex.notes || null,
          };
          if (!payload.exerciseId) {
            throw new Error(`Exercise "${ex.name}" does not have a database ID.`);
          }
          return { ex, payload };
        });
        await Promise.all(savePayloads.map(({ ex, payload }) =>
          ex.programExerciseId && existingIds.has(ex.programExerciseId)
            ? workoutService.updateProgramExercise(ex.programExerciseId, payload)
            : workoutService.addProgramExercise(selectedProgramDayIdRef.current!, payload),
        ));

        const editedIds = new Set(editExercises.flatMap((ex) => ex.programExerciseId ? [ex.programExerciseId] : []));
        const selectedDayModel = (currentProgram.days || []).find((day: any) => day.id === selectedProgramDayIdRef.current);
        const toDelete = (selectedDayModel?.exercises || []).filter((e: any) => !editedIds.has(e.id));
        await Promise.all(toDelete.map((e: any) => workoutService.deleteProgramExercise(e.id)));

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
          if (!exerciseId || exerciseId.startsWith('seed')) {
             throw new Error(`Exercise "${ex.name}" does not have a valid database ID. Please remove and re-add it from the search list.`);
          }
          return {
            exerciseId: exerciseId,
            sets: 3,
            reps: 10,
            weight: 0,
          };
        })
      };

      if (currentWorkoutIdRef.current) {
        await workoutService.updateWorkout(currentWorkoutIdRef.current, payload);
      } else {
        const res = await workoutService.logWorkout(payload);
        if (res && res.id) {
          currentWorkoutIdRef.current = res.id;
          // Update cache with the new workout
          const dStr = saveDate.toDateString();
          workoutCacheRef.current = { ...workoutCacheRef.current, [dStr]: { ...res, exercises: editExercises.map(e => ({ ...e, exercise: { exerciseName: e.name, videoUrl: e.img, instructions: e.description, muscleGroupsActivated: e.muscles } })) } };
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
  const handleSaveWorkoutRef = useRef(handleSaveWorkout);
  handleSaveWorkoutRef.current = handleSaveWorkout;
  useEffect(() => {
    if (editMode && editExercises.length > 0) {
      const timer = setTimeout(() => {
        handleSaveWorkoutRef.current(true); // silent save
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [editExercises, editMode]);

  // Active workout state
  const [activeExIdx, setActiveExIdx] = useState(0);
  const [completedExercises, setCompletedExercises] = useState<Set<number>>(new Set());
  const [activeExerciseLogs, setActiveExerciseLogs] = useState<Record<number, ActiveExerciseLog>>({});
  const [isCompletingWorkout, setIsCompletingWorkout] = useState(false);
  const [showExerciseDetail, setShowExerciseDetail] = useState<any | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [restTimerRunning, setRestTimerRunning] = useState(false);
  const [restSeconds, setRestSeconds] = useState(90);
  const [showCompletion, setShowCompletion] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Add Exercise Modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [debouncedDbSearch, setDebouncedDbSearch] = useState("");
  const [replacingExercise, setReplacingExercise] = useState(false);
  const [exerciseOptions, setExerciseOptions] = useState<any>({});
  const [pickerBodyPart, setPickerBodyPart] = useState("");
  const [pickerMuscleGroup, setPickerMuscleGroup] = useState("");
  const [pickerEquipment, setPickerEquipment] = useState("");
  const [pickerActivityType, setPickerActivityType] = useState("");
  const [pickerSort, setPickerSort] = useState<"name" | "bodyPart" | "equipment">("bodyPart");
  const [replaceExerciseIndex, setReplaceExerciseIndex] = useState<number | null>(null);

  const [prevPlanView, setPrevPlanView] = useState<PlanView>(planView);
  if (prevPlanView !== planView) {
    setPrevPlanView(planView);
    if (planView !== "activeExercise") {
      setActiveExIdx(0);
      setCompletedExercises(new Set());
      setTimerRunning(false);
      setTimerSeconds(0);
      setRestTimerRunning(false);
      setShowCompletion(false);
      setActiveExerciseLogs({});
      setIsCompletingWorkout(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDbSearch(dbSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [dbSearch]);

  useEffect(() => {
    if (!showAddExercise) return;
    workoutService.getExerciseFilterOptions()
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
    manualEditingDayIndexRef.current = null;
    clearExerciseFilters();
    setShowManualBuilder(true);
  }, [clearExerciseFilters]);

  const updateManualDaysPerWeek = useCallback((nextDaysPerWeek: number) => {
    setManualDaysPerWeek(nextDaysPerWeek);
    setManualSelectedWeekdays(DEFAULT_MANUAL_WEEKDAYS[nextDaysPerWeek]);
    setManualDays((previous) => buildManualDays(nextDaysPerWeek, previous));
  }, []);

  const toggleManualWeekday = useCallback((weekday: number) => {
    setManualSelectedWeekdays((previous) => {
      if (previous.includes(weekday)) {
        return previous.filter((item) => item !== weekday);
      }
      if (previous.length >= manualDaysPerWeek) {
        toast.error(`Chỉ chọn ${manualDaysPerWeek} ngày tập trong tuần`);
        return previous;
      }
      return MANUAL_WEEKDAYS.flatMap((option) => [...previous, weekday].includes(option.value) ? [option.value] : []);
    });
  }, [manualDaysPerWeek]);

  const preselectExerciseFilter = useCallback((exercise: any) => {
    setDbSearch("");
    setPickerEquipment("");
    setPickerActivityType("");
    const muscles = Array.isArray(exercise?.muscles) ? exercise.muscles.map((m: string) => m.toLowerCase()) : [];
    if (exercise?.bodyPart === "CORE" || muscles.includes("abdominals")) {
      setPickerBodyPart("CORE");
      setPickerMuscleGroup("");
    } else if (exercise?.bodyPart === "LOWER_BODY" || muscles.some((m: string) => ["quadriceps", "hamstrings", "glutes", "calves"].includes(m))) {
      setPickerBodyPart("LOWER_BODY");
      setPickerMuscleGroup("");
    } else if (muscles.includes("chest")) {
      setPickerBodyPart("");
      setPickerMuscleGroup("chest");
    } else if (muscles.some((m: string) => ["lats", "middle back", "lower back", "traps"].includes(m))) {
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

  const { data: exercisesData, isError: exercisesIsError, isFetching: exercisesIsFetching, refetch: exercisesRefetch } = useQuery({
    queryKey: ["exercises", debouncedDbSearch, pickerBodyPart, pickerMuscleGroup, pickerEquipment, pickerActivityType, 1],
    queryFn: () => workoutService.getExercises({
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

  const dbError = exercisesIsError ? "Không tải được danh sách bài tập" : null;
  const dbExercises: any[] = exercisesIsError ? [] : (Array.isArray(exercisesData) ? exercisesData : []);
  const dbLoading = exercisesIsFetching || replacingExercise;

  const sortedDbExercises = dbExercises.toSorted((a, b) => {
    if (pickerSort === "bodyPart") {
      return String(a.bodyPart || "").localeCompare(String(b.bodyPart || "")) || String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""));
    }
    if (pickerSort === "equipment") {
      return String(a.typeOfEquipment || "").localeCompare(String(b.typeOfEquipment || "")) || String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""));
    }
    return String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""));
  });

  const groupedDbExercises = sortedDbExercises.reduce((groups: Record<string, any[]>, exercise) => {
    const key = pickerSort === "equipment" ? groupTitle(exercise.typeOfEquipment) : groupTitle(exercise.bodyPart);
    groups[key] = groups[key] || [];
    groups[key].push(exercise);
    return groups;
  }, {});

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
      type: (dbEx.typeOfActivity === "CARDIO" ? "cardio" : "strength") as "cardio"|"strength",
      bodyPart: dbEx.bodyPart,
      equipment: dbEx.typeOfEquipment,
      activityType: dbEx.typeOfActivity,
      movementType: dbEx.type,
      description: dbEx.instructions,
      muscles: dbEx.muscleGroupsActivated || [],
      tips: [],
    };
    if (showManualBuilder && manualEditingDayIndexRef.current !== null) {
      setManualDays((previous) => previous.map((day, index) => {
        if (index !== manualEditingDayIndexRef.current) return day;
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
      }));
      setShowAddExercise(false);
      return;
    }
    if (replaceExerciseIndex !== null) {
      const next = [...editExercises];
      const existing = next[replaceExerciseIndex];
      if (existing?.programExerciseId) {
        setReplacingExercise(true);
        try {
          await workoutService.updateProgramExercise(existing.programExerciseId, { exerciseId: dbEx.id });
          next[replaceExerciseIndex] = { ...newEx, id: existing.id, programExerciseId: existing.programExerciseId };
          setEditExercises(next);
          setDayExercises(next);
          await refetchProgramAndSchedules();
          toast.success("Đã đổi bài tập");
        } catch (error) {
          console.error("Failed to replace exercise:", error);
          toast.error("Không thể đổi bài tập. Vui lòng thử lại.");
          setReplacingExercise(false);
          return;
        } finally {
          setReplacingExercise(false);
        }
      } else {
        next[replaceExerciseIndex] = { ...newEx, id: existing?.id, programExerciseId: existing?.programExerciseId };
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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Rest timer effect
  useEffect(() => {
    if (restTimerRunning && restSeconds > 0) {
      restRef.current = setInterval(() => setRestSeconds((s) => s - 1), 1000);
    } else {
      if (restRef.current) clearInterval(restRef.current);
      if (restTimerRunning && restSeconds <= 0) setRestTimerRunning(false);
    }
    return () => { if (restRef.current) clearInterval(restRef.current); };
  }, [restTimerRunning, restSeconds]);

  const fireConfetti = useCallback(() => {
    const duration = 4000;
    const end = Date.now() + duration;
    const colors = ["#10b981", "#22c55e", "#a3e635", "#34d399", "#6ee7b7", "#ffffff"];
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    // Big burst first
    confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors, scalar: 1.2 });
    frame();
  }, []);

  const persistCompletedWorkout = async () => {
    const scheduleForSave = selectedSchedule();
    const saveDate = scheduleForSave?.date ? parseApiDateOnly(scheduleForSave.date) : selectedDate;
    const scheduleWorkoutId = scheduleForSave?.workoutId || scheduleForSave?.workout?.id || null;
    const scheduleId = selectedScheduleId || scheduleForSave?.id || undefined;
    const payload = {
      scheduleId,
      name: `Workout for ${saveDate.toLocaleDateString()}`,
      date: toApiDateTime(saveDate),
      duration: Math.max(1, Math.ceil(timerSeconds / 60)),
      exercises: dayExercises.map((exercise, index) => {
        const log = activeExerciseLogs[index];
        const weight = log?.noWeight ? undefined : Number(log?.weightKg);
        return {
          exerciseId: exercise.dbId,
          sets: Number(exercise.sets) || 1,
          reps: Number(exercise.reps) || undefined,
          duration: exercise.type === "cardio" ? Number(exercise.duration) || undefined : undefined,
          weight: Number.isFinite(weight) ? weight : undefined,
          notes: log?.noWeight ? "Không dùng tạ" : undefined,
        };
      }),
    };

    const workoutIdForSave = currentWorkoutIdRef.current || scheduleWorkoutId;
    const saved = workoutIdForSave
      ? await workoutService.updateWorkout(workoutIdForSave, payload)
      : await workoutService.logWorkout(payload);
    if (scheduleId) setSelectedScheduleId(scheduleId);
    if (saved?.id) currentWorkoutIdRef.current = saved.id;
    await refetchProgramAndSchedules();
  };

  const handleCompleteExercise = async () => {
    const currentLog = activeExerciseLogs[activeExIdx];
    const needsWeight = exerciseUsesExternalWeight(dayExercises[activeExIdx]);
    if (needsWeight && !currentLog?.noWeight) {
      const weight = Number(currentLog?.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        toast.error("Vui lòng nhập tổng số kg tạ cho bài này hoặc chọn Không dùng tạ.");
        return;
      }
    }

    const newCompleted = new Set(completedExercises);
    newCompleted.add(activeExIdx);
    setCompletedExercises(newCompleted);
    setTimerRunning(false);
    setTimerSeconds(0);

    if (newCompleted.size === dayExercises.length) {
      setIsCompletingWorkout(true);
      try {
        await persistCompletedWorkout();
        setShowCompletion(true);
        setTimeout(() => fireConfetti(), 300);
        toast.success("Đã lưu hoàn thành buổi tập.");
      } catch (error: any) {
        toast.error(error?.response?.data?.error || "Không thể lưu buổi tập đã hoàn thành.");
        setCompletedExercises(completedExercises);
      } finally {
        setIsCompletingWorkout(false);
      }
    } else if (activeExIdx < dayExercises.length - 1) {
      // Start rest timer then move to next
      setRestSeconds(90);
      setRestTimerRunning(true);
      setActiveExIdx(prev => prev + 1);
    }
  };

  const handleSkipExercise = () => {
    setTimerRunning(false);
    setTimerSeconds(0);
    if (activeExIdx < dayExercises.length - 1) {
      setActiveExIdx(prev => prev + 1);
    }
  };


  const profileGoal = userProfile?.goal;
  const programGoal = currentProgram?.goal;
  const hasGoalMismatch = Boolean(profileGoal && programGoal && profileGoal !== programGoal);

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
                <h1 className="text-2xl text-white tracking-tight">Workout Log</h1>
                <p className="text-zinc-500 text-sm">Lên kế hoạch và theo dõi quá trình tập luyện</p>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            {[
              { label: "Kế hoạch", value: currentProgram?.name || "Chưa có", icon: Zap },
              { label: "Tuần này", value: `${workoutStats?.weeklyWorkouts || 0} / ${currentProgram?.daysPerWeek || 0} buổi`, icon: Calendar },
              { label: "Streak", value: "0 ngày", icon: TrendingUp },
            ].map((s) => (
              <div key={s.label} className="px-4 py-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800/50 min-w-[130px]">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <s.icon className="w-3 h-3 text-emerald-500/60" />
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{s.label}</span>
                </div>
                <p className="text-sm text-zinc-300">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800/40 p-1 rounded-2xl w-fit">
        {(["overview", "plan"] as Tab[]).map((t) => (
          <button
            type="button"
                        key={t}
            onClick={() => { setTab(t); setPlanView("main"); }}
            className={`px-8 py-2.5 rounded-xl text-sm transition-all ${
              tab === t
                ? "bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
            }`}
          >
            {t === "overview" ? "Tổng quan" : "Kế hoạch tập"}
          </button>
        ))}
      </div>

      {/* ═══════════════ OVERVIEW ═══════════════ */}
      {hasGoalMismatch && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-200">Lịch tập chưa đồng bộ với mục tiêu mới</p>
              <p className="text-xs text-amber-100/70 mt-1">
                Mục tiêu hồ sơ của bạn đã đổi sang {goalLabel(profileGoal)}, nhưng lịch tập hiện tại vẫn là {goalLabel(programGoal)}.
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
                            onClick={() => navigate(`/client/plans?goal=${encodeURIComponent(profileGoal || "")}`)}
              className="px-3 py-2 rounded-xl bg-amber-400 text-black text-xs font-semibold hover:bg-amber-300 transition-colors"
            >
              Cập nhật lịch theo mục tiêu mới
            </button>
            <button type="button" className="px-3 py-2 rounded-xl border border-amber-500/25 text-amber-200 text-xs hover:bg-amber-500/10 transition-colors">
              Giữ lịch hiện tại
            </button>
          </div>
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-6">
          {/* Reminder - Only show if > 7 days or no data */}
          {(daysSinceInBody === null || daysSinceInBody > 7) && (
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/12 bg-gradient-to-r from-emerald-950/30 via-emerald-950/15 to-transparent p-5">
              <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/[0.04] rounded-full blur-[60px]" />
              <div className="relative flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-emerald-100/90">Đã đến lúc cập nhật chỉ số cơ thể</p>
                  <p className="text-xs text-emerald-500/40 mt-0.5">
                    {daysSinceInBody !== null
                      ? `Cập nhật ${daysSinceInBody} ngày trước · Nên quét InBody`
                      : "Chưa có dữ liệu InBody · Bắt đầu bằng cách tải ảnh lên"}
                  </p>
                </div>
                <button type="button" 
                  onClick={() => setShowLogModal(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/15 text-xs text-emerald-300 hover:bg-emerald-500/15 transition-all shrink-0"
                >
                  Cập nhật ngay
                </button>
              </div>
            </div>
          )}

          {/* Hero + Upcoming */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 group relative rounded-2xl overflow-hidden border border-zinc-700/25 h-64">
              <img src={heroImg} alt="Training" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/25" />
              <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/20 via-transparent to-transparent" />
              <div className="absolute top-4 right-4 flex gap-2">
                <span className="px-3 py-1.5 rounded-xl bg-amber-500/12 border border-amber-500/20 text-[11px] text-amber-300 backdrop-blur-md flex items-center gap-1.5">
                  <Star className="w-3 h-3" /> 4.8
                </span>
                <span className="px-3 py-1.5 rounded-xl bg-emerald-500/12 border border-emerald-500/20 text-[11px] text-emerald-300 backdrop-blur-md">
                  At Gym
                </span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <span className="text-[10px] text-emerald-400/60 uppercase tracking-[0.2em] mb-1.5 block">Chương trình hiện tại</span>
                <h2 className="text-2xl text-white mb-2 tracking-tight">{currentProgram ? currentProgram.name : "Chưa có chương trình"}</h2>
                {hasGoalMismatch && (
                  <div className="mb-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 inline-block">
                    <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3 h-3" />
                      Mục tiêu trong Hồ sơ ({goalLabel(userProfile.goal)}) khác với Chương trình hiện tại ({goalLabel(currentProgram.goal)})
                    </p>
                  </div>
                )}
                {currentProgram && (
                  <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-zinc-600" /> {currentProgram.durationWeeks || 4} tuần</span>
                    <span className="text-zinc-700">·</span>
                    <span>{currentProgram.daysPerWeek || workoutStats?.workoutsPerWeek || 3} buổi/tuần</span>
                    <span className="text-zinc-700">·</span>
                    {currentProgram.sourceType === "AI_PLAN" && (
                      <>
                        <span className="px-2 py-0.5 rounded-full border border-sky-500/25 bg-sky-500/10 text-sky-300">AI</span>
                        <span className="text-zinc-700">·</span>
                      </>
                    )}
                    {currentProgram.goal && (
                      <>
                        <span>{goalLabel(currentProgram.goal)}</span>
                        <span className="text-zinc-700">·</span>
                      </>
                    )}
                    <span>Đã hoàn thành: <span className="text-emerald-400">{workoutStats?.totalWorkouts || 0}</span></span>
                  </div>
                )}
                <div className="mt-3 h-1.5 bg-white/[0.06] rounded-full overflow-hidden max-w-sm">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-1000" 
                    style={{ width: `${Math.min(100, ((workoutStats?.totalWorkouts || 0) / 36) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <GlassPanel title="Buổi tập sắp tới" icon={<Dumbbell className="w-4 h-4 text-emerald-400" />}>
              <div className="space-y-2.5">
                {aiSchedules.length > 0 ? (
                  aiSchedules.slice(0, 5).map((schedule) => {
                    const programDay = schedule.programDay;
                    const programName = programDay?.program?.name || 'AI Plan';
                    const dayTitle = programDay?.title || `Day ${programDay?.dayNumber || 1}`;
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
                            <p className="text-sm text-zinc-200 truncate">{dayTitle}</p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              {new Date(schedule.date).toLocaleDateString('vi-VN')} · {exerciseCount} bài · {programName}
                            </p>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-full border border-emerald-500/20 text-emerald-300">
                            AI
                          </span>
                          <button
                            type="button"
                                                        onClick={() => {
                              setTab("plan");
                              setSelectedDay(programDay?.dayNumber || 1);
                              setSelectedDate(new Date(schedule.date));
                              setSelectedScheduleId(schedule.id);
                              currentWorkoutIdRef.current = schedule.workoutId || schedule.workout?.id || null;
                              setPlanView("dayDetail");
                            }}
                            className="text-[10px] px-2 py-1 rounded-full border border-zinc-700/50 text-zinc-300 hover:bg-zinc-800"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                                                        onClick={async () => {
                              if (!window.confirm("Xóa lịch tập này khỏi lịch? Workout đã hoàn thành sẽ không bị xóa.")) return;
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
                    <p className="text-sm text-zinc-400">Bạn chưa có lịch tập sắp tới</p>
                    <button
                      type="button"
                                            onClick={() => navigate('/client/plans')}
                      className="mt-3 px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors"
                    >
                      Tạo bằng AI
                    </button>
                  </div>
                )}
              </div>
            </GlassPanel>
          </div>

          {/* Calendar + Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <button type="button" onClick={openManualBuilder} className="lg:col-span-2 justify-self-start px-3 py-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/15">
              Tạo thủ công
            </button>
            <GlassPanel title="Lịch tập" icon={<Calendar className="w-4 h-4 text-emerald-400" />} actionLabel="Thêm" onAction={() => setShowCalendarAdd(true)}>
              <CalendarGrid
                schedulesByDay={schedulesByDay}
                markers={calendarMarkers}
                month={calendarMonth}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
                onDayClick={(day) => {
                  const clickedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                  const dStr = clickedDate.toDateString();
                  setSelectedDate(clickedDate);
                  const scheduleForDay = findScheduleForDate(clickedDate);
                  setSelectedDay(scheduleForDay?.programDay?.dayNumber || day);
                  setSelectedScheduleId(scheduleForDay?.id || null);
                  currentWorkoutIdRef.current = scheduleForDay?.workoutId || scheduleForDay?.workout?.id || null;

                  // Prefer the persisted schedule. Workout history can contain legacy
                  // date-shifted rows, so it is only a fallback for unscheduled days.
                  if (scheduleForDay?.programDay?.dayNumber) {
                    setSelectedDay(scheduleForDay.programDay.dayNumber);
                    setTab("plan");
                    setPlanView("dayDetail");
                  } else if (workoutCacheRef.current[dStr]) {
                    const w = workoutCacheRef.current[dStr];
                    currentWorkoutIdRef.current = w.id;
                    const mapped = w.exercises.map((we: any) => ({
                      id: we.id,
                      dbId: we.exerciseId,
                      name: we.exercise.exerciseName,
                      prescription: `${we.sets}×${we.reps || 10}${we.weight ? '×' + we.weight + ' kg' : ''}`,
                      img: formatVideoUrlToImg(we.exercise.videoUrl, 0),
                      img2: formatVideoUrlToImg(we.exercise.videoUrl, 1),
                      type: (we.exercise.typeOfActivity === "CARDIO" ? "cardio" : "strength") as "cardio" | "strength",
                      description: we.exercise.instructions,
                      muscles: we.exercise.muscleGroupsActivated || [],
                      tips: [],
                    }));
                    setDayExercises(mapped);
                    setTab("plan");
                    setPlanView("dayDetail");
                  } else {
                    openScheduleModal(clickedDate);
                  }
                }}
              />
            </GlassPanel>

            <GlassPanel title="Chỉ số cơ thể" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} actionLabel="+ Log" onAction={() => setShowLogModal(true)}>
              {/* Active metric chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                {metricOptions.map((m) => {
                  const isActive = activeCharts.has(m.key);
                  return (
                    <button
                      type="button"
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
                      style={isActive ? { borderColor: m.color + "40", backgroundColor: m.color + "15", color: m.color } : {}}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Chart area */}
              {Array.from(activeCharts).map((chartKey) => {
                const m = metricOptions.find((o) => o.key === chartKey)!;
                return (
                  <div key={chartKey} className="mb-4 last:mb-0">
                    <p className="text-xs text-zinc-500 mb-2">{m.label}: <span style={{ color: m.color }}>{m.current}</span> · Mục tiêu: <span className="text-zinc-400">{m.target}</span></p>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={m.data as any}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#3f3f46" }} axisLine={false} tickLine={false} />
                          <YAxis domain={m.domain as any} tick={{ fontSize: 10, fill: "#3f3f46" }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 14, border: "1px solid #1e1e24", backgroundColor: "rgba(8,8,12,0.96)", color: "#e4e4e7" }} formatter={(v: number) => [`${v} ${m.unit}`, m.label]} />
                          <Line type="monotone" dataKey={m.dataKey} stroke={m.color} strokeWidth={2.5} dot={{ r: 3, fill: m.color, strokeWidth: 0 }} activeDot={{ r: 6, fill: m.color, stroke: "#0a0a0f", strokeWidth: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
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
                <TimeFilterBar value={muscleFilter} onChange={setMuscleFilter} />
                <div className="flex items-start gap-8 mt-6">
                  <div className="shrink-0" style={{ width: 180, height: 180 }}>
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                          <Pie data={muscleChartData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2.5} dataKey="value" strokeWidth={0}
                            label={({ cx, cy, midAngle, outerRadius, value, name }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = outerRadius + 18;
                              const x = cx + radius * Math.cos(-midAngle * RADIAN);
                              const y = cy + radius * Math.sin(-midAngle * RADIAN);
                              return <text x={x} y={y} fill="#d4d4d8" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10}>{value}%</text>;
                            }} labelLine={false}>
                            {muscleChartData.map((d) => <Cell key={`mc-${d.name}`} fill={d.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <span className="text-base text-white">6</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">Nhóm</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3 pt-1">
                    {muscleChartData.map((d) => (
                      <div key={`ml-${d.name}`} className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-[4px] shrink-0" style={{ backgroundColor: d.color, boxShadow: `0 0 8px ${d.color}40` }} />
                        <span className="text-xs text-zinc-300 flex-1 min-w-[64px]">{d.name}</span>
                        <div className="w-24 h-[7px] bg-zinc-800/80 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${d.value * 2}%`, backgroundColor: d.color }} />
                        </div>
                        <span className="text-xs text-zinc-400 w-10 text-right tabular-nums">{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
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
                  <h3 className="text-sm text-zinc-100">Phân bổ loại bài tập</h3>
                </div>
                <TimeFilterBar value={exerciseFilter} onChange={setExerciseFilter} />
                <div className="flex items-start gap-8 mt-6">
                  <div className="shrink-0" style={{ width: 180, height: 180 }}>
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                          <Pie data={exerciseTypeData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2.5} dataKey="value" strokeWidth={0}
                            label={({ cx, cy, midAngle, outerRadius, value, name }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = outerRadius + 18;
                              const x = cx + radius * Math.cos(-midAngle * RADIAN);
                              const y = cy + radius * Math.sin(-midAngle * RADIAN);
                              return <text x={x} y={y} fill="#d4d4d8" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10}>{value}%</text>;
                            }} labelLine={false}>
                            {exerciseTypeData.map((d) => <Cell key={`et-${d.name}`} fill={d.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <span className="text-base text-white">4</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">Loại</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4 pt-2">
                    {exerciseTypeData.map((d) => (
                      <div key={`el-${d.name}`} className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-[4px] shrink-0" style={{ backgroundColor: d.color, boxShadow: `0 0 8px ${d.color}40` }} />
                        <span className="text-xs text-zinc-300 flex-1 min-w-[64px]">{d.name}</span>
                        <div className="w-24 h-[7px] bg-zinc-800/80 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${d.value * 2}%`, backgroundColor: d.color }} />
                        </div>
                        <span className="text-xs text-zinc-400 w-10 text-right tabular-nums">{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ WORKOUT PLAN — MAIN ═══════════════ */}
      {tab === "plan" && planView === "main" && (
        <div className="space-y-7">
          {/* Cinematic Hero */}
          <div className="group relative rounded-2xl overflow-hidden border border-zinc-700/20 h-60">
            <img src={heroImg} alt="Training" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/15" />
            <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/15 via-transparent to-transparent" />

            <button type="button" className="absolute top-4 left-4 w-10 h-10 rounded-xl bg-black/25 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/40 transition-all">
              <Share2 className="w-4 h-4 text-white/50" />
            </button>

            <div className="absolute top-4 right-4 flex gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/15 text-[11px] text-amber-300 backdrop-blur-md">
                <Star className="w-3 h-3" /> 4.8
              </span>
              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/15 text-[11px] text-emerald-300 backdrop-blur-md">At Gym</span>
              <span className="px-3 py-1.5 rounded-xl bg-zinc-500/10 border border-zinc-500/15 text-[11px] text-zinc-300 backdrop-blur-md">Intermediate</span>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6">
              <span className="text-[10px] text-emerald-400/50 uppercase tracking-[0.2em] mb-1.5 block">Chương trình</span>
              <h2 className="text-2xl text-white mb-2 tracking-tight">{currentProgram ? currentProgram.name : "Chưa có chương trình"}</h2>
              {currentProgram && (
                <button
                  type="button"
                                    onClick={async () => {
                    if (!window.confirm("Ẩn chương trình hiện tại? Workout đã hoàn thành sẽ không bị xóa.")) return;
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
                  <span className="flex items-center gap-1.5"><Dumbbell className="w-3 h-3 text-emerald-500/50" /> {currentProgram.durationWeeks || 4} tuần</span>
                  <span className="text-zinc-700">·</span>
                  <span>{currentProgram.daysPerWeek || workoutStats?.workoutsPerWeek || 3} buổi/tuần</span>
                  <span className="text-zinc-700">·</span>
                  {currentProgram.sourceType === "AI_PLAN" && (
                    <>
                      <span className="px-2 py-0.5 rounded-full border border-sky-500/25 bg-sky-500/10 text-sky-300">AI</span>
                      <span className="text-zinc-700">·</span>
                    </>
                  )}
                  {currentProgram.goal && (
                    <>
                      <span>{goalLabel(currentProgram.goal)}</span>
                      <span className="text-zinc-700">·</span>
                    </>
                  )}
                  <span>Đã hoàn thành: <span className="text-emerald-400">{workoutStats?.totalWorkouts || 0}</span></span>
                </div>
              )}
              <div className="mt-3 h-1.5 bg-white/[0.05] rounded-full overflow-hidden max-w-md">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.35)] transition-all duration-1000" 
                  style={{ width: `${Math.min(100, ((workoutStats?.totalWorkouts || 0) / 36) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Training Days + Calendar/Schedule */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* Training Days */}
            <div className="xl:col-span-2">
              <SectionTitle title="Ngày tập" />
              <div className="space-y-3 mt-4">
                {currentProgram?.days?.length ? currentProgram.days.map((w: any) => (
                  <button
                    type="button"
                                        key={`td-${w.day || w.dayNumber}`}
                    onClick={() => {
                      if (!w.locked) {
                        const schedules = Array.isArray(w.schedules) ? w.schedules : [];
                        const todayStart = new Date();
                        todayStart.setHours(0, 0, 0, 0);
                        const nextSchedule =
                          schedules.find((schedule: any) => !schedule.workoutId && new Date(schedule.date) >= todayStart) ||
                          schedules.find((schedule: any) => !schedule.workoutId) ||
                          schedules[0];
                        setSelectedDay(w.day || w.dayNumber);
                        setSelectedDate(nextSchedule?.date ? new Date(nextSchedule.date) : new Date());
                        setSelectedScheduleId(nextSchedule?.id || null);
                        currentWorkoutIdRef.current = nextSchedule?.workoutId || nextSchedule?.workout?.id || null;
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
                    {!w.locked && <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 to-emerald-500/0 group-hover/card:from-emerald-500/[0.02] group-hover/card:to-transparent transition-all duration-300" />}

                    <div className="relative flex items-center gap-4">
                      {/* Ring */}
                      <div className="relative shrink-0">
                        <svg width="52" height="52" viewBox="0 0 52 52">
                          <circle cx="26" cy="26" r="22" fill="none" stroke={w.locked ? "#18181b" : "#064e3b"} strokeWidth="3" />
                          {!w.locked && w.progress > 0 && (
                            <circle cx="26" cy="26" r="22" fill="none" stroke="#10b981" strokeWidth="3"
                              strokeDasharray={`${(w.progress / 100) * 138} 138`} strokeLinecap="round" transform="rotate(-90 26 26)" />
                          )}
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          {w.locked ? <Lock className="w-4 h-4 text-zinc-700" /> : <span className="text-[11px] text-emerald-400">{w.progress}%</span>}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-100">Ngày {w.day || w.dayNumber}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">{w.title}</p>
                        {!w.locked && (
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[10px] text-zinc-600 flex items-center gap-1"><Clock className="w-3 h-3" /> {w.duration || '1h'}</span>
                            <span className="text-[10px] text-zinc-600">{w.exercises?.length || w.exercises || 0} bài tập</span>
                          </div>
                        )}
                      </div>

                      {!w.locked && <ChevronRight className="w-4 h-4 text-zinc-700 group-hover/card:text-emerald-400 transition-colors shrink-0" />}
                    </div>
                  </button>
                )) : (
                  <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-6 text-center">
                    <p className="text-sm text-zinc-400">Bạn chưa có lịch tập hiện tại</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button type="button" onClick={openManualBuilder} className="px-3 py-2 rounded-lg border border-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-800">Tạo thủ công</button>
                      <button type="button" onClick={() => navigate('/client/plans')} className="px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400">Tạo bằng AI</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Calendar + Schedule */}
            <div className="xl:col-span-3 space-y-6">
              {/* Calendar */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/[0.02] rounded-full blur-[60px] pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <button type="button" onClick={openManualBuilder} className="px-3 py-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/15">Tạo thủ công</button>
                    <SectionTitle title="Lịch tập" />
                    <button type="button" onClick={() => setCalendarExpanded(!calendarExpanded)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                      {calendarExpanded ? "Thu gọn" : "Mở rộng"}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${!calendarExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                  {calendarExpanded && (
                    <CalendarGrid
                      schedulesByDay={schedulesByDay}
                      markers={calendarMarkers}
                      month={calendarMonth}
                      onPrevMonth={handlePrevMonth}
                      onNextMonth={handleNextMonth}
                      onDayClick={(day) => {
                        const clickedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                        setSelectedDate(clickedDate);
                        const scheduleForDay = findScheduleForDate(clickedDate);
                        setSelectedDay(scheduleForDay?.programDay?.dayNumber || day);
                        setSelectedScheduleId(scheduleForDay?.id || null);
                        currentWorkoutIdRef.current = scheduleForDay?.workoutId || scheduleForDay?.workout?.id || null;

                        if (scheduleForDay?.programDay?.dayNumber) {
                          setSelectedDay(scheduleForDay.programDay.dayNumber);
                          setPlanView("dayDetail");
                        } else {
                          openScheduleModal(clickedDate);
                        }
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Schedule Settings */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-emerald-500/[0.02] rounded-full blur-[50px] pointer-events-none" />
                <div className="relative">
                  <SectionTitle title="Lịch tập luyện" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-0 mt-5">
                    <div>
                      <ToggleRow label="Hiện ở Tổng quan" value={showOnOverview} onChange={setShowOnOverview} />
                      <ToggleRow label="Hiện tất cả chương trình" value={showAllPrograms} onChange={setShowAllPrograms} />
                      <ToggleRow label="Lịch tự động" value={autoSchedule} onChange={setAutoSchedule} />
                      <ToggleRow label="Lịch chỉnh sửa được" value={editableSchedule} onChange={setEditableSchedule} />
                    </div>

                    {editableSchedule && (
                      <div className="space-y-4 pt-2 md:pt-0">
                        {/* Mode */}
                        <div className="flex bg-zinc-800/30 rounded-xl p-1 border border-zinc-700/20">
                          {(["day", "cycle"] as const).map((m) => (
                            <button type="button" key={m} onClick={() => setScheduleMode(m)} className={`flex-1 py-2 rounded-lg text-xs transition-all ${
                              scheduleMode === m
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 shadow-[0_0_10px_rgba(16,185,129,0.08)]"
                                : "text-zinc-500 hover:text-zinc-400 border border-transparent"
                            }`}>
                              {m === "day" ? "Theo ngày" : "Chu kỳ"}
                            </button>
                          ))}
                        </div>
                        <SettingRow label="Ngày bắt đầu">
                          <button type="button" className="px-4 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-xs text-emerald-400 hover:border-emerald-500/20 transition-colors">Apr 1, 2026</button>
                        </SettingRow>
                        <SettingRow label="Ngày tập liên tiếp">
                          <Stepper value={consecutiveTrain} onChange={setConsecutiveTrain} min={1} max={7} />
                        </SettingRow>
                        <SettingRow label="Ngày nghỉ liên tiếp">
                          <Stepper value={consecutiveRest} onChange={setConsecutiveRest} min={1} max={7} />
                        </SettingRow>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ DAY DETAIL ═══════════════ */}
      {tab === "plan" && planView === "dayDetail" && (() => {
        const programDays = currentProgram?.days || [];
        const wd = programDays.find((d: any) => d.dayNumber === selectedDay) || programDays[0];
        const detailSchedule = selectedSchedule();
        const detailProgress = scheduleProgressPercent(detailSchedule);
        if (!wd) {
          return (
            <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-8 text-center">
              <p className="text-sm text-zinc-400">Bạn chưa có ngày tập trong chương trình hiện tại</p>
              <button type="button" onClick={() => navigate('/client/plans')} className="mt-4 px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400">Tạo bằng AI</button>
            </div>
          );
        }
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setPlanView("main")} className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <ChevronLeft className="w-5 h-5 text-zinc-400" />
              </button>
              <div>
                <h2 className="text-lg text-white tracking-tight">Ngày {selectedDay} — Chi tiết bài tập</h2>
                <p className="text-xs text-zinc-500">{wd.title}</p>
              </div>
              <button
                type="button"
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Summary */}
              <div className="rounded-2xl border border-zinc-800/30 bg-gradient-to-b from-zinc-900/50 to-zinc-900/30 p-6 relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/[0.03] rounded-full blur-[40px]" />
                <div className="relative">
                  <div className="flex justify-center mb-6">
                    <div className="relative">
                      <svg width="110" height="110" viewBox="0 0 110 110">
                        <circle cx="55" cy="55" r="48" fill="none" stroke="#064e3b" strokeWidth="4" />
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
                          <span className="text-2xl text-emerald-400">{detailProgress}%</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">Hoàn thành</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-center mb-5">
                    <h3 className="text-base text-zinc-100 mb-0.5">Ngày {selectedDay}</h3>
                    <p className="text-xs text-zinc-500">{wd.title}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                      <Clock className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                      <p className="text-sm text-zinc-200">{wd.duration || '1h'}</p>
                      <p className="text-[10px] text-zinc-600">Thời gian</p>
                    </div>
                    <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                      <Dumbbell className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                      <p className="text-sm text-zinc-200">{wd.exercises?.length || wd.exercises || 0}</p>
                      <p className="text-[10px] text-zinc-600">Bài tập</p>
                    </div>
                  </div>

                  <button
                    type="button"
                                        onClick={() => {
                      if (detailSchedule?.id) setSelectedScheduleId(detailSchedule.id);
                      currentWorkoutIdRef.current = detailSchedule?.workoutId || detailSchedule?.workout?.id || null;
                      setPlanView("activeExercise");
                    }}
                    className="w-full py-3.5 rounded-xl bg-emerald-500 text-black text-sm tracking-wider transition-all hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" /> BẮT ĐẦU TẬP
                  </button>
                </div>
              </div>

              {/* Exercises */}
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between">
                  <SectionTitle title="Bài tập" badge={`${editMode ? editExercises.length : dayExercises.length}`} />
                  {editMode ? (
                    <div className="flex items-center gap-2">
                      {editMode && (
                        <span className="text-[10px] text-zinc-500 italic mr-2">
                          {isSaving ? "Đang lưu..." : "Đã lưu"}
                        </span>
                      )}
                      <button type="button" 
                        onClick={() => { 
                          setDayExercises(editExercises); 
                          setEditMode(false); 
                        }} 
                        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/25 hover:border-zinc-600/30"
                      >
                        <Check className="w-3 h-3 text-emerald-400" /> Xong
                      </button>
                      <button type="button" 
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
                  ) : (
                    <button type="button" onClick={() => { setEditExercises([...dayExercises]); setEditMode(true); }} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20">
                      <ArrowUpDown className="w-3 h-3" /> Sửa
                    </button>
                  )}
                </div>

                {editMode ? (
                  /* ── Edit Mode: reorderable list ── */
                  <div className="space-y-2 mt-4">
                    {isLoading ? (
                      <div className="py-12 flex flex-col items-center justify-center space-y-4">
                        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                        <p className="text-xs text-zinc-500">Đang tải...</p>
                      </div>
                    ) : editExercises.map((ex, i) => (
                      <div
                        key={`edit-${ex.id}`}
                        draggable
                        onDragStart={() => setDragIdx(i)}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={() => {
                          if (dragIdx === null || dragIdx === i) return;
                          const items = [...editExercises];
                          const [moved] = items.splice(dragIdx, 1);
                          items.splice(i, 0, moved);
                          setEditExercises(items);
                          setDragIdx(null);
                        }}
                        onDragEnd={() => setDragIdx(null)}
                        className={`rounded-2xl border p-4 flex items-center gap-4 transition-all ${
                          dragIdx === i
                            ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.08)]"
                            : "border-zinc-800/30 bg-zinc-900/40 hover:border-zinc-700/40"
                        }`}
                      >
                        <div className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 transition-colors">
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <span className="w-6 h-6 rounded-lg bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center text-[10px] text-zinc-500 shrink-0">{i + 1}</span>
                        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-zinc-700/25" onClick={() => setShowExerciseDetail(ex)}>
                          <ExerciseFlipDemo 
                            img1={ex.img} 
                            img2={ex.img2} 
                            alt={ex.name} 
                            className="w-full h-full" 
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-100 truncate">{ex.name}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">{ex.prescription}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {[
                              ["sets", "Sets"],
                              ["reps", "Reps"],
                              ["restSeconds", "Rest"],
                            ].map(([key, label]) => (
                              <label key={key} className="flex items-center gap-1 text-[10px] text-zinc-500">
                                {label}
                                <input
                                  type="number"
                                  min={key === "restSeconds" ? 0 : 1}
                                  value={ex[key] ?? ""}
                                  onChange={(event) => {
                                    const next = [...editExercises];
                                    next[i] = { ...next[i], [key]: Number(event.target.value) || (key === "restSeconds" ? 0 : 1) };
                                    next[i].prescription = `${next[i].sets ?? 3}×${next[i].reps ?? 10}${next[i].restSeconds ? ` · nghỉ ${next[i].restSeconds}s` : ""}`;
                                    setEditExercises(next);
                                  }}
                                  className="w-14 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-200 outline-none focus:border-emerald-500/40"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                        <span className={`text-[10px] px-2.5 py-1 rounded-lg border shrink-0 ${
                          ex.type === "cardio"
                            ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                            : "text-green-300 border-green-500/15 bg-green-500/6"
                        }`}>
                          {ex.type === "cardio" ? "Cardio" : "Strength"}
                        </span>
                        <button
                          type="button"
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
                          type="button"
                                                    onClick={() => {
                            if (editExercises.length <= 1) {
                              alert("Mỗi ngày tập cần ít nhất 1 bài tập.");
                              return;
                            }
                            if (!window.confirm("Xóa bài tập này khỏi ngày tập?")) return;
                            setEditExercises(editExercises.filter((_, j) => j !== i));
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/8 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {!isLoading && (
                      <button type="button" 
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
                        <p className="text-xs text-zinc-500">Đang tải bài tập...</p>
                      </div>
                    ) : dayExercises.map((ex, i) => (
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
                          <p className="text-sm text-zinc-100 truncate">{ex.name}</p>
                          <p className="text-xs text-zinc-500 mt-1">{ex.prescription}</p>
                        </div>
                        <span className={`relative text-[10px] px-2.5 py-1 rounded-lg border shrink-0 ${
                          ex.type === "cardio"
                            ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                            : "text-green-300 border-green-500/15 bg-green-500/6"
                        }`}>
                          {ex.type === "cardio" ? "Cardio" : "Strength"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ ACTIVE EXERCISE ═══════════════ */}
      {tab === "plan" && planView === "activeExercise" && !showCompletion && (() => {
        if (dayExercises.length === 0) {
          return (
            <div className="rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/30 p-8 text-center">
              <p className="text-sm text-zinc-400">Ngày tập này chưa có bài tập</p>
              <button type="button" onClick={() => setPlanView("dayDetail")} className="mt-4 px-3 py-2 rounded-lg border border-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-800">Quay lai</button>
            </div>
          );
        }
        const curEx = dayExercises[activeExIdx];
        const isCompleted = completedExercises.has(activeExIdx);
        const progressPct = (completedExercises.size / dayExercises.length) * 100;
        const requiresExternalWeight = exerciseUsesExternalWeight(curEx);
        const activeLog = activeExerciseLogs[activeExIdx] || {
          weightKg: "",
          noWeight: !requiresExternalWeight,
        };
        const updateActiveLog = (patch: Partial<ActiveExerciseLog>) => {
          setActiveExerciseLogs((prev) => ({
            ...prev,
            [activeExIdx]: {
              weightKg: prev[activeExIdx]?.weightKg ?? "",
              noWeight: prev[activeExIdx]?.noWeight ?? !requiresExternalWeight,
              ...patch,
            },
          }));
        };
        return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setPlanView("dayDetail")} className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
              <ChevronLeft className="w-5 h-5 text-zinc-400" />
            </button>
            <div className="flex-1">
              <h2 className="text-base text-white">
                <span className="text-emerald-400">{activeExIdx + 1}</span><span className="text-zinc-600">/{dayExercises.length}</span>{" "}
                <span className="text-zinc-300">{curEx.type === "cardio" ? "Cardio" : "Strength"} — {curEx.name}</span>
              </h2>
              <p className="text-xs text-zinc-500">{curEx.prescription}</p>
            </div>
            {/* Timer button */}
            {!timerRunning ? (
              <button type="button" onClick={() => setTimerRunning(true)} className="px-5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/15 text-sm text-emerald-300 hover:bg-emerald-500/15 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)] transition-all flex items-center gap-2">
                <Play className="w-4 h-4" /> {timerSeconds > 0 ? "Tiếp tục" : "Bắt giờ"}
              </button>
            ) : (
              <button type="button" onClick={() => setTimerRunning(false)} className="px-5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/15 text-sm text-amber-300 hover:bg-amber-500/15 transition-all flex items-center gap-2">
                <Pause className="w-4 h-4" /> Tạm dừng
              </button>
            )}
          </div>

          {/* Overall progress bar */}
          <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/30 p-3 flex items-center gap-4">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">Tiến độ</span>
            <div className="flex-1 h-2 bg-zinc-800/50 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.35)]" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-xs text-emerald-400 shrink-0">{completedExercises.size}/{dayExercises.length}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Media + Info */}
            <div className="space-y-5">
              {/* Rest timer banner */}
              {restTimerRunning && restSeconds > 0 && (
                <div className="rounded-2xl border border-amber-500/15 bg-amber-950/20 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
                      <Timer className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm text-amber-200">Nghỉ giữa set</p>
                      <p className="text-xs text-amber-400/50">Nghỉ ngơi trước set tiếp</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl text-amber-300 tabular-nums">{formatTime(restSeconds)}</span>
                    <button type="button" onClick={() => { setRestTimerRunning(false); setRestSeconds(90); }} className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center hover:bg-amber-500/20 transition-all">
                      <SkipForward className="w-3.5 h-3.5 text-amber-400" />
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-emerald-500/10 bg-emerald-950/20 p-4 flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-emerald-200/60">Hoạt ảnh bài tập — bấm để xem chi tiết</p>
              </div>

              {/* Exercise flip animation demo */}
              <div
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
                <h3 className="text-xl text-white tracking-tight">{curEx.name}</h3>
                <p className="text-sm text-zinc-500">Lịch tập: <span className="text-emerald-400/70">{curEx.prescription}</span></p>
              </div>
            </div>

            {/* Right: Timer rings + Logging + Navigation */}
            <div className="space-y-5">
              {/* Timer & Stats rings */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-8">
                <div className="flex items-center justify-center gap-10">
                  {/* Elapsed Timer */}
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="relative" style={{ width: 90, height: 90 }}>
                      <svg width="90" height="90" viewBox="0 0 90 90">
                        <circle cx="45" cy="45" r="39" fill="none" stroke="#064e3b" strokeWidth="3" />
                        <circle cx="45" cy="45" r="39" fill="none" stroke={timerRunning ? "#10b981" : "#22c55e"} strokeWidth="3"
                          strokeDasharray={`${Math.min((timerSeconds / 600) * 245, 245)} 245`} strokeLinecap="round" transform="rotate(-90 45 45)"
                          className="transition-all duration-1000" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-base tabular-nums ${timerRunning ? "text-emerald-400" : "text-zinc-300"}`}>{formatTime(timerSeconds)}</span>
                      </div>
                      {timerRunning && <div className="absolute inset-0 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.15)] animate-pulse" />}
                    </div>
                    <span className="text-[11px] text-zinc-500">Đã qua</span>
                  </div>
                  {/* Rest */}
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="relative" style={{ width: 90, height: 90 }}>
                      <svg width="90" height="90" viewBox="0 0 90 90">
                        <circle cx="45" cy="45" r="39" fill="none" stroke="#18181b" strokeWidth="3" />
                        {restTimerRunning && (
                          <circle cx="45" cy="45" r="39" fill="none" stroke="#f59e0b" strokeWidth="3"
                            strokeDasharray={`${(restSeconds / 90) * 245} 245`} strokeLinecap="round" transform="rotate(-90 45 45)"
                            className="transition-all duration-1000" />
                        )}
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        {restTimerRunning ? (
                          <span className="text-base text-amber-300 tabular-nums">{formatTime(restSeconds)}</span>
                        ) : (
                          <Timer className="w-5 h-5 text-zinc-600" />
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-zinc-500">Nghỉ</span>
                  </div>
                  {/* Set Progress */}
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="relative" style={{ width: 90, height: 90 }}>
                      <svg width="90" height="90" viewBox="0 0 90 90">
                        <circle cx="45" cy="45" r="39" fill="none" stroke="#064e3b" strokeWidth="3" />
                        <circle cx="45" cy="45" r="39" fill="none" stroke="#10b981" strokeWidth="3"
                          strokeDasharray={`${progressPct / 100 * 245} 245`} strokeLinecap="round" transform="rotate(-90 45 45)" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-base text-emerald-400">{completedExercises.size}/{dayExercises.length}</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-zinc-500">Xong</span>
                  </div>
                </div>
              </div>

              {/* Log Entry */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 space-y-4">
                <p className="text-xs text-zinc-600 uppercase tracking-wider">Ghi chép</p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={activeLog.noWeight ? "" : activeLog.weightKg}
                    onChange={(e) => updateActiveLog({ weightKg: e.target.value, noWeight: false })}
                    disabled={activeLog.noWeight}
                    placeholder={curEx.type === "cardio" ? "Nhập thời gian (phút)..." : "Nhập tạ (kg)..."}
                    className="flex-1 px-5 py-4 rounded-xl bg-zinc-800/30 border border-zinc-700/25 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/25 focus:ring-1 focus:ring-emerald-500/10 focus:shadow-[0_0_12px_rgba(16,185,129,0.06)] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => updateActiveLog({ noWeight: !activeLog.noWeight, weightKg: "" })}
                    disabled={!requiresExternalWeight}
                    className={`px-4 h-14 rounded-xl border text-sm font-medium transition-all ${
                      activeLog.noWeight
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : "border-zinc-700/40 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-800"
                    } disabled:cursor-default`}
                  >
                    Không dùng tạ
                  </button>
                </div>
                {requiresExternalWeight && !activeLog.noWeight && (
                  <p className="text-[11px] text-amber-300/80">Bắt buộc nhập tổng kg tạ trước khi hoàn thành bài này.</p>
                )}
                <button type="button" className="flex items-center gap-2 text-xs text-zinc-500 hover:text-emerald-400 transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" /> Thêm ghi chú
                </button>
              </div>

              {/* Navigation buttons */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                                    onClick={() => { if (activeExIdx > 0) { setActiveExIdx(prev => prev - 1); setTimerRunning(false); setTimerSeconds(0); } }}
                  disabled={activeExIdx === 0}
                  className="py-3.5 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" /> Trước
                </button>
                <button
                  type="button"
                                    onClick={handleCompleteExercise}
                  disabled={isCompleted || isCompletingWorkout}
                  className={`py-3.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 ${
                    isCompleted || isCompletingWorkout
                      ? "bg-emerald-500/10 border border-emerald-500/15 text-emerald-500/50 cursor-not-allowed"
                      : "bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-[0.98]"
                  }`}
                >
                  <Check className="w-4 h-4" /> {isCompleted ? "Xong" : "Hoàn thành"}
                </button>
                <button
                  type="button"
                                    onClick={handleSkipExercise}
                  disabled={activeExIdx === dayExercises.length - 1}
                  className="py-3.5 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Bỏ qua <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* Exercise list mini nav */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-4">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Danh sách bài tập</p>
                <div className="space-y-1.5">
                  {dayExercises.map((ex, i) => {
                    const done = completedExercises.has(i);
                    const active = i === activeExIdx;
                    return (
                      <button
                        type="button"
                                                key={ex.id ?? `nav-${i}`}
                        onClick={() => { setActiveExIdx(i); setTimerRunning(false); setTimerSeconds(0); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${
                          active
                            ? "bg-emerald-500/8 border border-emerald-500/15"
                            : "hover:bg-zinc-800/30 border border-transparent"
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                          done ? "bg-emerald-500 text-black" : active ? "bg-emerald-500/15 border border-emerald-500/25" : "bg-zinc-800/40 border border-zinc-700/25"
                        }`}>
                          {done ? <Check className="w-3 h-3" /> : <span className="text-[10px] text-zinc-500">{i + 1}</span>}
                        </div>
                        <span className={`text-xs truncate ${done ? "text-zinc-500 line-through" : active ? "text-emerald-300" : "text-zinc-400"}`}>{ex.name}</span>
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
      {tab === "plan" && planView === "activeExercise" && showCompletion && (
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
              <h2 className="text-3xl text-white tracking-tight mb-3">Hoàn thành buổi tập!</h2>
              <p className="text-zinc-400 text-sm">Xuất sắc ngày {selectedDay} — hoàn thành {dayExercises.length} bài tập! Hãy duy trì phong độ.</p>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-center gap-6">
              {[
                { label: "Bài tập", value: `${dayExercises.length}/${dayExercises.length}`, icon: Dumbbell },
                { label: "Thời gian", value: formatTime(timerSeconds || 0), icon: Clock },
                { label: "Trạng thái", value: "Hoàn thành", icon: Check },
              ].map((s) => (
                <div key={s.label} className="px-5 py-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/30 min-w-[120px]">
                  <s.icon className="w-4 h-4 text-emerald-500/60 mx-auto mb-2" />
                  <p className="text-sm text-emerald-300">{s.value}</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                                onClick={() => { setPlanView("dayDetail"); }}
                className="px-8 py-3.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-all"
              >
                Quay lại chi tiết
              </button>
              <button
                type="button"
                                onClick={() => { setPlanView("main"); }}
                className="px-8 py-3.5 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] flex items-center gap-2"
              >
                <Trophy className="w-4 h-4" /> Xem tất cả ngày
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ EXERCISE DETAIL MODAL ═══════════════ */}
      {showExerciseDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowExerciseDetail(null)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button type="button" onClick={() => setShowExerciseDetail(null)} className="absolute top-4 right-4 z-10 w-9 h-9 rounded-xl bg-black/40 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/60 transition-all">
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
                  <h2 className="text-xl text-white tracking-tight">{showExerciseDetail.name}</h2>
                  <p className="text-sm text-emerald-400 mt-1">{showExerciseDetail.prescription || "Chưa có lịch tập"}</p>
                </div>
                <span className={`text-[11px] px-3 py-1.5 rounded-xl border shrink-0 ${
                  showExerciseDetail.type === "cardio"
                    ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                    : "text-green-300 border-green-500/15 bg-green-500/6"
                }`}>
                  {showExerciseDetail.type === "cardio" ? "Cardio" : "Strength"}
                </span>
              </div>

              {/* Description */}
              <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Mô tả</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{showExerciseDetail.description}</p>
              </div>

              {/* Muscles & Tips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Cơ mục tiêu</p>
                  <div className="flex flex-wrap gap-2">
                    {showExerciseDetail.muscles.map((m: string) => (
                      <span key={m} className="px-3 py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/12 text-xs text-emerald-300">{m}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Mẹo hay</p>
                  <ul className="space-y-2">
                    {showExerciseDetail.tips?.map((t: string) => (
                      <li key={t} className="flex items-start gap-2 text-xs text-zinc-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ CALENDAR SCHEDULE MODAL ═══════════════ */}
      {showManualBuilder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowManualBuilder(false)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg text-white">Tạo chương trình thủ công</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Chọn lịch trong tuần, rồi tự custom bài tập cho từng buổi.</p>
              </div>
              <button type="button" onClick={() => setShowManualBuilder(false)} className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-zinc-400">Tên chương trình</span>
                <input value={manualProgramName} onChange={(event) => setManualProgramName(event.target.value)} className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-zinc-400">Ngày bắt đầu</span>
                <input type="date" value={manualStartDate} onChange={(event) => setManualStartDate(event.target.value)} className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50 [color-scheme:dark]" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-zinc-400">Số tuần</span>
                <input type="number" min={1} max={52} value={manualDurationWeeks} onChange={(event) => setManualDurationWeeks(event.target.value)} className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50" />
              </label>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-zinc-100 font-semibold">Số buổi và ngày tập</p>
                  <p className="text-xs text-zinc-500">Chọn đúng số ngày bằng số buổi/tuần.</p>
                </div>
                <select value={manualDaysPerWeek} onChange={(event) => updateManualDaysPerWeek(Number(event.target.value))} className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50">
                  {[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>{value} buổi/tuần</option>)}
                </select>
              </div>
              <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                {MANUAL_WEEKDAYS.map((weekday) => {
                  const active = manualSelectedWeekdays.includes(weekday.value);
                  return (
                    <button key={weekday.value} type="button" onClick={() => toggleManualWeekday(weekday.value)} className={`rounded-xl border px-3 py-2 text-sm transition-colors ${active ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-200"}`}>
                      <span className="block font-semibold">{weekday.short}</span>
                      <span className="block text-[10px] opacity-70">{weekday.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {manualDays.map((day, dayIndex) => (
                <div key={day.dayNumber} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-center text-xs font-semibold">{day.dayNumber}</span>
                    <input value={day.title} onChange={(event) => setManualDays((previous) => previous.map((item, index) => index === dayIndex ? { ...item, title: event.target.value } : item))} className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/50" />
                    <button type="button" onClick={() => { manualEditingDayIndexRef.current = dayIndex; clearExerciseFilters(); setReplaceExerciseIndex(null); setShowAddExercise(true); }} className="px-3 py-2 rounded-xl bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400">Thêm bài</button>
                  </div>
                  <div className="space-y-2">
                    {day.exercises.length === 0 ? (
                      <p className="text-xs text-zinc-500 rounded-lg border border-dashed border-zinc-800 p-3">Chưa có bài tập.</p>
                    ) : day.exercises.map((exercise, exerciseIndex) => (
                      <div key={`${exercise.exerciseId}-${exerciseIndex}`} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-zinc-100">{exerciseIndex + 1}. {exercise.exerciseName}</p>
                          <p className="text-[10px] text-zinc-500">{exercise.sets}x{exercise.reps} · nghỉ {exercise.restSeconds}s</p>
                        </div>
                        <button type="button" onClick={() => setManualDays((previous) => previous.map((item, index) => index === dayIndex ? { ...item, exercises: item.exercises.filter((_, removeIndex) => removeIndex !== exerciseIndex) } : item))} className="h-8 w-8 rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 flex items-center justify-center hover:bg-red-500/20">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={() => setShowManualBuilder(false)} className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all">Hủy</button>
              <button type="button" onClick={handleCreateManualProgram} disabled={savingManualProgram} className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed">
                {savingManualProgram ? "Đang lưu..." : "Lưu chương trình thủ công"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCalendarAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowCalendarAdd(false)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg text-white">Thêm lịch tập</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Chọn ngày và buổi tập từ chương trình hiện tại</p>
              </div>
              <button type="button" onClick={() => setShowCalendarAdd(false)} className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {!currentProgram?.days?.length ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-100">Bạn chưa có chương trình tập. Hãy tạo AI Plan hoặc tạo chương trình thủ công trước.</p>
                <button
                  type="button"
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
                    <span className="block text-xs font-semibold text-zinc-400">Ngày tập</span>
                    <input
                      type="date"
                      value={scheduleDateInput}
                      onChange={(event) => setScheduleDateInput(event.target.value)}
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50 [color-scheme:dark]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs font-semibold text-zinc-400">Buổi tập</span>
                    <select
                      value={scheduleProgramDayId}
                      onChange={(event) => setScheduleProgramDayId(event.target.value)}
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Chọn buổi tập</option>
                      {(currentProgram.days || []).map((day: any) => (
                        <option key={day.id} value={day.id}>
                          Ngày {day.dayNumber} - {day.title || "Buổi tập"} ({day.exercises?.length || 0} bài)
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {(() => {
                  const day = (currentProgram.days || []).find((item: any) => item.id === scheduleProgramDayId);
                  const exercises = day?.exercises || [];
                  return day ? (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                      <div className="text-sm text-zinc-100 font-semibold">{day.title || `Ngày ${day.dayNumber}`}</div>
                      <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto">
                        {exercises.length > 0 ? exercises.map((exercise: any, index: number) => (
                          <div key={exercise.id || index} className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                            <span className="truncate">{index + 1}. {exercise.exercise?.exerciseName || "Bài tập"}</span>
                            <span className="text-zinc-600 shrink-0">{exercise.sets || 3}x{exercise.reps || 10}</span>
                          </div>
                        )) : (
                          <p className="text-xs text-zinc-500">Buổi này chưa có bài tập.</p>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}

                <label className="space-y-1 block">
                  <span className="block text-xs font-semibold text-zinc-400">Ghi chú</span>
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
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">1 · Ngày & giờ tập</p>
              <div className="space-y-2">
                {WD_LABELS.map((label, idx) => {
                  const slot = weekdaySlots[idx];
                  const enabled = !!slot?.enabled;
                  return (
                    <div key={label} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      enabled ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-zinc-800/30 bg-zinc-800/15"
                    }`}>
                      {/* Toggle */}
                      <button
                        type="button"
                                                onClick={() => {
                          const next = { ...weekdaySlots };
                          if (enabled) { delete next[idx]; } else { next[idx] = { enabled: true, time: "07:00" }; }
                          setWeekdaySlots(next);
                        }}
                        className={`relative rounded-full transition-all shrink-0 ${enabled ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.2)]" : "bg-zinc-700"}`}
                        style={{ width: 38, height: 22 }}
                      >
                        <div className={`absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white shadow-md transition-transform ${enabled ? "left-[19px]" : "left-[3px]"}`} />
                      </button>

                      <span className={`text-sm w-12 shrink-0 ${enabled ? "text-zinc-100" : "text-zinc-600"}`}>{label}</span>

                      {enabled ? (
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => setWeekdaySlots({ ...weekdaySlots, [idx]: { ...slot, time: e.target.value } })}
                          className="ml-auto px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/25 text-sm text-emerald-300 focus:outline-none focus:border-emerald-500/25 transition-all [color-scheme:dark]"
                        />
                      ) : (
                        <span className="ml-auto text-xs text-zinc-700">Ngày nghỉ</span>
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
                <span className="text-emerald-300">{Object.keys(weekdaySlots).length} ngày/tuần</span> → <span className="text-emerald-300">{derivedMarkers.length} buổi</span> trong tháng 4/2026
              </p>
            </div>

            {/* ── Step 2: Exceptions ── */}
            <div className="hidden">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">2 · Ngoại lệ <span className="normal-case text-zinc-700">— bấm ngày để bỏ qua</span></p>
              <div className="rounded-xl bg-zinc-800/20 border border-zinc-800/25 p-4">
                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {WD_LABELS.map((d) => <span key={d} className="text-[9px] text-zinc-700 uppercase tracking-wider">{d}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {(() => {
                    const cells: (number | null)[] = [];
                    for (let i = 0; i < FIRST_DAY_OFFSET; i++) cells.push(null);
                    for (let d = 1; d <= DAYS_IN_APRIL; d++) cells.push(d);
                    while (cells.length % 7 !== 0) cells.push(null);
                    return cells.map((day, i) => {
                      if (day === null) return <span key={`exc-e-${i}`} />;
                      const dow = ((day + FIRST_DAY_OFFSET - 1) % 7);
                      const isScheduled = !!weekdaySlots[dow]?.enabled;
                      const isException = exceptions.has(day);
                      const isActive = isScheduled && !isException;
                      return (
                        <button
                          type="button"
                                                    key={`exc-${day}`}
                          onClick={() => {
                            if (!isScheduled) return;
                            const next = new Set(exceptions);
                            if (isException) next.delete(day); else next.add(day);
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
                        >{day}</button>
                      );
                    });
                  })()}
                </div>
                {exceptions.size > 0 && (
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-[11px] text-red-400/60">{exceptions.size} ngày bị bỏ qua</p>
                    <button type="button" onClick={() => setExceptions(new Set())} className="text-[11px] text-zinc-500 hover:text-zinc-400 flex items-center gap-1 transition-colors">
                      <RotateCcw className="w-3 h-3" /> Xóa tất cả
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setShowCalendarAdd(false)} className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all">Hủy</button>
              <button
                type="button"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowLogModal(false)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg text-white">Ghi chỉ số</h2>
              <button type="button" onClick={() => setShowLogModal(false)} className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {/* Metric type selector */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">Loại chỉ số</p>
              <div className="grid grid-cols-2 gap-2">
                {metricOptions.map((m) => (
                  <button
                    type="button"
                                        key={m.key}
                    onClick={() => setLogMetric(m.key as any)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      logMetric === m.key
                        ? "border-opacity-30 bg-opacity-10"
                        : "border-zinc-800/30 bg-zinc-800/20 hover:border-zinc-700/40"
                    }`}
                    style={logMetric === m.key ? { borderColor: m.color + "40", backgroundColor: m.color + "10" } : {}}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                      <span className={`text-sm ${logMetric === m.key ? "text-zinc-100" : "text-zinc-400"}`}>{m.label}</span>
                    </div>
                    <p className="text-[10px] text-zinc-600">Hiện tại: {m.current}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Value input */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">Giá trị</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={logValue}
                  onChange={(e) => setLogValue(e.target.value)}
                  placeholder={`Nhập ${metricOptions.find((m) => m.key === logMetric)?.unit}...`}
                  className="flex-1 px-5 py-4 rounded-xl bg-zinc-800/30 border border-zinc-700/25 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/25 focus:ring-1 focus:ring-emerald-500/10 transition-all"
                />
                <span className="text-sm text-zinc-500">{metricOptions.find((m) => m.key === logMetric)?.unit}</span>
              </div>
            </div>

            {/* Auto-add chart toggle */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-400">Thêm biểu đồ vào Dashboard</span>
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                activeCharts.has(logMetric) ? "bg-emerald-500 border-emerald-500" : "border-zinc-700 hover:border-zinc-600"
              }`}>
                {activeCharts.has(logMetric) && <Check className="w-3 h-3 text-black" />}
              </div>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setShowLogModal(false)} className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all">Hủy</button>
              <button type="button" onClick={() => {
                if (logValue) {
                  const next = new Set(activeCharts);
                  next.add(logMetric);
                  setActiveCharts(next);
                }
                setShowLogModal(false);
                setLogValue("");
              }} className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all">
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══════════════ ADD EXERCISE FROM DB MODAL ═══════════════ */}
      {showAddExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddExercise(false)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div 
            className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-700/30 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800/50 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-zinc-100">{replaceExerciseIndex !== null ? "Đổi bài tập" : "Thêm bài tập"}</h3>
                  <p className="text-xs text-zinc-500">Dữ liệu lấy trực tiếp từ Exercise DB</p>
                </div>
                <button type="button" onClick={() => setShowAddExercise(false)} className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center hover:bg-zinc-700 transition-colors shrink-0">
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
                  const active = pickerBodyPart === filter.bodyPart && pickerMuscleGroup === filter.muscleGroup;
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
                    {(exerciseOptions.equipments || []).map((equipment: string) => (
                      <option key={equipment} value={equipment}>{labelizeEnum(equipment)}</option>
                    ))}
                  </select>
                </label>

                <select
                  value={pickerActivityType}
                  onChange={(e) => setPickerActivityType(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"
                >
                  <option value="">Tất cả loại bài</option>
                  {(exerciseOptions.activityTypes || []).map((activity: string) => (
                    <option key={activity} value={activity}>{labelizeEnum(activity)}</option>
                  ))}
                </select>

                <select
                  value={pickerSort}
                  onChange={(e) => setPickerSort(e.target.value as "name" | "bodyPart" | "equipment")}
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
              {dbLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="h-20 rounded-xl border border-zinc-800/50 bg-zinc-800/20 animate-pulse" />
                  ))}
                </div>
              ) : dbError ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-red-300">{dbError}</p>
                  <button
                    type="button"
                    onClick={() => void exercisesRefetch()}
                    className="mt-3 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Thử lại
                  </button>
                </div>
              ) : sortedDbExercises.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-zinc-500">Không tìm thấy bài tập phù hợp</p>
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
                  {Object.entries(groupedDbExercises).map(([group, exercises]) => {
                    const groupExercises = exercises as any[];
                    return (
                    <section key={group} className="space-y-2">
                      <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm py-1 flex items-center gap-2">
                        <div className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold">{group}</div>
                        <div className="h-px flex-1 bg-zinc-800" />
                        <div className="text-[10px] text-zinc-500">{groupExercises.length} bài</div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {groupExercises.map((ex: any) => (
                          <button
                            type="button"
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
                              <p className="text-sm text-zinc-200 truncate">{ex.exerciseName}</p>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">{labelizeEnum(ex.bodyPart)}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">{labelizeEnum(ex.typeOfEquipment)}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-400">{labelizeEnum(ex.typeOfActivity)}</span>
                              </div>
                              {Array.isArray(ex.muscleGroupsActivated) && ex.muscleGroupsActivated.length > 0 && (
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
                  })}
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

function GlassPanel({ title, icon, actionLabel, onAction, children }: {
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
            {icon && <div className="w-8 h-8 rounded-xl bg-zinc-800/50 border border-zinc-700/25 flex items-center justify-center">{icon}</div>}
            <h3 className="text-sm text-zinc-100">{title}</h3>
          </div>
          {actionLabel && (
            <button type="button" onClick={onAction} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20">
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
      {badge && <span className="text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-md border border-zinc-700/25">{badge}</span>}
    </div>
  );
}

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  last: "Mới nhất",
  week: "Tuần",
  month: "Tháng",
  all: "Tất cả",
};

function TimeFilterBar({ value, onChange }: { value: TimeFilter; onChange: (v: TimeFilter) => void }) {
  return (
    <div className="flex bg-zinc-800/30 rounded-xl p-1 border border-zinc-700/20 w-fit mt-1">
      {(["last", "week", "month", "all"] as TimeFilter[]).map((v) => (
        <button type="button" key={v} onClick={() => onChange(v)} className={`px-4 py-1.5 rounded-lg text-xs transition-all ${
          value === v
            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 shadow-[0_0_8px_rgba(16,185,129,0.06)]"
            : "text-zinc-500 hover:text-zinc-400 border border-transparent"
        }`}>
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
};

const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function shortTitle(title: string): string {
  const parts = title.split(/\s*\+\s*/);
  if (parts.length >= 2) return `${parts[0].trim()} + ${parts[1].trim()}`;
  return title.slice(0, 14);
}

function CalendarGrid({ schedulesByDay, markers, month, onPrevMonth, onNextMonth, onDayClick }: {
  schedulesByDay?: Map<number, CalendarDayInfo[]>;
  markers?: number[];  // fallback: plain day markers
  month: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (day: number) => void;
}) {
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIdx, 1).getDay();
  const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const monthLabel = month.toLocaleString('default', { month: 'long', year: 'numeric' });

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayDate = new Date();
  const isCurrentMonth = todayDate.getFullYear() === year && todayDate.getMonth() === monthIdx;
  const todayDay = isCurrentMonth ? todayDate.getDate() : -1;

  // Use schedulesByDay if available, else fall back to markers[]
  const hasSchedules = schedulesByDay && schedulesByDay.size > 0;
  const activeMarkers = markers ?? [];


  return (
    <div>
      <div className="flex items-center justify-center gap-6 mb-4">
        <button
          type="button"
                    onClick={onPrevMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-500" />
        </button>
        <span className="text-sm text-zinc-200 min-w-[120px] text-center">{monthLabel}</span>
        <button
          type="button"
                    onClick={onNextMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {dayLabels.map((d) => <span key={d} className="text-[10px] text-zinc-600 py-1 uppercase tracking-wider">{d}</span>)}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} className="h-[52px]" />;
          const dayInfos = hasSchedules ? (schedulesByDay!.get(day) ?? []) : [];
          const isTraining = hasSchedules ? dayInfos.length > 0 : activeMarkers.includes(day);
          const isToday = day === todayDay;
          const firstInfo = dayInfos[0];
          const extraCount = dayInfos.length > 1 ? dayInfos.length - 1 : 0;

          return (
            <div
              key={`d-${day}`}
              onClick={() => onDayClick(day)}
              title={firstInfo
                ? `${firstInfo.title}${firstInfo.exerciseCount ? ` · ${firstInfo.exerciseCount} bài` : ''}${firstInfo.programName ? `\n${firstInfo.programName}` : ''}`
                : undefined}
              className={`relative w-full h-[52px] flex flex-col items-center pt-1.5 rounded-xl text-xs transition-all cursor-pointer overflow-hidden ${
                isTraining
                  ? "bg-emerald-500 text-black shadow-[0_0_14px_rgba(16,185,129,0.3)] hover:bg-emerald-400"
                  : isToday
                  ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-400"
              }`}
            >
              <span className={`text-[11px] font-medium leading-none ${isTraining ? 'text-black font-bold' : isToday ? 'text-emerald-400' : ''}`}>
                {day}
              </span>
              {isTraining && firstInfo && (
                <span className="mt-[3px] text-[7px] leading-tight text-black/80 truncate w-full text-center px-0.5">
                  {shortTitle(firstInfo.title)}
                </span>
              )}
              {isTraining && !firstInfo && (
                <span className="mt-[5px] block w-1.5 h-1.5 rounded-full bg-black/60 shadow-[0_0_4px_rgba(0,0,0,0.2)]" />
              )}
              {extraCount > 0 && isTraining && (
                <span className="text-[6.5px] text-black/70 font-semibold leading-none mt-0.5">+{extraCount}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-zinc-400">{label}</span>
      <button
        type="button"
                onClick={() => onChange(!value)}
        className={`relative rounded-full transition-all ${value ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.2)]" : "bg-zinc-700"}`}
        style={{ width: 42, height: 24 }}
      >
        <div className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow-md transition-transform ${value ? "left-[21px]" : "left-[3px]"}`} />
      </button>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center hover:border-emerald-500/20 transition-colors">
        <Minus className="w-3 h-3 text-zinc-400" />
      </button>
      <span className="w-7 text-center text-sm text-emerald-400">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center hover:border-emerald-500/20 transition-colors">
        <Plus className="w-3 h-3 text-zinc-400" />
      </button>
    </div>
  );
}
