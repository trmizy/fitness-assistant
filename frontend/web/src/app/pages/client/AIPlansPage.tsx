import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Loader2,
  RefreshCw,
  Sparkles,
  Clock3,
  CircleCheck,
  CircleX,
  Plus,
  Wand2,
  SlidersHorizontal,
  CalendarDays,
  Dumbbell,
  Target,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  planService,
  type PlanContent,
  type PlanJobStatusResponse,
  type PlanStatusBackend,
  type WeeklyScheduleItem,
  type WorkoutPlanRecord,
  type ExerciseItem,
} from '../../services/api';

type JobActionType = 'generate' | 'adjust';

type ActiveJob = {
  jobId: string;
  action: JobActionType;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function statusLabel(status: PlanStatusBackend): string {
  if (status === 'QUEUED') return 'Đang chờ';
  if (status === 'PROCESSING') return 'Đang xử lý';
  if (status === 'COMPLETED') return 'Hoàn thành';
  return 'Thất bại';
}

function statusClass(status: PlanStatusBackend): string {
  if (status === 'COMPLETED') return 'bg-green-500/10 text-green-400 border-green-500/30';
  if (status === 'FAILED') return 'bg-red-500/10 text-red-400 border-red-500/30';
  if (status === 'PROCESSING') return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
  return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
}

function chooseLatestPlan(plans: WorkoutPlanRecord[]): WorkoutPlanRecord | null {
  if (!plans.length) return null;

  const completed = plans.filter((p) => p.status === 'COMPLETED');
  const source = completed.length > 0 ? completed : plans;

  const sorted = [...source].sort((a, b) => {
    const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
    const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
    if (tsA !== tsB) return tsB - tsA;

    const verA = a.version ?? 0;
    const verB = b.version ?? 0;
    if (verA !== verB) return verB - verA;

    return (b.id || '').localeCompare(a.id || '');
  });

  return sorted[0] ?? null;
}

function toPlanContent(value: unknown): PlanContent | null {
  if (!isRecord(value)) return null;
  return value as PlanContent;
}

function toExerciseList(value: unknown): ExerciseItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isRecord(item)) as ExerciseItem[];
}

function toWeeklySchedule(value: unknown): WeeklyScheduleItem[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => isRecord(item)) as WeeklyScheduleItem[];
}

function asExplanationText(value: string | UnknownRecord): string {
  if (typeof value === 'string') return value;
  if (typeof value.explanation === 'string') return value.explanation;
  return JSON.stringify(value, null, 2);
}

