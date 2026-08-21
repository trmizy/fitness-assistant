import { Dumbbell, AlertTriangle, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ptCoachService } from "../../services/api";

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

/** Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — a PT's compact
 * view of a client's fitness data (only rendered when the contract is
 * ACTIVE; the backend independently re-checks this per request regardless
 * of what this component assumes). */
export function ClientFitnessSummaryCard({ clientUserId }: { clientUserId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pt-client-fitness-summary", clientUserId],
    queryFn: () => ptCoachService.getClientSummary(clientUserId),
  });

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
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
        </div>
      )}
    </div>
  );
}
