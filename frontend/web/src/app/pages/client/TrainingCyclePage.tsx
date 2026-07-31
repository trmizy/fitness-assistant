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
  Dumbbell,
  Flag,
  Loader2,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Utensils,
  X,
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
  INSUFFICIENT_DATA: {
    label: "Chưa đủ dữ liệu để đánh giá",
    className: "border-zinc-600/30 bg-zinc-500/5",
    buttonClassName: "bg-zinc-700 hover:bg-zinc-600",
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trainingCycleService.remove(id),
    onSuccess: () => {
      toast.success("Đã xoá chu kỳ tập luyện");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể xoá chu kỳ");
    },
  });

  // Distinct from completeMutation: cancelling never triggers a progress
  // evaluation or AI call, regardless of how much data exists — for a user
  // who wants to abandon the cycle outright (started by mistake, changed
  // their mind), not one asking "how did I do".
  const cancelMutation = useMutation({
    mutationFn: (id: string) => trainingCycleService.cancel(id),
    onSuccess: () => {
      toast.success("Đã huỷ chu kỳ tập luyện");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể huỷ chu kỳ");
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
            {summary.adherence.total > 0
              ? `${summary.adherence.completed}/${summary.adherence.total} buổi (${summary.adherence.percent}%)`
              : "Chưa có buổi nào được lên lịch"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${summary.adherence.percent ?? 0}%` }}
          />
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

      {summary.adherence.total === 0 && (
        <p className="text-[11px] text-amber-400/80">
          Chưa có buổi tập nào được lên lịch — kết thúc chu kỳ ngay bây giờ sẽ không tạo ra đánh giá tiến triển đáng tin cậy (đánh dấu "Chưa đủ dữ liệu").
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => completeMutation.mutate(cycle.id)}
          disabled={completing}
          title={summary.adherence.total === 0 ? "Chưa có buổi tập nào — chu kỳ sẽ đóng ở trạng thái Chưa đủ dữ liệu" : undefined}
          className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-60 text-zinc-200 py-2.5 rounded-xl text-sm font-bold transition-all"
        >
          {completing && <Loader2 className="w-4 h-4 animate-spin" />}
          {completing ? "Đang đóng chu kỳ..." : "Kết thúc chu kỳ"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Huỷ chu kỳ tập luyện này? Sẽ KHÔNG có đánh giá tiến triển nào được thực hiện — dùng khi bạn muốn bỏ chu kỳ này hẳn, không phải để xem kết quả.")) {
              cancelMutation.mutate(cycle.id);
            }
          }}
          disabled={cancelMutation.isPending}
          title="Huỷ chu kỳ mà không đánh giá tiến triển (khác với Kết thúc chu kỳ)"
          className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-amber-500/20 border border-zinc-700 hover:border-amber-500/40 disabled:opacity-60 text-zinc-400 hover:text-amber-400 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
        >
          {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Xoá chu kỳ tập luyện này? Bạn có thể bắt đầu một chu kỳ mới sau khi xoá.")) {
              deleteMutation.mutate(cycle.id);
            }
          }}
          disabled={deleteMutation.isPending}
          className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-red-500/20 border border-zinc-700 hover:border-red-500/40 disabled:opacity-60 text-zinc-400 hover:text-red-400 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
          title="Xoá chu kỳ"
        >
          {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/** Cycles that only ever went through the new /evaluate flow (created
 * directly as COMPLETED, or the legacy /complete analysis never ran for any
 * other reason) will sit in status COMPLETED forever — the legacy
 * ANALYZED transition only happens as a side effect of the OLD /complete
 * endpoint's fire-and-forget job. Without this, the card below would spin
 * on "AI đang phân tích..." with no way out. */
const LEGACY_ANALYSIS_STUCK_HINT_MS = 2 * 60 * 1000;

function DecisionCard({ cycle }: { cycle: TrainingCycle }) {
  const queryClient = useQueryClient();

  // Poll while AI analysis is still in flight (status COMPLETED but not yet ANALYZED).
  const cycleQuery = useQuery({
    queryKey: ["training-cycle", "detail", cycle.id],
    queryFn: () => trainingCycleService.get(cycle.id),
    initialData: cycle,
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" ? 4000 : false),
  });

  // Same query key + cache as AdaptiveAssessmentCard for this same cycle
  // (always rendered together, see the page layout below) — no extra
  // network request, just reads whatever's already been fetched. If the
  // NEW flow already produced a real result for this cycle, that result is
  // strictly more capable (6-state, safety flags, versioned) than anything
  // this legacy card could show, so defer to it entirely instead of also
  // showing a stuck/redundant "analyzing" spinner here.
  const latestAssessmentQuery = useQuery({
    queryKey: ["training-cycle", "assessment", "latest", cycle.id],
    queryFn: () => trainingCycleService.getLatestAssessment(cycle.id),
    retry: false,
  });

  // Records the approval on the ANALYZED cycle (audit trail: who approved
  // what plan, when — trainingCycleService.approve -> POST /:id/approve)
  // BEFORE creating the next cycle, instead of the previous behavior of
  // calling start() directly with no planId and no approval record at all.
  // Only called for KEEP/ADJUST, where the current plan is known and
  // genuinely carries forward unchanged — see the button logic below for
  // why NEW_PLAN is handled differently (no auto plan-creation pipeline
  // exists yet, so it must not silently reuse the old plan as if approved).
  const startNextMutation = useMutation({
    mutationFn: async (planId: string | null) => {
      if (planId) {
        await trainingCycleService.approve(cycle.id, planId);
      }
      return trainingCycleService.start(planId ? { planId } : undefined);
    },
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
    if (latestAssessmentQuery.data) return null;

    const stuckTooLong =
      Date.now() - new Date(current.updatedAt).getTime() > LEGACY_ANALYSIS_STUCK_HINT_MS;

    return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-green-500 animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-zinc-200">AI đang phân tích chu kỳ #{current.cycleIndex}...</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {stuckTooLong
              ? "Quá trình này đang lâu hơn dự kiến — bạn có thể dùng \"Đánh giá chu kỳ (nâng cao)\" bên dưới để nhận đề xuất ngay."
              : "Quá trình này có thể mất khoảng 1 phút."}
          </p>
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
        {decision === "INSUFFICIENT_DATA" && Array.isArray((current.aiAnalysis as any)?.reasonCodes) && (
          <p className="mt-2 text-xs text-zinc-500">
            Lý do: {(current.aiAnalysis as any).reasonCodes.join(", ")} — chu kỳ chưa đủ thời gian/số buổi tập để đưa ra đánh giá đáng tin cậy.
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

      {decision === "NEW_PLAN" ? (
        // No pipeline exists yet to turn aiAnalysis.newPlanDraft into a real
        // WorkoutPlan — silently reusing the OLD plan here would make
        // "Đồng ý" a lie (the user thinks they're accepting a new plan) and
        // auto-creating one would violate "AI must never auto-change the
        // plan without an explicit, real plan to point to". Block the
        // action with an honest explanation instead of either shortcut.
        <div className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-950/30 p-3.5 text-xs text-zinc-400">
          Đề xuất này cần một chương trình tập <strong>mới</strong>. Hãy tạo chương trình mới (qua AI Plans hoặc PT) trước, sau đó quay lại đây để bắt đầu chu kỳ tiếp theo với chương trình đó — hệ thống không tự tạo hoặc áp dụng chương trình thay bạn.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => startNextMutation.mutate(decision === "INSUFFICIENT_DATA" ? null : current.planId)}
          disabled={startNextMutation.isPending}
          className={`w-full flex items-center justify-center gap-2 ${cfg.buttonClassName} disabled:opacity-60 text-black py-2.5 rounded-xl text-sm font-bold transition-all`}
        >
          {startNextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {startNextMutation.isPending
            ? "Đang mở chu kỳ..."
            : decision === "INSUFFICIENT_DATA"
              ? "Bắt đầu chu kỳ mới"
              : "Đồng ý — mở chu kỳ tiếp theo (giữ chương trình hiện tại)"}
        </button>
      )}
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

function StatTile({
  label,
  value,
  sub,
  formula,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Plain-language "Cách tính" explanation — every stat here is a
   * computed/designed score, not a lab measurement, so this must always be
   * shown rather than left to be assumed self-evident (see report §10/§18
   * requirement to make every metric's formula inspectable in the UI). */
  formula: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3">
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <span>{label}</span>
        <button
          type="button"
          className="text-zinc-600 hover:text-zinc-400 focus-visible:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-500/50 rounded-full"
          title={formula}
          aria-label={`Cách tính ${label}: ${formula}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
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
        <StatTile
          label="Tuân thủ buổi tập"
          value={metrics.hasScheduledSessions ? `${Math.round(metrics.adherenceRate * 100)}%` : "Chưa có dữ liệu"}
          formula="Số buổi có trạng thái Hoàn thành ÷ tổng số buổi đã lên lịch trong chu kỳ tính đến hiện tại (hoặc đến ngày kết thúc nếu chu kỳ đã đóng). Không tính buổi trong tương lai chưa tới hạn. Hiển thị 'Chưa có dữ liệu' khi chưa có buổi nào được lên lịch — không phải 0%."
        />
        <StatTile
          label="Buổi/tuần"
          value={metrics.workoutsPerWeek.toString()}
          formula="Tổng số buổi đã hoàn thành ÷ số tuần đã trôi qua kể từ ngày bắt đầu chu kỳ."
        />
        <StatTile
          label="Sức mạnh"
          value={metrics.strengthProgressScore != null ? `${Math.round(metrics.strengthProgressScore * 100)}%` : "—"}
          formula="Điểm tổng hợp (không phải số đo lâm sàng) từ % thay đổi e1RM ước tính của từng bài giữa tuần đầu và tuần cuối có dữ liệu: -20% -> 0%, 0% -> 50%, +20% -> 100% (giới hạn 0-100%). Bài tập được đánh dấu ưu tiên tính gấp đôi trọng số. Đây là chỉ số thiết kế để hỗ trợ theo dõi xu hướng, không phải kết luận y khoa."
        />
        <StatTile
          label="Chất lượng dữ liệu"
          value={`${Math.round(metrics.dataQualityScore * 100)}%`}
          sub={!metrics.inBodyQuality.hasSufficientData ? "Cần thêm số liệu InBody" : undefined}
          formula="Kết hợp mức độ đầy đủ của nhật ký tập (trọng số 50%), số lần đo InBody có thể so sánh được (35%), và mức đầy đủ của phản hồi cảm nhận buổi tập RPE/đau (15%). Càng thấp nghĩa là kết luận của AI càng cần được xem là tham khảo, chưa chắc chắn."
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
        {evaluateMutation.isPending && (
          <p className="text-[11px] text-zinc-500">Quá trình này có thể mất đến 1-2 phút do cần gọi AI để giải thích kết quả.</p>
        )}
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

const REPORT_FLAG_LABELS: Record<string, string> = {
  PROTEIN_BELOW_TARGET: "Nạp protein trung bình thấp hơn mục tiêu cá nhân",
  PROTEIN_BELOW_EVIDENCE_RANGE: "Protein trung bình dưới ngưỡng khoa học cho tăng cơ (1.6–2.2g/kg thể trọng)",
  FREQUENT_SKIPPED_MEALS: "Bỏ bữa khá thường xuyên",
  FREQUENT_MISSED_SESSIONS: "Bỏ lỡ nhiều buổi tập hơn số buổi hoàn thành",
  PAIN_REPORTED: "Có buổi tập ghi nhận đau đáng kể (≥5/10)",
  HIGH_TRAINING_MONOTONY: "Lịch tập thiếu biến thiên (training monotony ≥2.0) — có thể tăng nguy cơ quá tải",
  RAPID_VOLUME_INCREASE: "Khối lượng tập tăng đột ngột (>50%) giữa 2 tuần liên tiếp",
};

function CycleReportModal({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const reportQuery = useQuery({
    queryKey: ["training-cycle", "report", cycleId],
    queryFn: () => trainingCycleService.getReport(cycleId),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60 sticky top-0 bg-zinc-900">
          <h3 className="text-zinc-100 font-bold flex items-center gap-2">
            <Flag className="w-4 h-4 text-green-400" />
            Báo cáo chu kỳ {reportQuery.data ? `#${reportQuery.data.cycle.cycleIndex}` : ""}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {reportQuery.isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          )}

          {reportQuery.isError && (
            <p className="text-sm text-red-400">Không thể tải báo cáo chu kỳ.</p>
          )}

          {reportQuery.data && (
            <>
              <p className="text-xs text-zinc-500">
                {formatDate(reportQuery.data.window.startDate)} – {formatDate(reportQuery.data.window.endDate)}
              </p>

              {reportQuery.data.flags.length > 0 && (
                <div className="space-y-2">
                  {reportQuery.data.flags.map((flag) => (
                    <div key={flag} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400 mt-0.5" />
                      <p className="text-xs text-amber-200">{REPORT_FLAG_LABELS[flag] ?? flag}</p>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                  <Dumbbell className="w-3.5 h-3.5 text-green-400" /> Buổi tập
                </h4>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-zinc-800/60 p-2.5">
                    <p className="text-lg font-bold text-zinc-100">{reportQuery.data.workouts.completed}</p>
                    <p className="text-[11px] text-zinc-500">Hoàn thành</p>
                  </div>
                  <div className="rounded-lg bg-zinc-800/60 p-2.5">
                    <p className="text-lg font-bold text-red-400">{reportQuery.data.workouts.missed}</p>
                    <p className="text-[11px] text-zinc-500">Bỏ lỡ</p>
                  </div>
                  <div className="rounded-lg bg-zinc-800/60 p-2.5">
                    <p className="text-lg font-bold text-zinc-100">{reportQuery.data.workouts.completionRate}%</p>
                    <p className="text-[11px] text-zinc-500">Tỷ lệ</p>
                  </div>
                </div>
                {reportQuery.data.workouts.missedSessions.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Ngày bỏ lỡ: {reportQuery.data.workouts.missedSessions.map((s) => formatDate(s.date)).join(", ")}
                  </p>
                )}
                {reportQuery.data.workouts.highPainSessions.length > 0 && (
                  <p className="mt-1.5 text-xs text-red-400">
                    {reportQuery.data.workouts.highPainSessions.length} buổi tập ghi nhận đau đáng kể
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                  <Utensils className="w-3.5 h-3.5 text-orange-400" /> Dinh dưỡng
                </h4>
                {reportQuery.data.nutrition.daysLogged > 0 ? (
                  <div className="space-y-1.5 text-xs text-zinc-400">
                    <p>
                      Protein trung bình:{" "}
                      <span className="font-semibold text-zinc-200">
                        {Math.round(reportQuery.data.nutrition.avgProtein ?? 0)}g
                      </span>
                      {reportQuery.data.nutrition.targetProtein != null && (
                        <> / mục tiêu {reportQuery.data.nutrition.targetProtein}g ({reportQuery.data.nutrition.proteinAdherencePct}%)</>
                      )}
                    </p>
                    <p>
                      Calories trung bình:{" "}
                      <span className="font-semibold text-zinc-200">
                        {Math.round(reportQuery.data.nutrition.avgCalories ?? 0)} kcal
                      </span>
                      {reportQuery.data.nutrition.targetCalories != null && (
                        <> / mục tiêu {reportQuery.data.nutrition.targetCalories} kcal ({reportQuery.data.nutrition.caloriesAdherencePct}%)</>
                      )}
                    </p>
                    {reportQuery.data.nutrition.proteinPerKgBodyWeight != null && (
                      <p>
                        Protein/kg thể trọng:{" "}
                        <span className="font-semibold text-zinc-200">
                          {reportQuery.data.nutrition.proteinPerKgBodyWeight}g/kg
                        </span>{" "}
                        (khuyến nghị khoa học: {reportQuery.data.nutrition.proteinEvidenceRangeGPerKg.min}–
                        {reportQuery.data.nutrition.proteinEvidenceRangeGPerKg.max}g/kg cho tăng cơ)
                      </p>
                    )}
                    <p>
                      Số ngày ghi log: {reportQuery.data.nutrition.daysLogged}/{reportQuery.data.nutrition.totalDaysInWindow}, bỏ bữa: {reportQuery.data.nutrition.skippedMeals}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Không có dữ liệu dinh dưỡng được ghi log trong chu kỳ này.</p>
                )}
              </div>

              {reportQuery.data.trainingLoad.hasData && (
                <div>
                  <h4 className="text-xs font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Tải trọng &amp; biến thiên tập luyện
                  </h4>
                  <div className="space-y-1 text-xs text-zinc-400">
                    {reportQuery.data.trainingLoad.weeklyLoad.map((w) => (
                      <p key={w.week}>
                        Tuần {w.week}: tải {w.totalLoad}
                        {w.monotony != null && (
                          <>
                            {" "}
                            · monotony{" "}
                            <span className={w.monotony >= reportQuery.data!.trainingLoad.monotonyThreshold ? "text-amber-400 font-semibold" : "text-zinc-300"}>
                              {w.monotony}
                            </span>
                          </>
                        )}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {reportQuery.data.newPRs.length > 0 && (
                <p className="text-xs text-green-400">🏆 PR mới: {reportQuery.data.newPRs.join(", ")}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CycleHistoryRow({ cycle }: { cycle: TrainingCycle }) {
  const queryClient = useQueryClient();
  const trend = cycle.summary?.progressSignals?.overallTrend;
  const [showReport, setShowReport] = useState(false);
  const isClosed = cycle.status === "COMPLETED" || cycle.status === "ANALYZED";

  // "Tuân thủ" here means the SAME thing as the "Tuân thủ" stat tile in
  // CycleProgressSection below (session-level adherence, see that
  // component's own formula comment) — sourced from whichever flow actually
  // has real data for this cycle: the legacy summary (old /complete path)
  // if present, else the new versioned assessment's computedMetrics (same
  // query key as AdaptiveAssessmentCard/DecisionCard for this cycle, so
  // this reuses whatever's already cached instead of adding a request).
  // Never fabricated as 0% just because neither source has run yet.
  const latestAssessmentQuery = useQuery({
    queryKey: ["training-cycle", "assessment", "latest", cycle.id],
    queryFn: () => trainingCycleService.getLatestAssessment(cycle.id),
    retry: false,
    enabled: isClosed && cycle.summary?.adherence == null,
  });
  const adherencePercent =
    cycle.summary?.adherence?.percent ??
    (latestAssessmentQuery.data?.computedMetrics
      ? Math.round(latestAssessmentQuery.data.computedMetrics.adherenceRate * 100)
      : null);

  const deleteMutation = useMutation({
    mutationFn: () => trainingCycleService.remove(cycle.id),
    onSuccess: () => {
      toast.success("Đã xoá chu kỳ tập luyện");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể xoá chu kỳ");
    },
  });

  return (
    <>
      <div
        onClick={() => isClosed && setShowReport(true)}
        className={`flex flex-col gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 sm:flex-row sm:items-center sm:justify-between ${isClosed ? "cursor-pointer hover:border-zinc-700" : ""}`}
      >
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <CalendarClock className="h-4 w-4 text-zinc-500" />
            Chu kỳ #{cycle.cycleIndex}: {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-500">
              Tuân thủ buổi tập: {adherencePercent != null ? `${adherencePercent}%` : "Chưa có dữ liệu"}
            </span>
            {cycle.decision && (
              <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                {cycle.decision === "KEEP" ? <TrendingUp className="h-3.5 w-3.5 text-green-400" /> : cycle.decision === "NEW_PLAN" ? <TrendingDown className="h-3.5 w-3.5 text-red-400" /> : null}
                {DECISION_CONFIG[cycle.decision].label}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendBadge trend={trend} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm("Xoá chu kỳ tập luyện này khỏi lịch sử?")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="flex items-center justify-center rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:border-red-500/40 hover:text-red-400 disabled:opacity-60 transition-all"
            title="Xoá chu kỳ"
          >
            {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {showReport && <CycleReportModal cycleId={cycle.id} onClose={() => setShowReport(false)} />}
    </>
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

      {/* A stale proposal from an older COMPLETED/ANALYZED cycle must never
          be offered once a newer cycle already exists and is running — the
          user has already moved on (whether by approving it or starting a
          fresh cycle some other way). Only show the "start next cycle"
          proposal when there is genuinely no active cycle to conflict with. */}
      {!activeCycle && activeOrRecentCycle && <DecisionCard cycle={activeOrRecentCycle} />}

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
