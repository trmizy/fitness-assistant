/*
 * OBSIDIAN GLASS Client dashboard (design prototype, branch frontend2/obsidian-dashboard-prototype).
 *
 * Same queries + keys as ClientDashboard (one cache), same D4 verdict rules, same navigation targets, every existing
 * feature kept: next session, body metrics + verdicts, trends, shortcuts (Nhật ký tập, Kế hoạch, Nhắn tin PT,
 * Đặt lịch), DayMacroQuickEstimate ("Hôm nay bạn đã ăn gì?" + macro estimate), recent workouts, tips, the goal
 * coherence banner and the recomposition note. Only hierarchy and presentation change:
 *   1) header  2) overview KPIs  3) body analysis hero | composition + trend  4) next session | plan | recent
 *   5) shortcuts  6) food | tips   (visual direction: the owner's Obsidian Glass reference image)
 * Per-section states come from listDataState (R1): an API error is never shown as "no data" or a fake 0.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownIcon, ArrowUpIcon, ArrowRightIcon, BarbellIcon, BrainIcon, CalendarIcon, ChatTextIcon, InfoIcon, MinusIcon, TargetIcon, ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { givenName } from "../../utils/givenName";
import { DayMacroQuickEstimate } from "../../components/nutrition/DayMacroEstimate";
import { profileService, inbodyService, workoutService, fitnessRoadmapService, trainingCycleService, type WorkoutScheduleRecord } from "../../services/api";
import { bodyCompVerdict, goalDisplayName, type Verdict, type VerdictInput } from "../../utils/goalVerdict";
import { listDataState, DASHBOARD_ERROR_TEXT } from "../../utils/dashboardDataState";
import { GoalCoherenceBanner } from "../../components/GoalCoherenceBanner";
import { BodyAnalysis } from "../../components/dashboard/BodyAnalysis";
import { PageSkeleton } from "../../components/layout/PageSkeleton";
// Same date/goal helpers as the current dashboard (shared module, not re-implemented).
import { toDateInputValue, parseApiDateOnly, formatScheduleDate, inBodyDateKey, parseInBodyMeasurementDate, goalLabels } from "../../utils/dashboardHelpers";

const EASE = [0.22, 1, 0.36, 1] as const;
const fmt = (v: unknown, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: d }) : null);

function VerdictChip({ v }: { v?: Verdict }) {
  if (!v?.label) return null;
  const tone = v.tone === "success" ? "border-st-success-border bg-st-success-bg text-st-success" : v.tone === "warning" ? "border-st-warning-border bg-st-warning-bg text-st-warning" : "border-st-neutral-border bg-st-neutral-bg text-st-neutral";
  const Icon = v.icon === "up" ? ArrowUpIcon : v.icon === "down" ? ArrowDownIcon : v.icon === "steady" ? MinusIcon : InfoIcon;
  return (
    <span data-testid="kpi-verdict" className={`mt-2 inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-snug ${tone}`}>
      <Icon className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{v.label}</span>
    </span>
  );
}

function SectionError({ text, onRetry, busy, testId }: { text: string; onRetry: () => void; busy: boolean; testId: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-col items-start gap-3 rounded-2xl border border-st-warning-border bg-st-warning-bg p-4 text-sm text-st-warning">
      <p>{text}</p>
      <button type="button" onClick={onRetry} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-current px-4 font-semibold disabled:opacity-60">
        <ArrowClockwiseIcon className="h-4 w-4" aria-hidden="true" />
        {busy ? DASHBOARD_ERROR_TEXT.retrying : DASHBOARD_ERROR_TEXT.retry}
      </button>
    </div>
  );
}

type TrendKey = "weight" | "muscleMass" | "bodyFatPct";
const TREND: Record<TrendKey, { label: string; unit: string }> = { weight: { label: "Cân nặng", unit: "kg" }, muscleMass: { label: "Cơ bắp", unit: "kg" }, bodyFatPct: { label: "Mỡ cơ thể", unit: "%" } };

export function ObsidianDashboard() {
  return <ObsidianDashboardInner />;
}

function ObsidianDashboardInner() {
  const { user } = useApp();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const today = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const upcomingEnd = new Date(todayStart); upcomingEnd.setDate(upcomingEnd.getDate() + 30);
  const monthAgo = new Date(todayStart); monthAgo.setDate(monthAgo.getDate() - 30);
  const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);

  const profileQuery = useQuery({ queryKey: ["profile", user?.id], queryFn: async () => (await profileService.getProfile()).profile, enabled: !!user?.id });
  const inbodyQuery = useQuery({ queryKey: ["inbody-history"], queryFn: inbodyService.getHistory });
  const workoutQuery = useQuery({ queryKey: ["workout-history"], queryFn: () => workoutService.getHistory(1, 4) });
  const monthQuery = useQuery({ queryKey: ["workout-history", "30d", toDateInputValue(monthAgo)], queryFn: () => workoutService.getInRange(toDateInputValue(monthAgo), toDateInputValue(tomorrow)) });
  const programQuery = useQuery({ queryKey: ["current-workout-program"], queryFn: () => workoutService.getCurrentProgram() });
  const schedulesQuery = useQuery({
    queryKey: ["workout-schedules", "dashboard-upcoming"],
    queryFn: () => workoutService.getSchedules(10, { startDate: toDateInputValue(todayStart), endDate: toDateInputValue(upcomingEnd) }),
  });
  const coherenceQuery = useQuery({ queryKey: ["goal-coherence"], queryFn: fitnessRoadmapService.getGoalCoherence, enabled: !!user?.id, staleTime: 60_000 });
  const cyclesQuery = useQuery({ queryKey: ["training-cycles", "recent", 5], queryFn: () => trainingCycleService.list(5), enabled: !!user?.id, staleTime: 60_000 });
  const [trend, setTrend] = useState<TrendKey>("weight");
  const profile = profileQuery.data;
  const coherence = coherenceQuery.data;
  const recentCycles = cyclesQuery.data;
  // First paint waits for the same core queries as the previous dashboard. One skeleton, then the whole page.
  // Errors/empties are still per section below (R1).
  const firstLoad = [profileQuery, inbodyQuery, workoutQuery, monthQuery, programQuery, schedulesQuery].some((q) => q.isLoading);
  // The D4 inputs are NOT awaited (they cost ~0.7-0.9 s of data-ready on slow 4G); the verdict slot is reserved instead.
  const verdictPending = coherenceQuery.isLoading || cyclesQuery.isLoading;

  const history = useMemo(() => {
    const rows: any[] = Array.isArray(inbodyQuery.data) ? inbodyQuery.data : [];
    return [...rows].sort((a, b) => inBodyDateKey(b).localeCompare(inBodyDateKey(a)) || Date.parse(String(b?.createdAt ?? 0)) - Date.parse(String(a?.createdAt ?? 0)));
  }, [inbodyQuery.data]);
  const latest = history[0] ?? null;
  const prev = history[1] ?? null;
  const bodyState = listDataState(inbodyQuery);
  const measuredAt = latest ? parseInBodyMeasurementDate(latest) : null;
  const measuredLabel = measuredAt && !Number.isNaN(measuredAt.getTime()) ? measuredAt.toLocaleDateString("vi-VN") : null;

  if (firstLoad) return <PageSkeleton />;

  // D4 — unchanged rules
  const signalCycle = (Array.isArray(recentCycles) ? recentCycles : []).find((c: any) => c?.summary?.progressSignals);
  const ps = signalCycle?.summary?.progressSignals;
  const verdictInput: VerdictInput = {
    effectiveGoal: coherence?.effectiveGoal?.goal ?? null,
    phaseType: coherence?.effectiveGoal?.phaseType ?? null,
    coherent: coherence ? coherence.coherent !== false : true,
    cycle: signalCycle && ps ? { goal: signalCycle.goal ?? null, bodyComposition: ps.signalBreakdown?.bodyComposition ?? null, deltaSMM: ps.deltaSMM ?? null, deltaPBF: ps.deltaPBF ?? null } : null,
  };
  const goalName = goalDisplayName(verdictInput) ?? (profile?.goal ? goalLabels[profile.goal] : null);
  const change = (k: TrendKey, unit: string) => (latest && prev && typeof latest[k] === "number" && typeof prev[k] === "number" ? `${latest[k] - prev[k] > 0 ? "+" : ""}${fmt(latest[k] - prev[k])} ${unit}` : null);

  const comp = [
    { key: "weight" as const, label: "Cân nặng", value: fmt(latest?.weight), unit: "kg", change: change("weight", "kg"), verdict: bodyCompVerdict("weight", verdictInput) },
    { key: "muscle" as const, label: "Cơ bắp", value: fmt(latest?.muscleMass), unit: "kg", change: change("muscleMass", "kg"), verdict: bodyCompVerdict("muscle", verdictInput) },
    { key: "fat" as const, label: "Mỡ cơ thể", value: fmt(latest?.bodyFatPct), unit: "%", change: change("bodyFatPct", "%"), verdict: bodyCompVerdict("fat", verdictInput) },
  ];
  const extra = [
    { label: "BMI", value: fmt(latest?.bmi) },
    { label: "Mỡ nội tạng", value: latest?.visceralFat ? `Mức ${fmt(latest.visceralFat)}` : null },
    { label: "BMR", value: latest?.bmr ? `${fmt(latest.bmr, 0)} kcal` : null },
  ].filter((x) => x.value);

  const trendData = [...history].reverse()
    .map((h: any) => ({ date: parseInBodyMeasurementDate(h).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }), value: typeof h[trend] === "number" ? h[trend] : null }))
    .filter((p) => p.value != null);
  const trendAvail = (k: TrendKey) => history.filter((h: any) => typeof h[k] === "number").length >= 2;
  const trendOptions = (Object.keys(TREND) as TrendKey[]).filter(trendAvail);
  const trendNow = trendOptions.includes(trend) ? trend : trendOptions[0];

  const schedules = Array.isArray(schedulesQuery.data) ? schedulesQuery.data : [];
  const nextSchedule = schedules
    .filter((s: WorkoutScheduleRecord) => s.status !== "COMPLETED" && s.status !== "SKIPPED" && s.status !== "CANCELLED")
    .sort((a: WorkoutScheduleRecord, b: WorkoutScheduleRecord) => parseApiDateOnly(a.date).getTime() - parseApiDateOnly(b.date).getTime())[0];
  const nextDay = nextSchedule?.programDay;
  const program = programQuery.data ?? null;
  const programDays = Array.isArray(program?.days) ? program.days : [];
  const programExercises = programDays.reduce((n: number, d: any) => n + (Array.isArray(d?.exercises) ? d.exercises.length : 0), 0);
  const monthState = listDataState(monthQuery);
  const recentState = listDataState(workoutQuery);
  const recent = Array.isArray(workoutQuery.data) ? workoutQuery.data.slice(0, 5) : [];
  const nextLoading = schedulesQuery.isLoading || programQuery.isLoading;
  const nextError = schedulesQuery.isError && !schedulesQuery.data;

  const shortcuts = [
    { label: "Nhật ký tập", icon: BarbellIcon, to: "/client/workout" },
    { label: "Kế hoạch", icon: BrainIcon, to: "/client/plans" },
    { label: "Nhắn tin PT", icon: ChatTextIcon, to: "/client/chat" },
    { label: "Đặt lịch", icon: CalendarIcon, to: "/client/booking" },
  ];
  const enter = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.32, ease: EASE, delay: 0.04 * i } });

  // Weight split for the composition bar — same unit (kg) parts of one total, never mixed units.
  const W = typeof latest?.weight === "number" ? latest.weight : null;
  const M = typeof latest?.muscleMass === "number" ? latest.muscleMass : null;
  const F = typeof latest?.bodyFat === "number" && latest.bodyFat > 0 ? latest.bodyFat : W && typeof latest?.bodyFatPct === "number" ? (W * latest.bodyFatPct) / 100 : null;
  const rest = W != null && M != null && F != null ? W - M - F : null;
  const split = W && M != null && F != null && rest != null && rest > 0
    ? [
        { key: "m", label: "Cơ bắp", kg: M, cls: "bg-[var(--ob-accent)]" },
        { key: "f", label: "Mỡ", kg: F, cls: "bg-[var(--ob-text-2)]" },
        { key: "r", label: "Phần còn lại", kg: rest, cls: "bg-[var(--ob-elevated)]" },
      ]
    : null;
  const lastPoint = trendData[trendData.length - 1];

  return (
    <div className="ob-stage min-h-full">
      <div className="mx-auto w-full max-w-[1360px] space-y-5 p-4 md:p-6 lg:p-8">
        <GoalCoherenceBanner />

        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-[var(--ob-text-2)] first-letter:uppercase">{today}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-[-0.01em] text-[var(--ob-text)] md:text-[28px]">Xin chào, {givenName(user)}</h1>
          </div>
          {goalName && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--ob-hair-strong)] bg-[var(--ob-glass)] px-3 py-1.5 text-xs font-medium text-[var(--ob-text)] backdrop-blur-md">
              <TargetIcon className="h-3.5 w-3.5 text-[var(--ob-accent-ink)]" aria-hidden="true" /> Mục tiêu: {goalName}
            </span>
          )}
        </header>

        {/* Overview — only metrics the API really has. On an InBody error the three body KPIs are not drawn (no "Chưa có", no 0). */}
        <section aria-label="Tổng quan" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <motion.div className="ob-panel p-4" {...enter(0)}>
            <div className="flex items-center gap-2 text-xs text-[var(--ob-text-2)]"><BarbellIcon className="h-4 w-4 text-[var(--ob-accent-ink)]" aria-hidden="true" />Buổi tập</div>
            {monthState === "error" ? <p className="mt-2 text-sm text-st-warning" role="alert">Không tải được số buổi tập</p>
              : monthState === "loading" ? <div className="mt-2 h-8 w-20 animate-pulse rounded bg-[var(--ob-surface-2)]" />
              : <p className="ob-num mt-1.5 text-[28px] font-semibold leading-none text-[var(--ob-text)]">{Array.isArray(monthQuery.data) ? monthQuery.data.length : "—"}<span className="ml-1.5 text-sm font-medium text-[var(--ob-text-2)]">buổi</span></p>}
            <p className="mt-1.5 text-xs text-[var(--ob-text-3)]">trong 30 ngày qua</p>
          </motion.div>
          {bodyState === "error" ? (
            <div className="ob-panel col-span-1 flex items-center p-4 text-sm text-[var(--ob-text-2)] lg:col-span-3" data-testid="ob-kpi-error">Chưa tải được chỉ số cơ thể — xem phần Phân tích cơ thể để thử lại.</div>
          ) : comp.map((c, i) => (
            <motion.div key={c.key} className="ob-panel p-4" {...enter(i + 1)}>
              <div className="text-xs text-[var(--ob-text-2)]">{c.label}</div>
              {bodyState === "loading" ? <div className="mt-2 h-8 w-24 animate-pulse rounded bg-[var(--ob-surface-2)]" />
                : c.value ? <p className="ob-num mt-1.5 text-[28px] font-semibold leading-none text-[var(--ob-text)]">{c.value}<span className="ml-1 text-sm font-medium text-[var(--ob-text-2)]">{c.unit}</span></p>
                : <p className="mt-2 text-sm text-[var(--ob-text-3)]">{bodyState === "empty" ? "Chưa có phiếu InBody" : "Không có trên phiếu"}</p>}
              {c.value && <p className="ob-num mt-1.5 text-xs text-[var(--ob-text-3)]">{c.change ? `${c.change} so với lần đo trước` : "Lần đo đầu tiên"}</p>}
              {/* Reserved slot: the chip arrives with the D4 queries without moving anything below. */}
              <div className="min-h-[52px] lg:min-h-[34px]">{verdictPending ? null : <VerdictChip v={c.verdict} />}</div>
            </motion.div>
          ))}
        </section>

        {/* Hero + right column */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <motion.div className="xl:col-span-7 2xl:col-span-8" {...enter(2)}>
            <BodyAnalysis state={bodyState === "loading" ? "loading" : bodyState === "error" ? "error" : bodyState === "empty" ? "empty" : "ready"} latest={latest} prev={prev} measuredLabel={measuredLabel} onRetry={() => inbodyQuery.refetch()} retrying={inbodyQuery.isFetching} />
          </motion.div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:col-span-5 xl:grid-cols-1 xl:content-start 2xl:col-span-4">
            <motion.section aria-labelledby="ob-comp" className="ob-panel p-5" {...enter(3)}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="ob-comp" className="text-base font-semibold text-[var(--ob-text)]">Thành phần cơ thể</h2>
                {measuredLabel && bodyState === "ready" && <span className="ob-num text-xs text-[var(--ob-text-3)]">{measuredLabel}</span>}
              </div>
              {bodyState === "loading" ? <div className="mt-4 h-16 animate-pulse rounded bg-[var(--ob-surface-2)]" aria-busy="true" />
                : bodyState === "error" ? <p className="mt-3 text-sm text-[var(--ob-text-2)]">Chưa tải được chỉ số.</p>
                : bodyState === "empty" ? <p className="mt-3 text-sm text-[var(--ob-text-2)]">Cân nặng được chia thành cơ bắp, mỡ và phần còn lại sau lần tải phiếu InBody đầu tiên.</p>
                : (
                  <>
                    {split ? (
                      <figure className="mt-4" data-testid="ob-split">
                        <p className="ob-num text-[28px] font-semibold leading-none text-[var(--ob-text)]">{fmt(W)}<span className="ml-1 text-sm font-medium text-[var(--ob-text-2)]">kg tổng</span></p>
                        <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Cân nặng ${fmt(W)} kg gồm ${split.map((s) => `${s.label.toLowerCase()} ${fmt(s.kg)} kg`).join(", ")}`}>
                          {split.map((s, i) => <motion.span key={s.key} className={`${s.cls} h-full`} style={{ width: `${(s.kg / W!) * 100}%`, transformOrigin: "left" }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: EASE, delay: 0.15 + i * 0.06 }} />)}
                        </div>
                        <dl className="mt-3 space-y-1.5 text-sm">
                          {split.map((s) => (
                            <div key={s.key} className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.cls}`} aria-hidden="true" />
                              <dt className="flex-1 text-[var(--ob-text-2)]">{s.label}</dt>
                              <dd className="ob-num text-[var(--ob-text)]">{fmt(s.kg)} kg</dd>
                              <dd className="ob-num w-12 text-right text-[var(--ob-text-3)]">{fmt((s.kg / W!) * 100, 0)}%</dd>
                            </div>
                          ))}
                        </dl>
                        <figcaption className="mt-2 text-[11px] text-[var(--ob-text-3)]">Phần còn lại là cân nặng trừ cơ bắp và mỡ: xương, nước, cơ quan và mô khác.</figcaption>
                      </figure>
                    ) : <p className="mt-3 text-sm text-[var(--ob-text-2)]">Phiếu này chưa đủ cân nặng, khối cơ và mỡ để chia thành phần.</p>}
                    {extra.length > 0 && (
                      <dl className="ob-inset mt-4 grid grid-cols-3 gap-2 p-3">
                        {extra.map((x) => <div key={x.label} className="min-w-0"><dt className="text-[11px] text-[var(--ob-text-3)]">{x.label}</dt><dd className="ob-num truncate text-sm font-medium text-[var(--ob-text)]">{x.value}</dd></div>)}
                      </dl>
                    )}
                    {verdictInput.phaseType === "RECOMPOSITION" && verdictInput.coherent && (
                      <p className="mt-3 text-xs text-[var(--ob-text-3)]" data-testid="recomp-note">Giai đoạn tái cấu trúc cơ thể chưa có quy tắc đánh giá tiến độ riêng, nên Gymini chỉ hiển thị các chỉ số đo được.</p>
                    )}
                  </>
                )}
            </motion.section>

            <motion.section aria-labelledby="ob-trend" className="ob-panel p-5" {...enter(4)}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="ob-trend" className="text-base font-semibold text-[var(--ob-text)]">Xu hướng</h2>
                {trendOptions.length > 1 && (
                  <div role="radiogroup" aria-label="Chỉ số" className="ob-seg">
                    {trendOptions.map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={k === trendNow} tabIndex={k === trendNow ? 0 : -1} onClick={() => setTrend(k)}
                        onKeyDown={(e) => { const i = trendOptions.indexOf(trendNow!); const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (d) { e.preventDefault(); const n = trendOptions[(i + d + trendOptions.length) % trendOptions.length]; setTrend(n); (e.currentTarget.parentElement?.querySelector(`[data-k="${n}"]`) as HTMLElement | null)?.focus(); } }}
                        data-k={k} className="ob-seg-btn">
                        {k === trendNow && <motion.span layoutId="ob-trend-pill" className="ob-seg-pill" aria-hidden="true" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 46 }} />}
                        {TREND[k].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {bodyState === "loading" ? <div className="mt-4 h-[180px] animate-pulse rounded-xl bg-[var(--ob-surface-2)]" aria-busy="true" />
                : bodyState === "error" ? <p className="mt-4 text-sm text-[var(--ob-text-2)]">Chưa tải được lịch sử số đo.</p>
                : !trendNow ? (
                  <p className="mt-4 rounded-xl border border-dashed border-[var(--ob-hair-strong)] px-4 py-8 text-center text-sm text-[var(--ob-text-2)]" data-testid="ob-trend-insufficient">
                    {history.length === 0 ? "Xu hướng sẽ hiện khi có phiếu InBody." : "Cần ít nhất hai lần đo để vẽ xu hướng. Bạn mới có một lần đo."}
                  </p>
                ) : (
                  <figure className="mt-3" aria-label={`${TREND[trendNow].label} qua ${trendData.length} lần đo: ${trendData.map((p) => `${p.date} ${fmt(p.value)} ${TREND[trendNow].unit}`).join(", ")}`}>
                    <div aria-hidden="true">
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={trendData} margin={{ top: 28, right: 12, bottom: 0, left: -14 }}>
                          <defs><linearGradient id="ob-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.24} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid stroke="var(--ob-hair)" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--ob-text-3)" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "var(--ob-text-3)" }} axisLine={false} tickLine={false} width={44} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v: number) => fmt(v) ?? ""} />
                          <Tooltip cursor={{ stroke: "var(--ob-hair-strong)" }} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--ob-hair-strong)", background: "var(--ob-surface)", color: "var(--ob-text)" }} formatter={(v: number) => [`${fmt(v)} ${TREND[trendNow].unit}`, TREND[trendNow].label]} />
                          <Area key={trendNow} type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="url(#ob-area)" isAnimationActive={!reduce} animationDuration={600} animationEasing="ease-out"
                            dot={(props: any) => {
                              const last = props.index === trendData.length - 1;
                              return (
                                <g key={props.index}>
                                  <circle cx={props.cx} cy={props.cy} r={last ? 4.5 : 3} fill={last ? "var(--ob-text)" : "#22c55e"} stroke={last ? "#22c55e" : "none"} strokeWidth={last ? 2 : 0} />
                                  {last && lastPoint && (
                                    <g transform={`translate(${props.cx - 66}, ${props.cy - 30})`}>
                                      <rect width="60" height="20" rx="6" fill="var(--ob-surface-2)" stroke="var(--ob-accent-line)" />
                                      <text x="30" y="14" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ob-text)">{fmt(lastPoint.value)} {TREND[trendNow].unit}</text>
                                    </g>
                                  )}
                                </g>
                              );
                            }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <figcaption className="ob-num mt-1 text-xs text-[var(--ob-text-3)]">{trendData.length} lần đo · gần nhất {lastPoint?.date}</figcaption>
                  </figure>
                )}
            </motion.section>
          </div>
        </div>

        {/* Next session | current plan | recent workouts */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <section aria-labelledby="ob-next" className="ob-panel p-5">
            <h2 id="ob-next" className="flex items-center gap-2 text-base font-semibold text-[var(--ob-text)]"><CalendarIcon className="h-[18px] w-[18px] text-[var(--ob-text-2)]" aria-hidden="true" />{nextSchedule ? "Buổi tập tiếp theo" : "Lịch tập"}</h2>
            {nextLoading ? (
              <div className="mt-3 space-y-2" aria-busy="true"><div className="h-6 w-2/3 animate-pulse rounded bg-[var(--ob-surface-2)]" /><div className="h-4 w-1/2 animate-pulse rounded bg-[var(--ob-surface-2)]" /></div>
            ) : nextError ? (
              <div className="mt-3"><SectionError testId="ob-next-error" text="Không tải được lịch tập. Hãy thử lại." onRetry={() => schedulesQuery.refetch()} busy={schedulesQuery.isFetching} /></div>
            ) : nextSchedule ? (
              <>
                <p className="mt-3 text-xl font-semibold text-[var(--ob-text)]">{nextDay?.title || "Buổi tập"}</p>
                <p className="mt-1 text-sm text-[var(--ob-text-2)]"><span className="first-letter:uppercase">{formatScheduleDate(nextSchedule.date)}</span>{nextDay?.exercises?.length ? <> · <span className="ob-num">{nextDay.exercises.length}</span> bài tập</> : null}{nextDay?.program?.name ? ` · ${nextDay.program.name}` : ""}</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-base font-semibold text-[var(--ob-text)]">Chưa có buổi tập sắp tới</p>
                <p className="mt-1 text-sm text-[var(--ob-text-2)]">{program ? "Lên lịch các buổi của kế hoạch trong nhật ký tập." : "Tạo kế hoạch bằng AI hoặc tự tạo trong nhật ký tập để bắt đầu."}</p>
              </>
            )}
            {!nextLoading && !nextError && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => navigate("/client/workout")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--ob-accent)] px-5 text-sm font-semibold text-[var(--ob-on-accent)] transition-[filter] hover:brightness-110">
                  {nextSchedule ? "Mở buổi tập" : program ? "Lên lịch trong nhật ký tập" : "Mở nhật ký tập"} <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                {!program && !nextSchedule && <button type="button" onClick={() => navigate("/client/plans")} className="inline-flex min-h-11 items-center rounded-xl border border-[var(--ob-hair-strong)] px-4 text-sm font-semibold text-[var(--ob-text)] transition-colors hover:bg-[var(--ob-surface-2)]">Tạo kế hoạch AI</button>}
              </div>
            )}
          </section>

          <section aria-labelledby="ob-plan" className="ob-panel p-5">
            <h2 id="ob-plan" className="flex items-center gap-2 text-base font-semibold text-[var(--ob-text)]"><BrainIcon className="h-[18px] w-[18px] text-[var(--ob-text-2)]" aria-hidden="true" />Kế hoạch hiện tại</h2>
            {programQuery.isLoading ? <div className="mt-3 h-16 animate-pulse rounded bg-[var(--ob-surface-2)]" aria-busy="true" />
              : programQuery.isError && !programQuery.data ? <div className="mt-3"><SectionError testId="ob-plan-error" text="Không tải được kế hoạch tập. Hãy thử lại." onRetry={() => programQuery.refetch()} busy={programQuery.isFetching} /></div>
              : program ? (
                <>
                  <p className="mt-3 truncate text-xl font-semibold text-[var(--ob-text)]">{program.name || "Chương trình hiện tại"}</p>
                  <p className="ob-num mt-1 text-sm text-[var(--ob-text-2)]">{programDays.length || program.daysPerWeek || "–"} ngày tập mỗi tuần · {programExercises || "–"} bài tập</p>
                </>
              ) : <p className="mt-3 text-sm text-[var(--ob-text-2)]">Chưa có kế hoạch đang áp dụng.</p>}
            <button type="button" onClick={() => navigate("/client/plans")} className="-ml-3 mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ob-link">Mở kế hoạch <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></button>
          </section>

          <section aria-labelledby="ob-recent" className="ob-panel md:col-span-2 xl:col-span-1">
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 id="ob-recent" className="flex items-center gap-2 text-base font-semibold text-[var(--ob-text)]"><BarbellIcon className="h-[18px] w-[18px] text-[var(--ob-text-2)]" aria-hidden="true" />Tập luyện gần đây</h2>
              <button type="button" onClick={() => navigate("/client/workout")} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold ob-link">Xem tất cả</button>
            </div>
            {recentState === "error" ? <div className="p-4"><SectionError testId="dash-recent-error" text={DASHBOARD_ERROR_TEXT.workouts} onRetry={() => workoutQuery.refetch()} busy={workoutQuery.isFetching} /></div>
              : recentState === "loading" ? <div className="space-y-2 p-4">{[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-[var(--ob-surface-2)]" />)}</div>
              : recent.length ? (
                <ul className="divide-y divide-[var(--ob-hair)] px-2 pb-2">
                  {recent.map((w: any, i: number) => (
                    <li key={w.id ?? i} className="flex items-center justify-between gap-3 px-3 py-3">
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--ob-text)]">{w.name || "Buổi tập"}</p><p className="ob-num text-xs text-[var(--ob-text-3)]">{new Date(w.date).toLocaleDateString("vi-VN")}</p></div>
                      <p className="ob-num shrink-0 text-right text-xs text-[var(--ob-text-2)]">{w.duration ? `${w.duration} phút` : "–"}<span className="block">{Array.isArray(w.exercises) ? `${w.exercises.length} bài` : ""}</span></p>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-8 text-center text-sm text-[var(--ob-text-2)]">Chưa có buổi tập nào được ghi lại.</p>}
          </section>
        </div>

        {/* Shortcuts */}
        <section aria-labelledby="ob-shortcuts">
          <h2 id="ob-shortcuts" className="mb-3 text-sm font-medium text-[var(--ob-text-2)]">Lối tắt</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shortcuts.map((s) => (
              <button key={s.to} type="button" onClick={() => navigate(s.to)} className="ob-panel g-lift flex min-h-14 items-center gap-3 px-4 text-left text-sm font-semibold text-[var(--ob-text)] transition-colors hover:border-[var(--ob-hair-strong)]">
                <s.icon className="h-5 w-5 shrink-0 text-[var(--ob-accent-ink)]" aria-hidden="true" />
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Food (shared component, unchanged) | tips */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-8"><DayMacroQuickEstimate variant="compact" /></div>
          <section aria-labelledby="ob-tips" className="ob-panel p-5 xl:col-span-4 xl:self-start">
            <h2 id="ob-tips" className="flex items-center gap-2 text-sm font-semibold text-[var(--ob-text)]"><BrainIcon className="h-4 w-4 text-[var(--ob-accent-ink)]" aria-hidden="true" />Gợi ý</h2>
            {latest ? (
              <ul className="mt-3 space-y-2 text-sm text-[var(--ob-text-2)]">
                <li className="ob-inset px-3 py-2">Cân nặng hiện tại của bạn là <span className="ob-num">{fmt(latest.weight) ?? latest.weight}</span> kg. Tiếp tục theo dõi sau mỗi lần đo.</li>
                <li className="ob-inset px-3 py-2">Khối cơ hiện tại <span className="ob-num">{fmt(latest.muscleMass) ?? latest.muscleMass}</span> kg. Bổ sung đủ đạm theo mục tiêu dinh dưỡng của bạn.</li>
              </ul>
            ) : bodyState === "error" ? <p className="mt-3 text-sm text-[var(--ob-text-2)]">Gợi ý sẽ hiện khi tải được chỉ số cơ thể.</p>
              : <p className="mt-3 text-sm text-[var(--ob-text-2)]">Tải kết quả InBody để nhận gợi ý theo chỉ số của bạn.</p>}
            <p className="mt-3 text-xs text-[var(--ob-text-3)]">Gợi ý chỉ mang tính tham khảo, không phải lời khuyên y tế.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
