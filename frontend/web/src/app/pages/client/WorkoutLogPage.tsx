import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dumbbell, ChevronLeft, ChevronRight, Plus, Lock,
  AlertCircle, Share2, Star, ArrowUpDown, ChevronDown,
  Minus, Clock, MessageSquare, Timer, Target, BarChart3,
  Zap, Calendar, TrendingUp, Play, GripVertical, Trash2,
  Check, X, SkipForward, Pause, RotateCcw, Trophy, PartyPopper
} from "lucide-react";
import confetti from "canvas-confetti";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid
} from "recharts";
import { ImageWithFallback } from "../../components/figma/ImageWithFallback";
import { workoutService, inbodyService } from "../../services/api";

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

const workoutDays = [
  { day: 1, title: "Chest + Triceps + Front Delts", progress: 0, locked: false, exercises: 6, duration: "1h 24m" },
  { day: 2, title: "Back + Biceps + Rear Delts", progress: 0, locked: false, exercises: 5, duration: "1h 18m" },
  { day: 3, title: "Legs + Side Delts", progress: 0, locked: true, exercises: 6, duration: "1h 30m" },
];

/* ── yuhonas/free-exercise-db GitHub raw image base URL ── */
const EXERCISE_IMG = (folder: string, frame: 0 | 1) =>
  `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${folder}/${frame}.jpg`;

const DEFAULT_DAY_EXERCISES = [
  {
    name: "Treadmill Run",
    dbId: "Jogging_Treadmill",
    prescription: "8 min, 110–140 bpm",
    img:  EXERCISE_IMG("Jogging_Treadmill", 0),
    img2: EXERCISE_IMG("Jogging_Treadmill", 1),
    type: "cardio" as const,
    description: "A steady-state cardio warm-up to elevate heart rate and prepare the body for strength training. Maintain a moderate pace at 110–140 bpm.",
    muscles: ["Quadriceps", "Hamstrings", "Calves"],
    tips: ["Start slow and gradually increase speed", "Keep your core engaged", "Don't hold the handrails"],
  },
  {
    name: "Flat Barbell Bench Press",
    dbId: "Barbell_Bench_Press_-_Medium_Grip",
    prescription: "4×10×65 kg",
    img:  EXERCISE_IMG("Barbell_Bench_Press_-_Medium_Grip", 0),
    img2: EXERCISE_IMG("Barbell_Bench_Press_-_Medium_Grip", 1),
    type: "strength" as const,
    description: "The king of chest exercises. Lie flat on a bench, grip the bar slightly wider than shoulder-width, lower to mid-chest, then press up explosively.",
    muscles: ["Chest", "Triceps", "Front Delts"],
    tips: ["Arch your upper back slightly", "Touch the bar to your chest", "Drive through your feet for stability"],
  },
  {
    name: "Incline Dumbbell Press",
    dbId: "Dumbbell_Bench_Press",
    prescription: "4×10×18 kg",
    img:  EXERCISE_IMG("Dumbbell_Bench_Press", 0),
    img2: EXERCISE_IMG("Dumbbell_Bench_Press", 1),
    type: "strength" as const,
    description: "Targets the upper chest. Set the bench to 30–45°, press dumbbells upward from shoulder level with a slight arc.",
    muscles: ["Upper Chest", "Triceps", "Front Delts"],
    tips: ["Don't flare elbows past 75°", "Control the negative phase", "Keep wrists neutral"],
  },
  {
    name: "Cable Chest Fly",
    dbId: "Cable_Crossover",
    prescription: "4×10×35 kg",
    img:  EXERCISE_IMG("Cable_Crossover", 0),
    img2: EXERCISE_IMG("Cable_Crossover", 1),
    type: "strength" as const,
    description: "An isolation movement for the chest using cable pulleys. Stand centered between the cables, bring handles together in a hugging arc.",
    muscles: ["Chest", "Front Delts"],
    tips: ["Keep a slight bend in elbows throughout", "Focus on the squeeze, not the weight", "Control the eccentric phase"],
  },
  {
    name: "Seated Dumbbell Shoulder Press",
    dbId: "Seated_Dumbbell_Press",
    prescription: "4×10×20 kg",
    img:  EXERCISE_IMG("Seated_Dumbbell_Press", 0),
    img2: EXERCISE_IMG("Seated_Dumbbell_Press", 1),
    type: "strength" as const,
    description: "A compound shoulder exercise performed seated for strict form. Press dumbbells overhead from shoulder height.",
    muscles: ["Front Delts", "Side Delts", "Triceps"],
    tips: ["Keep your back against the pad", "Don't use momentum", "Exhale on the press"],
  },
  {
    name: "Lying Triceps Extension",
    dbId: "Lying_Triceps_Press",
    prescription: "3×10×32.5 kg",
    img:  EXERCISE_IMG("Lying_Triceps_Press", 0),
    img2: EXERCISE_IMG("Lying_Triceps_Press", 1),
    type: "strength" as const,
    description: "Also known as skull crushers. Lie flat and lower the barbell toward your forehead by bending at the elbows, then extend back up.",
    muscles: ["Triceps (all heads)"],
    tips: ["Keep elbows pointed to ceiling", "Use a controlled tempo", "Don't flare elbows out"],
  },
];

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
  { key: "weight", label: "Weight", unit: "kg", color: "#10b981", current: "78 kg", target: "75 kg", data: weightData, dataKey: "kg", domain: [76, 82] },
  { key: "bodyfat", label: "Body Fat", unit: "%", color: "#f59e0b", current: "16.8%", target: "15%", data: bodyFatData, dataKey: "pct", domain: [15, 20] },
  { key: "muscle", label: "Muscle Mass", unit: "kg", color: "#3b82f6", current: "36.4 kg", target: "38 kg", data: muscleMassData, dataKey: "kg", domain: [34, 38] },
  { key: "water", label: "Body Water", unit: "%", color: "#06b6d4", current: "57.5%", target: "60%", data: waterData, dataKey: "pct", domain: [53, 60] },
] as const;

