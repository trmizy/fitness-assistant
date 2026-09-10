import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightIcon as ArrowRight,
  CaretDownIcon as CaretDown,
  CheckCircleIcon as CheckCircle2,
  CircleNotchIcon as Loader2,
  MapTrifoldIcon as MapTrifold,
  ProhibitIcon as Ban,
  SparkleIcon as Sparkles,
  TrophyIcon as Trophy,
  WarningIcon as AlertTriangle,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import {
  fitnessRoadmapService,
  type CurrentForecastResult,
  type FitnessRoadmapProjection,
  type ReconciliationStatus,
  type RoadmapPhaseForecastResult,
  type RoadmapPhaseType,
  type RoadmapPhaseWithCycles,
  type RoadmapTrainingReadiness,
  type RoadmapNutritionReadiness,
} from "../../services/api";
import { GuidedRoadmapWizard, PhaseForecastCard, STRATEGY_BUCKET_LABEL } from "./GuidedRoadmapWizard";

// FitnessRoadmap + RoadmapPhase "Fitness Journey" experience — Phase C of
// the roadmap next-phase work. Orchestration/read-only view over the real
// source-of-truth data (TrainingCycle, NutritionGoal, WorkoutSchedule); this
// page never edits calories/macros/workout content directly, only roadmap
// lifecycle actions (create/activate/advance/rebuild/archive).

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const GOAL_OPTIONS = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao" },
];

const PHASE_TYPE_LABEL: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Giảm mỡ",
  DIET_BREAK: "Nghỉ giữa kỳ",
  MAINTENANCE: "Duy trì",
  LEAN_GAIN: "Tăng cơ nạc",
  MINI_CUT: "Cắt ngắn",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
  PERFORMANCE: "Hiệu suất",
  RECOVERY: "Hồi phục",
};

const PHASE_STATUS_CONFIG: Record<
  RoadmapPhaseWithCycles["status"],
  { label: string; dotClassName: string; textClassName: string }
> = {
  PLANNED: { label: "Sắp tới", dotClassName: "bg-zinc-600", textClassName: "text-zinc-500" },
  ACTIVE: { label: "Đang diễn ra", dotClassName: "bg-green-500", textClassName: "text-green-400" },
  COMPLETED: { label: "Đã hoàn thành", dotClassName: "bg-blue-500", textClassName: "text-blue-400" },
  SKIPPED: { label: "Đã bỏ qua (thay đổi lộ trình)", dotClassName: "bg-zinc-700", textClassName: "text-zinc-600" },
  CANCELLED: { label: "Đã huỷ", dotClassName: "bg-red-500", textClassName: "text-red-400" },
};

const ROADMAP_STATUS_LABEL: Record<FitnessRoadmapProjection["roadmap"]["status"], string> = {
  DRAFT: "Bản nháp",
  ACTIVE: "Đang thực hiện",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã huỷ",
  ARCHIVED: "Đã lưu trữ",
};

// Vietnamese, user-facing provenance labels — never expose the raw enum
// name (CLIENT/PT/AI/SYSTEM) directly (master task §4.2).
const CREATOR_ROLE_LABEL: Record<FitnessRoadmapProjection["roadmap"]["createdByRole"], string> = {
  CLIENT: "Bạn tạo",
  PT: "Được PT đề xuất",
  AI: "AI đề xuất",
  SYSTEM: "Hệ thống tạo",
};

function isNotFound(error: any) {
  return error?.response?.status === 404;
}

// AI-generated summary/warnings/assumptions/confidence are not their own
// source-of-truth columns — persisted (additively, same convention as
// TrainingCycle.configuration already storing auxiliary orchestration
// metadata) inside FitnessRoadmap.configuration.aiDraft so a DRAFT roadmap
// still shows them after a refresh/re-fetch, before the user has decided
// to activate it.
type PersistedAiDraftMeta = {
  summary: string;
  reasoningSummary: string;
  confidence: number;
  warnings: string[];
  assumptions: string[];
};

// ── Manual quick-create ──────────────────────────────────────────────────

function ManualCreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("Lộ trình của tôi");
  const [goalType, setGoalType] = useState("WEIGHT_LOSS");
  const [phaseType, setPhaseType] = useState<RoadmapPhaseType>("FAT_LOSS");
  const [durationWeeks, setDurationWeeks] = useState(8);

  const createMutation = useMutation({
    mutationFn: async () => {
      const startAt = new Date().toISOString().slice(0, 10);
      const endAt = new Date(Date.now() + durationWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
      // Saves as DRAFT only — activation is a separate, explicit step (see
      // the DRAFT review state in the root page), same as the AI-draft path.
      return fitnessRoadmapService.create({
        name: name.trim() || "Lộ trình của tôi",
        goalType,
        plannedStartAt: startAt,
        phases: [
          { phaseIndex: 1, name: PHASE_TYPE_LABEL[phaseType], phaseType, plannedStartAt: startAt, plannedEndAt: endAt },
        ],
      });
    },
    onSuccess: () => {
      toast.success("Đã lưu bản nháp lộ trình");
      onCreated();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể tạo lộ trình");
    },
  });

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-100">Tạo lộ trình thủ công</p>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">
          Đóng
        </button>
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-zinc-400">Tên lộ trình</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-green-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-zinc-400">Mục tiêu</label>
        <div className="flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGoalType(g.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                goalType === g.key
                  ? "border-green-500 bg-green-500 text-black"
                  : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:border-green-500/40"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-zinc-400">Giai đoạn bắt đầu</label>
        <select
          value={phaseType}
          onChange={(e) => setPhaseType(e.target.value as RoadmapPhaseType)}
          className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-green-500 focus:outline-none"
        >
          {(Object.keys(PHASE_TYPE_LABEL) as RoadmapPhaseType[]).map((pt) => (
            <option key={pt} value={pt}>
              {PHASE_TYPE_LABEL[pt]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-zinc-400">Thời gian giai đoạn (tuần)</label>
        <input
          type="number"
          min={1}
          max={26}
          value={durationWeeks}
          onChange={(e) => setDurationWeeks(Number(e.target.value) || 8)}
          className="w-28 rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-green-500 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 disabled:opacity-60"
      >
        {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {createMutation.isPending ? "Đang tạo..." : "Tạo bản nháp"}
      </button>
    </div>
  );
}

// ── No-roadmap state ─────────────────────────────────────────────────────
// Gymini Guided Roadmap Creation (design doc §14): the guided wizard is now
// the default, primary path — the old flat "Tạo bằng AI" / "Tạo thủ công"
// buttons (which jumped straight to a raw phase list / raw phaseType enum
// picker) are replaced by a single continuous 4-step flow. Manual/expert
// mode is preserved, never deleted, but repositioned as a clearly-labeled
// secondary option for users who want direct control over phaseType.

function NoRoadmapState({ onReady }: { onReady: () => void }) {
  const [mode, setMode] = useState<"none" | "wizard" | "manual">("none");

  if (mode === "wizard") return <GuidedRoadmapWizard onClose={() => setMode("none")} onCreated={onReady} />;
  if (mode === "manual") return <ManualCreatePanel onClose={() => setMode("none")} onCreated={onReady} />;

  return (
    <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6 text-center">
      <MapTrifold className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
      <p className="mb-1 text-sm font-semibold text-zinc-200">Bạn chưa có lộ trình dài hạn nào</p>
      <p className="mb-4 text-xs text-zinc-500">
        Một lộ trình chia mục tiêu dài hạn thành các giai đoạn (giảm mỡ, nghỉ giữa kỳ, duy trì...) để bạn luôn biết mình
        đang ở đâu và tiếp theo là gì. Gymini sẽ hỏi vài thông tin rồi cùng bạn xây dựng lộ trình phù hợp.
      </p>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("wizard")}
          className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400"
        >
          <Sparkles className="h-4 w-4" />
          Tạo lộ trình cùng Gymini
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className="mt-1 text-xs font-semibold text-zinc-500 underline hover:text-zinc-300"
        >
          Tạo lộ trình nâng cao (tự chọn từng giai đoạn)
        </button>
      </div>
    </div>
  );
}

// ── Pending rebuild banner ───────────────────────────────────────────────

function PendingRebuildBanner({
  roadmapId,
  assessmentId,
  currentPhaseId,
  phases,
  onApplied,
}: {
  roadmapId: string;
  assessmentId: string;
  currentPhaseId: string;
  phases: RoadmapPhaseWithCycles[];
  onApplied: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const previewQuery = useQuery({
    queryKey: ["fitness-roadmap", "rebuild-preview", roadmapId, assessmentId],
    queryFn: () => fitnessRoadmapService.previewRebuild(roadmapId),
    enabled: previewOpen,
    retry: false,
  });

  const applyMutation = useMutation({
    mutationFn: () => fitnessRoadmapService.applyRebuild(roadmapId, { assessmentId }),
    onSuccess: () => {
      toast.success("Đã cập nhật lại lộ trình phía trước");
      onApplied();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể cập nhật lộ trình");
    },
  });

  // "Hiện tại" side of the before/after split: the current phase (will be
  // marked hoàn thành) plus every still-PLANNED phase after it (will be
  // marked "đã bỏ qua" — real response data, not a mock example).
  const currentPhaseIndex = phases.findIndex((p) => p.id === currentPhaseId);
  const affectedCurrentPhases = currentPhaseIndex >= 0 ? phases.slice(currentPhaseIndex) : [];

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-semibold text-amber-200">Gymini gợi ý xây dựng lại phần còn lại của lộ trình</p>
          <p className="text-xs text-amber-300/80">
            Dựa trên đánh giá chu kỳ gần nhất, các giai đoạn phía trước cần được điều chỉnh. Lịch sử tập luyện, dinh
            dưỡng và đánh giá của bạn không bị xoá hay thay đổi — chỉ các giai đoạn CHƯA diễn ra mới được thay thế.
          </p>
        </div>
      </div>

      {!previewOpen && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/10"
        >
          Xem đề xuất
        </button>
      )}

      {previewOpen && previewQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin text-amber-400" />}

      {previewOpen && previewQuery.data && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Hiện tại</p>
              <div className="space-y-1.5">
                {affectedCurrentPhases.map((phase, i) => (
                  <div key={phase.id} className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2 text-xs">
                    <p className="text-zinc-200">
                      {phase.name} <span className="text-zinc-500">· {PHASE_TYPE_LABEL[phase.phaseType]}</span>
                    </p>
                    <p className="text-zinc-500">{i === 0 ? "Sẽ đánh dấu hoàn thành" : "Sẽ bị bỏ qua (thay bằng đề xuất mới)"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">Đề xuất mới</p>
              <div className="space-y-1.5">
                {previewQuery.data.proposedPhases.map((phase, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <p className="text-zinc-100">
                      {phase.name} <span className="text-zinc-500">· {PHASE_TYPE_LABEL[phase.phaseType]}</span>
                    </p>
                    <p className="text-zinc-500">{formatDate(phase.plannedStartAt)} → {formatDate(phase.plannedEndAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
            className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-black transition-all hover:bg-amber-400 disabled:opacity-60"
          >
            {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {applyMutation.isPending ? "Đang áp dụng..." : "Áp dụng đề xuất này"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Active phase detail ──────────────────────────────────────────────────

// Gymini Training Navigation Simplification (design doc §14) — this is now
// where the current TrainingCycle's own numbers (adherence/weight
// trend/strength progress, from its latest CycleAssessment.computedMetrics
// — the same real, already-computed data TrainingCyclePage itself reads,
// never a re-derivation) live inline, so a user rarely needs to leave the
// Journey tab at all. TrainingCyclePage itself is unchanged and still
// reachable via "Xem chi tiết chu kỳ" for the full drill-down (session-by-
// session history, volume charts, etc.).
function trendLabel(trend: { direction: "up" | "flat" | "down"; changePerWeek: number | null } | null | undefined, unit: string) {
  if (!trend || trend.changePerWeek == null) return null;
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→";
  return `${arrow} ${Math.abs(trend.changePerWeek).toFixed(1)}${unit}/tuần`;
}

const ASSESSMENT_DECISION_LABEL: Record<string, string> = {
  KEEP: "Giữ nguyên",
  PROGRESS: "Tăng tải",
  ADJUST: "Điều chỉnh nhỏ",
  DELOAD: "Giảm tải (deload)",
  REBUILD: "Xây lại chương trình",
};

function ActivePhaseDetail({
  phase,
  projectionSnapshot,
  trainingReadiness,
  nutritionReadiness,
}: {
  phase: RoadmapPhaseWithCycles;
  projectionSnapshot?: RoadmapPhaseForecastResult | null;
  trainingReadiness?: RoadmapTrainingReadiness | null;
  nutritionReadiness?: RoadmapNutritionReadiness | null;
}) {
  const navigate = useNavigate();
  const activeCycle = phase.trainingCycles.find((c) => c.status === "ACTIVE");
  const latestGoal = activeCycle?.nutritionGoals.find((g) => g.status === "ACTIVE") ?? activeCycle?.nutritionGoals[0];
  const scheduleTotal = activeCycle?.schedules.length ?? 0;
  const scheduleCompleted = activeCycle?.schedules.filter((s) => s.status === "COMPLETED").length ?? 0;
  const metrics = activeCycle?.latestAssessment?.computedMetrics ?? null;
  const weightTrendLabel = trendLabel(metrics?.bodyWeightTrend, "kg");
  // Roadmap Projection & Strategy Report Hardening (design doc §15) — the
  // ACTIVE journey always prioritizes real data; a projection is only ever
  // a small historical-context note under the real number, never visually
  // equal-weighted with it.
  const originalForecast = projectionSnapshot?.phaseForecasts.find((f) => f.phaseIndex === phase.phaseIndex) ?? null;

  return (
    <div className="space-y-4 rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-green-400">Giai đoạn hiện tại</p>
          <p className="text-lg font-bold text-zinc-100">{phase.name}</p>
          <p className="text-xs text-zinc-500">{PHASE_TYPE_LABEL[phase.phaseType]}</p>
        </div>
        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-bold text-green-400">
          Chu kỳ {phase.progress.cycleCount}
          {phase.objective?.maxCycles ? ` / ${phase.objective.maxCycles}` : ""}
        </span>
      </div>

      {activeCycle ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
              <p className="text-xs text-zinc-500">Bắt đầu chu kỳ</p>
              <p className="text-sm font-semibold text-zinc-200">{formatDate(activeCycle.startDate)}</p>
            </div>
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
              <p className="text-xs text-zinc-500">Dự kiến kết thúc</p>
              <p className="text-sm font-semibold text-zinc-200">{formatDate(activeCycle.endDate)}</p>
            </div>
            {latestGoal && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                <p className="text-xs text-zinc-500">Dinh dưỡng hiện tại</p>
                <p className="text-sm font-semibold text-zinc-200">
                  {latestGoal.calories} kcal · {latestGoal.protein}g đạm
                </p>
                {originalForecast && originalForecast.projectedCalories !== latestGoal.calories && (
                  <p className="mt-1 text-xs text-zinc-600">
                    Dự kiến ban đầu: ~{originalForecast.projectedCalories.toLocaleString("vi-VN")} kcal/ngày · Điều chỉnh từ dự
                    kiến ban đầu dựa trên dữ liệu thực tế.
                  </p>
                )}
              </div>
            )}
            {scheduleTotal > 0 && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                <p className="text-xs text-zinc-500">Buổi tập</p>
                <p className="text-sm font-semibold text-zinc-200">
                  {scheduleCompleted}/{scheduleTotal} hoàn thành
                </p>
              </div>
            )}
            {metrics?.hasScheduledSessions && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                <p className="text-xs text-zinc-500">Tuân thủ lịch tập</p>
                <p className="text-sm font-semibold text-zinc-200">{Math.round(metrics.adherenceRate * 100)}%</p>
              </div>
            )}
            {weightTrendLabel && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                <p className="text-xs text-zinc-500">Xu hướng cân nặng</p>
                <p className="text-sm font-semibold text-zinc-200">{weightTrendLabel}</p>
              </div>
            )}
            {metrics?.strengthProgressScore != null && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                <p className="text-xs text-zinc-500">Tiến bộ sức mạnh</p>
                <p className="text-sm font-semibold text-zinc-200">{Math.round(metrics.strengthProgressScore * 100)}%</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate("/workout/cycle")}
            className="flex items-center gap-1.5 text-xs font-semibold text-green-300 hover:text-green-200"
          >
            Xem chi tiết chu kỳ <ArrowRight className="h-3.5 w-3.5" />
          </button>

          {/* Adaptive Cycle Transition Continuity (design doc, P2-1 fix) —
              a Roadmap-driven cycle never auto-receives a workout schedule
              (no blind copy across KEEP/PROGRESS/ADJUST/DELOAD/REBUILD —
              see the design doc's "chosen continuity policy"). Surface the
              real state immediately instead of letting the user discover
              an empty Workout page on their own. */}
          {trainingReadiness && trainingReadiness.status === "NEEDS_GENERATION" && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" data-testid="cycle-training-readiness-needs-generation">
              <p className="text-sm font-semibold text-amber-300">Chu kỳ mới đã sẵn sàng</p>
              <p className="text-xs text-amber-200/80">Lịch tập cho chu kỳ mới chưa được tạo.</p>
              {trainingReadiness.lastAssessmentDecision && (
                <p className="text-xs text-zinc-500">
                  Đánh giá gần nhất: {ASSESSMENT_DECISION_LABEL[trainingReadiness.lastAssessmentDecision] ?? trainingReadiness.lastAssessmentDecision}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="cycle-readiness-generate-cta"
                  onClick={() => navigate("/client/plans")}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-all hover:bg-amber-400"
                >
                  Tạo lịch tập bằng AI
                </button>
                {trainingReadiness.canReuseLastProgram && (
                  <button
                    type="button"
                    data-testid="cycle-readiness-reuse-cta"
                    onClick={() => navigate("/client/plans")}
                    className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-all hover:bg-amber-500/10"
                  >
                    Dùng lại chương trình trước
                  </button>
                )}
              </div>
            </div>
          )}
          {trainingReadiness && trainingReadiness.status === "READY" && (
            <p className="text-xs font-semibold text-green-400" data-testid="cycle-training-readiness-ready">
              ✓ Lịch tập cho chu kỳ này đã sẵn sàng
            </p>
          )}
          {nutritionReadiness && nutritionReadiness.status === "NEEDS_GENERATION" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" data-testid="cycle-nutrition-readiness-needs-generation">
              <p className="text-sm font-semibold text-amber-300">Chưa có mục tiêu dinh dưỡng</p>
              <button
                type="button"
                onClick={() => navigate("/client/nutrition")}
                className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-all hover:bg-amber-400"
              >
                Thiết lập dinh dưỡng
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-500">Giai đoạn này chưa có chu kỳ tập nào đang diễn ra.</p>
      )}
    </div>
  );
}

// ── Completed Roadmap terminal summary (Gap C, design doc §8/§9/§10) ────
// Uses real data only — every field renders "Không đủ dữ liệu" instead of
// a fabricated number when the underlying source (original snapshot,
// real final measurement) doesn't exist. The original forecast stays
// permanently reachable via a secondary disclosure, never deleted.

function CompletedRoadmapSummary({ data }: { data: FitnessRoadmapProjection }) {
  const { roadmap } = data;
  const summary = data.finalSummary;
  const [showOriginal, setShowOriginal] = useState(false);
  const originalSnapshot = (roadmap.configuration as any)?.roadmapProjectionSnapshot as RoadmapPhaseForecastResult | undefined;

  return (
    <div className="space-y-3 rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-blue-400" />
        <p className="text-sm font-semibold text-blue-200">Hoàn thành lộ trình</p>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-blue-300/70">Bắt đầu</p>
            <p className="font-semibold text-blue-100">
              {summary.startWeightKg != null ? `${summary.startWeightKg} kg` : "Không đủ dữ liệu"}
              {summary.startBodyFatPct != null ? ` · ${summary.startBodyFatPct}% mỡ` : ""}
            </p>
          </div>
          <div>
            <p className="text-blue-300/70">Dự kiến ban đầu</p>
            <p className="font-semibold text-blue-100">
              {summary.originalProjectedEndWeightKg != null ? `${summary.originalProjectedEndWeightKg} kg` : "Không đủ dữ liệu"}
              {summary.originalProjectedEndBodyFatPct != null ? ` · ${summary.originalProjectedEndBodyFatPct}% mỡ` : ""}
            </p>
          </div>
          <div>
            <p className="text-blue-300/70">Kết quả thực tế</p>
            <p className="font-semibold text-blue-100">
              {summary.actualFinalWeightKg != null ? `${summary.actualFinalWeightKg} kg` : "Không đủ dữ liệu"}
              {summary.actualFinalBodyFatPct != null ? ` · ${summary.actualFinalBodyFatPct}% mỡ` : ""}
            </p>
          </div>
          {summary.totalWeeks != null && (
            <div>
              <p className="text-blue-300/70">Thời gian</p>
              <p className="font-semibold text-blue-100">{summary.totalWeeks} tuần</p>
            </div>
          )}
          <div>
            <p className="text-blue-300/70">Giai đoạn</p>
            <p className="font-semibold text-blue-100">
              {summary.completedPhaseCount}/{summary.totalPhaseCount} hoàn thành
            </p>
          </div>
          <div>
            <p className="text-blue-300/70">Chu kỳ</p>
            <p className="font-semibold text-blue-100">{summary.cycleCount} chu kỳ</p>
          </div>
          {summary.rebuildCount > 0 && (
            <div>
              <p className="text-blue-300/70">Điều chỉnh chiến lược</p>
              <p className="font-semibold text-blue-100">{summary.rebuildCount} lần</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-blue-300/70">Không đủ dữ liệu để tổng kết chi tiết lộ trình này.</p>
      )}

      {originalSnapshot && (
        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((s) => !s)}
            className="text-xs font-semibold text-blue-300 underline hover:text-blue-200"
          >
            {showOriginal ? "Ẩn lộ trình ban đầu" : "Xem lộ trình ban đầu"}
          </button>
          {showOriginal && (
            <div className="mt-2 space-y-2">
              {originalSnapshot.strategyGroups.map((group) => {
                const groupForecasts = originalSnapshot.phaseForecasts.filter((f) => group.phaseIndexes.includes(f.phaseIndex));
                return (
                  <div key={group.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                    <p className="mb-1.5 text-xs font-semibold text-zinc-400">
                      {group.key} · {STRATEGY_BUCKET_LABEL[group.bucket]}
                    </p>
                    <div className="space-y-2">
                      {groupForecasts.map((f) => (
                        <PhaseForecastCard key={f.phaseIndex} forecast={f} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Adaptive Forecast Reconciliation (design doc §14) ───────────────────
// "Chu kỳ vừa qua" (original vs actual for the most recently completed
// phase) + "Dự báo đã cập nhật" (the freshly-computed remaining-journey
// forecast, chained from the user's latest real state) + a secondary,
// collapsed "Xem dự kiến ban đầu" disclosure. Never shown for a DRAFT
// (§30 of the master task — there is no execution yet to compare
// against) — this component is only ever mounted for an ACTIVE roadmap.

const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = {
  ON_TRACK: "Đang đúng tiến độ",
  AHEAD_OF_FORECAST: "Nhanh hơn dự kiến",
  // Deliberately never "thất bại"/"không tuân thủ" (master task §24) —
  // this is a forecast comparison, not a moral judgment.
  BEHIND_FORECAST: "Tiến độ chậm hơn kịch bản ban đầu",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu để đánh giá",
};

const CONFIDENCE_TIER_LABEL: Record<string, string> = {
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp",
};

function AdaptiveForecastSection({ roadmapId }: { roadmapId: string }) {
  const forecastQuery = useQuery({
    queryKey: ["fitness-roadmap", "current-forecast", roadmapId],
    queryFn: fitnessRoadmapService.getCurrentForecast,
    retry: false,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  if (forecastQuery.isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />;
  }
  if (!forecastQuery.data) return null;

  const { originalForecast, currentForecast, reconciliations, changeExplanation } = forecastQuery.data as CurrentForecastResult;
  const latestReconciliation = reconciliations[reconciliations.length - 1] ?? null;
  const nearTermForecast = currentForecast?.phaseForecasts[0] ?? null;

  return (
    <div className="space-y-4">
      {latestReconciliation && (
        <div className="space-y-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Chu kỳ vừa qua</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-zinc-500">Dự kiến</p>
              <p className="text-sm font-semibold text-zinc-200">
                {latestReconciliation.weight ? `${latestReconciliation.weight.expected} kg` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Thực tế</p>
              <p className="text-sm font-semibold text-zinc-200">
                {latestReconciliation.weight ? `${latestReconciliation.weight.actual} kg` : "Chưa đủ dữ liệu"}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Chênh lệch</p>
              <p className="text-sm font-semibold text-zinc-200">
                {latestReconciliation.weight
                  ? `${latestReconciliation.weight.delta > 0 ? "+" : ""}${latestReconciliation.weight.delta} kg`
                  : "—"}
              </p>
            </div>
          </div>
          {(latestReconciliation.adherenceRate != null || latestReconciliation.strengthProgressScore != null) && (
            <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
              {latestReconciliation.adherenceRate != null && <span>Tuân thủ: {Math.round(latestReconciliation.adherenceRate * 100)}%</span>}
              {latestReconciliation.strengthProgressScore != null && (
                <span>
                  Sức mạnh: {latestReconciliation.strengthProgressScore >= 0 ? "+" : ""}
                  {Math.round(latestReconciliation.strengthProgressScore * 100)}%
                </span>
              )}
            </div>
          )}
          <p className="text-xs font-semibold text-green-300">
            Gymini: {RECONCILIATION_STATUS_LABEL[latestReconciliation.status]}
          </p>
        </div>
      )}

      {nearTermForecast && (
        <div className="space-y-2 rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-zinc-900 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-400">Dự báo đã cập nhật</p>
          <p className="text-sm text-zinc-200">
            Khoảng dự báo tham khảo: {nearTermForecast.projectedEndWeightRangeKg.low}–{nearTermForecast.projectedEndWeightRangeKg.high} kg
            <span className="text-zinc-500"> (kỳ vọng ~{nearTermForecast.projectedEndWeightRangeKg.expected} kg)</span>
          </p>
          <p className="text-xs text-zinc-500">
            Độ tin cậy dữ liệu cho dự báo: {CONFIDENCE_TIER_LABEL[nearTermForecast.confidence.tier]}
          </p>
          {changeExplanation && <p className="text-xs text-zinc-400">{changeExplanation}</p>}
          <p className="text-xs text-zinc-600">Đây là dự báo, không phải cam kết kết quả.</p>
        </div>
      )}

      {originalForecast && (
        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((s) => !s)}
            className="flex items-center gap-1 text-xs font-semibold text-zinc-500 underline hover:text-zinc-300"
          >
            {showOriginal ? "Ẩn dự kiến ban đầu" : "Xem dự kiến ban đầu"}
          </button>
          {showOriginal && (
            <div className="mt-2 space-y-2">
              {originalForecast.strategyGroups.map((group) => {
                const groupForecasts = originalForecast.phaseForecasts.filter((f) => group.phaseIndexes.includes(f.phaseIndex));
                return (
                  <div key={group.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                    <p className="mb-1.5 text-xs font-semibold text-zinc-400">
                      {group.key} · {STRATEGY_BUCKET_LABEL[group.bucket]}
                    </p>
                    <div className="space-y-2">
                      {groupForecasts.map((f) => (
                        <PhaseForecastCard key={f.phaseIndex} forecast={f} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Phase timeline ────────────────────────────────────────────────────────

function PhaseTimeline({ phases }: { phases: RoadmapPhaseWithCycles[] }) {
  return (
    <div className="space-y-0">
      {phases.map((phase, i) => {
        const cfg = PHASE_STATUS_CONFIG[phase.status];
        const isLast = i === phases.length - 1;
        return (
          <div key={phase.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 flex-shrink-0 rounded-full ${cfg.dotClassName}`} />
              {!isLast && <div className="w-px flex-1 bg-zinc-800" style={{ minHeight: 24 }} />}
            </div>
            <div className={`min-w-0 flex-1 pb-4 ${isLast ? "" : ""}`}>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-semibold ${phase.status === "ACTIVE" ? "text-zinc-100" : "text-zinc-400"}`}>
                  {phase.name}
                </p>
                <span className={`text-xs ${cfg.textClassName}`}>{cfg.label}</span>
              </div>
              <p className="text-xs text-zinc-600">
                {PHASE_TYPE_LABEL[phase.phaseType]} · {formatDate(phase.plannedStartAt)} → {formatDate(phase.plannedEndAt)}
              </p>
              {phase.progress.cycleCount > 0 && (
                <p className="text-xs text-zinc-600">
                  {phase.progress.completedCycleCount}/{phase.progress.cycleCount} chu kỳ đã hoàn thành
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── DRAFT roadmap review (Accept ≠ Activate — master task §4) ───────────

function DraftRoadmapDetail({ data, onChanged }: { data: FitnessRoadmapProjection; onChanged: () => void }) {
  const { roadmap, phases } = data;
  const aiMeta = (roadmap.configuration as any)?.aiDraft as PersistedAiDraftMeta | undefined;
  // Roadmap Projection & Strategy Report Hardening (design doc §12) — a
  // saved DRAFT reopens with the same rich strategy timeline the user
  // reviewed at Step 4, read from the additive
  // configuration.roadmapProjectionSnapshot key (display/audit-only,
  // never re-validated as a live computation). Older DRAFTs created
  // before this snapshot existed (or PT-created ones) fall back to the
  // plain phase list below.
  const projectionSnapshot = (roadmap.configuration as any)?.roadmapProjectionSnapshot as
    | RoadmapPhaseForecastResult
    | null
    | undefined;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(projectionSnapshot?.strategyGroups[0] ? [projectionSnapshot.strategyGroups[0].key] : []),
  );
  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activateMutation = useMutation({
    mutationFn: () => fitnessRoadmapService.activate(roadmap.id),
    onSuccess: () => {
      toast.success("Đã kích hoạt lộ trình");
      onChanged();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể kích hoạt lộ trình");
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => fitnessRoadmapService.archive(roadmap.id),
    onSuccess: () => {
      toast.success("Đã bỏ bản nháp");
      onChanged();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể bỏ bản nháp — có thể lộ trình đang có giai đoạn hoạt động");
    },
  });

  return (
    <div className="space-y-4 rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-zinc-900 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-green-400">Bản nháp lộ trình</p>
          <p className="text-lg font-bold text-zinc-100">{roadmap.name}</p>
          <p className="text-xs text-zinc-500">
            {GOAL_OPTIONS.find((g) => g.key === roadmap.goalType)?.label ?? roadmap.goalType} · Dự kiến bắt đầu{" "}
            {formatDate(roadmap.plannedStartAt)}
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-bold text-green-300">
          {CREATOR_ROLE_LABEL[roadmap.createdByRole]}
        </span>
      </div>

      {aiMeta && (
        <div>
          <p className="text-sm text-zinc-200">{aiMeta.summary}</p>
          <p className="mt-1 text-xs text-zinc-500">{aiMeta.reasoningSummary}</p>
        </div>
      )}

      {projectionSnapshot ? (
        <div className="space-y-2">
          {projectionSnapshot.strategyGroups.map((group) => {
            const groupForecasts = projectionSnapshot.phaseForecasts.filter((f) => group.phaseIndexes.includes(f.phaseIndex));
            const totalWeeks = groupForecasts.reduce((s, f) => s + f.durationWeeks, 0);
            const isExpanded = expandedGroups.has(group.key);
            return (
              <div key={group.key} className="overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900/40">
                <button type="button" onClick={() => toggleGroup(group.key)} className="flex w-full items-center justify-between p-2.5 text-left">
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">
                      {group.key} · {STRATEGY_BUCKET_LABEL[group.bucket]}
                    </p>
                    <p className="text-xs text-zinc-500">{groupForecasts.length} giai đoạn · {totalWeeks} tuần</p>
                  </div>
                  <CaretDown className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                {isExpanded && (
                  <div className="space-y-2 border-t border-zinc-800 p-2.5 pt-2">
                    {groupForecasts.map((f) => (
                      <PhaseForecastCard key={f.phaseIndex} forecast={f} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {phases.map((phase, i) => (
            <div key={phase.id} className="flex items-center gap-3 rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-400">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-100">
                  {phase.name} <span className="text-zinc-500">· {PHASE_TYPE_LABEL[phase.phaseType]}</span>
                </p>
                <p className="text-xs text-zinc-500">{formatDate(phase.plannedStartAt)} → {formatDate(phase.plannedEndAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {aiMeta && aiMeta.warnings.length > 0 && (
        <div className="space-y-1.5">
          {aiMeta.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
              <p className="text-xs text-amber-200">{w}</p>
            </div>
          ))}
        </div>
      )}

      {aiMeta && aiMeta.assumptions.length > 0 && (
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-2.5">
          <p className="mb-1 text-xs font-semibold text-zinc-400">Giả định đã dùng:</p>
          <ul className="space-y-0.5 text-xs text-zinc-500">
            {aiMeta.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Rendered exactly once — never duplicated inside aiMeta.reasoningSummary
          or anywhere in the strategy timeline above (see
          docs/GYMINI_GUIDED_ROADMAP_E2E_REPORT.md §2 for why this stays a
          single, dedicated, always-visible element). */}
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-2.5 text-xs text-zinc-500">
        Lộ trình này không cố định — sau mỗi chu kỳ tập luyện, Gymini sẽ đánh giá lại dữ liệu thực tế và có thể điều chỉnh giai
        đoạn, thời lượng, tập luyện và dinh dưỡng của bạn.
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => activateMutation.mutate()}
          disabled={activateMutation.isPending}
          className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 disabled:opacity-60"
        >
          {activateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {activateMutation.isPending ? "Đang bắt đầu..." : "Bắt đầu lộ trình"}
        </button>
        <button
          type="button"
          onClick={() => discardMutation.mutate()}
          disabled={discardMutation.isPending}
          className="rounded-xl border border-zinc-700/60 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:border-red-500/40 hover:text-red-300 disabled:opacity-60"
        >
          Bỏ bản nháp
        </button>
      </div>
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────

export function RoadmapJourneyPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  // getCurrent is ACTIVE-only by contract (unchanged, intentional — see
  // docs/FITNESS_ROADMAP_HARDENING_IMPLEMENTATION_REPORT.md §Phase C). A
  // 404 here does NOT mean "no roadmap at all" — it may mean there is a
  // pending DRAFT (the user's own unactivated draft, or one a PT created
  // for them) that GET /current cannot surface. Only once we know there is
  // no ACTIVE roadmap do we look for a DRAFT.
  const activeQuery = useQuery({
    queryKey: ["fitness-roadmap", "current"],
    queryFn: fitnessRoadmapService.getCurrent,
    retry: false,
  });
  const noActiveRoadmap = activeQuery.isError && isNotFound(activeQuery.error);
  const draftQuery = useQuery({
    queryKey: ["fitness-roadmap", "draft-current"],
    queryFn: fitnessRoadmapService.getCurrentDraft,
    retry: false,
    enabled: noActiveRoadmap,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["fitness-roadmap"] });

  const archiveMutation = useMutation({
    mutationFn: (roadmapId: string) => fitnessRoadmapService.archive(roadmapId),
    onSuccess: () => {
      toast.success("Đã lưu trữ lộ trình");
      refresh();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu trữ lộ trình");
    },
  });

  const advanceMutation = useMutation({
    mutationFn: (roadmapId: string) => fitnessRoadmapService.advance(roadmapId),
    onSuccess: () => {
      toast.success("Đã kiểm tra tiến độ lộ trình");
      refresh();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể cập nhật lộ trình");
    },
  });

  if (activeQuery.isLoading || (noActiveRoadmap && draftQuery.isPending)) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-green-500" />
      </div>
    );
  }

  if (noActiveRoadmap) {
    if (draftQuery.data) {
      return (
        <div className="space-y-4 p-4 md:p-6">
          <DraftRoadmapDetail data={draftQuery.data} onChanged={refresh} />
        </div>
      );
    }
    if (draftQuery.isError && !isNotFound(draftQuery.error)) {
      return (
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <div>
              <p className="text-sm text-red-200">Không thể tải lộ trình. Vui lòng thử lại.</p>
              <button
                type="button"
                onClick={() => draftQuery.refetch()}
                className="mt-2 text-xs font-semibold text-red-300 underline"
              >
                Thử lại
              </button>
            </div>
          </div>
        </div>
      );
    }
    // Both "no ACTIVE roadmap" and "no DRAFT roadmap" (a clean 404) -> genuinely nothing yet.
    return (
      <div className="space-y-4 p-4 md:p-6">
        <NoRoadmapState onReady={refresh} />
      </div>
    );
  }

  if (activeQuery.isError) {
    return (
      <div className="p-4 md:p-6">
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm text-red-200">Không thể tải lộ trình. Vui lòng thử lại.</p>
            <button
              type="button"
              onClick={() => activeQuery.refetch()}
              className="mt-2 text-xs font-semibold text-red-300 underline"
            >
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  const data = activeQuery.data!;
  const { roadmap, phases, activePhase, pendingRebuild } = data;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MapTrifold className="h-5 w-5 text-green-400" />
            <p className="text-base font-bold text-zinc-100">{roadmap.name}</p>
          </div>
          <p className="text-xs text-zinc-500">
            {ROADMAP_STATUS_LABEL[roadmap.status]} · Bắt đầu {formatDate(roadmap.plannedStartAt)}
            {roadmap.createdByRole !== "CLIENT" && (
              <span className="ml-1 inline-flex items-center gap-1 text-green-400">
                {roadmap.createdByRole === "AI" && <Sparkles className="h-3 w-3" />}
                {CREATOR_ROLE_LABEL[roadmap.createdByRole]}
              </span>
            )}
          </p>
        </div>
        {roadmap.status === "ACTIVE" && !phases.some((p) => p.status === "ACTIVE" && p.trainingCycles.some((c) => c.status === "ACTIVE")) && (
          <button
            type="button"
            onClick={() => advanceMutation.mutate(roadmap.id)}
            disabled={advanceMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-green-500/40 px-3 py-1.5 text-xs font-semibold text-green-300 hover:bg-green-500/10 disabled:opacity-60"
          >
            {advanceMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Kiểm tra tiến độ
          </button>
        )}
      </div>

      {pendingRebuild && roadmap.status === "ACTIVE" && (
        <PendingRebuildBanner
          roadmapId={roadmap.id}
          assessmentId={pendingRebuild.assessmentId}
          currentPhaseId={pendingRebuild.phaseId}
          phases={phases}
          onApplied={refresh}
        />
      )}

      {activePhase && roadmap.status === "ACTIVE" && (
        <ActivePhaseDetail
          phase={activePhase}
          projectionSnapshot={(roadmap.configuration as any)?.roadmapProjectionSnapshot ?? null}
          trainingReadiness={data.trainingReadiness}
          nutritionReadiness={data.nutritionReadiness}
        />
      )}

      {roadmap.status === "ACTIVE" && <AdaptiveForecastSection roadmapId={roadmap.id} />}

      {roadmap.status === "COMPLETED" && <CompletedRoadmapSummary data={data} />}

      {roadmap.status === "ARCHIVED" && (
        <div className="flex items-center gap-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <Ban className="h-5 w-5 text-zinc-500" />
          <p className="text-sm text-zinc-400">Lộ trình này đã được lưu trữ.</p>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Toàn bộ hành trình</p>
        <PhaseTimeline phases={phases} />
      </div>

      {(roadmap.status === "COMPLETED" || roadmap.status === "CANCELLED") && (
        <button
          type="button"
          onClick={() => archiveMutation.mutate(roadmap.id)}
          disabled={archiveMutation.isPending}
          className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-300 disabled:opacity-60"
        >
          Lưu trữ lộ trình này
        </button>
      )}

      {!showCreate && (roadmap.status === "COMPLETED" || roadmap.status === "ARCHIVED" || roadmap.status === "CANCELLED") && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl border border-green-500/40 px-4 py-2.5 text-sm font-semibold text-green-300 hover:bg-green-500/10"
        >
          <CheckCircle2 className="h-4 w-4" />
          Bắt đầu lộ trình mới
        </button>
      )}
      {showCreate && <NoRoadmapState onReady={() => { setShowCreate(false); refresh(); }} />}
    </div>
  );
}
