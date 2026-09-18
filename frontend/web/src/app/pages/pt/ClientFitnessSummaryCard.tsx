import { useState } from "react";
import {
  BarbellIcon as Dumbbell,
  WarningIcon as AlertTriangle,
  TrendUpIcon as TrendingUp,
  ForkKnifeIcon as Utensils,
  CheckIcon as Check,
  XIcon as X,
  PencilSimpleIcon as Pencil,
  CircleNotchIcon as Loader2,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ptCoachService } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const NUTRITION_DECISION_LABEL: Record<string, string> = {
  KEEP_PLAN: "Giữ nguyên",
  PROPOSE_ADJUSTMENT: "Đề xuất điều chỉnh",
  PROPOSE_DIET_BREAK: "Đề xuất nghỉ diet break",
  REQUEST_MORE_DATA: "Cần thêm dữ liệu",
  EARLY_REVIEW: "Đánh giá sớm",
  ESCALATE: "Cần chuyên gia",
};

const NUTRITION_TRIGGER_LABEL: Record<string, string> = {
  ONBOARDING: "Tự động (onboarding)",
  MANUAL: "Người dùng tự đặt",
  AI_ADAPTIVE: "AI điều chỉnh",
  PT: "PT thiết lập",
};

const NUTRITION_USER_DECISION_LABEL: Record<string, string> = {
  PENDING: "chưa xem xét",
  ACCEPTED: "đã chấp nhận",
  REJECTED: "đã từ chối",
  MODIFIED_BY_PT: "đã được PT điều chỉnh",
};