function summarizeApiError(error: unknown, fallback: string): string {
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data)) {
    const responseData = error.response.data;
    if (typeof responseData.error === 'string') {
      return responseData.error;
    }
    if (isRecord(responseData.error) && typeof responseData.error.message === 'string') {
      return responseData.error.message;
    }
    if (typeof responseData.message === 'string') {
      return responseData.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function formatDate(dateValue?: string): string {
  if (!dateValue) return '--';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('vi-VN');
}

export function AIPlansPage() {
  const queryClient = useQueryClient();

  const [goal, setGoal] = useState('Giảm mỡ tăng cơ');
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(4);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [latestJobStatus, setLatestJobStatus] = useState<PlanJobStatusResponse | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<string>('');

  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [adjustments, setAdjustments] = useState('');
  const [adjustDaysPerWeekInput, setAdjustDaysPerWeekInput] = useState('');

  const [showSavePanel, setShowSavePanel] = useState(false);
  const [saveStartDate, setSaveStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saveRepeatWeeksInput, setSaveRepeatWeeksInput] = useState('');

  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

  const {
    data: plans,
    isLoading: loadingPlans,
    isFetching: fetchingPlans,
    isError: loadPlansError,
    error: plansError,
    refetch: refetchPlans,
  } = useQuery<WorkoutPlanRecord[]>({
    queryKey: ['ai-plans', 'current'],
    queryFn: () => planService.getCurrentPlans(),
  });

  const sortedPlans = useMemo(() => {
    const list = plans ?? [];
    return [...list].sort((a, b) => {
      const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
      const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
      if (tsA !== tsB) return tsB - tsA;
      return (b.version ?? 0) - (a.version ?? 0);
    });
  }, [plans]);

  const defaultPlan = useMemo(() => chooseLatestPlan(sortedPlans), [sortedPlans]);

  useEffect(() => {
    if (!sortedPlans.length) {
      setSelectedPlanId(null);
      return;
    }

    if (selectedPlanId && sortedPlans.some((plan) => plan.id === selectedPlanId)) {
      return;
    }

    setSelectedPlanId(defaultPlan?.id ?? sortedPlans[0]?.id ?? null);
  }, [defaultPlan, selectedPlanId, sortedPlans]);

  const currentPlan = useMemo(() => {
    if (!sortedPlans.length) return null;
    if (!selectedPlanId) return defaultPlan;
    return sortedPlans.find((plan) => plan.id === selectedPlanId) ?? defaultPlan;
  }, [defaultPlan, selectedPlanId, sortedPlans]);

  const currentContent = useMemo(() => toPlanContent(currentPlan?.plan), [currentPlan]);
  const weeklySchedule = useMemo(
    () => toWeeklySchedule(currentContent?.weeklySchedule),
    [currentContent],
  );

  const generateMutation = useMutation({
    mutationFn: (payload: { goal: string; durationWeeks: number; daysPerWeek: number }) =>
      planService.generateWorkoutPlan(payload),
    onSuccess: (result) => {
      setLatestJobStatus({ jobId: result.jobId, planId: result.planId, status: result.status });
      setActiveJob({ jobId: result.jobId, action: 'generate' });
      toast.success('Đã gửi yêu cầu tạo kế hoạch AI');
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, 'Không thể tạo kế hoạch AI'));
    },
  });

  const explainMutation = useMutation({
    mutationFn: (planId: string) => planService.explainPlan(planId, 'vi'),
    onSuccess: (result) => {
      setExplanation(asExplanationText(result));
      toast.success('Đã tạo giải thích kế hoạch');
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, 'Không thể giải thích kế hoạch'));
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: { planId: string; adjustments: string; daysPerWeek?: number }) =>
      planService.adjustPlan(payload.planId, payload.adjustments, payload.daysPerWeek),
    onSuccess: (result) => {
      setLatestJobStatus({ jobId: result.jobId, planId: result.planId, status: result.status });
      setActiveJob({ jobId: result.jobId, action: 'adjust' });
      setShowAdjustPanel(false);
      setAdjustments('');
      setAdjustDaysPerWeekInput('');
      toast.success('Đã gửi yêu cầu điều chỉnh kế hoạch');
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, 'Không thể điều chỉnh kế hoạch'));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { planId: string; startDate?: string; repeatWeeks?: number }) =>
      planService.savePlanToWorkoutLog(payload.planId, {
        startDate: payload.startDate,
        repeatWeeks: payload.repeatWeeks,
      }),
    onSuccess: (result) => {
      setShowSavePanel(false);
      setSaveRepeatWeeksInput('');
      toast.success(result.alreadyExists ? 'Kế hoạch này đã được lưu trước đó' : 'Đã lưu vào lịch tập');
      window.location.assign('/client/workout');
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, 'Không thể lưu kế hoạch vào lịch tập'));
    },
  });

  useEffect(() => {
    if (!activeJob?.jobId) return;

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const statusResult = await planService.getJobStatus(activeJob.jobId);
        if (cancelled) return;

        setLatestJobStatus(statusResult);

        if (statusResult.status === 'COMPLETED') {
          setActiveJob(null);
          await queryClient.invalidateQueries({ queryKey: ['ai-plans', 'current'] });
          await refetchPlans();
          toast.success(
            activeJob.action === 'generate'
              ? 'Kế hoạch AI đã tạo xong'
              : 'Đã tạo phiên bản kế hoạch mới',
          );
          return;
        }

        if (statusResult.status === 'FAILED') {
          setActiveJob(null);
          const reason = statusResult.failReason || 'Job tạo kế hoạch thất bại';
          toast.error(reason);
        }
      } catch (error) {
        if (!cancelled) {
          setActiveJob(null);
          toast.error(summarizeApiError(error, 'Không thể theo dõi trạng thái tạo kế hoạch'));
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeJob, queryClient, refetchPlans]);

  const isBusy =
    generateMutation.isPending ||
    explainMutation.isPending ||
    adjustMutation.isPending ||
    saveMutation.isPending ||
    Boolean(activeJob);

  const handleGenerate = () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      toast.error('Mục tiêu không được để trống');
      return;
    }
    if (!Number.isFinite(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
      toast.error('durationWeeks phải trong khoảng 1-52');
      return;
    }
    if (!Number.isFinite(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
      toast.error('daysPerWeek phải trong khoảng 1-7');
      return;
    }

    generateMutation.mutate({
      goal: trimmedGoal,
      durationWeeks,
      daysPerWeek,
    });
  };

  const handleExplain = () => {
    if (!currentPlan?.id || currentPlan.status !== 'COMPLETED') {
      toast.error('Chỉ có thể giải thích plan đã hoàn thành');
      return;
    }
    explainMutation.mutate(currentPlan.id);
  };

  const handleAdjust = () => {
    if (!currentPlan?.id || currentPlan.status !== 'COMPLETED') {
      toast.error('Chỉ có thể điều chỉnh plan đã hoàn thành');
      return;
    }

    const trimmedAdjustments = adjustments.trim();
    if (!trimmedAdjustments) {
      toast.error('Nội dung điều chỉnh không được để trống');
      return;
    }

    let nextDaysPerWeek: number | undefined;
    if (adjustDaysPerWeekInput.trim()) {
      const parsed = Number(adjustDaysPerWeekInput);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 7) {
        toast.error('daysPerWeek mới phải trong khoảng 1-7');
        return;
      }
      nextDaysPerWeek = parsed;
    }

    adjustMutation.mutate({
      planId: currentPlan.id,
      adjustments: trimmedAdjustments,
      daysPerWeek: nextDaysPerWeek,
    });
  };

  const handleSaveToWorkoutLog = () => {
    if (!currentPlan?.id || currentPlan.status !== 'COMPLETED') {
      toast.error('Chỉ có thể lưu plan đã hoàn thành');
      return;
    }

    const trimmedRepeatWeeks = saveRepeatWeeksInput.trim();
    const parsedRepeatWeeks = trimmedRepeatWeeks ? Number(trimmedRepeatWeeks) : undefined;
    if (trimmedRepeatWeeks && (!Number.isFinite(parsedRepeatWeeks) || parsedRepeatWeeks < 1 || parsedRepeatWeeks > 52)) {
      toast.error('repeatWeeks phải trong khoảng 1-52');
      return;
    }

    saveMutation.mutate({
      planId: currentPlan.id,
      startDate: saveStartDate || undefined,
      repeatWeeks: parsedRepeatWeeks,
    });
  };

  const headerGoal = currentPlan?.goal || currentContent?.goal || '--';
  const headerDuration = currentContent?.durationWeeks ?? currentPlan?.duration ?? '--';
  const headerDays = currentContent?.daysPerWeek ?? currentPlan?.daysPerWeek ?? '--';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 text-xl font-bold flex items-center gap-2">
            <Brain className="w-5 h-5 text-green-400" />
            AI Plans
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Tạo và quản lý kế hoạch tập luyện bằng AI, theo dõi job, giải thích và điều chỉnh theo nhu cầu.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void refetchPlans();
          }}
          disabled={fetchingPlans}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {fetchingPlans ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-2 text-zinc-200 font-semibold">
          <Sparkles className="w-4 h-4 text-green-400" />
          Tạo kế hoạch mới
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-400">Mục tiêu</label>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ví dụ: giảm mỡ tăng cơ"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
            />
            <div className="flex flex-wrap gap-1.5">
              {['Giảm mỡ', 'Tăng cơ', 'Giảm mỡ tăng cơ', 'Duy trì sức khỏe', 'Tăng sức bền'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setGoal(preset)}
                  className="px-2 py-1 text-[11px] rounded-full border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-400">Số tuần (1-52)</label>
            <input
              type="number"
              min={1}
              max={52}
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(Number(e.target.value))}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-400">Buổi/tuần (1-7)</label>
            <input
              type="number"
              min={1}
              max={7}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(Number(e.target.value))}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isBusy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500 text-black font-semibold hover:bg-green-400 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {generateMutation.isPending || activeJob?.action === 'generate' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Tạo kế hoạch tập luyện bằng AI
          </button>

          {activeJob && (
            <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300">
              <Clock3 className="w-3.5 h-3.5" />
              Đang polling job: {activeJob.jobId}
            </div>
          )}
        </div>
      </div>

      {loadPlansError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 p-3 text-sm">
          Không thể tải danh sách kế hoạch: {summarizeApiError(plansError, 'Lỗi không xác định')}
        </div>
      )}

      {latestJobStatus && (
        <div className={`rounded-xl border p-3 text-sm ${statusClass(latestJobStatus.status)}`}>
          <div className="font-semibold">Trạng thái job: {statusLabel(latestJobStatus.status)}</div>
          <div className="text-xs mt-1 opacity-90">
            jobId: {latestJobStatus.jobId || '--'} | planId: {latestJobStatus.planId || '--'}
          </div>
          {latestJobStatus.failReason && (
            <div className="text-xs mt-1">Lý do thất bại: {latestJobStatus.failReason}</div>
          )}
        </div>
      )}

      {loadingPlans ? (
        <div className="flex items-center justify-center min-h-[220px] bg-zinc-900/50 border border-zinc-800 rounded-2xl">
          <Loader2 className="w-7 h-7 text-green-500 animate-spin" />
        </div>
      ) : sortedPlans.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 text-center">
          <p className="text-zinc-300 font-semibold">Chưa có kế hoạch nào.</p>
          <p className="text-zinc-500 text-sm mt-1">Hãy tạo kế hoạch đầu tiên bằng form phía trên.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <aside className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2 h-fit">
            <div className="text-sm font-semibold text-zinc-200 px-1">Danh sách plans</div>
            {sortedPlans.map((plan) => {
              const selected = plan.id === currentPlan?.id;
              return (
                <button
                  type="button"
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${
                    selected
                      ? 'border-green-500/50 bg-green-500/10'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-zinc-100 truncate">
                      {plan.name || 'Workout Plan'}
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(plan.status)}`}>
                      {statusLabel(plan.status)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 truncate">
                    Goal: {plan.goal || '--'} | v{plan.version ?? 1}
                  </div>
                  <div className="text-[11px] text-zinc-600 mt-1">{formatDate(plan.updatedAt || plan.createdAt)}</div>
                </button>
              );
            })}
          </aside>

          <section className="lg:col-span-8 space-y-4">
            {currentPlan && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h2 className="text-zinc-100 text-lg font-bold">{currentPlan.name || 'Workout Plan'}</h2>
                    <p className="text-zinc-500 text-sm">{currentPlan.description || 'Kế hoạch được tạo bởi AI'}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full border h-fit ${statusClass(currentPlan.status)}`}>
                    {statusLabel(currentPlan.status)}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Goal</div>
                    <div className="text-sm text-zinc-100 mt-1">{headerGoal}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Duration</div>
                    <div className="text-sm text-zinc-100 mt-1">{String(headerDuration)} tuần</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Days / Week</div>
                    <div className="text-sm text-zinc-100 mt-1">{String(headerDays)} buổi</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Version</div>
                    <div className="text-sm text-zinc-100 mt-1">v{currentPlan.version ?? 1}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Created</div>
                    <div className="text-sm text-zinc-100 mt-1">{formatDate(currentPlan.createdAt)}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Updated</div>
                    <div className="text-sm text-zinc-100 mt-1">{formatDate(currentPlan.updatedAt)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExplain}
                    disabled={
                      explainMutation.isPending ||
                      !currentPlan.id ||
                      currentPlan.status !== 'COMPLETED'
                    }
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {explainMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    Giải thích kế hoạch
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAdjustPanel((v) => !v)}
                    disabled={!currentPlan.id || currentPlan.status !== 'COMPLETED' || adjustMutation.isPending}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    Điều chỉnh kế hoạch
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSavePanel((v) => !v)}
                    disabled={!currentPlan.id || currentPlan.status !== 'COMPLETED' || saveMutation.isPending}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <CalendarDays className="w-4 h-4" />
                    Lưu vào lịch tập
                  </button>
                </div>

                {showSavePanel && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-zinc-400">Ngày bắt đầu</label>
                        <input
                          type="date"
                          value={saveStartDate}
                          onChange={(e) => setSaveStartDate(e.target.value)}
                          className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-zinc-400">Số tuần áp dụng (optional)</label>
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={saveRepeatWeeksInput}
                          onChange={(e) => setSaveRepeatWeeksInput(e.target.value)}
                          placeholder={String(currentContent?.durationWeeks ?? currentPlan.duration ?? 1)}
                          className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveToWorkoutLog}
                        disabled={saveMutation.isPending}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-400 text-black font-semibold hover:bg-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                        Lưu lịch tập
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSavePanel(false)}
                        className="px-3.5 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                )}

                {showAdjustPanel && (
                  <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-3 space-y-3">
                    <label className="block text-xs font-semibold text-zinc-400">Yêu cầu điều chỉnh</label>
                    <textarea
                      value={adjustments}
                      onChange={(e) => setAdjustments(e.target.value)}
                      rows={4}
                      placeholder="Ví dụ: Tăng bài chân, giảm cardio, ưu tiên ngực vai tay sau"
                      className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-amber-500/50"
                    />
                    <div className="w-full md:w-48 space-y-1">
                      <label className="block text-xs font-semibold text-zinc-400">daysPerWeek mới (optional)</label>
                      <input
                        type="number"
                        min={1}
                        max={7}
                        value={adjustDaysPerWeekInput}
                        onChange={(e) => setAdjustDaysPerWeekInput(e.target.value)}
                        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-amber-500/50"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAdjust}
                        disabled={adjustMutation.isPending}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-400 text-black font-semibold hover:bg-amber-300 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {adjustMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                        Gửi điều chỉnh
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAdjustPanel(false)}
                        className="px-3.5 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                )}

                {explanation && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
                    <div className="text-xs font-semibold text-blue-300 mb-1">Giải thích từ AI</div>
                    <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">{explanation}</pre>
                  </div>
                )}
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-3">
              <div className="text-zinc-100 font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-green-400" />
                Lịch tập theo tuần
              </div>

              {!weeklySchedule ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm p-3">
                  Kế hoạch đã được tạo nhưng dữ liệu lịch tập chưa đúng định dạng.
                </div>
              ) : weeklySchedule.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 text-sm p-3">
                  Chưa có buổi tập trong weeklySchedule.
                </div>
              ) : (
                weeklySchedule.map((day, dayIndex) => {
                  const key = `${day.day ?? dayIndex}`;
                  const expanded = expandedDayKey === key;
                  const exercises = toExerciseList(day.exercises);
                  const title = day.goal || day.focus || 'Workout Day';

                  return (
                    <div key={key} className="rounded-xl border border-zinc-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedDayKey((prev) => (prev === key ? null : key))}
                        className="w-full flex items-center justify-between gap-3 p-3 bg-zinc-950 hover:bg-zinc-900"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <span className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 text-green-300 flex items-center justify-center text-xs font-bold">
                            {String(day.day ?? dayIndex + 1)}
                          </span>
                          <div>
                            <div className="text-sm text-zinc-100 font-semibold">{title}</div>
                            <div className="text-xs text-zinc-500">{exercises.length} bài tập</div>
                          </div>
                        </div>
                        {expanded ? (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                        )}
                      </button>

                      {expanded && (
                        <div className="p-3 bg-zinc-900 border-t border-zinc-800 space-y-2">
                          {day.notes && (
                            <div className="text-xs text-zinc-400 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
                              Ghi chú ngày tập: {day.notes}
                            </div>
                          )}
                          {day.cardio && (
                            <div className="text-xs text-zinc-400 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
                              Cardio: {day.cardio}
                            </div>
                          )}

                          {exercises.length === 0 ? (
                            <div className="text-xs text-zinc-500">Không có dữ liệu bài tập.</div>
                          ) : (
                            <div className="space-y-2">
                              {exercises.map((exercise, index) => (
                                <div key={`${exercise.name ?? 'ex'}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                                  <div className="flex items-center gap-2 text-sm text-zinc-100 font-medium">
                                    <Dumbbell className="w-4 h-4 text-green-400" />
                                    <span>{exercise.order ?? index + 1}.</span>
                                    <span>{exercise.name ?? 'Exercise'}</span>
                                  </div>
                                  <div className="mt-1.5 text-xs text-zinc-400 grid grid-cols-2 md:grid-cols-4 gap-y-1">
                                    <div>Sets: {exercise.sets ?? '--'}</div>
                                    <div>Reps: {exercise.reps ?? '--'}</div>
                                    <div>Rest: {exercise.restSeconds ?? '--'}s</div>
                                    <div>Intensity: {exercise.intensity ?? '--'}</div>
                                    <div>Muscle: {exercise.muscleGroup ?? '--'}</div>
                                    <div>Equipment: {exercise.equipment ?? '--'}</div>
                                    <div className="md:col-span-2">Note: {exercise.note ?? '--'}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-3">
              <div className="text-zinc-100 font-semibold">Ghi chú kế hoạch</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="text-xs font-semibold text-zinc-400 mb-1">Progression Notes</div>
                  {(currentContent?.progressionNotes ?? []).length > 0 ? (
                    <ul className="text-sm text-zinc-300 space-y-1">
                      {(currentContent?.progressionNotes ?? []).map((note, i) => (
                        <li key={`prog-${i}`} className="flex gap-2">
                          <CircleCheck className="w-4 h-4 text-green-400 mt-0.5" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">Chưa có progression notes.</p>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="text-xs font-semibold text-zinc-400 mb-1">Recovery Notes</div>
                  {(currentContent?.recoveryNotes ?? []).length > 0 ? (
                    <ul className="text-sm text-zinc-300 space-y-1">
                      {(currentContent?.recoveryNotes ?? []).map((note, i) => (
                        <li key={`rec-${i}`} className="flex gap-2">
                          <CircleCheck className="w-4 h-4 text-blue-400 mt-0.5" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">Chưa có recovery notes.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs font-semibold text-zinc-400 mb-1">Nutrition Summary</div>
                <p className="text-sm text-zinc-300">
                  {currentContent?.nutritionSummary || 'Chưa có nutrition summary.'}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {currentPlan && currentPlan.status === 'FAILED' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
          <CircleX className="w-4 h-4 mt-0.5" />
          <div>
            <div className="font-semibold">Plan hiện tại đang ở trạng thái thất bại</div>
            <div>{currentPlan.failReason || 'Không có fail reason từ backend.'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
