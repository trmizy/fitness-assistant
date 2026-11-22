import { useNavigate } from "react-router";
import { givenName } from "../../utils/givenName";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  Tooltip,
} from "recharts";
import { useApp } from "../../context/AppContext";
import { DayMacroQuickEstimate } from "../../components/nutrition/DayMacroEstimate";
import {
  profileService,
  inbodyService,
  workoutService,
  fitnessRoadmapService,
  trainingCycleService,
  type WorkoutScheduleRecord,
} from "../../services/api";
import { bodyCompVerdict, goalDisplayName, type Verdict, type VerdictInput } from "../../utils/goalVerdict";
import { PageSkeleton } from "../../components/layout/PageSkeleton";
import { MedalIcon as Award, BellIcon as Bell, BrainIcon as Brain, CalendarIcon as Calendar, CaretRightIcon as ChevronRight, BarbellIcon as Dumbbell, FlameIcon as Flame, CircleNotchIcon as Loader2, ChatTextIcon as MessageSquare, TargetIcon as Target, TrendUpIcon as TrendingUp, UploadSimpleIcon as Upload, ScalesIcon as Scale, PersonSimpleIcon as PersonSimple, ArrowUpIcon as ArrowUp, ArrowDownIcon as ArrowDown, MinusIcon as Minus, InfoIcon as Info } from "@phosphor-icons/react";

import { GoalCoherenceBanner } from "../../components/GoalCoherenceBanner";
const tooltipStyle = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5",
  },
};

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