type Tab = "overview" | "plan";
type TimeFilter = "last" | "week" | "month" | "all";
type PlanView = "main" | "dayDetail" | "activeExercise";

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

export function WorkoutLogPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [muscleFilter, setMuscleFilter] = useState<TimeFilter>("week");
  const [exerciseFilter, setExerciseFilter] = useState<TimeFilter>("week");
  const [planView, setPlanView] = useState<PlanView>("main");
  const [selectedDay, setSelectedDay] = useState(1);
  const [dayExercises, setDayExercises] = useState<any[]>(DEFAULT_DAY_EXERCISES.map((e, i) => ({ ...e, id: `seed-${i}` })));
  const [currentWorkoutId, setCurrentWorkoutId] = useState<string | null>(null);
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
  const [inputValue, setInputValue] = useState("");
  const [selectedExercise, setSelectedExercise] = useState<any | null>(null);

  // Dynamic Navigation & Stats
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [latestInBody, setLatestInBody] = useState<any>(null);
  const [workoutStats, setWorkoutStats] = useState<any>(null);
  const [daysSinceInBody, setDaysSinceInBody] = useState<number | null>(null);
  const [workoutCache, setWorkoutCache] = useState<Record<string, any>>({});

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
        const { inbodyService } = await import("../../services/api");
        const [history, inbody, stats] = await Promise.all([
          workoutService.getHistory(1, 50), // Fetch last 50 workouts to fill cache
          inbodyService.getLatest(),
          workoutService.getStats()
        ]);

        // 1. Build Workout Cache
        const cache: Record<string, any> = {};
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
        if (inbody && inbody.createdAt) {
          setLatestInBody(inbody);
          const diff = Math.floor((Date.now() - new Date(inbody.createdAt).getTime()) / (1000 * 60 * 60 * 24));
          setDaysSinceInBody(diff);
        }
        setWorkoutStats(stats);
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
  type WeekdaySlot = { enabled: boolean; time: string };
  const [weekdaySlots, setWeekdaySlots] = useState<Record<number, WeekdaySlot>>({
    1: { enabled: true, time: "07:00" },
    3: { enabled: true, time: "07:00" },
    5: { enabled: true, time: "09:00" },
  });
  const [exceptions, setExceptions] = useState<Set<number>>(new Set());
  const WD_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const derivedMarkers = (() => {
    const m: number[] = [];
    for (let d = 1; d <= DAYS_IN_APRIL; d++) {
      const dow = ((d + FIRST_DAY_OFFSET - 1) % 7);
      if (weekdaySlots[dow]?.enabled && !exceptions.has(d)) m.push(d);
    }
    return m;
  })();

  // Log modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [logMetric, setLogMetric] = useState<"weight" | "bodyfat" | "muscle" | "water">("weight");
  const [logValue, setLogValue] = useState("");
  const [activeCharts, setActiveCharts] = useState<Set<string>>(new Set(["weight"]));

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editExercises, setEditExercises] = useState<any[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleSaveWorkout = async (silent = false) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const saveDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), selectedDay);
      const payload = {
        name: `Workout for ${saveDate.toLocaleDateString()}`,
        date: saveDate.toISOString(),
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

      if (currentWorkoutId) {
        await workoutService.updateWorkout(currentWorkoutId, payload);
      } else {
        const res = await workoutService.logWorkout(payload);
        if (res && res.id) {
          setCurrentWorkoutId(res.id);
          // Update cache with the new workout
          const dStr = saveDate.toDateString();
          setWorkoutCache({ ...workoutCache, [dStr]: { ...res, exercises: editExercises.map(e => ({ ...e, exercise: { exerciseName: e.name, videoUrl: e.img, instructions: e.description, muscleGroupsActivated: e.muscles } })) } });
        }
      }
      
      setDayExercises(editExercises);
      if (!silent) setEditMode(false);
    } catch (err: any) {
      console.error("Failed to save workout:", err);
      const msg = err.response?.data?.error || err.message || "Unknown error";
      if (!silent) alert(`Failed to save workout: ${msg}`);
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
  const [completedExercises, setCompletedExercises] = useState<Set<number>>(new Set());
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
  const [dbExercises, setDbExercises] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);

  // Search DB Exercises
  useEffect(() => {
    if (!showAddExercise) return;
    const timer = setTimeout(() => {
      setDbLoading(true);
      const url = import.meta.env.VITE_API_URL + "/exercises" + (dbSearch ? `?search=${encodeURIComponent(dbSearch)}` : "");
      fetch(url)
        .then(res => res.json())
        .then(data => {
          setDbExercises(Array.isArray(data) ? data : []);
          setDbLoading(false);
        })
        .catch(err => {
          console.error("Failed to fetch exercises:", err);
          setDbLoading(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [showAddExercise, dbSearch]);

  const handleAddFromDB = (dbEx: any) => {
    const newEx = {
      id: Date.now(), // temporary UI id
      dbId: dbEx.id,
      name: dbEx.exerciseName,
      prescription: "3×10", // Default prescription
      img: formatVideoUrlToImg(dbEx.videoUrl, 0),
      img2: formatVideoUrlToImg(dbEx.videoUrl, 1),
      type: (dbEx.typeOfActivity === "CARDIO" ? "cardio" : "strength") as "cardio"|"strength",
      description: dbEx.instructions,
      muscles: dbEx.muscleGroupsActivated || [],
      tips: [],
    };
    setEditExercises([...editExercises, newEx]);
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

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

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

  const handleCompleteExercise = () => {
    const newCompleted = new Set(completedExercises);
    newCompleted.add(activeExIdx);
    setCompletedExercises(newCompleted);
    setTimerRunning(false);
    setTimerSeconds(0);

    if (newCompleted.size === dayExercises.length) {
      // All exercises done!
      setShowCompletion(true);
      setTimeout(() => fireConfetti(), 300);
    } else if (activeExIdx < dayExercises.length - 1) {
      // Start rest timer then move to next
      setRestSeconds(90);
      setRestTimerRunning(true);
      setActiveExIdx(activeExIdx + 1);
    }
  };

  const handleSkipExercise = () => {
    setTimerRunning(false);
    setTimerSeconds(0);
    if (activeExIdx < dayExercises.length - 1) {
      setActiveExIdx(activeExIdx + 1);
    }
  };

  // Reset workout when leaving active view
  useEffect(() => {
    if (planView !== "activeExercise") {
      setActiveExIdx(0);
      setCompletedExercises(new Set());
      setTimerRunning(false);
      setTimerSeconds(0);
      setRestTimerRunning(false);
      setShowCompletion(false);
    }
  }, [planView]);

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
                <p className="text-zinc-500 text-sm">Plan, schedule, and track your training</p>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            {[
              { label: "Active Plan", value: "Muscle Gain", icon: Zap },
              { label: "This Week", value: "0 / 3 sessions", icon: Calendar },
              { label: "Streak", value: "0 days", icon: TrendingUp },
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
            key={t}
            onClick={() => { setTab(t); setPlanView("main"); }}
            className={`px-8 py-2.5 rounded-xl text-sm transition-all ${
              tab === t
                ? "bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
            }`}
          >
            {t === "overview" ? "Overview" : "Workout Plan"}
          </button>
        ))}
      </div>

      {/* ═══════════════ OVERVIEW ═══════════════ */}
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
                  <p className="text-sm text-emerald-100/90">It's time to update your body metrics</p>
                  <p className="text-xs text-emerald-500/40 mt-0.5">
                    {daysSinceInBody !== null 
                      ? `Last updated ${daysSinceInBody} days ago · InBody scan recommended`
                      : "No InBody data found · Start by uploading your first scan"}
                  </p>
                </div>
                <button 
                  onClick={() => setShowLogModal(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/15 text-xs text-emerald-300 hover:bg-emerald-500/15 transition-all shrink-0"
                >
                  Update Now
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
                <span className="text-[10px] text-emerald-400/60 uppercase tracking-[0.2em] mb-1.5 block">Current Program</span>
                <h2 className="text-2xl text-white mb-2 tracking-tight">General Muscle Gain</h2>
                <div className="flex items-center gap-4 text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-zinc-600" /> 12 week program</span>
                  <span className="text-zinc-700">·</span>
                  <span>{workoutStats?.workoutsPerWeek || "3.0"} sessions/week</span>
                  <span className="text-zinc-700">·</span>
                  <span>Completed: <span className="text-emerald-400">{workoutStats?.totalWorkouts || 0}</span></span>
                </div>
                <div className="mt-3 h-1.5 bg-white/[0.06] rounded-full overflow-hidden max-w-sm">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-1000" 
                    style={{ width: `${Math.min(100, ((workoutStats?.totalWorkouts || 0) / 36) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <GlassPanel title="Upcoming Workouts" icon={<Dumbbell className="w-4 h-4 text-emerald-400" />}>
              <div className="space-y-2.5">
                {workoutDays.map((w) => (
                  <div key={`upk-${w.day}`}
                    onClick={() => { if (!w.locked) { setTab("plan"); setPlanView("dayDetail"); setSelectedDay(w.day); } }}
                    className={`group/item rounded-xl border p-3.5 transition-all ${
                    w.locked
                      ? "bg-zinc-900/20 border-zinc-800/25 opacity-40"
                      : "bg-zinc-800/20 border-zinc-700/25 hover:border-emerald-500/20 hover:bg-zinc-800/40 cursor-pointer"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        w.locked ? "bg-zinc-800/40 border border-zinc-700/40" : "bg-emerald-500/8 border border-emerald-500/15"
                      }`}>
                        {w.locked ? <Lock className="w-3.5 h-3.5 text-zinc-700" /> : <span className="text-[11px] text-emerald-400">D{w.day}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-200">Day {w.day}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{w.title}</p>
                      </div>
                      {!w.locked && <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover/item:text-emerald-400 transition-colors" />}
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </div>

          {/* Calendar + Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GlassPanel title="Workout Calendar" icon={<Calendar className="w-4 h-4 text-emerald-400" />} actionLabel="Add" onAction={() => setShowCalendarAdd(true)}>
              <CalendarGrid 
                markers={derivedMarkers} 
                month={calendarMonth} 
                onPrevMonth={handlePrevMonth} 
                onNextMonth={handleNextMonth}
                onDayClick={(day) => {
                  const clickedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                  const dStr = clickedDate.toDateString();
                  const dateLabel = clickedDate.toLocaleDateString();
                  setSelectedDay(day);

                  // Check if we have this workout in cache
                  if (workoutCache[dStr]) {
                    const w = workoutCache[dStr];
                    setCurrentWorkoutId(w.id);
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
                    // No workout in cache
                    if (window.confirm(`No workout scheduled for ${dateLabel}. Would you like to custom a workout for this day?`)) {
                      setDayExercises([]);
                      setEditExercises([]);
                      setTab("plan");
                      setPlanView("dayDetail");
                      setEditMode(true);
                      setShowAddExercise(true);
                      setCurrentWorkoutId(null);
                    }
                  }
                }}
              />
            </GlassPanel>

            <GlassPanel title="Body Metrics" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} actionLabel="+ Log" onAction={() => setShowLogModal(true)}>
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
                    <p className="text-xs text-zinc-500 mb-2">{m.label}: <span style={{ color: m.color }}>{m.current}</span> · Target: <span className="text-zinc-400">{m.target}</span></p>
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
                  <h3 className="text-sm text-zinc-100">Muscle Group Training</h3>
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
                          <p className="text-[9px] text-zinc-600 mt-0.5">Groups</p>
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
                  <h3 className="text-sm text-zinc-100">Exercise Type Distribution</h3>
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
                          <p className="text-[9px] text-zinc-600 mt-0.5">Types</p>
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

            <button className="absolute top-4 left-4 w-10 h-10 rounded-xl bg-black/25 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/40 transition-all">
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
              <span className="text-[10px] text-emerald-400/50 uppercase tracking-[0.2em] mb-1.5 block">Active Program</span>
              <h2 className="text-2xl text-white mb-2 tracking-tight">General Muscle Gain</h2>
              <div className="flex items-center gap-4 text-xs text-zinc-400">
                <span className="flex items-center gap-1.5"><Dumbbell className="w-3 h-3 text-emerald-500/50" /> 12 week program</span>
                <span className="text-zinc-700">·</span>
                <span>{workoutStats?.workoutsPerWeek || "3.0"} sessions/week</span>
                <span className="text-zinc-700">·</span>
                <span>Completed: <span className="text-emerald-400">{workoutStats?.totalWorkouts || 0}</span></span>
              </div>
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
              <SectionTitle title="Training Days" />
              <div className="space-y-3 mt-4">
                {workoutDays.map((w) => (
                  <button
                    key={`td-${w.day}`}
                    onClick={() => { if (!w.locked) { setSelectedDay(w.day); setPlanView("dayDetail"); } }}
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
                        <p className="text-sm text-zinc-100">Day {w.day} workout</p>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">{w.title}</p>
                        {!w.locked && (
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[10px] text-zinc-600 flex items-center gap-1"><Clock className="w-3 h-3" /> {w.duration}</span>
                            <span className="text-[10px] text-zinc-600">{w.exercises} exercises</span>
                          </div>
                        )}
                      </div>

                      {!w.locked && <ChevronRight className="w-4 h-4 text-zinc-700 group-hover/card:text-emerald-400 transition-colors shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Calendar + Schedule */}
            <div className="xl:col-span-3 space-y-6">
              {/* Calendar */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/[0.02] rounded-full blur-[60px] pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <SectionTitle title="Workout Calendar" />
                    <button onClick={() => setCalendarExpanded(!calendarExpanded)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                      {calendarExpanded ? "Collapse" : "Expand"}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${!calendarExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                  {calendarExpanded && (
                    <CalendarGrid 
                      markers={derivedMarkers} 
                      month={calendarMonth} 
                      onPrevMonth={handlePrevMonth} 
                      onNextMonth={handleNextMonth}
                      onDayClick={(day) => {
                        const clickedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                        const dateStr = clickedDate.toLocaleDateString();
                        setSelectedDay(day);
                        
                        if (derivedMarkers.includes(day)) {
                          setPlanView("dayDetail");
                        } else {
                          if (window.confirm(`No workout scheduled for ${dateStr}. Would you like to custom a workout for this day?`)) {
                            setDayExercises([]);
                            setEditExercises([]);
                            setPlanView("dayDetail");
                            setEditMode(true);
                            setShowAddExercise(true);
                          }
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
                  <SectionTitle title="Training Schedule" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-0 mt-5">
                    <div>
                      <ToggleRow label="Show on Overview Page" value={showOnOverview} onChange={setShowOnOverview} />
                      <ToggleRow label="Show all workout programs" value={showAllPrograms} onChange={setShowAllPrograms} />
                      <ToggleRow label="Automatic Schedule" value={autoSchedule} onChange={setAutoSchedule} />
                      <ToggleRow label="Editable Schedule" value={editableSchedule} onChange={setEditableSchedule} />
                    </div>

                    {editableSchedule && (
                      <div className="space-y-4 pt-2 md:pt-0">
                        {/* Mode */}
                        <div className="flex bg-zinc-800/30 rounded-xl p-1 border border-zinc-700/20">
                          {(["day", "cycle"] as const).map((m) => (
                            <button key={m} onClick={() => setScheduleMode(m)} className={`flex-1 py-2 rounded-lg text-xs transition-all ${
                              scheduleMode === m
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 shadow-[0_0_10px_rgba(16,185,129,0.08)]"
                                : "text-zinc-500 hover:text-zinc-400 border border-transparent"
                            }`}>
                              {m === "day" ? "By Day" : "Cycle"}
                            </button>
                          ))}
                        </div>
                        <SettingRow label="Training start date">
                          <button className="px-4 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-xs text-emerald-400 hover:border-emerald-500/20 transition-colors">Apr 1, 2026</button>
                        </SettingRow>
                        <SettingRow label="Consecutive training">
                          <Stepper value={consecutiveTrain} onChange={setConsecutiveTrain} min={1} max={7} />
                        </SettingRow>
                        <SettingRow label="Consecutive rest">
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
        const wd = workoutDays.find(d => d.day === selectedDay) || workoutDays[0];
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setPlanView("main")} className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <ChevronLeft className="w-5 h-5 text-zinc-400" />
              </button>
              <div>
                <h2 className="text-lg text-white tracking-tight">Day {selectedDay} — Workout Detail</h2>
                <p className="text-xs text-zinc-500">{wd.title}</p>
              </div>
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
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <span className="text-2xl text-emerald-400">0%</span>
                          <p className="text-[9px] text-zinc-600 mt-0.5">Complete</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-center mb-5">
                    <h3 className="text-base text-zinc-100 mb-0.5">Day {selectedDay} workout</h3>
                    <p className="text-xs text-zinc-500">{wd.title}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                      <Clock className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                      <p className="text-sm text-zinc-200">{wd.duration}</p>
                      <p className="text-[10px] text-zinc-600">Duration</p>
                    </div>
                    <div className="bg-zinc-800/25 rounded-xl border border-zinc-700/20 p-3.5 text-center">
                      <Dumbbell className="w-4 h-4 text-emerald-500/50 mx-auto mb-1" />
                      <p className="text-sm text-zinc-200">{wd.exercises}</p>
                      <p className="text-[10px] text-zinc-600">Exercises</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setPlanView("activeExercise")}
                    className="w-full py-3.5 rounded-xl bg-emerald-500 text-black text-sm tracking-wider transition-all hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" /> START WORKOUT
                  </button>
                </div>
              </div>

              {/* Exercises */}
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between">
                  <SectionTitle title="Exercises" badge={`${editMode ? editExercises.length : dayExercises.length}`} />
                  {editMode ? (
                    <div className="flex items-center gap-2">
                      {editMode && (
                        <span className="text-[10px] text-zinc-500 italic mr-2">
                          {isSaving ? "Saving..." : "All changes saved"}
                        </span>
                      )}
                      <button 
                        onClick={() => { 
                          setDayExercises(editExercises); 
                          setEditMode(false); 
                        }} 
                        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/25 hover:border-zinc-600/30"
                      >
                        <Check className="w-3 h-3 text-emerald-400" /> Finish Editing
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
                        {isSaving ? "Saving..." : "Save Now"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditExercises([...dayExercises]); setEditMode(true); }} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20">
                      <ArrowUpDown className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>

                {editMode ? (
                  /* ── Edit Mode: reorderable list ── */
                  <div className="space-y-2 mt-4">
                    {isLoading ? (
                      <div className="py-12 flex flex-col items-center justify-center space-y-4">
                        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                        <p className="text-xs text-zinc-500">Loading workout plan...</p>
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
                        </div>
                        <span className={`text-[10px] px-2.5 py-1 rounded-lg border shrink-0 ${
                          ex.type === "cardio"
                            ? "text-emerald-300 border-emerald-500/15 bg-emerald-500/6"
                            : "text-green-300 border-green-500/15 bg-green-500/6"
                        }`}>
                          {ex.type === "cardio" ? "Cardio" : "Strength"}
                        </span>
                        <button
                          onClick={() => setEditExercises(editExercises.filter((_, j) => j !== i))}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/8 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {!isLoading && (
                      <button 
                        onClick={() => {
                          setDbSearch("");
                          setShowAddExercise(true);
                        }}
                        className="w-full rounded-2xl border border-dashed border-zinc-700/30 bg-zinc-900/20 p-4 flex items-center justify-center gap-2 text-xs text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/20 transition-all"
                      >
                        <Plus className="w-4 h-4" /> Add Exercise
                      </button>
                    )}
                  </div>
                ) : (
                  /* ── Normal Mode: clickable cards ── */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                    {isLoading ? (
                      <div className="col-span-full py-12 flex flex-col items-center justify-center space-y-4">
                        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                        <p className="text-xs text-zinc-500">Loading your workout plan...</p>
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
        const curEx = dayExercises[activeExIdx];
        const isCompleted = completedExercises.has(activeExIdx);
        const progressPct = (completedExercises.size / dayExercises.length) * 100;
        return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <button onClick={() => setPlanView("dayDetail")} className="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
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
              <button onClick={() => setTimerRunning(true)} className="px-5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/15 text-sm text-emerald-300 hover:bg-emerald-500/15 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)] transition-all flex items-center gap-2">
                <Play className="w-4 h-4" /> {timerSeconds > 0 ? "Resume" : "Start Timer"}
              </button>
            ) : (
              <button onClick={() => setTimerRunning(false)} className="px-5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/15 text-sm text-amber-300 hover:bg-amber-500/15 transition-all flex items-center gap-2">
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
          </div>

          {/* Overall progress bar */}
          <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/30 p-3 flex items-center gap-4">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">Progress</span>
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
                      <p className="text-sm text-amber-200">Rest Period</p>
                      <p className="text-xs text-amber-400/50">Recover before next set</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl text-amber-300 tabular-nums">{formatTime(restSeconds)}</span>
                    <button onClick={() => { setRestTimerRunning(false); setRestSeconds(90); }} className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center hover:bg-amber-500/20 transition-all">
                      <SkipForward className="w-3.5 h-3.5 text-amber-400" />
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-emerald-500/10 bg-emerald-950/20 p-4 flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-emerald-200/60">Exercise animation — tap to see full details</p>
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
                <p className="text-sm text-zinc-500">Prescription: <span className="text-emerald-400/70">{curEx.prescription}</span></p>
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
                    <span className="text-[11px] text-zinc-500">Elapsed</span>
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
                    <span className="text-[11px] text-zinc-500">Rest</span>
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
                    <span className="text-[11px] text-zinc-500">Done</span>
                  </div>
                </div>
              </div>

              {/* Log Entry */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-6 space-y-4">
                <p className="text-xs text-zinc-600 uppercase tracking-wider">Log Entry</p>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={curEx.type === "cardio" ? "Enter minutes..." : "Enter weight (kg)..."}
                    className="flex-1 px-5 py-4 rounded-xl bg-zinc-800/30 border border-zinc-700/25 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/25 focus:ring-1 focus:ring-emerald-500/10 focus:shadow-[0_0_12px_rgba(16,185,129,0.06)] transition-all"
                  />
                  <button className="w-14 h-14 rounded-xl bg-emerald-500 flex items-center justify-center hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-95">
                    <Plus className="w-5 h-5 text-black" />
                  </button>
                </div>
                <button className="flex items-center gap-2 text-xs text-zinc-500 hover:text-emerald-400 transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" /> Add comment or note
                </button>
              </div>

              {/* Navigation buttons */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => { if (activeExIdx > 0) { setActiveExIdx(activeExIdx - 1); setTimerRunning(false); setTimerSeconds(0); } }}
                  disabled={activeExIdx === 0}
                  className="py-3.5 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  onClick={handleCompleteExercise}
                  disabled={isCompleted}
                  className={`py-3.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 ${
                    isCompleted
                      ? "bg-emerald-500/10 border border-emerald-500/15 text-emerald-500/50 cursor-not-allowed"
                      : "bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-[0.98]"
                  }`}
                >
                  <Check className="w-4 h-4" /> {isCompleted ? "Done" : "Complete"}
                </button>
                <button
                  onClick={handleSkipExercise}
                  disabled={activeExIdx === dayExercises.length - 1}
                  className="py-3.5 rounded-xl bg-zinc-800/40 border border-zinc-700/25 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Skip <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* Exercise list mini nav */}
              <div className="rounded-2xl border border-zinc-800/30 bg-zinc-900/40 p-4">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Exercise List</p>
                <div className="space-y-1.5">
                  {dayExercises.map((ex, i) => {
                    const done = completedExercises.has(i);
                    const active = i === activeExIdx;
                    return (
                      <button
                        key={`nav-${i}`}
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
              <h2 className="text-3xl text-white tracking-tight mb-3">Workout Complete!</h2>
              <p className="text-zinc-400 text-sm">You crushed Day {selectedDay} — all {dayExercises.length} exercises done! Keep up the momentum.</p>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-center gap-6">
              {[
                { label: "Exercises", value: `${dayExercises.length}/${dayExercises.length}`, icon: Dumbbell },
                { label: "Duration", value: formatTime(timerSeconds || 0), icon: Clock },
                { label: "Status", value: "Completed", icon: Check },
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
                onClick={() => { setPlanView("dayDetail"); }}
                className="px-8 py-3.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-all"
              >
                Back to Day Detail
              </button>
              <button
                onClick={() => { setPlanView("main"); }}
                className="px-8 py-3.5 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] flex items-center gap-2"
              >
                <Trophy className="w-4 h-4" /> View All Days
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
            <button onClick={() => setShowExerciseDetail(null)} className="absolute top-4 right-4 z-10 w-9 h-9 rounded-xl bg-black/40 backdrop-blur-md border border-white/[0.06] flex items-center justify-center hover:bg-black/60 transition-all">
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
                <span className="text-[10px] text-zinc-400">Exercise Demo</span>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl text-white tracking-tight">{showExerciseDetail.name}</h2>
                  <p className="text-sm text-emerald-400 mt-1">{showExerciseDetail.prescription || "No prescription set"}</p>
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
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Description</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{showExerciseDetail.description}</p>
              </div>

              {/* Muscles & Tips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Target Muscles</p>
                  <div className="flex flex-wrap gap-2">
                    {showExerciseDetail.muscles.map((m: string) => (
                      <span key={m} className="px-3 py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/12 text-xs text-emerald-300">{m}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/20 p-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Pro Tips</p>
                  <ul className="space-y-2">
                    {showExerciseDetail.tips?.map((t: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
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
      {showCalendarAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowCalendarAdd(false)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/30 bg-zinc-900/95 shadow-2xl p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg text-white">Workout Schedule</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Select weekdays and time, then adjust exceptions</p>
              </div>
              <button onClick={() => setShowCalendarAdd(false)} className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {/* ── Step 1: Weekday selection ── */}
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">1 · Training Days & Time</p>
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
                        <span className="ml-auto text-xs text-zinc-700">Rest day</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-xl bg-emerald-950/20 border border-emerald-500/10 p-3.5 flex items-center gap-3">
              <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-200/70">
                <span className="text-emerald-300">{Object.keys(weekdaySlots).length} days/week</span> selected → <span className="text-emerald-300">{derivedMarkers.length} sessions</span> in April 2026
              </p>
            </div>

            {/* ── Step 2: Exceptions ── */}
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">2 · Exceptions <span className="normal-case text-zinc-700">— tap dates to skip</span></p>
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
                    <p className="text-[11px] text-red-400/60">{exceptions.size} date{exceptions.size > 1 ? "s" : ""} skipped</p>
                    <button onClick={() => setExceptions(new Set())} className="text-[11px] text-zinc-500 hover:text-zinc-400 flex items-center gap-1 transition-colors">
                      <RotateCcw className="w-3 h-3" /> Clear all
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowCalendarAdd(false)} className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all">Cancel</button>
              <button onClick={() => setShowCalendarAdd(false)} className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98]">Save Schedule</button>
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
              <h2 className="text-lg text-white">Log Body Metric</h2>
              <button onClick={() => setShowLogModal(false)} className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center hover:bg-zinc-700/60 transition-all">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {/* Metric type selector */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">Metric Type</p>
              <div className="grid grid-cols-2 gap-2">
                {metricOptions.map((m) => (
                  <button
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
                    <p className="text-[10px] text-zinc-600">Current: {m.current}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Value input */}
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">Value</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={logValue}
                  onChange={(e) => setLogValue(e.target.value)}
                  placeholder={`Enter ${metricOptions.find((m) => m.key === logMetric)?.unit}...`}
                  className="flex-1 px-5 py-4 rounded-xl bg-zinc-800/30 border border-zinc-700/25 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/25 focus:ring-1 focus:ring-emerald-500/10 transition-all"
                />
                <span className="text-sm text-zinc-500">{metricOptions.find((m) => m.key === logMetric)?.unit}</span>
              </div>
            </div>

            {/* Auto-add chart toggle */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-400">Add chart to dashboard</span>
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                activeCharts.has(logMetric) ? "bg-emerald-500 border-emerald-500" : "border-zinc-700 hover:border-zinc-600"
              }`}>
                {activeCharts.has(logMetric) && <Check className="w-3 h-3 text-black" />}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowLogModal(false)} className="flex-1 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-sm text-zinc-400 hover:bg-zinc-800/70 transition-all">Cancel</button>
              <button onClick={() => {
                if (logValue) {
                  const next = new Set(activeCharts);
                  next.add(logMetric);
                  setActiveCharts(next);
                }
                setShowLogModal(false);
                setLogValue("");
              }} className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-sm hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all">
                Save Log
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
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-zinc-700/30 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800/50 flex items-center gap-3">
              <div className="flex-1 relative">
                <input 
                  type="text" 
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  placeholder="Search exercise database..." 
                  className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>
              <button onClick={() => setShowAddExercise(false)} className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center hover:bg-zinc-700 transition-colors shrink-0">
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {dbLoading ? (
                <div className="py-12 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
                </div>
              ) : dbExercises.length === 0 ? (
                <div className="py-12 text-center text-sm text-zinc-500">
                  No exercises found.
                </div>
              ) : (
                dbExercises.map((ex: any) => (
                  <button 
                    key={ex.id}
                    onClick={() => handleAddFromDB(ex)}
                    className="w-full text-left p-3 rounded-xl border border-zinc-800/40 bg-zinc-800/20 hover:bg-zinc-800/60 hover:border-emerald-500/30 transition-all flex items-center gap-4 group"
                  >
                    <div className="w-12 h-12 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-zinc-700/50">
                      <ExerciseFlipDemo 
                        img1={formatVideoUrlToImg(ex.videoUrl, 0)}
                        img2={formatVideoUrlToImg(ex.videoUrl, 1)}
                        alt={ex.exerciseName}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{ex.exerciseName}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-[10px] text-zinc-500">{ex.bodyPart?.replace('_', ' ')}</span>
                        <span className="text-[10px] text-zinc-600">•</span>
                        <span className="text-[10px] text-zinc-500">{ex.typeOfEquipment?.replace('_', ' ')}</span>
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-emerald-500/0 group-hover:text-emerald-400 transition-colors" />
                  </button>
                ))
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
            <button onClick={onAction} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-lg bg-emerald-500/6 border border-emerald-500/12 hover:border-emerald-500/20">
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

function TimeFilterBar({ value, onChange }: { value: TimeFilter; onChange: (v: TimeFilter) => void }) {
  return (
    <div className="flex bg-zinc-800/30 rounded-xl p-1 border border-zinc-700/20 w-fit mt-1">
      {(["last", "week", "month", "all"] as TimeFilter[]).map((v) => (
        <button key={v} onClick={() => onChange(v)} className={`px-4 py-1.5 rounded-lg text-xs transition-all capitalize ${
          value === v
            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 shadow-[0_0_8px_rgba(16,185,129,0.06)]"
            : "text-zinc-500 hover:text-zinc-400 border border-transparent"
        }`}>
          {v}
        </button>
      ))}
    </div>
  );
}

function CalendarGrid({ markers, month, onPrevMonth, onNextMonth, onDayClick }: { 
  markers?: number[]; 
  month: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (day: number) => void;
}) {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIdx, 1).getDay(); // 0=Sun, 1=Mon...
  const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Adjust to Mon-start

  const monthLabel = month.toLocaleString('default', { month: 'long', year: 'numeric' });

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayDate = new Date();
  const isCurrentMonth = todayDate.getFullYear() === year && todayDate.getMonth() === monthIdx;
  const todayDay = isCurrentMonth ? todayDate.getDate() : -1;
  
  const activeMarkers = markers ?? [];

  return (
    <div>
      <div className="flex items-center justify-center gap-6 mb-4">
        <button 
          onClick={onPrevMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-500" />
        </button>
        <span className="text-sm text-zinc-200 min-w-[120px] text-center">{monthLabel}</span>
        <button 
          onClick={onNextMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/40 border border-zinc-700/25 flex items-center justify-center hover:border-zinc-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {dayLabels.map((d) => <span key={d} className="text-[10px] text-zinc-600 py-1.5 uppercase tracking-wider">{d}</span>)}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} />;
          const isTraining = activeMarkers.includes(day);
          const isToday = day === todayDay;
          return (
            <div
              key={`d-${day}`}
              onClick={() => onDayClick(day)}
              className={`relative w-full aspect-square flex items-center justify-center rounded-xl text-xs transition-all cursor-pointer ${
                isToday
                  ? "bg-emerald-500 text-black shadow-[0_0_14px_rgba(16,185,129,0.3)]"
                  : isTraining
                  ? "bg-emerald-500/6 text-emerald-300 border border-emerald-500/12 hover:bg-emerald-500/12"
                  : "text-zinc-500 hover:bg-zinc-800/30"
              }`}
            >
              {day}
              {isTraining && !isToday && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />}
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
      <button onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center hover:border-emerald-500/20 transition-colors">
        <Minus className="w-3 h-3 text-zinc-400" />
      </button>
      <span className="w-7 text-center text-sm text-emerald-400">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center hover:border-emerald-500/20 transition-colors">
        <Plus className="w-3 h-3 text-zinc-400" />
      </button>
    </div>
  );
}