const SENTIMENT_LABEL: Record<string, { label: string; cls: string }> = {
  positive: { label: "Tích cực", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  negative: { label: "Tiêu cực", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  neutral: { label: "Trung tính", cls: "bg-zinc-700/60 text-zinc-400 border-zinc-600/40" },
  mixed: { label: "Lẫn lộn", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  insufficient_feedback: { label: "Chưa đủ dữ liệu", cls: "bg-zinc-700/60 text-zinc-500 border-zinc-600/40" },
};

const DECISION_LABEL: Record<string, string> = {
  KEEP: "Giữ nguyên",
  PROGRESS: "Tăng tải",
  ADJUST: "Điều chỉnh",
  DELOAD: "Giảm tải",
  REBUILD: "Xây lại",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};

const CONSISTENCY_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  MATCHED: { label: "Khớp mục tiêu", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  STALE_GOAL_CHANGED: { label: "Mục tiêu đã đổi — thực đơn cũ", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  MACRO_MISMATCH: { label: "Lệch mục tiêu", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  NO_ACTIVE_GOAL: { label: "Chưa có mục tiêu", cls: "bg-zinc-700/60 text-zinc-400 border-zinc-600/40" },
  NO_ACTIVE_PROGRAM: { label: "Chưa có thực đơn", cls: "bg-zinc-700/60 text-zinc-400 border-zinc-600/40" },
  LOW_CONFIDENCE: { label: "Chưa đủ dữ liệu so sánh", cls: "bg-zinc-700/60 text-zinc-500 border-zinc-600/40" },
};

/** Bottom-sheet form for a PT's Modify action — a controlled, explicit
 * calorie/protein/carb/fat patch (spec §IV: "PT modifies: 2100 kcal"),
 * never a free-for-all edit of every advanced field. */
function ModifyNutritionSheet({
  initial,
  onCancel,
  onSubmit,
  isPending,
}: {
  initial: { calories: number; protein: number; carbs: number; fat: number };
  onCancel: () => void;
  onSubmit: (goal: { calories: number; protein: number; carbs: number; fat: number }, note: string) => void;
  isPending: boolean;
}) {
  const [calories, setCalories] = useState(String(initial.calories));
  const [protein, setProtein] = useState(String(initial.protein));
  const [carbs, setCarbs] = useState(String(initial.carbs));
  const [fat, setFat] = useState(String(initial.fat));
  const [note, setNote] = useState("");

  useBackDismissible(true, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="text-sm font-bold text-zinc-100">Điều chỉnh mục tiêu dinh dưỡng</h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">
            Calories
            <input
              type="number"
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Protein (g)
            <input
              type="number"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Carbs (g)
            <input
              type="number"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Fat (g)
            <input
              type="number"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
            />
          </label>
        </div>
        <label className="text-xs text-zinc-500 block">
          Ghi chú (tuỳ chọn)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Vd: Giữ calo cao hơn AI đề xuất do lịch tập nặng hơn"
            className="mt-1 w-full px-2.5 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none"
          />
        </label>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm font-semibold"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              onSubmit(
                {
                  calories: Math.round(Number(calories)),
                  protein: Number(protein),
                  carbs: Number(carbs),
                  fat: Number(fat),
                },
                note,
              )
            }
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-black text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu điều chỉnh"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — a PT's compact
 * view of a client's fitness data (only rendered when the contract is
 * ACTIVE; the backend independently re-checks this per request regardless
 * of what this component assumes). Phase 2 adds real Approve/Modify/Reject
 * actions on the client's pending AI nutrition recommendation. */
export function ClientFitnessSummaryCard({
  clientUserId,
  section = "both",
}: {
  clientUserId: string;
  /** Tab restructuring (PT Coaching Workspace phase §7) — the SAME query
   * (React Query dedupes by key) renders only the half relevant to the
   * active tab. "both" preserves the original single-page behavior. */
  section?: "training" | "nutrition" | "both";
}) {
  const showTraining = section === "training" || section === "both";
  const showNutrition = section === "nutrition" || section === "both";
  const queryClient = useQueryClient();
  const [showModifySheet, setShowModifySheet] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pt-client-fitness-summary", clientUserId],
    queryFn: () => ptCoachService.getClientSummary(clientUserId),
  });

  const cycleId = data?.activeCycle?.id;
  const assessmentId = data?.nutrition?.latestNutritionDecision?.assessmentId ?? undefined;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pt-client-fitness-summary", clientUserId] });

  const approveMutation = useMutation({
    mutationFn: () => ptCoachService.approveNutritionRecommendation(clientUserId, cycleId!, assessmentId),
    onSuccess: () => {
      toast.success("Đã chấp nhận đề xuất AI cho học viên");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? "Không thể chấp nhận đề xuất"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => ptCoachService.rejectNutritionRecommendation(clientUserId, cycleId!, assessmentId),
    onSuccess: () => {
      toast.success("Đã từ chối đề xuất AI");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? "Không thể từ chối đề xuất"),
  });

  const modifyMutation = useMutation({
    mutationFn: (input: { goal: { calories: number; protein: number; carbs: number; fat: number }; note: string }) =>
      ptCoachService.modifyNutritionRecommendation(clientUserId, cycleId!, input.goal, assessmentId, input.note || undefined),
    onSuccess: () => {
      toast.success("Đã lưu mục tiêu dinh dưỡng đã điều chỉnh cho học viên");
      setShowModifySheet(false);
      invalidate();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? "Không thể lưu điều chỉnh");
    },
  });

  // Diet break / maintenance-phase modeling — PT-initiated trigger.
  const triggerDietBreakMutation = useMutation({
    mutationFn: () => ptCoachService.triggerDietBreakRecommendation(clientUserId, cycleId!),
    onSuccess: () => {
      toast.success("Đã đề xuất diet break cho học viên — chờ học viên xác nhận");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? "Không thể đề xuất diet break"),
  });

  const canPtAct = !!cycleId && data?.nutrition?.latestNutritionDecision?.canPtAct;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
      {showTraining && (
      <>
      <div className="flex items-center gap-2 mb-3">
        <Dumbbell className="w-4 h-4 text-green-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Dữ liệu tập luyện</h4>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isError && (
        <p className="text-xs text-zinc-500 py-4 text-center">Không thể tải dữ liệu tập luyện.</p>
      )}

      {!isLoading && !isError && !data?.activeCycle && (
        <p className="text-xs text-zinc-500 py-4 text-center">Học viên chưa có chu kỳ tập luyện đang hoạt động.</p>
      )}

      {data?.activeCycle && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Chu kỳ</span>
            <span className="text-zinc-300">{data.activeCycle.name ?? `Chu kỳ #${data.activeCycle.cycleIndex}`}</span>
          </div>
          {data.cycleSummary?.adherence && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Tuân thủ</span>
              <span className="text-zinc-300">
                {data.cycleSummary.adherence.percent != null
                  ? `${Math.round(data.cycleSummary.adherence.percent)}%`
                  : "Chưa có dữ liệu"}{" "}
                ({data.cycleSummary.adherence.completed}/{data.cycleSummary.adherence.total} buổi)
              </span>
            </div>
          )}

          {data.feedbackSummary && data.feedbackSummary.totalSessions > 0 && (
            <>
              <div className="flex justify-between items-center pt-2 border-t border-zinc-800/60">
                <span className="text-zinc-500">Cảm nhận buổi tập</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    SENTIMENT_LABEL[data.feedbackSummary.feedbackSentimentByRules]?.cls ?? SENTIMENT_LABEL.neutral.cls
                  }`}
                >
                  {SENTIMENT_LABEL[data.feedbackSummary.feedbackSentimentByRules]?.label ?? data.feedbackSummary.feedbackSentimentByRules}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Đã phản hồi</span>
                <span className="text-zinc-400">
                  {data.feedbackSummary.feedbackSubmittedCount}/{data.feedbackSummary.totalSessions} buổi
                </span>
              </div>
              {(data.feedbackSummary.safetyFlags.length > 0 ||
                data.feedbackSummary.equipmentMismatchFlags.length > 0) && (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-950/20 p-2 mt-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200/80">
                    {[...data.feedbackSummary.safetyFlags, ...data.feedbackSummary.equipmentMismatchFlags].join(", ")}
                  </p>
                </div>
              )}
            </>
          )}

          {data.priorDecisions.length > 0 && (
            <div className="flex items-start gap-1.5 pt-2 border-t border-zinc-800/60">
              <TrendingUp className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-zinc-500">
                Quyết định gần đây: {data.priorDecisions.map((d) => DECISION_LABEL[d] ?? d).join(" → ")}
              </p>
            </div>
          )}

          {/* §21 — the training-side CycleAssessment's own reasoning (real
              decision + AI summary, never raw chain-of-thought). */}
          {data.latestAssessment?.decision && (
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">Đánh giá chu kỳ gần nhất</span>
                <span className="text-[11px] font-semibold text-green-300">
                  {DECISION_LABEL[data.latestAssessment.decision] ?? data.latestAssessment.decision}
                </span>
              </div>
              {data.latestAssessment.aiSummary && (
                <p className="text-[11px] text-zinc-400 mt-1">{data.latestAssessment.aiSummary}</p>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Loading/error states for a nutrition-only render (the shared block
          above already covers this when showTraining is also true). */}
      {!showTraining && isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!showTraining && isError && (
        <p className="text-xs text-zinc-500 py-4 text-center">Không thể tải dữ liệu dinh dưỡng.</p>
      )}
      {!showTraining && !isLoading && !isError && showNutrition && !data?.nutrition?.activeGoal && !data?.nutrition?.latestNutritionDecision && (
        <p className="text-xs text-zinc-500 py-4 text-center">Học viên chưa có mục tiêu dinh dưỡng.</p>
      )}

      {/* ── AI Nutrition Cycle Engine (Gymini) — spec §XXIII ── */}
      {showNutrition && (data?.nutrition?.activeGoal || data?.nutrition?.latestNutritionDecision) && (
        <div className={showTraining ? "mt-4 pt-3 border-t border-zinc-800/60" : ""}>
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="w-4 h-4 text-orange-400" />
            <h5 className="text-xs font-semibold text-zinc-300">Dinh dưỡng</h5>
          </div>
          <div className="space-y-2 text-sm">
            {data.nutrition.activeGoal && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Mục tiêu hiện tại</span>
                <span className="text-zinc-300 text-right">
                  {data.nutrition.activeGoal.calories} kcal · {Math.round(data.nutrition.activeGoal.protein)}g đạm
                  <span className="block text-[10px] text-zinc-600">
                    {NUTRITION_TRIGGER_LABEL[data.nutrition.activeGoal.triggeredBy ?? ""] ?? "Không rõ nguồn"}
                  </span>
                </span>
              </div>
            )}

            {/* §19 — the actual meal plan the client is following, plus its
                real, already-computed consistency status against the goal
                above (never a second consistency check). */}
            {data.nutrition.activeProgram && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Thực đơn hiện tại</span>
                <span className="text-zinc-300 text-right">
                  {data.nutrition.activeProgram.dailyCaloriesTarget ?? "–"} kcal · {data.nutrition.activeProgram.name}
                </span>
              </div>
            )}
            {data.nutrition.consistency?.status && (
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Trạng thái khớp mục tiêu</span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                    CONSISTENCY_STATUS_LABEL[data.nutrition.consistency.status]?.cls ?? CONSISTENCY_STATUS_LABEL.LOW_CONFIDENCE.cls
                  }`}
                >
                  {CONSISTENCY_STATUS_LABEL[data.nutrition.consistency.status]?.label ?? data.nutrition.consistency.status}
                </span>
              </div>
            )}
            {data.nutrition.activeGoal && !canPtAct && (
              <button
                type="button"
                disabled={triggerDietBreakMutation.isPending}
                onClick={() => triggerDietBreakMutation.mutate()}
                title="Đề xuất một khoảng nghỉ ở mức calo duy trì cho học viên (chỉ áp dụng cho chu kỳ giảm cân đang hoạt động)"
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[11px] font-semibold disabled:opacity-50"
              >
                {triggerDietBreakMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>🧊 Đề xuất diet break</>
                )}
              </button>
            )}
            {data.nutrition.latestNutritionDecision && (
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">Đề xuất AI gần nhất</span>
                  <span className="text-[11px] font-semibold text-orange-300">
                    {NUTRITION_DECISION_LABEL[data.nutrition.latestNutritionDecision.decision ?? ""] ??
                      data.nutrition.latestNutritionDecision.decision}
                  </span>
                </div>
                {data.nutrition.latestNutritionDecision.headline && (
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {data.nutrition.latestNutritionDecision.headline}
                  </p>
                )}
                <p className="text-[10px] text-zinc-600 mt-1">
                  Học viên:{" "}
                  {NUTRITION_USER_DECISION_LABEL[data.nutrition.latestNutritionDecision.userDecision] ??
                    data.nutrition.latestNutritionDecision.userDecision}
                  {data.nutrition.latestNutritionDecision.reviewedByRole === "PT" && " (bởi PT)"}
                </p>
                {data.nutrition.latestNutritionDecision.ptNote && (
                  <p className="text-[10px] text-zinc-500 mt-1 italic">
                    Ghi chú PT: {data.nutrition.latestNutritionDecision.ptNote}
                  </p>
                )}

                {canPtAct && (
                  <div className="flex gap-1.5 mt-2.5">
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => approveMutation.mutate()}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" /> Duyệt
                    </button>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => setShowModifySheet(true)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-700/40 border border-zinc-600/40 text-zinc-300 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <Pencil className="w-3 h-3" /> Sửa
                    </button>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate()}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Từ chối
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showModifySheet && data?.nutrition?.activeGoal && (
        <ModifyNutritionSheet
          initial={data.nutrition.activeGoal}
          isPending={modifyMutation.isPending}
          onCancel={() => setShowModifySheet(false)}
          onSubmit={(goal, note) => modifyMutation.mutate({ goal, note })}
        />
      )}
    </div>
  );
}