function formatScheduleDate(value: string) {
  return parseApiDateOnly(value).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Extract a stable YYYY-MM-DD sort key from an InBody record.
 * Priority: dateOnly → date → createdAt
 * Also handles DD/MM/YYYY format that can come from manual entry or OCR.
 * Invalid/missing dates return "9999-12-31" so they sort to the END (not the start).
 */
function inBodyDateKey(record: any): string {
  const raw = record?.dateOnly ?? record?.date ?? record?.createdAt;
  const s = raw ? String(raw) : "";
  // ISO format YYYY-MM-DD (or YYYY-MM-DDTHH:mm...)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  // DD/MM/YYYY (from OCR or manual input)
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  // DD-MM-YYYY
  const dmy2 = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy2) return `${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return "9999-12-31";
}

function parseInBodyMeasurementDate(record: any): Date {
  const key = inBodyDateKey(record);
  if (key === "9999-12-31") return new Date(NaN);
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const goalLabels: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Nâng cao thể lực", // aligned with utils/labels.vi.ts GOAL_VI (was "Cải thiện sức khỏe")
};

export function ClientDashboard() {
  const { user } = useApp();
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const upcomingEnd = new Date(todayStart);
  upcomingEnd.setDate(upcomingEnd.getDate() + 30);

  const { data: profile, isLoading: profileLoading } = useQuery({
    // Must match the key InBodyModule's upload flow invalidates
    // (["profile", user.id]) — a bare ["profile"] key is NOT a prefix
    // match for that invalidation call, so this query silently never
    // refreshed after an InBody upload. See docs/body-state-and-adaptive-planning.md.
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    },
    enabled: !!user?.id,
  });

  const { data: inbodyHistory = [], isLoading: inbodyLoading } = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory,
  });

  const sortedInBodyHistory = useMemo(
    () =>
      [...inbodyHistory].sort((a: any, b: any) => {
        // Descending: newest first. Use ISO string compare (lexicographic = chronological for YYYY-MM-DD)
        const cmp = inBodyDateKey(b).localeCompare(inBodyDateKey(a));
        if (cmp !== 0) return cmp;
        return (
          Date.parse(String(b?.createdAt ?? 0)) -
          Date.parse(String(a?.createdAt ?? 0))
        );
      }),
    [inbodyHistory],
  );

  const { data: workoutHistory = [], isLoading: workoutLoading } = useQuery({
    queryKey: ["workout-history"],
    queryFn: () => workoutService.getHistory(1, 4),
  });

  // "Buổi tập · 30 ngày qua" must count the real 30-day window. It used to be
  // workoutHistory.length — the 4-row page above — so the tile could never pass 4.
  const monthAgo = new Date(todayStart);
  monthAgo.setDate(monthAgo.getDate() - 30);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { data: monthWorkouts, isLoading: monthLoading } = useQuery({
    queryKey: ["workout-history", "30d", toDateInputValue(monthAgo)],
    queryFn: () =>
      workoutService.getInRange(toDateInputValue(monthAgo), toDateInputValue(tomorrow)),
  });

  const { data: currentProgram = null, isLoading: programLoading } = useQuery({
    queryKey: ["current-workout-program"],
    queryFn: () => workoutService.getCurrentProgram(),
  });

  const { data: upcomingSchedules = [], isLoading: schedulesLoading } =
    useQuery({
      queryKey: ["workout-schedules", "dashboard-upcoming"],
      queryFn: () =>
        workoutService.getSchedules(10, {
          startDate: toDateInputValue(todayStart),
          endDate: toDateInputValue(upcomingEnd),
        }),
    });

  // D4: the goal the backend actually uses (roadmap phase decides, else profile) + the latest
  // backend cycle verdict. Same query key as GoalCoherenceBanner, so it is one request.
  const { data: coherence } = useQuery({
    queryKey: ["goal-coherence"],
    queryFn: fitnessRoadmapService.getGoalCoherence,
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const { data: recentCycles } = useQuery({
    queryKey: ["training-cycles", "recent", 5],
    queryFn: () => trainingCycleService.list(5),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const firstName = givenName(user);
  const isLoading =
    profileLoading ||
    inbodyLoading ||
    workoutLoading ||
    monthLoading ||
    programLoading ||
    schedulesLoading;

  if (isLoading) {
    // Frontend 2.0: the same skeleton the route chunk shows, so data loading continues the
    // loading state instead of swapping skeleton → spinner → content.
    return <PageSkeleton />;
  }

  const latest = sortedInBodyHistory[0];
  const prev = sortedInBodyHistory[1];

  const calcChange = (curr: number, old?: number) => {
    if (!old) return "---";
    const diff = curr - old;
    return (diff > 0 ? "+" : "") + diff.toFixed(1);
  };

  const programDays = Array.isArray(currentProgram?.days)
    ? currentProgram.days
    : [];
  const programExerciseCount = programDays.reduce((sum: number, day: any) => {
    return sum + (Array.isArray(day?.exercises) ? day.exercises.length : 0);
  }, 0);

  const nextSchedule = (
    Array.isArray(upcomingSchedules) ? upcomingSchedules : []
  )
    // A started-but-unfinished session is still the next one — it is the session to resume.
    // Filtering on "has no workout row" hid today's session the moment it was started (startSchedule
    // creates the workout immediately, status IN_PROGRESS) and jumped to next week's.
    .filter(
      (schedule: WorkoutScheduleRecord) =>
        schedule.status !== "COMPLETED" &&
        schedule.status !== "SKIPPED" &&
        schedule.status !== "CANCELLED",
    )
    .sort(
      (a: WorkoutScheduleRecord, b: WorkoutScheduleRecord) =>
        parseApiDateOnly(a.date).getTime() - parseApiDateOnly(b.date).getTime(),
    )[0];
  const nextProgramDay = nextSchedule?.programDay;
  const nextExerciseCount = nextProgramDay?.exercises?.length ?? 0;

  // D4: the backend's cycle verdict for the effective goal. Most recent cycle that has signals.
  const signalCycle = (Array.isArray(recentCycles) ? recentCycles : []).find((c) => c?.summary?.progressSignals);
  const ps = signalCycle?.summary?.progressSignals;
  const verdictInput: VerdictInput = {
    effectiveGoal: coherence?.effectiveGoal?.goal ?? null,
    phaseType: coherence?.effectiveGoal?.phaseType ?? null,
    coherent: coherence ? coherence.coherent !== false : true,
    cycle: signalCycle && ps
      ? { goal: signalCycle.goal ?? null, bodyComposition: ps.signalBreakdown?.bodyComposition ?? null, deltaSMM: ps.deltaSMM ?? null, deltaPBF: ps.deltaPBF ?? null }
      : null,
  };
  const goalName = goalDisplayName(verdictInput) ?? (profile?.goal ? goalLabels[profile.goal] : null);

  const kpis: Array<{ label: string; value: string; change: string; icon: React.ElementType; color: string; bg: string; iconBg: string; border: string; verdict?: Verdict }> = [
    {
      label: "Cân nặng",
      value: latest?.weight ? `${latest.weight} kg` : "---",
      change: calcChange(latest?.weight, prev?.weight) + (prev ? " kg" : ""),
      // D4: a static "trending down" icon read as "down is good"; weight is never judged.
      icon: Scale,
      verdict: bodyCompVerdict("weight", verdictInput),
      color: "text-green-400",
      bg: "bg-green-500/10",
      iconBg: "bg-green-500/15",
      border: "border-green-500/20",
    },
    {
      label: "Cơ bắp",
      value: latest?.muscleMass ? `${latest.muscleMass} kg` : "---",
      change:
        calcChange(latest?.muscleMass, prev?.muscleMass) + (prev ? " kg" : ""),
      icon: PersonSimple,
      verdict: bodyCompVerdict("muscle", verdictInput),
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      iconBg: "bg-blue-500/15",
      border: "border-blue-500/20",
    },
    {
      label: "Mỡ cơ thể",
      value: latest?.bodyFatPct ? `${latest.bodyFatPct}%` : "---",
      change:
        calcChange(latest?.bodyFatPct, prev?.bodyFatPct) + (prev ? "%" : ""),
      icon: Flame,
      verdict: bodyCompVerdict("fat", verdictInput),
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      iconBg: "bg-orange-500/15",
      border: "border-orange-500/20",
    },
    {
      label: "Buổi tập",
      value: Array.isArray(monthWorkouts) ? String(monthWorkouts.length) : "---",
      change: "30 ngày qua",
      icon: Dumbbell,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      iconBg: "bg-emerald-500/15",
      border: "border-emerald-500/20",
    },
  ];

  const chartHistory = [...sortedInBodyHistory].sort((a: any, b: any) =>
    inBodyDateKey(a).localeCompare(inBodyDateKey(b)),
  );

  const weightData = chartHistory.map((h: any) => ({
    date: parseInBodyMeasurementDate(h).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    }),
    value: h.weight,
  }));

  const muscleData = chartHistory.map((h: any) => ({
    date: parseInBodyMeasurementDate(h).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    }),
    value: h.muscleMass,
  }));

  // ── Frontend 2.0 sample screen (visual polish groups: consistency/contrast, micro-interactions,
  //    hierarchy, UI states, mobile). Data, queries, navigation targets and D4 logic unchanged;
  //    only hierarchy and presentation. Order = what a client opens the app for:
  //    1) next session  2) body metrics (+ D4 verdict)  3) trends  4) shortcuts  5) food  6) history.
  const card = "rounded-2xl border border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md";
  const fmtNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : null);
  const hasInBody = sortedInBodyHistory.length > 0;
  const lastMeasured = latest ? parseInBodyMeasurementDate(latest) : null;
  const lastMeasuredLabel = lastMeasured && !Number.isNaN(lastMeasured.getTime()) ? lastMeasured.toLocaleDateString("vi-VN") : null;
  const tiles = [
    { key: "weight", label: "Cân nặng", icon: Scale, value: fmtNum(latest?.weight), unit: "kg", change: prev ? `${calcChange(latest?.weight, prev?.weight)} kg` : null, verdict: kpis[0]?.verdict },
    { key: "muscle", label: "Cơ bắp", icon: PersonSimple, value: fmtNum(latest?.muscleMass), unit: "kg", change: prev ? `${calcChange(latest?.muscleMass, prev?.muscleMass)} kg` : null, verdict: kpis[1]?.verdict },
    { key: "fat", label: "Mỡ cơ thể", icon: Flame, value: fmtNum(latest?.bodyFatPct), unit: "%", change: prev ? `${calcChange(latest?.bodyFatPct, prev?.bodyFatPct)}%` : null, verdict: kpis[2]?.verdict },
    { key: "sessions", label: "Buổi tập", icon: Dumbbell, value: Array.isArray(monthWorkouts) ? String(monthWorkouts.length) : null, unit: "", change: "trong 30 ngày qua", verdict: undefined },
  ];
  const shortcuts = [
    { label: "Nhật ký tập", icon: Dumbbell, to: "/client/workout" },
    { label: "Kế hoạch", icon: Brain, to: "/client/plans" },
    { label: "Nhắn tin PT", icon: MessageSquare, to: "/client/chat" },
    { label: "Đặt lịch", icon: Calendar, to: "/client/booking" },
  ];
  const recent = Array.isArray(workoutHistory) ? workoutHistory.slice(0, 5) : [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <GoalCoherenceBanner />

      {/* Header: greeting + date; one neutral goal chip (no glowing status dot, no "Phiên hoạt động" filler). */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-zinc-400 first-letter:">{today}</p>
          <h1 className="mt-0.5 text-zinc-50">Xin chào, {firstName}</h1>
        </div>
        {goalName && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-300">
            <Target className="h-3.5 w-3.5 text-green-400" aria-hidden />
            Mục tiêu: {goalName}
          </span>
        )}
      </header>

      {/* 1) The one thing to do today. */}
      <section aria-labelledby="dash-next" className={`${card} p-5`}>
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-green-500/25 bg-green-500/10">
            <Calendar className="h-5 w-5 text-green-400" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="dash-next" className="text-xs font-medium text-zinc-400">
              {nextSchedule ? "Buổi tập tiếp theo" : "Lịch tập"}
            </h2>
            {nextSchedule ? (
              <>
                <p className="mt-1 truncate text-lg font-semibold text-zinc-50">{nextProgramDay?.title || "Buổi tập"}</p>
                <p className="mt-0.5 text-sm text-zinc-400">
                  <span className="first-letter:">{formatScheduleDate(nextSchedule.date)}</span>
                  {nextExerciseCount ? ` · ${nextExerciseCount} bài tập` : ""}
                  {nextProgramDay?.program?.name ? ` · ${nextProgramDay.program.name}` : ""}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-base font-semibold text-zinc-100">Chưa có buổi tập sắp tới</p>
                <p className="mt-0.5 text-sm text-zinc-400">
                  {currentProgram
                    ? `Kế hoạch: ${currentProgram.name || "chương trình hiện tại"} · ${programDays.length || currentProgram.daysPerWeek || "–"} ngày · ${programExerciseCount || "–"} bài tập`
                    : "Tạo kế hoạch bằng AI hoặc tự tạo trong nhật ký tập để bắt đầu."}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate("/client/workout")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-green-500 px-5 text-sm font-semibold text-black transition-colors hover:bg-green-400"
          >
            {nextSchedule ? "Mở buổi tập" : currentProgram ? "Lên lịch trong nhật ký tập" : "Mở nhật ký tập"}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          {!currentProgram && !nextSchedule && (
            <button
              type="button"
              onClick={() => navigate("/client/plans")}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
            >
              Tạo kế hoạch AI
            </button>
          )}
        </div>
      </section>

      {/* 2) Body metrics — neutral tiles (colour only for the D4 verdict), sentence-case labels. */}
      <section aria-labelledby="dash-body" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 id="dash-body" className="text-sm font-semibold text-zinc-200">Chỉ số cơ thể</h2>
          <button
            type="button"
            onClick={() => navigate("/client/inbody")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-green-400 transition-colors hover:bg-zinc-900 hover:text-green-300"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Tải InBody
          </button>
        </div>
        {!hasInBody && (
          <p className="rounded-xl border border-zinc-800/80 bg-zinc-950/85 px-4 py-3 text-sm text-zinc-300 backdrop-blur-md">
            Chưa có kết quả InBody. Tải phiếu lên để theo dõi cân nặng, khối cơ và tỷ lệ mỡ.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.key} className={`${card} flex flex-col p-4`}>
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                <t.icon className="h-4 w-4 text-zinc-500" aria-hidden />
                {t.label}
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50 tabular-nums">
                {t.value ?? <span className="text-base font-medium text-zinc-500">Chưa có</span>}
                {t.value && t.unit && <span className="ml-1 text-sm font-medium text-zinc-400">{t.unit}</span>}
              </div>
              {t.change && t.value && <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">{t.key === "sessions" ? t.change : `${t.change} so với lần đo trước`}</p>}
              {t.verdict?.label && (
                <div
                  data-testid="kpi-verdict"
                  className={`mt-3 inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-snug ${
                    t.verdict.tone === "success"
                      ? "border-st-success-border bg-st-success-bg text-st-success"
                      : t.verdict.tone === "warning"
                        ? "border-st-warning-border bg-st-warning-bg text-st-warning"
                        : "border-st-neutral-border bg-st-neutral-bg text-st-neutral"
                  }`}
                >
                  {t.verdict.icon === "up" ? <ArrowUp className="mt-px h-3 w-3 shrink-0" aria-hidden /> : t.verdict.icon === "down" ? <ArrowDown className="mt-px h-3 w-3 shrink-0" aria-hidden /> : t.verdict.icon === "steady" ? <Minus className="mt-px h-3 w-3 shrink-0" aria-hidden /> : <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />}
                  <span>{t.verdict.label}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {lastMeasuredLabel && <p className="text-xs text-zinc-500">Lần đo gần nhất: {lastMeasuredLabel}</p>}
        {verdictInput.phaseType === "RECOMPOSITION" && verdictInput.coherent && (
          <p className="text-xs text-zinc-500" data-testid="recomp-note">
            Giai đoạn tái cấu trúc cơ thể chưa có quy tắc đánh giá tiến độ riêng, nên Gymini chỉ hiển thị các chỉ số đo được.
          </p>
        )}
      </section>

      {/* 3) Trends — only when there is something to draw. The always-empty "Calories tuần này"
             placeholder (device sync does not exist in the app) is not shown. */}
      {(weightData.length > 1 || muscleData.length > 1) && (
        <section aria-labelledby="dash-trends" className="space-y-3">
          <h2 id="dash-trends" className="text-sm font-semibold text-zinc-200">Xu hướng</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {weightData.length > 1 && (
              <div className={`${card} p-4`}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-300">Cân nặng</h3>
                  <span className="text-xs text-zinc-500 tabular-nums">{calcChange(latest?.weight, prev?.weight)} kg</span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={weightData}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Cân nặng"]} />
                    <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.1} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            {muscleData.length > 1 && (
              <div className={`${card} p-4`}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-300">Cơ bắp</h3>
                  <span className="text-xs text-zinc-500 tabular-nums">{calcChange(latest?.muscleMass, prev?.muscleMass)} kg</span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={muscleData}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Cơ bắp"]} />
                    <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", strokeWidth: 0, r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 4) Shortcuts — one line each, equal size, 2×2 on a phone (was 3+2 tiles with wrapping labels). */}
      <section aria-labelledby="dash-shortcuts" className="space-y-3">
        <h2 id="dash-shortcuts" className="text-sm font-semibold text-zinc-200">Lối tắt</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => navigate(s.to)}
              className={`${card} flex min-h-12 items-center gap-3 px-3 text-left text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-900/90`}
            >
              <s.icon className="h-5 w-5 shrink-0 text-green-400" aria-hidden />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 5) Food (shared component, unchanged). */}
      <DayMacroQuickEstimate variant="compact" />

      {/* 6) History + tips. Rows instead of a 400px-min table that scrolled sideways on a phone. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="dash-recent" className={card}>
          <div className="flex items-center justify-between border-b border-zinc-800/70 px-4 py-3">
            <h2 id="dash-recent" className="text-sm font-semibold text-zinc-200">Tập luyện gần đây</h2>
            <button
              type="button"
              onClick={() => navigate("/client/workout")}
              className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-semibold text-green-400 transition-colors hover:bg-zinc-900 hover:text-green-300"
            >
              Xem tất cả
            </button>
          </div>
          {recent.length > 0 ? (
            <ul className="divide-y divide-zinc-800/60">
              {recent.map((w: any, i: number) => (
                <li key={w.id ?? i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">{w.name || "Buổi tập"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{new Date(w.date).toLocaleDateString("vi-VN")}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-zinc-400 tabular-nums">
                    {w.duration ? `${w.duration} phút` : "–"}
                    <span className="block">{Array.isArray(w.exercises) ? `${w.exercises.length} bài` : ""}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">Chưa có buổi tập nào được ghi lại.</p>
          )}
        </section>

        {/* Was "AI Insights · Trực tiếp": the text is a fixed template, not AI and not live — renamed, label removed. */}
        <section aria-labelledby="dash-tips" className={`${card} p-4`}>
          <h2 id="dash-tips" className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Brain className="h-4 w-4 text-green-400" aria-hidden />
            Gợi ý
          </h2>
          {latest ? (
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              <li className="rounded-lg bg-zinc-900/80 px-3 py-2">Cân nặng hiện tại của bạn là {fmtNum(latest.weight) ?? latest.weight} kg. Tiếp tục theo dõi sau mỗi lần đo.</li>
              <li className="rounded-lg bg-zinc-900/80 px-3 py-2">Khối cơ hiện tại {fmtNum(latest.muscleMass) ?? latest.muscleMass} kg. Bổ sung đủ đạm theo mục tiêu dinh dưỡng của bạn.</li>
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Tải kết quả InBody để nhận gợi ý theo chỉ số của bạn.</p>
          )}
          <p className="mt-3 text-xs text-zinc-500">Gợi ý chỉ mang tính tham khảo, không phải lời khuyên y tế.</p>
        </section>
      </div>
    </div>
  );
}
