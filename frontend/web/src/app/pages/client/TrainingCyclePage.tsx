import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  Circle,
  Flag,
  Loader2,
  RotateCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  trainingCycleService,
  type AdaptiveCycleDecision,
  type CycleAlert,
  type CycleAssessment,
  type CycleDecision,
  type TrainingCycle,
} from "../../services/api";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const TREND_CONFIG: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  PROGRESSING: {
    label: "Đang tiến triển tốt",
    className: "text-green-400 bg-green-500/10 border-green-500/30",
    Icon: CheckCircle2,
  },
  PLATEAU: {
    label: "Chững lại",
    className: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    Icon: Circle,
  },
  DECLINING: {
    label: "Đang sụt giảm",
    className: "text-red-400 bg-red-500/10 border-red-500/30",
    Icon: XCircle,
  },
};

const DECISION_CONFIG: Record<CycleDecision, { label: string; className: string; buttonClassName: string }> = {
  KEEP: {
    label: "Giữ nguyên lịch tập",
    className: "border-green-500/30 bg-green-500/5",
    buttonClassName: "bg-green-500 hover:bg-green-400",
  },
  ADJUST: {
    label: "Điều chỉnh lịch tập",
    className: "border-amber-500/30 bg-amber-500/5",
    buttonClassName: "bg-amber-500 hover:bg-amber-400",
  },
  NEW_PLAN: {
    label: "Đổi sang kế hoạch mới",
    className: "border-red-500/30 bg-red-500/5",
    buttonClassName: "bg-red-500 hover:bg-red-400",
  },
};

function TrendBadge({ trend }: { trend: string | null | undefined }) {
  if (!trend) return null;
  const cfg = TREND_CONFIG[trend];
  if (!cfg) return null;
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}

function AlertRow({ alert }: { alert: CycleAlert }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400 mt-0.5" />
      <p className="text-xs text-amber-200">{alert.message}</p>
    </div>
  );
}

function ActiveCycleCard() {
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);

  const activeQuery = useQuery({
    queryKey: ["training-cycle", "active"],
    queryFn: trainingCycleService.getActive,
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: () => trainingCycleService.start(),
    onSuccess: () => {
      toast.success("Đã bắt đầu chu kỳ tập luyện mới");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể bắt đầu chu kỳ mới");
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => trainingCycleService.complete(id),
    onMutate: () => setCompleting(true),
    onSettled: () => setCompleting(false),
    onSuccess: () => {
      toast.success("Đã đóng chu kỳ — AI đang phân tích kết quả");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể đóng chu kỳ");
    },
  });

  if (activeQuery.isLoading) {
    return (
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-6 flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!activeQuery.data?.cycle) {
    return (
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-6">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-sm text-zinc-400">Bạn chưa có chu kỳ tập luyện nào đang diễn ra.</p>
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
          >
            {startMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {startMutation.isPending ? "Đang bắt đầu..." : "Bắt đầu chu kỳ mới"}
          </button>
        </div>
      </div>
    );
  }

  const { cycle, summary } = activeQuery.data;
  const daysElapsed = Math.floor((Date.now() - new Date(cycle.startDate).getTime()) / 86_400_000);
  const pctElapsed = Math.min(100, Math.round((daysElapsed / cycle.durationDays) * 100));

  return (
    <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Flag className="h-4 w-4 text-green-400" />
          Chu kỳ #{cycle.cycleIndex} — bắt đầu {formatDate(cycle.startDate)}
        </div>
        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-bold text-green-400">
          Đang diễn ra ({pctElapsed}%)
        </span>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
          <span>Tuân thủ lịch tập</span>
          <span className="font-semibold text-zinc-300">
            {summary.adherence.completed}/{summary.adherence.total} buổi ({summary.adherence.percent}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${summary.adherence.percent}%` }} />
        </div>
      </div>

      {summary.volumeChangePct != null && (
        <p className="text-xs text-zinc-400">
          Volume tập luyện: {summary.volumeChangePct > 0 ? "+" : ""}
          {summary.volumeChangePct}% so với tuần đầu
        </p>
      )}

      {summary.newPRs.length > 0 && (
        <p className="text-xs text-green-400">🏆 PR mới: {summary.newPRs.join(", ")}</p>
      )}

      {summary.alerts.length > 0 && (
        <div className="space-y-2">
          {summary.alerts.map((a) => (
            <AlertRow key={a.code} alert={a} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => completeMutation.mutate(cycle.id)}
        disabled={completing}
        className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-60 text-zinc-200 py-2.5 rounded-xl text-sm font-bold transition-all"
      >
        {completing && <Loader2 className="w-4 h-4 animate-spin" />}
        {completing ? "Đang đóng chu kỳ..." : "Kết thúc chu kỳ"}
      </button>
    </div>
  );
}

function DecisionCard({ cycle }: { cycle: TrainingCycle }) {
  const queryClient = useQueryClient();

  // Poll while AI analysis is still in flight (status COMPLETED but not yet ANALYZED).
  const cycleQuery = useQuery({
    queryKey: ["training-cycle", "detail", cycle.id],
    queryFn: () => trainingCycleService.get(cycle.id),
    initialData: cycle,
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" ? 4000 : false),
  });

  const startNextMutation = useMutation({
    mutationFn: () => trainingCycleService.start(),
    onSuccess: () => {
      toast.success("Đã mở chu kỳ tiếp theo");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể mở chu kỳ mới");
    },
  });

  const current = cycleQuery.data ?? cycle;

  if (current.status === "COMPLETED") {
    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-green-500 animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-zinc-200">AI đang phân tích chu kỳ #{current.cycleIndex}...</p>
          <p className="text-xs text-zinc-500 mt-0.5">Quá trình này có thể mất khoảng 1 phút.</p>
        </div>
      </div>
    );
  }

  if (current.status !== "ANALYZED" || !current.decision) return null;

  const decision = current.decision;
  const cfg = DECISION_CONFIG[decision];
  const review = current.aiAnalysis?.cycleReview;

  return (
    <div className={`rounded-2xl border p-6 space-y-4 ${cfg.className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
          <Sparkles className="h-4 w-4" />
          Đề xuất cho chu kỳ #{current.cycleIndex + 1}
        </div>
        {review && <TrendBadge trend={current.summary?.progressSignals?.overallTrend} />}
      </div>

      <div>
        <h3 className="text-base font-bold text-zinc-100">{cfg.label}</h3>
        {review && (
          <>
            <p className="mt-1 text-sm text-zinc-300">{review.bodyCompositionTrend}</p>
            <p className="mt-1 text-sm text-zinc-400">{review.trainingNote}</p>
            {review.confidence === "low" && (
              <p className="mt-2 text-xs text-amber-400">
                ⚠ Độ tin cậy thấp {current.lowConfidence ? "(thiếu dữ liệu InBody đóng chu kỳ)" : ""}
              </p>
            )}
          </>
        )}
        {current.aiAnalysis?.aiFallback && (
          <p className="mt-2 text-xs text-zinc-500">
            (AI không phản hồi được — áp dụng quy tắc mặc định theo xu hướng tổng thể)
          </p>
        )}
      </div>

      {decision === "KEEP" && current.aiAnalysis?.keepDetails && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-950/40 p-4 text-sm text-zinc-300 space-y-1">
          <p>Tăng tải: +{current.aiAnalysis.keepDetails.overloadIncreasePct}%</p>
          {current.aiAnalysis.keepDetails.calorieDelta !== 0 && (
            <p>Điều chỉnh calo: {current.aiAnalysis.keepDetails.calorieDelta > 0 ? "+" : ""}{current.aiAnalysis.keepDetails.calorieDelta} kcal</p>
          )}
          <p className="text-zinc-500">{current.aiAnalysis.keepDetails.notes}</p>
        </div>
      )}

      {decision === "ADJUST" && current.aiAnalysis?.adjustDetails && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-950/40 p-4 text-sm text-zinc-300 space-y-1">
          {current.aiAnalysis.adjustDetails.pumpSetTargets.length > 0 && (
            <p>Thêm pump-set cho: {current.aiAnalysis.adjustDetails.pumpSetTargets.join(", ")} (tối đa {current.aiAnalysis.adjustDetails.maxPumpSessionsPerWeek} buổi/tuần)</p>
          )}
          {current.aiAnalysis.adjustDetails.calorieDeltaPct !== 0 && (
            <p>Điều chỉnh calo: {current.aiAnalysis.adjustDetails.calorieDeltaPct > 0 ? "+" : ""}{current.aiAnalysis.adjustDetails.calorieDeltaPct}%</p>
          )}
          <p className="text-zinc-500">{current.aiAnalysis.adjustDetails.notes}</p>
        </div>
      )}

      {decision === "NEW_PLAN" && current.aiAnalysis?.newPlanDraft && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-950/40 p-4 text-sm text-zinc-300 space-y-1">
          <p>Mục tiêu mới: {current.aiAnalysis.newPlanDraft.goal}</p>
          <p>{current.aiAnalysis.newPlanDraft.daysPerWeek} buổi/tuần — {current.aiAnalysis.newPlanDraft.splitSuggestion}</p>
          {current.aiAnalysis.newPlanDraft.deloadWeekFirst && (
            <p className="text-amber-400">Bắt đầu bằng 1 tuần deload</p>
          )}
          <p className="text-zinc-500">{current.aiAnalysis.newPlanDraft.notes}</p>
        </div>
      )}

      {current.aiAnalysis?.mealPlanDraft && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-950/40 p-4 text-sm text-zinc-300">
          <p className="font-semibold text-zinc-200">Dinh dưỡng ước tính lại</p>
          <p className="mt-1">
            TDEE: {current.aiAnalysis.mealPlanDraft.estimatedTDEE} kcal · Mục tiêu: {current.aiAnalysis.mealPlanDraft.calorieTarget} kcal
          </p>
          <p className="text-zinc-500">
            P{current.aiAnalysis.mealPlanDraft.macros.proteinG}g · C{current.aiAnalysis.mealPlanDraft.macros.carbG}g · F{current.aiAnalysis.mealPlanDraft.macros.fatG}g
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => startNextMutation.mutate()}
        disabled={startNextMutation.isPending}
        className={`w-full flex items-center justify-center gap-2 ${cfg.buttonClassName} disabled:opacity-60 text-black py-2.5 rounded-xl text-sm font-bold transition-all`}
      >
        {startNextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        {startNextMutation.isPending ? "Đang mở chu kỳ..." : "Đồng ý — mở chu kỳ tiếp theo"}
      </button>
    </div>
  );
}

// ── Adaptive Training Cycle Evaluation — Cycle Progress section ────────────
// Deliberately embedded within this same page rather than a standalone
// route, to avoid touching router configuration for this pass — the spec's
// "Cycle Progress page" content (adherence, weekly volume, data-quality
// warnings) is all here. Body-composition/InBody trend charts are omitted
// (shown as text trend badges instead): GET /:id/progress's CycleMetrics
// only exposes summarized inBodyQuality (record counts + flags), not the
// raw comparable-point series, so there isn't per-point data to plot here
// without extending that response — a deliberate scope trim, not an
// oversight.

function fieldTrendLabel(trend: { direction: "up" | "flat" | "down"; changePerWeek: number | null } | null): string {
  if (!trend) return "Chưa đủ dữ liệu";
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→";
  const rate = trend.changePerWeek != null ? ` (${trend.changePerWeek > 0 ? "+" : ""}${trend.changePerWeek}/tuần)` : "";
  return `${arrow}${rate}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-zinc-100">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function CycleProgressSection({ cycleId }: { cycleId: string }) {
  const progressQuery = useQuery({
    queryKey: ["training-cycle", "progress", cycleId],
    queryFn: () => trainingCycleService.getProgress(cycleId),
  });

  if (progressQuery.isLoading) {
    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
      </div>
    );
  }
  if (!progressQuery.data) return null;

  const { metrics } = progressQuery.data;
  const volumeChartData = metrics.weeklyVolumeByMuscleGroup.map((w) => ({
    week: `Tuần ${w.week + 1}`,
    volume: Math.round(w.totalVolumeKg),
  }));

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-4">
      <h3 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-green-400" /> Tiến độ chu kỳ
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatTile label="Tuân thủ" value={`${Math.round(metrics.adherenceRate * 100)}%`} />
        <StatTile label="Buổi/tuần" value={metrics.workoutsPerWeek.toString()} />
        <StatTile
          label="Sức mạnh"
          value={metrics.strengthProgressScore != null ? `${Math.round(metrics.strengthProgressScore * 100)}%` : "—"}
        />
        <StatTile
          label="Chất lượng dữ liệu"
          value={`${Math.round(metrics.dataQualityScore * 100)}%`}
          sub={!metrics.inBodyQuality.hasSufficientData ? "Cần thêm số liệu InBody" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-zinc-400">
        <div>Cân nặng: {fieldTrendLabel(metrics.bodyWeightTrend)}</div>
        <div>Khối cơ: {fieldTrendLabel(metrics.skeletalMuscleTrend)}</div>
        <div>Mỡ cơ thể: {fieldTrendLabel(metrics.bodyFatTrend)}</div>
        <div>Đau/khó chịu: {fieldTrendLabel(metrics.painTrend)}</div>
        <div>RPE: {metrics.rpeTrend === "increasing" ? "↑ tăng" : metrics.rpeTrend === "decreasing" ? "↓ giảm" : "→ ổn định"}</div>
        <div>Hồi phục: {metrics.recoveryScore != null ? `${Math.round(metrics.recoveryScore * 100)}%` : "—"}</div>
      </div>

      {volumeChartData.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-2">Volume tập luyện theo tuần</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={volumeChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }}
              />
              <Bar dataKey="volume" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {metrics.inBodyQuality.qualityFlags.length > 0 && (
        <div className="space-y-1.5">
          {metrics.inBodyQuality.qualityFlags.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-zinc-700/40 bg-zinc-950/40 p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500 mt-0.5" />
              <p className="text-[11px] text-zinc-500">{flag}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Adaptive Training Cycle Evaluation — End-of-cycle assessment card ──────
// Additive alongside the legacy DecisionCard above (still wired to the old
// 3-state /complete flow, unchanged). This is the new 6-state flow: the
// user explicitly triggers POST /:id/evaluate (nothing runs automatically),
// reviews the result, then explicitly Accepts/Rejects — accepting only
// marks the recommendation reviewed, it does NOT itself activate any new
// plan or schedule change.

const ADAPTIVE_DECISION_CONFIG: Record<AdaptiveCycleDecision, { label: string; className: string }> = {
  KEEP: { label: "Giữ nguyên", className: "border-green-500/30 bg-green-500/5 text-green-400" },
  PROGRESS: { label: "Tăng tải", className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" },
  ADJUST: { label: "Điều chỉnh nhỏ", className: "border-amber-500/30 bg-amber-500/5 text-amber-400" },
  DELOAD: { label: "Giảm tải (deload)", className: "border-orange-500/30 bg-orange-500/5 text-orange-400" },
  REBUILD: { label: "Xây lại chương trình", className: "border-red-500/30 bg-red-500/5 text-red-400" },
  INSUFFICIENT_DATA: { label: "Chưa đủ dữ liệu", className: "border-zinc-600/30 bg-zinc-500/5 text-zinc-400" },
};

function AdaptiveAssessmentCard({ cycleId }: { cycleId: string }) {
  const queryClient = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);

  const latestQuery = useQuery({
    queryKey: ["training-cycle", "assessment", "latest", cycleId],
    queryFn: () => trainingCycleService.getLatestAssessment(cycleId),
    retry: false,
  });

  const evaluateMutation = useMutation({
    mutationFn: () => trainingCycleService.evaluate(cycleId),
    onSuccess: () => {
      toast.success("Đang đánh giá chu kỳ — AI sẽ giải thích kết quả trong giây lát");
      queryClient.invalidateQueries({ queryKey: ["training-cycle", "assessment", "latest", cycleId] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể đánh giá chu kỳ");
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (decision: "accept" | "reject") =>
      decision === "accept"
        ? trainingCycleService.acceptRecommendation(cycleId)
        : trainingCycleService.rejectRecommendation(cycleId),
    onSuccess: (_data, decision) => {
      toast.success(decision === "accept" ? "Đã chấp nhận đề xuất" : "Đã giữ lịch tập hiện tại");
      queryClient.invalidateQueries({ queryKey: ["training-cycle", "assessment", "latest", cycleId] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu lựa chọn");
    },
  });

  const assessment: CycleAssessment | undefined = latestQuery.data;

  if (!assessment) {
    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 flex flex-col items-center gap-3 text-center">
        <Sparkles className="h-5 w-5 text-green-400" />
        <p className="text-sm text-zinc-400">Đánh giá nâng cao dùng Decision Engine + AI giải thích (6 mức quyết định).</p>
        <button
          type="button"
          onClick={() => evaluateMutation.mutate()}
          disabled={evaluateMutation.isPending}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
        >
          {evaluateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {evaluateMutation.isPending ? "Đang đánh giá..." : "Đánh giá chu kỳ (nâng cao)"}
        </button>
      </div>
    );
  }

  if (assessment.status === "PENDING") {
    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-green-500 animate-spin flex-shrink-0" />
        <p className="text-sm text-zinc-300">Đang đánh giá chu kỳ...</p>
      </div>
    );
  }

  const decision = assessment.decision ?? "INSUFFICIENT_DATA";
  const cfg = ADAPTIVE_DECISION_CONFIG[decision];
  const criticalFlag = assessment.safetyFlags?.find((f) => f.severity === "critical");

  return (
    <div className={`rounded-2xl border p-6 space-y-4 ${cfg.className.replace("text-", "border-").split(" ")[0]} bg-zinc-900`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${cfg.className}`}>
            {cfg.label}
          </span>
          {assessment.confidenceScore != null && (
            <span className="text-xs text-zinc-500">Độ tin cậy: {Math.round(assessment.confidenceScore * 100)}%</span>
          )}
        </div>
        <span className="text-[11px] text-zinc-600">Đánh giá lần {assessment.assessmentVersion}</span>
      </div>

      {criticalFlag && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <ShieldAlert className="h-4 w-4 flex-shrink-0 text-red-400 mt-0.5" />
          <p className="text-xs text-red-200">{criticalFlag.message}</p>
        </div>
      )}

      {assessment.aiSummary && <p className="text-sm text-zinc-300">{assessment.aiSummary}</p>}

      {showDetails && (
        <div className="space-y-3 rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
          {assessment.reasonCodes && assessment.reasonCodes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-1">Lý do (từ Decision Engine)</p>
              <ul className="text-xs text-zinc-500 space-y-0.5 list-disc list-inside">
                {assessment.reasonCodes.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {assessment.proposedChanges && assessment.proposedChanges.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-1">Đề xuất thay đổi</p>
              <div className="space-y-1.5">
                {assessment.proposedChanges.map((c, i) => (
                  <div key={i} className="text-xs text-zinc-300">
                    <span className="font-semibold text-zinc-200">{c.target}</span>: {c.currentValue} → {c.proposedValue}
                    <span className="text-zinc-500"> — {c.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {assessment.conflictingSignals && assessment.conflictingSignals.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-500 mb-1">Tín hiệu mâu thuẫn</p>
              <ul className="text-xs text-zinc-500 space-y-0.5 list-disc list-inside">
                {assessment.conflictingSignals.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {assessment.userDecision === "PENDING" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reviewMutation.mutate("accept")}
            disabled={reviewMutation.isPending}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3.5 py-2 rounded-lg text-xs font-bold transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Chấp nhận
          </button>
          <button
            type="button"
            onClick={() => reviewMutation.mutate("reject")}
            disabled={reviewMutation.isPending}
            className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-60 text-zinc-200 px-3.5 py-2 rounded-lg text-xs font-bold transition-all"
          >
            <Ban className="w-3.5 h-3.5" /> Giữ lịch hiện tại
          </button>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1.5 bg-transparent hover:bg-zinc-800 border border-zinc-700 text-zinc-400 px-3.5 py-2 rounded-lg text-xs font-bold transition-all"
          >
            {showDetails ? "Ẩn chi tiết" : "Xem chi tiết"}
          </button>
          <button
            type="button"
            onClick={() => evaluateMutation.mutate()}
            disabled={evaluateMutation.isPending}
            className="flex items-center gap-1.5 bg-transparent hover:bg-zinc-800 border border-zinc-700 disabled:opacity-60 text-zinc-400 px-3.5 py-2 rounded-lg text-xs font-bold transition-all"
          >
            {evaluateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Tạo lại đề xuất
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {assessment.userDecision === "ACCEPTED" ? "✓ Bạn đã chấp nhận đề xuất này." : "Bạn đã chọn giữ lịch tập hiện tại."}
        </p>
      )}
    </div>
  );
}

function CycleHistoryRow({ cycle }: { cycle: TrainingCycle }) {
  const trend = cycle.summary?.progressSignals?.overallTrend;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <CalendarClock className="h-4 w-4 text-zinc-500" />
          Chu kỳ #{cycle.cycleIndex}: {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">Tuân thủ: {cycle.summary?.adherence.percent ?? 0}%</span>
          {cycle.decision && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              {cycle.decision === "KEEP" ? <TrendingUp className="h-3.5 w-3.5 text-green-400" /> : cycle.decision === "NEW_PLAN" ? <TrendingDown className="h-3.5 w-3.5 text-red-400" /> : null}
              {DECISION_CONFIG[cycle.decision].label}
            </span>
          )}
        </div>
      </div>
      <TrendBadge trend={trend} />
    </div>
  );
}

export function TrainingCyclePage() {
  const historyQuery = useQuery({
    queryKey: ["training-cycle", "history"],
    queryFn: () => trainingCycleService.list(20),
  });

  const activeOrRecentCycle = historyQuery.data?.find(
    (c) => c.status === "COMPLETED" || c.status === "ANALYZED",
  );
  const activeCycle = historyQuery.data?.find((c) => c.status === "ACTIVE");
  const relevantCycleId = activeCycle?.id ?? activeOrRecentCycle?.id;
  const closedHistory = (historyQuery.data ?? []).filter((c) => c.status !== "ACTIVE");

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <CalendarClock className="w-5 h-5 text-green-400" /> Chu kỳ tập luyện tháng
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Theo dõi tiến triển liên tục và nhận đề xuất từ AI khi kết thúc mỗi chu kỳ.
        </p>
      </div>

      <ActiveCycleCard />

      {activeOrRecentCycle && <DecisionCard cycle={activeOrRecentCycle} />}

      {relevantCycleId && <CycleProgressSection cycleId={relevantCycleId} />}

      {relevantCycleId && <AdaptiveAssessmentCard cycleId={relevantCycleId} />}

      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2">Lịch sử chu kỳ</h2>
        {historyQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        ) : closedHistory.length > 0 ? (
          <div className="space-y-2">
            {closedHistory.map((cycle) => (
              <CycleHistoryRow key={cycle.id} cycle={cycle} />
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-10 text-center">
            <CalendarClock className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">Chưa có chu kỳ nào được hoàn thành.</p>
          </div>
        )}
      </div>
    </div>
  );
}
